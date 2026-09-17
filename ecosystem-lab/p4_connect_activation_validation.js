#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const PRODUCT = path.join(ROOT, "product-connect");
const OUTDIR = path.join(ROOT, "results", "p4-connect-activation-validation");
const REPS = 10;

const CONFIGS = [
  { id: "C1_DEBUG_OFF_COLORS_ON", debug: "", colors: "1", predictedA: 0 },
  { id: "C2_DEBUG_ON_COLORS_OFF", debug: "connect:dispatcher", colors: "0", predictedA: 0 },
  { id: "C3_DEBUG_ON_COLORS_ON", debug: "connect:dispatcher", colors: "1", predictedA: 1 },
];

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function mean(xs) {
  const a = xs.filter(Number.isFinite);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
function fmt(x, d = 4) {
  return x === null || x === undefined || !Number.isFinite(Number(x))
    ? "NA"
    : Number(x).toFixed(d);
}
function resolveFromProduct(pkg) {
  return require.resolve(pkg, { paths: [PRODUCT] });
}

async function childRun(configId) {
  const cfg = CONFIGS.find(c => c.id === configId);
  if (!cfg) throw new Error("Unknown config " + configId);

  process.env.DEBUG = cfg.debug;
  process.env.DEBUG_COLORS = cfg.colors;

  const connectPkg = JSON.parse(fs.readFileSync(resolveFromProduct("connect/package.json"), "utf8"));
  const debugPkg = JSON.parse(fs.readFileSync(resolveFromProduct("debug/package.json"), "utf8"));
  const msPkg = JSON.parse(fs.readFileSync(resolveFromProduct("ms/package.json"), "utf8"));

  if (connectPkg.version !== "3.7.0") throw new Error("Expected connect@3.7.0");
  if (debugPkg.version !== "2.6.9") throw new Error("Expected debug@2.6.9");
  if (msPkg.version !== "2.0.0") throw new Error("Expected ms@2.0.0");

  // Wrap ms before debug loads it.
  const msMain = resolveFromProduct("ms");
  const originalMs = require(msMain);
  let msCallsFromDebug = 0;

  function wrappedMs(...args) {
    const stack = String(new Error().stack || "");
    if (stack.includes("node_modules\\debug\\") || stack.includes("/node_modules/debug/")) {
      msCallsFromDebug++;
    }
    return originalMs.apply(this, args);
  }
  Object.assign(wrappedMs, originalMs);
  require.cache[msMain].exports = wrappedMs;

  // Wrap only connect:dispatcher logger so we know Connect called debug.
  const debugMain = resolveFromProduct("debug");
  const originalDebugFactory = require(debugMain);
  let connectDebugCalls = 0;
  let connectDebugEnabledCalls = 0;

  function patchedDebugFactory(namespace) {
    const originalLogger = originalDebugFactory(namespace);
    if (namespace !== "connect:dispatcher") return originalLogger;

    function wrappedLogger(...args) {
      connectDebugCalls++;
      if (originalLogger.enabled) connectDebugEnabledCalls++;
      return originalLogger.apply(this, args);
    }

    for (const k of Object.keys(originalLogger)) {
      try { wrappedLogger[k] = originalLogger[k]; } catch (_) {}
    }
    return wrappedLogger;
  }

  for (const k of Object.keys(originalDebugFactory)) {
    try { patchedDebugFactory[k] = originalDebugFactory[k]; } catch (_) {}
  }
  require.cache[debugMain].exports = patchedDebugFactory;

  const connect = require(resolveFromProduct("connect"));
  const app = connect();

  app.use(function validationMiddleware(req, res) {
    res.statusCode = 200;
    res.end("ok");
  });

  const server = http.createServer(app);

  const statusCode = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const req = http.get({ host: "127.0.0.1", port, path: "/validation" }, res => {
        res.resume();
        res.on("end", () => server.close(() => resolve(res.statusCode)));
      });
      req.on("error", err => server.close(() => reject(err)));
    });
  });

  const D = connectDebugCalls > 0 ? 1 : 0;
  const E = connectDebugEnabledCalls > 0 ? 1 : 0;
  const A = msCallsFromDebug > 0 ? 1 : 0;

  return {
    config: cfg.id,
    T_path: 1,
    L_debug: require.cache[debugMain] ? 1 : 0,
    L_ms: require.cache[msMain] ? 1 : 0,
    D_parent_debug_called: D,
    E_debug_enabled: E,
    A_debug_ms: A,
    predictedA: cfg.predictedA,
    predictionCorrect: A === cfg.predictedA ? 1 : 0,
    connectDebugCalls,
    connectDebugEnabledCalls,
    msCallsFromDebug,
    httpStatus: statusCode
  };
}

async function childMode() {
  try {
    const row = await childRun(process.argv[3]);
    process.stdout.write(JSON.stringify(row));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      fatalError: true,
      error: e && e.stack ? e.stack : String(e)
    }));
    process.exitCode = 1;
  }
}

function parentMode() {
  if (!fs.existsSync(PRODUCT)) throw new Error("Missing " + PRODUCT);
  ensureDir(OUTDIR);

  const trials = [];

  for (const cfg of CONFIGS) {
    for (let rep = 1; rep <= REPS; rep++) {
      const cp = spawnSync(process.execPath, [__filename, "--child", cfg.id], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env },
        maxBuffer: 10 * 1024 * 1024
      });

      let row;
      try {
        row = JSON.parse((cp.stdout || "").trim());
      } catch (_) {
        row = { fatalError: true, error: "Could not parse child output", stdout: cp.stdout, stderr: cp.stderr };
      }

      row.rep = rep;
      row.childExitCode = cp.status;
      trials.push(row);
    }
  }

  const good = trials.filter(r => !r.fatalError);
  const fatal = trials.filter(r => r.fatalError);

  const summary = CONFIGS.map(cfg => {
    const rows = good.filter(r => r.config === cfg.id);
    return {
      config: cfg.id,
      trials: rows.length,
      predictedA: cfg.predictedA,
      observedA: mean(rows.map(r => Number(r.A_debug_ms))),
      T_path: mean(rows.map(r => Number(r.T_path))),
      L_debug: mean(rows.map(r => Number(r.L_debug))),
      L_ms: mean(rows.map(r => Number(r.L_ms))),
      D_parent_debug_called: mean(rows.map(r => Number(r.D_parent_debug_called))),
      E_debug_enabled: mean(rows.map(r => Number(r.E_debug_enabled))),
      predictionAccuracy: mean(rows.map(r => Number(r.predictionCorrect))),
      meanConnectDebugCalls: mean(rows.map(r => Number(r.connectDebugCalls))),
      meanMsCallsFromDebug: mean(rows.map(r => Number(r.msCallsFromDebug))),
      httpSuccessRate: mean(rows.map(r => Number(r.httpStatus) === 200 ? 1 : 0))
    };
  });

  const overallAccuracy = mean(good.map(r => Number(r.predictionCorrect)));

  const passed =
    fatal.length === 0 &&
    summary.every(r =>
      r.trials === REPS &&
      r.predictionAccuracy === 1 &&
      r.T_path === 1 &&
      r.L_debug === 1 &&
      r.L_ms === 1 &&
      r.D_parent_debug_called === 1 &&
      r.httpSuccessRate === 1
    );

  const output = {
    analysis: "P4 Connect external-context activation validation",
    product: "connect@3.7.0",
    exactEdge: "debug@2.6.9 -> ms@2.0.0",
    path: "connect@3.7.0 -> debug@2.6.9 -> ms@2.0.0",
    preSpecifiedRule:
      "A_debug_ms should occur only when Connect calls debug, the namespace is enabled, and colors are enabled.",
    status: passed ? "PASS" : "CHECK_RESULTS",
    repetitionsPerConfiguration: REPS,
    overallPredictionAccuracy: overallAccuracy,
    fatalTrials: fatal.length,
    summary,
    trials,
    caution:
      "This is broader validation in a new parent-product environment. It is not a natural incident-rate estimate and not a fully independent package implementation because the same exact debug@2.6.9 -> ms@2.0.0 edge is reused."
  };

  fs.writeFileSync(
    path.join(OUTDIR, "p4-connect-activation-validation.json"),
    JSON.stringify(output, null, 2),
    "utf8"
  );

  const report = [];
  report.push("P4 CONNECT EXTERNAL-CONTEXT ACTIVATION VALIDATION");
  report.push("=================================================");
  report.push("");
  report.push("Product: connect@3.7.0");
  report.push("Exact edge: debug@2.6.9 -> ms@2.0.0");
  report.push("Path: connect@3.7.0 -> debug@2.6.9 -> ms@2.0.0");
  report.push("");
  report.push("PRE-SPECIFIED PREDICTION");
  report.push("------------------------");
  report.push("C1 DEBUG off, colors on  => predicted A=0");
  report.push("C2 DEBUG on, colors off  => predicted A=0");
  report.push("C3 DEBUG on, colors on   => predicted A=1");
  report.push("");
  report.push("RESULTS");
  report.push("-------");

  for (const r of summary) {
    report.push(r.config);
    report.push(
      `  trials=${r.trials} predictedA=${fmt(r.predictedA,0)} observedA=${fmt(r.observedA)} accuracy=${fmt(r.predictionAccuracy)}`
    );
    report.push(
      `  T=${fmt(r.T_path)} L_debug=${fmt(r.L_debug)} L_ms=${fmt(r.L_ms)} D=${fmt(r.D_parent_debug_called)} E=${fmt(r.E_debug_enabled)}`
    );
    report.push(
      `  meanConnectDebugCalls=${fmt(r.meanConnectDebugCalls)} meanMsCallsFromDebug=${fmt(r.meanMsCallsFromDebug)} HTTP200=${fmt(r.httpSuccessRate)}`
    );
  }

  report.push("");
  report.push("OVERALL");
  report.push("-------");
  report.push(`status=${output.status}`);
  report.push(`fatal trials=${fatal.length}`);
  report.push(`overall prediction accuracy=${fmt(overallAccuracy)}`);
  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "A PASS means the activation rule learned from the earlier product environments reproduced in the new Connect parent-product environment."
  );
  report.push(
    "This supports cross-product generality of the context gate for the reused exact debug@2.6.9 -> ms@2.0.0 edge."
  );
  report.push(
    "It does not estimate natural vulnerability, failure, compromise, or incident frequency."
  );

  fs.writeFileSync(
    path.join(OUTDIR, "p4-connect-activation-validation-report.txt"),
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
}

if (process.argv[2] === "--child") {
  childMode();
} else {
  parentMode();
}
