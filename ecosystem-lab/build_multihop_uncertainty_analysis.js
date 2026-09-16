#!/usr/bin/env node
"use strict";

/*
  build_multihop_uncertainty_analysis.js

  Adds statistical uncertainty to the multi-hop controlled-lambda results.

  Reads:
    results/multihop-controlled-lambda-validation/
      multihop-controlled-lambda-validation.json

  Produces 95% Wilson confidence intervals for binomial proportions:
    - lambda_hat
    - alpha_P
    - q_P
    - observed impact rate R_obs

  IMPORTANT:
    These intervals quantify sampling uncertainty in the controlled experiment.
    They do NOT turn lambda_ctrl into a natural real-world failure probability.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const INPUT = path.join(
  ROOT,
  "results",
  "multihop-controlled-lambda-validation",
  "multihop-controlled-lambda-validation.json"
);

const OUTDIR = path.join(
  ROOT,
  "results",
  "multihop-uncertainty-analysis"
);

const Z = 1.959963984540054; // 95%

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function wilson(successes, n, z = Z) {
  if (
    successes === null ||
    successes === undefined ||
    n === null ||
    n === undefined ||
    n <= 0
  ) {
    return {
      estimate: null,
      lower: null,
      upper: null,
      n: n ?? null,
      successes: successes ?? null,
    };
  }

  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;

  const center =
    (phat + z2 / (2 * n)) / denom;

  const half =
    (z / denom) *
    Math.sqrt(
      (phat * (1 - phat) / n) +
      (z2 / (4 * n * n))
    );

  return {
    estimate: phat,
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
    n,
    successes,
  };
}

function fmt(v, d = 4) {
  if (
    v === null ||
    v === undefined ||
    !Number.isFinite(Number(v))
  ) {
    return "NA";
  }
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

if (!fs.existsSync(INPUT)) {
  throw new Error(
    `Input file not found:\n${INPUT}`
  );
}

ensureDir(OUTDIR);

const data = JSON.parse(
  fs.readFileSync(INPUT, "utf8")
);

const rows = [];

for (const r of data.contextSummaries || []) {
  const lambdaCI = wilson(
    Number(r.injectedTrials || 0),
    Number(r.trials || 0)
  );

  const alphaCI = wilson(
    Number(r.pathActiveTrials || 0),
    Number(r.trials || 0)
  );

  const qCI =
    Number(r.activeInjectedTrials || 0) > 0
      ? wilson(
          Number(r.impactedTrials || 0),
          Number(r.activeInjectedTrials || 0)
        )
      : {
          estimate: null,
          lower: null,
          upper: null,
          n: 0,
          successes: 0,
        };

  const impactCI = wilson(
    Number(r.impactedTrials || 0),
    Number(r.trials || 0)
  );

  rows.push({
    pathId: r.pathId,
    path: r.path,
    lambdaCtrl: r.lambdaCtrl,
    contextClass: r.contextClass,
    context: r.context,
    trials: r.trials,

    lambdaHat: lambdaCI.estimate,
    lambdaLower95: lambdaCI.lower,
    lambdaUpper95: lambdaCI.upper,

    alphaPathHat: alphaCI.estimate,
    alphaLower95: alphaCI.lower,
    alphaUpper95: alphaCI.upper,

    qPathHat: qCI.estimate,
    qLower95: qCI.lower,
    qUpper95: qCI.upper,
    qDenominator: qCI.n,

    observedImpactRate: impactCI.estimate,
    impactLower95: impactCI.lower,
    impactUpper95: impactCI.upper,
  });
}

const headers = [
  "pathId",
  "path",
  "lambdaCtrl",
  "contextClass",
  "context",
  "trials",

  "lambdaHat",
  "lambdaLower95",
  "lambdaUpper95",

  "alphaPathHat",
  "alphaLower95",
  "alphaUpper95",

  "qPathHat",
  "qLower95",
  "qUpper95",
  "qDenominator",

  "observedImpactRate",
  "impactLower95",
  "impactUpper95",
];

const csv = [
  headers.join(","),
  ...rows.map((r) =>
    headers
      .map((h) => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-uncertainty-summary.csv"
  ),
  csv,
  "utf8"
);

const output = {
  experiment:
    "Multi-hop controlled-lambda uncertainty analysis",
  confidenceLevel: 0.95,
  method:
    "Wilson score interval for binomial proportions",
  input: path.relative(ROOT, INPUT),
  caution:
    "Intervals quantify sampling uncertainty in the controlled experiment only. lambda_ctrl remains an assigned experimental injection probability, not a natural failure/compromise/incident rate.",
  rows,
};

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-uncertainty-analysis.json"
  ),
  JSON.stringify(output, null, 2),
  "utf8"
);

const report = [];

report.push(
  "MULTI-HOP CONTROLLED-LAMBDA UNCERTAINTY ANALYSIS"
);
report.push(
  "================================================"
);
report.push("");

report.push("METHOD");
report.push("------");
report.push(
  "95% Wilson score confidence intervals for binomial proportions."
);
report.push("");
report.push(
  "Intervals are reported for lambda_hat, joint path activation alpha_P, conditional propagation q_P, and observed impact rate R_obs."
);
report.push("");
report.push(
  "IMPORTANT: these intervals quantify sampling uncertainty in the controlled experiment only."
);
report.push(
  "They do NOT estimate a natural real-world vulnerability, compromise, incident, or failure probability."
);
report.push("");

for (const pathId of ["PA", "PB"]) {
  const subset = rows.filter(
    (r) => r.pathId === pathId
  );

  if (!subset.length) continue;

  report.push(
    `${pathId}: ${subset[0].path}`
  );
  report.push(
    "-".repeat(
      Math.min(
        78,
        `${pathId}: ${subset[0].path}`.length
      )
    )
  );

  for (const r of subset) {
    report.push(
      `lambda_ctrl=${fmt(r.lambdaCtrl, 2)} | ${r.contextClass} | ${r.context}`
    );

    report.push(
      `  lambda_hat=${fmt(r.lambdaHat)} 95% CI [${fmt(r.lambdaLower95)}, ${fmt(r.lambdaUpper95)}]`
    );

    report.push(
      `  alpha_P=${fmt(r.alphaPathHat)} 95% CI [${fmt(r.alphaLower95)}, ${fmt(r.alphaUpper95)}]`
    );

    report.push(
      `  q_P=${fmt(r.qPathHat)} 95% CI [${fmt(r.qLower95)}, ${fmt(r.qUpper95)}] n_active_injected=${r.qDenominator}`
    );

    report.push(
      `  R_obs=${fmt(r.observedImpactRate)} 95% CI [${fmt(r.impactLower95)}, ${fmt(r.impactUpper95)}]`
    );
  }

  report.push("");
}

report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "Point estimates such as q_P=1.0000 should not be interpreted as certainty."
);
report.push(
  "With small samples, the confidence interval remains wider even when every observed active/injected trial is impacted."
);
report.push(
  "This analysis therefore makes the controlled path results statistically more defensible and explicitly exposes sample-size uncertainty."
);
report.push(
  "Increasing repetitions in future experiments will narrow these intervals if the underlying behavior remains stable."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-uncertainty-analysis-report.txt"
  ),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results/multihop-uncertainty-analysis/multihop-uncertainty-analysis-report.txt"
);
console.log(
  "  results/multihop-uncertainty-analysis/multihop-uncertainty-summary.csv"
);
console.log(
  "  results/multihop-uncertainty-analysis/multihop-uncertainty-analysis.json"
);
