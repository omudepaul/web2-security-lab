#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const unifiedFile = path.join(
  ROOT,
  "results",
  "unified-ecosystem-model",
  "unified-ecosystem-node-edge-model.json"
);

const lambdaFile = path.join(
  ROOT,
  "results",
  "controlled-lambda-validation",
  "controlled-lambda-validation.json"
);

const OUTDIR = path.join(
  ROOT,
  "results",
  "context-stratified-ecosystem-model"
);

function mustReadJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required file not found:\n${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mean(values) {
  const xs = values.filter(
    (v) => typeof v === "number" && Number.isFinite(v)
  );
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function fmt(v, digits = 4) {
  if (
    v === null ||
    v === undefined ||
    !Number.isFinite(Number(v))
  ) {
    return "NA";
  }
  return Number(v).toFixed(digits);
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

ensureDir(OUTDIR);

const unified = mustReadJson(unifiedFile);
const lambdaData = mustReadJson(lambdaFile);

const workloadSummaries =
  lambdaData.workloadSummaries || [];

const aggregateSummaries =
  lambdaData.aggregateSummaries || [];

if (!workloadSummaries.length) {
  throw new Error(
    "controlled-lambda-validation.json contains no workloadSummaries."
  );
}

if (!aggregateSummaries.length) {
  throw new Error(
    "controlled-lambda-validation.json contains no aggregateSummaries."
  );
}

const lambdas = [
  ...new Set(
    workloadSummaries.map((x) => Number(x.lambdaCtrl))
  ),
].sort((a, b) => a - b);

const validationRows = [];

for (const lambdaCtrl of lambdas) {
  const contexts = workloadSummaries.filter(
    (x) => Number(x.lambdaCtrl) === lambdaCtrl
  );

  if (!contexts.length) continue;

  const weight = 1 / contexts.length;

  const contextProducts = contexts.map((x) => {
    const lambdaHat =
      Number.isFinite(Number(x.lambdaHat))
        ? Number(x.lambdaHat)
        : 0;

    const alphaHat =
      Number.isFinite(Number(x.alphaHat))
        ? Number(x.alphaHat)
        : 0;

    const qHat =
      Number.isFinite(Number(x.qHat))
        ? Number(x.qHat)
        : 0;

    const observedImpact =
      Number.isFinite(Number(x.observedImpactRate))
        ? Number(x.observedImpactRate)
        : 0;

    return {
      productId: x.productId,
      product: x.product,
      workload: x.workload,
      weight,
      lambdaHat,
      alphaHat,
      qHat,
      contextProduct:
        lambdaHat * alphaHat * qHat,
      observedImpactRate: observedImpact,
    };
  });

  const stratifiedPrediction =
    contextProducts.reduce(
      (sum, x) =>
        sum + x.weight * x.contextProduct,
      0
    );

  const aggregate = aggregateSummaries.find(
    (x) => Number(x.lambdaCtrl) === lambdaCtrl
  );

  const globalProductPrediction =
    aggregate &&
    Number.isFinite(
      Number(aggregate.factorizedPrediction)
    )
      ? Number(aggregate.factorizedPrediction)
      : null;

  const aggregateObserved =
    aggregate &&
    Number.isFinite(
      Number(aggregate.observedImpactRate)
    )
      ? Number(aggregate.observedImpactRate)
      : contextProducts.reduce(
          (sum, x) =>
            sum + x.weight * x.observedImpactRate,
          0
        );

  validationRows.push({
    lambdaCtrl,
    contextCount: contexts.length,
    equalWeight: weight,

    stratifiedPrediction,
    observedImpactRate: aggregateObserved,
    stratifiedAbsoluteError:
      Math.abs(
        stratifiedPrediction - aggregateObserved
      ),

    globalProductPrediction,
    globalProductAbsoluteError:
      globalProductPrediction === null
        ? null
        : Math.abs(
            globalProductPrediction -
            aggregateObserved
          ),

    contexts: contextProducts,
  });
}

const nonzeroRows = validationRows.filter(
  (x) => x.lambdaCtrl > 0
);

const stratifiedMAE = mean(
  nonzeroRows.map(
    (x) => x.stratifiedAbsoluteError
  )
);

const globalProductMAE = mean(
  nonzeroRows
    .map((x) => x.globalProductAbsoluteError)
    .filter((x) => x !== null)
);

const formalExtension = {
  modelName:
    "Context-Stratified OSS Ecosystem Propagation Model",

  baseModel:
    unified.formalModel || null,

  componentLevel: {
    topology:
      "T_c(p) in {0,1}",
    activation:
      "alpha_c(p,x) = P(A_c=1 | T_c(p)=1, x)",
    conditionalPropagation:
      "q_c(p,x,s) = P(I_c=1 | A_c=1, p, x, s)",
    controlledImpact:
      "pi_c(p,x,s) = alpha_c(p,x) * q_c(p,x,s)",
    occurrenceWeightedImpact:
      "R_c(p,x,s) = lambda_c(p,x,s) * alpha_c(p,x) * q_c(p,x,s)",
  },

  ecosystemAggregation: {
    equation:
      "R_E(c,s) = sum_{p,x} w_{p,x} * lambda_c(p,x,s) * alpha_c(p,x) * q_c(p,x,s)",
    weightConstraint:
      "sum_{p,x} w_{p,x} = 1",
    interpretation:
      "w_{p,x} represents the share/probability of execution context (p,x) in the ecosystem population of interest.",
  },

  keyStatisticalPoint:
    "In general, E[lambda * alpha * q] is not equal to E[lambda] * E[alpha] * E[q]. Context-stratified aggregation avoids an independence assumption that may be false.",

  currentWeighting:
    "Equal weights across the four tested product-workload contexts are used only for the controlled validation. Real deployment weights should come from defensible workload/telemetry data.",

  lambdaCaution:
    "The current lambda_ctrl is experimentally assigned. It is not a measured natural failure, vulnerability, compromise, or incident rate.",
};

const result = {
  formalExtension,
  validation: {
    targetEdge:
      lambdaData.targetEdge,
    controlledPerturbation:
      lambdaData.controlledPerturbation,
    validationRows,
    nonzeroLambdaStratifiedMAE:
      stratifiedMAE,
    nonzeroLambdaGlobalProductMAE:
      globalProductMAE,
  },
};

fs.writeFileSync(
  path.join(
    OUTDIR,
    "context-stratified-ecosystem-model.json"
  ),
  JSON.stringify(result, null, 2),
  "utf8"
);

const summaryHeaders = [
  "lambdaCtrl",
  "contextCount",
  "equalWeight",
  "stratifiedPrediction",
  "observedImpactRate",
  "stratifiedAbsoluteError",
  "globalProductPrediction",
  "globalProductAbsoluteError",
];

const summaryCsv = [
  summaryHeaders.join(","),
  ...validationRows.map((r) =>
    summaryHeaders
      .map((h) => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "context-stratified-validation-summary.csv"
  ),
  summaryCsv,
  "utf8"
);

const contextHeaders = [
  "lambdaCtrl",
  "productId",
  "product",
  "workload",
  "weight",
  "lambdaHat",
  "alphaHat",
  "qHat",
  "contextProduct",
  "observedImpactRate",
];

const contextCsvRows = [];

for (const r of validationRows) {
  for (const c of r.contexts) {
    contextCsvRows.push({
      lambdaCtrl: r.lambdaCtrl,
      ...c,
    });
  }
}

const contextCsv = [
  contextHeaders.join(","),
  ...contextCsvRows.map((r) =>
    contextHeaders
      .map((h) => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "context-stratified-validation-contexts.csv"
  ),
  contextCsv,
  "utf8"
);

const report = [];

report.push(
  "CONTEXT-STRATIFIED OSS ECOSYSTEM PROPAGATION MODEL"
);
report.push(
  "=================================================="
);
report.push("");

report.push("WHY THE MODEL IS BEING REFINED");
report.push("------------------------------");
report.push(
  "The controlled-lambda experiment showed that multiplying ecosystem-wide average lambda, average alpha, and average q can introduce aggregation error."
);
report.push(
  "The reason is that activation and perturbation exposure differ by product/workload context."
);
report.push("");

report.push("CORRECT COMPONENT-LEVEL MODEL");
report.push("-----------------------------");
report.push(
  "R_c(p,x,s) = lambda_c(p,x,s) * alpha_c(p,x) * q_c(p,x,s)"
);
report.push("");

report.push("CORRECT ECOSYSTEM AGGREGATION");
report.push("-----------------------------");
report.push(
  "R_E(c,s) = sum_{p,x} w_{p,x} * lambda_c(p,x,s) * alpha_c(p,x) * q_c(p,x,s)"
);
report.push(
  "subject to: sum_{p,x} w_{p,x} = 1"
);
report.push("");
report.push(
  "w_{p,x} is the relative frequency/probability of execution context (product p, context x)."
);
report.push("");

report.push("STATISTICAL CAUTION");
report.push("-------------------");
report.push(
  "In general:"
);
report.push(
  "  E[lambda * alpha * q] != E[lambda] * E[alpha] * E[q]"
);
report.push(
  "unless additional independence/homogeneity assumptions are justified."
);
report.push("");

report.push("CONTROLLED VALIDATION");
report.push("---------------------");
report.push(
  `Target edge: ${lambdaData.targetEdge}`
);
report.push(
  `Perturbation: ${lambdaData.controlledPerturbation}`
);
report.push(
  "Equal context weights are used for this controlled validation only."
);
report.push("");

for (const r of validationRows) {
  report.push(
    `lambda_ctrl=${fmt(r.lambdaCtrl, 2)}`
  );
  report.push(
    `  observed ecosystem impact rate: ${fmt(r.observedImpactRate)}`
  );
  report.push(
    `  context-stratified prediction: ${fmt(r.stratifiedPrediction)}`
  );
  report.push(
    `  stratified abs. error: ${fmt(r.stratifiedAbsoluteError)}`
  );
  report.push(
    `  product-of-global-averages prediction: ${fmt(r.globalProductPrediction)}`
  );
  report.push(
    `  global-product abs. error: ${fmt(r.globalProductAbsoluteError)}`
  );
}

report.push("");
report.push("VALIDATION SUMMARY");
report.push("------------------");
report.push(
  `MAE of context-stratified model for nonzero lambda: ${fmt(stratifiedMAE)}`
);
report.push(
  `MAE of product-of-global-averages model for nonzero lambda: ${fmt(globalProductMAE)}`
);
report.push("");

report.push("RESEARCH INTERPRETATION");
report.push("-----------------------");
report.push(
  "The component-level multiplicative structure remains useful, but ecosystem aggregation should preserve product/workload context before averaging."
);
report.push(
  "This avoids silently assuming that occurrence, activation, and propagation are independent across heterogeneous contexts."
);
report.push(
  "Future deployment weights w_{p,x} should come from real workload frequencies or telemetry, not arbitrary equal weighting."
);
report.push(
  "The controlled experiment validates mathematical structure only; it does not estimate natural real-world incident probability."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "context-stratified-ecosystem-model-report.txt"
  ),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results/context-stratified-ecosystem-model/context-stratified-ecosystem-model-report.txt"
);
console.log(
  "  results/context-stratified-ecosystem-model/context-stratified-validation-summary.csv"
);
console.log(
  "  results/context-stratified-ecosystem-model/context-stratified-validation-contexts.csv"
);
console.log(
  "  results/context-stratified-ecosystem-model/context-stratified-ecosystem-model.json"
);
