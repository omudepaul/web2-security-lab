#!/usr/bin/env node
"use strict";

/*
  debug_ms_shared_edge_perturbation_experiment.js

  Controlled cross-product perturbation experiment for the exact shared edge:

      debug@2.6.9 -> ms@2.0.0

  Products:
    P2: express-session@1.19.0
    P3: morgan@1.12.1

  Configurations:
    INACTIVE: DEBUG enabled, DEBUG_COLORS=0
    ACTIVE:   DEBUG enabled, DEBUG_COLORS=1

  Perturbations applied only to ms when loaded by debug:
    BASELINE
    CORRUPT_HUMANIZE
    EMPTY_HUMANIZE
    DELAY_HUMANIZE

  This experiment:
    - does NOT modify node_modules
    - uses reversible in-memory Module._load instrumentation
    - uses real product middleware requests
    - estimates only controlled workload/configuration-conditioned propagation
    - does NOT estimate natural compromise/failure probability
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const Module = require("module");
const { createRequire } = require("module");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const OUTDIR = path.join(
  ROOT,
  "results",
  "debug-ms-shared-edge-perturbation"
);

const REPETITIONS = 5;
const DELAY_MS = 50;

const PRODUCTS = {
  P2: {
    label: "express-session",
    dir: path.join(ROOT, "product-session"),
    parentPackage: "express-session",
    debugNamespace: "express-session",
  },
  P3: {
    label: "Morgan",
    dir: path.join(ROOT, "product-morgan"),
    parentPackage: "morgan",
    debugNamespace: "morgan",
  },
};

const CONFIGS = [
  {
    id: "INACTIVE_COLORS_OFF",
    debugColors: "0",
  },
  {
    id: "ACTIVE_COLORS_ON",
    debugColors: "1",
  },
];

const PERTURBATIONS = [
  "BASELINE",
  "CORRUPT_HUMANIZE",
  "EMPTY_HUMANIZE",
  "DELAY_HUMANIZE",
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalize(p) {
  return path.resolve(p).toLowerCase();
}

function isInside(file, dir) {
  if (!file) return false;
  const f = normalize(file);
  const d = normalize(dir) + path.sep;
  return f === normalize(dir) || f.startsWith(d);
}

function rel(file, base) {
  if (!file) return "<unknown>";
  return path.relative(base, file).replaceAll("\\", "/");
}

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function readPackageVersion(productDir, packageName) {
  const file = path.join(
    productDir,
    "node_modules",
    ...packageName.split("/"),
    "package.json"
  );

  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${packageName} package.json: ${file}`);
  }

  return JSON.parse(fs.readFileSync(file, "utf8")).version;
}

function installInstrumentation(product, perturbation) {
  const originalLoad = Module._load;

  const debugDir = path.join(product.dir, "node_modules", "debug");
  const parentDir = path.join(
    product.dir,
    "node_modules",
    product.parentPackage
  );

  const state = {
    parentDebugLoads: 0,
    debugLoggerCalls: 0,
    enabledDebugLoggerCalls: 0,

    msLoadsFromDebug: 0,
    msCallsFromDebug: 0,

    alteredMsCalls: 0,
    injectedDelayMs: 0,

    debugLoadParents: [],
    msLoadParents: [],
    msArgs: [],
  };

  Module._load = function (request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);

    if (
      request === "ms" &&
      parent &&
      isInside(parent.filename, debugDir)
    ) {
      state.msLoadsFromDebug += 1;
      state.msLoadParents.push(rel(parent.filename, product.dir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.msCallsFromDebug += 1;
          state.msArgs.push(args);

          if (perturbation === "CORRUPT_HUMANIZE") {
            state.alteredMsCalls += 1;
            return "CONTROLLED_MS_CORRUPTION";
          }

          if (perturbation === "EMPTY_HUMANIZE") {
            state.alteredMsCalls += 1;
            return "";
          }

          if (perturbation === "DELAY_HUMANIZE") {
            busyWait(DELAY_MS);
            state.alteredMsCalls += 1;
            state.injectedDelayMs += DELAY_MS;
            return Reflect.apply(target, thisArg, args);
          }

          return Reflect.apply(target, thisArg, args);
        },
      });
    }

    if (
      request === "debug" &&
      parent &&
      isInside(parent.filename, parentDir)
    ) {
      state.parentDebugLoads += 1;
      state.debugLoadParents.push(rel(parent.filename, product.dir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          const logger = Reflect.apply(target, thisArg, args);

          if (typeof logger !== "function") return logger;

          return new Proxy(logger, {
            apply(logTarget, logThisArg, logArgs) {
              state.debugLoggerCalls += 1;
              if (Boolean(logTarget.enabled)) {
                state.enabledDebugLoggerCalls += 1;
              }
              return Reflect.apply(
                logTarget,
                logThisArg,
                logArgs
              );
            },
          });
        },
      });
    }

    return exported;
  };

  return {
    state,
    restore() {
      Module._load = originalLoad;
    },
  };
}

function runMiddlewareRequest(middleware) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        middleware(req, res, (err) => {
          if (err) {
            res.statusCode = 500;
            res.end("middleware-error");
            return;
          }
          res.statusCode = 200;
          res.end("ok");
        });
      } catch (err) {
        res.statusCode = 500;
        res.end("exception");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();

      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/",
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => { body += c; });
          res.on("end", () => {
            const result = {
              statusCode: res.statusCode,
              body,
            };
            server.close(() => resolve(result));
          });
        }
      );

      req.on("error", (err) => {
        server.close(() => reject(err));
      });

      req.setTimeout(5000, () => {
        req.destroy(new Error("HTTP request timeout"));
      });
    });

    server.on("error", reject);
  });
}

async function executeOne(productId, config, perturbation) {
  const product = PRODUCTS[productId];

  const debugVersion = readPackageVersion(product.dir, "debug");
  const msVersion = readPackageVersion(product.dir, "ms");

  if (debugVersion !== "2.6.9") {
    throw new Error(`Expected debug@2.6.9, found debug@${debugVersion}`);
  }
  if (msVersion !== "2.0.0") {
    throw new Error(`Expected ms@2.0.0, found ms@${msVersion}`);
  }

  const oldDebug = process.env.DEBUG;
  const oldColors = process.env.DEBUG_COLORS;

  process.env.DEBUG = product.debugNamespace;
  process.env.DEBUG_COLORS = config.debugColors;

  const localRequire = createRequire(
    path.join(product.dir, "package.json")
  );

  const instrumentation = installInstrumentation(
    product,
    perturbation
  );

  let outcome = {};
  let error = null;

  const t0 = process.hrtime.bigint();

  try {
    if (productId === "P2") {
      const session = localRequire("express-session");

      const middleware = session({
        secret: "controlled-shared-edge-secret",
        resave: false,
        saveUninitialized: false,
      });

      outcome = await runMiddlewareRequest(middleware);
    } else {
      const morgan = localRequire("morgan");

      const sink = { write() {} };

      const middleware = morgan("combined", {
        stream: sink,
      });

      outcome = await runMiddlewareRequest(middleware);
    }
  } catch (err) {
    error = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  } finally {
    instrumentation.restore();

    if (oldDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = oldDebug;

    if (oldColors === undefined) delete process.env.DEBUG_COLORS;
    else process.env.DEBUG_COLORS = oldColors;
  }

  const t1 = process.hrtime.bigint();
  const elapsedMs = Number(t1 - t0) / 1e6;
  const s = instrumentation.state;

  return {
    productId,
    product: product.label,
    config: config.id,
    perturbation,

    topologyPresent: true,
    exactEdge: "debug@2.6.9 -> ms@2.0.0",

    elapsedMs,

    edgeLoaded: s.msLoadsFromDebug > 0,
    parentDebugCalled: s.debugLoggerCalls > 0,
    enabledDebugExecution: s.enabledDebugLoggerCalls > 0,
    edgeActivated: s.msCallsFromDebug > 0,

    parentDebugLoads: s.parentDebugLoads,
    debugLoggerCalls: s.debugLoggerCalls,
    enabledDebugLoggerCalls: s.enabledDebugLoggerCalls,
    msLoadsFromDebug: s.msLoadsFromDebug,
    msCallsFromDebug: s.msCallsFromDebug,
    alteredMsCalls: s.alteredMsCalls,
    injectedDelayMs: s.injectedDelayMs,

    debugLoadParents: [...new Set(s.debugLoadParents)],
    msLoadParents: [...new Set(s.msLoadParents)],

    outcome,
    error,
  };
}

async function childMain() {
  const productId = process.argv[3];
  const configId = process.argv[4];
  const perturbation = process.argv[5];

  const config = CONFIGS.find((c) => c.id === configId);

  if (!config) {
    process.stdout.write(JSON.stringify({
      fatalError: {
        name: "UnknownConfig",
        message: configId,
      },
    }));
    process.exitCode = 1;
    return;
  }

  try {
    const result = await executeOne(
      productId,
      config,
      perturbation
    );
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      productId,
      config: configId,
      perturbation,
      fatalError: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    }));
    process.exitCode = 1;
  }
}

function median(values) {
  const a = [...values].sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function mean(values) {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmt(x) {
  return Number.isFinite(x) ? x.toFixed(3) : "NA";
}

function groupKey(r) {
  return [
    r.productId,
    r.config,
    r.perturbation,
  ].join("::");
}

function classify(rows) {
  const baselineMedian = new Map();

  for (const productId of ["P2", "P3"]) {
    for (const config of CONFIGS) {
      const vals = rows
        .filter(
          (r) =>
            r.productId === productId &&
            r.config === config.id &&
            r.perturbation === "BASELINE" &&
            !r.fatalError
        )
        .map((r) => r.elapsedMs);

      baselineMedian.set(
        `${productId}::${config.id}`,
        median(vals)
      );
    }
  }

  for (const r of rows) {
    const base = baselineMedian.get(
      `${r.productId}::${r.config}`
    );

    r.baselineMedianMs = base;
    r.elapsedDeltaMs =
      Number.isFinite(base) ? r.elapsedMs - base : NaN;

    r.impactObserved = false;
    r.impactType = "NONE";

    if (
      r.perturbation === "BASELINE" ||
      !r.edgeActivated
    ) {
      continue;
    }

    if (r.perturbation === "CORRUPT_HUMANIZE") {
      r.impactObserved = r.alteredMsCalls > 0;
      r.impactType = r.impactObserved
        ? "OBSERVABILITY_CORRUPTION"
        : "NONE";
    }

    else if (r.perturbation === "EMPTY_HUMANIZE") {
      r.impactObserved = r.alteredMsCalls > 0;
      r.impactType = r.impactObserved
        ? "OBSERVABILITY_SUPPRESSION"
        : "NONE";
    }

    else if (r.perturbation === "DELAY_HUMANIZE") {
      const threshold = r.injectedDelayMs * 0.5;

      r.impactObserved =
        r.injectedDelayMs > 0 &&
        Number.isFinite(r.elapsedDeltaMs) &&
        r.elapsedDeltaMs >= threshold;

      r.impactType = r.impactObserved
        ? "LATENCY"
        : "NONE";
    }
  }
}

function aggregate(rows) {
  const groups = new Map();

  for (const r of rows) {
    const k = groupKey(r);

    if (!groups.has(k)) {
      groups.set(k, {
        productId: r.productId,
        product: r.product,
        config: r.config,
        perturbation: r.perturbation,
        trials: 0,
        edgeLoadedTrials: 0,
        parentCallTrials: 0,
        enabledExecutionTrials: 0,
        activeTrials: 0,
        impactedTrials: 0,
        elapsedMs: [],
        elapsedDeltaMs: [],
        injectedDelayMs: [],
        statusCodes: [],
        impactTypes: new Set(),
      });
    }

    const g = groups.get(k);
    g.trials += 1;

    if (r.edgeLoaded) g.edgeLoadedTrials += 1;
    if (r.parentDebugCalled) g.parentCallTrials += 1;
    if (r.enabledDebugExecution) g.enabledExecutionTrials += 1;
    if (r.edgeActivated) g.activeTrials += 1;
    if (r.impactObserved) {
      g.impactedTrials += 1;
      g.impactTypes.add(r.impactType);
    }

    if (Number.isFinite(r.elapsedMs)) {
      g.elapsedMs.push(r.elapsedMs);
    }
    if (Number.isFinite(r.elapsedDeltaMs)) {
      g.elapsedDeltaMs.push(r.elapsedDeltaMs);
    }
    if (Number.isFinite(r.injectedDelayMs)) {
      g.injectedDelayMs.push(r.injectedDelayMs);
    }
    if (
      r.outcome &&
      r.outcome.statusCode !== undefined
    ) {
      g.statusCodes.push(r.outcome.statusCode);
    }
  }

  return [...groups.values()].map((g) => ({
    ...g,
    edgeLoadRate: g.edgeLoadedTrials / g.trials,
    parentCallRate: g.parentCallTrials / g.trials,
    enabledExecutionRate:
      g.enabledExecutionTrials / g.trials,
    activationRate: g.activeTrials / g.trials,
    qHatConditionalOnActive:
      g.activeTrials
        ? g.impactedTrials / g.activeTrials
        : null,
    piHat:
      g.trials
        ? g.impactedTrials / g.trials
        : 0,
    medianElapsedMs: median(g.elapsedMs),
    meanElapsedDeltaMs: mean(g.elapsedDeltaMs),
    meanInjectedDelayMs: mean(g.injectedDelayMs),
    uniqueStatusCodes: [...new Set(g.statusCodes)],
    impactType:
      [...g.impactTypes].join("|") || "NONE",
  }));
}

function buildReport(rows, summary) {
  const lines = [];

  lines.push(
    "debug@2.6.9 -> ms@2.0.0 SHARED-EDGE PERTURBATION REPORT"
  );
  lines.push(
    "========================================================"
  );
  lines.push("");
  lines.push(
    `Repetitions per product/configuration/condition: ${REPETITIONS}`
  );
  lines.push(
    `Delay injection: ${DELAY_MS} ms per ms invocation`
  );
  lines.push("");
  lines.push("Configurations:");
  lines.push(
    "  INACTIVE_COLORS_OFF: DEBUG enabled, DEBUG_COLORS=0"
  );
  lines.push(
    "  ACTIVE_COLORS_ON:   DEBUG enabled, DEBUG_COLORS=1"
  );
  lines.push("");
  lines.push("Perturbations:");
  lines.push("  BASELINE");
  lines.push("  CORRUPT_HUMANIZE");
  lines.push("  EMPTY_HUMANIZE");
  lines.push("  DELAY_HUMANIZE");
  lines.push("");
  lines.push("Definitions:");
  lines.push(
    "  A_e = edge activation rate (ms invoked from debug)."
  );
  lines.push(
    "  q_hat = impacted active trials / active trials."
  );
  lines.push(
    "  pi_hat = impacted trials / all trials."
  );
  lines.push("");
  lines.push(
    "Important: q_hat and pi_hat are controlled propagation quantities, not natural compromise/failure probabilities."
  );
  lines.push("");

  for (const productId of ["P2", "P3"]) {
    const gs = summary.filter(
      (g) => g.productId === productId
    );

    if (!gs.length) continue;

    lines.push(`${productId} ${gs[0].product}`);
    lines.push("-".repeat(
      `${productId} ${gs[0].product}`.length
    ));

    for (const config of CONFIGS) {
      lines.push(`Configuration: ${config.id}`);

      const configRows = gs.filter(
        (g) => g.config === config.id
      );

      for (const g of configRows) {
        lines.push(
          `  ${g.perturbation}: ` +
          `L=${fmt(g.edgeLoadRate)} ` +
          `E=${fmt(g.enabledExecutionRate)} ` +
          `A_e=${fmt(g.activationRate)} ` +
          `impacted=${g.impactedTrials}/${g.trials} ` +
          `q|active=${
            g.qHatConditionalOnActive === null
              ? "NA"
              : fmt(g.qHatConditionalOnActive)
          } ` +
          `pi=${fmt(g.piHat)} ` +
          `impact=${g.impactType} ` +
          `mean-delta=${fmt(g.meanElapsedDeltaMs)} ms`
        );
      }

      lines.push("");
    }
  }

  lines.push("CROSS-PRODUCT SUMMARY");
  lines.push("---------------------");

  for (const perturbation of PERTURBATIONS.filter(
    (p) => p !== "BASELINE"
  )) {
    const activeGroups = summary.filter(
      (g) =>
        g.config === "ACTIVE_COLORS_ON" &&
        g.perturbation === perturbation
    );

    const activeTrials = activeGroups.reduce(
      (s, g) => s + g.activeTrials,
      0
    );
    const impactedTrials = activeGroups.reduce(
      (s, g) => s + g.impactedTrials,
      0
    );

    const q = activeTrials
      ? impactedTrials / activeTrials
      : null;

    lines.push(
      `${perturbation}: active-trials=${activeTrials}, ` +
      `impacted=${impactedTrials}, overall q|active=${
        q === null ? "NA" : fmt(q)
      }`
    );
  }

  lines.push("");
  lines.push("INACTIVE-CONTROL CHECK");
  lines.push("----------------------");

  const inactivePerturbed = summary.filter(
    (g) =>
      g.config === "INACTIVE_COLORS_OFF" &&
      g.perturbation !== "BASELINE"
  );

  const inactiveImpacts = inactivePerturbed.reduce(
    (s, g) => s + g.impactedTrials,
    0
  );

  lines.push(
    `Impacted trials while color-gated edge inactive: ${inactiveImpacts}`
  );

  lines.push("");
  lines.push("APPLICATION STATUS CHECK");
  lines.push("------------------------");

  const statusGroups = summary.filter(
    (g) => g.uniqueStatusCodes.length
  );

  for (const g of statusGroups) {
    lines.push(
      `${g.productId} ${g.config} ${g.perturbation}: ` +
      `HTTP status=${g.uniqueStatusCodes.join(",")}`
    );
  }

  lines.push("");
  lines.push("MODEL INTERPRETATION");
  lines.push("--------------------");
  lines.push(
    "The exact shared edge is configuration-gated: topology and loading are not sufficient for downstream execution."
  );
  lines.push(
    "When the color-formatting path is inactive, ms-specific perturbations should not propagate."
  );
  lines.push(
    "When the edge is active, controlled corruption/suppression test observability propagation and delay tests latency propagation."
  );
  lines.push(
    "Deterministic q values validate this controlled edge-propagation mechanism; they do not measure natural vulnerability or compromise likelihood."
  );

  return lines.join("\n");
}

function parentMain() {
  ensureDir(OUTDIR);

  const rows = [];

  for (const productId of ["P2", "P3"]) {
    for (const config of CONFIGS) {
      for (const perturbation of PERTURBATIONS) {
        for (
          let repetition = 1;
          repetition <= REPETITIONS;
          repetition++
        ) {
          const child = spawnSync(
            process.execPath,
            [
              __filename,
              "--child",
              productId,
              config.id,
              perturbation,
            ],
            {
              cwd: ROOT,
              encoding: "utf8",
              timeout: 15000,
              windowsHide: true,
            }
          );

          let parsed;

          try {
            parsed = JSON.parse(child.stdout || "{}");
          } catch (err) {
            parsed = {
              productId,
              product: PRODUCTS[productId].label,
              config: config.id,
              perturbation,
              fatalError: {
                name: "ParseError",
                message: err.message,
              },
            };
          }

          parsed.repetition = repetition;
          parsed.childStderr = child.stderr || "";

          if (child.error) {
            parsed.fatalError = {
              name: child.error.name,
              message: child.error.message,
            };
          }

          rows.push(parsed);
        }
      }
    }
  }

  classify(rows);
  const summary = aggregate(rows);
  const report = buildReport(rows, summary);

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "debug-ms-shared-edge-perturbation-results.json"
    ),
    JSON.stringify(
      {
        exactEdge: "debug@2.6.9 -> ms@2.0.0",
        repetitions: REPETITIONS,
        delayMs: DELAY_MS,
        products: PRODUCTS,
        configs: CONFIGS,
        perturbations: PERTURBATIONS,
        rows,
        summary,
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "debug-ms-shared-edge-perturbation-report.txt"
    ),
    report,
    "utf8"
  );

  console.log(report);
  console.log("");
  console.log("Files created:");
  console.log(
    "  results/debug-ms-shared-edge-perturbation/debug-ms-shared-edge-perturbation-report.txt"
  );
  console.log(
    "  results/debug-ms-shared-edge-perturbation/debug-ms-shared-edge-perturbation-results.json"
  );
}

if (process.argv[2] === "--child") {
  childMain();
} else {
  parentMain();
}
