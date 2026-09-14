#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const activationFile = path.join(
  ROOT,
  "results",
  "onfinished-eefirst-shared-edge-activation",
  "onfinished-eefirst-shared-edge-activation-results.json"
);

const perturbationFile = path.join(
  ROOT,
  "results",
  "onfinished-eefirst-shared-edge-perturbation",
  "onfinished-eefirst-shared-edge-perturbation-results.json"
);

const outDir = path.join(
  ROOT,
  "results",
  "onfinished-eefirst-model"
);

const outReport = path.join(
  outDir,
  "onfinished-eefirst-empirical-matrix-report.txt"
);

const outCsv = path.join(
  outDir,
  "onfinished-eefirst-empirical-matrix.csv"
);

const outJson = path.join(
  outDir,
  "onfinished-eefirst-empirical-matrix.json"
);

function mustExist(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required file not found: ${file}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "NA";
  return Number(v).toFixed(3);
}

mustExist(activationFile);
mustExist(perturbationFile);

const activation = readJson(activationFile);
const perturbation = readJson(perturbationFile);

const activationRows = activation.results || [];
const perturbationSummary = perturbation.summary || [];

if (!activationRows.length) {
  throw new Error("Activation results contain no rows.");
}

if (!perturbationSummary.length) {
  throw new Error("Perturbation results contain no summary rows.");
}

const activationMap = new Map();

for (const r of activationRows) {
  const key = `${r.productId}::${r.workload}`;

  activationMap.set(key, {
    productId: r.productId,
    product: r.product,
    workload: r.workload,
    T_e: r.topologyPresent ? 1 : 0,
    L_o: r.onFinishedLoaded ? 1 : 0,
    O: r.onFinishedInvoked ? 1 : 0,
    L_e: r.eeFirstLoadedFromOnFinished ? 1 : 0,
    A_e_activation_experiment: r.edgeActivated ? 1 : 0,
  });
}

const rows = [];

for (const g of perturbationSummary) {
  const key = `${g.productId}::${g.workload}`;
  const a = activationMap.get(key);

  if (!a) {
    throw new Error(
      `No activation row found for ${g.productId} / ${g.workload}`
    );
  }

  const q =
    g.qHatConditionalOnActive === null ||
    g.qHatConditionalOnActive === undefined
      ? null
      : Number(g.qHatConditionalOnActive);

  const A = Number(g.activationRate);

  const piModel =
    q === null ? 0 : A * q;

  const piDirect = Number(g.piHat);

  rows.push({
    productId: g.productId,
    product: g.product,
    workload: g.workload,
    perturbation: g.perturbation,

    T_e: a.T_e,
    L_o: a.L_o,
    O: a.O,
    L_e: a.L_e,

    A_e_activation_experiment:
      a.A_e_activation_experiment,

    A_e_perturbation_experiment:
      A,

    C_parent_callback_rate:
      Number(g.parentCallbackRate),

    q_hat_conditional_on_active:
      q,

    pi_hat_model:
      piModel,

    pi_hat_direct:
      piDirect,

    impactType:
      g.impactType,

    statusCodes:
      (g.uniqueStatusCodes || []).join("|"),

    activationDifference:
      Math.abs(
        a.A_e_activation_experiment - A
      ),

    piDifference:
      Math.abs(piModel - piDirect),
  });
}

const maxActivationDiff = Math.max(
  ...rows.map((r) => r.activationDifference)
);

const maxPiDiff = Math.max(
  ...rows.map((r) => r.piDifference)
);

fs.mkdirSync(outDir, { recursive: true });

const headers = [
  "productId",
  "product",
  "workload",
  "perturbation",
  "T_e",
  "L_o",
  "O",
  "L_e",
  "A_e_activation_experiment",
  "A_e_perturbation_experiment",
  "C_parent_callback_rate",
  "q_hat_conditional_on_active",
  "pi_hat_model",
  "pi_hat_direct",
  "impactType",
  "statusCodes",
  "activationDifference",
  "piDifference",
];

const csvLines = [
  headers.join(","),
  ...rows.map((r) =>
    headers.map((h) => csvEscape(r[h])).join(",")
  ),
];

fs.writeFileSync(
  outCsv,
  csvLines.join("\n"),
  "utf8"
);

const model = {
  exactEdge:
    "on-finished@2.4.1 -> ee-first@1.1.1",
  definitions: {
    T_e:
      "Exact shared edge exists topologically in the product.",
    L_o:
      "Product/runtime loads on-finished under the workload.",
    O:
      "on-finished exported function is invoked under the workload.",
    L_e:
      "on-finished loads ee-first.",
    A_e:
      "ee-first is actually invoked by on-finished.",
    C:
      "Parent-visible on-finished callback rate.",
    q_hat:
      "Impacted active trials divided by active trials.",
    pi_hat:
      "Controlled effective impact rate, computed as A_e * q_hat; when A_e=0 and q_hat is undefined, pi_hat=0.",
  },
  rows,
  consistency: {
    maxActivationDifference:
      maxActivationDiff,
    maxPiDifference:
      maxPiDiff,
  },
  caution:
    "This is an internally consistent controlled empirical model. It is not a real-world vulnerability, compromise, or natural failure probability estimate.",
};

fs.writeFileSync(
  outJson,
  JSON.stringify(model, null, 2),
  "utf8"
);

const report = [];

report.push(
  "on-finished@2.4.1 -> ee-first@1.1.1 EMPIRICAL SHARED-EDGE MATRIX"
);
report.push(
  "======================================================================"
);
report.push("");
report.push(
  "Model chain:"
);
report.push(
  "Topology -> Load on-finished -> Invoke on-finished -> Load ee-first -> Activate edge -> Propagation -> Impact"
);
report.push("");
report.push("Definitions:");
report.push("  T_e : exact shared-edge topology membership");
report.push("  L_o : on-finished load indicator");
report.push("  O   : on-finished invocation indicator");
report.push("  L_e : ee-first load from on-finished");
report.push("  A_e : ee-first activation rate");
report.push("  C   : parent-visible callback rate");
report.push("  q   : impacted active trials / active trials");
report.push("  pi  : A_e * q");
report.push("");

for (const r of rows) {
  report.push(
    `${r.productId} ${r.product} | ${r.workload} | ${r.perturbation}`
  );
  report.push(
    `  T=${r.T_e} L_o=${r.L_o} O=${r.O} L_e=${r.L_e} ` +
    `A=${fmt(r.A_e_perturbation_experiment)} ` +
    `C=${fmt(r.C_parent_callback_rate)} ` +
    `q=${r.q_hat_conditional_on_active === null ? "NA" : fmt(r.q_hat_conditional_on_active)} ` +
    `pi(model)=${fmt(r.pi_hat_model)} ` +
    `pi(direct)=${fmt(r.pi_hat_direct)} ` +
    `impact=${r.impactType}`
  );
}

report.push("");
report.push("CONSISTENCY CHECKS");
report.push("------------------");
report.push(
  `Max |A_activation - A_perturbation| = ${maxActivationDiff.toFixed(4)}`
);
report.push(
  `Max |pi_model - pi_direct| = ${maxPiDiff.toFixed(4)}`
);
report.push("");

report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "The same exact shared dependency edge is present in both products."
);
report.push(
  "Topology and loading alone do not imply downstream execution."
);
report.push(
  "Runtime activation is workload-conditioned."
);
report.push(
  "Inactive workloads have A_e=0, q=NA, and pi=0."
);
report.push(
  "For deterministic active perturbations with q=1, pi reduces to the edge activation rate."
);
report.push(
  "This is internal consistency evidence for the decomposition, not independent evidence of real-world security risk."
);

fs.writeFileSync(
  outReport,
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results/onfinished-eefirst-model/onfinished-eefirst-empirical-matrix-report.txt"
);
console.log(
  "  results/onfinished-eefirst-model/onfinished-eefirst-empirical-matrix.csv"
);
console.log(
  "  results/onfinished-eefirst-model/onfinished-eefirst-empirical-matrix.json"
);
