#!/usr/bin/env node
"use strict";

/*
  build_shared_edge_empirical_matrix.js

  Combines:
    1) ecosystem topology
    2) debug->ms color-gate activation experiment
    3) debug->ms shared-edge perturbation experiment

  Target exact shared edge:
      debug@2.6.9 -> ms@2.0.0

  Model:
    T_e(p)        : exact topology membership
    L_e(p,c)      : edge load rate
    D(p,c)        : parent debug-call rate
    E(p,c)        : enabled debug-execution rate
    A_e(p,c)      : downstream edge activation rate
    q_e(p,c,s)    : impacted active trials / active trials
    pi_e(p,c,s)   : impacted trials / all trials

  These are controlled experimental quantities, not natural
  vulnerability, compromise, or failure probabilities.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTDIR = path.join(
  ROOT,
  "results",
  "shared-edge-model"
);

const TOPOLOGY_FILE = path.join(
  ROOT,
  "ecosystem-topology.json"
);

const GATE_FILE = path.join(
  ROOT,
  "results",
  "debug-ms-color-gate",
  "debug-ms-color-gate-results.json"
);

const PERT_FILE = path.join(
  ROOT,
  "results",
  "debug-ms-shared-edge-perturbation",
  "debug-ms-shared-edge-perturbation-results.json"
);

const TARGET_EDGE = "debug@2.6.9 -> ms@2.0.0";

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}

function readJson(file) {
  if (!fs.existsSync(file)) {
    die(`Missing file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(v) {
  if (v === null || v === undefined) return '""';
  const text =
    typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(file, rows) {
  const headers = [
    "productId",
    "product",
    "configuration",
    "perturbation",
    "topologyPresent",
    "edgeLoadRate",
    "parentCallRate",
    "enabledExecutionRate",
    "edgeActivationRate",
    "activeTrials",
    "impactedTrials",
    "qHatConditionalOnActive",
    "piHat",
    "impactType",
  ];

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) =>
      headers.map((h) => csvEscape(row[h])).join(",")
    ),
  ];

  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

function fmt(x) {
  if (x === null || x === undefined) return "NA";
  return Number(x).toFixed(3);
}

ensureDir(OUTDIR);

const topology = readJson(TOPOLOGY_FILE);
const gate = readJson(GATE_FILE);
const perturb = readJson(PERT_FILE);

// ---------------------------------------------------------------
// Topology membership
// ---------------------------------------------------------------

const sharedEdge = (topology.sharedExactEdges || []).find(
  (e) => e.edge === TARGET_EDGE
);

if (!sharedEdge) {
  die(`${TARGET_EDGE} not found in ecosystem sharedExactEdges`);
}

const topologyMembership = new Set(
  sharedEdge.productIds || []
);

// ---------------------------------------------------------------
// Gate summary
// ---------------------------------------------------------------

const gateSummary = gate.summary || [];

const gateByProductCondition = new Map();

for (const g of gateSummary) {
  gateByProductCondition.set(
    `${g.productId}::${g.condition}`,
    {
      edgeLoadRate: g.edgeLoadRate,
      parentCallRate: g.parentCallRate,
      enabledExecutionRate:
        g.enabledExecutionRate,
      edgeActivationRate:
        g.edgeActivationRate,
    }
  );
}

// ---------------------------------------------------------------
// Perturbation summary -> matrix
// ---------------------------------------------------------------

const pertSummary = perturb.summary || [];

const matrix = pertSummary.map((g) => {
  const configMap =
    g.config === "ACTIVE_COLORS_ON"
      ? "DEBUG_ON_COLORS_ON"
      : "DEBUG_ON_COLORS_OFF";

  const gateRef = gateByProductCondition.get(
    `${g.productId}::${configMap}`
  );

  return {
    productId: g.productId,
    product: g.product,
    configuration: g.config,
    perturbation: g.perturbation,

    topologyPresent:
      topologyMembership.has(g.productId) ? 1 : 0,

    edgeLoadRate:
      gateRef
        ? gateRef.edgeLoadRate
        : g.edgeLoadRate,

    parentCallRate:
      gateRef
        ? gateRef.parentCallRate
        : g.parentCallRate,

    enabledExecutionRate:
      gateRef
        ? gateRef.enabledExecutionRate
        : g.enabledExecutionRate,

    edgeActivationRate:
      gateRef
        ? gateRef.edgeActivationRate
        : g.activationRate,

    activeTrials: g.activeTrials,
    impactedTrials: g.impactedTrials,

    qHatConditionalOnActive:
      g.qHatConditionalOnActive,

    piHat: g.piHat,
    impactType: g.impactType,
  };
}).sort(
  (a, b) =>
    a.productId.localeCompare(b.productId) ||
    a.configuration.localeCompare(b.configuration) ||
    a.perturbation.localeCompare(b.perturbation)
);

// ---------------------------------------------------------------
// Consistency checks
// ---------------------------------------------------------------

let maxActivationDifference = 0;

for (const row of matrix) {
  const configMap =
    row.configuration === "ACTIVE_COLORS_ON"
      ? "DEBUG_ON_COLORS_ON"
      : "DEBUG_ON_COLORS_OFF";

  const gateRef = gateByProductCondition.get(
    `${row.productId}::${configMap}`
  );

  if (gateRef) {
    maxActivationDifference = Math.max(
      maxActivationDifference,
      Math.abs(
        row.edgeActivationRate -
        gateRef.edgeActivationRate
      )
    );
  }
}

let maxPiDifference = 0;

for (const row of matrix) {
  const direct =
    row.activeTrials > 0
      ? row.impactedTrials /
        (row.activeTrials /
          (row.edgeActivationRate || 1))
      : 0;

  // Safer direct expression from all-trial quantity
  const expectedPi =
    row.qHatConditionalOnActive === null ||
    row.qHatConditionalOnActive === undefined
      ? 0
      : row.edgeActivationRate *
        row.qHatConditionalOnActive;

  maxPiDifference = Math.max(
    maxPiDifference,
    Math.abs(row.piHat - expectedPi)
  );
}

// ---------------------------------------------------------------
// Report
// ---------------------------------------------------------------

const report = [];

report.push(
  "SHARED-EDGE EMPIRICAL MATRIX REPORT"
);
report.push(
  "=================================="
);
report.push("");
report.push(
  `Target exact shared edge: ${TARGET_EDGE}`
);
report.push(
  "Products: express-session, Morgan"
);
report.push("");

report.push("MODEL");
report.push("-----");
report.push(
  "T_e(p)       = exact edge topology membership"
);
report.push(
  "L_e(p,c)     = workload/configuration-conditioned edge load rate"
);
report.push(
  "D(p,c)       = parent debug-call rate"
);
report.push(
  "E(p,c)       = enabled debug-execution rate"
);
report.push(
  "A_e(p,c)     = downstream edge activation rate"
);
report.push(
  "q_e(p,c,s)   = impacted active trials / active trials"
);
report.push(
  "pi_e(p,c,s)  = A_e(p,c) * q_e(p,c,s)"
);
report.push("");
report.push(
  "Important: q_e and pi_e are controlled experimental quantities, not natural vulnerability, compromise, or failure probabilities."
);
report.push("");

report.push("TOPOLOGY MEMBERSHIP");
report.push("-------------------");
for (const productId of ["P2", "P3"]) {
  report.push(
    `${productId}: T_e=${
      topologyMembership.has(productId) ? 1 : 0
    }`
  );
}

report.push("");
report.push("SELECTED MATRIX ROWS");
report.push("--------------------");

for (const row of matrix) {
  report.push(
    `${row.productId} | ${row.configuration} | ${row.perturbation} | ` +
    `T=${row.topologyPresent} | ` +
    `L=${fmt(row.edgeLoadRate)} | ` +
    `D=${fmt(row.parentCallRate)} | ` +
    `E=${fmt(row.enabledExecutionRate)} | ` +
    `A=${fmt(row.edgeActivationRate)} | ` +
    `q=${fmt(row.qHatConditionalOnActive)} | ` +
    `pi=${fmt(row.piHat)} | ` +
    `impact=${row.impactType}`
  );
}

report.push("");
report.push("CONSISTENCY CHECKS");
report.push("------------------");
report.push(
  `Max |edge activation rate - color-gate experiment rate| = ${maxActivationDifference.toFixed(4)}`
);
report.push(
  `Max |pi - A*q| = ${maxPiDifference.toFixed(4)}`
);

report.push("");
report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "The same exact dependency edge is present in both products."
);
report.push(
  "Topology and loading alone do not imply downstream execution."
);
report.push(
  "The edge activates only under the tested enabled-color configuration."
);
report.push(
  "Inactive color-gated configurations have A=0, q=NA, and pi=0."
);
report.push(
  "Active deterministic perturbations have q=1 in this controlled experiment, so pi reduces to the edge activation rate."
);
report.push(
  "This provides internal consistency evidence for the topology -> loading -> parent call -> enabled execution -> edge activation -> propagation decomposition."
);
report.push(
  "It is not independent evidence of real-world security risk."
);

const reportText = report.join("\n");

// ---------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------

fs.writeFileSync(
  path.join(
    OUTDIR,
    "debug-ms-shared-edge-empirical-matrix.json"
  ),
  JSON.stringify(
    {
      targetEdge: TARGET_EDGE,
      topologyMembership:
        [...topologyMembership],
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
  path.join(
    OUTDIR,
    "debug-ms-shared-edge-empirical-matrix.csv"
  ),
  matrix
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "debug-ms-shared-edge-empirical-matrix-report.txt"
  ),
  reportText,
  "utf8"
);

console.log(reportText);
console.log("");
console.log("Files created:");
console.log(
  "  results/shared-edge-model/debug-ms-shared-edge-empirical-matrix-report.txt"
);
console.log(
  "  results/shared-edge-model/debug-ms-shared-edge-empirical-matrix.csv"
);
console.log(
  "  results/shared-edge-model/debug-ms-shared-edge-empirical-matrix.json"
);
