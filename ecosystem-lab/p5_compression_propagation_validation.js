#!/usr/bin/env node
"use strict";

/*
  P5 COMPRESSION PROPAGATION VALIDATION

  Target exact edge:
    debug@2.6.9 -> ms@2.0.0

  Contexts:
    INACTIVE_COLORS_OFF: DEBUG=compression, DEBUG_COLORS=0 -> predicted A=0
    ACTIVE_COLORS_ON:    DEBUG=compression, DEBUG_COLORS=1 -> predicted A=1

  Conditions:
    BASELINE
    CORRUPT_HUMANIZE
    EMPTY_HUMANIZE
    DELAY_HUMANIZE

  Controlled mechanism validation only.
  No natural lambda/risk probability is estimated.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-compression");
const OUTDIR = path.join(ROOT, "results", "p5-compression-propagation-validation");

const REPS = 10;
const DELAY_MS = 50;

const CONTEXTS = [
  {
    id: "INACTIVE_COLORS_OFF",
    debug: "compression",
    colors: "0",
    predictedAlpha: 0,
  },
  {
    id: "ACTIVE_COLORS_ON",
    debug: "compression",
    colors: "1",
    predictedAlpha: 1,
  },
];

const CONDITIONS = [
  "BASELINE",
  "CORRUPT_HUMANIZE",
  "EMPTY_HUMANIZE",
  "DELAY_HUMANIZE",
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function fmt(v, d = 4) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "NA";
  return Number(v).toFixed(d);
}

function lastJsonLine(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch (_) {}
  }

  throw new Error(`Worker did not return JSON.\nstdout:\n${stdout}`);
}

function busyWait(ms) {
  const start = process.hrtime.bigint();
  const target = BigInt(ms) * 1000000n;
  while (process.hrtime.bigint() - start < target) {}
}

async function worker() {
  const condition = process.env.P5_CONDITION || "BASELINE";

  let compressionDebugRequireCount = 0;
  let debugToMsRequireCount = 0;

  let debugLoggerCalls = 0;
  let enabledDebugLoggerCalls = 0;
  let debugNamespace = null;

  let msCallsFromDebug = 0;
  let alteredMsCalls = 0;
  let totalInjectedDelayMs = 0;

  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    const parentFile = parent && parent.filename ? path.normalize(parent.filename) : "";
    const lower = parentFile.toLowerCase();

    if (
      request === "debug" &&
      lower.includes(`${path.sep}node_modules${path.sep}compression${path.sep}`)
    ) {
      compressionDebugRequireCount += 1;

      const actualDebug = originalLoad.apply(this, arguments);

      function wrappedDebugFactory(namespace) {
        debugNamespace = namespace;
        const logger = actualDebug(namespace);

        function wrappedLogger(...args) {
          debugLoggerCalls += 1;
          if (logger.enabled) enabledDebugLoggerCalls += 1;
          return logger(...args);
        }

        for (const key of Object.keys(logger)) {
          try {
            wrappedLogger[key] = logger[key];
          } catch (_) {}
        }

        Object.defineProperty(wrappedLogger, "enabled", {
          configurable: true,
          enumerable: true,
          get() {
            return logger.enabled;
          },
        });

        return wrappedLogger;
      }

      for (const key of Object.keys(actualDebug)) {
        try {
          wrappedDebugFactory[key] = actualDebug[key];
        } catch (_) {}
      }

      return wrappedDebugFactory;
    }

    if (
      request === "ms" &&
      lower.includes(`${path.sep}node_modules${path.sep}debug${path.sep}`)
    ) {
      debugToMsRequireCount += 1;

      const actualMs = originalLoad.apply(this, arguments);

      function wrappedMs(...args) {
        msCallsFromDebug += 1;

        const baselineValue = actualMs(...args);

        if (condition === "CORRUPT_HUMANIZE") {
          alteredMsCalls += 1;
          return "CORRUPTED_MS";
        }

        if (condition === "EMPTY_HUMANIZE") {
          alteredMsCalls += 1;
          return "";
        }

        if (condition === "DELAY_HUMANIZE") {
          alteredMsCalls += 1;
          busyWait(DELAY_MS);
          totalInjectedDelayMs += DELAY_MS;
          return baselineValue;
        }

        return baselineValue;
      }

      for (const key of Object.keys(actualMs)) {
        try {
          wrappedMs[key] = actualMs[key];
        } catch (_) {}
      }

      return wrappedMs;
    }

    return originalLoad.apply(this, arguments);
  };

  const compression = require(
    path.join(PRODUCT_DIR, "node_modules", "compression")
  );

  const middleware = compression({ threshold: 0 });

  const server = http.createServer((req, res) => {
    middleware(req, res, err => {
      if (err) {
        res.statusCode = 500;
        res.end(String(err && err.stack ? err.stack : err));
        return;
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("P5 propagation validation ".repeat(256));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;

  let statusCode = null;
  let contentEncoding = null;
  let bodyBytes = 0;

  const t0 = process.hrtime.bigint();

  try {
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/validation",
          method: "GET",
          headers: {
            "Accept-Encoding": "gzip",
          },
        },
        res => {
          statusCode = res.statusCode;
          contentEncoding = res.headers["content-encoding"] || null;

          res.on("data", chunk => {
            bodyBytes += chunk.length;
          });

          res.on("end", resolve);
        }
      );

      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const observedAlpha = msCallsFromDebug > 0 ? 1 : 0;

  const impact = alteredMsCalls > 0 ? 1 : 0;

  const result = {
    condition,

    debugEnv: process.env.DEBUG || "",
    debugColorsEnv: process.env.DEBUG_COLORS ?? null,

    topologyT: 1,

    compressionDebugRequireCount,
    debugToMsRequireCount,

    debugNamespace,
    debugLoggerCalls,
    enabledDebugLoggerCalls,

    msCallsFromDebug,
    alteredMsCalls,
    totalInjectedDelayMs,

    observedAlpha,
    impact,

    elapsedMs,
    statusCode,
    contentEncoding,
    bodyBytes,
  };

  process.stdout.write(JSON.stringify(result) + "\n");
}

function parent() {
  ensureDir(OUTDIR);

  const trials = [];
  let fatal = 0;

  for (const context of CONTEXTS) {
    for (const condition of CONDITIONS) {
      for (let rep = 1; rep <= REPS; rep++) {
        const env = {
          ...process.env,
          DEBUG: context.debug,
          DEBUG_COLORS: context.colors,
          P5_CONDITION: condition,
        };

        const child = spawnSync(
          process.execPath,
          [__filename, "--worker"],
          {
            cwd: ROOT,
            env,
            encoding: "utf8",
            timeout: 20000,
          }
        );

        if (child.error || child.status !== 0) {
          fatal += 1;
          trials.push({
            context: context.id,
            condition,
            rep,
            predictedAlpha: context.predictedAlpha,
            fatal: 1,
            error: child.error
              ? String(child.error)
              : `exit=${child.status}; stderr=${child.stderr}`,
          });
          continue;
        }

        try {
          const r = lastJsonLine(child.stdout);

          const predictedImpact =
            context.predictedAlpha === 1 && condition !== "BASELINE" ? 1 : 0;

          trials.push({
            context: context.id,
            condition,
            rep,
            predictedAlpha: context.predictedAlpha,
            predictedImpact,
            fatal: 0,
            ...r,
            alphaCorrect:
              Number(r.observedAlpha) === Number(context.predictedAlpha) ? 1 : 0,
            impactCorrect:
              Number(r.impact) === Number(predictedImpact) ? 1 : 0,
          });
        } catch (err) {
          fatal += 1;
          trials.push({
            context: context.id,
            condition,
            rep,
            predictedAlpha: context.predictedAlpha,
            fatal: 1,
            error: String(err),
          });
        }
      }
    }
  }

  const summary = [];

  for (const context of CONTEXTS) {
    for (const condition of CONDITIONS) {
      const rows = trials.filter(
        r =>
          r.context === context.id &&
          r.condition === condition &&
          !r.fatal
      );

      const activeRows = rows.filter(r => Number(r.observedAlpha) === 1);

      let qConditionalOnActive = null;

      if (condition !== "BASELINE" && activeRows.length > 0) {
        qConditionalOnActive = mean(activeRows.map(r => Number(r.impact)));
      } else if (condition === "BASELINE" && activeRows.length > 0) {
        qConditionalOnActive = 0;
      }

      const observedAlpha = mean(rows.map(r => Number(r.observedAlpha)));
      const impactRate = mean(rows.map(r => Number(r.impact)));

      summary.push({
        context: context.id,
        condition,
        n: rows.length,

        predictedAlpha: context.predictedAlpha,
        observedAlpha,

        topologyT: mean(rows.map(r => Number(r.topologyT))),
        debugLoaded: mean(
          rows.map(r => (r.compressionDebugRequireCount > 0 ? 1 : 0))
        ),
        msLoaded: mean(
          rows.map(r => (r.debugToMsRequireCount > 0 ? 1 : 0))
        ),
        debugCalled: mean(
          rows.map(r => (r.debugLoggerCalls > 0 ? 1 : 0))
        ),
        enabledExecution: mean(
          rows.map(r => (r.enabledDebugLoggerCalls > 0 ? 1 : 0))
        ),

        qConditionalOnActive,
        impactRate,

        meanMsCallsFromDebug: mean(
          rows.map(r => Number(r.msCallsFromDebug))
        ),
        meanAlteredMsCalls: mean(
          rows.map(r => Number(r.alteredMsCalls))
        ),
        meanInjectedDelayMs: mean(
          rows.map(r => Number(r.totalInjectedDelayMs))
        ),
        meanElapsedMs: mean(
          rows.map(r => Number(r.elapsedMs))
        ),

        http200Rate: mean(
          rows.map(r => (Number(r.statusCode) === 200 ? 1 : 0))
        ),
        gzipRate: mean(
          rows.map(r => (r.contentEncoding === "gzip" ? 1 : 0))
        ),

        alphaPredictionAccuracy: mean(
          rows.map(r => Number(r.alphaCorrect))
        ),
        impactPredictionAccuracy: mean(
          rows.map(r => Number(r.impactCorrect))
        ),
      });
    }
  }

  const baselineElapsed = {};
  for (const context of CONTEXTS) {
    const row = summary.find(
      s => s.context === context.id && s.condition === "BASELINE"
    );
    baselineElapsed[context.id] = row ? row.meanElapsedMs : null;
  }

  for (const row of summary) {
    const b = baselineElapsed[row.context];
    row.meanLatencyDeltaVsContextBaselineMs =
      Number.isFinite(b) ? row.meanElapsedMs - b : null;
  }

  const valid = trials.filter(r => !r.fatal);

  const overallAlphaAccuracy = mean(
    valid.map(r => Number(r.alphaCorrect))
  );

  const overallImpactAccuracy = mean(
    valid.map(r => Number(r.impactCorrect))
  );

  const activeNonBaselineSummary = summary.filter(
    s =>
      s.context === "ACTIVE_COLORS_ON" &&
      s.condition !== "BASELINE"
  );

  const passQ =
    activeNonBaselineSummary.length === 3 &&
    activeNonBaselineSummary.every(
      s => Number(s.qConditionalOnActive) === 1
    );

  const validationPass =
    fatal === 0 &&
    overallAlphaAccuracy === 1 &&
    overallImpactAccuracy === 1 &&
    passQ;

  const result = {
    experiment: "P5 Compression propagation validation",
    product: "compression@1.7.4",
    targetEdge: "debug@2.6.9 -> ms@2.0.0",
    repetitionsPerCell: REPS,
    totalPlannedTrials: CONTEXTS.length * CONDITIONS.length * REPS,
    fatal,
    overallAlphaPredictionAccuracy: overallAlphaAccuracy,
    overallImpactPredictionAccuracy: overallImpactAccuracy,
    validationPass,
    summary,
    trials,
    interpretation: {
      alpha:
        "Runtime activation of the exact debug@2.6.9 -> ms@2.0.0 edge.",
      q:
        "Controlled conditional impact probability among active trials for the deterministic perturbation.",
      boundary:
        "q=1 here validates the controlled mechanism only; it is not a natural incident/failure/compromise probability.",
    },
  };

  fs.writeFileSync(
    path.join(OUTDIR, "p5-compression-propagation-validation.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );

  const report = [];

  report.push("P5 COMPRESSION PROPAGATION VALIDATION");
  report.push("=====================================");
  report.push("");
  report.push("Target exact edge: debug@2.6.9 -> ms@2.0.0");
  report.push("Product: compression@1.7.4");
  report.push(`Repetitions/cell: ${REPS}`);
  report.push("");

  report.push("PRE-SPECIFIED CONTEXT PREDICTIONS");
  report.push("---------------------------------");
  for (const c of CONTEXTS) {
    report.push(
      `${c.id}: DEBUG=${c.debug} DEBUG_COLORS=${c.colors} predicted alpha=${c.predictedAlpha}`
    );
  }

  report.push("");
  report.push("RESULTS");
  report.push("-------");

  for (const s of summary) {
    report.push(`${s.context} / ${s.condition}`);
    report.push(
      `  n=${s.n} T=${fmt(s.topologyT)} L_debug=${fmt(
        s.debugLoaded
      )} L_ms=${fmt(s.msLoaded)} D=${fmt(
        s.debugCalled
      )} E=${fmt(s.enabledExecution)}`
    );
    report.push(
      `  predicted alpha=${s.predictedAlpha} observed alpha=${fmt(
        s.observedAlpha
      )} q|active=${fmt(s.qConditionalOnActive)} impact=${fmt(
        s.impactRate
      )}`
    );
    report.push(
      `  mean ms calls=${fmt(
        s.meanMsCallsFromDebug
      )} altered ms calls=${fmt(
        s.meanAlteredMsCalls
      )} injected delay=${fmt(s.meanInjectedDelayMs)} ms`
    );
    report.push(
      `  mean latency delta vs context baseline=${fmt(
        s.meanLatencyDeltaVsContextBaselineMs
      )} ms HTTP200=${fmt(s.http200Rate)} gzip=${fmt(s.gzipRate)}`
    );
  }

  report.push("");
  report.push("OVERALL");
  report.push("-------");
  report.push(
    `Total planned trials=${CONTEXTS.length * CONDITIONS.length * REPS}`
  );
  report.push(`Fatal=${fatal}`);
  report.push(
    `Overall alpha prediction accuracy=${fmt(overallAlphaAccuracy)}`
  );
  report.push(
    `Overall impact prediction accuracy=${fmt(overallImpactAccuracy)}`
  );
  report.push(`Validation=${validationPass ? "PASS" : "CHECK"}`);

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "Inactive context tests whether a structurally present but runtime-inactive edge blocks the controlled perturbation."
  );
  report.push(
    "Active context tests whether deterministic perturbations propagate through the activated exact edge."
  );
  report.push(
    "q=1 under an active deterministic perturbation is mechanism validation only, not natural risk or natural failure probability."
  );
  report.push(
    "HTTP success can coexist with lower-layer observability or latency impact."
  );

  fs.writeFileSync(
    path.join(OUTDIR, "p5-compression-propagation-validation-report.txt"),
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log(
    "  results\\p5-compression-propagation-validation\\p5-compression-propagation-validation-report.txt"
  );
  console.log(
    "  results\\p5-compression-propagation-validation\\p5-compression-propagation-validation.json"
  );
}

if (process.argv.includes("--worker")) {
  worker().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  parent();
}
