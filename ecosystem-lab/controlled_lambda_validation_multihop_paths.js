#!/usr/bin/env node
"use strict";

/*
  controlled_lambda_validation_multihop_paths.js

  Validates the controlled occurrence-rate term at the MULTI-HOP PATH level
  for two real Morgan dependency paths:

    PA:
      morgan@1.12.1
        -> debug@2.6.9
        -> ms@2.0.0

    PB:
      morgan@1.12.1
        -> on-finished@2.4.1
        -> ee-first@1.1.1

  Controlled path model:

    R_P,ctrl(p,x,s)
      = lambda_P,ctrl * alpha_P(p,x) * q_P(p,x,s)

  where:
    lambda_P,ctrl = assigned perturbation injection probability
    alpha_P       = JOINT path activation rate
    q_P           = impact conditional on full path activation + injection

  IMPORTANT:
    lambda_P,ctrl is experimental only.
    It is NOT a measured natural vulnerability, compromise, incident,
    or failure probability.
*/

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = __dirname;

const DEBUG_CHILD = path.join(
  ROOT,
  "debug_ms_shared_edge_perturbation_experiment.js"
);

const ONFINISHED_CHILD = path.join(
  ROOT,
  "onfinished_eefirst_shared_edge_perturbation_experiment.js"
);

const OUTDIR = path.join(
  ROOT,
  "results",
  "multihop-controlled-lambda-validation"
);

const LAMBDAS = [0.00, 0.25, 0.50, 0.75, 1.00];
const REPS = 20;
const SEED = 20260916;

const PATHS = [
  {
    pathId: "PA",
    label:
      "morgan@1.12.1 -> debug@2.6.9 -> ms@2.0.0",
    activeContext: "ACTIVE_COLORS_ON",
    inactiveContext: "INACTIVE_COLORS_OFF",
    perturbation: "CORRUPT_HUMANIZE",
    script: DEBUG_CHILD,
  },
  {
    pathId: "PB",
    label:
      "morgan@1.12.1 -> on-finished@2.4.1 -> ee-first@1.1.1",
    activeContext: "MORGAN_NORMAL_REQUEST",
    inactiveContext: "MORGAN_IMMEDIATE_REQUEST",
    perturbation: "CORRUPT_ERROR",
    script: ONFINISHED_CHILD,
  },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function makeRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (
      Math.imul(1664525, state) + 1013904223
    ) >>> 0;
    return state / 4294967296;
  };
}

function fmt(v, d = 4) {
  if (
    v === null ||
    v === undefined ||
    !Number.isFinite(Number(v))
  ) return "NA";
  return Number(v).toFixed(d);
}

function mean(xs) {
  const a = xs.filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function runChild(script, args) {
  const child = spawnSync(
    process.execPath,
    [script, "--child", ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    }
  );

  if (child.error) {
    return {
      fatalError: {
        name: child.error.name,
        message: child.error.message,
      },
    };
  }

  try {
    return JSON.parse(child.stdout || "{}");
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
}

function executeTrial(def, context, inject) {
  const perturbation = inject
    ? def.perturbation
    : "BASELINE";

  const raw = runChild(
    def.script,
    ["P3", context, perturbation]
  );

  if (raw.fatalError) {
    return {
      pathId: def.pathId,
      path: def.label,
      context,
      perturbation,
      injected: inject,
      fatalError: raw.fatalError,
    };
  }

  let edge1Active = 0;
  let edge2Active = 0;
  let impactObserved = false;

  if (def.pathId === "PA") {
    edge1Active =
      raw.parentDebugCalled ? 1 : 0;

    edge2Active =
      raw.edgeActivated ? 1 : 0;

    impactObserved =
      inject &&
      edge1Active &&
      edge2Active &&
      Number(raw.alteredMsCalls || 0) > 0;
  }

  if (def.pathId === "PB") {
    edge1Active =
      raw.onFinishedInvoked ? 1 : 0;

    edge2Active =
      raw.edgeActivated ? 1 : 0;

    impactObserved =
      inject &&
      edge1Active &&
      edge2Active &&
      Number(
        raw.controlledErrorsSeenByParent || 0
      ) > 0;
  }

  const pathActive =
    edge1Active && edge2Active ? 1 : 0;

  return {
    pathId: def.pathId,
    path: def.label,
    context,
    perturbation,
    injected: inject,

    edge1Active,
    edge2Active,
    pathActive,

    impactObserved:
      impactObserved ? 1 : 0,

    statusCode:
      raw.outcome?.statusCode ?? null,
  };
}

function summarize(rows) {
  const valid = rows.filter(
    (r) => !r.fatalError
  );

  const n = valid.length;

  const injectedTrials =
    valid.filter(
      (r) => r.injected
    ).length;

  const pathActiveTrials =
    valid.filter(
      (r) => r.pathActive
    ).length;

  const activeInjectedTrials =
    valid.filter(
      (r) =>
        r.injected &&
        r.pathActive
    ).length;

  const impactedTrials =
    valid.filter(
      (r) => r.impactObserved
    ).length;

  const lambdaHat =
    n ? injectedTrials / n : null;

  const alphaPathHat =
    n ? pathActiveTrials / n : null;

  const qPathHat =
    activeInjectedTrials
      ? impactedTrials /
        activeInjectedTrials
      : null;

  const observedImpactRate =
    n ? impactedTrials / n : null;

  const modelPrediction =
    lambdaHat !== null &&
    alphaPathHat !== null &&
    qPathHat !== null
      ? lambdaHat *
        alphaPathHat *
        qPathHat
      : 0;

  const jointExposureRate =
    n
      ? activeInjectedTrials / n
      : null;

  const jointPrediction =
    jointExposureRate !== null &&
    qPathHat !== null
      ? jointExposureRate * qPathHat
      : 0;

  return {
    trials: n,
    injectedTrials,
    pathActiveTrials,
    activeInjectedTrials,
    impactedTrials,

    lambdaHat,
    alphaPathHat,
    qPathHat,
    observedImpactRate,

    modelPrediction,
    modelAbsoluteError:
      observedImpactRate !== null
        ? Math.abs(
            observedImpactRate -
            modelPrediction
          )
        : null,

    jointExposureRate,
    jointPrediction,
    jointAbsoluteError:
      observedImpactRate !== null
        ? Math.abs(
            observedImpactRate -
            jointPrediction
          )
        : null,
  };
}

for (const p of PATHS) {
  if (!fs.existsSync(p.script)) {
    throw new Error(
      `Required script missing:\n${p.script}`
    );
  }
}

ensureDir(OUTDIR);

const rng = makeRng(SEED);
const trials = [];

for (const def of PATHS) {
  const contexts = [
    {
      label: "ACTIVE",
      context: def.activeContext,
    },
    {
      label: "INACTIVE",
      context: def.inactiveContext,
    },
  ];

  for (const lambdaCtrl of LAMBDAS) {
    for (const ctx of contexts) {
      for (
        let repetition = 1;
        repetition <= REPS;
        repetition++
      ) {
        const u = rng();
        const inject =
          u < lambdaCtrl;

        const r = executeTrial(
          def,
          ctx.context,
          inject
        );

        trials.push({
          lambdaCtrl,
          repetition,
          randomDraw: u,
          contextClass:
            ctx.label,
          ...r,
        });
      }
    }
  }
}

const contextSummaries = [];

for (const def of PATHS) {
  for (const lambdaCtrl of LAMBDAS) {
    for (
      const contextClass of
      ["ACTIVE", "INACTIVE"]
    ) {
      const rows = trials.filter(
        (r) =>
          r.pathId === def.pathId &&
          r.lambdaCtrl === lambdaCtrl &&
          r.contextClass ===
            contextClass
      );

      contextSummaries.push({
        pathId: def.pathId,
        path: def.label,
        lambdaCtrl,
        contextClass,
        context:
          rows[0]?.context || "",
        ...summarize(rows),
      });
    }
  }
}

const pathAggregateSummaries = [];

for (const def of PATHS) {
  for (const lambdaCtrl of LAMBDAS) {
    const rows = trials.filter(
      (r) =>
        r.pathId === def.pathId &&
        r.lambdaCtrl === lambdaCtrl
    );

    const direct = summarize(rows);

    const contextRows =
      contextSummaries.filter(
        (r) =>
          r.pathId === def.pathId &&
          r.lambdaCtrl === lambdaCtrl
      );

    const equalWeight =
      1 / contextRows.length;

    const stratifiedPrediction =
      contextRows.reduce(
        (sum, r) =>
          sum +
          equalWeight *
            (r.lambdaHat || 0) *
            (r.alphaPathHat || 0) *
            (r.qPathHat || 0),
        0
      );

    pathAggregateSummaries.push({
      pathId: def.pathId,
      path: def.label,
      lambdaCtrl,

      ...direct,

      contextCount:
        contextRows.length,
      equalWeight,

      stratifiedPrediction,
      stratifiedAbsoluteError:
        Math.abs(
          (direct.observedImpactRate || 0) -
          stratifiedPrediction
        ),
    });
  }
}

const nonzero =
  pathAggregateSummaries.filter(
    (r) => r.lambdaCtrl > 0
  );

const globalModelMAE =
  mean(
    nonzero.map(
      (r) => r.modelAbsoluteError
    )
  );

const stratifiedMAE =
  mean(
    nonzero.map(
      (r) =>
        r.stratifiedAbsoluteError
    )
  );

const jointExposureMAE =
  mean(
    nonzero.map(
      (r) =>
        r.jointAbsoluteError
    )
  );

const fatalTrials =
  trials.filter(
    (r) => r.fatalError
  ).length;

const output = {
  experiment:
    "Controlled lambda validation for multi-hop Morgan paths",

  model:
    "R_P,ctrl(p,x,s) = lambda_P,ctrl * alpha_P(p,x) * q_P(p,x,s)",

  importantCaution:
    "lambda_P,ctrl is an assigned experimental injection probability, not a natural failure, vulnerability, compromise, or incident rate.",

  lambdas: LAMBDAS,
  repetitionsPerContextLambda:
    REPS,
  seed: SEED,

  paths: PATHS.map((p) => ({
    pathId: p.pathId,
    label: p.label,
    activeContext:
      p.activeContext,
    inactiveContext:
      p.inactiveContext,
    perturbation:
      p.perturbation,
  })),

  validation: {
    fatalTrials,
    nonzeroLambdaGlobalModelMAE:
      globalModelMAE,
    nonzeroLambdaContextStratifiedMAE:
      stratifiedMAE,
    nonzeroLambdaJointExposureMAE:
      jointExposureMAE,
  },

  contextSummaries,
  pathAggregateSummaries,
  trials,
};

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-controlled-lambda-validation.json"
  ),
  JSON.stringify(
    output,
    null,
    2
  ),
  "utf8"
);

const summaryHeaders = [
  "pathId",
  "lambdaCtrl",
  "contextClass",
  "context",
  "trials",
  "injectedTrials",
  "pathActiveTrials",
  "activeInjectedTrials",
  "impactedTrials",
  "lambdaHat",
  "alphaPathHat",
  "qPathHat",
  "observedImpactRate",
  "modelPrediction",
  "modelAbsoluteError",
  "jointExposureRate",
  "jointPrediction",
  "jointAbsoluteError",
];

const summaryCsv = [
  summaryHeaders.join(","),
  ...contextSummaries.map(
    (r) =>
      summaryHeaders
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
    "multihop-controlled-lambda-context-summary.csv"
  ),
  summaryCsv,
  "utf8"
);

const aggHeaders = [
  "pathId",
  "lambdaCtrl",
  "trials",
  "lambdaHat",
  "alphaPathHat",
  "qPathHat",
  "observedImpactRate",
  "modelPrediction",
  "modelAbsoluteError",
  "stratifiedPrediction",
  "stratifiedAbsoluteError",
  "jointExposureRate",
  "jointPrediction",
  "jointAbsoluteError",
];

const aggCsv = [
  aggHeaders.join(","),
  ...pathAggregateSummaries.map(
    (r) =>
      aggHeaders
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
    "multihop-controlled-lambda-path-summary.csv"
  ),
  aggCsv,
  "utf8"
);

const report = [];

report.push(
  "MULTI-HOP CONTROLLED OCCURRENCE-RATE VALIDATION"
);
report.push(
  "================================================"
);
report.push("");

report.push("MODEL");
report.push("-----");
report.push(
  "R_P,ctrl(p,x,s) = lambda_P,ctrl * alpha_P(p,x) * q_P(p,x,s)"
);
report.push("");
report.push(
  "lambda_P,ctrl : assigned controlled perturbation occurrence probability"
);
report.push(
  "alpha_P       : observed JOINT path activation rate"
);
report.push(
  "q_P           : path-level impact conditional on injection + full path activation"
);
report.push(
  "R_P,ctrl      : observed path-impact rate"
);
report.push("");
report.push(
  "IMPORTANT: lambda_P,ctrl is NOT a measured natural vulnerability, compromise, incident, or failure rate."
);
report.push("");

for (const def of PATHS) {
  report.push(
    `${def.pathId}: ${def.label}`
  );
  report.push(
    `  controlled perturbation: ${def.perturbation}`
  );
  report.push(
    `  active context: ${def.activeContext}`
  );
  report.push(
    `  inactive context: ${def.inactiveContext}`
  );
  report.push("");

  const rows =
    contextSummaries.filter(
      (r) =>
        r.pathId === def.pathId
    );

  for (const r of rows) {
    report.push(
      `  lambda=${fmt(r.lambdaCtrl, 2)} | ${r.contextClass} | ${r.context}`
    );
    report.push(
      `    n=${r.trials} injected=${r.injectedTrials} pathActive=${r.pathActiveTrials} active&injected=${r.activeInjectedTrials} impacted=${r.impactedTrials}`
    );
    report.push(
      `    lambda_hat=${fmt(r.lambdaHat)} alpha_P=${fmt(r.alphaPathHat)} q_P=${fmt(r.qPathHat)} R_obs=${fmt(r.observedImpactRate)} lambda*alpha*q=${fmt(r.modelPrediction)}`
    );
  }

  report.push("");
}

report.push("PATH-AGGREGATE COMPARISON");
report.push("-------------------------");

for (const r of pathAggregateSummaries) {
  report.push(
    `${r.pathId} lambda=${fmt(r.lambdaCtrl, 2)}`
  );
  report.push(
    `  observed=${fmt(r.observedImpactRate)}`
  );
  report.push(
    `  product-of-global-averages=${fmt(r.modelPrediction)} error=${fmt(r.modelAbsoluteError)}`
  );
  report.push(
    `  context-stratified=${fmt(r.stratifiedPrediction)} error=${fmt(r.stratifiedAbsoluteError)}`
  );
  report.push(
    `  joint-exposure prediction=${fmt(r.jointPrediction)} error=${fmt(r.jointAbsoluteError)}`
  );
}

report.push("");
report.push("VALIDATION SUMMARY");
report.push("------------------");
report.push(
  `Fatal trials: ${fatalTrials}`
);
report.push(
  `MAE product-of-global-averages for nonzero lambda: ${fmt(globalModelMAE)}`
);
report.push(
  `MAE context-stratified model for nonzero lambda: ${fmt(stratifiedMAE)}`
);
report.push(
  `MAE direct joint-exposure model for nonzero lambda: ${fmt(jointExposureMAE)}`
);
report.push("");

report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "The experiment extends the controlled occurrence-rate decomposition from single shared edges to complete 2-hop dependency paths."
);
report.push(
  "Inactive path contexts are negative controls: injected terminal perturbations should not produce path impact when alpha_P=0."
);
report.push(
  "Active path contexts should produce impact only on injected trials, with q_P near 1 for the deterministic corruption mechanisms used here."
);
report.push(
  "At aggregate level, context-stratified prediction is preferred over multiplying pooled averages when execution contexts have different path-activation states."
);
report.push(
  "This validates model structure only and does not estimate real-world incident frequency."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-controlled-lambda-validation-report.txt"
  ),
  report.join("\n"),
  "utf8"
);

console.log(
  report.join("\n")
);

console.log("");
console.log("Files created:");
console.log(
  "  results/multihop-controlled-lambda-validation/multihop-controlled-lambda-validation-report.txt"
);
console.log(
  "  results/multihop-controlled-lambda-validation/multihop-controlled-lambda-context-summary.csv"
);
console.log(
  "  results/multihop-controlled-lambda-validation/multihop-controlled-lambda-path-summary.csv"
);
console.log(
  "  results/multihop-controlled-lambda-validation/multihop-controlled-lambda-validation.json"
);
