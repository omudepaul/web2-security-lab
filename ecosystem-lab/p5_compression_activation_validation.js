#!/usr/bin/env node
"use strict";

/*
  P5 COMPRESSION ACTIVATION VALIDATION

  Target exact edge:
    debug@2.6.9 -> ms@2.0.0

  Pre-specified predictions:
    C1 DEBUG off, colors on  -> A_e = 0
    C2 DEBUG on, colors off  -> A_e = 0
    C3 DEBUG on, colors on   -> A_e = 1

  A_e = 1 iff instrumented ms() is invoked from debug@2.6.9
  during the compression workload.

  This is runtime mechanism validation, not natural failure/risk estimation.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-compression");
const OUTDIR = path.join(ROOT, "results", "p5-compression-activation-validation");

const REPS = 10;

const CONFIGS = [
  {
    id: "C1_DEBUG_OFF_COLORS_ON",
    debug: "",
    colors: "1",
    predictedA: 0,
  },
  {
    id: "C2_DEBUG_ON_COLORS_OFF",
    debug: "compression",
    colors: "0",
    predictedA: 0,
  },
  {
    id: "C3_DEBUG_ON_COLORS_ON",
    debug: "compression",
    colors: "1",
    predictedA: 1,
  },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function fmt(v, d = 4) {
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

async function worker() {
  let compressionDebugRequireCount = 0;
  let debugLoggerCalls = 0;
  let enabledDebugLoggerCalls = 0;
  let debugNamespace = null;

  let debugToMsRequireCount = 0;
  let msCallsFromDebug = 0;

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
        return actualMs(...args);
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
      res.end("P5 compression activation validation ".repeat(256));
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

  const observedA = msCallsFromDebug > 0 ? 1 : 0;

  const result = {
    debugEnv: process.env.DEBUG || "",
    debugColorsEnv: process.env.DEBUG_COLORS ?? null,

    topologyT: 1,

    compressionDebugRequireCount,
    debugToMsRequireCount,

    debugNamespace,
    debugLoggerCalls,
    enabledDebugLoggerCalls,

    msCallsFromDebug,
    observedA,

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

  for (const config of CONFIGS) {
    for (let rep = 1; rep <= REPS; rep++) {
      const env = {
        ...process.env,
        DEBUG: config.debug,
        DEBUG_COLORS: config.colors,
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
          config: config.id,
          rep,
          predictedA: config.predictedA,
          fatal: 1,
          error: child.error
            ? String(child.error)
            : `exit=${child.status}; stderr=${child.stderr}`,
        });

        continue;
      }

      try {
        const r = lastJsonLine(child.stdout);

        trials.push({
          config: config.id,
          rep,
          predictedA: config.predictedA,
          fatal: 0,
          ...r,
          correct:
            Number(r.observedA) === Number(config.predictedA) ? 1 : 0,
        });
      } catch (err) {
        fatal += 1;

        trials.push({
          config: config.id,
          rep,
          predictedA: config.predictedA,
          fatal: 1,
          error: String(err),
        });
      }
    }
  }

  const summary = CONFIGS.map(config => {
    const rows = trials.filter(
      r => r.config === config.id && !r.fatal
    );

    return {
      config: config.id,
      n: rows.length,
      predictedA: config.predictedA,

      topologyT: mean(rows.map(r => Number(r.topologyT))),
      compressionDebugLoaded: mean(
        rows.map(r => (r.compressionDebugRequireCount > 0 ? 1 : 0))
      ),
      debugToMsLoaded: mean(
        rows.map(r => (r.debugToMsRequireCount > 0 ? 1 : 0))
      ),

      parentDebugCalled: mean(
        rows.map(r => (r.debugLoggerCalls > 0 ? 1 : 0))
      ),
      debugEnabledExecution: mean(
        rows.map(r => (r.enabledDebugLoggerCalls > 0 ? 1 : 0))
      ),

      observedA: mean(rows.map(r => Number(r.observedA))),
      meanDebugCalls: mean(rows.map(r => Number(r.debugLoggerCalls))),
      meanEnabledDebugCalls: mean(
        rows.map(r => Number(r.enabledDebugLoggerCalls))
      ),
      meanMsCallsFromDebug: mean(
        rows.map(r => Number(r.msCallsFromDebug))
      ),

      http200Rate: mean(
        rows.map(r => (Number(r.statusCode) === 200 ? 1 : 0))
      ),
      gzipRate: mean(
        rows.map(r => (r.contentEncoding === "gzip" ? 1 : 0))
      ),

      predictionAccuracy: mean(rows.map(r => Number(r.correct))),
    };
  });

  const valid = trials.filter(r => !r.fatal);
  const overallAccuracy = mean(valid.map(r => Number(r.correct)));

  const result = {
    experiment: "P5 Compression activation validation",
    product: "compression@1.7.4",
    targetEdge: "debug@2.6.9 -> ms@2.0.0",
    repetitionsPerConfig: REPS,
    totalPlannedTrials: CONFIGS.length * REPS,
    fatal,
    overallPredictionAccuracy: overallAccuracy,
    summary,
    trials,
    interpretation: {
      activation:
        "A_e=1 iff ms() was invoked from debug@2.6.9 during the compression workload.",
      boundary:
        "This validates a controlled runtime activation mechanism in a new parent-product environment. It does not estimate natural incident/failure/compromise probability.",
    },
  };

  fs.writeFileSync(
    path.join(OUTDIR, "p5-compression-activation-validation.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );

  const report = [];

  report.push("P5 COMPRESSION ACTIVATION VALIDATION");
  report.push("====================================");
  report.push("");
  report.push("Target exact edge: debug@2.6.9 -> ms@2.0.0");
  report.push("Product: compression@1.7.4");
  report.push(`Repetitions/config: ${REPS}`);
  report.push("");

  report.push("PRE-SPECIFIED PREDICTIONS");
  report.push("-------------------------");
  for (const c of CONFIGS) {
    report.push(
      `${c.id}: DEBUG=${c.debug || "OFF"} DEBUG_COLORS=${c.colors} predicted A=${c.predictedA}`
    );
  }

  report.push("");
  report.push("RESULTS");
  report.push("-------");

  for (const s of summary) {
    report.push(s.config);
    report.push(
      `  n=${s.n} T=${fmt(s.topologyT)} L_debug=${fmt(
        s.compressionDebugLoaded
      )} L_ms=${fmt(s.debugToMsLoaded)} D=${fmt(
        s.parentDebugCalled
      )} E=${fmt(s.debugEnabledExecution)}`
    );
    report.push(
      `  predictedA=${s.predictedA} observedA=${fmt(
        s.observedA
      )} accuracy=${fmt(s.predictionAccuracy)}`
    );
    report.push(
      `  mean debug calls=${fmt(
        s.meanDebugCalls
      )} enabled debug calls=${fmt(
        s.meanEnabledDebugCalls
      )} ms calls from debug=${fmt(s.meanMsCallsFromDebug)}`
    );
    report.push(
      `  HTTP200=${fmt(s.http200Rate)} gzip=${fmt(s.gzipRate)}`
    );
  }

  report.push("");
  report.push("OVERALL");
  report.push("-------");
  report.push(`Total planned trials=${CONFIGS.length * REPS}`);
  report.push(`Fatal=${fatal}`);
  report.push(`Overall prediction accuracy=${fmt(overallAccuracy)}`);
  report.push(
    `Validation=${fatal === 0 && overallAccuracy === 1 ? "PASS" : "CHECK"}`
  );

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "A_e is runtime activation of the exact debug@2.6.9 -> ms@2.0.0 edge."
  );
  report.push(
    "A PASS would support cross-product generality of the previously observed debug enablement/color gate in P5 Compression."
  );
  report.push(
    "This does not estimate natural vulnerability, failure, compromise, or incident probability."
  );

  fs.writeFileSync(
    path.join(OUTDIR, "p5-compression-activation-validation-report.txt"),
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log(
    "  results\\p5-compression-activation-validation\\p5-compression-activation-validation-report.txt"
  );
  console.log(
    "  results\\p5-compression-activation-validation\\p5-compression-activation-validation.json"
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
