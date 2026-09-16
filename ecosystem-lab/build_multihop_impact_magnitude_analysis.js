#!/usr/bin/env node
"use strict";

/*
  build_multihop_impact_magnitude_analysis.js

  Adds IMPACT MAGNITUDE / SEVERITY DIMENSIONS to the already completed
  Morgan multi-hop propagation experiment.

  IMPORTANT:
    This script does NOT invent a single scalar "risk score".
    Different impact types are kept as separate measurable dimensions.

  Reads:
    results/multihop-path-propagation/
      morgan-multihop-path-propagation.json

  Produces:
    - impact magnitude report
    - CSV summary
    - JSON summary

  Studied dimensions:
    1. path activation
    2. conditional impact rate q_P
    3. HTTP status failure rate
    4. latency delta (ms)
    5. observability alteration count (PA)
    6. completion suppression / controlled error evidence (PB)

  These are controlled experimental measurements, not natural incident rates.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const INPUT = path.join(
  ROOT,
  "results",
  "multihop-path-propagation",
  "morgan-multihop-path-propagation.json"
);

const OUTDIR = path.join(
  ROOT,
  "results",
  "multihop-impact-magnitude-analysis"
);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mean(xs) {
  const a = xs.filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function median(xs) {
  const a = xs
    .filter(Number.isFinite)
    .sort((x, y) => x - y);

  if (!a.length) return null;

  const m = Math.floor(a.length / 2);

  return a.length % 2
    ? a[m]
    : (a[m - 1] + a[m]) / 2;
}

function min(xs) {
  const a = xs.filter(Number.isFinite);
  return a.length ? Math.min(...a) : null;
}

function max(xs) {
  const a = xs.filter(Number.isFinite);
  return a.length ? Math.max(...a) : null;
}

function fmt(v, d = 3) {
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

const trials = (data.trials || []).filter(
  (r) => !r.fatalError
);

const keySet = new Set(
  trials.map(
    (r) =>
      `${r.pathId}::${r.context}::${r.perturbation}`
  )
);

const rows = [];

for (const key of [...keySet].sort()) {
  const [pathId, context, perturbation] =
    key.split("::");

  const group = trials.filter(
    (r) =>
      r.pathId === pathId &&
      r.context === context &&
      r.perturbation === perturbation
  );

  const n = group.length;

  const active = group.filter(
    (r) => Number(r.pathActive) === 1
  );

  const impacted = group.filter(
    (r) => Boolean(r.impactObserved)
  );

  const httpFailures = group.filter(
    (r) =>
      Number.isFinite(Number(r.statusCode)) &&
      Number(r.statusCode) >= 400
  );

  const latencyDeltas = impacted
    .map((r) => Number(r.elapsedDeltaMs))
    .filter(Number.isFinite);

  const alteredMsCalls = group
    .map((r) => Number(r.alteredMsCalls))
    .filter(Number.isFinite);

  const droppedRegistrations = group
    .map(
      (r) =>
        Number(
          r.droppedEeFirstRegistrations
        )
    )
    .filter(Number.isFinite);

  const controlledErrors = group
    .map(
      (r) =>
        Number(
          r.controlledErrorsSeenByParent
        )
    )
    .filter(Number.isFinite);

  const callbackInvocations = group
    .map(
      (r) =>
        Number(
          r.parentVisibleCallbackInvocations
        )
    )
    .filter(Number.isFinite);

  const impactTypes = [
    ...new Set(
      impacted
        .map((r) => r.impactType)
        .filter(Boolean)
    ),
  ];

  rows.push({
    pathId,
    path:
      group[0]?.path || "",
    context,
    perturbation,

    trials: n,
    pathActiveTrials: active.length,
    impactedTrials: impacted.length,

    alphaPath:
      n ? active.length / n : null,

    qPathConditionalOnActive:
      active.length
        ? impacted.length / active.length
        : null,

    impactRate:
      n ? impacted.length / n : null,

    httpFailureRate:
      n ? httpFailures.length / n : null,

    impactType:
      impactTypes.join("|") || "NONE",

    latencyMeanDeltaMs:
      mean(latencyDeltas),

    latencyMedianDeltaMs:
      median(latencyDeltas),

    latencyMinDeltaMs:
      min(latencyDeltas),

    latencyMaxDeltaMs:
      max(latencyDeltas),

    meanAlteredMsCalls:
      mean(alteredMsCalls),

    meanDroppedEeFirstRegistrations:
      mean(droppedRegistrations),

    meanControlledErrorsSeenByParent:
      mean(controlledErrors),

    meanParentVisibleCallbackInvocations:
      mean(callbackInvocations),
  });
}

/*
  Create a NON-SCALAR impact profile.

  We deliberately do not assign arbitrary weights across:
    availability,
    integrity/observability,
    completion behavior,
    error behavior,
    latency.

  This preserves interpretability.
*/

const profiles = rows.map((r) => ({
  pathId: r.pathId,
  path: r.path,
  context: r.context,
  perturbation: r.perturbation,

  activationDimension: {
    alphaPath: r.alphaPath,
  },

  propagationDimension: {
    qPathConditionalOnActive:
      r.qPathConditionalOnActive,
    impactRate: r.impactRate,
  },

  serviceAvailabilityDimension: {
    httpFailureRate:
      r.httpFailureRate,
  },

  latencyDimension: {
    meanDeltaMs:
      r.latencyMeanDeltaMs,
    medianDeltaMs:
      r.latencyMedianDeltaMs,
    minDeltaMs:
      r.latencyMinDeltaMs,
    maxDeltaMs:
      r.latencyMaxDeltaMs,
  },

  observabilityIntegrityDimension: {
    meanAlteredMsCalls:
      r.meanAlteredMsCalls,
  },

  completionErrorDimension: {
    meanDroppedEeFirstRegistrations:
      r.meanDroppedEeFirstRegistrations,

    meanControlledErrorsSeenByParent:
      r.meanControlledErrorsSeenByParent,

    meanParentVisibleCallbackInvocations:
      r.meanParentVisibleCallbackInvocations,
  },

  impactType: r.impactType,
}));

const output = {
  experiment:
    "Multi-hop impact magnitude analysis",

  input:
    path.relative(ROOT, INPUT),

  designPrinciple:
    "Impact magnitude is represented as a multidimensional profile rather than an arbitrary scalar score.",

  caution:
    "All measurements come from controlled perturbation experiments and do not estimate natural real-world incident frequency or universal severity.",

  profiles,
};

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-impact-magnitude-analysis.json"
  ),
  JSON.stringify(
    output,
    null,
    2
  ),
  "utf8"
);

const headers = [
  "pathId",
  "path",
  "context",
  "perturbation",
  "trials",
  "pathActiveTrials",
  "impactedTrials",
  "alphaPath",
  "qPathConditionalOnActive",
  "impactRate",
  "httpFailureRate",
  "impactType",
  "latencyMeanDeltaMs",
  "latencyMedianDeltaMs",
  "latencyMinDeltaMs",
  "latencyMaxDeltaMs",
  "meanAlteredMsCalls",
  "meanDroppedEeFirstRegistrations",
  "meanControlledErrorsSeenByParent",
  "meanParentVisibleCallbackInvocations",
];

const csv = [
  headers.join(","),
  ...rows.map(
    (r) =>
      headers
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
    "multihop-impact-magnitude-summary.csv"
  ),
  csv,
  "utf8"
);

const report = [];

report.push(
  "MULTI-HOP IMPACT MAGNITUDE ANALYSIS"
);
report.push(
  "==================================="
);
report.push("");

report.push("PRINCIPLE");
report.push("---------");
report.push(
  "Impact severity is represented as separate measurable dimensions rather than one arbitrary scalar risk score."
);
report.push("");
report.push(
  "Dimensions include path activation, conditional propagation, HTTP availability, latency, observability alteration, completion suppression, and controlled error behavior."
);
report.push("");
report.push(
  "IMPORTANT: results come from controlled perturbations and do not estimate natural real-world incident frequency."
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
      `${r.context} | ${r.perturbation}`
    );

    report.push(
      `  alpha_P=${fmt(r.alphaPath)} q_P=${fmt(r.qPathConditionalOnActive)} impactRate=${fmt(r.impactRate)}`
    );

    report.push(
      `  HTTP failure rate=${fmt(r.httpFailureRate)} impact=${r.impactType}`
    );

    if (
      r.latencyMedianDeltaMs !== null
    ) {
      report.push(
        `  latency delta ms: mean=${fmt(r.latencyMeanDeltaMs)} median=${fmt(r.latencyMedianDeltaMs)} min=${fmt(r.latencyMinDeltaMs)} max=${fmt(r.latencyMaxDeltaMs)}`
      );
    }

    if (
      r.meanAlteredMsCalls !== null
    ) {
      report.push(
        `  mean altered ms calls=${fmt(r.meanAlteredMsCalls)}`
      );
    }

    if (
      r.meanDroppedEeFirstRegistrations !==
        null ||
      r.meanControlledErrorsSeenByParent !==
        null ||
      r.meanParentVisibleCallbackInvocations !==
        null
    ) {
      report.push(
        `  completion/error metrics: droppedRegistrations=${fmt(r.meanDroppedEeFirstRegistrations)} controlledErrors=${fmt(r.meanControlledErrorsSeenByParent)} parentCallbacks=${fmt(r.meanParentVisibleCallbackInvocations)}`
      );
    }
  }

  report.push("");
}

report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "The earlier binary impact variable establishes whether an effect occurred."
);
report.push(
  "This analysis adds magnitude/type information so two perturbations with the same q_P do not have to be treated as equivalent in consequence."
);
report.push(
  "HTTP status can remain successful while lower-layer observability, completion semantics, error semantics, or latency are measurably degraded."
);
report.push(
  "No single cross-dimension scalar score is claimed because defensible weighting among these dimensions has not yet been established."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "multihop-impact-magnitude-analysis-report.txt"
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
  "  results/multihop-impact-magnitude-analysis/multihop-impact-magnitude-analysis-report.txt"
);
console.log(
  "  results/multihop-impact-magnitude-analysis/multihop-impact-magnitude-summary.csv"
);
console.log(
  "  results/multihop-impact-magnitude-analysis/multihop-impact-magnitude-analysis.json"
);
