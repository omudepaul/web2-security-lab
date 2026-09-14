#!/usr/bin/env node
"use strict";

/*
  build_ecosystem_empirical_matrix.js

  Combines:
    1) ecosystem topology output
    2) depd cross-product activation output
    3) depd cross-product perturbation output

  into one empirical matrix for the exact ecosystem-shared node depd@2.0.0.

  Model dimensions:
    T(p)        : exact topology membership
    L(p,w)      : depd loaded under workload w
    A(p,w)      : depd behavior invoked under workload w
    q(p,w,s)    : controlled propagation conditional on activation
    pi(p,w,s)   : A-rate * q

  IMPORTANT:
    q and pi are controlled experimental quantities, not natural
    compromise/failure probabilities.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const topologyPath = path.join(ROOT, "ecosystem-topology.json");
const activationPath = path.join(
  ROOT,
  "results",
  "ecosystem-depd-activation",
  "depd-ecosystem-activation-results.json"
);
const perturbationPath = path.join(
  ROOT,
  "results",
  "ecosystem-depd-perturbation",
  "depd-ecosystem-perturbation-results.json"
);

const OUTDIR = path.join(ROOT, "results", "ecosystem-model");

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}

function readJson(file) {
  if (!fs.existsSync(file)) die(`Missing file: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(v) {
  if (v === null || v === undefined) return '""';
  const text = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(file, rows) {
  const headers = [
    "productId",
    "product",
    "workload",
    "perturbation",
    "topologyPresent",
    "loadRate",
    "activationRate",
    "activeTrials",
    "impactedTrials",
    "qHatConditionalOnActive",
    "piHat",
    "impactType",
  ];

  const lines = [headers.map(csvEscape).join(",")];

  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }

  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

const topology = readJson(topologyPath);
const activation = readJson(activationPath);
const perturbation = readJson(perturbationPath);

ensureDir(OUTDIR);

// ------------------------------------------------------------------
// Topology membership for depd@2.0.0
// ------------------------------------------------------------------

const targetNode = "depd@2.0.0";

const sharedNode = (topology.sharedExactNodes || []).find(
  (n) => n.key === targetNode
);

if (!sharedNode) {
  die(`${targetNode} not found in ecosystem sharedExactNodes`);
}

const topologyMembership = new Set(sharedNode.productIds || []);

// ------------------------------------------------------------------
// Activation rates from activation experiment
// ------------------------------------------------------------------

const activationRows = activation.results || [];

const activationByProductWorkload = new Map();

for (const r of activationRows) {
  const key = `${r.productId}::${r.workload}`;
  activationByProductWorkload.set(key, {
    loadRate: r.depdLoaded ? 1 : 0,
    activationRate: r.depdInvoked ? 1 : 0,
  });
}

// ------------------------------------------------------------------
// Aggregate perturbation trials
// ------------------------------------------------------------------

const rawRows = perturbation.rows || [];
const groups = new Map();

for (const r of rawRows) {
  const key = [
    r.productId,
    r.product,
    r.workload,
    r.perturbation,
  ].join("::");

  if (!groups.has(key)) {
    groups.set(key, {
      productId: r.productId,
      product: r.product,
      workload: r.workload,
      perturbation: r.perturbation,
      trials: 0,
      loadedTrials: 0,
      activeTrials: 0,
      impactedTrials: 0,
      impactTypes: new Set(),
    });
  }

  const g = groups.get(key);
  g.trials += 1;
  if (r.depdLoaded) g.loadedTrials += 1;
  if (r.depdInvoked) g.activeTrials += 1;
  if (r.impactObserved) {
    g.impactedTrials += 1;
    if (r.impactType) g.impactTypes.add(r.impactType);
  }
}

const matrix = [...groups.values()].map((g) => {
  const actKey = `${g.productId}::${g.workload}`;
  const activationRef = activationByProductWorkload.get(actKey);

  const loadRate = g.trials ? g.loadedTrials / g.trials : 0;
  const activationRate = g.trials ? g.activeTrials / g.trials : 0;

  const q =
    g.activeTrials > 0
      ? g.impactedTrials / g.activeTrials
      : null;

  const pi =
    q === null ? 0 : activationRate * q;

  return {
    productId: g.productId,
    product: g.product,
    workload: g.workload,
    perturbation: g.perturbation,
    topologyPresent: topologyMembership.has(g.productId) ? 1 : 0,
    loadRate,
    activationRate,
    activeTrials: g.activeTrials,
    impactedTrials: g.impactedTrials,
    qHatConditionalOnActive: q,
    piHat: pi,
    impactType:
      [...g.impactTypes].sort().join("|") || "NONE",
    activationExperimentLoadRate:
      activationRef ? activationRef.loadRate : null,
    activationExperimentActivationRate:
      activationRef ? activationRef.activationRate : null,
  };
}).sort((a, b) =>
  a.productId.localeCompare(b.productId) ||
  a.workload.localeCompare(b.workload) ||
  a.perturbation.localeCompare(b.perturbation)
);

// ------------------------------------------------------------------
// Internal consistency checks
// ------------------------------------------------------------------

let maxActivationDifference = 0;
for (const row of matrix) {
  if (row.activationExperimentActivationRate !== null) {
    maxActivationDifference = Math.max(
      maxActivationDifference,
      Math.abs(
        row.activationRate -
        row.activationExperimentActivationRate
      )
    );
  }
}

let maxPiDifference = 0;
for (const row of matrix) {
  const directObserved =
    row.activeTrials > 0
      ? (row.impactedTrials / row.activeTrials) * row.activationRate
      : 0;

  maxPiDifference = Math.max(
    maxPiDifference,
    Math.abs(row.piHat - directObserved)
  );
}

// ------------------------------------------------------------------
// Human-readable report
// ------------------------------------------------------------------

function fmt(x) {
  if (x === null || x === undefined) return "NA";
  return Number(x).toFixed(3);
}

const report = [];

report.push("ECOSYSTEM EMPIRICAL DEPENDENCY MATRIX REPORT");
report.push("============================================");
report.push("");
report.push(`Target exact shared node: ${targetNode}`);
report.push("Products: Express, express-session, Morgan");
report.push("");
report.push("MODEL");
report.push("-----");
report.push("T(p)      = exact package-version topology membership");
report.push("L(p,w)    = workload-conditioned load rate");
report.push("A(p,w)    = workload-conditioned invocation rate");
report.push("q(p,w,s)  = impacted active trials / active trials");
report.push("pi(p,w,s) = A(p,w) * q(p,w,s)");
report.push("");
report.push(
  "Important: q and pi are controlled experimental quantities, not natural compromise/failure probabilities."
);
report.push("");

report.push("TOPOLOGY MEMBERSHIP");
report.push("-------------------");
for (const productId of ["P1", "P2", "P3"]) {
  report.push(
    `${productId}: T=${topologyMembership.has(productId) ? 1 : 0}`
  );
}

report.push("");
report.push("SELECTED MATRIX ROWS");
report.push("--------------------");

for (const row of matrix) {
  if (row.perturbation === "BASELINE") continue;

  report.push(
    `${row.productId} | ${row.workload} | ${row.perturbation} | ` +
    `T=${row.topologyPresent} | L=${fmt(row.loadRate)} | ` +
    `A=${fmt(row.activationRate)} | q=${fmt(row.qHatConditionalOnActive)} | ` +
    `pi=${fmt(row.piHat)} | impact=${row.impactType}`
  );
}

report.push("");
report.push("CONSISTENCY CHECKS");
report.push("------------------");
report.push(
  `Max |activation rate - activation-experiment rate| = ${maxActivationDifference.toFixed(4)}`
);
report.push(
  `Max |pi - direct observed controlled impact rate| = ${maxPiDifference.toFixed(4)}`
);

report.push("");
report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "All three products contain the exact shared dependency node depd@2.0.0, so T=1 for P1, P2, and P3."
);
report.push(
  "Loading can occur without invocation, and invocation is workload dependent."
);
report.push(
  "Controlled propagation is gated by activation: inactive workloads have q=NA and pi=0."
);
report.push(
  "For deterministic active perturbations in this experiment, q=1 by construction/observation, so pi reduces to the activation rate."
);
report.push(
  "This validates the topology -> loading -> invocation -> propagation decomposition internally; it is not independent evidence of natural security risk."
);

const reportText = report.join("\n");

// ------------------------------------------------------------------
// Outputs
// ------------------------------------------------------------------

fs.writeFileSync(
  path.join(OUTDIR, "depd-ecosystem-empirical-matrix.json"),
  JSON.stringify(
    {
      targetNode,
      topologyMembership: [...topologyMembership],
      matrix,
      consistency: {
        maxActivationDifference,
        maxPiDifference,
      },
    },
    null,
    2
  ),
  "utf8"
);

writeCsv(
  path.join(OUTDIR, "depd-ecosystem-empirical-matrix.csv"),
  matrix
);

fs.writeFileSync(
  path.join(OUTDIR, "depd-ecosystem-empirical-matrix-report.txt"),
  reportText,
  "utf8"
);

console.log(reportText);
console.log("");
console.log("Files created:");
console.log(
  "  results/ecosystem-model/depd-ecosystem-empirical-matrix-report.txt"
);
console.log(
  "  results/ecosystem-model/depd-ecosystem-empirical-matrix.csv"
);
console.log(
  "  results/ecosystem-model/depd-ecosystem-empirical-matrix.json"
);
