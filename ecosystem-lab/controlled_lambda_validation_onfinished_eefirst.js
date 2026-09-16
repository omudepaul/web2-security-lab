#!/usr/bin/env node
"use strict";

/*
  controlled_lambda_validation_onfinished_eefirst.js

  Purpose:
    Validate the OPTIONAL occurrence-rate factor in the current ecosystem model
    using a CONTROLLED, assigned perturbation occurrence probability.

  Target shared edge:
    on-finished@2.4.1 -> ee-first@1.1.1

  IMPORTANT:
    lambda_ctrl below is an experimental injection probability.
    It is NOT a measured natural vulnerability, compromise, or failure rate.

  Existing child experiment reused:
    onfinished_eefirst_shared_edge_perturbation_experiment.js

  Controlled perturbation:
    CORRUPT_ERROR

  Model tested:
    R_ctrl(p,x,s) ~= lambda_ctrl * alpha(p,x) * q(p,x,s)

  where:
    lambda_ctrl = assigned perturbation occurrence probability
    alpha       = observed edge activation probability/rate
    q           = observed impact conditional on perturbation + activation
    R_ctrl      = observed impacted-trial rate
*/

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = __dirname;

const CHILD_SCRIPT = path.join(
  ROOT,
  "onfinished_eefirst_shared_edge_perturbation_experiment.js"
);

const OUTDIR = path.join(
  ROOT,
  "results",
  "controlled-lambda-validation"
);

const LAMBDAS = [0.00, 0.25, 0.50, 0.75, 1.00];
const REPETITIONS = 20;
const SEED = 20260914;

const WORKLOADS = [
  {
    productId: "P1",
    product: "Express",
    workload: "EXPRESS_SIMPLE_SEND",
    expectedActivation: 0,
  },
  {
    productId: "P1",
    product: "Express",
    workload: "EXPRESS_SEND_FILE",
    expectedActivation: 1,
  },
  {
    productId: "P3",
    product: "Morgan",
    workload: "MORGAN_NORMAL_REQUEST",
    expectedActivation: 1,
  },
  {
    productId: "P3",
    product: "Morgan",
    workload: "MORGAN_IMMEDIATE_REQUEST",
    expectedActivation: 0,
  },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
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

// Deterministic LCG for reproducibility.
function makeRng(seed) {
  let state = seed >>> 0;

  return function rng() {
    state = (
      Math.imul(1664525, state) + 1013904223
    ) >>> 0;

    return state / 4294967296;
  };
}

function mean(xs) {
  const a = xs.filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function runChild(productId, workload, inject) {
  const perturbation = inject
    ? "CORRUPT_ERROR"
    : "BASELINE";

  const child = spawnSync(
    process.execPath,
    [
      CHILD_SCRIPT,
      "--child",
      productId,
      workload,
      perturbation,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    }
  );

  if (child.error) {
    return {
      fatalError: {
        name: child.error.name,
        message: child.error.message,
      },
      childStderr: child.stderr || "",
    };
  }

  let parsed;

  try {
    parsed = JSON.parse(child.stdout || "{}");
  } catch (err) {
    return {
      fatalError: {
        name: "ParseError",
        message: err.message,
      },
      childStdout: child.stdout || "",
      childStderr: child.stderr || "",
    };
  }

  if (child.stderr && child.stderr.trim()) {
    parsed.childStderr = child.stderr.trim();
  }

  return parsed;
}

function summarize(rows) {
  const valid = rows.filter((r) => !r.fatalError);

  const n = valid.length;
  const injected = valid.filter((r) => r.injected).length;
  const active = valid.filter((r) => r.edgeActivated).length;

  const activeInjected = valid.filter(
    (r) => r.injected && r.edgeActivated
  ).length;

  const impacted = valid.filter(
    (r) => r.impactObserved
  ).length;

  const lambdaHat = n ? injected / n : null;
  const alphaHat = n ? active / n : null;

  const qHat = activeInjected
    ? impacted / activeInjected
    : null;

  const observedImpactRate = n
    ? impacted / n
    : null;

  const factorizedPrediction =
    lambdaHat !== null &&
    alphaHat !== null &&
    qHat !== null
      ? lambdaHat * alphaHat * qHat
      : 0;

  const jointExposureRate = n
    ? activeInjected / n
    : null;

  const jointPrediction =
    jointExposureRate !== null &&
    qHat !== null
      ? jointExposureRate * qHat
      : 0;

  return {
    trials: n,
    injectedTrials: injected,
    activeTrials: active,
    activeInjectedTrials: activeInjected,
    impactedTrials: impacted,

    lambdaHat,
    alphaHat,
    qHat,
    observedImpactRate,

    factorizedPrediction,
    factorizationAbsoluteError:
      observedImpactRate !== null
        ? Math.abs(
            observedImpactRate - factorizedPrediction
          )
        : null,

    jointExposureRate,
    jointPrediction,
    jointAbsoluteError:
      observedImpactRate !== null
        ? Math.abs(
            observedImpactRate - jointPrediction
          )
        : null,
  };
}

if (!fs.existsSync(CHILD_SCRIPT)) {
  throw new Error(
    `Required child script not found:\n${CHILD_SCRIPT}`
  );
}

ensureDir(OUTDIR);

const rng = makeRng(SEED);
const rows = [];

for (const lambdaCtrl of LAMBDAS) {
  for (const w of WORKLOADS) {
    for (
      let repetition = 1;
      repetition <= REPETITIONS;
      repetition++
    ) {
      const u = rng();
      const injected = u < lambdaCtrl;

      const childResult = runChild(
        w.productId,
        w.workload,
        injected
      );

      const edgeActivated =
        !childResult.fatalError &&
        !!childResult.edgeActivated;

      const impactObserved =
        injected &&
        edgeActivated &&
        Number(
          childResult.controlledErrorsSeenByParent || 0
        ) > 0;

      rows.push({
        lambdaCtrl,
        seed: SEED,
        repetition,

        productId: w.productId,
        product: w.product,
        workload: w.workload,
        expectedActivation:
          w.expectedActivation,

        randomDraw: u,
        injected,
        perturbation: injected
          ? "CORRUPT_ERROR"
          : "BASELINE",

        edgeActivated,
        controlledErrorsSeenByParent:
          childResult.controlledErrorsSeenByParent ?? null,

        parentCallbackObserved:
          childResult.parentCallbackObserved ?? null,

        statusCode:
          childResult.outcome?.statusCode ?? null,

        impactObserved,

        fatalError:
          childResult.fatalError || null,
      });
    }
  }
}

const workloadSummaries = [];

for (const lambdaCtrl of LAMBDAS) {
  for (const w of WORKLOADS) {
    const group = rows.filter(
      (r) =>
        r.lambdaCtrl === lambdaCtrl &&
        r.productId === w.productId &&
        r.workload === w.workload
    );

    workloadSummaries.push({
      lambdaCtrl,
      productId: w.productId,
      product: w.product,
      workload: w.workload,
      expectedActivation:
        w.expectedActivation,
      ...summarize(group),
    });
  }
}

const aggregateSummaries = [];

for (const lambdaCtrl of LAMBDAS) {
  const group = rows.filter(
    (r) => r.lambdaCtrl === lambdaCtrl
  );

  aggregateSummaries.push({
    lambdaCtrl,
    ...summarize(group),
  });
}

const nonzeroAggregate =
  aggregateSummaries.filter(
    (x) => x.lambdaCtrl > 0
  );

const factorizationMAE = mean(
  nonzeroAggregate.map(
    (x) => x.factorizationAbsoluteError
  )
);

const jointMAE = mean(
  nonzeroAggregate.map(
    (x) => x.jointAbsoluteError
  )
);

const fatalCount = rows.filter(
  (r) => r.fatalError
).length;

const output = {
  targetEdge:
    "on-finished@2.4.1 -> ee-first@1.1.1",

  controlledPerturbation:
    "CORRUPT_ERROR",

  importantCaution:
    "lambdaCtrl is an assigned experimental perturbation occurrence probability. It is not a natural vulnerability, compromise, or failure rate.",

  model:
    "R_ctrl(p,x,s) ~= lambda_ctrl * alpha(p,x) * q(p,x,s)",

  lambdas: LAMBDAS,
  repetitionsPerWorkloadLambda:
    REPETITIONS,
  seed: SEED,

  rows,
  workloadSummaries,
  aggregateSummaries,

  validation: {
    fatalTrials: fatalCount,
    aggregateFactorizationMAE:
      factorizationMAE,
    aggregateJointExposureMAE:
      jointMAE,
  },
};

fs.writeFileSync(
  path.join(
    OUTDIR,
    "controlled-lambda-validation.json"
  ),
  JSON.stringify(output, null, 2),
  "utf8"
);

const rowHeaders = [
  "lambdaCtrl",
  "repetition",
  "productId",
  "product",
  "workload",
  "expectedActivation",
  "randomDraw",
  "injected",
  "perturbation",
  "edgeActivated",
  "controlledErrorsSeenByParent",
  "parentCallbackObserved",
  "statusCode",
  "impactObserved",
];

const rowCsv = [
  rowHeaders.join(","),
  ...rows.map((r) =>
    rowHeaders
      .map((h) => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "controlled-lambda-validation-trials.csv"
  ),
  rowCsv,
  "utf8"
);

const summaryHeaders = [
  "lambdaCtrl",
  "productId",
  "product",
  "workload",
  "expectedActivation",
  "trials",
  "injectedTrials",
  "activeTrials",
  "activeInjectedTrials",
  "impactedTrials",
  "lambdaHat",
  "alphaHat",
  "qHat",
  "observedImpactRate",
  "factorizedPrediction",
  "factorizationAbsoluteError",
  "jointExposureRate",
  "jointPrediction",
  "jointAbsoluteError",
];

const summaryCsv = [
  summaryHeaders.join(","),
  ...workloadSummaries.map((r) =>
    summaryHeaders
      .map((h) => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "controlled-lambda-validation-summary.csv"
  ),
  summaryCsv,
  "utf8"
);

const report = [];

report.push(
  "CONTROLLED OCCURRENCE-RATE (lambda_ctrl) VALIDATION"
);
report.push(
  "=================================================="
);
report.push("");

report.push(
  "Target edge: on-finished@2.4.1 -> ee-first@1.1.1"
);
report.push(
  "Controlled perturbation: CORRUPT_ERROR"
);
report.push(
  `Repetitions per workload/lambda: ${REPETITIONS}`
);
report.push(
  `Reproducible PRNG seed: ${SEED}`
);
report.push("");

report.push("MODEL");
report.push("-----");
report.push(
  "R_ctrl(p,x,s) ~= lambda_ctrl * alpha(p,x) * q(p,x,s)"
);
report.push("");
report.push(
  "lambda_ctrl : assigned experimental perturbation occurrence probability"
);
report.push(
  "alpha       : observed edge activation rate"
);
report.push(
  "q           : observed impact conditional on injection + activation"
);
report.push(
  "R_ctrl      : observed impacted-trial rate"
);
report.push("");
report.push(
  "IMPORTANT: lambda_ctrl is NOT a measured natural failure, vulnerability, or compromise rate."
);
report.push("");

report.push("WORKLOAD-LEVEL RESULTS");
report.push("----------------------");

for (const s of workloadSummaries) {
  report.push(
    `lambda=${fmt(s.lambdaCtrl, 2)} | ` +
    `${s.productId} ${s.workload}`
  );

  report.push(
    `  n=${s.trials} ` +
    `injected=${s.injectedTrials} ` +
    `active=${s.activeTrials} ` +
    `active&injected=${s.activeInjectedTrials} ` +
    `impacted=${s.impactedTrials}`
  );

  report.push(
    `  lambda_hat=${fmt(s.lambdaHat)} ` +
    `alpha_hat=${fmt(s.alphaHat)} ` +
    `q_hat=${fmt(s.qHat)} ` +
    `R_observed=${fmt(s.observedImpactRate)} ` +
    `lambda*alpha*q=${fmt(s.factorizedPrediction)}`
  );
}

report.push("");
report.push("ECOSYSTEM-AGGREGATE RESULTS");
report.push("---------------------------");

for (const s of aggregateSummaries) {
  report.push(
    `lambda=${fmt(s.lambdaCtrl, 2)} | ` +
    `n=${s.trials} ` +
    `lambda_hat=${fmt(s.lambdaHat)} ` +
    `alpha_hat=${fmt(s.alphaHat)} ` +
    `q_hat=${fmt(s.qHat)} ` +
    `R_observed=${fmt(s.observedImpactRate)} ` +
    `lambda*alpha*q=${fmt(s.factorizedPrediction)} ` +
    `abs_error=${fmt(s.factorizationAbsoluteError)}`
  );
}

report.push("");
report.push("VALIDATION SUMMARY");
report.push("------------------");
report.push(
  `Fatal trials: ${fatalCount}`
);
report.push(
  `Aggregate MAE for lambda_hat * alpha_hat * q_hat: ${fmt(factorizationMAE)}`
);
report.push(
  `Aggregate MAE using directly observed joint activation+injection exposure: ${fmt(jointMAE)}`
);
report.push("");

report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "This experiment operationalizes the advisor-requested failure/occurrence-rate term as a CONTROLLED injection probability."
);
report.push(
  "It tests whether observed controlled impact frequency follows the multiplicative structure lambda_ctrl * alpha * q."
);
report.push(
  "Inactive workloads should remain unimpacted even when perturbations are assigned, because alpha=0."
);
report.push(
  "Active workloads should show impact only on injected trials, with q near 1 for this deterministic corruption mechanism."
);
report.push(
  "The experiment validates model structure only; it does not estimate real-world incident frequency."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "controlled-lambda-validation-report.txt"
  ),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results/controlled-lambda-validation/controlled-lambda-validation-report.txt"
);
console.log(
  "  results/controlled-lambda-validation/controlled-lambda-validation-summary.csv"
);
console.log(
  "  results/controlled-lambda-validation/controlled-lambda-validation-trials.csv"
);
console.log(
  "  results/controlled-lambda-validation/controlled-lambda-validation.json"
);
