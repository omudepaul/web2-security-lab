#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const SOURCES = [
  {
    id: "E1",
    edge: "debug@2.6.9 -> ms@2.0.0",
    file: path.join(
      ROOT,
      "results",
      "shared-edge-model",
      "debug-ms-shared-edge-empirical-matrix.json"
    ),
    activationMechanism:
      "configuration-conditioned (DEBUG enabled + color formatting enabled)"
  },
  {
    id: "E2",
    edge: "on-finished@2.4.1 -> ee-first@1.1.1",
    file: path.join(
      ROOT,
      "results",
      "onfinished-eefirst-model",
      "onfinished-eefirst-empirical-matrix.json"
    ),
    activationMechanism:
      "workload-conditioned (parent API/path actually invokes downstream edge)"
  }
];

const OUTDIR = path.join(
  ROOT,
  "results",
  "generalized-ecosystem-model"
);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required source file not found:\n${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function firstDefined(obj, names) {
  for (const name of names) {
    if (obj && obj[name] !== undefined && obj[name] !== null) {
      return obj[name];
    }
  }
  return null;
}

function rowsFrom(data) {
  const candidates = [
    data.rows,
    data.matrix,
    data.entries,
    data.results,
    data.empiricalMatrix,
    data.data,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  return [];
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(source, row) {
  const productId = firstDefined(row, [
    "productId", "product_id", "product"
  ]);

  const productName = firstDefined(row, [
    "product", "productName", "product_label", "label"
  ]);

  const workload = firstDefined(row, [
    "workload", "workloadId", "scenario", "context"
  ]);

  const config = firstDefined(row, [
    "config", "configuration", "condition"
  ]);

  const perturbation = firstDefined(row, [
    "perturbation", "fault", "attack", "faultType"
  ]);

  const T = numOrNull(firstDefined(row, [
    "T_e", "T", "topologyPresent", "topology"
  ]));

  const alpha = numOrNull(firstDefined(row, [
    "A_e_perturbation_experiment",
    "A_e",
    "activationRate",
    "edgeActivationRate",
    "alpha_e",
    "alpha",
    "A"
  ]));

  const q = numOrNull(firstDefined(row, [
    "q_hat_conditional_on_active",
    "qHatConditionalOnActive",
    "q_hat",
    "q",
    "conditionalPropagation",
    "q_e"
  ]));

  const pi = numOrNull(firstDefined(row, [
    "pi_hat_model",
    "pi_hat",
    "piHat",
    "pi",
    "effectiveImpact",
    "pi_e"
  ]));

  const impact = firstDefined(row, [
    "impactType", "impact", "impact_type"
  ]);

  return {
    edgeId: source.id,
    edge: source.edge,
    activationMechanism: source.activationMechanism,
    productId,
    productName,
    workload,
    config,
    perturbation,
    T_e: T,
    alpha_e: alpha,
    q_e: q,
    pi_e: pi,
    impactType: impact
  };
}

function unique(arr) {
  return [...new Set(arr.filter(v => v !== null && v !== undefined && v !== ""))];
}

function fmt(v) {
  if (v === null || v === undefined) return "NA";
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(3);
  return String(v);
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function summarizeEdge(source, rows) {
  const applicable = rows.filter(r => r.edgeId === source.id);

  const alphaValues = applicable
    .map(r => r.alpha_e)
    .filter(v => v !== null);

  const qValues = applicable
    .map(r => r.q_e)
    .filter(v => v !== null);

  const piValues = applicable
    .map(r => r.pi_e)
    .filter(v => v !== null);

  const activeRows = applicable.filter(
    r => r.alpha_e !== null && r.alpha_e > 0
  );

  const inactiveRows = applicable.filter(
    r => r.alpha_e === 0
  );

  const impactedRows = applicable.filter(
    r => r.pi_e !== null && r.pi_e > 0
  );

  return {
    edgeId: source.id,
    edge: source.edge,
    activationMechanism: source.activationMechanism,
    rowCount: applicable.length,
    products: unique(applicable.map(r => r.productId || r.productName)),
    workloads: unique(applicable.map(r => r.workload)),
    configs: unique(applicable.map(r => r.config)),
    perturbations: unique(applicable.map(r => r.perturbation)),
    activeRows: activeRows.length,
    inactiveRows: inactiveRows.length,
    impactedRows: impactedRows.length,
    alphaMin: alphaValues.length ? Math.min(...alphaValues) : null,
    alphaMax: alphaValues.length ? Math.max(...alphaValues) : null,
    qMin: qValues.length ? Math.min(...qValues) : null,
    qMax: qValues.length ? Math.max(...qValues) : null,
    piMin: piValues.length ? Math.min(...piValues) : null,
    piMax: piValues.length ? Math.max(...piValues) : null,
  };
}

ensureDir(OUTDIR);

let normalized = [];
const sourceDiagnostics = [];

for (const source of SOURCES) {
  const data = readJson(source.file);
  const rawRows = rowsFrom(data);

  if (!rawRows.length) {
    throw new Error(
      `Could not locate a row array in ${source.file}.\n` +
      `Top-level keys found: ${Object.keys(data).join(", ")}`
    );
  }

  const rows = rawRows.map(r => normalizeRow(source, r));
  normalized.push(...rows);

  sourceDiagnostics.push({
    edgeId: source.id,
    edge: source.edge,
    sourceFile: path.relative(ROOT, source.file).replaceAll("\\", "/"),
    topLevelKeys: Object.keys(data),
    rawRowCount: rawRows.length
  });
}

const summaries = SOURCES.map(s => summarizeEdge(s, normalized));

const generalModel = {
  modelName:
    "Context-Conditioned Shared-Dependency Propagation Model",
  ecosystemAbstraction: {
    products:
      "P = {P1, ..., PK}",
    sharedEdges:
      "E_shared = {e in union(E_p) : the same exact package-version dependency edge occurs in at least two products}",
    context:
      "x = (workload, configuration)",
    perturbation:
      "s = controlled perturbation or failure mode"
  },
  equations: {
    topology:
      "T_e(p) in {0,1}",
    activation:
      "alpha_e(p,x) = P(A_e=1 | T_e(p)=1, x)",
    conditionalPropagation:
      "q_e(p,x,s) = P(I_e=1 | A_e=1, p, x, s)",
    effectiveControlledImpact:
      "pi_e(p,x,s) = alpha_e(p,x) * q_e(p,x,s)",
    optionalOccurrenceRate:
      "R_e(p,x,s) = lambda_e(s) * alpha_e(p,x) * q_e(p,x,s)"
  },
  interpretation: {
    lambda:
      "lambda_e(s) is intentionally left unestimated unless a defensible real occurrence/failure process is available. Current controlled experiments estimate activation and propagation behavior, not natural failure probability.",
    mainClaim:
      "Static ecosystem overlap is an exposure envelope. Runtime impact is context-conditioned and requires edge activation before perturbation propagation can occur."
  },
  sourceDiagnostics,
  edgeSummaries: summaries,
  normalizedRows: normalized
};

fs.writeFileSync(
  path.join(OUTDIR, "generalized-ecosystem-model.json"),
  JSON.stringify(generalModel, null, 2),
  "utf8"
);

const headers = [
  "edgeId",
  "edge",
  "activationMechanism",
  "productId",
  "productName",
  "workload",
  "config",
  "perturbation",
  "T_e",
  "alpha_e",
  "q_e",
  "pi_e",
  "impactType"
];

const csv = [
  headers.join(","),
  ...normalized.map(row =>
    headers.map(h => csvEscape(row[h])).join(",")
  )
].join("\n");

fs.writeFileSync(
  path.join(OUTDIR, "generalized-shared-edge-matrix.csv"),
  csv,
  "utf8"
);

const report = [];
report.push("GENERALIZED ECOSYSTEM SHARED-DEPENDENCY MODEL");
report.push("==============================================");
report.push("");
report.push("Shared edges studied:");
for (const s of SOURCES) {
  report.push(`  ${s.id}: ${s.edge}`);
  report.push(`      activation mechanism: ${s.activationMechanism}`);
}
report.push("");
report.push("GENERAL SYMBOLIC MODEL");
report.push("----------------------");
report.push("For product p, shared edge e, execution context x=(workload, configuration),");
report.push("and controlled perturbation/failure mode s:");
report.push("");
report.push("  T_e(p) in {0,1}");
report.push("      exact shared edge exists topologically in product p");
report.push("");
report.push("  alpha_e(p,x) = P(A_e=1 | T_e(p)=1, x)");
report.push("      context-conditioned edge activation");
report.push("");
report.push("  q_e(p,x,s) = P(I_e=1 | A_e=1, p, x, s)");
report.push("      conditional propagation given actual edge activation");
report.push("");
report.push("  pi_e(p,x,s) = alpha_e(p,x) * q_e(p,x,s)");
report.push("      effective controlled impact under the tested context");
report.push("");
report.push("If a defensible external occurrence/failure rate later becomes available:");
report.push("");
report.push("  R_e(p,x,s) = lambda_e(s) * alpha_e(p,x) * q_e(p,x,s)");
report.push("");
report.push("Current experiments do NOT estimate lambda_e as a natural compromise/failure rate.");
report.push("");
report.push("EDGE-LEVEL EVIDENCE");
report.push("-------------------");

for (const s of summaries) {
  report.push(`${s.edgeId}: ${s.edge}`);
  report.push(`  mechanism: ${s.activationMechanism}`);
  report.push(`  normalized rows: ${s.rowCount}`);
  report.push(`  active rows: ${s.activeRows}`);
  report.push(`  inactive rows: ${s.inactiveRows}`);
  report.push(`  impacted rows: ${s.impactedRows}`);
  report.push(`  alpha range: ${fmt(s.alphaMin)} to ${fmt(s.alphaMax)}`);
  report.push(`  q range (defined rows): ${fmt(s.qMin)} to ${fmt(s.qMax)}`);
  report.push(`  pi range: ${fmt(s.piMin)} to ${fmt(s.piMax)}`);
  report.push("");
}

report.push("GENERALIZED FINDING");
report.push("-------------------");
report.push(
  "The two exact shared edges exhibit different activation mechanisms:"
);
report.push(
  "  - debug@2.6.9 -> ms@2.0.0 is configuration-conditioned."
);
report.push(
  "  - on-finished@2.4.1 -> ee-first@1.1.1 is workload-conditioned."
);
report.push("");
report.push(
  "Therefore, exact topological sharing alone is insufficient to infer runtime propagation."
);
report.push(
  "A shared edge must first become active in the current execution context before a downstream perturbation can propagate."
);
report.push("");
report.push(
  "The ecosystem model therefore separates:"
);
report.push(
  "  Static topology -> context-conditioned activation -> conditional propagation -> effective impact"
);
report.push("");
report.push(
  "This is a controlled empirical decomposition, not a direct estimate of real-world vulnerability likelihood."
);

fs.writeFileSync(
  path.join(OUTDIR, "generalized-ecosystem-model-report.txt"),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results/generalized-ecosystem-model/generalized-ecosystem-model-report.txt"
);
console.log(
  "  results/generalized-ecosystem-model/generalized-shared-edge-matrix.csv"
);
console.log(
  "  results/generalized-ecosystem-model/generalized-ecosystem-model.json"
);
