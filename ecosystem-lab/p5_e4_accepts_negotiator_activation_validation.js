#!/usr/bin/env node
"use strict";

/*
  P5 E4 ACCEPTS -> NEGOTIATOR ACTIVATION VALIDATION

  Exact edge:
    accepts@1.3.8 -> negotiator@0.6.3

  Predictions were frozen in:
    E4_ACCEPTS_NEGOTIATOR_ACTIVATION_PREDICTION.md

  This validates a controlled runtime mechanism. It does not estimate
  natural failure probability, natural incident frequency, or product risk.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-compression");
const OUTDIR = path.join(
  ROOT,
  "results",
  "e4-p5-accepts-negotiator-activation-validation"
);

const REPS = 10;
const THRESHOLD = 1024;
const LARGE_BODY = "P5 E4 activation validation ".repeat(256);
const SMALL_BODY = "small";

const CONDITIONS = [
  {
    id: "P5-C1_ELIGIBLE_GZIP",
    method: "GET",
    body: "large",
    preEncoded: false,
    acceptEncoding: "gzip",
    predictedA: 1,
    predictedY: 1,
  },
  {
    id: "P5-C2_HEAD_GUARD",
    method: "HEAD",
    body: "large",
    preEncoded: false,
    acceptEncoding: "gzip",
    predictedA: 0,
    predictedY: 0,
  },
  {
    id: "P5-C3_BELOW_THRESHOLD",
    method: "GET",
    body: "small",
    preEncoded: false,
    acceptEncoding: "gzip",
    predictedA: 0,
    predictedY: 0,
  },
  {
    id: "P5-C4_ALREADY_ENCODED",
    method: "GET",
    body: "large",
    preEncoded: true,
    acceptEncoding: "gzip",
    predictedA: 0,
    predictedY: 0,
  },
  {
    id: "P5-C5_IDENTITY_ONLY",
    method: "GET",
    body: "large",
    preEncoded: false,
    acceptEncoding: "identity",
    predictedA: 1,
    predictedY: 0,
  },
];

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

function fmt(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map(column => csvValue(row[column])).join(","));
  }
  return lines.join("\n") + "\n";
}

function lastJsonLine(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch (_) {}
  }

  throw new Error(`Worker returned no JSON result.\nstdout:\n${stdout}`);
}

function verifyVersions() {
  const acceptsPackage = readJson(
    path.join(PRODUCT_DIR, "node_modules", "accepts", "package.json")
  );
  const negotiatorPackage = readJson(
    path.join(PRODUCT_DIR, "node_modules", "negotiator", "package.json")
  );
  const compressionPackage = readJson(
    path.join(PRODUCT_DIR, "node_modules", "compression", "package.json")
  );

  if (acceptsPackage.version !== "1.3.8") {
    throw new Error(
      `Version mismatch: expected accepts@1.3.8, found accepts@${acceptsPackage.version}`
    );
  }

  if (negotiatorPackage.version !== "0.6.3") {
    throw new Error(
      `Version mismatch: expected negotiator@0.6.3, found negotiator@${negotiatorPackage.version}`
    );
  }

  return {
    compressionVersion: compressionPackage.version,
    acceptsVersion: acceptsPackage.version,
    negotiatorVersion: negotiatorPackage.version,
  };
}

async function worker() {
  const conditionId = process.env.E4_CONDITION;
  const condition = CONDITIONS.find(item => item.id === conditionId);
  if (!condition) throw new Error(`Unknown condition: ${conditionId}`);

  const versions = verifyVersions();

  let acceptsLoadCount = 0;
  let acceptsInvocationCount = 0;
  let negotiatorLoadFromAcceptsCount = 0;
  let negotiatorConstructCount = 0;
  let encodingSelectionCalls = 0;
  const encodingArguments = [];
  const encodingResults = [];

  const acceptsIndex = path.normalize(
    path.join(PRODUCT_DIR, "node_modules", "accepts", "index.js")
  );
  const compressionRoot = path.normalize(
    path.join(PRODUCT_DIR, "node_modules", "compression")
  );

  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    const parentFile = path.normalize(
      parent && parent.filename ? parent.filename : ""
    );

    if (request === "negotiator" && parentFile === acceptsIndex) {
      negotiatorLoadFromAcceptsCount += 1;
      const ActualNegotiator = originalLoad.apply(this, arguments);

      function InstrumentedNegotiator(req) {
        negotiatorConstructCount += 1;
        const instance = new ActualNegotiator(req);
        const originalEncodings = instance.encodings;

        instance.encodings = function instrumentedEncodings(...args) {
          encodingSelectionCalls += 1;
          encodingArguments.push(args[0] === undefined ? null : args[0]);
          const result = originalEncodings.apply(this, args);
          encodingResults.push(result);
          return result;
        };

        return instance;
      }

      Object.setPrototypeOf(InstrumentedNegotiator, ActualNegotiator);
      InstrumentedNegotiator.prototype = ActualNegotiator.prototype;
      for (const key of Object.keys(ActualNegotiator)) {
        InstrumentedNegotiator[key] = ActualNegotiator[key];
      }

      return InstrumentedNegotiator;
    }

    if (request === "accepts" && parentFile.startsWith(compressionRoot)) {
      acceptsLoadCount += 1;
      const actualAccepts = originalLoad.apply(this, arguments);

      function instrumentedAccepts(...args) {
        acceptsInvocationCount += 1;
        return actualAccepts(...args);
      }

      Object.setPrototypeOf(instrumentedAccepts, actualAccepts);
      instrumentedAccepts.prototype = actualAccepts.prototype;
      for (const key of Object.keys(actualAccepts)) {
        instrumentedAccepts[key] = actualAccepts[key];
      }

      return instrumentedAccepts;
    }

    return originalLoad.apply(this, arguments);
  };

  const compression = require(
    path.join(PRODUCT_DIR, "node_modules", "compression")
  );
  const middleware = compression({ threshold: THRESHOLD });

  const responseBody = condition.body === "large" ? LARGE_BODY : SMALL_BODY;

  const server = http.createServer((req, res) => {
    middleware(req, res, error => {
      if (error) {
        res.statusCode = 500;
        res.end(String(error && error.stack ? error.stack : error));
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(responseBody));
      if (condition.preEncoded) res.setHeader("Content-Encoding", "br");
      res.end(responseBody);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  let statusCode = null;
  let responseContentEncoding = null;
  let responseBytes = 0;

  try {
    await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/e4-p5-validation",
          method: condition.method,
          headers: { "Accept-Encoding": condition.acceptEncoding },
        },
        response => {
          statusCode = response.statusCode;
          responseContentEncoding = response.headers["content-encoding"] || null;
          response.on("data", chunk => {
            responseBytes += chunk.length;
          });
          response.on("end", resolve);
        }
      );

      request.on("error", reject);
      request.end();
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    Module._load = originalLoad;
  }

  const observedA = encodingSelectionCalls > 0 ? 1 : 0;
  const observedY = ["gzip", "deflate"].includes(responseContentEncoding) ? 1 : 0;

  const result = {
    condition: condition.id,
    ...versions,
    topologyT: 1,
    predictedA: condition.predictedA,
    observedA,
    predictedY: condition.predictedY,
    observedY,
    acceptsLoadCount,
    acceptsInvocationCount,
    negotiatorLoadFromAcceptsCount,
    negotiatorConstructCount,
    encodingSelectionCalls,
    encodingArguments,
    encodingResults,
    method: condition.method,
    bodyClass: condition.body,
    bodySourceBytes: Buffer.byteLength(responseBody),
    preEncoded: condition.preEncoded ? 1 : 0,
    acceptEncoding: condition.acceptEncoding,
    statusCode,
    responseContentEncoding,
    responseBytes,
    correctA: observedA === condition.predictedA ? 1 : 0,
    correctY: observedY === condition.predictedY ? 1 : 0,
  };

  process.stdout.write(JSON.stringify(result) + "\n");
}

function parent() {
  const versions = verifyVersions();
  ensureDir(OUTDIR);

  const trials = [];
  let fatalTrials = 0;

  for (const condition of CONDITIONS) {
    for (let repetition = 1; repetition <= REPS; repetition += 1) {
      const child = spawnSync(process.execPath, [__filename, "--worker"], {
        cwd: ROOT,
        env: { ...process.env, E4_CONDITION: condition.id },
        encoding: "utf8",
        timeout: 20000,
      });

      if (child.error || child.status !== 0) {
        fatalTrials += 1;
        trials.push({
          condition: condition.id,
          repetition,
          predictedA: condition.predictedA,
          predictedY: condition.predictedY,
          fatal: 1,
          error: child.error
            ? String(child.error)
            : `exit=${child.status}; stderr=${String(child.stderr || "").trim()}`,
        });
        continue;
      }

      try {
        trials.push({
          repetition,
          fatal: 0,
          ...lastJsonLine(child.stdout),
        });
      } catch (error) {
        fatalTrials += 1;
        trials.push({
          condition: condition.id,
          repetition,
          predictedA: condition.predictedA,
          predictedY: condition.predictedY,
          fatal: 1,
          error: String(error),
        });
      }
    }
  }

  const summaries = CONDITIONS.map(condition => {
    const rows = trials.filter(
      row => row.condition === condition.id && row.fatal === 0
    );

    return {
      condition: condition.id,
      n: rows.length,
      predictedA: condition.predictedA,
      observedARate: mean(rows.map(row => row.observedA)),
      predictedY: condition.predictedY,
      observedYRate: mean(rows.map(row => row.observedY)),
      acceptsInvocationRate: mean(
        rows.map(row => (row.acceptsInvocationCount > 0 ? 1 : 0))
      ),
      negotiatorConstructionRate: mean(
        rows.map(row => (row.negotiatorConstructCount > 0 ? 1 : 0))
      ),
      meanEncodingSelectionCalls: mean(
        rows.map(row => row.encodingSelectionCalls)
      ),
      http200Rate: mean(rows.map(row => (row.statusCode === 200 ? 1 : 0))),
      activationPredictionAccuracy: mean(rows.map(row => row.correctA)),
      outcomePredictionAccuracy: mean(rows.map(row => row.correctY)),
    };
  });

  const validTrials = trials.filter(row => row.fatal === 0);
  const activationAccuracy = mean(validTrials.map(row => row.correctA));
  const outcomeAccuracy = mean(validTrials.map(row => row.correctY));
  const allConditionsComplete = summaries.every(summary => summary.n === REPS);
  const exactCallPathPositive = summaries
    .filter(summary => summary.predictedA === 1)
    .every(
      summary =>
        summary.acceptsInvocationRate === 1 &&
        summary.negotiatorConstructionRate === 1 &&
        summary.observedARate === 1
    );
  const negativeConditionsSilent = summaries
    .filter(summary => summary.predictedA === 0)
    .every(summary => summary.observedARate === 0);
  const allHttpSuccessful = summaries.every(summary => summary.http200Rate === 1);

  const passed =
    fatalTrials === 0 &&
    allConditionsComplete &&
    activationAccuracy === 1 &&
    outcomeAccuracy === 1 &&
    exactCallPathPositive &&
    negativeConditionsSilent &&
    allHttpSuccessful;

  const result = {
    experiment: "P5 E4 accepts-negotiator activation validation",
    exactEdge: "accepts@1.3.8 -> negotiator@0.6.3",
    product: `compression@${versions.compressionVersion}`,
    versions,
    repetitionsPerCondition: REPS,
    thresholdBytes: THRESHOLD,
    fatalTrials,
    validTrials: validTrials.length,
    activationAccuracy,
    outcomeAccuracy,
    exactCallPathPositive,
    negativeConditionsSilent,
    allHttpSuccessful,
    passed,
    note:
      "Controlled runtime mechanism validation only; natural failure probability is not estimated.",
    conditions: CONDITIONS,
    summaries,
    trials,
  };

  const trialColumns = [
    "condition",
    "repetition",
    "fatal",
    "predictedA",
    "observedA",
    "predictedY",
    "observedY",
    "acceptsLoadCount",
    "acceptsInvocationCount",
    "negotiatorLoadFromAcceptsCount",
    "negotiatorConstructCount",
    "encodingSelectionCalls",
    "method",
    "bodyClass",
    "bodySourceBytes",
    "preEncoded",
    "acceptEncoding",
    "statusCode",
    "responseContentEncoding",
    "responseBytes",
    "correctA",
    "correctY",
    "error",
  ];

  const summaryColumns = [
    "condition",
    "n",
    "predictedA",
    "observedARate",
    "predictedY",
    "observedYRate",
    "acceptsInvocationRate",
    "negotiatorConstructionRate",
    "meanEncodingSelectionCalls",
    "http200Rate",
    "activationPredictionAccuracy",
    "outcomePredictionAccuracy",
  ];

  const report = [
    "P5 E4 ACCEPTS -> NEGOTIATOR ACTIVATION VALIDATION",
    "=================================================",
    "",
    `Exact edge: ${result.exactEdge}`,
    `Product: ${result.product}`,
    `Repetitions per condition: ${REPS}`,
    `Threshold: ${THRESHOLD} bytes`,
    "",
    "PRE-REGISTERED CONDITION RESULTS",
    "--------------------------------",
    ...summaries.flatMap(summary => [
      summary.condition,
      `  n=${summary.n}`,
      `  predicted A_E4=${summary.predictedA}; observed activation rate=${fmt(summary.observedARate)}`,
      `  predicted Y_compress=${summary.predictedY}; observed compression rate=${fmt(summary.observedYRate)}`,
      `  accepts invocation rate=${fmt(summary.acceptsInvocationRate)}`,
      `  Negotiator construction rate=${fmt(summary.negotiatorConstructionRate)}`,
      `  mean encoding-selection calls=${fmt(summary.meanEncodingSelectionCalls)}`,
      `  HTTP 200 rate=${fmt(summary.http200Rate)}`,
      `  activation prediction accuracy=${fmt(summary.activationPredictionAccuracy)}`,
      `  outcome prediction accuracy=${fmt(summary.outcomePredictionAccuracy)}`,
    ]),
    "",
    "DECISION",
    "--------",
    `Fatal trials: ${fatalTrials}`,
    `Valid trials: ${validTrials.length}`,
    `Activation prediction accuracy: ${fmt(activationAccuracy)}`,
    `Compression-outcome prediction accuracy: ${fmt(outcomeAccuracy)}`,
    `Exact positive call path verified: ${exactCallPathPositive ? "YES" : "NO"}`,
    `Negative conditions silent: ${negativeConditionsSilent ? "YES" : "NO"}`,
    `All workloads completed with HTTP 200: ${allHttpSuccessful ? "YES" : "NO"}`,
    `PRE-REGISTERED P5 E4 ACTIVATION HYPOTHESIS: ${passed ? "PASS" : "FAIL"}`,
    "",
    "INTERPRETATION LIMIT",
    "--------------------",
    "This is controlled runtime mechanism validation.",
    "It does not estimate natural failure probability, incident frequency, or product risk.",
    "Y_compress is a secondary mechanism check and is not substituted for A_E4.",
    "",
  ].join("\n");

  fs.writeFileSync(
    path.join(OUTDIR, "e4-p5-accepts-negotiator-activation.json"),
    JSON.stringify(result, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(OUTDIR, "e4-p5-accepts-negotiator-activation-trials.csv"),
    toCsv(trials, trialColumns)
  );
  fs.writeFileSync(
    path.join(OUTDIR, "e4-p5-accepts-negotiator-activation-summary.csv"),
    toCsv(summaries, summaryColumns)
  );
  fs.writeFileSync(
    path.join(OUTDIR, "e4-p5-accepts-negotiator-activation-report.txt"),
    report
  );

  process.stdout.write(report);
  process.stdout.write(`Results written to: ${OUTDIR}\n`);
  process.exitCode = passed ? 0 : 1;
}

if (process.argv.includes("--worker")) {
  worker().catch(error => {
    process.stderr.write(String(error && error.stack ? error.stack : error) + "\n");
    process.exitCode = 1;
  });
} else {
  try {
    parent();
  } catch (error) {
    process.stderr.write(String(error && error.stack ? error.stack : error) + "\n");
    process.exitCode = 1;
  }
}

