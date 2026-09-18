#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const Module = require("module");

const ROOT = __dirname;
const PRODUCT_DIR = path.join(ROOT, "product-express");
const OUTDIR = path.join(ROOT, "results", "p1-express-e3-propagation-validation");

const REPS = 10;
const DELAY_PER_MS_CALL = 50;

const CONTEXTS = [
  {
    id: "INACTIVE_COLORS_OFF",
    debug: "router",
    colors: "0",
    predictedAlpha: 0,
  },
  {
    id: "ACTIVE_COLORS_ON",
    debug: "router",
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
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function fmt(v, d = 4) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "NA";
  }
  return Number(v).toFixed(d);
}

function parseLastJson(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch (_) {}
  }

  throw new Error("No parseable worker JSON");
}

function busyWait(ms) {
  const start = process.hrtime.bigint();
  const target = BigInt(ms) * 1000000n;
  while (process.hrtime.bigint() - start < target) {}
}

async function worker() {
  const condition = process.env.P1_E3_PROP_CONDITION || "BASELINE";

  let routerDebugRequireCount = 0;
  let targetMsRequireCount = 0;

  let routerLoggerCalls = 0;
  let enabledRouterLoggerCalls = 0;

  let msCalls = 0;
  let alteredMsCalls = 0;
  let totalInjectedDelayMs = 0;
  const returnedValues = [];

  const originalLoad = Module._load;

  const routerMarker =
    `${path.sep}node_modules${path.sep}router${path.sep}`;

  const targetDebugMarker =
    `${path.sep}node_modules${path.sep}debug${path.sep}`;

  Module._load = function patchedLoad(request, parent, isMain) {
    const parentFile =
      parent && parent.filename ? path.normalize(parent.filename) : "";

    const lower = parentFile.toLowerCase();

    if (
      request === "debug" &&
      lower.includes(routerMarker)
    ) {
      routerDebugRequireCount += 1;

      const actualDebug = originalLoad.apply(this, arguments);

      function wrappedDebugFactory(namespace) {
        const logger = actualDebug(namespace);

        if (String(namespace) !== "router") {
          return logger;
        }

        function wrappedLogger(...args) {
          routerLoggerCalls += 1;

          if (logger.enabled) {
            enabledRouterLoggerCalls += 1;
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
        msCalls += 1;

        const baselineValue = actualMs(...args);
        let returnedValue = baselineValue;

        if (condition === "CORRUPT_HUMANIZE") {
          alteredMsCalls += 1;
          returnedValue = "CORRUPTED_MS";
        } else if (condition === "EMPTY_HUMANIZE") {
          alteredMsCalls += 1;
          returnedValue = "";
        } else if (condition === "DELAY_HUMANIZE") {
          alteredMsCalls += 1;
          busyWait(DELAY_PER_MS_CALL);
          totalInjectedDelayMs += DELAY_PER_MS_CALL;
          returnedValue = baselineValue;
        }

        returnedValues.push(String(returnedValue));
        return returnedValue;
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

  const express = require(
    path.join(PRODUCT_DIR, "node_modules", "express")
  );

  const app = express();

  app.get("/p1-e3-prop", (req, res) => {
    res.status(200).send("ok");
  });

  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;

  // Reset runtime counters after app setup so this measures only the request.
  routerLoggerCalls = 0;
  enabledRouterLoggerCalls = 0;
  msCalls = 0;
  alteredMsCalls = 0;
  totalInjectedDelayMs = 0;
  returnedValues.length = 0;

  let statusCode = null;
  let body = "";

  const t0 = process.hrtime.bigint();

  try {
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/p1-e3-prop",
          method: "GET",
        },
        res => {
          statusCode = res.statusCode;
          res.setEncoding("utf8");

          res.on("data", chunk => {
            body += chunk;
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

  const elapsedMs =
    Number(process.hrtime.bigint() - t0) / 1e6;

  const observedAlpha = msCalls > 0 ? 1 : 0;

  let impact = 0;

  if (condition === "CORRUPT_HUMANIZE") {
    impact =
      alteredMsCalls > 0 &&
      returnedValues.includes("CORRUPTED_MS")
        ? 1
        : 0;
  } else if (condition === "EMPTY_HUMANIZE") {
    impact =
      alteredMsCalls > 0 &&
      returnedValues.includes("")
        ? 1
        : 0;
  } else if (condition === "DELAY_HUMANIZE") {
    impact =
      alteredMsCalls > 0 &&
      totalInjectedDelayMs > 0
        ? 1
        : 0;
  }

  process.stdout.write(JSON.stringify({
    topologyT: 1,

    debugEnv: process.env.DEBUG || "",
    debugColorsEnv: process.env.DEBUG_COLORS ?? null,

    routerDebugRequireCount,
    targetMsRequireCount,

    routerLoggerCalls,
    enabledRouterLoggerCalls,

    msCalls,
    alteredMsCalls,
    totalInjectedDelayMs,
    returnedValues,

    observedAlpha,
    impact,

    elapsedMs,

    statusCode,
    body,
  }) + "\n");
}

function parent() {
  ensureDir(OUTDIR);

  const trials = [];
  let fatal = 0;

  for (const context of CONTEXTS) {
    for (const condition of CONDITIONS) {
      for (let rep = 1; rep <= REPS; rep++) {
        const child = spawnSync(
          process.execPath,
          [__filename, "--worker"],
          {
            cwd: ROOT,
            env: {
              ...process.env,
              DEBUG: context.debug,
              DEBUG_COLORS: context.colors,
              P1_E3_PROP_CONDITION: condition,
            },
            encoding: "utf8",
            timeout: 30000,
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
          const r = parseLastJson(child.stdout);

          const predictedImpact =
            context.predictedAlpha === 1 &&
            condition !== "BASELINE"
              ? 1
              : 0;

          trials.push({
            context: context.id,
            condition,
            rep,
            predictedAlpha: context.predictedAlpha,
            predictedImpact,
            fatal: 0,
            ...r,
            alphaCorrect:
              Number(r.observedAlpha) ===
              Number(context.predictedAlpha)
                ? 1
                : 0,
            impactCorrect:
              Number(r.impact) ===
              Number(predictedImpact)
                ? 1
                : 0,
          });
        } catch (e) {
          fatal += 1;

          trials.push({
            context: context.id,
            condition,
            rep,
            predictedAlpha: context.predictedAlpha,
            fatal: 1,
            error: String(e),
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

      const activeRows =
        rows.filter(r => Number(r.observedAlpha) === 1);

      let qConditionalOnActive = null;

      if (activeRows.length > 0) {
        qConditionalOnActive =
          condition === "BASELINE"
            ? 0
            : mean(activeRows.map(r => Number(r.impact)));
      }

      summary.push({
        context: context.id,
        condition,
        n: rows.length,

        predictedAlpha: context.predictedAlpha,
        observedAlpha:
          mean(rows.map(r => Number(r.observedAlpha))),

        topologyT:
          mean(rows.map(r => Number(r.topologyT))),

        debugCalled:
          mean(rows.map(
            r => r.routerLoggerCalls > 0 ? 1 : 0
          )),

        enabledExecution:
          mean(rows.map(
            r => r.enabledRouterLoggerCalls > 0 ? 1 : 0
          )),

        qConditionalOnActive,

        impactRate:
          mean(rows.map(r => Number(r.impact))),

        meanRouterLoggerCalls:
          mean(rows.map(
            r => Number(r.routerLoggerCalls)
          )),

        meanEnabledRouterLoggerCalls:
          mean(rows.map(
            r => Number(r.enabledRouterLoggerCalls)
          )),

        meanMsCalls:
          mean(rows.map(r => Number(r.msCalls))),

        meanAlteredMsCalls:
          mean(rows.map(
            r => Number(r.alteredMsCalls)
          )),

        meanInjectedDelayMs:
          mean(rows.map(
            r => Number(r.totalInjectedDelayMs)
          )),

        meanElapsedMs:
          mean(rows.map(
            r => Number(r.elapsedMs)
          )),

        http200Rate:
          mean(rows.map(
            r => Number(r.statusCode) === 200 ? 1 : 0
          )),

        bodyOkRate:
          mean(rows.map(
            r => r.body === "ok" ? 1 : 0
          )),

        alphaPredictionAccuracy:
          mean(rows.map(
            r => Number(r.alphaCorrect)
          )),

        impactPredictionAccuracy:
          mean(rows.map(
            r => Number(r.impactCorrect)
          )),
      });
    }
  }

  const contextBaselineLatency = {};

  for (const context of CONTEXTS) {
    const row = summary.find(
      s =>
        s.context === context.id &&
        s.condition === "BASELINE"
    );

    contextBaselineLatency[context.id] =
      row ? row.meanElapsedMs : null;
  }

  for (const row of summary) {
    const baseline =
      contextBaselineLatency[row.context];

    row.meanLatencyDeltaVsContextBaselineMs =
      Number.isFinite(baseline)
        ? row.meanElapsedMs - baseline
        : null;
  }

  const valid =
    trials.filter(r => !r.fatal);

  const overallAlphaPredictionAccuracy =
    mean(valid.map(
      r => Number(r.alphaCorrect)
    ));

  const overallImpactPredictionAccuracy =
    mean(valid.map(
      r => Number(r.impactCorrect)
    ));

  const activeNonBaseline =
    summary.filter(
      s =>
        s.context === "ACTIVE_COLORS_ON" &&
        s.condition !== "BASELINE"
    );

  const propagationPass =
    activeNonBaseline.length === 3 &&
    activeNonBaseline.every(
      s => Number(s.qConditionalOnActive) === 1
    );

  const validationPass =
    fatal === 0 &&
    overallAlphaPredictionAccuracy === 1 &&
    overallImpactPredictionAccuracy === 1 &&
    propagationPass;

  const result = {
    experiment:
      "P1 Express E3 cross-product propagation validation",

    product: "express@5.2.1",
    parentPackage: "router@2.2.0",
    namespace: "router",
    targetEdge: "debug@4.4.3 -> ms@2.1.3",

    repetitionsPerCell: REPS,
    delayPerMsCall: DELAY_PER_MS_CALL,

    totalPlannedTrials:
      CONTEXTS.length *
      CONDITIONS.length *
      REPS,

    fatal,

    overallAlphaPredictionAccuracy,
    overallImpactPredictionAccuracy,
    validationPass,

    summary,
    trials,

    interpretation: {
      alpha:
        "Runtime activation of the exact E3 edge in the P1 Router request context.",

      q:
        "Controlled conditional propagation among active trials under deterministic perturbation.",

      boundary:
        "q=1 is controlled mechanism validation, not natural failure, compromise, vulnerability, incident, or risk probability.",
    },
  };

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "p1-express-e3-propagation-validation.json"
    ),
    JSON.stringify(result, null, 2),
    "utf8"
  );

  const report = [];

  report.push(
    "P1 EXPRESS E3 CROSS-PRODUCT PROPAGATION VALIDATION"
  );

  report.push(
    "================================================="
  );

  report.push("");
  report.push("Product: express@5.2.1");
  report.push("Parent package: router@2.2.0");
  report.push("Namespace: router");
  report.push(
    "Target exact edge: debug@4.4.3 -> ms@2.1.3"
  );

  report.push(
    `Repetitions/cell=${REPS}`
  );

  report.push(
    `Delay per target ms call=${DELAY_PER_MS_CALL} ms`
  );

  report.push("");
  report.push(
    "PRE-SPECIFIED CONTEXT PREDICTIONS"
  );

  report.push(
    "---------------------------------"
  );

  for (const c of CONTEXTS) {
    report.push(
      `${c.id}: DEBUG=${c.debug} DEBUG_COLORS=${c.colors} predicted alpha=${c.predictedAlpha}`
    );
  }

  report.push("");
  report.push("RESULTS");
  report.push("-------");

  for (const s of summary) {
    report.push(
      `${s.context} / ${s.condition}`
    );

    report.push(
      `  n=${s.n} T=${fmt(s.topologyT)} D=${fmt(s.debugCalled)} E=${fmt(s.enabledExecution)}`
    );

    report.push(
      `  predicted alpha=${s.predictedAlpha} observed alpha=${fmt(s.observedAlpha)} q|active=${fmt(s.qConditionalOnActive)} impact=${fmt(s.impactRate)}`
    );

    report.push(
      `  mean router debug calls=${fmt(s.meanRouterLoggerCalls)} enabled calls=${fmt(s.meanEnabledRouterLoggerCalls)} ms calls=${fmt(s.meanMsCalls)}`
    );

    report.push(
      `  mean altered ms calls=${fmt(s.meanAlteredMsCalls)} injected delay=${fmt(s.meanInjectedDelayMs)} ms`
    );

    report.push(
      `  mean latency delta vs context baseline=${fmt(s.meanLatencyDeltaVsContextBaselineMs)} ms`
    );

    report.push(
      `  HTTP200=${fmt(s.http200Rate)} body-ok=${fmt(s.bodyOkRate)}`
    );
  }

  report.push("");
  report.push("OVERALL");
  report.push("-------");

  report.push(
    `Total planned trials=${CONTEXTS.length * CONDITIONS.length * REPS}`
  );

  report.push(
    `Fatal=${fatal}`
  );

  report.push(
    `Overall alpha prediction accuracy=${fmt(overallAlphaPredictionAccuracy)}`
  );

  report.push(
    `Overall impact prediction accuracy=${fmt(overallImpactPredictionAccuracy)}`
  );

  report.push(
    `Validation=${validationPass ? "PASS" : "CHECK"}`
  );

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");

  report.push(
    "Inactive-context trials test whether the structurally present but runtime-inactive E3 edge blocks controlled perturbation."
  );

  report.push(
    "Active-context trials test deterministic propagation through the same exact debug@4.4.3 -> ms@2.1.3 edge already tested in P6 Socket.IO."
  );

  report.push(
    "A PASS would provide cross-product propagation validation under a different parent and workload context."
  );

  report.push(
    "q=1 under deterministic perturbation is mechanism validation only, not a natural failure or compromise probability."
  );

  report.push(
    "HTTP success can coexist with observability/timing-layer impact."
  );

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "p1-express-e3-propagation-validation-report.txt"
    ),
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log(
    "  results\\p1-express-e3-propagation-validation\\p1-express-e3-propagation-validation-report.txt"
  );
  console.log(
    "  results\\p1-express-e3-propagation-validation\\p1-express-e3-propagation-validation.json"
  );
}

if (process.argv.includes("--worker")) {
  worker().catch(err => {
    console.error(
      err && err.stack ? err.stack : err
    );
    process.exit(1);
  });
} else {
  parent();
}
