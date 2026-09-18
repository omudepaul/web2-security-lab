#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-express");
const OUTDIR = path.join(ROOT, "results", "p1-express-e3-activation-validation");
const REPS = 10;

const CONFIGS = [
  { id: "C1_DEBUG_OFF_COLORS_ON", debug: "", colors: "1", predictedA: 0 },
  { id: "C2_ROUTER_ON_COLORS_OFF", debug: "router", colors: "0", predictedA: 0 },
  { id: "C3_ROUTER_ON_COLORS_ON", debug: "router", colors: "1", predictedA: 1 },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function fmt(v, d = 4) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "NA";
  return Number(v).toFixed(d);
}

function parseLastJson(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch (_) {}
  }
  throw new Error("No parseable worker JSON");
}

async function worker() {
  let routerDebugRequireCount = 0;
  let targetMsRequireCount = 0;

  let routerLoggerCalls = 0;
  let enabledRouterLoggerCalls = 0;
  let msCalls = 0;

  const originalLoad = Module._load;

  const routerMarker =
    `${path.sep}node_modules${path.sep}router${path.sep}`;
  const targetDebugMarker =
    `${path.sep}node_modules${path.sep}debug${path.sep}`;

  Module._load = function patchedLoad(request, parent, isMain) {
    const parentFile = parent && parent.filename ? path.normalize(parent.filename) : "";
    const lower = parentFile.toLowerCase();

    if (request === "debug" && lower.includes(routerMarker)) {
      routerDebugRequireCount += 1;
      const actualDebug = originalLoad.apply(this, arguments);

      function wrappedDebugFactory(namespace) {
        const logger = actualDebug(namespace);

        if (String(namespace) !== "router") {
          return logger;
        }

        function wrappedLogger(...args) {
          routerLoggerCalls += 1;
          if (logger.enabled) enabledRouterLoggerCalls += 1;
          return logger(...args);
        }

        for (const key of Object.keys(logger)) {
          try { wrappedLogger[key] = logger[key]; } catch (_) {}
        }

        Object.defineProperty(wrappedLogger, "enabled", {
          configurable: true,
          enumerable: true,
          get() { return logger.enabled; },
        });

        return wrappedLogger;
      }

      for (const key of Object.keys(actualDebug)) {
        try { wrappedDebugFactory[key] = actualDebug[key]; } catch (_) {}
      }

      return wrappedDebugFactory;
    }

    if (request === "ms" && lower.includes(targetDebugMarker)) {
      targetMsRequireCount += 1;
      const actualMs = originalLoad.apply(this, arguments);

      function wrappedMs(...args) {
        msCalls += 1;
        return actualMs(...args);
      }

      for (const key of Object.keys(actualMs)) {
        try { wrappedMs[key] = actualMs[key]; } catch (_) {}
      }

      return wrappedMs;
    }

    return originalLoad.apply(this, arguments);
  };

  const express = require(path.join(PRODUCT_DIR, "node_modules", "express"));
  const app = express();

  app.get("/p1-e3", (req, res) => {
    res.status(200).send("ok");
  });

  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;

  // Reset after application setup so measurements represent the request workload.
  routerLoggerCalls = 0;
  enabledRouterLoggerCalls = 0;
  msCalls = 0;

  let statusCode = null;
  let body = "";

  try {
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/p1-e3",
          method: "GET",
        },
        res => {
          statusCode = res.statusCode;
          res.setEncoding("utf8");
          res.on("data", chunk => { body += chunk; });
          res.on("end", resolve);
        }
      );

      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const D = routerLoggerCalls > 0 ? 1 : 0;
  const E = enabledRouterLoggerCalls > 0 ? 1 : 0;
  const C = process.env.DEBUG_COLORS === "1" ? 1 : 0;
  const observedA = msCalls > 0 ? 1 : 0;

  process.stdout.write(JSON.stringify({
    topologyT: 1,
    debugEnv: process.env.DEBUG || "",
    debugColorsEnv: process.env.DEBUG_COLORS ?? null,
    routerDebugRequireCount,
    targetMsRequireCount,
    routerLoggerCalls,
    enabledRouterLoggerCalls,
    msCalls,
    D,
    E,
    C,
    observedA,
    statusCode,
    body,
  }) + "\n");
}

function parent() {
  ensureDir(OUTDIR);

  const trials = [];
  let fatal = 0;

  for (const config of CONFIGS) {
    for (let rep = 1; rep <= REPS; rep++) {
      const child = spawnSync(
        process.execPath,
        [__filename, "--worker"],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            DEBUG: config.debug,
            DEBUG_COLORS: config.colors,
          },
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
        const r = parseLastJson(child.stdout);
        trials.push({
          config: config.id,
          rep,
          predictedA: config.predictedA,
          fatal: 0,
          ...r,
          predictionCorrect: Number(r.observedA) === config.predictedA ? 1 : 0,
        });
      } catch (e) {
        fatal += 1;
        trials.push({
          config: config.id,
          rep,
          predictedA: config.predictedA,
          fatal: 1,
          error: String(e),
        });
      }
    }
  }

  const summary = CONFIGS.map(config => {
    const rows = trials.filter(r => r.config === config.id && !r.fatal);

    return {
      config: config.id,
      n: rows.length,
      predictedA: config.predictedA,
      T: mean(rows.map(r => Number(r.topologyT))),
      D: mean(rows.map(r => Number(r.D))),
      E: mean(rows.map(r => Number(r.E))),
      C: mean(rows.map(r => Number(r.C))),
      observedA: mean(rows.map(r => Number(r.observedA))),
      meanRouterLoggerCalls: mean(rows.map(r => Number(r.routerLoggerCalls))),
      meanEnabledRouterLoggerCalls: mean(rows.map(r => Number(r.enabledRouterLoggerCalls))),
      meanMsCalls: mean(rows.map(r => Number(r.msCalls))),
      http200Rate: mean(rows.map(r => Number(r.statusCode) === 200 ? 1 : 0)),
      bodyOkRate: mean(rows.map(r => r.body === "ok" ? 1 : 0)),
      predictionAccuracy: mean(rows.map(r => Number(r.predictionCorrect))),
    };
  });

  const valid = trials.filter(r => !r.fatal);
  const overallPredictionAccuracy = mean(valid.map(r => Number(r.predictionCorrect)));

  const validationPass =
    fatal === 0 &&
    overallPredictionAccuracy === 1 &&
    summary.every(s => Number(s.observedA) === Number(s.predictedA));

  const result = {
    experiment: "P1 Express E3 cross-product activation validation",
    product: "express@5.2.1",
    parentPackage: "router@2.2.0",
    namespace: "router",
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
      D: "router debug logger invoked during request",
      E: "router namespace enabled during request",
      C: "debug colors enabled",
      A: "target debug@4.4.3 -> ms@2.1.3 edge invoked during request",
      boundary: "Controlled runtime activation validation only; no natural risk probability estimated.",
    },
  };

  fs.writeFileSync(
    path.join(OUTDIR, "p1-express-e3-activation-validation.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );

  const report = [];
  report.push("P1 EXPRESS E3 CROSS-PRODUCT ACTIVATION VALIDATION");
  report.push("================================================");
  report.push("");
  report.push("Product: express@5.2.1");
  report.push("Parent package: router@2.2.0");
  report.push("Namespace: router");
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
    report.push(`  n=${s.n} T=${fmt(s.T)} D=${fmt(s.D)} E=${fmt(s.E)} C=${fmt(s.C)}`);
    report.push(
      `  predicted A=${s.predictedA} observed A=${fmt(s.observedA)} prediction accuracy=${fmt(s.predictionAccuracy)}`
    );
    report.push(
      `  mean router logger calls=${fmt(s.meanRouterLoggerCalls)} enabled calls=${fmt(s.meanEnabledRouterLoggerCalls)} ms calls=${fmt(s.meanMsCalls)}`
    );
    report.push(`  HTTP200=${fmt(s.http200Rate)} body-ok=${fmt(s.bodyOkRate)}`);
  }

  report.push("");
  report.push("OVERALL");
  report.push("-------");
  report.push(`Total planned trials=${CONFIGS.length * REPS}`);
  report.push(`Fatal=${fatal}`);
  report.push(`Overall prediction accuracy=${fmt(overallPredictionAccuracy)}`);
  report.push(`Validation=${validationPass ? "PASS" : "CHECK"}`);

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "A PASS would validate the same exact debug@4.4.3 -> ms@2.1.3 activation mechanism in P1 Express after it was first validated in P6 Socket.IO."
  );
  report.push(
    "That is cross-product validation of the exact version pair under a different parent/workload context."
  );
  report.push(
    "This does not estimate natural failure, vulnerability, compromise, incident, or risk probability."
  );

  fs.writeFileSync(
    path.join(OUTDIR, "p1-express-e3-activation-validation-report.txt"),
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log("  results\\p1-express-e3-activation-validation\\p1-express-e3-activation-validation-report.txt");
  console.log("  results\\p1-express-e3-activation-validation\\p1-express-e3-activation-validation.json");
}

if (process.argv.includes("--worker")) {
  worker().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  parent();
}
