#!/usr/bin/env node
"use strict";

/*
  build_empirical_dependency_matrix.js

  Builds an empirical topology -> activation -> propagation matrix
  for the shared dependency debug@4.4.3 using results from:

    Experiment 6:
      results/debug-shared-node/debug-shared-node-results.json

    Experiment 7:
      results/debug-shared-node-perturbation/
        debug-shared-perturbation-results.json

  Model:
    alpha_e(w) = P(edge active | workload w)

    q_e^(s,w) =
      P(measured impact | edge active, perturbation s, workload w)

    pi_e^(s,w) = alpha_e(w) * q_e^(s,w)

  IMPORTANT:
    pi is an empirical workload-conditioned propagation quantity in this
    controlled environment. It is NOT a real-world compromise probability.

  Outputs:
    results/model/debug-empirical-dependency-matrix.csv
    results/model/debug-empirical-dependency-matrix.json
    results/model/debug-empirical-dependency-matrix-report.txt
*/

const fs = require("fs");
const path = require("path");

const activationPath = path.join(
  process.cwd(),
  "results",
  "debug-shared-node",
  "debug-shared-node-results.json"
);

const perturbationPath = path.join(
  process.cwd(),
  "results",
  "debug-shared-node-perturbation",
  "debug-shared-perturbation-results.json"
);

const outputDir = path.join(
  process.cwd(),
  "results",
  "model"
);

function die(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(activationPath)) {
  die(`Missing activation result file:\n${activationPath}`);
}

if (!fs.existsSync(perturbationPath)) {
  die(`Missing perturbation result file:\n${perturbationPath}`);
}

const activationData = JSON.parse(
  fs.readFileSync(activationPath, "utf8")
);

const perturbationData = JSON.parse(
  fs.readFileSync(perturbationPath, "utf8")
);

fs.mkdirSync(outputDir, { recursive: true });

const perturbationDimensions = {
  DROP_LOG: "observability_availability",
  CORRUPT_LOG: "observability_integrity",
  DUPLICATE_LOG: "observability_duplication",
  DELAY: "latency",
};

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  return `"${text.replaceAll('"', '""')}"`;
}

/*
  Convert Experiment 6 summaries into:
    activationLookup[workload][parent] = alpha
*/
const activationLookup = {};

for (const summary of activationData.summaries || []) {
  activationLookup[summary.workload] = {};

  for (const [parent, stats] of Object.entries(
    summary.parents || {}
  )) {
    activationLookup[summary.workload][parent] =
      stats.activationRate;
  }
}

const rows = [];

for (const s of perturbationData.summaries || []) {
  const alpha =
    activationLookup[s.workload] &&
    activationLookup[s.workload][s.targetParent] !== undefined
      ? activationLookup[s.workload][s.targetParent]
      : null;

  const qGivenActive =
    s.qHatGivenActivation === null ||
    s.qHatGivenActivation === undefined
      ? null
      : s.qHatGivenActivation;

  const pi =
    alpha === null
      ? null
      : qGivenActive === null
      ? 0
      : alpha * qGivenActive;

  const observedOverallQ =
    s.qHat === undefined || s.qHat === null
      ? null
      : s.qHat;

  const consistencyError =
    pi === null || observedOverallQ === null
      ? null
      : Math.abs(pi - observedOverallQ);

  rows.push({
    sharedNode:
      activationData.topology &&
      activationData.topology.sharedNode
        ? activationData.topology.sharedNode
        : "debug@4.4.3",

    dependencyEdge:
      `${s.targetParent} -> debug@4.4.3`,

    parent: s.targetParent,
    workload: s.workload,
    perturbation: s.perturbation,
    impactDimension:
      perturbationDimensions[s.perturbation] || "unknown",

    alpha,
    qGivenActive,
    pi,

    observedOverallQ,
    consistencyError,

    activationTrials:
      s.activatedTrials === undefined
        ? null
        : s.activatedTrials,

    perturbationTrials:
      s.trials === undefined
        ? null
        : s.trials,

    avgResponseMs:
      s.avgResponseMs === undefined
        ? null
        : s.avgResponseMs,

    avgInjectedDelayMs:
      s.avgInjectedDelayMs === undefined
        ? null
        : s.avgInjectedDelayMs,
  });
}

function mean(values) {
  const valid = values.filter(
    (x) => typeof x === "number" && Number.isFinite(x)
  );

  if (!valid.length) return null;

  return (
    valid.reduce((sum, x) => sum + x, 0) / valid.length
  );
}

const parents = [
  ...new Set(rows.map((r) => r.parent)),
];

const workloads = [
  ...new Set(rows.map((r) => r.workload)),
];

const perturbations = [
  ...new Set(rows.map((r) => r.perturbation)),
];

const parentSummary = parents.map((parent) => {
  const subset = rows.filter((r) => r.parent === parent);

  const activeWorkloads = workloads.filter((workload) => {
    const workloadRows = subset.filter(
      (r) => r.workload === workload
    );

    return workloadRows.some(
      (r) => typeof r.alpha === "number" && r.alpha > 0
    );
  });

  return {
    parent,
    topologicalEdge: `${parent} -> debug@4.4.3`,
    activeWorkloads,
    activeWorkloadCount: activeWorkloads.length,
    totalWorkloads: workloads.length,
    meanAlphaAcrossWorkloads: mean(
      subset
        .filter(
          (r, idx, arr) =>
            arr.findIndex(
              (x) =>
                x.parent === r.parent &&
                x.workload === r.workload
            ) === idx
        )
        .map((r) => r.alpha)
    ),
    meanPiAcrossAllConditions: mean(
      subset.map((r) => r.pi)
    ),
  };
});

const maxConsistencyError = Math.max(
  0,
  ...rows
    .map((r) => r.consistencyError)
    .filter(
      (x) => typeof x === "number" && Number.isFinite(x)
    )
);

const output = {
  model: {
    topology:
      "G_P=(V,E)",
    activation:
      "alpha_e(w)=P(edge active | workload w)",
    conditionalPropagation:
      "q_e^(s,w)=P(impact | edge active, perturbation s, workload w)",
    effectivePropagation:
      "pi_e^(s,w)=alpha_e(w)*q_e^(s,w)",
    caution:
      "pi is a controlled workload-conditioned propagation quantity, not a real-world compromise probability.",
  },

  sourceExperiments: {
    activationExperiment:
      "Experiment 6: debug shared-node runtime activation",
    perturbationExperiment:
      "Experiment 7: debug shared-node perturbation propagation",
  },

  summary: {
    sharedNode:
      activationData.topology &&
      activationData.topology.sharedNode
        ? activationData.topology.sharedNode
        : "debug@4.4.3",

    topologicalParents: parents,
    workloads,
    perturbations,
    rowCount: rows.length,
    maxConsistencyError,
  },

  parentSummary,
  rows,
};

const jsonPath = path.join(
  outputDir,
  "debug-empirical-dependency-matrix.json"
);

const csvPath = path.join(
  outputDir,
  "debug-empirical-dependency-matrix.csv"
);

const reportPath = path.join(
  outputDir,
  "debug-empirical-dependency-matrix-report.txt"
);

fs.writeFileSync(
  jsonPath,
  JSON.stringify(output, null, 2),
  "utf8"
);

const headers = [
  "sharedNode",
  "dependencyEdge",
  "parent",
  "workload",
  "perturbation",
  "impactDimension",
  "alpha",
  "qGivenActive",
  "pi",
  "observedOverallQ",
  "consistencyError",
  "activationTrials",
  "perturbationTrials",
  "avgResponseMs",
  "avgInjectedDelayMs",
];

const csvLines = [
  headers.map(csvEscape).join(","),
  ...rows.map((r) =>
    headers.map((h) => csvEscape(r[h])).join(",")
  ),
];

fs.writeFileSync(
  csvPath,
  csvLines.join("\n"),
  "utf8"
);

const report = [];

report.push(
  "EMPIRICAL DEPENDENCY ACTIVATION-PROPAGATION MATRIX"
);
report.push(
  "================================================="
);
report.push("");

report.push(
  `Shared node: ${output.summary.sharedNode}`
);
report.push(
  `Topological parent edges: ${parents.length}`
);
report.push(
  `Workloads: ${workloads.length}`
);
report.push(
  `Perturbation types: ${perturbations.length}`
);
report.push(
  `Matrix rows: ${rows.length}`
);
report.push("");

report.push("MODEL");
report.push("-----");
report.push(
  "alpha_e(w) = P(edge active | workload w)"
);
report.push(
  "q_e^(s,w) = P(impact | edge active, perturbation s, workload w)"
);
report.push(
  "pi_e^(s,w) = alpha_e(w) * q_e^(s,w)"
);
report.push("");

report.push(
  "IMPORTANT: pi is a controlled workload-conditioned propagation"
);
report.push(
  "quantity, not a real-world compromise probability."
);
report.push("");

report.push("PARENT-EDGE SUMMARY");
report.push("-------------------");

for (const p of parentSummary) {
  report.push(
    `${p.topologicalEdge}`
  );
  report.push(
    `  active workloads: ${
      p.activeWorkloads.length
        ? p.activeWorkloads.join(", ")
        : "none observed"
    }`
  );
  report.push(
    `  active workload coverage: ${p.activeWorkloadCount}/${p.totalWorkloads}`
  );
  report.push(
    `  mean alpha across workloads: ${
      p.meanAlphaAcrossWorkloads === null
        ? "NA"
        : p.meanAlphaAcrossWorkloads.toFixed(4)
    }`
  );
  report.push("");
}

report.push(
  "SELECTED EMPIRICAL MATRIX ROWS"
);
report.push(
  "------------------------------"
);

for (const row of rows) {
  if (
    row.perturbation === "DELAY" ||
    row.perturbation === "CORRUPT_LOG"
  ) {
    report.push(
      `${row.parent.padEnd(12)} | ` +
      `${row.workload.padEnd(13)} | ` +
      `${row.perturbation.padEnd(11)} | ` +
      `alpha=${row.alpha === null ? "NA" : row.alpha.toFixed(4)} | ` +
      `q|active=${
        row.qGivenActive === null
          ? "NA"
          : row.qGivenActive.toFixed(4)
      } | ` +
      `pi=${row.pi === null ? "NA" : row.pi.toFixed(4)} | ` +
      `observed_q=${
        row.observedOverallQ === null
          ? "NA"
          : row.observedOverallQ.toFixed(4)
      }`
    );
  }
}

report.push("");
report.push("CONSISTENCY CHECK");
report.push("-----------------");
report.push(
  `Maximum |pi - observed overall q_hat|: ${maxConsistencyError.toFixed(4)}`
);
report.push("");

report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "The static graph identifies potential dependency exposure."
);
report.push(
  "alpha captures whether an edge is actually exercised by a workload."
);
report.push(
  "q|active captures propagation once the runtime edge is active."
);
report.push(
  "pi combines both effects into a workload-conditioned propagation"
);
report.push(
  "quantity. This separates topology from runtime behavior."
);

fs.writeFileSync(
  reportPath,
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results\\model\\debug-empirical-dependency-matrix-report.txt"
);
console.log(
  "  results\\model\\debug-empirical-dependency-matrix.csv"
);
console.log(
  "  results\\model\\debug-empirical-dependency-matrix.json"
);
