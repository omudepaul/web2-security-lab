#!/usr/bin/env node
"use strict";

/*
  depd_ecosystem_activation_experiment.js

  Controlled cross-product runtime activation experiment for the exact
  ecosystem-shared dependency node depd@2.0.0.

  Products:
    P1: Express
    P2: express-session
    P3: Morgan

  Measures separately:
    L_{p,w}: whether depd was loaded/requested by product code
    A_{p,w}: whether the deprecation function returned by depd was invoked

  This experiment DOES NOT modify node_modules and DOES NOT estimate
  real-world compromise/failure probability.
*/

const fs = require("fs");
const path = require("path");
const Module = require("module");
const http = require("http");
const { createRequire } = require("module");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const OUTDIR = path.join(ROOT, "results", "ecosystem-depd-activation");

const PRODUCTS = {
  P1: {
    label: "Express",
    dir: path.join(ROOT, "product-express"),
  },
  P2: {
    label: "express-session",
    dir: path.join(ROOT, "product-session"),
  },
  P3: {
    label: "Morgan",
    dir: path.join(ROOT, "product-morgan"),
  },
};

const WORKLOADS = [
  { product: "P1", id: "EXPRESS_REQUIRE_ONLY" },
  { product: "P1", id: "EXPRESS_NORMAL_REDIRECT" },
  { product: "P1", id: "EXPRESS_DEPRECATED_REDIRECT_NO_URL" },

  { product: "P2", id: "SESSION_VALID_OPTIONS" },
  { product: "P2", id: "SESSION_MISSING_RESAVE_AND_SAVEUNINITIALIZED" },
  { product: "P2", id: "SESSION_MISSING_SECRET" },

  { product: "P3", id: "MORGAN_COMBINED" },
  { product: "P3", id: "MORGAN_UNDEFINED_FORMAT" },
  { product: "P3", id: "MORGAN_LEGACY_OPTIONS_OBJECT" },
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

function parentRelative(parentFilename, productDir) {
  if (!parentFilename) return "<unknown>";
  return path.relative(productDir, parentFilename).replaceAll("\\", "/");
}

function installDepdInstrumentation(productDir) {
  const originalLoad = Module._load;

  const state = {
    depdLoadRequests: 0,
    depdFactoryCalls: 0,
    deprecationInvocations: 0,
    loadParents: [],
    namespaces: [],
    messages: [],
  };

  Module._load = function (request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);

    if (
      request === "depd" &&
      parent &&
      isInside(parent.filename, productDir)
    ) {
      state.depdLoadRequests += 1;
      state.loadParents.push(parentRelative(parent.filename, productDir));

      if (typeof exported !== "function") {
        return exported;
      }

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.depdFactoryCalls += 1;
          if (args.length) {
            state.namespaces.push(String(args[0]));
          }

          const deprecator = Reflect.apply(target, thisArg, args);

          if (typeof deprecator !== "function") {
            return deprecator;
          }

          return new Proxy(deprecator, {
            apply(depTarget, depThisArg, depArgs) {
              state.deprecationInvocations += 1;
              state.messages.push(
                depArgs.length ? String(depArgs[0]) : "<no-message>"
              );
              return Reflect.apply(depTarget, depThisArg, depArgs);
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

function requestApp(app, pathname = "/") {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: pathname,
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
              location: res.headers.location || null,
              bodyLength: body.length,
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

async function runWorkload(productId, workloadId) {
  const product = PRODUCTS[productId];
  if (!product) throw new Error(`Unknown product: ${productId}`);

  const packageJson = path.join(product.dir, "package.json");
  if (!fs.existsSync(packageJson)) {
    throw new Error(`Missing product package.json: ${packageJson}`);
  }

  const localRequire = createRequire(packageJson);
  const instrumentation = installDepdInstrumentation(product.dir);

  let workloadOutcome = {};
  let error = null;

  try {
    if (workloadId === "EXPRESS_REQUIRE_ONLY") {
      localRequire("express");
      workloadOutcome = { action: "require(express)" };
    }

    else if (workloadId === "EXPRESS_NORMAL_REDIRECT") {
      const express = localRequire("express");
      const app = express();

      app.get("/", (req, res) => {
        res.redirect("/target");
      });

      workloadOutcome = await requestApp(app, "/");
    }

    else if (workloadId === "EXPRESS_DEPRECATED_REDIRECT_NO_URL") {
      const express = localRequire("express");
      const app = express();

      app.get("/", (req, res) => {
        // Deliberately exercises Express's documented legacy/deprecated
        // redirect call path visible in the installed source.
        res.redirect();
      });

      workloadOutcome = await requestApp(app, "/");
    }

    else if (workloadId === "SESSION_VALID_OPTIONS") {
      const session = localRequire("express-session");
      session({
        secret: "controlled-experiment-secret",
        resave: false,
        saveUninitialized: false,
      });
      workloadOutcome = { action: "construct middleware with explicit options" };
    }

    else if (
      workloadId === "SESSION_MISSING_RESAVE_AND_SAVEUNINITIALIZED"
    ) {
      const session = localRequire("express-session");
      session({
        secret: "controlled-experiment-secret",
      });
      workloadOutcome = {
        action: "construct middleware with resave/saveUninitialized omitted",
      };
    }

    else if (workloadId === "SESSION_MISSING_SECRET") {
      const session = localRequire("express-session");
      session({
        resave: false,
        saveUninitialized: false,
      });
      workloadOutcome = {
        action: "construct middleware with secret omitted",
      };
    }

    else if (workloadId === "MORGAN_COMBINED") {
      const morgan = localRequire("morgan");
      morgan("combined");
      workloadOutcome = { action: "morgan('combined')" };
    }

    else if (workloadId === "MORGAN_UNDEFINED_FORMAT") {
      const morgan = localRequire("morgan");
      morgan();
      workloadOutcome = { action: "morgan()" };
    }

    else if (workloadId === "MORGAN_LEGACY_OPTIONS_OBJECT") {
      const morgan = localRequire("morgan");
      morgan({ format: "combined" });
      workloadOutcome = {
        action: "morgan({ format: 'combined' })",
      };
    }

    else {
      throw new Error(`Unknown workload: ${workloadId}`);
    }
  } catch (err) {
    error = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  } finally {
    instrumentation.restore();
  }

  const s = instrumentation.state;

  return {
    productId,
    product: product.label,
    workload: workloadId,

    depdLoaded: s.depdLoadRequests > 0,
    depdLoadRequests: s.depdLoadRequests,
    depdFactoryCalls: s.depdFactoryCalls,

    depdInvoked: s.deprecationInvocations > 0,
    deprecationInvocations: s.deprecationInvocations,

    loadParents: [...new Set(s.loadParents)],
    namespaces: [...new Set(s.namespaces)],
    messages: s.messages,

    workloadOutcome,
    error,
  };
}

function childMain() {
  const productId = process.argv[3];
  const workloadId = process.argv[4];

  runWorkload(productId, workloadId)
    .then((result) => {
      process.stdout.write(JSON.stringify(result));
    })
    .catch((err) => {
      process.stdout.write(
        JSON.stringify({
          productId,
          workload: workloadId,
          fatalError: {
            name: err.name,
            message: err.message,
            stack: err.stack,
          },
        })
      );
      process.exitCode = 1;
    });
}

function csvEscape(v) {
  if (v === null || v === undefined) return '""';
  const text =
    typeof v === "object" ? JSON.stringify(v) : String(v);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(file, rows) {
  const headers = [
    "productId",
    "product",
    "workload",
    "depdLoaded",
    "depdLoadRequests",
    "depdFactoryCalls",
    "depdInvoked",
    "deprecationInvocations",
    "loadParents",
    "namespaces",
    "messages",
    "statusCode",
    "error",
  ];

  const lines = [headers.map(csvEscape).join(",")];

  for (const r of rows) {
    const flat = {
      ...r,
      statusCode:
        r.workloadOutcome &&
        r.workloadOutcome.statusCode !== undefined
          ? r.workloadOutcome.statusCode
          : "",
      error: r.error ? r.error.message : "",
    };

    lines.push(
      headers.map((h) => csvEscape(flat[h])).join(",")
    );
  }

  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

function buildReport(results) {
  const lines = [];

  lines.push("CROSS-PRODUCT depd@2.0.0 RUNTIME ACTIVATION REPORT");
  lines.push("===================================================");
  lines.push("");
  lines.push("Purpose:");
  lines.push(
    "  Distinguish ecosystem topology presence from runtime loading and actual deprecation-function invocation."
  );
  lines.push("");
  lines.push("Definitions:");
  lines.push(
    "  L(p,w)=1 when product code requests/loads depd during workload w."
  );
  lines.push(
    "  A(p,w)=1 when the deprecation function returned by depd is actually invoked."
  );
  lines.push("");
  lines.push(
    "Important: this is controlled runtime activation evidence, not a real-world failure or compromise probability."
  );
  lines.push("");

  for (const productId of ["P1", "P2", "P3"]) {
    const productRows = results.filter(
      (r) => r.productId === productId
    );

    if (!productRows.length) continue;

    lines.push(
      `${productId} ${productRows[0].product}`
    );
    lines.push("-".repeat(
      `${productId} ${productRows[0].product}`.length
    ));

    for (const r of productRows) {
      lines.push(`Workload: ${r.workload}`);
      lines.push(
        `  L(p,w) loaded: ${r.depdLoaded ? 1 : 0}  (load requests=${r.depdLoadRequests})`
      );
      lines.push(
        `  A(p,w) invoked: ${r.depdInvoked ? 1 : 0}  (invocations=${r.deprecationInvocations})`
      );
      lines.push(
        `  factory calls: ${r.depdFactoryCalls}`
      );
      lines.push(
        `  load parents: ${
          r.loadParents.length
            ? r.loadParents.join("; ")
            : "none observed"
        }`
      );
      lines.push(
        `  namespaces: ${
          r.namespaces.length
            ? r.namespaces.join("; ")
            : "none observed"
        }`
      );
      lines.push(
        `  deprecation messages: ${
          r.messages.length
            ? r.messages.join(" | ")
            : "none"
        }`
      );

      if (
        r.workloadOutcome &&
        r.workloadOutcome.statusCode !== undefined
      ) {
        lines.push(
          `  HTTP status: ${r.workloadOutcome.statusCode}`
        );
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

  const successful = results.filter((r) => !r.fatalError);
  const loadRows = successful.filter((r) => r.depdLoaded);
  const invokeRows = successful.filter((r) => r.depdInvoked);

  lines.push("SUMMARY");
  lines.push("-------");
  lines.push(`Workloads: ${results.length}`);
  lines.push(
    `Workloads with depd loaded: ${loadRows.length}/${results.length}`
  );
  lines.push(
    `Workloads with depd deprecation invoked: ${invokeRows.length}/${results.length}`
  );

  const parents = [
    ...new Set(
      successful.flatMap((r) => r.loadParents || [])
    ),
  ].sort();

  lines.push(
    `Observed product source files loading depd: ${parents.length}`
  );
  for (const p of parents) {
    lines.push(`  - ${p}`);
  }

  lines.push("");
  lines.push("MODEL INTERPRETATION");
  lines.push("--------------------");
  lines.push(
    "Topology membership alone establishes potential exposure, not runtime use."
  );
  lines.push(
    "L(p,w) captures workload-conditioned loading of the shared package node."
  );
  lines.push(
    "A(p,w) captures workload-conditioned invocation of depd's deprecation behavior."
  );
  lines.push(
    "The same exact package-version can therefore have different activation behavior across products and workloads."
  );

  return lines.join("\n");
}

function parentMain() {
  ensureDir(OUTDIR);

  const results = [];

  for (const w of WORKLOADS) {
    const child = spawnSync(
      process.execPath,
      [__filename, "--child", w.product, w.id],
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
        product: PRODUCTS[w.product].label,
        workload: w.id,
        fatalError: {
          name: "ParseError",
          message: `Could not parse child output: ${err.message}`,
        },
        childStdout: child.stdout,
        childStderr: child.stderr,
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

  const jsonPath = path.join(
    OUTDIR,
    "depd-ecosystem-activation-results.json"
  );
  const csvPath = path.join(
    OUTDIR,
    "depd-ecosystem-activation-results.csv"
  );
  const reportPath = path.join(
    OUTDIR,
    "depd-ecosystem-activation-report.txt"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        dependency: "depd@2.0.0",
        products: PRODUCTS,
        workloads: WORKLOADS,
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  writeCsv(csvPath, results);

  const report = buildReport(results);
  fs.writeFileSync(reportPath, report, "utf8");

  console.log(report);
  console.log("");
  console.log("Files created:");
  console.log(
    "  results/ecosystem-depd-activation/depd-ecosystem-activation-report.txt"
  );
  console.log(
    "  results/ecosystem-depd-activation/depd-ecosystem-activation-results.csv"
  );
  console.log(
    "  results/ecosystem-depd-activation/depd-ecosystem-activation-results.json"
  );
}

if (process.argv[2] === "--child") {
  childMain();
} else {
  parentMain();
}
