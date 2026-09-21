#!/usr/bin/env node
"use strict";

/*
  P5 E4 ACCEPTS -> NEGOTIATOR PHASE-A PROPAGATION VALIDATION

  Exact edge: accepts@1.3.8 -> negotiator@0.6.3
  Product: compression@1.7.4
  Predictions: frozen in E4_ACCEPTS_NEGOTIATOR_PROPAGATION_PREDICTION.md

  Controlled runtime mechanism validation only. This does not estimate
  natural failure probability, incident frequency, compromise probability,
  or product risk.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-compression");
const NODE_MODULES = path.join(PRODUCT_DIR, "node_modules");
const OUTDIR = path.join(
  ROOT,
  "results",
  "e4-p5-accepts-negotiator-phase-a-propagation-validation"
);

const REPS = 10;
const THRESHOLD = 1024;
const DELAY_MS = 25;
const LARGE_DATA = "P5 E4 controlled propagation validation payload ".repeat(256);
const SMALL_DATA = "small";

const CONTEXTS = [
  {
    id: "INACTIVE_BELOW_THRESHOLD",
    payload: "small",
    predictedAlpha: 0,
  },
  {
    id: "ACTIVE_ELIGIBLE_GZIP",
    payload: "large",
    predictedAlpha: 1,
  },
];

const CONDITIONS = [
  "BASELINE",
  "EMPTY_ENCODINGS",
  "FORCE_DEFLATE",
  "DELAY_ENCODINGS",
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

function fmt(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "NA";
  }
  return Number(value).toFixed(digits);
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) || typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
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

function busyWait(milliseconds) {
  const start = process.hrtime.bigint();
  const target = BigInt(milliseconds) * 1000000n;
  while (process.hrtime.bigint() - start < target) {}
}

function wilson95(successes, total) {
  if (!total) return { lower: null, upper: null };
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const half =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}

function verifyVersions() {
  const versions = {
    compressionVersion: readJson(path.join(NODE_MODULES, "compression", "package.json")).version,
    acceptsVersion: readJson(path.join(NODE_MODULES, "accepts", "package.json")).version,
    negotiatorVersion: readJson(path.join(NODE_MODULES, "negotiator", "package.json")).version,
  };

  const expected = {
    compressionVersion: "1.7.4",
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

function predictedEncoding(context, condition) {
  if (context.predictedAlpha === 0) return null;
  if (condition === "EMPTY_ENCODINGS") return null;
  if (condition === "FORCE_DEFLATE") return "deflate";
  return "gzip";
}

async function worker() {
  const context = CONTEXTS.find(item => item.id === process.env.E4_CONTEXT);
  const condition = process.env.E4_CONDITION;
  if (!context) throw new Error(`Unknown context: ${process.env.E4_CONTEXT}`);
  if (!CONDITIONS.includes(condition)) throw new Error(`Unknown condition: ${condition}`);

  const versions = verifyVersions();
  const perturbationAssigned = condition === "BASELINE" ? 0 : 1;

  let acceptsLoadCount = 0;
  let acceptsInvocationCount = 0;
  let negotiatorLoadFromAcceptsCount = 0;
  let negotiatorConstructCount = 0;
  let encodingSelectionCalls = 0;
  let injectionCount = 0;
  let injectedDelayMs = 0;
  const originalEncodingResults = [];
  const returnedEncodingResults = [];
  const encodingArguments = [];

  const acceptsIndex = path.normalize(path.join(NODE_MODULES, "accepts", "index.js"));
  const compressionIndex = path.normalize(path.join(NODE_MODULES, "compression", "index.js"));
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
          const baseline = originalEncodings.apply(this, args);
          originalEncodingResults.push(baseline);

          let returned = baseline;
          if (condition === "EMPTY_ENCODINGS") {
            injectionCount += 1;
            returned = [];
          } else if (condition === "FORCE_DEFLATE") {
            injectionCount += 1;
            returned = ["deflate"];
          } else if (condition === "DELAY_ENCODINGS") {
            injectionCount += 1;
            busyWait(DELAY_MS);
            injectedDelayMs += DELAY_MS;
          }

          returnedEncodingResults.push(returned);
          return returned;
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

    if (request === "accepts" && parentFile === compressionIndex) {
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

  const compression = require(path.join(NODE_MODULES, "compression"));
  const middleware = compression({ threshold: THRESHOLD });
  const payload = context.payload === "large" ? LARGE_DATA : SMALL_DATA;

  const server = http.createServer((req, res) => {
    middleware(req, res, error => {
      if (error) {
        res.statusCode = 500;
        res.end(String(error && error.stack ? error.stack : error));
        return;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(payload);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  let statusCode = null;
  let contentEncoding = null;
  let rawBody = Buffer.alloc(0);
  let requestError = null;
  const start = process.hrtime.bigint();

  try {
    await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: server.address().port,
          path: "/e4-propagation",
          method: "GET",
          headers: { "Accept-Encoding": "gzip" },
        },
        response => {
          statusCode = response.statusCode;
          contentEncoding = response.headers["content-encoding"] || null;
          const chunks = [];
          response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => {
            rawBody = Buffer.concat(chunks);
            resolve();
          });
        }
      );
      request.on("error", error => {
        requestError = String(error);
        reject(error);
      });
      request.end();
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    Module._load = originalLoad;
  }

  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  let decodedBody = null;
  let decodeError = null;
  try {
    if (contentEncoding === "gzip") {
      decodedBody = zlib.gunzipSync(rawBody).toString("utf8");
    } else if (contentEncoding === "deflate") {
      decodedBody = zlib.inflateSync(rawBody).toString("utf8");
    } else {
      decodedBody = rawBody.toString("utf8");
    }
  } catch (error) {
    decodeError = String(error);
  }

  const observedAlpha = encodingSelectionCalls > 0 ? 1 : 0;
  const observedInjected = injectionCount > 0 ? 1 : 0;
  const bodyIntegrity = decodedBody === payload ? 1 : 0;

  let observedImpact = 0;
  if (observedInjected) {
    if (condition === "EMPTY_ENCODINGS") {
      observedImpact = contentEncoding === null && bodyIntegrity === 1 ? 1 : 0;
    } else if (condition === "FORCE_DEFLATE") {
      observedImpact = contentEncoding === "deflate" && bodyIntegrity === 1 ? 1 : 0;
    } else if (condition === "DELAY_ENCODINGS") {
      observedImpact =
        injectedDelayMs >= DELAY_MS && contentEncoding === "gzip" && bodyIntegrity === 1 ? 1 : 0;
    }
  }

  const predictedAlpha = context.predictedAlpha;
  const predictedInjected = predictedAlpha === 1 && perturbationAssigned === 1 ? 1 : 0;
  const predictedImpact = predictedInjected;
  const expectedEncoding = predictedEncoding(context, condition);

  process.stdout.write(JSON.stringify({
    context: context.id,
    condition,
    ...versions,
    topologyT: 1,
    predictedAlpha,
    observedAlpha,
    perturbationAssigned,
    predictedInjected,
    observedInjected,
    predictedImpact,
    observedImpact,
    expectedEncoding,
    acceptsLoadCount,
    acceptsInvocationCount,
    negotiatorLoadFromAcceptsCount,
    negotiatorConstructCount,
    encodingSelectionCalls,
    injectionCount,
    injectedDelayMs,
    encodingArguments,
    originalEncodingResults,
    returnedEncodingResults,
    payloadClass: context.payload,
    payloadSourceBytes: Buffer.byteLength(payload),
    statusCode,
    contentEncoding,
    rawBodyBytes: rawBody.length,
    decodedBodyBytes: decodedBody === null ? null : Buffer.byteLength(decodedBody),
    bodyIntegrity,
    decodeError,
    requestError,
    elapsedMs,
    alphaCorrect: observedAlpha === predictedAlpha ? 1 : 0,
    injectionCorrect: observedInjected === predictedInjected ? 1 : 0,
    impactCorrect: observedImpact === predictedImpact ? 1 : 0,
    encodingCorrect: contentEncoding === expectedEncoding ? 1 : 0,
  }) + "\n");
}

function parent() {
  const versions = verifyVersions();
  ensureDir(OUTDIR);
  const trials = [];
  let fatalTrials = 0;

  for (const context of CONTEXTS) {
    for (const condition of CONDITIONS) {
      for (let repetition = 1; repetition <= REPS; repetition += 1) {
        const child = spawnSync(process.execPath, [__filename, "--worker"], {
          cwd: ROOT,
          env: {
            ...process.env,
            E4_CONTEXT: context.id,
            E4_CONDITION: condition,
          },
          encoding: "utf8",
          timeout: 20000,
        });

        if (child.error || child.status !== 0) {
          fatalTrials += 1;
          trials.push({
            context: context.id,
            condition,
            repetition,
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
            context: context.id,
            condition,
            repetition,
            fatal: 1,
            error: String(error),
          });
        }
      }
    }
  }

  const summaries = [];
  for (const context of CONTEXTS) {
    for (const condition of CONDITIONS) {
      const rows = trials.filter(row =>
        row.fatal === 0 && row.context === context.id && row.condition === condition
      );
      const injectedActiveRows = rows.filter(row => row.observedAlpha === 1 && row.observedInjected === 1);
      const impactSuccesses = injectedActiveRows.reduce(
        (sum, row) => sum + Number(row.observedImpact),
        0
      );
      const q = injectedActiveRows.length
        ? impactSuccesses / injectedActiveRows.length
        : null;
      const wilson = wilson95(impactSuccesses, injectedActiveRows.length);
      const observedAlphaRate = mean(rows.map(row => row.observedAlpha));

      summaries.push({
        context: context.id,
        condition,
        n: rows.length,
        predictedAlpha: context.predictedAlpha,
        observedAlphaRate,
        perturbationAssigned: condition === "BASELINE" ? 0 : 1,
        injectionRate: mean(rows.map(row => row.observedInjected)),
        impactRate: mean(rows.map(row => row.observedImpact)),
        qConditionalOnActiveInjected: q,
        qWilson95Lower: wilson.lower,
        qWilson95Upper: wilson.upper,
        piControlled: q === null ? 0 : observedAlphaRate * q,
        acceptsInvocationRate: mean(rows.map(row => row.acceptsInvocationCount > 0 ? 1 : 0)),
        negotiatorConstructionRate: mean(rows.map(row => row.negotiatorConstructCount > 0 ? 1 : 0)),
        meanEncodingSelectionCalls: mean(rows.map(row => row.encodingSelectionCalls)),
        meanInjectionCount: mean(rows.map(row => row.injectionCount)),
        meanInjectedDelayMs: mean(rows.map(row => row.injectedDelayMs)),
        meanElapsedMs: mean(rows.map(row => row.elapsedMs)),
        http200Rate: mean(rows.map(row => row.statusCode === 200 ? 1 : 0)),
        bodyIntegrityRate: mean(rows.map(row => row.bodyIntegrity)),
        encodingPredictionAccuracy: mean(rows.map(row => row.encodingCorrect)),
        alphaPredictionAccuracy: mean(rows.map(row => row.alphaCorrect)),
        injectionPredictionAccuracy: mean(rows.map(row => row.injectionCorrect)),
        impactPredictionAccuracy: mean(rows.map(row => row.impactCorrect)),
      });
    }
  }

  const baselineElapsed = {};
  for (const context of CONTEXTS) {
    const baseline = summaries.find(row =>
      row.context === context.id && row.condition === "BASELINE"
    );
    baselineElapsed[context.id] = baseline ? baseline.meanElapsedMs : null;
  }
  for (const summary of summaries) {
    const baseline = baselineElapsed[summary.context];
    summary.meanLatencyDeltaVsContextBaselineMs = Number.isFinite(baseline)
      ? summary.meanElapsedMs - baseline
      : null;
  }

  const valid = trials.filter(row => row.fatal === 0);
  const alphaAccuracy = mean(valid.map(row => row.alphaCorrect));
  const injectionAccuracy = mean(valid.map(row => row.injectionCorrect));
  const impactAccuracy = mean(valid.map(row => row.impactCorrect));
  const encodingAccuracy = mean(valid.map(row => row.encodingCorrect));
  const allComplete =
    fatalTrials === 0 &&
    valid.length === CONTEXTS.length * CONDITIONS.length * REPS &&
    summaries.every(row =>
      row.n === REPS && row.http200Rate === 1 && row.bodyIntegrityRate === 1
    );
  const inactiveSilent = summaries
    .filter(row => row.context === "INACTIVE_BELOW_THRESHOLD")
    .every(row =>
      row.observedAlphaRate === 0 && row.injectionRate === 0 && row.impactRate === 0
    );
  const activeNonBaseline = summaries.filter(row =>
    row.context === "ACTIVE_ELIGIBLE_GZIP" && row.condition !== "BASELINE"
  );
  const activePropagationPass =
    activeNonBaseline.length === 3 &&
    activeNonBaseline.every(row => row.qConditionalOnActiveInjected === 1);
  const passed =
    allComplete &&
    inactiveSilent &&
    activePropagationPass &&
    alphaAccuracy === 1 &&
    injectionAccuracy === 1 &&
    impactAccuracy === 1 &&
    encodingAccuracy === 1;

  const result = {
    experiment: "P5 E4 accepts-negotiator Phase-A deterministic propagation validation",
    exactEdge: "accepts@1.3.8 -> negotiator@0.6.3",
    product: "compression@1.7.4",
    versions,
    repetitionsPerCell: REPS,
    thresholdBytes: THRESHOLD,
    delayPerExactCallMs: DELAY_MS,
    totalPlannedTrials: CONTEXTS.length * CONDITIONS.length * REPS,
    fatalTrials,
    validTrials: valid.length,
    alphaAccuracy,
    injectionAccuracy,
    impactAccuracy,
    encodingAccuracy,
    allComplete,
    inactiveSilent,
    activePropagationPass,
    passed,
    contexts: CONTEXTS,
    conditions: CONDITIONS,
    summaries,
    trials,
    interpretation: {
      q: "Controlled conditional propagation among exact-edge-active, assigned-and-injected trials.",
      pi: "Controlled effective propagation alpha*q for the registered context and perturbation.",
      boundary: "These results do not estimate a natural occurrence, failure, vulnerability, compromise, or incident probability.",
    },
  };

  const trialColumns = [
    "context", "condition", "repetition", "fatal", "predictedAlpha",
    "observedAlpha", "perturbationAssigned", "predictedInjected",
    "observedInjected", "predictedImpact", "observedImpact",
    "expectedEncoding", "contentEncoding", "acceptsLoadCount",
    "acceptsInvocationCount", "negotiatorLoadFromAcceptsCount",
    "negotiatorConstructCount", "encodingSelectionCalls", "injectionCount",
    "injectedDelayMs", "payloadClass", "payloadSourceBytes", "statusCode",
    "rawBodyBytes", "decodedBodyBytes", "bodyIntegrity", "elapsedMs",
    "alphaCorrect", "injectionCorrect", "impactCorrect", "encodingCorrect",
    "encodingArguments", "originalEncodingResults", "returnedEncodingResults",
    "decodeError", "requestError", "error",
  ];
  const summaryColumns = [
    "context", "condition", "n", "predictedAlpha", "observedAlphaRate",
    "perturbationAssigned", "injectionRate", "impactRate",
    "qConditionalOnActiveInjected", "qWilson95Lower", "qWilson95Upper",
    "piControlled", "acceptsInvocationRate", "negotiatorConstructionRate",
    "meanEncodingSelectionCalls", "meanInjectionCount", "meanInjectedDelayMs",
    "meanElapsedMs", "meanLatencyDeltaVsContextBaselineMs", "http200Rate",
    "bodyIntegrityRate", "encodingPredictionAccuracy",
    "alphaPredictionAccuracy", "injectionPredictionAccuracy",
    "impactPredictionAccuracy",
  ];

  const report = [
    "P5 E4 ACCEPTS -> NEGOTIATOR PHASE-A PROPAGATION VALIDATION",
    "==========================================================",
    "",
    `Exact edge: ${result.exactEdge}`,
    `Product: ${result.product}`,
    `Repetitions per cell: ${REPS}`,
    `Total planned trials: ${result.totalPlannedTrials}`,
    `Threshold: ${THRESHOLD} bytes; delay per exact call: ${DELAY_MS} ms`,
    "",
    "PRE-REGISTERED RESULTS",
    "----------------------",
    ...summaries.flatMap(summary => [
      `${summary.context} / ${summary.condition}`,
      `  n=${summary.n}; predicted alpha=${summary.predictedAlpha}; observed alpha=${fmt(summary.observedAlphaRate)}`,
      `  injection=${fmt(summary.injectionRate)}; impact=${fmt(summary.impactRate)}`,
      `  q|active,injected=${fmt(summary.qConditionalOnActiveInjected)}; 95% Wilson=[${fmt(summary.qWilson95Lower)}, ${fmt(summary.qWilson95Upper)}]`,
      `  pi=alpha*q=${fmt(summary.piControlled)}`,
      `  accepts invocation=${fmt(summary.acceptsInvocationRate)}; Negotiator construction=${fmt(summary.negotiatorConstructionRate)}`,
      `  mean exact calls=${fmt(summary.meanEncodingSelectionCalls)}; injections=${fmt(summary.meanInjectionCount)}; injected delay=${fmt(summary.meanInjectedDelayMs)} ms`,
      `  latency delta vs context baseline=${fmt(summary.meanLatencyDeltaVsContextBaselineMs)} ms`,
      `  HTTP 200=${fmt(summary.http200Rate)}; body integrity=${fmt(summary.bodyIntegrityRate)}; encoding accuracy=${fmt(summary.encodingPredictionAccuracy)}`,
    ]),
    "",
    "DECISION",
    "--------",
    `Fatal trials: ${fatalTrials}`,
    `Valid trials: ${valid.length}`,
    `Activation prediction accuracy: ${fmt(alphaAccuracy)}`,
    `Injection prediction accuracy: ${fmt(injectionAccuracy)}`,
    `Impact prediction accuracy: ${fmt(impactAccuracy)}`,
    `Encoding prediction accuracy: ${fmt(encodingAccuracy)}`,
    `Inactive contexts silent: ${inactiveSilent ? "YES" : "NO"}`,
    `Active deterministic q=1 for all perturbations: ${activePropagationPass ? "YES" : "NO"}`,
    `All responses complete with valid bodies: ${allComplete ? "YES" : "NO"}`,
    `PRE-REGISTERED P5 E4 PHASE-A PROPAGATION HYPOTHESIS: ${passed ? "PASS" : "FAIL"}`,
    "",
    "INTERPRETATION LIMIT",
    "--------------------",
    "This is deterministic controlled runtime mechanism validation.",
    "q=1 here is not a natural failure, vulnerability, compromise, incident, or product-risk probability.",
    "No natural lambda is estimated.",
    "",
  ].join("\n");

  fs.writeFileSync(
    path.join(OUTDIR, "e4-p5-phase-a-propagation.json"),
    JSON.stringify(result, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(OUTDIR, "e4-p5-phase-a-propagation-trials.csv"),
    toCsv(trials, trialColumns)
  );
  fs.writeFileSync(
    path.join(OUTDIR, "e4-p5-phase-a-propagation-summary.csv"),
    toCsv(summaries, summaryColumns)
  );
  fs.writeFileSync(
    path.join(OUTDIR, "e4-p5-phase-a-propagation-report.txt"),
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
