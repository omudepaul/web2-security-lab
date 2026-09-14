#!/usr/bin/env node
"use strict";

/*
  body_parser_multi_type_propagation_experiment.js

  Experiment 4: Multi-type propagation from body-parser to the application.

  Real dependency path:
    research-app -> express -> body-parser

  Dependency direction:
    express -> body-parser means express depends on body-parser.

  Impact direction studied:
    body-parser -> express/application

  Synthetic perturbations:
    CORRUPTION : changes req.body.probe from "healthy" to "corrupted"
    EXCEPTION  : injects a controlled body-parser boundary error
    DELAY      : injects a controlled 100 ms delay
    MALFORMED  : removes the expected req.body.probe field

  Safety:
    - no real vulnerability exploitation
    - no external targets
    - no permanent modification of node_modules

  Outputs:
    results/body-parser-propagation/body-parser-multitype-report.txt
    results/body-parser-propagation/body-parser-multitype-results.csv
    results/body-parser-propagation/body-parser-multitype-results.json
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { performance } = require("perf_hooks");

const express = require("express");
const bodyParser = require("body-parser");

const app = express();

const INJECTED_DELAY_MS = 100;
const LATENCY_IMPACT_THRESHOLD_MS = 75;
const REPETITIONS_PER_CELL = 15;

let experimentMode = "BASELINE";
let activeTrial = null;

function controlledSleep(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

/*
  Real body-parser middleware.
  We wrap it so the synthetic perturbation is applied at the body-parser
  boundary, after real URL-encoded parsing has occurred.
*/
const realUrlencoded = bodyParser.urlencoded({ extended: true });

function experimentalBodyParser(req, res, next) {
  realUrlencoded(req, res, (err) => {
    if (err) return next(err);

    if (activeTrial) {
      activeTrial.bodyParserInvoked = true;
    }

    const triggerPresent =
      req.body &&
      (String(req.body.trigger || "") === "1" ||
        String(req.body.trigger || "").toLowerCase() === "true");

    if (!triggerPresent || experimentMode === "BASELINE") {
      return next();
    }

    if (activeTrial) {
      activeTrial.syntheticPerturbationActivated = true;
    }

    switch (experimentMode) {
      case "CORRUPTION":
        if (
          req.body &&
          Object.prototype.hasOwnProperty.call(req.body, "probe")
        ) {
          req.body.probe = "corrupted";
        }
        return next();

      case "EXCEPTION":
        return next(new Error("SYNTHETIC_BODY_PARSER_EXCEPTION"));

      case "DELAY":
        controlledSleep(INJECTED_DELAY_MS);
        return next();

      case "MALFORMED":
        if (req.body) {
          delete req.body.probe;
          req.body.syntheticMalformed = true;
        }
        return next();

      default:
        return next();
    }
  });
}

app.use(experimentalBodyParser);

app.post("/form", (req, res) => {
  const hasProbe =
    req.body &&
    Object.prototype.hasOwnProperty.call(req.body, "probe");

  const probe = hasProbe ? req.body.probe : null;
  const schemaValid = hasProbe && typeof probe === "string";

  const integrityImpact = schemaValid && probe !== "healthy";
  const malformedImpact = !schemaValid;

  if (activeTrial) {
    activeTrial.parentObservedProbe = probe;
    activeTrial.parentSchemaValid = schemaValid;
    activeTrial.parentIntegrityImpact = integrityImpact;
    activeTrial.parentMalformedImpact = malformedImpact;
  }

  res.json({
    path: "body",
    probe,
    schemaValid,
    integrityImpact,
    malformedImpact,
  });
});

app.use((err, req, res, next) => {
  if (activeTrial) {
    activeTrial.serverExceptionObserved = true;
  }

  res.status(500).json({
    error: "controlled_dependency_exception",
    message:
      err && err.message === "SYNTHETIC_BODY_PARSER_EXCEPTION"
        ? err.message
        : "controlled_server_error",
  });
});

function requestJson({ port, body }) {
  return new Promise((resolve, reject) => {
    const payload = body || "";
    const start = performance.now();

    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/form",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          const elapsedMs = performance.now() - start;

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }

          resolve({
            statusCode: res.statusCode,
            response: parsed,
            responseMs: elapsedMs,
          });
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(fileName, rows) {
  const headers = [
    "trialId",
    "mode",
    "workload",
    "trigger",
    "bodyParserInvoked",
    "syntheticPerturbationActivated",
    "httpStatus",
    "responseMs",
    "availabilityImpact",
    "integrityImpact",
    "latencyImpact",
    "malformedImpact",
    "anyImpact",
    "parentObservedProbe",
    "parentSchemaValid",
    "serverExceptionObserved",
  ];

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) =>
      headers.map((h) => csvEscape(r[h])).join(",")
    ),
  ];

  fs.writeFileSync(fileName, lines.join("\n"), "utf8");
}

function fraction(n, d) {
  return d ? n / d : null;
}

function targetDimension(mode) {
  switch (mode) {
    case "CORRUPTION":
      return "integrityImpact";
    case "EXCEPTION":
      return "availabilityImpact";
    case "DELAY":
      return "latencyImpact";
    case "MALFORMED":
      return "malformedImpact";
    default:
      return "anyImpact";
  }
}

function summarize(rows, mode, workload) {
  const subset = rows.filter(
    (r) => r.mode === mode && r.workload === workload
  );

  const dimension = targetDimension(mode);
  const impacted = subset.filter((r) => Boolean(r[dimension])).length;

  const avgResponseMs =
    subset.length === 0
      ? null
      : subset.reduce((sum, r) => sum + r.responseMs, 0) /
        subset.length;

  return {
    mode,
    workload,
    targetDimension: dimension,
    runs: subset.length,
    impactedRuns: impacted,
    qHat: fraction(impacted, subset.length),
    averageResponseMs: avgResponseMs,
  };
}

async function main() {
  const outputDir = path.join(
    process.cwd(),
    "results",
    "body-parser-propagation"
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  const port = server.address().port;

  const modes = [
    "BASELINE",
    "CORRUPTION",
    "EXCEPTION",
    "DELAY",
    "MALFORMED",
  ];

  const workloads = [
    { name: "BENIGN", trigger: false },
    { name: "TRIGGERED", trigger: true },
  ];

  const rows = [];
  let trialId = 0;

  console.log("BODY-PARSER MULTI-TYPE PROPAGATION EXPERIMENT");
  console.log("=============================================");
  console.log(`Local test server port: ${port}`);
  console.log(`Repetitions per cell: ${REPETITIONS_PER_CELL}`);
  console.log(`Injected delay: ${INJECTED_DELAY_MS} ms`);
  console.log(
    `Latency threshold: ${LATENCY_IMPACT_THRESHOLD_MS} ms`
  );
  console.log("");

  for (const mode of modes) {
    experimentMode = mode;

    for (const workload of workloads) {
      for (let rep = 1; rep <= REPETITIONS_PER_CELL; rep++) {
        trialId += 1;

        activeTrial = {
          trialId,
          mode,
          workload: workload.name,
          trigger: workload.trigger,
          bodyParserInvoked: false,
          syntheticPerturbationActivated: false,
          parentObservedProbe: null,
          parentSchemaValid: null,
          parentIntegrityImpact: false,
          parentMalformedImpact: false,
          serverExceptionObserved: false,
        };

        const params = workload.trigger
          ? "probe=healthy&trigger=1"
          : "probe=healthy&trigger=0";

        const result = await requestJson({
          port,
          body: params,
        });

        const availabilityImpact = result.statusCode >= 500;

        const integrityImpact = Boolean(
          result.response && result.response.integrityImpact
        );

        const malformedImpact = Boolean(
          result.response && result.response.malformedImpact
        );

        const latencyImpact =
          result.responseMs >= LATENCY_IMPACT_THRESHOLD_MS;

        const anyImpact =
          availabilityImpact ||
          integrityImpact ||
          malformedImpact ||
          latencyImpact;

        rows.push({
          ...activeTrial,
          httpStatus: result.statusCode,
          responseMs: Number(result.responseMs.toFixed(3)),
          availabilityImpact,
          integrityImpact,
          latencyImpact,
          malformedImpact,
          anyImpact,
        });

        activeTrial = null;
      }
    }
  }

  await new Promise((resolve) => server.close(resolve));

  const summaries = [];
  for (const mode of modes) {
    for (const workload of ["BENIGN", "TRIGGERED"]) {
      summaries.push(summarize(rows, mode, workload));
    }
  }

  const baselineRows = rows.filter((r) => r.mode === "BASELINE");
  const baselineImpacts = baselineRows.filter((r) => r.anyImpact).length;

  const output = {
    model: {
      dependencyPath: "research-app -> express -> body-parser",
      impactDirection: "body-parser -> express/application",
      estimator:
        "q_hat^(s,W) = impacted runs / total runs for perturbation s and workload W",
      safety:
        "Synthetic local perturbations only; no real vulnerability exploitation.",
    },
    configuration: {
      repetitionsPerCell: REPETITIONS_PER_CELL,
      totalTrials: rows.length,
      injectedDelayMs: INJECTED_DELAY_MS,
      latencyImpactThresholdMs: LATENCY_IMPACT_THRESHOLD_MS,
    },
    validation: {
      baselineImpactCount: baselineImpacts,
      baselineShouldBeZero: baselineImpacts === 0,
    },
    summaries,
    trials: rows,
  };

  const jsonPath = path.join(
    outputDir,
    "body-parser-multitype-results.json"
  );
  const csvPath = path.join(
    outputDir,
    "body-parser-multitype-results.csv"
  );
  const reportPath = path.join(
    outputDir,
    "body-parser-multitype-report.txt"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  writeCsv(csvPath, rows);

  const report = [];

  report.push("BODY-PARSER MULTI-TYPE PROPAGATION REPORT");
  report.push("========================================");
  report.push("");
  report.push("Real dependency path:");
  report.push("  research-app -> express -> body-parser");
  report.push("");
  report.push("Impact direction studied:");
  report.push("  body-parser -> express/application");
  report.push("");
  report.push("Synthetic perturbations:");
  report.push(
    "  CORRUPTION : probe=healthy becomes probe=corrupted"
  );
  report.push(
    "  EXCEPTION  : controlled exception at body-parser boundary"
  );
  report.push(
    `  DELAY      : controlled ${INJECTED_DELAY_MS} ms delay`
  );
  report.push(
    "  MALFORMED  : expected probe field is removed"
  );
  report.push("");
  report.push(`Total trials: ${rows.length}`);
  report.push(`Baseline runs with any impact: ${baselineImpacts}`);
  report.push("");
  report.push("TRIGGERED WORKLOAD PROPAGATION");
  report.push("------------------------------");

  for (const mode of [
    "CORRUPTION",
    "EXCEPTION",
    "DELAY",
    "MALFORMED",
  ]) {
    const s = summaries.find(
      (x) => x.mode === mode && x.workload === "TRIGGERED"
    );

    report.push(
      `${mode.padEnd(10)} | ${s.targetDimension} | ` +
        `impacted=${s.impactedRuns}/${s.runs} | ` +
        `q_hat=${s.qHat.toFixed(4)} | ` +
        `avg_ms=${s.averageResponseMs.toFixed(3)}`
    );
  }

  report.push("");
  report.push("BENIGN WORKLOAD CONTROL");
  report.push("-----------------------");

  for (const mode of [
    "CORRUPTION",
    "EXCEPTION",
    "DELAY",
    "MALFORMED",
  ]) {
    const s = summaries.find(
      (x) => x.mode === mode && x.workload === "BENIGN"
    );

    report.push(
      `${mode.padEnd(10)} | ${s.targetDimension} | ` +
        `impacted=${s.impactedRuns}/${s.runs} | ` +
        `q_hat=${s.qHat.toFixed(4)} | ` +
        `avg_ms=${s.averageResponseMs.toFixed(3)}`
    );
  }

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "These q_hat values measure controlled propagation from body-parser"
  );
  report.push(
    "to the application under a defined workload and perturbation type."
  );
  report.push(
    "They are experimental propagation measurements, not real-world"
  );
  report.push(
    "compromise probabilities."
  );

  fs.writeFileSync(reportPath, report.join("\n"), "utf8");

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log(
    "  results\\body-parser-propagation\\body-parser-multitype-report.txt"
  );
  console.log(
    "  results\\body-parser-propagation\\body-parser-multitype-results.csv"
  );
  console.log(
    "  results\\body-parser-propagation\\body-parser-multitype-results.json"
  );
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
