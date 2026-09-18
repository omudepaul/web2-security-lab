#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-socketio");
const OUTDIR = path.join(ROOT, "results", "p6-engineio-debug44-ms21-propagation-validation");

const REPS = 10;
const DELAY_PER_CALL_MS = 10;

const CONTEXTS = [
  { id: "INACTIVE_COLORS_OFF", debug: "engine", colors: "0", predictedAlpha: 0 },
  { id: "ACTIVE_COLORS_ON", debug: "engine", colors: "1", predictedAlpha: 1 },
];

const CONDITIONS = ["BASELINE", "CORRUPT_HUMANIZE", "EMPTY_HUMANIZE", "DELAY_HUMANIZE"];

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function mean(xs) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function fmt(v) { return v == null || !Number.isFinite(Number(v)) ? "NA" : Number(v).toFixed(4); }
function lastJsonLine(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  for (let i=lines.length-1;i>=0;i--) { try { return JSON.parse(lines[i]); } catch (_) {} }
  throw new Error("No parseable worker JSON");
}
function busyWait(ms) {
  const start = process.hrtime.bigint();
  const target = BigInt(ms) * 1000000n;
  while (process.hrtime.bigint() - start < target) {}
}

async function worker() {
  const condition = process.env.P6_PROP_CONDITION || "BASELINE";

  let debugRequireCount = 0, msRequireCount = 0;
  let debugCalls = 0, enabledDebugCalls = 0;
  let msCalls = 0, alteredMsCalls = 0, injectedDelayMs = 0;
  const namespaces = new Set();

  const originalLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    const parentFile = parent && parent.filename ? path.normalize(parent.filename) : "";
    const lower = parentFile.toLowerCase();
    const engineMarker = `${path.sep}node_modules${path.sep}engine.io${path.sep}`;
    const targetDebugMarker =
      `${path.sep}node_modules${path.sep}engine.io${path.sep}node_modules${path.sep}debug${path.sep}`;

    if (request === "debug" && lower.includes(engineMarker) && !lower.includes(targetDebugMarker)) {
      debugRequireCount++;
      const actualDebug = originalLoad.apply(this, arguments);

      function wrappedFactory(namespace) {
        namespaces.add(String(namespace));
        const logger = actualDebug(namespace);

        function wrappedLogger(...args) {
          debugCalls++;
          if (logger.enabled) enabledDebugCalls++;
          return logger(...args);
        }

        for (const k of Object.keys(logger)) {
          try { wrappedLogger[k] = logger[k]; } catch (_) {}
        }
        Object.defineProperty(wrappedLogger, "enabled", {
          configurable: true, enumerable: true, get() { return logger.enabled; }
        });
        return wrappedLogger;
      }

      for (const k of Object.keys(actualDebug)) {
        try { wrappedFactory[k] = actualDebug[k]; } catch (_) {}
      }
      return wrappedFactory;
    }

    if (request === "ms" && lower.includes(targetDebugMarker)) {
      msRequireCount++;
      const actualMs = originalLoad.apply(this, arguments);

      function wrappedMs(...args) {
        msCalls++;
        const baseline = actualMs(...args);
        if (condition === "CORRUPT_HUMANIZE") {
          alteredMsCalls++;
          return "CORRUPTED_MS";
        }
        if (condition === "EMPTY_HUMANIZE") {
          alteredMsCalls++;
          return "";
        }
        if (condition === "DELAY_HUMANIZE") {
          alteredMsCalls++;
          busyWait(DELAY_PER_CALL_MS);
          injectedDelayMs += DELAY_PER_CALL_MS;
          return baseline;
        }
        return baseline;
      }

      for (const k of Object.keys(actualMs)) {
        try { wrappedMs[k] = actualMs[k]; } catch (_) {}
      }
      return wrappedMs;
    }

    return originalLoad.apply(this, arguments);
  };

  const { Server } = require(path.join(PRODUCT_DIR, "node_modules", "socket.io"));
  const server = http.createServer();
  const io = new Server(server, { serveClient: false });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  let statusCode = null, body = "";
  const t0 = process.hrtime.bigint();

  try {
    await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
        method: "GET",
      }, res => {
        statusCode = res.statusCode;
        res.setEncoding("utf8");
        res.on("data", c => { body += c; });
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise(resolve => io.close(()=>resolve()));
  }

  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const observedAlpha = msCalls > 0 ? 1 : 0;
  const impact = alteredMsCalls > 0 ? 1 : 0;

  process.stdout.write(JSON.stringify({
    condition,
    topologyT: 1,
    debugRequireCount,
    msRequireCount,
    namespaces: [...namespaces].sort(),
    debugCalls,
    enabledDebugCalls,
    msCalls,
    alteredMsCalls,
    injectedDelayMs,
    observedAlpha,
    impact,
    elapsedMs,
    statusCode,
    engineOpenPacket: body.startsWith("0") ? 1 : 0,
  }) + "\n");
}

function parent() {
  ensureDir(OUTDIR);
  const trials = [];
  let fatal = 0;

  for (const context of CONTEXTS) {
    for (const condition of CONDITIONS) {
      for (let rep=1; rep<=REPS; rep++) {
        const child = spawnSync(process.execPath, [__filename, "--worker"], {
          cwd: ROOT,
          env: {
            ...process.env,
            DEBUG: context.debug,
            DEBUG_COLORS: context.colors,
            P6_PROP_CONDITION: condition,
          },
          encoding: "utf8",
          timeout: 30000,
        });

        if (child.error || child.status !== 0) {
          fatal++;
          trials.push({ context: context.id, condition, rep, fatal: 1,
            error: child.error ? String(child.error) : `exit=${child.status}; stderr=${child.stderr}` });
          continue;
        }

        try {
          const r = lastJsonLine(child.stdout);
          const predictedImpact = context.predictedAlpha === 1 && condition !== "BASELINE" ? 1 : 0;
          trials.push({
            context: context.id, condition, rep, fatal: 0,
            predictedAlpha: context.predictedAlpha, predictedImpact,
            ...r,
            alphaCorrect: Number(r.observedAlpha) === context.predictedAlpha ? 1 : 0,
            impactCorrect: Number(r.impact) === predictedImpact ? 1 : 0,
          });
        } catch (e) {
          fatal++;
          trials.push({ context: context.id, condition, rep, fatal: 1, error: String(e) });
        }
      }
    }
  }

  const summary = [];
  for (const context of CONTEXTS) {
    for (const condition of CONDITIONS) {
      const rows = trials.filter(r=>!r.fatal && r.context===context.id && r.condition===condition);
      const activeRows = rows.filter(r=>r.observedAlpha===1);
      const q = activeRows.length
        ? (condition === "BASELINE" ? 0 : mean(activeRows.map(r=>r.impact)))
        : null;

      summary.push({
        context: context.id,
        condition,
        n: rows.length,
        predictedAlpha: context.predictedAlpha,
        observedAlpha: mean(rows.map(r=>r.observedAlpha)),
        topologyT: mean(rows.map(r=>r.topologyT)),
        debugCalled: mean(rows.map(r=>r.debugCalls>0?1:0)),
        enabledExecution: mean(rows.map(r=>r.enabledDebugCalls>0?1:0)),
        qConditionalOnActive: q,
        impactRate: mean(rows.map(r=>r.impact)),
        meanDebugCalls: mean(rows.map(r=>r.debugCalls)),
        meanEnabledDebugCalls: mean(rows.map(r=>r.enabledDebugCalls)),
        meanMsCalls: mean(rows.map(r=>r.msCalls)),
        meanAlteredMsCalls: mean(rows.map(r=>r.alteredMsCalls)),
        meanInjectedDelayMs: mean(rows.map(r=>r.injectedDelayMs)),
        meanElapsedMs: mean(rows.map(r=>r.elapsedMs)),
        http200Rate: mean(rows.map(r=>r.statusCode===200?1:0)),
        engineOpenPacketRate: mean(rows.map(r=>r.engineOpenPacket)),
        alphaPredictionAccuracy: mean(rows.map(r=>r.alphaCorrect)),
        impactPredictionAccuracy: mean(rows.map(r=>r.impactCorrect)),
      });
    }
  }

  const baseline = {};
  for (const c of CONTEXTS) {
    const row = summary.find(s=>s.context===c.id && s.condition==="BASELINE");
    baseline[c.id] = row ? row.meanElapsedMs : null;
  }
  for (const s of summary) {
    s.meanLatencyDeltaVsContextBaselineMs =
      Number.isFinite(baseline[s.context]) ? s.meanElapsedMs - baseline[s.context] : null;
  }

  const valid = trials.filter(r=>!r.fatal);
  const alphaAcc = mean(valid.map(r=>r.alphaCorrect));
  const impactAcc = mean(valid.map(r=>r.impactCorrect));
  const activeNonBase = summary.filter(s=>s.context==="ACTIVE_COLORS_ON" && s.condition!=="BASELINE");
  const validationPass = fatal===0 && alphaAcc===1 && impactAcc===1 &&
    activeNonBase.length===3 && activeNonBase.every(s=>s.qConditionalOnActive===1);

  const result = {
    experiment: "P6 Engine.IO debug@4.4.3 -> ms@2.1.3 propagation validation",
    product: "socket.io@4.8.1",
    parentPackage: "engine.io@6.6.10",
    targetEdge: "debug@4.4.3 -> ms@2.1.3",
    repetitionsPerCell: REPS,
    delayPerMsCall: DELAY_PER_CALL_MS,
    totalPlannedTrials: CONTEXTS.length * CONDITIONS.length * REPS,
    fatal,
    overallAlphaPredictionAccuracy: alphaAcc,
    overallImpactPredictionAccuracy: impactAcc,
    validationPass,
    summary,
    trials,
  };

  fs.writeFileSync(
    path.join(OUTDIR, "p6-engineio-debug44-ms21-propagation-validation.json"),
    JSON.stringify(result, null, 2)
  );

  const report = [];
  report.push("P6 ENGINE.IO DEBUG@4.4.3 -> MS@2.1.3 PROPAGATION VALIDATION");
  report.push("===========================================================");
  report.push("");
  report.push("Product: socket.io@4.8.1");
  report.push("Parent package: engine.io@6.6.10");
  report.push("Target exact edge: debug@4.4.3 -> ms@2.1.3");
  report.push(`Repetitions/cell=${REPS}`);
  report.push(`Delay per target ms call=${DELAY_PER_CALL_MS} ms`);
  report.push("");
  report.push("RESULTS");
  report.push("-------");
  for (const s of summary) {
    report.push(`${s.context} / ${s.condition}`);
    report.push(`  n=${s.n} T=${fmt(s.topologyT)} D=${fmt(s.debugCalled)} E=${fmt(s.enabledExecution)}`);
    report.push(`  predicted alpha=${s.predictedAlpha} observed alpha=${fmt(s.observedAlpha)} q|active=${fmt(s.qConditionalOnActive)} impact=${fmt(s.impactRate)}`);
    report.push(`  mean debug calls=${fmt(s.meanDebugCalls)} enabled calls=${fmt(s.meanEnabledDebugCalls)} ms calls=${fmt(s.meanMsCalls)}`);
    report.push(`  mean altered ms calls=${fmt(s.meanAlteredMsCalls)} injected delay=${fmt(s.meanInjectedDelayMs)} ms`);
    report.push(`  latency delta vs context baseline=${fmt(s.meanLatencyDeltaVsContextBaselineMs)} ms`);
    report.push(`  HTTP200=${fmt(s.http200Rate)} Engine.IO open packet=${fmt(s.engineOpenPacketRate)}`);
  }
  report.push("");
  report.push("OVERALL");
  report.push("-------");
  report.push(`Total planned trials=${result.totalPlannedTrials}`);
  report.push(`Fatal=${fatal}`);
  report.push(`Overall alpha prediction accuracy=${fmt(alphaAcc)}`);
  report.push(`Overall impact prediction accuracy=${fmt(impactAcc)}`);
  report.push(`Validation=${validationPass ? "PASS" : "CHECK"}`);
  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push("Inactive-context trials test whether a structurally present but runtime-inactive edge blocks controlled perturbation.");
  report.push("Active-context trials test deterministic propagation through the activated debug@4.4.3 -> ms@2.1.3 edge.");
  report.push("A PASS extends the earlier debug@2.6.9 -> ms@2.0.0 propagation mechanism to a different debug/ms version pair.");
  report.push("q=1 under deterministic perturbation is mechanism validation only, not a natural failure or compromise probability.");
  report.push("HTTP success can coexist with observability/timing-layer impact.");

  fs.writeFileSync(
    path.join(OUTDIR, "p6-engineio-debug44-ms21-propagation-validation-report.txt"),
    report.join("\n")
  );

  console.log(report.join("\n"));
}

if (process.argv.includes("--worker")) {
  worker().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  parent();
}
