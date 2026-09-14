#!/usr/bin/env node
"use strict";

/*
  onfinished_eefirst_shared_edge_perturbation_experiment.js

  Controlled cross-product perturbation experiment for:

      on-finished@2.4.1 -> ee-first@1.1.1

  Products:
    P1: Express
    P3: Morgan

  Workloads:
    P1 inactive: EXPRESS_SIMPLE_SEND
    P1 active:   EXPRESS_SEND_FILE
    P3 active:   MORGAN_NORMAL_REQUEST
    P3 inactive: MORGAN_IMMEDIATE_REQUEST

  Perturbations applied only to ee-first when loaded by on-finished:
    BASELINE
    DROP_COMPLETION
    CORRUPT_ERROR
    DELAY_COMPLETION

  Measures:
    A_e(p,w)   : ee-first actually invoked by on-finished
    C(p,w)     : parent-visible on-finished callback fires
    q_hat      : impacted active trials / active trials
    pi_hat     : impacted trials / all trials

  Important:
    - Does NOT modify node_modules.
    - Uses reversible in-memory Module._load instrumentation.
    - Uses real HTTP requests.
    - Controlled propagation only; NOT natural compromise/failure probability.
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
  "onfinished-eefirst-shared-edge-perturbation"
);

const REPETITIONS = 5;
const DELAY_MS = 50;

const PRODUCTS = {
  P1: {
    label: "Express",
    dir: path.join(ROOT, "product-express"),
  },
  P3: {
    label: "Morgan",
    dir: path.join(ROOT, "product-morgan"),
  },
};

const WORKLOADS = [
  { product: "P1", id: "EXPRESS_SIMPLE_SEND", expectedActive: false },
  { product: "P1", id: "EXPRESS_SEND_FILE", expectedActive: true },
  { product: "P3", id: "MORGAN_NORMAL_REQUEST", expectedActive: true },
  { product: "P3", id: "MORGAN_IMMEDIATE_REQUEST", expectedActive: false },
];

const PERTURBATIONS = [
  "BASELINE",
  "DROP_COMPLETION",
  "CORRUPT_ERROR",
  "DELAY_COMPLETION",
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

function installInstrumentation(productDir, perturbation) {
  const originalLoad = Module._load;

  const onFinishedDir = path.join(
    productDir,
    "node_modules",
    "on-finished"
  );

  const state = {
    onFinishedLoads: 0,
    onFinishedInvocations: 0,
    parentVisibleCallbackInvocations: 0,
    parentVisibleCallbackErrors: 0,
    controlledErrorsSeenByParent: 0,

    eeFirstLoadsFromOnFinished: 0,
    eeFirstInvocationsFromOnFinished: 0,
    eeFirstCompletionSignals: 0,

    droppedEeFirstRegistrations: 0,
    corruptedCompletionSignals: 0,
    delayedCompletionSignals: 0,
    injectedDelayMs: 0,

    onFinishedLoadParents: [],
    eeFirstLoadParents: [],
  };

  Module._load = function (request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);

    // Instrument exact edge target: on-finished -> ee-first
    if (
      request === "ee-first" &&
      parent &&
      isInside(parent.filename, onFinishedDir)
    ) {
      state.eeFirstLoadsFromOnFinished += 1;
      state.eeFirstLoadParents.push(rel(parent.filename, productDir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.eeFirstInvocationsFromOnFinished += 1;

          const stuff = args[0];
          const done = args[1];

          if (perturbation === "DROP_COMPLETION") {
            state.droppedEeFirstRegistrations += 1;

            // Preserve the expected return interface but deliberately
            // install no event listeners.
            function noopThunk() {}
            noopThunk.cancel = function () {};
            return noopThunk;
          }

          if (typeof done !== "function") {
            return Reflect.apply(target, thisArg, args);
          }

          const wrappedDone = function (...doneArgs) {
            state.eeFirstCompletionSignals += 1;

            if (perturbation === "CORRUPT_ERROR") {
              state.corruptedCompletionSignals += 1;
              const changed = [...doneArgs];
              changed[0] = new Error(
                "CONTROLLED_EE_FIRST_ERROR"
              );
              return done.apply(this, changed);
            }

            if (perturbation === "DELAY_COMPLETION") {
              busyWait(DELAY_MS);
              state.delayedCompletionSignals += 1;
              state.injectedDelayMs += DELAY_MS;
              return done.apply(this, doneArgs);
            }

            return done.apply(this, doneArgs);
          };

          return Reflect.apply(
            target,
            thisArg,
            [stuff, wrappedDone]
          );
        },
      });
    }

    // Instrument consumers of on-finished and wrap the callback
    // so we can observe what the parent product actually receives.
    if (
      request === "on-finished" &&
      parent &&
      isInside(parent.filename, productDir) &&
      !isInside(parent.filename, onFinishedDir)
    ) {
      state.onFinishedLoads += 1;
      state.onFinishedLoadParents.push(rel(parent.filename, productDir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.onFinishedInvocations += 1;

          const msg = args[0];
          const callback = args[1];

          if (typeof callback !== "function") {
            return Reflect.apply(target, thisArg, args);
          }

          const wrappedCallback = function (...cbArgs) {
            state.parentVisibleCallbackInvocations += 1;

            const err = cbArgs[0];
            if (err) {
              state.parentVisibleCallbackErrors += 1;
              if (
                err &&
                String(err.message || err).includes(
                  "CONTROLLED_EE_FIRST_ERROR"
                )
              ) {
                state.controlledErrorsSeenByParent += 1;
              }
            }

            return callback.apply(this, cbArgs);
          };

          return Reflect.apply(
            target,
            thisArg,
            [msg, wrappedCallback]
          );
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
      const addr = server.address();

      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path: pathname,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => { body += c; });
          res.on("end", () => {
            const result = {
              statusCode: res.statusCode,
              bodyLength: body.length,
            };

            // Allow finish/close callbacks to complete.
            setTimeout(() => {
              server.close(() => resolve(result));
            }, 40);
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

async function executeOne(productId, workloadId, perturbation) {
  const product = PRODUCTS[productId];
  if (!product) throw new Error(`Unknown product: ${productId}`);

  const onFinishedVersion = readPackageVersion(
    product.dir,
    "on-finished"
  );
  const eeFirstVersion = readPackageVersion(
    product.dir,
    "ee-first"
  );

  if (onFinishedVersion !== "2.4.1") {
    throw new Error(
      `Expected on-finished@2.4.1, found on-finished@${onFinishedVersion}`
    );
  }

  if (eeFirstVersion !== "1.1.1") {
    throw new Error(
      `Expected ee-first@1.1.1, found ee-first@${eeFirstVersion}`
    );
  }

  const localRequire = createRequire(
    path.join(product.dir, "package.json")
  );

  const instrumentation = installInstrumentation(
    product.dir,
    perturbation
  );

  let outcome = {};
  let error = null;
  let tempFile = null;

  const t0 = process.hrtime.bigint();

  try {
    if (productId === "P1") {
      const express = localRequire("express");
      const app = express();

      if (workloadId === "EXPRESS_SIMPLE_SEND") {
        app.get("/", (req, res) => {
          res.status(200).send("ok");
        });
      }

      else if (workloadId === "EXPRESS_SEND_FILE") {
        tempFile = path.join(
          ROOT,
          "shared-edge-sendfile-test.txt"
        );

        fs.writeFileSync(
          tempFile,
          "shared-edge-runtime-test",
          "utf8"
        );

        app.get("/", (req, res, next) => {
          res.sendFile(tempFile, (err) => {
            if (err) next(err);
          });
        });
      }

      else {
        throw new Error(`Unknown Express workload: ${workloadId}`);
      }

      outcome = await requestApp(app, "/");
    }

    else if (productId === "P3") {
      const morgan = localRequire("morgan");

      const sink = { write() {} };

      const middleware = morgan("combined", {
        stream: sink,
        immediate:
          workloadId === "MORGAN_IMMEDIATE_REQUEST",
      });

      const app = (req, res) => {
        middleware(req, res, (err) => {
          if (err) {
            res.statusCode = 500;
            res.end("middleware-error");
            return;
          }

          res.statusCode = 200;
          res.end("ok");
        });
      };

      outcome = await requestApp(app, "/");
    }
  } catch (err) {
    error = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  } finally {
    instrumentation.restore();

    if (tempFile && fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {}
    }
  }

  const t1 = process.hrtime.bigint();
  const elapsedMs = Number(t1 - t0) / 1e6;
  const s = instrumentation.state;

  return {
    productId,
    product: product.label,
    workload: workloadId,
    perturbation,

    exactEdge: "on-finished@2.4.1 -> ee-first@1.1.1",
    topologyPresent: true,

    elapsedMs,

    onFinishedLoaded: s.onFinishedLoads > 0,
    onFinishedInvoked: s.onFinishedInvocations > 0,

    edgeLoaded: s.eeFirstLoadsFromOnFinished > 0,
    edgeActivated:
      s.eeFirstInvocationsFromOnFinished > 0,

    parentCallbackObserved:
      s.parentVisibleCallbackInvocations > 0,

    parentVisibleCallbackInvocations:
      s.parentVisibleCallbackInvocations,
    parentVisibleCallbackErrors:
      s.parentVisibleCallbackErrors,
    controlledErrorsSeenByParent:
      s.controlledErrorsSeenByParent,

    eeFirstLoadsFromOnFinished:
      s.eeFirstLoadsFromOnFinished,
    eeFirstInvocationsFromOnFinished:
      s.eeFirstInvocationsFromOnFinished,
    eeFirstCompletionSignals:
      s.eeFirstCompletionSignals,

    droppedEeFirstRegistrations:
      s.droppedEeFirstRegistrations,
    corruptedCompletionSignals:
      s.corruptedCompletionSignals,
    delayedCompletionSignals:
      s.delayedCompletionSignals,
    injectedDelayMs:
      s.injectedDelayMs,

    onFinishedLoadParents:
      [...new Set(s.onFinishedLoadParents)],
    eeFirstLoadParents:
      [...new Set(s.eeFirstLoadParents)],

    outcome,
    error,
  };
}

async function childMain() {
  const productId = process.argv[3];
  const workloadId = process.argv[4];
  const perturbation = process.argv[5];

  try {
    const result = await executeOne(
      productId,
      workloadId,
      perturbation
    );
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      productId,
      workload: workloadId,
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

function classify(rows) {
  const baselineMedian = new Map();

  for (const w of WORKLOADS) {
    const vals = rows
      .filter(
        (r) =>
          r.productId === w.product &&
          r.workload === w.id &&
          r.perturbation === "BASELINE" &&
          !r.fatalError
      )
      .map((r) => r.elapsedMs);

    baselineMedian.set(
      `${w.product}::${w.id}`,
      median(vals)
    );
  }

  for (const r of rows) {
    const base = baselineMedian.get(
      `${r.productId}::${r.workload}`
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

    if (r.perturbation === "DROP_COMPLETION") {
      r.impactObserved =
        r.droppedEeFirstRegistrations > 0 &&
        r.parentVisibleCallbackInvocations === 0;

      r.impactType = r.impactObserved
        ? "COMPLETION_SUPPRESSION"
        : "NONE";
    }

    else if (r.perturbation === "CORRUPT_ERROR") {
      r.impactObserved =
        r.controlledErrorsSeenByParent > 0;

      r.impactType = r.impactObserved
        ? "ERROR_CORRUPTION"
        : "NONE";
    }

    else if (r.perturbation === "DELAY_COMPLETION") {
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
        callbackTrials: 0,
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

    if (r.edgeActivated) g.activeTrials += 1;
    if (r.parentCallbackObserved) g.callbackTrials += 1;

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

    activationRate:
      g.activeTrials / g.trials,

    parentCallbackRate:
      g.callbackTrials / g.trials,

    qHatConditionalOnActive:
      g.activeTrials
        ? g.impactedTrials / g.activeTrials
        : null,

    piHat:
      g.impactedTrials / g.trials,

    medianElapsedMs:
      median(g.elapsedMs),

    meanElapsedDeltaMs:
      mean(g.elapsedDeltaMs),

    meanInjectedDelayMs:
      mean(g.injectedDelayMs),

    uniqueStatusCodes:
      [...new Set(g.statusCodes)],

    impactType:
      [...g.impactTypes].join("|") || "NONE",
  }));
}

function buildReport(rows, summary) {
  const lines = [];

  lines.push(
    "on-finished@2.4.1 -> ee-first@1.1.1 SHARED-EDGE PERTURBATION REPORT"
  );
  lines.push(
    "====================================================================="
  );
  lines.push("");
  lines.push(
    `Repetitions per workload/condition: ${REPETITIONS}`
  );
  lines.push(
    `Delay injection: ${DELAY_MS} ms per ee-first completion signal`
  );
  lines.push("");
  lines.push("Perturbations:");
  lines.push("  BASELINE");
  lines.push("  DROP_COMPLETION");
  lines.push("  CORRUPT_ERROR");
  lines.push("  DELAY_COMPLETION");
  lines.push("");
  lines.push("Definitions:");
  lines.push(
    "  A_e = edge activation rate (ee-first invoked by on-finished)."
  );
  lines.push(
    "  C = parent-visible on-finished callback rate."
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

  for (const productId of ["P1", "P3"]) {
    const gs = summary.filter(
      (g) => g.productId === productId
    );

    if (!gs.length) continue;

    lines.push(`${productId} ${gs[0].product}`);
    lines.push("-".repeat(
      `${productId} ${gs[0].product}`.length
    ));

    const workloads = [
      ...new Set(gs.map((g) => g.workload)),
    ];

    for (const workload of workloads) {
      lines.push(`Workload: ${workload}`);

      for (const g of gs.filter(
        (x) => x.workload === workload
      )) {
        lines.push(
          `  ${g.perturbation}: ` +
          `A_e=${fmt(g.activationRate)} ` +
          `C=${fmt(g.parentCallbackRate)} ` +
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

  lines.push("CROSS-PRODUCT ACTIVE-WORKLOAD SUMMARY");
  lines.push("-------------------------------------");

  const activeWorkloads = new Set([
    "P1::EXPRESS_SEND_FILE",
    "P3::MORGAN_NORMAL_REQUEST",
  ]);

  for (const perturbation of PERTURBATIONS.filter(
    (p) => p !== "BASELINE"
  )) {
    const gs = summary.filter(
      (g) =>
        activeWorkloads.has(
          `${g.productId}::${g.workload}`
        ) &&
        g.perturbation === perturbation
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
      `${perturbation}: active-trials=${activeTrials}, ` +
      `impacted=${impactedTrials}, overall q|active=${
        q === null ? "NA" : fmt(q)
      }`
    );
  }

  lines.push("");
  lines.push("INACTIVE-CONTROL CHECK");
  lines.push("----------------------");

  const inactiveWorkloads = new Set([
    "P1::EXPRESS_SIMPLE_SEND",
    "P3::MORGAN_IMMEDIATE_REQUEST",
  ]);

  const inactiveGroups = summary.filter(
    (g) =>
      inactiveWorkloads.has(
        `${g.productId}::${g.workload}`
      ) &&
      g.perturbation !== "BASELINE"
  );

  const inactiveImpacts = inactiveGroups.reduce(
    (s, g) => s + g.impactedTrials,
    0
  );

  lines.push(
    `Impacted trials while shared edge inactive: ${inactiveImpacts}`
  );

  lines.push("");
  lines.push("APPLICATION STATUS CHECK");
  lines.push("------------------------");

  for (const g of summary.filter(
    (x) => x.uniqueStatusCodes.length
  )) {
    lines.push(
      `${g.productId} ${g.workload} ${g.perturbation}: ` +
      `HTTP status=${g.uniqueStatusCodes.join(",")}`
    );
  }

  lines.push("");
  lines.push("MODEL INTERPRETATION");
  lines.push("--------------------");
  lines.push(
    "The exact shared edge is workload-conditioned: package loading alone does not imply ee-first execution."
  );
  lines.push(
    "Inactive workloads provide a negative control for ee-first-specific perturbations."
  );
  lines.push(
    "DROP_COMPLETION tests completion-signal suppression, CORRUPT_ERROR tests error-channel corruption, and DELAY_COMPLETION tests latency propagation."
  );
  lines.push(
    "Any deterministic q values validate only the controlled propagation mechanism and must not be interpreted as natural vulnerability or compromise likelihood."
  );

  return lines.join("\n");
}

function parentMain() {
  ensureDir(OUTDIR);

  const rows = [];

  for (const w of WORKLOADS) {
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
            product:
              PRODUCTS[w.product]?.label || w.product,
            workload: w.id,
            perturbation,
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

        if (child.stderr && child.stderr.trim()) {
          parsed.childStderr = child.stderr.trim();
        }

        rows.push(parsed);
      }
    }
  }

  classify(rows);
  const summary = aggregate(rows);
  const report = buildReport(rows, summary);

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "onfinished-eefirst-shared-edge-perturbation-results.json"
    ),
    JSON.stringify(
      {
        exactEdge:
          "on-finished@2.4.1 -> ee-first@1.1.1",
        repetitions: REPETITIONS,
        delayMs: DELAY_MS,
        products: PRODUCTS,
        workloads: WORKLOADS,
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
      "onfinished-eefirst-shared-edge-perturbation-report.txt"
    ),
    report,
    "utf8"
  );

  console.log(report);
  console.log("");
  console.log("Files created:");
  console.log(
    "  results/onfinished-eefirst-shared-edge-perturbation/onfinished-eefirst-shared-edge-perturbation-report.txt"
  );
  console.log(
    "  results/onfinished-eefirst-shared-edge-perturbation/onfinished-eefirst-shared-edge-perturbation-results.json"
  );
}

if (process.argv[2] === "--child") {
  childMain();
} else {
  parentMain();
}
