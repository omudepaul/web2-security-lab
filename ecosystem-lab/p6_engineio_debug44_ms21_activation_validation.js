#!/usr/bin/env node
"use strict";

/*
  P6 SOCKET.IO / ENGINE.IO VERSION-GENERALIZATION ACTIVATION VALIDATION

  Target:
    debug@4.4.3 -> ms@2.1.3

  Parent environment:
    engine.io@6.6.10 inside socket.io@4.8.1

  Pre-specified rule:
    A ~= D AND E AND C

  Configurations:
    C1 DEBUG off, colors on  -> A=0
    C2 DEBUG=engine, colors off -> A=0
    C3 DEBUG=engine, colors on  -> A=1

  Controlled runtime activation experiment only.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-socketio");
const OUTDIR = path.join(
  ROOT,
  "results",
  "p6-engineio-debug44-ms21-activation-validation"
);

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
    debug: "engine",
    colors: "0",
    predictedA: 0,
  },
  {
    id: "C3_DEBUG_ON_COLORS_ON",
    debug: "engine",
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
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "NA";
  }
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

  throw new Error(`Worker returned no parseable JSON.\nstdout:\n${stdout}`);
}

async function worker() {
  let targetDebugRequireCount = 0;
  let targetMsRequireCount = 0;

  let debugLoggerCalls = 0;
  let enabledDebugLoggerCalls = 0;
  const namespaces = new Set();

  let msCallsFromTargetDebug = 0;

  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    const parentFile =
      parent && parent.filename ? path.normalize(parent.filename) : "";
    const lower = parentFile.toLowerCase();

    const engineMarker =
      `${path.sep}node_modules${path.sep}engine.io${path.sep}`;

    const targetDebugMarker =
      `${path.sep}node_modules${path.sep}engine.io${path.sep}` +
      `node_modules${path.sep}debug${path.sep}`;

    if (
      request === "debug" &&
      lower.includes(engineMarker) &&
      !lower.includes(targetDebugMarker)
    ) {
      targetDebugRequireCount += 1;

      const actualDebug = originalLoad.apply(this, arguments);

      function wrappedDebugFactory(namespace) {
        namespaces.add(String(namespace));
        const logger = actualDebug(namespace);

        function wrappedLogger(...args) {
          debugLoggerCalls += 1;
          if (logger.enabled) {
            enabledDebugLoggerCalls += 1;
          }
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
      lower.includes(targetDebugMarker)
    ) {
      targetMsRequireCount += 1;

      const actualMs = originalLoad.apply(this, arguments);

      function wrappedMs(...args) {
        msCallsFromTargetDebug += 1;
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

  const socketIoPath = path.join(
    PRODUCT_DIR,
    "node_modules",
    "socket.io"
  );

  const { Server } = require(socketIoPath);

  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    serveClient: false,
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });

  const port = httpServer.address().port;

  let statusCode = null;
  let responseBody = "";
  let contentType = null;

  try {
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
          method: "GET",
        },
        res => {
          statusCode = res.statusCode;
          contentType = res.headers["content-type"] || null;

          res.setEncoding("utf8");
          res.on("data", chunk => {
            responseBody += chunk;
          });

          res.on("end", resolve);
        }
      );

      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise(resolve => {
      io.close(() => resolve());
    });
  }

  const observedA = msCallsFromTargetDebug > 0 ? 1 : 0;

  const result = {
    config: process.env.P6_CONFIG_ID || "UNKNOWN",

    debugEnv: process.env.DEBUG || "",
    debugColorsEnv: process.env.DEBUG_COLORS ?? null,

    topologyT: 1,

    targetDebugRequireCount,
    targetMsRequireCount,

    namespaces: [...namespaces].sort(),

    debugLoggerCalls,
    enabledDebugLoggerCalls,
    msCallsFromTargetDebug,

    D: debugLoggerCalls > 0 ? 1 : 0,
    E: enabledDebugLoggerCalls > 0 ? 1 : 0,
    C: process.env.DEBUG_COLORS === "1" ? 1 : 0,
    observedA,

    statusCode,
    contentType,
    engineOpenPacket:
      typeof responseBody === "string" && responseBody.startsWith("0") ? 1 : 0,
    responsePrefix: responseBody.slice(0, 120),
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
        P6_CONFIG_ID: config.id,
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
          predictionCorrect:
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

  const summary = [];

  for (const config of CONFIGS) {
    const rows = trials.filter(
      r => r.config === config.id && !r.fatal
    );

    summary.push({
      config: config.id,
      n: rows.length,
      predictedA: config.predictedA,

      topologyT: mean(rows.map(r => Number(r.topologyT))),
      D: mean(rows.map(r => Number(r.D))),
      E: mean(rows.map(r => Number(r.E))),
      C: mean(rows.map(r => Number(r.C))),
      observedA: mean(rows.map(r => Number(r.observedA))),

      meanTargetDebugRequires: mean(
        rows.map(r => Number(r.targetDebugRequireCount))
      ),
      meanTargetMsRequires: mean(
        rows.map(r => Number(r.targetMsRequireCount))
      ),
      meanDebugLoggerCalls: mean(
        rows.map(r => Number(r.debugLoggerCalls))
      ),
      meanEnabledDebugLoggerCalls: mean(
        rows.map(r => Number(r.enabledDebugLoggerCalls))
      ),
      meanMsCallsFromTargetDebug: mean(
        rows.map(r => Number(r.msCallsFromTargetDebug))
      ),

      http200Rate: mean(
        rows.map(r => (Number(r.statusCode) === 200 ? 1 : 0))
      ),
      engineOpenPacketRate: mean(
        rows.map(r => Number(r.engineOpenPacket))
      ),

      predictionAccuracy: mean(
        rows.map(r => Number(r.predictionCorrect))
      ),

      namespaces:
        rows.length > 0
          ? [...new Set(rows.flatMap(r => r.namespaces || []))].sort()
          : [],
    });
  }

  const valid = trials.filter(r => !r.fatal);

  const overallPredictionAccuracy = mean(
    valid.map(r => Number(r.predictionCorrect))
  );

  const validationPass =
    fatal === 0 &&
    overallPredictionAccuracy === 1 &&
    summary.every(
      s => Number(s.observedA) === Number(s.predictedA)
    );

  const result = {
    experiment:
      "P6 Engine.IO debug@4.4.3 -> ms@2.1.3 activation validation",
    product: "socket.io@4.8.1",
    parentPackage: "engine.io@6.6.10",
    targetEdge: "debug@4.4.3 -> ms@2.1.3",
    repetitionsPerConfig: REPS,
    totalPlannedTrials: CONFIGS.length * REPS,
    fatal,
    overallPredictionAccuracy,
    validationPass,
    summary,
    trials,
    interpretation: {
      rule: "A ~= D AND E AND C",
      D: "Engine.IO debug logger invoked",
      E: "selected Engine.IO debug namespace enabled",
      C: "debug colors enabled",
      A: "target debug@4.4.3 -> ms@2.1.3 edge invoked",
      boundary:
        "Runtime activation validation only; no natural lambda or natural risk is estimated.",
    },
  };

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "p6-engineio-debug44-ms21-activation-validation.json"
    ),
    JSON.stringify(result, null, 2),
    "utf8"
  );

  const report = [];

  report.push(
    "P6 ENGINE.IO DEBUG@4.4.3 -> MS@2.1.3 ACTIVATION VALIDATION"
  );
  report.push(
    "=========================================================="
  );
  report.push("");
  report.push("Product: socket.io@4.8.1");
  report.push("Parent package: engine.io@6.6.10");
  report.push("Target exact edge: debug@4.4.3 -> ms@2.1.3");
  report.push(`Repetitions/config=${REPS}`);
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
      `  n=${s.n} T=${fmt(s.topologyT)} D=${fmt(s.D)} E=${fmt(s.E)} C=${fmt(s.C)}`
    );
    report.push(
      `  predicted A=${s.predictedA} observed A=${fmt(s.observedA)} prediction accuracy=${fmt(s.predictionAccuracy)}`
    );
    report.push(
      `  mean debug requires=${fmt(s.meanTargetDebugRequires)} mean ms requires=${fmt(s.meanTargetMsRequires)}`
    );
    report.push(
      `  mean debug logger calls=${fmt(s.meanDebugLoggerCalls)} enabled calls=${fmt(s.meanEnabledDebugLoggerCalls)} ms calls=${fmt(s.meanMsCallsFromTargetDebug)}`
    );
    report.push(
      `  HTTP200=${fmt(s.http200Rate)} Engine.IO open packet=${fmt(s.engineOpenPacketRate)}`
    );
    report.push(
      `  observed namespaces=${s.namespaces.join(",") || "NONE"}`
    );
  }

  report.push("");
  report.push("OVERALL");
  report.push("-------");
  report.push(`Total planned trials=${CONFIGS.length * REPS}`);
  report.push(`Fatal=${fatal}`);
  report.push(
    `Overall prediction accuracy=${fmt(overallPredictionAccuracy)}`
  );
  report.push(`Validation=${validationPass ? "PASS" : "CHECK"}`);

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "This experiment tests whether the previously observed debug->ms color/enabled activation mechanism generalizes to a different version pair."
  );
  report.push(
    "A PASS supports version-level mechanism generalization from debug@2.6.9->ms@2.0.0 to debug@4.4.3->ms@2.1.3 in the tested Engine.IO context."
  );
  report.push(
    "This is runtime activation evidence only. It is not a natural failure, vulnerability, compromise, or risk probability."
  );

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "p6-engineio-debug44-ms21-activation-validation-report.txt"
    ),
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log(
    "  results\\p6-engineio-debug44-ms21-activation-validation\\p6-engineio-debug44-ms21-activation-validation-report.txt"
  );
  console.log(
    "  results\\p6-engineio-debug44-ms21-activation-validation\\p6-engineio-debug44-ms21-activation-validation.json"
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
