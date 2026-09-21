#!/usr/bin/env node
"use strict";

/*
  P6 E4 ACCEPTS -> NEGOTIATOR ACTIVATION VALIDATION

  Exact edge: accepts@1.3.8 -> negotiator@0.6.3
  Parent path: engine.io@6.6.10 Node polling transport
  Predictions: frozen in E4_ACCEPTS_NEGOTIATOR_ACTIVATION_PREDICTION.md

  Controlled runtime mechanism validation only. This does not estimate
  natural failure probability, incident frequency, or product risk.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-socketio");
const NODE_MODULES = path.join(PRODUCT_DIR, "node_modules");
const OUTDIR = path.join(
  ROOT,
  "results",
  "e4-p6-engineio-accepts-negotiator-activation-validation"
);
const REPS = 10;
const THRESHOLD = 1024;
const LARGE_DATA = "P6 E4 Engine.IO polling activation validation ".repeat(256);
const SMALL_DATA = "small";

const CONDITIONS = [
  {
    id: "P6-C1_ELIGIBLE_GZIP",
    httpCompression: true,
    packetCompress: true,
    payload: "large",
    acceptEncoding: "gzip",
    predictedA: 1,
    predictedY: 1,
  },
  {
    id: "P6-C2_HTTP_COMPRESSION_DISABLED",
    httpCompression: false,
    packetCompress: true,
    payload: "large",
    acceptEncoding: "gzip",
    predictedA: 0,
    predictedY: 0,
  },
  {
    id: "P6-C3_PACKET_COMPRESSION_FALSE",
    httpCompression: true,
    packetCompress: false,
    payload: "large",
    acceptEncoding: "gzip",
    predictedA: 0,
    predictedY: 0,
  },
  {
    id: "P6-C4_BELOW_THRESHOLD",
    httpCompression: true,
    packetCompress: true,
    payload: "small",
    acceptEncoding: "gzip",
    predictedA: 0,
    predictedY: 0,
  },
  {
    id: "P6-C5_IDENTITY_ONLY",
    httpCompression: true,
    packetCompress: true,
    payload: "large",
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
  return [
    columns.join(","),
    ...rows.map(row => columns.map(column => csvValue(row[column])).join(",")),
  ].join("\n") + "\n";
}

function lastJsonLine(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch (_) {}
  }
  throw new Error(`Worker returned no JSON result.\nstdout:\n${stdout}`);
}

function verifyVersions() {
  const versions = {
    socketIoVersion: readJson(path.join(NODE_MODULES, "socket.io", "package.json")).version,
    engineIoVersion: readJson(path.join(NODE_MODULES, "engine.io", "package.json")).version,
    acceptsVersion: readJson(path.join(NODE_MODULES, "accepts", "package.json")).version,
    negotiatorVersion: readJson(path.join(NODE_MODULES, "negotiator", "package.json")).version,
  };

  const expected = {
    socketIoVersion: "4.8.1",
    engineIoVersion: "6.6.10",
    acceptsVersion: "1.3.8",
    negotiatorVersion: "0.6.3",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (versions[key] !== value) {
      throw new Error(`Version mismatch for ${key}: expected ${value}, found ${versions[key]}`);
    }
  }
  return versions;
}

async function worker() {
  const condition = CONDITIONS.find(item => item.id === process.env.E4_CONDITION);
  if (!condition) throw new Error(`Unknown condition: ${process.env.E4_CONDITION}`);
  const versions = verifyVersions();

  let acceptsLoadCount = 0;
  let acceptsInvocationCount = 0;
  let negotiatorLoadFromAcceptsCount = 0;
  let negotiatorConstructCount = 0;
  let encodingSelectionCalls = 0;
  const encodingArguments = [];
  const encodingResults = [];

  const acceptsIndex = path.normalize(path.join(NODE_MODULES, "accepts", "index.js"));
  const pollingFile = path.normalize(
    path.join(NODE_MODULES, "engine.io", "build", "transports", "polling.js")
  );
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    const parentFile = path.normalize(parent && parent.filename ? parent.filename : "");

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

    if (request === "accepts" && parentFile === pollingFile) {
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

  const { Polling } = require(pollingFile);
  const data = condition.payload === "large" ? LARGE_DATA : SMALL_DATA;
  let writeCallbackCount = 0;

  const server = http.createServer((req, res) => {
    req._query = { EIO: "4", transport: "polling" };
    const transport = new Polling(req);
    transport.req = req;
    transport.res = res;
    transport.httpCompression = condition.httpCompression
      ? { threshold: THRESHOLD }
      : null;

    transport.doWrite(
      data,
      { compress: condition.packetCompress },
      error => {
        writeCallbackCount += 1;
        if (error && !res.writableEnded) {
          res.statusCode = 500;
          res.end(String(error));
        }
      }
    );
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  let statusCode = null;
  let responseContentEncoding = null;
  let responseBytes = 0;
  try {
    await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: server.address().port,
          path: "/engine.io/?EIO=4&transport=polling",
          method: "GET",
          headers: { "Accept-Encoding": condition.acceptEncoding },
        },
        response => {
          statusCode = response.statusCode;
          responseContentEncoding = response.headers["content-encoding"] || null;
          response.on("data", chunk => { responseBytes += chunk.length; });
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
  process.stdout.write(JSON.stringify({
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
    httpCompressionEnabled: condition.httpCompression ? 1 : 0,
    packetCompress: condition.packetCompress ? 1 : 0,
    payloadClass: condition.payload,
    payloadSourceBytes: Buffer.byteLength(data),
    acceptEncoding: condition.acceptEncoding,
    statusCode,
    responseContentEncoding,
    responseBytes,
    writeCallbackCount,
    correctA: observedA === condition.predictedA ? 1 : 0,
    correctY: observedY === condition.predictedY ? 1 : 0,
  }) + "\n");
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
        trials.push({ repetition, fatal: 0, ...lastJsonLine(child.stdout) });
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
    const rows = trials.filter(row => row.condition === condition.id && row.fatal === 0);
    return {
      condition: condition.id,
      n: rows.length,
      predictedA: condition.predictedA,
      observedARate: mean(rows.map(row => row.observedA)),
      predictedY: condition.predictedY,
      observedYRate: mean(rows.map(row => row.observedY)),
      acceptsInvocationRate: mean(rows.map(row => row.acceptsInvocationCount > 0 ? 1 : 0)),
      negotiatorConstructionRate: mean(rows.map(row => row.negotiatorConstructCount > 0 ? 1 : 0)),
      meanEncodingSelectionCalls: mean(rows.map(row => row.encodingSelectionCalls)),
      http200Rate: mean(rows.map(row => row.statusCode === 200 ? 1 : 0)),
      callbackOnceRate: mean(rows.map(row => row.writeCallbackCount === 1 ? 1 : 0)),
      activationPredictionAccuracy: mean(rows.map(row => row.correctA)),
      outcomePredictionAccuracy: mean(rows.map(row => row.correctY)),
    };
  });

  const valid = trials.filter(row => row.fatal === 0);
  const activationAccuracy = mean(valid.map(row => row.correctA));
  const outcomeAccuracy = mean(valid.map(row => row.correctY));
  const exactPositivePath = summaries.filter(s => s.predictedA === 1).every(
    s => s.acceptsInvocationRate === 1 && s.negotiatorConstructionRate === 1 && s.observedARate === 1
  );
  const negativeSilent = summaries.filter(s => s.predictedA === 0).every(s => s.observedARate === 0);
  const allComplete = summaries.every(s => s.n === REPS && s.http200Rate === 1 && s.callbackOnceRate === 1);
  const passed = fatalTrials === 0 && allComplete && activationAccuracy === 1 &&
    outcomeAccuracy === 1 && exactPositivePath && negativeSilent;

  const result = {
    experiment: "P6 E4 Engine.IO accepts-negotiator activation validation",
    exactEdge: "accepts@1.3.8 -> negotiator@0.6.3",
    parentPath: "engine.io@6.6.10 Node polling transport",
    versions,
    repetitionsPerCondition: REPS,
    thresholdBytes: THRESHOLD,
    fatalTrials,
    validTrials: valid.length,
    activationAccuracy,
    outcomeAccuracy,
    exactPositivePath,
    negativeSilent,
    allComplete,
    passed,
    note: "Controlled runtime mechanism validation only; natural probability is not estimated.",
    conditions: CONDITIONS,
    summaries,
    trials,
  };

  const trialColumns = [
    "condition", "repetition", "fatal", "predictedA", "observedA",
    "predictedY", "observedY", "acceptsLoadCount", "acceptsInvocationCount",
    "negotiatorLoadFromAcceptsCount", "negotiatorConstructCount",
    "encodingSelectionCalls", "httpCompressionEnabled", "packetCompress",
    "payloadClass", "payloadSourceBytes", "acceptEncoding", "statusCode",
    "responseContentEncoding", "responseBytes", "writeCallbackCount",
    "correctA", "correctY", "error",
  ];
  const summaryColumns = [
    "condition", "n", "predictedA", "observedARate", "predictedY",
    "observedYRate", "acceptsInvocationRate", "negotiatorConstructionRate",
    "meanEncodingSelectionCalls", "http200Rate", "callbackOnceRate",
    "activationPredictionAccuracy", "outcomePredictionAccuracy",
  ];

  const report = [
    "P6 E4 ENGINE.IO ACCEPTS -> NEGOTIATOR ACTIVATION VALIDATION",
    "===========================================================",
    "",
    `Exact edge: ${result.exactEdge}`,
    `Product: socket.io@${versions.socketIoVersion}; parent engine.io@${versions.engineIoVersion}`,
    `Repetitions per condition: ${REPS}`,
    `Threshold: ${THRESHOLD} bytes`,
    "",
    "PRE-REGISTERED CONDITION RESULTS",
    "--------------------------------",
    ...summaries.flatMap(s => [
      s.condition,
      `  n=${s.n}`,
      `  predicted A_E4=${s.predictedA}; observed activation rate=${fmt(s.observedARate)}`,
      `  predicted Y_compress=${s.predictedY}; observed compression rate=${fmt(s.observedYRate)}`,
      `  accepts invocation rate=${fmt(s.acceptsInvocationRate)}`,
      `  Negotiator construction rate=${fmt(s.negotiatorConstructionRate)}`,
      `  mean encoding-selection calls=${fmt(s.meanEncodingSelectionCalls)}`,
      `  HTTP 200 rate=${fmt(s.http200Rate)}; callback-once rate=${fmt(s.callbackOnceRate)}`,
      `  activation prediction accuracy=${fmt(s.activationPredictionAccuracy)}`,
      `  outcome prediction accuracy=${fmt(s.outcomePredictionAccuracy)}`,
    ]),
    "",
    "DECISION",
    "--------",
    `Fatal trials: ${fatalTrials}`,
    `Valid trials: ${valid.length}`,
    `Activation prediction accuracy: ${fmt(activationAccuracy)}`,
    `Compression-outcome prediction accuracy: ${fmt(outcomeAccuracy)}`,
    `Exact positive call path verified: ${exactPositivePath ? "YES" : "NO"}`,
    `Negative conditions silent: ${negativeSilent ? "YES" : "NO"}`,
    `All polling writes completed correctly: ${allComplete ? "YES" : "NO"}`,
    `PRE-REGISTERED P6 E4 ACTIVATION HYPOTHESIS: ${passed ? "PASS" : "FAIL"}`,
    "",
    "INTERPRETATION LIMIT",
    "--------------------",
    "This is controlled runtime mechanism validation.",
    "It does not estimate natural failure probability, incident frequency, or product risk.",
    "Y_compress is a secondary mechanism check and is not substituted for A_E4.",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(OUTDIR, "e4-p6-engineio-accepts-negotiator-activation.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(OUTDIR, "e4-p6-engineio-accepts-negotiator-activation-trials.csv"), toCsv(trials, trialColumns));
  fs.writeFileSync(path.join(OUTDIR, "e4-p6-engineio-accepts-negotiator-activation-summary.csv"), toCsv(summaries, summaryColumns));
  fs.writeFileSync(path.join(OUTDIR, "e4-p6-engineio-accepts-negotiator-activation-report.txt"), report);
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

