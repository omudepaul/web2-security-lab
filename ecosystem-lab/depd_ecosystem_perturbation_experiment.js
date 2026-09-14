#!/usr/bin/env node
"use strict";

/*
  depd_ecosystem_perturbation_experiment.js

  Controlled cross-product perturbation experiment for the exact
  ecosystem-shared dependency node depd@2.0.0.

  Products:
    P1: Express
    P2: express-session
    P3: Morgan

  Controlled perturbations:
    BASELINE
    DROP_WARNING
    CORRUPT_WARNING
    DUPLICATE_WARNING
    DELAY_WARNING

  Important:
    - Does NOT modify node_modules.
    - Uses reversible in-memory Module._load instrumentation.
    - Measures controlled propagation/observability effects.
    - Does NOT estimate real-world compromise/failure probability.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const Module = require("module");
const { createRequire } = require("module");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const OUTDIR = path.join(ROOT, "results", "ecosystem-depd-perturbation");

const REPETITIONS = 5;
const DELAY_MS_PER_INVOCATION = 50;

const PRODUCTS = {
  P1: { label: "Express", dir: path.join(ROOT, "product-express") },
  P2: { label: "express-session", dir: path.join(ROOT, "product-session") },
  P3: { label: "Morgan", dir: path.join(ROOT, "product-morgan") },
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

const PERTURBATIONS = [
  "BASELINE",
  "DROP_WARNING",
  "CORRUPT_WARNING",
  "DUPLICATE_WARNING",
  "DELAY_WARNING",
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

function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function installDepdPerturbation(productDir, perturbation) {
  const originalLoad = Module._load;

  const state = {
    depdLoadRequests: 0,
    depdFactoryCalls: 0,
    deprecationInvocations: 0,
    originalCallsExecuted: 0,
    injectedDelayMs: 0,
    loadParents: [],
    namespaces: [],
    originalMessages: [],
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

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.depdFactoryCalls += 1;
          if (args.length) state.namespaces.push(String(args[0]));

          const deprecator = Reflect.apply(target, thisArg, args);
          if (typeof deprecator !== "function") return deprecator;

          return new Proxy(deprecator, {
            apply(depTarget, depThisArg, depArgs) {
              state.deprecationInvocations += 1;

              const originalMessage =
                depArgs.length ? String(depArgs[0]) : "<no-message>";
              state.originalMessages.push(originalMessage);

              if (perturbation === "DROP_WARNING") {
                // Suppress the warning emission entirely.
                return undefined;
              }

              if (perturbation === "CORRUPT_WARNING") {
                const changed = [...depArgs];
                changed[0] = `CONTROLLED_CORRUPTION::${originalMessage}`;
                state.originalCallsExecuted += 1;
                return Reflect.apply(depTarget, depThisArg, changed);
              }

              if (perturbation === "DUPLICATE_WARNING") {
                state.originalCallsExecuted += 1;
                const first = Reflect.apply(depTarget, depThisArg, depArgs);

                const changed = [...depArgs];
                changed[0] = `CONTROLLED_DUPLICATE::${originalMessage}`;
                state.originalCallsExecuted += 1;
                Reflect.apply(depTarget, depThisArg, changed);
                return first;
              }

              if (perturbation === "DELAY_WARNING") {
                busyWait(DELAY_MS_PER_INVOCATION);
                state.injectedDelayMs += DELAY_MS_PER_INVOCATION;
                state.originalCallsExecuted += 1;
                return Reflect.apply(depTarget, depThisArg, depArgs);
              }

              // BASELINE
              state.originalCallsExecuted += 1;
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
          res.on("data", (chunk) => { body += chunk; });
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

async function executeWorkload(productId, workloadId, perturbation) {
  const product = PRODUCTS[productId];
  if (!product) throw new Error(`Unknown product: ${productId}`);

  const packageJson = path.join(product.dir, "package.json");
  if (!fs.existsSync(packageJson)) {
    throw new Error(`Missing product package.json: ${packageJson}`);
  }

  const localRequire = createRequire(packageJson);
  const instrumentation = installDepdPerturbation(
    product.dir,
    perturbation
  );

  let workloadOutcome = {};
  let error = null;

  const t0 = process.hrtime.bigint();

  try {
    if (workloadId === "EXPRESS_REQUIRE_ONLY") {
      localRequire("express");
      workloadOutcome = { action: "require(express)" };
    }

    else if (workloadId === "EXPRESS_NORMAL_REDIRECT") {
      const express = localRequire("express");
      const app = express();
      app.get("/", (req, res) => res.redirect("/target"));
      workloadOutcome = await requestApp(app, "/");
    }

    else if (workloadId === "EXPRESS_DEPRECATED_REDIRECT_NO_URL") {
      const express = localRequire("express");
      const app = express();
      app.get("/", (req, res) => res.redirect());
      workloadOutcome = await requestApp(app, "/");
    }

    else if (workloadId === "SESSION_VALID_OPTIONS") {
      const session = localRequire("express-session");
      session({
        secret: "controlled-experiment-secret",
        resave: false,
        saveUninitialized: false,
      });
      workloadOutcome = {
        action: "construct middleware with explicit options",
      };
    }

    else if (
      workloadId === "SESSION_MISSING_RESAVE_AND_SAVEUNINITIALIZED"
    ) {
      const session = localRequire("express-session");
      session({ secret: "controlled-experiment-secret" });
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

  const t1 = process.hrtime.bigint();
  const elapsedMs = Number(t1 - t0) / 1e6;
  const s = instrumentation.state;

  return {
    productId,
    product: product.label,
    workload: workloadId,
    perturbation,

    elapsedMs,

    depdLoaded: s.depdLoadRequests > 0,
    depdLoadRequests: s.depdLoadRequests,
    depdFactoryCalls: s.depdFactoryCalls,

    depdInvoked: s.deprecationInvocations > 0,
    deprecationInvocations: s.deprecationInvocations,
    originalCallsExecuted: s.originalCallsExecuted,
    injectedDelayMs: s.injectedDelayMs,

    loadParents: [...new Set(s.loadParents)],
    namespaces: [...new Set(s.namespaces)],
    originalMessages: s.originalMessages,

    workloadOutcome,
    error,
  };
}

async function childMain() {
  const productId = process.argv[3];
  const workloadId = process.argv[4];
  const perturbation = process.argv[5];

  try {
    const result = await executeWorkload(
      productId,
      workloadId,
      perturbation
    );
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        productId,
        product: PRODUCTS[productId]?.label || productId,
        workload: workloadId,
        perturbation,
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

function fmt(n, digits = 3) {
  return Number.isFinite(n) ? n.toFixed(digits) : "NA";
}

function csvEscape(v) {
  if (v === null || v === undefined) return '""';
  const text = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(file, rows) {
  const headers = [
    "productId",
    "product",
    "workload",
    "perturbation",
    "repetition",
    "elapsedMs",
    "baselineMedianMs",
    "elapsedDeltaMs",
    "depdLoaded",
    "depdInvoked",
    "deprecationInvocations",
    "originalCallsExecuted",
    "injectedDelayMs",
    "impactObserved",
    "impactType",
    "statusCode",
    "stderrHasCorruptionMarker",
    "stderrHasDuplicateMarker",
    "stderrLength",
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
      stderrLength: (r.childStderr || "").length,
    };
    lines.push(headers.map((h) => csvEscape(flat[h])).join(","));
  }

  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

function key(productId, workload) {
  return `${productId}::${workload}`;
}

function classifyImpacts(rows) {
  const baselineMedians = new Map();

  for (const w of WORKLOADS) {
    const k = key(w.product, w.id);
    const values = rows
      .filter(
        (r) =>
          r.productId === w.product &&
          r.workload === w.id &&
          r.perturbation === "BASELINE" &&
          !r.fatalError
      )
      .map((r) => r.elapsedMs);

    baselineMedians.set(k, median(values));
  }

  for (const r of rows) {
    const base = baselineMedians.get(key(r.productId, r.workload));
    r.baselineMedianMs = base;
    r.elapsedDeltaMs = Number.isFinite(base)
      ? r.elapsedMs - base
      : NaN;

    const stderr = r.childStderr || "";
    r.stderrHasCorruptionMarker =
      stderr.includes("CONTROLLED_CORRUPTION::");
    r.stderrHasDuplicateMarker =
      stderr.includes("CONTROLLED_DUPLICATE::");

    r.impactObserved = false;
    r.impactType = "NONE";

    if (!r.depdInvoked || r.perturbation === "BASELINE") {
      continue;
    }

    if (r.perturbation === "DROP_WARNING") {
      r.impactObserved = r.originalCallsExecuted === 0;
      r.impactType = r.impactObserved
        ? "OBSERVABILITY_DROP"
        : "NONE";
    }

    else if (r.perturbation === "CORRUPT_WARNING") {
      r.impactObserved = r.stderrHasCorruptionMarker;
      r.impactType = r.impactObserved
        ? "OBSERVABILITY_CORRUPTION"
        : "NONE";
    }

    else if (r.perturbation === "DUPLICATE_WARNING") {
      r.impactObserved = r.stderrHasDuplicateMarker;
      r.impactType = r.impactObserved
        ? "OBSERVABILITY_DUPLICATION"
        : "NONE";
    }

    else if (r.perturbation === "DELAY_WARNING") {
      // Require at least half of the deliberately injected delay
      // to remain visible relative to that workload's baseline median.
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

  return baselineMedians;
}

function aggregate(rows) {
  const groups = new Map();

  for (const r of rows) {
    const k = [
      r.productId,
      r.product,
      r.workload,
      r.perturbation,
    ].join("::");

    if (!groups.has(k)) {
      groups.set(k, {
        productId: r.productId,
        product: r.product,
        workload: r.workload,
        perturbation: r.perturbation,
        trials: 0,
        activeTrials: 0,
        impactedTrials: 0,
        elapsedMs: [],
        elapsedDeltaMs: [],
        injectedDelayMs: [],
        statusCodes: [],
      });
    }

    const g = groups.get(k);
    g.trials += 1;
    if (r.depdInvoked) g.activeTrials += 1;
    if (r.impactObserved) g.impactedTrials += 1;
    if (Number.isFinite(r.elapsedMs)) g.elapsedMs.push(r.elapsedMs);
    if (Number.isFinite(r.elapsedDeltaMs)) {
      g.elapsedDeltaMs.push(r.elapsedDeltaMs);
    }
    if (Number.isFinite(r.injectedDelayMs)) {
      g.injectedDelayMs.push(r.injectedDelayMs);
    }
    if (
      r.workloadOutcome &&
      r.workloadOutcome.statusCode !== undefined
    ) {
      g.statusCodes.push(r.workloadOutcome.statusCode);
    }
  }

  return [...groups.values()].map((g) => ({
    ...g,
    activationRate: g.trials ? g.activeTrials / g.trials : NaN,
    qHatConditionalOnActive:
      g.activeTrials ? g.impactedTrials / g.activeTrials : null,
    meanElapsedMs: mean(g.elapsedMs),
    medianElapsedMs: median(g.elapsedMs),
    meanElapsedDeltaMs: mean(g.elapsedDeltaMs),
    meanInjectedDelayMs: mean(g.injectedDelayMs),
    uniqueStatusCodes: [...new Set(g.statusCodes)],
  }));
}

function buildReport(rows, summary) {
  const lines = [];

  lines.push("CROSS-PRODUCT depd@2.0.0 CONTROLLED PERTURBATION REPORT");
  lines.push("========================================================");
  lines.push("");
  lines.push("Products: Express, express-session, Morgan");
  lines.push(`Repetitions per workload/condition: ${REPETITIONS}`);
  lines.push(`Delay injection: ${DELAY_MS_PER_INVOCATION} ms per depd invocation`);
  lines.push("");
  lines.push("Perturbations:");
  lines.push("  BASELINE");
  lines.push("  DROP_WARNING");
  lines.push("  CORRUPT_WARNING");
  lines.push("  DUPLICATE_WARNING");
  lines.push("  DELAY_WARNING");
  lines.push("");
  lines.push("Definitions:");
  lines.push("  A(p,w)=1 when depd deprecation behavior is invoked.");
  lines.push(
    "  q_hat = impacted active trials / active trials for a controlled perturbation."
  );
  lines.push("");
  lines.push(
    "Important: q_hat here is a controlled workload-conditioned propagation quantity, not real-world compromise/failure probability."
  );
  lines.push("");

  for (const productId of ["P1", "P2", "P3"]) {
    const productRows = summary.filter(
      (g) => g.productId === productId
    );
    if (!productRows.length) continue;

    lines.push(`${productId} ${productRows[0].product}`);
    lines.push("-".repeat(`${productId} ${productRows[0].product}`.length));

    const workloadNames = [
      ...new Set(productRows.map((g) => g.workload)),
    ];

    for (const workload of workloadNames) {
      lines.push(`Workload: ${workload}`);

      const ws = productRows.filter((g) => g.workload === workload);

      for (const g of ws) {
        lines.push(
          `  ${g.perturbation}: active=${g.activeTrials}/${g.trials}, impacted=${g.impactedTrials}/${g.trials}, q|active=${
            g.qHatConditionalOnActive === null
              ? "NA"
              : fmt(g.qHatConditionalOnActive, 3)
          }, median=${fmt(g.medianElapsedMs, 3)} ms, mean-delta=${fmt(
            g.meanElapsedDeltaMs,
            3
          )} ms`
        );
      }

      lines.push("");
    }
  }

  const activePerturbed = summary.filter(
    (g) =>
      g.perturbation !== "BASELINE" &&
      g.activeTrials > 0
  );

  const inactivePerturbed = summary.filter(
    (g) =>
      g.perturbation !== "BASELINE" &&
      g.activeTrials === 0
  );

  lines.push("CROSS-PRODUCT SUMMARY");
  lines.push("---------------------");
  lines.push(`Total trial rows: ${rows.length}`);
  lines.push(
    `Active perturbation workload/condition groups: ${activePerturbed.length}`
  );
  lines.push(
    `Inactive perturbation workload/condition groups: ${inactivePerturbed.length}`
  );

  for (const perturbation of PERTURBATIONS.filter(
    (p) => p !== "BASELINE"
  )) {
    const gs = activePerturbed.filter(
      (g) => g.perturbation === perturbation
    );

    const activeTrials = gs.reduce(
      (s, g) => s + g.activeTrials,
      0
    );
    const impactedTrials = gs.reduce(
      (s, g) => s + g.impactedTrials,
      0
    );

    const q = activeTrials
      ? impactedTrials / activeTrials
      : null;

    lines.push(
      `${perturbation}: active-trials=${activeTrials}, impacted=${impactedTrials}, overall q|active=${
        q === null ? "NA" : fmt(q, 3)
      }`
    );
  }

  lines.push("");
  lines.push("APPLICATION-LEVEL STATUS CHECK");
  lines.push("------------------------------");

  const expressGroups = summary.filter(
    (g) =>
      g.productId === "P1" &&
      g.uniqueStatusCodes.length
  );

  for (const g of expressGroups) {
    lines.push(
      `${g.workload} / ${g.perturbation}: HTTP status=${g.uniqueStatusCodes.join(",")}`
    );
  }

  lines.push("");
  lines.push("MODEL INTERPRETATION");
  lines.push("--------------------");
  lines.push(
    "The exact shared dependency node depd@2.0.0 is present in all three product graphs."
  );
  lines.push(
    "Perturbation effects are gated by workload-conditioned invocation: inactive workloads should not exhibit depd-specific propagation."
  );
  lines.push(
    "DROP/CORRUPT/DUPLICATE primarily test observability integrity, while DELAY tests latency propagation."
  );
  lines.push(
    "Unchanged HTTP status under warning perturbations would indicate observability impact without corresponding response-status failure."
  );
  lines.push(
    "Deterministic q values validate the controlled propagation mechanism; they must not be interpreted as natural prevalence or compromise likelihood."
  );

  return lines.join("\n");
}

function parentMain() {
  ensureDir(OUTDIR);

  const rows = [];
  let trial = 0;

  for (const w of WORKLOADS) {
    for (const perturbation of PERTURBATIONS) {
      for (let repetition = 1; repetition <= REPETITIONS; repetition++) {
        trial += 1;

        const child = spawnSync(
          process.execPath,
          [
            __filename,
            "--child",
            w.product,
            w.id,
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
            productId: w.product,
            product: PRODUCTS[w.product].label,
            workload: w.id,
            perturbation,
            fatalError: {
              name: "ParseError",
              message: `Could not parse child output: ${err.message}`,
            },
          };
        }

        parsed.repetition = repetition;
        parsed.trial = trial;
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

  classifyImpacts(rows);
  const summary = aggregate(rows);

  const jsonPath = path.join(
    OUTDIR,
    "depd-ecosystem-perturbation-results.json"
  );
  const csvPath = path.join(
    OUTDIR,
    "depd-ecosystem-perturbation-results.csv"
  );
  const summaryJsonPath = path.join(
    OUTDIR,
    "depd-ecosystem-perturbation-summary.json"
  );
  const reportPath = path.join(
    OUTDIR,
    "depd-ecosystem-perturbation-report.txt"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        dependency: "depd@2.0.0",
        repetitions: REPETITIONS,
        delayMsPerInvocation: DELAY_MS_PER_INVOCATION,
        products: PRODUCTS,
        workloads: WORKLOADS,
        perturbations: PERTURBATIONS,
        rows,
      },
      null,
      2
    ),
    "utf8"
  );

  writeCsv(csvPath, rows);

  fs.writeFileSync(
    summaryJsonPath,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  const report = buildReport(rows, summary);
  fs.writeFileSync(reportPath, report, "utf8");

  console.log(report);
  console.log("");
  console.log("Files created:");
  console.log(
    "  results/ecosystem-depd-perturbation/depd-ecosystem-perturbation-report.txt"
  );
  console.log(
    "  results/ecosystem-depd-perturbation/depd-ecosystem-perturbation-results.csv"
  );
  console.log(
    "  results/ecosystem-depd-perturbation/depd-ecosystem-perturbation-results.json"
  );
  console.log(
    "  results/ecosystem-depd-perturbation/depd-ecosystem-perturbation-summary.json"
  );
}

if (process.argv[2] === "--child") {
  childMain();
} else {
  parentMain();
}
