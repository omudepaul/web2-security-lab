#!/usr/bin/env node
"use strict";

/*
  build_multihop_baseline_comparison.js

  Descriptive baseline comparison for the two Morgan multi-hop paths.

  IMPORTANT:
    This is NOT an independent predictive benchmark.
    The context-aware quantities are derived from the same controlled
    experimental data, so this analysis compares representations/model
    structure rather than claiming out-of-sample predictive superiority.

  Baselines compared for path activation:
    B1 Topology-only:
       If the path exists topologically, predict alpha_P = 1.

    B2 Product of pooled marginal edge activation rates:
       alpha_naive = P(edge1 active) * P(edge2 active)

    Proposed representation:
       alpha_joint = directly observed joint path activation.

  Baselines compared for controlled impact:
    B3 Topology + perturbation only:
       For non-baseline perturbations, predict impact rate = 1
       whenever the path exists topologically.

    Proposed context-aware decomposition:
       pi_P = alpha_P * q_P

  Inputs:
    results/multihop-path-activation/
      morgan-multihop-path-activation.json

    results/multihop-path-propagation/
      morgan-multihop-path-propagation.json
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const ACTIVATION_FILE = path.join(
  ROOT,
  "results",
  "multihop-path-activation",
  "morgan-multihop-path-activation.json"
);

const PROPAGATION_FILE = path.join(
  ROOT,
  "results",
  "multihop-path-propagation",
  "morgan-multihop-path-propagation.json"
);

const OUTDIR = path.join(
  ROOT,
  "results",
  "multihop-baseline-comparison"
);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mean(xs) {
  const a = xs.filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function fmt(v, d = 4) {
  if (
    v === null ||
    v === undefined ||
    !Number.isFinite(Number(v))
  ) return "NA";

  return Number(v).toFixed(d);
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";

  const s = String(v);

  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }

  return s;
}

for (const f of [ACTIVATION_FILE, PROPAGATION_FILE]) {
  if (!fs.existsSync(f)) {
    throw new Error(`Required input file not found:\n${f}`);
  }
}

ensureDir(OUTDIR);

const activation = JSON.parse(
  fs.readFileSync(ACTIVATION_FILE, "utf8")
);

const propagation = JSON.parse(
  fs.readFileSync(PROPAGATION_FILE, "utf8")
);

/* ---------------------------------------------------------
   1. Activation baseline comparison
   --------------------------------------------------------- */

const activationTrials = (activation.trials || []).filter(
  (r) => !r.fatalError
);

const pathDefs = {
  PA: {
    label:
      activation.paths?.PA?.label ||
      "morgan@1.12.1 -> debug@2.6.9 -> ms@2.0.0",

    edge1Field:
      "edgeA1_morgan_debug_active",

    edge2Field:
      "edgeA2_debug_ms_active",

    pathField:
      "pathA_joint_active",
  },

  PB: {
    label:
      activation.paths?.PB?.label ||
      "morgan@1.12.1 -> on-finished@2.4.1 -> ee-first@1.1.1",

    edge1Field:
      "edgeB1_morgan_onFinished_active",

    edge2Field:
      "edgeB2_onFinished_eeFirst_active",

    pathField:
      "pathB_joint_active",
  },
};

const activationComparison = [];

for (const [pathId, def] of Object.entries(pathDefs)) {
  const e1 = activationTrials
    .map((r) => Number(r[def.edge1Field]))
    .filter(Number.isFinite);

  const e2 = activationTrials
    .map((r) => Number(r[def.edge2Field]))
    .filter(Number.isFinite);

  const pj = activationTrials
    .map((r) => Number(r[def.pathField]))
    .filter(Number.isFinite);

  const edge1Rate = mean(e1);
  const edge2Rate = mean(e2);
  const jointAlpha = mean(pj);

  const topologyOnly = 1.0;
  const marginalProduct =
    edge1Rate !== null && edge2Rate !== null
      ? edge1Rate * edge2Rate
      : null;

  activationComparison.push({
    pathId,
    path: def.label,
    trials: pj.length,

    observedJointAlpha: jointAlpha,

    topologyOnlyPrediction:
      topologyOnly,

    topologyOnlyAbsoluteError:
      Math.abs(topologyOnly - jointAlpha),

    pooledEdge1Rate:
      edge1Rate,

    pooledEdge2Rate:
      edge2Rate,

    pooledMarginalProductPrediction:
      marginalProduct,

    pooledMarginalProductAbsoluteError:
      marginalProduct !== null
        ? Math.abs(
            marginalProduct -
            jointAlpha
          )
        : null,
  });
}

/* ---------------------------------------------------------
   2. Controlled impact baseline comparison
   --------------------------------------------------------- */

const propSummary =
  propagation.summary || [];

const impactComparison = propSummary
  .filter(
    (r) =>
      r.perturbation !== "BASELINE"
  )
  .map((r) => {
    const observed =
      Number(r.piPathDirect);

    const alpha =
      Number(r.alphaPath);

    const q =
      r.qPathConditionalOnActive === null ||
      r.qPathConditionalOnActive === undefined
        ? null
        : Number(
            r.qPathConditionalOnActive
          );

    const contextAware =
      Number(r.piPathModel);

    // Topology-only + perturbation:
    // because the path exists structurally and a perturbation was selected,
    // this crude baseline predicts impact in all trials.
    const topologyPerturbationPrediction =
      1.0;

    return {
      pathId: r.pathId,
      path: r.path,
      context: r.context,
      perturbation:
        r.perturbation,
      trials: r.trials,

      observedImpactRate:
        observed,

      topologyPerturbationPrediction,

      topologyPerturbationAbsoluteError:
        Math.abs(
          topologyPerturbationPrediction -
          observed
        ),

      alphaPath:
        alpha,

      qPathConditionalOnActive:
        q,

      contextAwarePrediction:
        contextAware,

      contextAwareAbsoluteError:
        Math.abs(
          contextAware -
          observed
        ),
    };
  });

const impactTopologyMAE =
  mean(
    impactComparison.map(
      (r) =>
        r.topologyPerturbationAbsoluteError
    )
  );

const impactContextAwareMAE =
  mean(
    impactComparison.map(
      (r) =>
        r.contextAwareAbsoluteError
    )
  );

const activationTopologyMAE =
  mean(
    activationComparison.map(
      (r) =>
        r.topologyOnlyAbsoluteError
    )
  );

const activationMarginalProductMAE =
  mean(
    activationComparison.map(
      (r) =>
        r.pooledMarginalProductAbsoluteError
    )
  );

/* ---------------------------------------------------------
   3. Write outputs
   --------------------------------------------------------- */

const output = {
  analysis:
    "Multi-hop descriptive baseline comparison",

  caution:
    "This is not an independent predictive benchmark. The context-aware quantities are derived from the same controlled experimental observations. The analysis demonstrates representational/model-structure differences only.",

  activationComparison,

  impactComparison,

  aggregate: {
    activationTopologyMAE,
    activationMarginalProductMAE,
    impactTopologyPerturbationMAE:
      impactTopologyMAE,
    impactContextAwareMAE:
      impactContextAwareMAE,
  },
};

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-baseline-comparison.json"
  ),
  JSON.stringify(
    output,
    null,
    2
  ),
  "utf8"
);

const activationHeaders = [
  "pathId",
  "path",
  "trials",
  "observedJointAlpha",
  "topologyOnlyPrediction",
  "topologyOnlyAbsoluteError",
  "pooledEdge1Rate",
  "pooledEdge2Rate",
  "pooledMarginalProductPrediction",
  "pooledMarginalProductAbsoluteError",
];

const activationCsv = [
  activationHeaders.join(","),
  ...activationComparison.map(
    (r) =>
      activationHeaders
        .map(
          (h) =>
            csvEscape(r[h])
        )
        .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-activation-baseline-comparison.csv"
  ),
  activationCsv,
  "utf8"
);

const impactHeaders = [
  "pathId",
  "path",
  "context",
  "perturbation",
  "trials",
  "observedImpactRate",
  "topologyPerturbationPrediction",
  "topologyPerturbationAbsoluteError",
  "alphaPath",
  "qPathConditionalOnActive",
  "contextAwarePrediction",
  "contextAwareAbsoluteError",
];

const impactCsv = [
  impactHeaders.join(","),
  ...impactComparison.map(
    (r) =>
      impactHeaders
        .map(
          (h) =>
            csvEscape(r[h])
        )
        .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-impact-baseline-comparison.csv"
  ),
  impactCsv,
  "utf8"
);

const report = [];

report.push(
  "MULTI-HOP DESCRIPTIVE BASELINE COMPARISON"
);
report.push(
  "========================================="
);
report.push("");

report.push("IMPORTANT CAUTION");
report.push("-----------------");
report.push(
  "This is NOT an independent predictive benchmark."
);
report.push(
  "The context-aware quantities are derived from the same controlled experimental observations."
);
report.push(
  "Therefore, the comparison demonstrates differences in representation/model structure, not out-of-sample predictive superiority."
);
report.push("");

report.push(
  "A. PATH-ACTIVATION REPRESENTATIONS"
);
report.push(
  "----------------------------------"
);

for (const r of activationComparison) {
  report.push(
    `${r.pathId}: ${r.path}`
  );

  report.push(
    `  observed joint alpha_P=${fmt(r.observedJointAlpha)}`
  );

  report.push(
    `  topology-only prediction=${fmt(r.topologyOnlyPrediction)} absolute error=${fmt(r.topologyOnlyAbsoluteError)}`
  );

  report.push(
    `  pooled marginal product=${fmt(r.pooledMarginalProductPrediction)} absolute error=${fmt(r.pooledMarginalProductAbsoluteError)}`
  );
}

report.push("");
report.push(
  `Activation MAE, topology-only: ${fmt(activationTopologyMAE)}`
);

report.push(
  `Activation MAE, pooled marginal-product: ${fmt(activationMarginalProductMAE)}`
);

report.push("");

report.push(
  "B. CONTROLLED-IMPACT REPRESENTATIONS"
);
report.push(
  "------------------------------------"
);

for (const r of impactComparison) {
  report.push(
    `${r.pathId} | ${r.context} | ${r.perturbation}`
  );

  report.push(
    `  observed impact=${fmt(r.observedImpactRate)}`
  );

  report.push(
    `  topology+perturbation=${fmt(r.topologyPerturbationPrediction)} error=${fmt(r.topologyPerturbationAbsoluteError)}`
  );

  report.push(
    `  context-aware alpha*q=${fmt(r.contextAwarePrediction)} error=${fmt(r.contextAwareAbsoluteError)}`
  );
}

report.push("");
report.push(
  `Impact MAE, topology+perturbation baseline: ${fmt(impactTopologyMAE)}`
);

report.push(
  `Impact MAE, context-aware decomposition: ${fmt(impactContextAwareMAE)}`
);

report.push("");
report.push("INTERPRETATION");
report.push("--------------");

report.push(
  "Topology-only representation overstates activation whenever a structurally present path is inactive at runtime."
);

report.push(
  "Multiplying pooled edge marginals can also misrepresent joint path activation when edges are dependent or contexts are heterogeneous."
);

report.push(
  "For controlled impact, topology plus perturbation alone incorrectly predicts impact in inactive runtime contexts."
);

report.push(
  "The context-aware decomposition preserves the distinction between structural presence, joint runtime activation, and conditional propagation."
);

report.push(
  "Because the same data are used to construct and assess the context-aware quantities, zero error here is an internal consistency result rather than independent predictive validation."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-baseline-comparison-report.txt"
  ),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results/multihop-baseline-comparison/multihop-baseline-comparison-report.txt"
);
console.log(
  "  results/multihop-baseline-comparison/multihop-activation-baseline-comparison.csv"
);
console.log(
  "  results/multihop-baseline-comparison/multihop-impact-baseline-comparison.csv"
);
console.log(
  "  results/multihop-baseline-comparison/multihop-baseline-comparison.json"
);
