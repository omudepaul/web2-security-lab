#!/usr/bin/env node
"use strict";

/*
  P4 CONNECT EXTERNAL-CONTEXT PROPAGATION VALIDATION

  Product:
    connect@3.7.0

  Reused exact edge:
    debug@2.6.9 -> ms@2.0.0

  New path:
    connect@3.7.0 -> debug@2.6.9 -> ms@2.0.0

  Pre-specified rule from earlier products:
    - Inactive context: DEBUG on, colors off => A=0, so injected perturbations should not impact.
    - Active context:   DEBUG on, colors on  => A=1.
      For deterministic controlled perturbations:
        CORRUPT_HUMANIZE => observability corruption
        EMPTY_HUMANIZE   => observability suppression
        DELAY_HUMANIZE   => latency increase
      and q(impact | active, perturbation) is expected to be 1 in this controlled setup.

  IMPORTANT:
    This validates mechanism generality in a new parent-product environment.
    It does NOT estimate natural failure, compromise, vulnerability, or incident frequency.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const PRODUCT = path.join(ROOT, "product-connect");
const OUTDIR = path.join(ROOT, "results", "p4-connect-propagation-validation");
const REPS = 10;

const CONTEXTS = [
  {
    id: "INACTIVE_COLORS_OFF",
    debug: "connect:dispatcher",
    colors: "0",
    expectedA: 0,
  },
  {
    id: "ACTIVE_COLORS_ON",
    debug: "connect:dispatcher",
    colors: "1",
    expectedA: 1,
  },
];

const CONDITIONS = [
  { id: "BASELINE", expectedImpactWhenActive: 0, type: "NONE" },
  { id: "CORRUPT_HUMANIZE", expectedImpactWhenActive: 1, type: "OBSERVABILITY_CORRUPTION" },
  { id: "EMPTY_HUMANIZE", expectedImpactWhenActive: 1, type: "OBSERVABILITY_SUPPRESSION" },
  { id: "DELAY_HUMANIZE", expectedImpactWhenActive: 1, type: "LATENCY" },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function resolveFromProduct(pkg) {
  return require.resolve(pkg, { paths: [PRODUCT] });
}

function mean(xs) {
  const a = xs.filter(Number.isFinite);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

function median(xs) {
  const a = xs.filter(Number.isFinite).slice().sort((a,b) => a-b);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

function fmt(x, d = 4) {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return "NA";
  return Number(x).toFixed(d);
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

async function childRun(contextId, conditionId) {
  const ctx = CONTEXTS.find(c => c.id === contextId);
  const cond = CONDITIONS.find(c => c.id === conditionId);
  if (!ctx) throw new Error(`Unknown context: ${contextId}`);
  if (!cond) throw new Error(`Unknown condition: ${conditionId}`);

  process.env.DEBUG = ctx.debug;
  process.env.DEBUG_COLORS = ctx.colors;

  const connectPkg = JSON.parse(fs.readFileSync(resolveFromProduct("connect/package.json"), "utf8"));
  const debugPkg = JSON.parse(fs.readFileSync(resolveFromProduct("debug/package.json"), "utf8"));
  const msPkg = JSON.parse(fs.readFileSync(resolveFromProduct("ms/package.json"), "utf8"));

  if (connectPkg.version !== "3.7.0") throw new Error(`Expected connect@3.7.0, got ${connectPkg.version}`);
  if (debugPkg.version !== "2.6.9") throw new Error(`Expected debug@2.6.9, got ${debugPkg.version}`);
  if (msPkg.version !== "2.0.0") throw new Error(`Expected ms@2.0.0, got ${msPkg.version}`);

  const msMain = resolveFromProduct("ms");
  const originalMs = require(msMain);

  let msCallsFromDebug = 0;
  let alteredMsCalls = 0;

  function wrappedMs(...args) {
    const stack = String(new Error().stack || "");
    const fromDebug =
      stack.includes("node_modules\\debug\\") ||
      stack.includes("/node_modules/debug/");

    if (fromDebug) msCallsFromDebug++;

    if (fromDebug && cond.id !== "BASELINE") {
      alteredMsCalls++;

      if (cond.id === "CORRUPT_HUMANIZE") {
        return "CORRUPTED-DURATION";
      }

      if (cond.id === "EMPTY_HUMANIZE") {
        return "";
      }

      if (cond.id === "DELAY_HUMANIZE") {
        sleepMs(50);
        return originalMs.apply(this, args);
      }
    }

    return originalMs.apply(this, args);
  }

  Object.assign(wrappedMs, originalMs);
  require.cache[msMain].exports = wrappedMs;

  // Capture debug output without exposing it to terminal.
  const stderrChunks = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stderr.write = function(chunk, encoding, cb) {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    if (typeof cb === "function") cb();
    return true;
  };

  let httpStatus = null;
  let elapsedMs = null;

  try {
    const connect = require(resolveFromProduct("connect"));
    const app = connect();

    app.use(function validationMiddleware(req, res) {
      res.statusCode = 200;
      res.end("ok");
    });

    const server = http.createServer(app);

    const t0 = process.hrtime.bigint();

    httpStatus = await new Promise((resolve, reject) => {
      server.on("error", reject);

      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;

        const req = http.get(
          { host: "127.0.0.1", port, path: "/validation" },
          (res) => {
            res.resume();
            res.on("end", () => {
              server.close(() => resolve(res.statusCode));
            });
          }
        );

        req.on("error", (err) => {
          server.close(() => reject(err));
        });
      });
    });

    elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  } finally {
    process.stderr.write = originalStderrWrite;
  }

  const output = stderrChunks.join("");
  const A = msCallsFromDebug > 0 ? 1 : 0;

  let impact = 0;
  let impactType = "NONE";

  if (cond.id === "CORRUPT_HUMANIZE" && output.includes("CORRUPTED-DURATION")) {
    impact = 1;
    impactType = "OBSERVABILITY_CORRUPTION";
  }

  if (cond.id === "EMPTY_HUMANIZE" && A === 1 && alteredMsCalls > 0) {
    impact = 1;
    impactType = "OBSERVABILITY_SUPPRESSION";
  }

  if (cond.id === "DELAY_HUMANIZE" && A === 1 && alteredMsCalls > 0) {
    impact = 1;
    impactType = "LATENCY";
  }

  const predictedImpact =
    ctx.expectedA === 1 ? cond.expectedImpactWhenActive : 0;

  return {
    product: `connect@${connectPkg.version}`,
    edge: `debug@${debugPkg.version} -> ms@${msPkg.version}`,
    path: `connect@${connectPkg.version} -> debug@${debugPkg.version} -> ms@${msPkg.version}`,

    context: ctx.id,
    condition: cond.id,

    T_path: 1,
    expectedA: ctx.expectedA,
    observedA: A,

    msCallsFromDebug,
    alteredMsCalls,

    predictedImpact,
    observedImpact: impact,
    impactType,

    predictionCorrect: predictedImpact === impact ? 1 : 0,

    elapsedMs,
    httpStatus,
    capturedDebugOutputLength: output.length,
    corruptedTokenSeen: output.includes("CORRUPTED-DURATION") ? 1 : 0,
  };
}

async function childMode() {
  try {
    const row = await childRun(process.argv[3], process.argv[4]);
    process.stdout.write(JSON.stringify(row));
  } catch (e) {
    process.stdout.write(JSON.stringify({
      fatalError: true,
      error: e && e.stack ? e.stack : String(e),
    }));
    process.exitCode = 1;
  }
}

function parentMode() {
  if (!fs.existsSync(PRODUCT)) {
    throw new Error(`Missing product directory: ${PRODUCT}`);
  }

  ensureDir(OUTDIR);

  const trials = [];

  for (const ctx of CONTEXTS) {
    for (const cond of CONDITIONS) {
      for (let rep = 1; rep <= REPS; rep++) {
        const cp = spawnSync(
          process.execPath,
          [__filename, "--child", ctx.id, cond.id],
          {
            cwd: ROOT,
            encoding: "utf8",
            env: { ...process.env },
            maxBuffer: 10 * 1024 * 1024,
          }
        );

        let row;

        try {
          row = JSON.parse((cp.stdout || "").trim());
        } catch (_) {
          row = {
            fatalError: true,
            context: ctx.id,
            condition: cond.id,
            error: `Could not parse child output`,
            stdout: cp.stdout,
            stderr: cp.stderr,
          };
        }

        row.rep = rep;
        row.childExitCode = cp.status;
        trials.push(row);
      }
    }
  }

  const good = trials.filter(r => !r.fatalError);
  const fatal = trials.filter(r => r.fatalError);

  const baselineByContext = {};

  for (const ctx of CONTEXTS) {
    const rows = good.filter(
      r => r.context === ctx.id && r.condition === "BASELINE"
    );
    baselineByContext[ctx.id] = mean(rows.map(r => Number(r.elapsedMs)));
  }

  const summary = [];

  for (const ctx of CONTEXTS) {
    for (const cond of CONDITIONS) {
      const rows = good.filter(
        r => r.context === ctx.id && r.condition === cond.id
      );

      const activeRows = rows.filter(r => Number(r.observedA) === 1);
      const impactedActiveRows = activeRows.filter(
        r => Number(r.observedImpact) === 1
      );

      const q =
        activeRows.length > 0
          ? impactedActiveRows.length / activeRows.length
          : null;

      const impactRate =
        rows.length > 0
          ? rows.filter(r => Number(r.observedImpact) === 1).length / rows.length
          : null;

      const base = baselineByContext[ctx.id];
      const latencyDeltas = rows
        .map(r => Number(r.elapsedMs) - Number(base))
        .filter(Number.isFinite);

      summary.push({
        context: ctx.id,
        condition: cond.id,
        trials: rows.length,
        expectedA: ctx.expectedA,
        observedAlpha: mean(rows.map(r => Number(r.observedA))),
        qConditionalOnActive: q,
        impactRate,
        predictedImpactRate: mean(rows.map(r => Number(r.predictedImpact))),
        predictionAccuracy: mean(rows.map(r => Number(r.predictionCorrect))),
        httpSuccessRate: mean(
          rows.map(r => Number(r.httpStatus) === 200 ? 1 : 0)
        ),
        meanElapsedMs: mean(rows.map(r => Number(r.elapsedMs))),
        meanLatencyDeltaMs: mean(latencyDeltas),
        medianLatencyDeltaMs: median(latencyDeltas),
        meanMsCallsFromDebug: mean(rows.map(r => Number(r.msCallsFromDebug))),
        meanAlteredMsCalls: mean(rows.map(r => Number(r.alteredMsCalls))),
      });
    }
  }

  const overallPredictionAccuracy = mean(
    good.map(r => Number(r.predictionCorrect))
  );

  const passed =
    fatal.length === 0 &&
    summary.every(r => r.trials === REPS) &&
    summary.every(r => r.predictionAccuracy === 1) &&
    summary.every(r => r.httpSuccessRate === 1);

  const output = {
    analysis: "P4 Connect external-context propagation validation",
    product: "connect@3.7.0",
    exactEdge: "debug@2.6.9 -> ms@2.0.0",
    path: "connect@3.7.0 -> debug@2.6.9 -> ms@2.0.0",
    status: passed ? "PASS" : "CHECK_RESULTS",
    repetitionsPerCell: REPS,
    totalTrials: trials.length,
    fatalTrials: fatal.length,
    overallPredictionAccuracy,
    summary,
    trials,
    caution:
      "Controlled deterministic mechanism validation only. This does not estimate natural failure, compromise, vulnerability, or incident frequency.",
  };

  fs.writeFileSync(
    path.join(OUTDIR, "p4-connect-propagation-validation.json"),
    JSON.stringify(output, null, 2),
    "utf8"
  );

  const report = [];

  report.push("P4 CONNECT EXTERNAL-CONTEXT PROPAGATION VALIDATION");
  report.push("==================================================");
  report.push("");
  report.push("Product: connect@3.7.0");
  report.push("Exact edge: debug@2.6.9 -> ms@2.0.0");
  report.push("Path: connect@3.7.0 -> debug@2.6.9 -> ms@2.0.0");
  report.push("");
  report.push("PRE-SPECIFIED EXPECTATION");
  report.push("-------------------------");
  report.push("Inactive colors-off context: A=0, so perturbations should not impact.");
  report.push("Active colors-on context: A=1.");
  report.push("For active deterministic perturbations, expected q=1.");
  report.push("");
  report.push("RESULTS");
  report.push("-------");

  for (const r of summary) {
    report.push(`${r.context} | ${r.condition}`);
    report.push(
      `  alpha=${fmt(r.observedAlpha)} q=${fmt(r.qConditionalOnActive)} impactRate=${fmt(r.impactRate)} predictedImpact=${fmt(r.predictedImpactRate)} accuracy=${fmt(r.predictionAccuracy)}`
    );
    report.push(
      `  HTTP200=${fmt(r.httpSuccessRate)} meanLatencyDeltaMs=${fmt(r.meanLatencyDeltaMs,3)} meanMsCalls=${fmt(r.meanMsCallsFromDebug)} alteredMsCalls=${fmt(r.meanAlteredMsCalls)}`
    );
  }

  report.push("");
  report.push("OVERALL");
  report.push("-------");
  report.push(`status=${output.status}`);
  report.push(`total trials=${output.totalTrials}`);
  report.push(`fatal trials=${output.fatalTrials}`);
  report.push(`overall prediction accuracy=${fmt(output.overallPredictionAccuracy)}`);
  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "A PASS means the earlier activation/conditional-propagation mechanism reproduced in the new Connect parent-product environment."
  );
  report.push(
    "Inactive runtime context prevents downstream perturbation impact despite structural path presence."
  );
  report.push(
    "Active runtime context permits the controlled perturbation to propagate to observability or latency effects."
  );
  report.push(
    "This remains controlled mechanism validation and does not estimate natural real-world incident frequency."
  );

  fs.writeFileSync(
    path.join(OUTDIR, "p4-connect-propagation-validation-report.txt"),
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
