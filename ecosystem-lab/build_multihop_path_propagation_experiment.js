#!/usr/bin/env node
"use strict";

/*
  build_multihop_path_propagation_experiment.js

  Reuses the already validated Morgan child experiments to study
  END-TO-END controlled propagation across two real 2-hop paths:

    PA:
      morgan@1.12.1
        -> debug@2.6.9
        -> ms@2.0.0

    PB:
      morgan@1.12.1
        -> on-finished@2.4.1
        -> ee-first@1.1.1

  Path-level model:

    alpha_P(p,x)
      = P(all edges in path P are active | p,x)

    q_P(p,x,s)
      = P(I_P=1 | A_P=1,p,x,s)

    pi_P(p,x,s)
      = alpha_P(p,x) * q_P(p,x,s)

  IMPORTANT:
    alpha_P is measured as JOINT path activation.
    It is NOT generally replaced by a product of marginal edge
    activation probabilities.

  This experiment is controlled. It does NOT estimate a natural
  vulnerability/compromise/failure probability.
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
  "multihop-path-propagation"
);

const REPS = 5;

const PATHS = {
  PA: {
    label:
      "morgan@1.12.1 -> debug@2.6.9 -> ms@2.0.0",
    driver: "debug-ms",
    contexts: [
      "INACTIVE_COLORS_OFF",
      "ACTIVE_COLORS_ON",
    ],
    perturbations: [
      "BASELINE",
      "CORRUPT_HUMANIZE",
      "EMPTY_HUMANIZE",
      "DELAY_HUMANIZE",
    ],
  },

  PB: {
    label:
      "morgan@1.12.1 -> on-finished@2.4.1 -> ee-first@1.1.1",
    driver: "onfinished-eefirst",
    contexts: [
      "MORGAN_IMMEDIATE_REQUEST",
      "MORGAN_NORMAL_REQUEST",
    ],
    perturbations: [
      "BASELINE",
      "DROP_COMPLETION",
      "CORRUPT_ERROR",
      "DELAY_COMPLETION",
    ],
  },
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function median(values) {
  const a = values
    .filter(Number.isFinite)
    .sort((x, y) => x - y);

  if (!a.length) return null;

  const m = Math.floor(a.length / 2);

  return a.length % 2
    ? a[m]
    : (a[m - 1] + a[m]) / 2;
}

function mean(values) {
  const a = values.filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function fmt(v, digits = 3) {
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

  if (
    child.stderr &&
    child.stderr.trim()
  ) {
    parsed.childStderr =
      child.stderr.trim();
  }

  return parsed;
}

function executePA(context, perturbation) {
  const raw = runChild(
    DEBUG_CHILD,
    [
      "P3",
      context,
      perturbation,
    ]
  );

  if (raw.fatalError) {
    return {
      pathId: "PA",
      context,
      perturbation,
      fatalError: raw.fatalError,
    };
  }

  const edge1Active =
    raw.parentDebugCalled ? 1 : 0;

  const edge2Active =
    raw.edgeActivated ? 1 : 0;

  const pathActive =
    edge1Active && edge2Active
      ? 1
      : 0;

  return {
    pathId: "PA",
    path: PATHS.PA.label,
    context,
    perturbation,

    edge1Active,
    edge2Active,
    pathActive,

    elapsedMs: Number(raw.elapsedMs),

    alteredMsCalls:
      Number(raw.alteredMsCalls || 0),

    injectedDelayMs:
      Number(raw.injectedDelayMs || 0),

    statusCode:
      raw.outcome?.statusCode ?? null,

    raw,
  };
}

function executePB(context, perturbation) {
  const raw = runChild(
    ONFINISHED_CHILD,
    [
      "P3",
      context,
      perturbation,
    ]
  );

  if (raw.fatalError) {
    return {
      pathId: "PB",
      context,
      perturbation,
      fatalError: raw.fatalError,
    };
  }

  const edge1Active =
    raw.onFinishedInvoked ? 1 : 0;

  const edge2Active =
    raw.edgeActivated ? 1 : 0;

  const pathActive =
    edge1Active && edge2Active
      ? 1
      : 0;

  return {
    pathId: "PB",
    path: PATHS.PB.label,
    context,
    perturbation,

    edge1Active,
    edge2Active,
    pathActive,

    elapsedMs: Number(raw.elapsedMs),

    parentVisibleCallbackInvocations:
      Number(
        raw.parentVisibleCallbackInvocations || 0
      ),

    controlledErrorsSeenByParent:
      Number(
        raw.controlledErrorsSeenByParent || 0
      ),

    droppedEeFirstRegistrations:
      Number(
        raw.droppedEeFirstRegistrations || 0
      ),

    injectedDelayMs:
      Number(raw.injectedDelayMs || 0),

    statusCode:
      raw.outcome?.statusCode ?? null,

    raw,
  };
}

function classify(rows) {
  const baselineMedians = new Map();

  for (const pathId of ["PA", "PB"]) {
    const contexts =
      PATHS[pathId].contexts;

    for (const context of contexts) {
      const vals = rows
        .filter(
          (r) =>
            r.pathId === pathId &&
            r.context === context &&
            r.perturbation === "BASELINE" &&
            !r.fatalError
        )
        .map((r) => r.elapsedMs)
        .filter(Number.isFinite);

      baselineMedians.set(
        `${pathId}::${context}`,
        median(vals)
      );
    }
  }

  for (const r of rows) {
    if (r.fatalError) continue;

    const base =
      baselineMedians.get(
        `${r.pathId}::${r.context}`
      );

    r.baselineMedianMs = base;

    r.elapsedDeltaMs =
      Number.isFinite(r.elapsedMs) &&
      Number.isFinite(base)
        ? r.elapsedMs - base
        : null;

    r.impactObserved = false;
    r.impactType = "NONE";

    if (
      r.perturbation === "BASELINE" ||
      !r.pathActive
    ) {
      continue;
    }

    if (r.pathId === "PA") {
      if (
        r.perturbation ===
        "CORRUPT_HUMANIZE"
      ) {
        r.impactObserved =
          r.alteredMsCalls > 0;

        r.impactType =
          r.impactObserved
            ? "OBSERVABILITY_CORRUPTION"
            : "NONE";
      }

      else if (
        r.perturbation ===
        "EMPTY_HUMANIZE"
      ) {
        r.impactObserved =
          r.alteredMsCalls > 0;

        r.impactType =
          r.impactObserved
            ? "OBSERVABILITY_SUPPRESSION"
            : "NONE";
      }

      else if (
        r.perturbation ===
        "DELAY_HUMANIZE"
      ) {
        const threshold =
          r.injectedDelayMs * 0.5;

        r.impactObserved =
          r.injectedDelayMs > 0 &&
          Number.isFinite(
            r.elapsedDeltaMs
          ) &&
          r.elapsedDeltaMs >= threshold;

        r.impactType =
          r.impactObserved
            ? "LATENCY"
            : "NONE";
      }
    }

    if (r.pathId === "PB") {
      if (
        r.perturbation ===
        "DROP_COMPLETION"
      ) {
        r.impactObserved =
          r.droppedEeFirstRegistrations >
            0 &&
          r.parentVisibleCallbackInvocations ===
            0;

        r.impactType =
          r.impactObserved
            ? "COMPLETION_SUPPRESSION"
            : "NONE";
      }

      else if (
        r.perturbation ===
        "CORRUPT_ERROR"
      ) {
        r.impactObserved =
          r.controlledErrorsSeenByParent >
          0;

        r.impactType =
          r.impactObserved
            ? "ERROR_CORRUPTION"
            : "NONE";
      }

      else if (
        r.perturbation ===
        "DELAY_COMPLETION"
      ) {
        const threshold =
          r.injectedDelayMs * 0.5;

        r.impactObserved =
          r.injectedDelayMs > 0 &&
          Number.isFinite(
            r.elapsedDeltaMs
          ) &&
          r.elapsedDeltaMs >= threshold;

        r.impactType =
          r.impactObserved
            ? "LATENCY"
            : "NONE";
      }
    }
  }
}

function aggregate(rows) {
  const groups = new Map();

  for (const r of rows) {
    const key = [
      r.pathId,
      r.context,
      r.perturbation,
    ].join("::");

    if (!groups.has(key)) {
      groups.set(key, {
        pathId: r.pathId,
        path: r.path,
        context: r.context,
        perturbation:
          r.perturbation,

        trials: 0,
        edge1ActiveTrials: 0,
        edge2ActiveTrials: 0,
        pathActiveTrials: 0,
        impactedTrials: 0,

        elapsedMs: [],
        elapsedDeltaMs: [],
        statusCodes: [],
        impactTypes: new Set(),
      });
    }

    const g = groups.get(key);

    g.trials += 1;

    if (r.edge1Active) {
      g.edge1ActiveTrials += 1;
    }

    if (r.edge2Active) {
      g.edge2ActiveTrials += 1;
    }

    if (r.pathActive) {
      g.pathActiveTrials += 1;
    }

    if (r.impactObserved) {
      g.impactedTrials += 1;
      g.impactTypes.add(
        r.impactType
      );
    }

    if (Number.isFinite(r.elapsedMs)) {
      g.elapsedMs.push(r.elapsedMs);
    }

    if (
      Number.isFinite(
        r.elapsedDeltaMs
      )
    ) {
      g.elapsedDeltaMs.push(
        r.elapsedDeltaMs
      );
    }

    if (
      r.statusCode !== null &&
      r.statusCode !== undefined
    ) {
      g.statusCodes.push(
        r.statusCode
      );
    }
  }

  return [...groups.values()].map(
    (g) => {
      const alphaPath =
        g.trials
          ? g.pathActiveTrials /
            g.trials
          : null;

      const qPath =
        g.pathActiveTrials
          ? g.impactedTrials /
            g.pathActiveTrials
          : null;

      const piPath =
        g.trials
          ? g.impactedTrials /
            g.trials
          : null;

      const modelPi =
        alphaPath !== null &&
        qPath !== null
          ? alphaPath * qPath
          : 0;

      return {
        pathId: g.pathId,
        path: g.path,
        context: g.context,
        perturbation:
          g.perturbation,

        trials: g.trials,

        edge1ActivationRate:
          g.edge1ActiveTrials /
          g.trials,

        edge2ActivationRate:
          g.edge2ActiveTrials /
          g.trials,

        alphaPath,

        pathActiveTrials:
          g.pathActiveTrials,

        impactedTrials:
          g.impactedTrials,

        qPathConditionalOnActive:
          qPath,

        piPathDirect:
          piPath,

        piPathModel:
          modelPi,

        piAbsoluteDifference:
          Math.abs(
            piPath - modelPi
          ),

        medianElapsedMs:
          median(g.elapsedMs),

        meanElapsedDeltaMs:
          mean(g.elapsedDeltaMs),

        uniqueStatusCodes:
          [
            ...new Set(
              g.statusCodes
            ),
          ],

        impactType:
          [
            ...g.impactTypes,
          ].join("|") || "NONE",
      };
    }
  );
}

function main() {
  if (!fs.existsSync(DEBUG_CHILD)) {
    throw new Error(
      `Required script missing:\n${DEBUG_CHILD}`
    );
  }

  if (!fs.existsSync(ONFINISHED_CHILD)) {
    throw new Error(
      `Required script missing:\n${ONFINISHED_CHILD}`
    );
  }

  ensureDir(OUTDIR);

  const rows = [];

  for (const pathId of ["PA", "PB"]) {
    const def = PATHS[pathId];

    for (const context of def.contexts) {
      for (
        const perturbation of
        def.perturbations
      ) {
        for (
          let rep = 1;
          rep <= REPS;
          rep++
        ) {
          const r =
            pathId === "PA"
              ? executePA(
                  context,
                  perturbation
                )
              : executePB(
                  context,
                  perturbation
                );

          r.repetition = rep;

          rows.push(r);
        }
      }
    }
  }

  classify(rows);

  const summary = aggregate(
    rows.filter(
      (r) => !r.fatalError
    )
  );

  const fatalTrials =
    rows.filter(
      (r) => r.fatalError
    ).length;

  const maxPiDifference =
    Math.max(
      0,
      ...summary.map(
        (g) =>
          g.piAbsoluteDifference
      )
    );

  const output = {
    experiment:
      "Morgan multi-hop controlled path propagation",

    repetitionsPerGroup: REPS,
    totalTrials: rows.length,
    fatalTrials,

    paths: PATHS,

    formalModel: {
      jointActivation:
        "alpha_P(p,x) = P(intersection_{e in P}{A_e=1} | p,x)",

      conditionalPropagation:
        "q_P(p,x,s) = P(I_P=1 | A_P=1,p,x,s)",

      effectiveControlledImpact:
        "pi_P(p,x,s) = alpha_P(p,x) * q_P(p,x,s)",

      optionalOccurrenceWeighted:
        "R_P(p,x,s) = lambda_P(p,x,s) * alpha_P(p,x) * q_P(p,x,s)",

      caution:
        "alpha_P is measured jointly. Do not replace it with a product of marginal edge activation probabilities without justified dependence assumptions.",
    },

    consistency: {
      maxAbsPiDirectMinusAlphaTimesQ:
        maxPiDifference,
    },

    summary,
    trials: rows,
  };

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "morgan-multihop-path-propagation.json"
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
    "edge1ActivationRate",
    "edge2ActivationRate",
    "alphaPath",
    "pathActiveTrials",
    "impactedTrials",
    "qPathConditionalOnActive",
    "piPathDirect",
    "piPathModel",
    "piAbsoluteDifference",
    "medianElapsedMs",
    "meanElapsedDeltaMs",
    "uniqueStatusCodes",
    "impactType",
  ];

  const csv = [
    headers.join(","),
    ...summary.map((g) => {
      const row = {
        ...g,
        uniqueStatusCodes:
          g.uniqueStatusCodes.join("|"),
      };

      return headers
        .map(
          (h) =>
            csvEscape(row[h])
        )
        .join(",");
    }),
  ].join("\n");

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "morgan-multihop-path-propagation-summary.csv"
    ),
    csv,
    "utf8"
  );

  const report = [];

  report.push(
    "MORGAN MULTI-HOP CONTROLLED PATH PROPAGATION EXPERIMENT"
  );
  report.push(
    "======================================================="
  );
  report.push("");

  report.push("PATHS");
  report.push("-----");
  report.push(
    `PA: ${PATHS.PA.label}`
  );
  report.push(
    `PB: ${PATHS.PB.label}`
  );
  report.push("");

  report.push("PATH-LEVEL MODEL");
  report.push("----------------");
  report.push(
    "alpha_P(p,x) = P(all path edges active | p,x)"
  );
  report.push(
    "q_P(p,x,s) = P(path-level impact | path active,p,x,s)"
  );
  report.push(
    "pi_P(p,x,s) = alpha_P(p,x) * q_P(p,x,s)"
  );
  report.push("");
  report.push(
    "alpha_P is measured from JOINT path activation; independence among path edges is not assumed."
  );
  report.push("");

  report.push("RESULTS");
  report.push("-------");

  for (const pathId of ["PA", "PB"]) {
    report.push(
      `${pathId}: ${PATHS[pathId].label}`
    );

    const groups = summary.filter(
      (g) => g.pathId === pathId
    );

    for (const g of groups) {
      report.push(
        `  ${g.context} | ${g.perturbation}`
      );

      report.push(
        `    edge1=${fmt(g.edge1ActivationRate)} ` +
        `edge2=${fmt(g.edge2ActivationRate)} ` +
        `alpha_P=${fmt(g.alphaPath)}`
      );

      report.push(
        `    active=${g.pathActiveTrials}/${g.trials} ` +
        `impacted=${g.impactedTrials}/${g.trials} ` +
        `q_P=${fmt(g.qPathConditionalOnActive)} ` +
        `pi_direct=${fmt(g.piPathDirect)} ` +
        `alpha*q=${fmt(g.piPathModel)}`
      );

      report.push(
        `    impact=${g.impactType} ` +
        `HTTP=${g.uniqueStatusCodes.join("|") || "NA"}`
      );
    }

    report.push("");
  }

  report.push("CONSISTENCY");
  report.push("-----------");
  report.push(
    `max |pi_direct - alpha_P*q_P| = ${fmt(maxPiDifference, 4)}`
  );
  report.push("");

  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "A topologically present multi-hop dependency path produces controlled impact only when the entire relevant runtime path is jointly active."
  );
  report.push(
    "Inactive path contexts provide negative controls: terminal perturbations do not create measured path impact when joint path activation is zero."
  );
  report.push(
    "For active contexts, q_P characterizes propagation conditional on observed traversal of the complete 2-hop path."
  );
  report.push(
    "The equality pi_P = alpha_P*q_P is an internal decomposition identity for these grouped observations, not evidence that individual path edges are statistically independent."
  );
  report.push(
    "The perturbations are controlled mechanisms and do not estimate natural vulnerability or compromise frequency."
  );
  report.push(
    `Fatal trials: ${fatalTrials}`
  );

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "morgan-multihop-path-propagation-report.txt"
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
    "  results/multihop-path-propagation/morgan-multihop-path-propagation-report.txt"
  );
  console.log(
    "  results/multihop-path-propagation/morgan-multihop-path-propagation-summary.csv"
  );
  console.log(
    "  results/multihop-path-propagation/morgan-multihop-path-propagation.json"
  );
}

main();
