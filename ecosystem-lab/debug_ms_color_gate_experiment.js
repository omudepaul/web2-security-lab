#!/usr/bin/env node
"use strict";

/*
  debug_ms_color_gate_experiment.js

  Cross-product configuration-gating experiment for the exact shared edge:

      debug@2.6.9 -> ms@2.0.0

  Products:
    P2: express-session@1.19.0
    P3: morgan@1.12.1

  Controlled configurations per product:
    C1: DEBUG disabled, DEBUG_COLORS=1
    C2: DEBUG enabled,  DEBUG_COLORS=0
    C3: DEBUG enabled,  DEBUG_COLORS=1

  Measures:
    T_e(p)       : exact edge exists topologically
    L_e(p,w,c)   : debug loads ms
    D(p,w,c)     : parent invokes debug logger function
    E(p,w,c)     : debug logger is enabled when called
    A_e(p,w,c)   : ms is actually invoked from debug

  This experiment:
    - does NOT modify node_modules
    - uses reversible in-memory Module._load instrumentation
    - uses real product middleware requests
    - does NOT estimate real-world failure/compromise probability
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
  "debug-ms-color-gate"
);

const REPETITIONS = 5;

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

const CONDITIONS = [
  {
    id: "DEBUG_OFF_COLORS_ON",
    debugEnabled: false,
    debugColors: "1",
  },
  {
    id: "DEBUG_ON_COLORS_OFF",
    debugEnabled: true,
    debugColors: "0",
  },
  {
    id: "DEBUG_ON_COLORS_ON",
    debugEnabled: true,
    debugColors: "1",
  },
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

function readPackageVersion(productDir, packageName) {
  const packageJson = path.join(
    productDir,
    "node_modules",
    ...packageName.split("/"),
    "package.json"
  );

  if (!fs.existsSync(packageJson)) {
    throw new Error(`Missing ${packageName} package.json: ${packageJson}`);
  }

  return JSON.parse(fs.readFileSync(packageJson, "utf8")).version;
}

function installInstrumentation(product) {
  const originalLoad = Module._load;

  const debugDir = path.join(product.dir, "node_modules", "debug");
  const parentDir = path.join(
    product.dir,
    "node_modules",
    product.parentPackage
  );

  const state = {
    parentDebugLoadRequests: 0,
    debugFactoryCalls: 0,
    debugLoggerCalls: 0,
    enabledDebugLoggerCalls: 0,
    disabledDebugLoggerCalls: 0,

    msLoadRequestsFromDebug: 0,
    msInvocationsFromDebug: 0,

    debugLoadParents: [],
    msLoadParents: [],
    namespaces: [],
    msArguments: [],
  };

  Module._load = function (request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);

    // Exact shared edge: debug -> ms
    if (
      request === "ms" &&
      parent &&
      isInside(parent.filename, debugDir)
    ) {
      state.msLoadRequestsFromDebug += 1;
      state.msLoadParents.push(rel(parent.filename, product.dir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.msInvocationsFromDebug += 1;
          state.msArguments.push(
            args.map((x) => {
              if (typeof x === "string" || typeof x === "number") return x;
              if (x === null) return null;
              return String(x);
            })
          );
          return Reflect.apply(target, thisArg, args);
        },
      });
    }

    // Parent product -> debug
    if (
      request === "debug" &&
      parent &&
      isInside(parent.filename, parentDir)
    ) {
      state.parentDebugLoadRequests += 1;
      state.debugLoadParents.push(rel(parent.filename, product.dir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.debugFactoryCalls += 1;
          if (args.length) state.namespaces.push(String(args[0]));

          const logger = Reflect.apply(target, thisArg, args);
          if (typeof logger !== "function") return logger;

          return new Proxy(logger, {
            apply(logTarget, logThisArg, logArgs) {
              state.debugLoggerCalls += 1;

              if (Boolean(logTarget.enabled)) {
                state.enabledDebugLoggerCalls += 1;
              } else {
                state.disabledDebugLoggerCalls += 1;
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
      middleware(req, res, (err) => {
        if (err) {
          res.statusCode = 500;
          res.end("middleware-error");
          return;
        }

        res.statusCode = 200;
        res.end("ok");
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/",
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
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

async function executeOne(productId, condition) {
  const product = PRODUCTS[productId];

  const debugVersion = readPackageVersion(product.dir, "debug");
  const msVersion = readPackageVersion(product.dir, "ms");

  if (debugVersion !== "2.6.9") {
    throw new Error(
      `Expected debug@2.6.9, found debug@${debugVersion}`
    );
  }

  if (msVersion !== "2.0.0") {
    throw new Error(
      `Expected ms@2.0.0, found ms@${msVersion}`
    );
  }

  const oldDebug = process.env.DEBUG;
  const oldColors = process.env.DEBUG_COLORS;

  if (condition.debugEnabled) {
    process.env.DEBUG = product.debugNamespace;
  } else {
    delete process.env.DEBUG;
  }

  process.env.DEBUG_COLORS = condition.debugColors;

  const packageJson = path.join(product.dir, "package.json");
  const localRequire = createRequire(packageJson);
  const instrumentation = installInstrumentation(product);

  let outcome = {};
  let error = null;

  try {
    if (productId === "P2") {
      const session = localRequire("express-session");

      const middleware = session({
        secret: "controlled-color-gate-secret",
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

  const s = instrumentation.state;

  return {
    productId,
    product: product.label,
    condition: condition.id,

    debugConfigured: condition.debugEnabled,
    debugColors: condition.debugColors,

    topologyPresent: true,
    exactEdge: "debug@2.6.9 -> ms@2.0.0",

    parentDebugLoaded: s.parentDebugLoadRequests > 0,
    debugToMsLoaded: s.msLoadRequestsFromDebug > 0,

    parentDebugCalled: s.debugLoggerCalls > 0,
    debugEnabledExecution:
      s.enabledDebugLoggerCalls > 0,

    msInvokedFromDebug:
      s.msInvocationsFromDebug > 0,

    parentDebugLoadRequests:
      s.parentDebugLoadRequests,
    debugFactoryCalls:
      s.debugFactoryCalls,
    debugLoggerCalls:
      s.debugLoggerCalls,
    enabledDebugLoggerCalls:
      s.enabledDebugLoggerCalls,
    disabledDebugLoggerCalls:
      s.disabledDebugLoggerCalls,
    msLoadRequestsFromDebug:
      s.msLoadRequestsFromDebug,
    msInvocationsFromDebug:
      s.msInvocationsFromDebug,

    debugLoadParents:
      [...new Set(s.debugLoadParents)],
    msLoadParents:
      [...new Set(s.msLoadParents)],
    namespaces:
      [...new Set(s.namespaces)],
    msArguments:
      s.msArguments,

    outcome,
    error,
  };
}

async function childMain() {
  const productId = process.argv[3];
  const conditionId = process.argv[4];

  const condition = CONDITIONS.find(
    (c) => c.id === conditionId
  );

  if (!condition) {
    process.stdout.write(
      JSON.stringify({
        fatalError: {
          name: "UnknownCondition",
          message: conditionId,
        },
      })
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await executeOne(
      productId,
      condition
    );
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        productId,
        condition: conditionId,
        fatalError: {
          name: err.name,
          message: err.message,
          stack: err.stack,
        },
      })
    );
    process.exitCode = 1;
  }
}

function aggregate(rows) {
  const groups = new Map();

  for (const r of rows) {
    const k = [
      r.productId,
      r.product,
      r.condition,
    ].join("::");

    if (!groups.has(k)) {
      groups.set(k, {
        productId: r.productId,
        product: r.product,
        condition: r.condition,
        trials: 0,
        edgeLoadedTrials: 0,
        parentCallTrials: 0,
        enabledExecutionTrials: 0,
        msActivatedTrials: 0,
      });
    }

    const g = groups.get(k);
    g.trials += 1;

    if (r.debugToMsLoaded) g.edgeLoadedTrials += 1;
    if (r.parentDebugCalled) g.parentCallTrials += 1;
    if (r.debugEnabledExecution) {
      g.enabledExecutionTrials += 1;
    }
    if (r.msInvokedFromDebug) {
      g.msActivatedTrials += 1;
    }
  }

  return [...groups.values()].map((g) => ({
    ...g,
    edgeLoadRate:
      g.edgeLoadedTrials / g.trials,
    parentCallRate:
      g.parentCallTrials / g.trials,
    enabledExecutionRate:
      g.enabledExecutionTrials / g.trials,
    edgeActivationRate:
      g.msActivatedTrials / g.trials,
  }));
}

function fmt(x) {
  return Number(x).toFixed(3);
}

function buildReport(rows, summary) {
  const lines = [];

  lines.push(
    "debug@2.6.9 -> ms@2.0.0 COLOR-GATED EDGE ACTIVATION REPORT"
  );
  lines.push(
    "============================================================"
  );
  lines.push("");
  lines.push(
    `Repetitions per product/configuration: ${REPETITIONS}`
  );
  lines.push("");
  lines.push("Controlled configurations:");
  lines.push(
    "  C1 DEBUG_OFF_COLORS_ON : DEBUG disabled, DEBUG_COLORS=1"
  );
  lines.push(
    "  C2 DEBUG_ON_COLORS_OFF : DEBUG enabled,  DEBUG_COLORS=0"
  );
  lines.push(
    "  C3 DEBUG_ON_COLORS_ON  : DEBUG enabled,  DEBUG_COLORS=1"
  );
  lines.push("");
  lines.push("Definitions:");
  lines.push(
    "  T_e=1: exact shared edge exists topologically."
  );
  lines.push(
    "  L_e=1: debug loads ms."
  );
  lines.push(
    "  D=1: parent product calls its debug logger."
  );
  lines.push(
    "  E=1: the debug logger is enabled when called."
  );
  lines.push(
    "  A_e=1: ms is actually invoked by debug."
  );
  lines.push("");
  lines.push(
    "Important: these are controlled activation measurements, not real-world failure/compromise probabilities."
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

    for (const g of gs) {
      lines.push(`Condition: ${g.condition}`);
      lines.push(
        `  T_e=1 | L_e=${fmt(g.edgeLoadRate)} | D=${fmt(
          g.parentCallRate
        )} | E=${fmt(
          g.enabledExecutionRate
        )} | A_e=${fmt(g.edgeActivationRate)}`
      );
      lines.push(
        `  trials=${g.trials}, edge-loaded=${g.edgeLoadedTrials}, ` +
        `parent-called=${g.parentCallTrials}, ` +
        `enabled-execution=${g.enabledExecutionTrials}, ` +
        `ms-activated=${g.msActivatedTrials}`
      );
      lines.push("");
    }
  }

  lines.push("EXPECTED CONFIGURATION-GATING TEST");
  lines.push("----------------------------------");
  lines.push(
    "If the source-code hypothesis is correct, ms activation should occur only when DEBUG is enabled AND DEBUG_COLORS is enabled."
  );
  lines.push("");

  const activeC3 = summary.filter(
    (g) =>
      g.condition === "DEBUG_ON_COLORS_ON" &&
      g.edgeActivationRate > 0
  ).length;

  const activeOther = summary.filter(
    (g) =>
      g.condition !== "DEBUG_ON_COLORS_ON" &&
      g.edgeActivationRate > 0
  ).length;

  lines.push(
    `Products with A_e>0 under DEBUG_ON_COLORS_ON: ${activeC3}/2`
  );
  lines.push(
    `Non-C3 product/config groups with A_e>0: ${activeOther}`
  );

  lines.push("");
  lines.push("MODEL INTERPRETATION");
  lines.push("--------------------");
  lines.push(
    "The shared edge can be topologically present and loaded even when its downstream function is not executed."
  );
  lines.push(
    "Parent debug calls are not sufficient by themselves to activate debug->ms."
  );
  lines.push(
    "The experiment explicitly tests whether enabled debug execution plus color formatting is the configuration gate for downstream ms invocation."
  );

  return lines.join("\n");
}

function parentMain() {
  ensureDir(OUTDIR);

  const rows = [];

  for (const productId of ["P2", "P3"]) {
    for (const condition of CONDITIONS) {
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
            condition.id,
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
          parsed = JSON.parse(
            child.stdout || "{}"
          );
        } catch (err) {
          parsed = {
            productId,
            product:
              PRODUCTS[productId].label,
            condition:
              condition.id,
            fatalError: {
              name: "ParseError",
              message: err.message,
            },
            childStdout: child.stdout,
          };
        }

        parsed.repetition = repetition;

        if (child.error) {
          parsed.fatalError = {
            name: child.error.name,
            message: child.error.message,
          };
        }

        if (
          child.stderr &&
          child.stderr.trim()
        ) {
          parsed.childStderr =
            child.stderr.trim();
        }

        rows.push(parsed);
      }
    }
  }

  const summary = aggregate(rows);
  const report = buildReport(
    rows,
    summary
  );

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "debug-ms-color-gate-results.json"
    ),
    JSON.stringify(
      {
        exactEdge:
          "debug@2.6.9 -> ms@2.0.0",
        repetitions: REPETITIONS,
        products: PRODUCTS,
        conditions: CONDITIONS,
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
      "debug-ms-color-gate-report.txt"
    ),
    report,
    "utf8"
  );

  console.log(report);
  console.log("");
  console.log("Files created:");
  console.log(
    "  results/debug-ms-color-gate/debug-ms-color-gate-report.txt"
  );
  console.log(
    "  results/debug-ms-color-gate/debug-ms-color-gate-results.json"
  );
}

if (process.argv[2] === "--child") {
  childMain();
} else {
  parentMain();
}
