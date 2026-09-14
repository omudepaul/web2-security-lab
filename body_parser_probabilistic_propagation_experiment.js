#!/usr/bin/env node
"use strict";

/*
  body_parser_probabilistic_propagation_experiment.js

  Experiment 5: Probabilistic propagation / containment calibration
  for body-parser.

  Real dependency path:
    research-app -> express -> body-parser

  Impact direction studied:
    body-parser -> express/application

  Perturbation types:
    CORRUPTION
    EXCEPTION
    DELAY
    MALFORMED

  Containment probabilities:
    0.00, 0.25, 0.50, 0.75

  Expected residual propagation:
    q* = 1 - containmentProbability

  Estimator:
    q_hat = impacted runs / total triggered runs

  Safety:
    - synthetic perturbations only
    - no real vulnerability exploitation
    - no external targets
    - no permanent modification of node_modules

  Outputs:
    results/body-parser-probabilistic/body-parser-probabilistic-report.txt
    results/body-parser-probabilistic/body-parser-probabilistic-results.csv
    results/body-parser-probabilistic/body-parser-probabilistic-results.json
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { performance } = require("perf_hooks");

const express = require("express");
const bodyParser = require("body-parser");

const app = express();

const INJECTED_DELAY_MS = 50;
const LATENCY_THRESHOLD_MS = 25;
const REPETITIONS_PER_CONDITION = 50;

let activeConfig = null;
let activeTrial = null;

// Reproducible PRNG.
let rngState = 0x51b0d1a;
function rand() {
  let x = rngState | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rngState = x | 0;
  return (x >>> 0) / 4294967296;
}

function controlledSleep(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

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

    if (!activeConfig || !triggerPresent) {
      return next();
    }

    if (activeTrial) {
      activeTrial.triggerObserved = true;
    }

    const draw = rand();
    const contained = draw < activeConfig.containmentProbability;

    if (activeTrial) {
      activeTrial.containmentDraw = draw;
      activeTrial.contained = contained;
    }

    if (contained) {
      if (activeTrial) {
        activeTrial.syntheticPerturbationActivated = false;
      }
      return next();
    }

    if (activeTrial) {
      activeTrial.syntheticPerturbationActivated = true;
    }

    switch (activeConfig.perturbation) {
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

  res.json({
    probe,
    schemaValid,
    integrityImpact: schemaValid && probe !== "healthy",
    malformedImpact: !schemaValid,
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
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }

          resolve({
            statusCode: res.statusCode,
            response: parsed,
            responseMs: performance.now() - start,
          });
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function targetDimension(perturbation) {
  switch (perturbation) {
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

function summarize(rows, perturbation, containmentProbability) {
  const subset = rows.filter(
    (r) =>
      r.perturbation === perturbation &&
      r.containmentProbability === containmentProbability
  );

  const dimension = targetDimension(perturbation);
  const impactedRuns = subset.filter((r) => r[dimension]).length;
  const containedRuns = subset.filter((r) => r.contained).length;
  const activatedRuns = subset.filter(
    (r) => r.syntheticPerturbationActivated
  ).length;

  const qHat = impactedRuns / subset.length;
  const qExpected = 1 - containmentProbability;

  return {
    perturbation,
    containmentProbability,
    runs: subset.length,
    containedRuns,
    activatedRuns,
    impactedRuns,
    targetDimension: dimension,
    qExpected,
    qHat,
    absoluteError: Math.abs(qHat - qExpected),
  };
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
    "perturbation",
    "containmentProbability",
    "triggerObserved",
    "containmentDraw",
    "contained",
    "syntheticPerturbationActivated",
    "httpStatus",
    "responseMs",
    "integrityImpact",
    "availabilityImpact",
    "latencyImpact",
    "malformedImpact",
    "anyImpact",
  ];

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) =>
      headers.map((h) => csvEscape(r[h])).join(",")
    ),
  ];

  fs.writeFileSync(fileName, lines.join("\n"), "utf8");
}

async function main() {
  const outputDir = path.join(
    process.cwd(),
    "results",
    "body-parser-probabilistic"
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  const port = server.address().port;

  const perturbations = [
    "CORRUPTION",
    "EXCEPTION",
    "DELAY",
    "MALFORMED",
  ];

  const containmentProbabilities = [0.0, 0.25, 0.5, 0.75];

  const rows = [];
  let trialId = 0;

  console.log("BODY-PARSER PROBABILISTIC PROPAGATION EXPERIMENT");
  console.log("================================================");
  console.log(`Local test server port: ${port}`);
  console.log(
    `Repetitions per condition: ${REPETITIONS_PER_CONDITION}`
  );
  console.log("Seed: 0x51b0d1a");
  console.log("");

  for (const perturbation of perturbations) {
    for (const containmentProbability of containmentProbabilities) {
      activeConfig = {
        perturbation,
        containmentProbability,
      };

      for (
        let rep = 0;
        rep < REPETITIONS_PER_CONDITION;
        rep++
      ) {
        trialId += 1;

        activeTrial = {
          trialId,
          perturbation,
          containmentProbability,
          triggerObserved: false,
          containmentDraw: null,
          contained: false,
          syntheticPerturbationActivated: false,
          bodyParserInvoked: false,
          serverExceptionObserved: false,
        };

        const result = await requestJson({
          port,
          body: "probe=healthy&trigger=1",
        });

        const integrityImpact = Boolean(
          result.response && result.response.integrityImpact
        );

        const malformedImpact = Boolean(
          result.response && result.response.malformedImpact
        );

        const availabilityImpact = result.statusCode >= 500;
        const latencyImpact =
          result.responseMs >= LATENCY_THRESHOLD_MS;

        rows.push({
          ...activeTrial,
          httpStatus: result.statusCode,
          responseMs: Number(result.responseMs.toFixed(3)),
          integrityImpact,
          availabilityImpact,
          latencyImpact,
          malformedImpact,
          anyImpact:
            integrityImpact ||
            availabilityImpact ||
            latencyImpact ||
            malformedImpact,
        });

        activeTrial = null;
      }
    }
  }

  await new Promise((resolve) => server.close(resolve));

  const summaries = [];

  for (const perturbation of perturbations) {
    for (const containmentProbability of containmentProbabilities) {
      summaries.push(
        summarize(rows, perturbation, containmentProbability)
      );
    }
  }

  const meanAbsoluteError =
    summaries.reduce((sum, s) => sum + s.absoluteError, 0) /
    summaries.length;

  const output = {
    purpose:
      "Calibrate intermediate body-parser propagation estimates against known synthetic containment probabilities.",
    model: {
      dependencyPath: "research-app -> express -> body-parser",
      impactDirection: "body-parser -> express/application",
      expected:
        "q* = 1 - containmentProbability",
      estimator:
        "q_hat = impacted triggered runs / total triggered runs",
      interpretation:
        "Calibration against known synthetic ground truth; not a natural compromise probability.",
    },
    configuration: {
      repetitionsPerCondition: REPETITIONS_PER_CONDITION,
      totalTrials: rows.length,
      seed: "0x51b0d1a",
      injectedDelayMs: INJECTED_DELAY_MS,
      latencyThresholdMs: LATENCY_THRESHOLD_MS,
      containmentProbabilities,
    },
    meanAbsoluteError,
    summaries,
    trials: rows,
  };

  const jsonPath = path.join(
    outputDir,
    "body-parser-probabilistic-results.json"
  );

  const csvPath = path.join(
    outputDir,
    "body-parser-probabilistic-results.csv"
  );

  const reportPath = path.join(
    outputDir,
    "body-parser-probabilistic-report.txt"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  writeCsv(csvPath, rows);

  const report = [];

  report.push("BODY-PARSER PROBABILISTIC PROPAGATION REPORT");
  report.push("===========================================");
  report.push("");
  report.push("Real dependency path:");
  report.push("  research-app -> express -> body-parser");
  report.push("");
  report.push("Purpose:");
  report.push(
    "  Validate q_hat against known synthetic containment probabilities."
  );
  report.push("");
  report.push(`Total trials: ${rows.length}`);
  report.push(
    `Repetitions per condition: ${REPETITIONS_PER_CONDITION}`
  );
  report.push("Seed: 0x51b0d1a");
  report.push(
    `Mean absolute estimation error: ${meanAbsoluteError.toFixed(4)}`
  );
  report.push("");
  report.push(
    "q* = 1 - containment probability; q_hat = observed impacted fraction"
  );
  report.push("");
  report.push(
    "PERTURBATION | CONTAIN | q*     | q_hat  | ABS_ERR"
  );
  report.push(
    "-------------|---------|--------|--------|--------"
  );

  for (const s of summaries) {
    report.push(
      `${s.perturbation.padEnd(12)} | ` +
        `${s.containmentProbability.toFixed(2).padEnd(7)} | ` +
        `${s.qExpected.toFixed(4)} | ` +
        `${s.qHat.toFixed(4)} | ` +
        `${s.absoluteError.toFixed(4)}`
    );
  }

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "Intermediate q_hat values occur because a controlled fraction of"
  );
  report.push(
    "synthetic body-parser perturbations are contained before reaching"
  );
  report.push(
    "the application. Agreement between q_hat and q* validates the"
  );
  report.push(
    "estimator in this controlled setting."
  );
  report.push(
    "These are calibration results, not real-world compromise rates."
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
    "  results\\body-parser-probabilistic\\body-parser-probabilistic-report.txt"
  );
  console.log(
    "  results\\body-parser-probabilistic\\body-parser-probabilistic-results.csv"
  );
  console.log(
    "  results\\body-parser-probabilistic\\body-parser-probabilistic-results.json"
  );
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
