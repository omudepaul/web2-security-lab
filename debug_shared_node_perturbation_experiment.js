#!/usr/bin/env node
"use strict";

/*
  debug_shared_node_perturbation_experiment.js

  Experiment 7: Shared-node perturbation propagation for debug@4.4.3

  Why this experiment is different
  --------------------------------
  debug is a logging/diagnostic dependency, so forcing the same "data
  corruption" semantics used for qs/body-parser would be artificial.

  Instead, this experiment uses perturbations appropriate to a logging node:
    DROP_LOG     - suppress a targeted debug record
    CORRUPT_LOG  - alter a targeted debug record
    DUPLICATE_LOG- emit the targeted debug record twice
    DELAY        - delay each targeted debug invocation

  Shared topological parents studied:
    body-parser, express, finalhandler, router, send

  Workloads:
    BASIC_ROUTE, FORM_BODY, STATIC_FILE, MISSING_ROUTE, ERROR_ROUTE

  The perturbation is targeted at ONE parent edge at a time. This lets us
  distinguish:
    topological exposure
    runtime edge activation
    workload-conditioned perturbation propagation

  Safety:
    - local synthetic experiment only
    - no real vulnerability exploitation
    - no node_modules files are modified
    - no external target is contacted

  Outputs:
    results/debug-shared-node-perturbation/debug-shared-perturbation-report.txt
    results/debug-shared-node-perturbation/debug-shared-perturbation-results.csv
    results/debug-shared-node-perturbation/debug-shared-perturbation-results.json
*/

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { performance } = require("perf_hooks");

// Enable debug namespaces before loading debug/Express.
// Actual console output is suppressed by an in-memory sink below.
process.env.DEBUG = "*";

const TOP_DEBUG_PACKAGE = require.resolve("debug/package.json");
const TOP_DEBUG_VERSION = require("debug/package.json").version;
const TOP_DEBUG_ENTRY = require.resolve("debug");

const NESTED_DEBUG_PACKAGE =
  require.resolve("express-session/node_modules/debug/package.json");
const NESTED_DEBUG_VERSION =
  require("express-session/node_modules/debug/package.json").version;

const PARENTS = [
  "body-parser",
  "express",
  "finalhandler",
  "router",
  "send",
];

const PERTURBATIONS = [
  "DROP_LOG",
  "CORRUPT_LOG",
  "DUPLICATE_LOG",
  "DELAY",
];

const DELAY_PER_INVOCATION_MS = 25;
const REPETITIONS = 5;

let activeConfig = null;
let activeTrial = null;

function controlledSleep(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

function normalizeStackLine(line) {
  return String(line || "").replace(/\//g, "\\").toLowerCase();
}

function detectParentFromStack() {
  const err = new Error();
  const stack = err.stack ? err.stack.split("\n").slice(2) : [];

  for (const raw of stack) {
    const line = normalizeStackLine(raw);

    if (line.includes("\\node_modules\\body-parser\\")) return "body-parser";
    if (line.includes("\\node_modules\\finalhandler\\")) return "finalhandler";
    if (line.includes("\\node_modules\\router\\")) return "router";
    if (line.includes("\\node_modules\\send\\")) return "send";
    if (line.includes("\\node_modules\\express\\")) return "express";
  }

  return "unknown";
}

function countMap(obj, key, inc = 1) {
  obj[key] = (obj[key] || 0) + inc;
}

// Load the real shared debug@4.4.3 instance.
const originalDebugFactory = require("debug");

// Replace only the in-memory export. No file on disk is changed.
const instrumentedDebugFactory = new Proxy(originalDebugFactory, {
  apply(target, thisArg, args) {
    const namespace = String(args[0] || "");
    const realLogger = Reflect.apply(target, thisArg, args);

    // Keep DEBUG enabled but suppress terminal noise.
    realLogger.log = function () {};

    return new Proxy(realLogger, {
      apply(loggerTarget, loggerThis, loggerArgs) {
        const parent = detectParentFromStack();

        if (activeTrial) {
          activeTrial.totalDebugInvocations += 1;
          countMap(activeTrial.parentInvocations, parent);
          countMap(activeTrial.namespaceInvocations, namespace);
        }

        const targeted =
          activeConfig &&
          parent === activeConfig.targetParent;

        if (targeted && activeTrial) {
          activeTrial.targetParentInvocations += 1;
          activeTrial.perturbationActivated = true;
        }

        // Baseline or non-targeted edge: pass through normally.
        if (!targeted || !activeConfig) {
          if (activeTrial && realLogger.enabled) {
            activeTrial.emittedRecords += 1;
          }
          return Reflect.apply(
            loggerTarget,
            loggerThis,
            loggerArgs
          );
        }

        switch (activeConfig.perturbation) {
          case "DROP_LOG":
            if (activeTrial && realLogger.enabled) {
              activeTrial.droppedRecords += 1;
            }
            return undefined;

          case "CORRUPT_LOG": {
            if (activeTrial && realLogger.enabled) {
              activeTrial.corruptedRecords += 1;
              activeTrial.emittedRecords += 1;
            }

            const corruptedArgs = [
              "[SYNTHETIC_CORRUPTION]",
              ...loggerArgs,
            ];

            return Reflect.apply(
              loggerTarget,
              loggerThis,
              corruptedArgs
            );
          }

          case "DUPLICATE_LOG": {
            if (activeTrial && realLogger.enabled) {
              activeTrial.emittedRecords += 2;
              activeTrial.duplicateExtraRecords += 1;
            }

            Reflect.apply(
              loggerTarget,
              loggerThis,
              loggerArgs
            );

            return Reflect.apply(
              loggerTarget,
              loggerThis,
              loggerArgs
            );
          }

          case "DELAY":
            controlledSleep(DELAY_PER_INVOCATION_MS);

            if (activeTrial) {
              activeTrial.injectedDelayMs +=
                DELAY_PER_INVOCATION_MS;
            }

            if (activeTrial && realLogger.enabled) {
              activeTrial.emittedRecords += 1;
            }

            return Reflect.apply(
              loggerTarget,
              loggerThis,
              loggerArgs
            );

          default:
            return Reflect.apply(
              loggerTarget,
              loggerThis,
              loggerArgs
            );
        }
      },
    });
  },
});

require.cache[TOP_DEBUG_ENTRY].exports = instrumentedDebugFactory;

// Load packages only after instrumentation.
const express = require("express");
const bodyParser = require("body-parser");

const app = express();

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "debug-perturbation-")
);
const sampleFile = path.join(tempDir, "sample.txt");

fs.writeFileSync(
  sampleFile,
  "debug-shared-node-perturbation-fixture\n",
  "utf8"
);

app.get("/basic", (req, res) => {
  res.json({ ok: true, workload: "BASIC_ROUTE" });
});

app.post(
  "/form",
  bodyParser.urlencoded({ extended: true }),
  (req, res) => {
    res.json({
      ok: true,
      workload: "FORM_BODY",
      probe: req.body && req.body.probe,
    });
  }
);

app.use("/static", express.static(tempDir));

app.get("/boom", (req, res, next) => {
  next(new Error("CONTROLLED_TEST_ERROR"));
});

// MISSING_ROUTE is simply an unmatched path.

const WORKLOADS = [
  {
    name: "BASIC_ROUTE",
    method: "GET",
    route: "/basic",
    expectedStatus: 200,
  },
  {
    name: "FORM_BODY",
    method: "POST",
    route: "/form",
    body: "probe=healthy",
    contentType: "application/x-www-form-urlencoded",
    expectedStatus: 200,
  },
  {
    name: "STATIC_FILE",
    method: "GET",
    route: "/static/sample.txt",
    expectedStatus: 200,
  },
  {
    name: "MISSING_ROUTE",
    method: "GET",
    route: "/does-not-exist",
    expectedStatus: 404,
  },
  {
    name: "ERROR_ROUTE",
    method: "GET",
    route: "/boom",
    expectedStatus: 500,
  },
];

function request({
  port,
  method,
  route,
  body = "",
  contentType = null,
}) {
  return new Promise((resolve, reject) => {
    const headers = {};

    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    const start = performance.now();

    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: route,
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            responseBytes: Buffer.byteLength(data),
            responseMs: performance.now() - start,
          });
        });
      }
    );

    req.on("error", reject);

    if (body) req.write(body);
    req.end();
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(fileName, rows) {
  const headers = [
    "trialId",
    "mode",
    "targetParent",
    "perturbation",
    "workload",
    "expectedStatus",
    "statusCode",
    "responseMs",
    "targetParentInvocations",
    "perturbationActivated",
    "droppedRecords",
    "corruptedRecords",
    "duplicateExtraRecords",
    "injectedDelayMs",
    "observabilityAvailabilityImpact",
    "observabilityIntegrityImpact",
    "observabilityDuplicationImpact",
    "latencyImpact",
    "applicationStatusImpact",
    "parentInvocations",
  ];

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) =>
      headers.map((h) => csvEscape(r[h])).join(",")
    ),
  ];

  fs.writeFileSync(
    fileName,
    lines.join("\n"),
    "utf8"
  );
}

function summarizeCondition(
  rows,
  targetParent,
  perturbation,
  workload
) {
  const subset = rows.filter(
    (r) =>
      r.mode === "PERTURBED" &&
      r.targetParent === targetParent &&
      r.perturbation === perturbation &&
      r.workload === workload
  );

  const activated = subset.filter(
    (r) => r.perturbationActivated
  ).length;

  let impactField;

  switch (perturbation) {
    case "DROP_LOG":
      impactField = "observabilityAvailabilityImpact";
      break;
    case "CORRUPT_LOG":
      impactField = "observabilityIntegrityImpact";
      break;
    case "DUPLICATE_LOG":
      impactField = "observabilityDuplicationImpact";
      break;
    case "DELAY":
      impactField = "latencyImpact";
      break;
    default:
      impactField = "applicationStatusImpact";
  }

  const impacted = subset.filter(
    (r) => r[impactField]
  ).length;

  const applicationStatusImpacts = subset.filter(
    (r) => r.applicationStatusImpact
  ).length;

  const avgResponseMs =
    subset.reduce((sum, r) => sum + r.responseMs, 0) /
    subset.length;

  const avgInjectedDelayMs =
    subset.reduce(
      (sum, r) => sum + r.injectedDelayMs,
      0
    ) / subset.length;

  return {
    targetParent,
    perturbation,
    workload,
    trials: subset.length,
    activatedTrials: activated,
    activationRate: activated / subset.length,
    impactDimension: impactField,
    impactedTrials: impacted,
    qHat: impacted / subset.length,
    qHatGivenActivation:
      activated === 0 ? null : impacted / activated,
    applicationStatusImpacts,
    avgResponseMs,
    avgInjectedDelayMs,
  };
}

async function main() {
  const outputDir = path.join(
    process.cwd(),
    "results",
    "debug-shared-node-perturbation"
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) =>
    server.once("listening", resolve)
  );

  const port = server.address().port;

  const rows = [];
  let trialId = 0;

  console.log(
    "DEBUG@4.4.3 SHARED-NODE PERTURBATION EXPERIMENT"
  );
  console.log(
    "================================================"
  );
  console.log(`Shared debug version: ${TOP_DEBUG_VERSION}`);
  console.log(`Shared path: ${TOP_DEBUG_PACKAGE}`);
  console.log(
    `Separate nested express-session debug: ${NESTED_DEBUG_VERSION}`
  );
  console.log(`Nested path: ${NESTED_DEBUG_PACKAGE}`);
  console.log(`Local server port: ${port}`);
  console.log(`Repetitions per condition: ${REPETITIONS}`);
  console.log(
    `Delay per targeted invocation: ${DELAY_PER_INVOCATION_MS} ms`
  );
  console.log("");

  // Baseline workload runs.
  activeConfig = null;

  for (const workload of WORKLOADS) {
    for (let rep = 0; rep < REPETITIONS; rep++) {
      trialId += 1;

      activeTrial = {
        trialId,
        totalDebugInvocations: 0,
        targetParentInvocations: 0,
        emittedRecords: 0,
        droppedRecords: 0,
        corruptedRecords: 0,
        duplicateExtraRecords: 0,
        injectedDelayMs: 0,
        perturbationActivated: false,
        parentInvocations: {},
        namespaceInvocations: {},
      };

      const result = await request({
        port,
        ...workload,
      });

      rows.push({
        trialId,
        mode: "BASELINE",
        targetParent: "",
        perturbation: "",
        workload: workload.name,
        expectedStatus: workload.expectedStatus,
        statusCode: result.statusCode,
        responseMs: Number(result.responseMs.toFixed(3)),
        targetParentInvocations: 0,
        perturbationActivated: false,
        droppedRecords: 0,
        corruptedRecords: 0,
        duplicateExtraRecords: 0,
        injectedDelayMs: 0,
        observabilityAvailabilityImpact: false,
        observabilityIntegrityImpact: false,
        observabilityDuplicationImpact: false,
        latencyImpact: false,
        applicationStatusImpact:
          result.statusCode !== workload.expectedStatus,
        parentInvocations:
          activeTrial.parentInvocations,
      });

      activeTrial = null;
    }
  }

  // Perturbed runs: target one topological parent edge at a time.
  for (const targetParent of PARENTS) {
    for (const perturbation of PERTURBATIONS) {
      activeConfig = {
        targetParent,
        perturbation,
      };

      for (const workload of WORKLOADS) {
        for (let rep = 0; rep < REPETITIONS; rep++) {
          trialId += 1;

          activeTrial = {
            trialId,
            totalDebugInvocations: 0,
            targetParentInvocations: 0,
            emittedRecords: 0,
            droppedRecords: 0,
            corruptedRecords: 0,
            duplicateExtraRecords: 0,
            injectedDelayMs: 0,
            perturbationActivated: false,
            parentInvocations: {},
            namespaceInvocations: {},
          };

          const result = await request({
            port,
            ...workload,
          });

          rows.push({
            trialId,
            mode: "PERTURBED",
            targetParent,
            perturbation,
            workload: workload.name,
            expectedStatus: workload.expectedStatus,
            statusCode: result.statusCode,
            responseMs: Number(result.responseMs.toFixed(3)),
            targetParentInvocations:
              activeTrial.targetParentInvocations,
            perturbationActivated:
              activeTrial.perturbationActivated,
            droppedRecords:
              activeTrial.droppedRecords,
            corruptedRecords:
              activeTrial.corruptedRecords,
            duplicateExtraRecords:
              activeTrial.duplicateExtraRecords,
            injectedDelayMs:
              activeTrial.injectedDelayMs,
            observabilityAvailabilityImpact:
              activeTrial.droppedRecords > 0,
            observabilityIntegrityImpact:
              activeTrial.corruptedRecords > 0,
            observabilityDuplicationImpact:
              activeTrial.duplicateExtraRecords > 0,
            latencyImpact:
              activeTrial.injectedDelayMs > 0,
            applicationStatusImpact:
              result.statusCode !== workload.expectedStatus,
            parentInvocations:
              activeTrial.parentInvocations,
          });

          activeTrial = null;
        }
      }
    }
  }

  await new Promise((resolve) =>
    server.close(resolve)
  );

  try {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  } catch {}

  const summaries = [];

  for (const parent of PARENTS) {
    for (const perturbation of PERTURBATIONS) {
      for (const workload of WORKLOADS) {
        summaries.push(
          summarizeCondition(
            rows,
            parent,
            perturbation,
            workload.name
          )
        );
      }
    }
  }

  const baselineStatusImpacts = rows.filter(
    (r) =>
      r.mode === "BASELINE" &&
      r.applicationStatusImpact
  ).length;

  const output = {
    purpose:
      "Measure workload-conditioned propagation from a shared logging dependency through individual active parent edges.",
    model: {
      sharedNode: "debug@4.4.3",
      topologicalParents: PARENTS,
      perturbations: PERTURBATIONS,
      estimator:
        "q_hat = impacted trials / total trials for target parent, perturbation, and workload",
      conditionalEstimator:
        "q_hat_given_activation = impacted trials / trials where the targeted runtime edge was activated",
      interpretation:
        "Topological exposure and runtime activation are distinct; observability impacts are dependency-role-specific.",
    },
    configuration: {
      repetitionsPerCondition: REPETITIONS,
      baselineTrials:
        WORKLOADS.length * REPETITIONS,
      perturbedTrials:
        PARENTS.length *
        PERTURBATIONS.length *
        WORKLOADS.length *
        REPETITIONS,
      totalTrials: rows.length,
      delayPerTargetedInvocationMs:
        DELAY_PER_INVOCATION_MS,
      workloads: WORKLOADS.map((w) => w.name),
    },
    validation: {
      baselineApplicationStatusImpacts:
        baselineStatusImpacts,
    },
    summaries,
    trials: rows,
  };

  const jsonPath = path.join(
    outputDir,
    "debug-shared-perturbation-results.json"
  );

  const csvPath = path.join(
    outputDir,
    "debug-shared-perturbation-results.csv"
  );

  const reportPath = path.join(
    outputDir,
    "debug-shared-perturbation-report.txt"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  writeCsv(csvPath, rows);

  const report = [];

  report.push(
    "DEBUG@4.4.3 SHARED-NODE PERTURBATION REPORT"
  );
  report.push(
    "==========================================="
  );
  report.push("");
  report.push(`Shared node: debug@${TOP_DEBUG_VERSION}`);
  report.push(`Shared path: ${TOP_DEBUG_PACKAGE}`);
  report.push(
    `Separate nested instance excluded: debug@${NESTED_DEBUG_VERSION}`
  );
  report.push("");
  report.push(
    `Total trials: ${rows.length}`
  );
  report.push(
    `Baseline application-status impacts: ${baselineStatusImpacts}`
  );
  report.push(
    `Repetitions per condition: ${REPETITIONS}`
  );
  report.push("");
  report.push(
    "Perturbations: DROP_LOG, CORRUPT_LOG, DUPLICATE_LOG, DELAY"
  );
  report.push("");
  report.push(
    "SUMMARY BY TARGET PARENT AND WORKLOAD"
  );
  report.push(
    "-------------------------------------"
  );

  for (const parent of PARENTS) {
    report.push("");
    report.push(`TARGET PARENT: ${parent}`);

    for (const workload of WORKLOADS) {
      report.push(`  ${workload.name}`);

      for (const perturbation of PERTURBATIONS) {
        const s = summaries.find(
          (x) =>
            x.targetParent === parent &&
            x.perturbation === perturbation &&
            x.workload === workload.name
        );

        const qConditional =
          s.qHatGivenActivation === null
            ? "NA"
            : s.qHatGivenActivation.toFixed(4);

        report.push(
          `    ${perturbation.padEnd(13)} ` +
            `active=${s.activatedTrials}/${s.trials} ` +
            `activation=${s.activationRate.toFixed(4)} ` +
            `q_hat=${s.qHat.toFixed(4)} ` +
            `q|active=${qConditional} ` +
            `avg_ms=${s.avgResponseMs.toFixed(3)} ` +
            `inj_delay=${s.avgInjectedDelayMs.toFixed(1)}`
        );
      }
    }
  }

  report.push("");
  report.push(
    "APPLICATION STATUS CONTROL"
  );
  report.push(
    "--------------------------"
  );

  const perturbedStatusImpacts = rows.filter(
    (r) =>
      r.mode === "PERTURBED" &&
      r.applicationStatusImpact
  ).length;

  report.push(
    `Perturbed trials with unexpected HTTP status: ${perturbedStatusImpacts}`
  );

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "For this logging dependency, propagation is measured primarily in"
  );
  report.push(
    "observability integrity/availability, duplication, and latency."
  );
  report.push(
    "A topological parent edge with activation=0 under a workload has"
  );
  report.push(
    "q_hat=0 because the workload did not exercise that runtime edge."
  );
  report.push(
    "q|active separates edge activation from propagation once the edge"
  );
  report.push(
    "is actually exercised."
  );
  report.push(
    "Unexpected HTTP-status impact is tracked separately so observability"
  );
  report.push(
    "failure is not incorrectly equated with application failure."
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
    "  results\\debug-shared-node-perturbation\\debug-shared-perturbation-report.txt"
  );
  console.log(
    "  results\\debug-shared-node-perturbation\\debug-shared-perturbation-results.csv"
  );
  console.log(
    "  results\\debug-shared-node-perturbation\\debug-shared-perturbation-results.json"
  );
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);

  try {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
    });
  } catch {}

  process.exit(1);
});
