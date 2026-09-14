#!/usr/bin/env node
"use strict";

/*
  debug_ms_shared_edge_activation_experiment.js

  Cross-product runtime activation experiment for the exact shared edge:

      debug@2.6.9  ->  ms@2.0.0

  Products:
    P2: express-session@1.19.0
    P3: morgan@1.12.1

  Measures:
    T_e(p)  : exact edge exists topologically (known from ecosystem graph)
    L_e(p,w): debug loads ms during workload w
    D(p,w)  : parent product invokes its debug logger
    A_e(p,w): ms is actually invoked from debug under workload w

  This experiment:
    - does NOT modify node_modules
    - uses reversible in-memory Module._load instrumentation
    - uses real product middleware execution
    - does NOT estimate real-world compromise/failure probability
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
  "debug-ms-shared-edge-activation"
);

const PRODUCTS = {
  P2: {
    label: "express-session",
    dir: path.join(ROOT, "product-session"),
    parentPackage: "express-session",
  },
  P3: {
    label: "Morgan",
    dir: path.join(ROOT, "product-morgan"),
    parentPackage: "morgan",
  },
};

const WORKLOADS = [
  { product: "P2", id: "SESSION_DEBUG_DISABLED_REQUEST", debugEnabled: false },
  { product: "P2", id: "SESSION_DEBUG_ENABLED_REQUEST", debugEnabled: true },

  { product: "P3", id: "MORGAN_DEBUG_DISABLED_REQUEST", debugEnabled: false },
  { product: "P3", id: "MORGAN_DEBUG_ENABLED_REQUEST", debugEnabled: true },
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
    debugLoadRequestsFromParent: 0,
    debugFactoryCalls: 0,
    debugLoggerInvocations: 0,

    msLoadRequestsFromDebug: 0,
    msInvocationsFromDebug: 0,

    debugLoadParents: [],
    msLoadParents: [],
    debugNamespaces: [],
    debugMessages: [],
    msArguments: [],
  };

  Module._load = function (request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);

    // Instrument exact edge target load: debug -> ms
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
              if (typeof x === "string") return x;
              if (typeof x === "number") return x;
              if (x === null) return null;
              return String(x);
            })
          );
          return Reflect.apply(target, thisArg, args);
        },
      });
    }

    // Instrument parent product -> debug
    if (
      request === "debug" &&
      parent &&
      isInside(parent.filename, parentDir)
    ) {
      state.debugLoadRequestsFromParent += 1;
      state.debugLoadParents.push(rel(parent.filename, product.dir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.debugFactoryCalls += 1;
          if (args.length) state.debugNamespaces.push(String(args[0]));

          const logger = Reflect.apply(target, thisArg, args);
          if (typeof logger !== "function") return logger;

          return new Proxy(logger, {
            apply(logTarget, logThisArg, logArgs) {
              state.debugLoggerInvocations += 1;
              state.debugMessages.push(
                logArgs.map((x) => {
                  if (typeof x === "string") return x;
                  try {
                    return JSON.stringify(x);
                  } catch {
                    return String(x);
                  }
                })
              );
              return Reflect.apply(logTarget, logThisArg, logArgs);
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
          res.setHeader("Content-Type", "text/plain");
          res.end("ok");
        });
      } catch (err) {
        res.statusCode = 500;
        res.end("exception");
      }
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

async function executeWorkload(productId, workloadId, debugEnabled) {
  const product = PRODUCTS[productId];
  if (!product) throw new Error(`Unknown product: ${productId}`);

  const debugVersion = readPackageVersion(product.dir, "debug");
  const msVersion = readPackageVersion(product.dir, "ms");

  if (debugVersion !== "2.6.9") {
    throw new Error(
      `Expected debug@2.6.9 in ${product.label}, found debug@${debugVersion}`
    );
  }

  if (msVersion !== "2.0.0") {
    throw new Error(
      `Expected ms@2.0.0 in ${product.label}, found ms@${msVersion}`
    );
  }

  const previousDebug = process.env.DEBUG;

  if (debugEnabled) {
    process.env.DEBUG =
      productId === "P2" ? "express-session" : "morgan";
  } else {
    delete process.env.DEBUG;
  }

  const packageJson = path.join(product.dir, "package.json");
  const localRequire = createRequire(packageJson);

  const instrumentation = installInstrumentation(product);

  let outcome = {};
  let error = null;

  try {
    if (productId === "P2") {
      const session = localRequire("express-session");

      const middleware = session({
        secret: "controlled-shared-edge-secret",
        resave: false,
        saveUninitialized: false,
      });

      outcome = await runMiddlewareRequest(middleware);
    }

    else if (productId === "P3") {
      const morgan = localRequire("morgan");

      // Use a sink so log output does not contaminate JSON on stdout.
      const sink = {
        write() {},
      };

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

    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  }

  const s = instrumentation.state;

  return {
    productId,
    product: product.label,
    workload: workloadId,
    debugEnabled,

    exactEdge: "debug@2.6.9 -> ms@2.0.0",
    topologyPresent: true,

    debugVersion,
    msVersion,

    debugLoadedFromParent: s.debugLoadRequestsFromParent > 0,
    debugLoadRequestsFromParent: s.debugLoadRequestsFromParent,

    msLoadedFromDebug: s.msLoadRequestsFromDebug > 0,
    msLoadRequestsFromDebug: s.msLoadRequestsFromDebug,

    debugLoggerInvoked: s.debugLoggerInvocations > 0,
    debugLoggerInvocations: s.debugLoggerInvocations,

    msInvokedFromDebug: s.msInvocationsFromDebug > 0,
    msInvocationsFromDebug: s.msInvocationsFromDebug,

    debugLoadParents: [...new Set(s.debugLoadParents)],
    msLoadParents: [...new Set(s.msLoadParents)],
    debugNamespaces: [...new Set(s.debugNamespaces)],
    debugMessages: s.debugMessages,
    msArguments: s.msArguments,

    outcome,
    error,
  };
}

async function childMain() {
  const productId = process.argv[3];
  const workloadId = process.argv[4];
  const debugEnabled = process.argv[5] === "true";

  try {
    const result = await executeWorkload(
      productId,
      workloadId,
      debugEnabled
    );
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        productId,
        workload: workloadId,
        debugEnabled,
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

function buildReport(results) {
  const lines = [];

  lines.push("CROSS-PRODUCT SHARED-EDGE RUNTIME ACTIVATION REPORT");
  lines.push("===================================================");
  lines.push("");
  lines.push("Exact shared edge: debug@2.6.9 -> ms@2.0.0");
  lines.push("Products: express-session, Morgan");
  lines.push("");
  lines.push("Definitions:");
  lines.push(
    "  T_e(p)=1 when the exact dependency edge exists in product p."
  );
  lines.push(
    "  L_e(p,w)=1 when debug loads ms during workload w."
  );
  lines.push(
    "  D(p,w)=1 when the parent product invokes its debug logger."
  );
  lines.push(
    "  A_e(p,w)=1 when ms is actually invoked from debug during workload w."
  );
  lines.push("");
  lines.push(
    "Important: this is controlled runtime activation evidence, not a real-world failure/compromise probability."
  );
  lines.push("");

  for (const productId of ["P2", "P3"]) {
    const rows = results.filter((r) => r.productId === productId);
    if (!rows.length) continue;

    lines.push(`${productId} ${rows[0].product}`);
    lines.push("-".repeat(`${productId} ${rows[0].product}`.length));

    for (const r of rows) {
      lines.push(`Workload: ${r.workload}`);
      lines.push(`  DEBUG enabled: ${r.debugEnabled ? "YES" : "NO"}`);
      lines.push(`  T_e(p): 1`);
      lines.push(
        `  parent->debug loaded: ${r.debugLoadedFromParent ? 1 : 0} ` +
        `(requests=${r.debugLoadRequestsFromParent})`
      );
      lines.push(
        `  L_e(p,w) debug->ms loaded: ${r.msLoadedFromDebug ? 1 : 0} ` +
        `(requests=${r.msLoadRequestsFromDebug})`
      );
      lines.push(
        `  D(p,w) debug logger invoked: ${r.debugLoggerInvoked ? 1 : 0} ` +
        `(calls=${r.debugLoggerInvocations})`
      );
      lines.push(
        `  A_e(p,w) ms invoked from debug: ${r.msInvokedFromDebug ? 1 : 0} ` +
        `(calls=${r.msInvocationsFromDebug})`
      );

      lines.push(
        `  debug load parents: ${
          r.debugLoadParents?.length
            ? r.debugLoadParents.join("; ")
            : "none"
        }`
      );

      lines.push(
        `  ms load parents: ${
          r.msLoadParents?.length
            ? r.msLoadParents.join("; ")
            : "none"
        }`
      );

      if (r.outcome && r.outcome.statusCode !== undefined) {
        lines.push(`  HTTP status: ${r.outcome.statusCode}`);
      }

      if (r.error) {
        lines.push(
          `  workload error: ${r.error.name}: ${r.error.message}`
        );
      }

      if (r.fatalError) {
        lines.push(
          `  fatal error: ${r.fatalError.name}: ${r.fatalError.message}`
        );
      }

      lines.push("");
    }
  }

  lines.push("SUMMARY");
  lines.push("-------");
  lines.push(`Workloads: ${results.length}`);

  const edgeLoaded = results.filter((r) => r.msLoadedFromDebug).length;
  const debugInvoked = results.filter((r) => r.debugLoggerInvoked).length;
  const edgeActivated = results.filter((r) => r.msInvokedFromDebug).length;

  lines.push(
    `Workloads with debug->ms load observed: ${edgeLoaded}/${results.length}`
  );
  lines.push(
    `Workloads with parent debug logger invoked: ${debugInvoked}/${results.length}`
  );
  lines.push(
    `Workloads with ms invoked from debug: ${edgeActivated}/${results.length}`
  );

  lines.push("");
  lines.push("MODEL INTERPRETATION");
  lines.push("--------------------");
  lines.push(
    "A shared exact dependency edge can be present and loaded in multiple products without its downstream function being exercised in every workload."
  );
  lines.push(
    "Runtime edge activation is therefore workload- and configuration-conditioned."
  );
  lines.push(
    "The DEBUG environment setting is used here as a controlled configuration variable to expose whether parent debug calls drive downstream ms behavior."
  );
  lines.push(
    "This experiment distinguishes topology, edge loading, parent logger invocation, and downstream edge activation."
  );

  return lines.join("\n");
}

function parentMain() {
  ensureDir(OUTDIR);

  const results = [];

  for (const w of WORKLOADS) {
    const child = spawnSync(
      process.execPath,
      [
        __filename,
        "--child",
        w.product,
        w.id,
        String(w.debugEnabled),
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
        productId: w.product,
        product: PRODUCTS[w.product]?.label || w.product,
        workload: w.id,
        debugEnabled: w.debugEnabled,
        fatalError: {
          name: "ParseError",
          message: `Could not parse child stdout: ${err.message}`,
        },
        childStdout: child.stdout,
      };
    }

    if (child.error) {
      parsed.fatalError = {
        name: child.error.name,
        message: child.error.message,
      };
    }

    if (child.stderr && child.stderr.trim()) {
      parsed.childStderr = child.stderr.trim();
    }

    results.push(parsed);
  }

  const report = buildReport(results);

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "debug-ms-shared-edge-activation-results.json"
    ),
    JSON.stringify(
      {
        exactEdge: "debug@2.6.9 -> ms@2.0.0",
        products: PRODUCTS,
        workloads: WORKLOADS,
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "debug-ms-shared-edge-activation-report.txt"
    ),
    report,
    "utf8"
  );

  console.log(report);
  console.log("");
  console.log("Files created:");
  console.log(
    "  results/debug-ms-shared-edge-activation/debug-ms-shared-edge-activation-report.txt"
  );
  console.log(
    "  results/debug-ms-shared-edge-activation/debug-ms-shared-edge-activation-results.json"
  );
}

if (process.argv[2] === "--child") {
  childMain();
} else {
  parentMain();
}
