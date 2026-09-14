#!/usr/bin/env node
"use strict";

/*
  onfinished_eefirst_shared_edge_activation_experiment.js

  Cross-product runtime activation experiment for the exact shared edge:

      on-finished@2.4.1 -> ee-first@1.1.1

  Products/environments:
    P1: Express
    P3: Morgan

  Measures:
    T_e(p)    : exact edge exists topologically
    L_o(p,w)  : product/runtime loads on-finished
    O(p,w)    : on-finished exported function is invoked
    L_e(p,w)  : on-finished loads ee-first
    A_e(p,w)  : ee-first is actually invoked by on-finished

  Important:
    - Does NOT modify node_modules.
    - Uses reversible in-memory Module._load instrumentation.
    - Uses real HTTP requests.
    - Does NOT estimate real-world failure/compromise probability.
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
  "onfinished-eefirst-shared-edge-activation"
);

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
  { product: "P1", id: "EXPRESS_SIMPLE_SEND" },
  { product: "P1", id: "EXPRESS_SEND_FILE" },
  { product: "P3", id: "MORGAN_NORMAL_REQUEST" },
  { product: "P3", id: "MORGAN_IMMEDIATE_REQUEST" },
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

function installInstrumentation(productDir) {
  const originalLoad = Module._load;

  const onFinishedDir = path.join(
    productDir,
    "node_modules",
    "on-finished"
  );

  const state = {
    onFinishedLoadRequests: 0,
    onFinishedInvocations: 0,

    eeFirstLoadRequestsFromOnFinished: 0,
    eeFirstInvocationsFromOnFinished: 0,

    onFinishedLoadParents: [],
    eeFirstLoadParents: [],
    onFinishedArgumentTypes: [],
    eeFirstArgumentSummaries: [],
  };

  Module._load = function (request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);

    // Exact shared edge target: on-finished -> ee-first
    if (
      request === "ee-first" &&
      parent &&
      isInside(parent.filename, onFinishedDir)
    ) {
      state.eeFirstLoadRequestsFromOnFinished += 1;
      state.eeFirstLoadParents.push(rel(parent.filename, productDir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.eeFirstInvocationsFromOnFinished += 1;

          state.eeFirstArgumentSummaries.push(
            args.map((arg) => {
              if (Array.isArray(arg)) {
                return `array(len=${arg.length})`;
              }
              if (arg === null) return "null";
              return typeof arg;
            })
          );

          return Reflect.apply(target, thisArg, args);
        },
      });
    }

    // Track consumers of on-finished inside this product environment.
    if (
      request === "on-finished" &&
      parent &&
      isInside(parent.filename, productDir) &&
      !isInside(parent.filename, onFinishedDir)
    ) {
      state.onFinishedLoadRequests += 1;
      state.onFinishedLoadParents.push(rel(parent.filename, productDir));

      if (typeof exported !== "function") return exported;

      return new Proxy(exported, {
        apply(target, thisArg, args) {
          state.onFinishedInvocations += 1;
          state.onFinishedArgumentTypes.push(
            args.map((x) => {
              if (x === null) return "null";
              return typeof x;
            })
          );
          return Reflect.apply(target, thisArg, args);
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
            // Give finish/close callbacks a brief chance to complete.
            setTimeout(() => {
              server.close(() => resolve(result));
            }, 30);
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

async function executeWorkload(productId, workloadId) {
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
      `Expected on-finished@2.4.1 in ${product.label}, found on-finished@${onFinishedVersion}`
    );
  }

  if (eeFirstVersion !== "1.1.1") {
    throw new Error(
      `Expected ee-first@1.1.1 in ${product.label}, found ee-first@${eeFirstVersion}`
    );
  }

  const localRequire = createRequire(
    path.join(product.dir, "package.json")
  );

  const instrumentation = installInstrumentation(product.dir);

  let outcome = {};
  let error = null;
  let tempFile = null;

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

      const sink = {
        write() {},
      };

      const app = (req, res) => {
        const immediate =
          workloadId === "MORGAN_IMMEDIATE_REQUEST";

        const middleware = morgan("combined", {
          stream: sink,
          immediate,
        });

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

  const s = instrumentation.state;

  return {
    productId,
    product: product.label,
    workload: workloadId,

    exactEdge: "on-finished@2.4.1 -> ee-first@1.1.1",
    topologyPresent: true,

    onFinishedVersion,
    eeFirstVersion,

    onFinishedLoaded:
      s.onFinishedLoadRequests > 0,
    onFinishedLoadRequests:
      s.onFinishedLoadRequests,

    onFinishedInvoked:
      s.onFinishedInvocations > 0,
    onFinishedInvocations:
      s.onFinishedInvocations,

    eeFirstLoadedFromOnFinished:
      s.eeFirstLoadRequestsFromOnFinished > 0,
    eeFirstLoadRequestsFromOnFinished:
      s.eeFirstLoadRequestsFromOnFinished,

    edgeActivated:
      s.eeFirstInvocationsFromOnFinished > 0,
    eeFirstInvocationsFromOnFinished:
      s.eeFirstInvocationsFromOnFinished,

    onFinishedLoadParents:
      [...new Set(s.onFinishedLoadParents)],
    eeFirstLoadParents:
      [...new Set(s.eeFirstLoadParents)],

    onFinishedArgumentTypes:
      s.onFinishedArgumentTypes,
    eeFirstArgumentSummaries:
      s.eeFirstArgumentSummaries,

    outcome,
    error,
  };
}

async function childMain() {
  const productId = process.argv[3];
  const workloadId = process.argv[4];

  try {
    const result = await executeWorkload(
      productId,
      workloadId
    );
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      productId,
      workload: workloadId,
      fatalError: {
        name: err.name,
        message: err.message,
        stack: err.stack,
      },
    }));
    process.exitCode = 1;
  }
}

function buildReport(results) {
  const lines = [];

  lines.push(
    "CROSS-PRODUCT on-finished -> ee-first SHARED-EDGE ACTIVATION REPORT"
  );
  lines.push(
    "===================================================================="
  );
  lines.push("");
  lines.push(
    "Exact shared edge: on-finished@2.4.1 -> ee-first@1.1.1"
  );
  lines.push("Products: Express, Morgan");
  lines.push("");
  lines.push("Definitions:");
  lines.push(
    "  T_e(p)=1 when the exact dependency edge exists in product p."
  );
  lines.push(
    "  L_o(p,w)=1 when the product/runtime loads on-finished."
  );
  lines.push(
    "  O(p,w)=1 when the on-finished exported function is invoked."
  );
  lines.push(
    "  L_e(p,w)=1 when on-finished loads ee-first."
  );
  lines.push(
    "  A_e(p,w)=1 when ee-first is actually invoked by on-finished."
  );
  lines.push("");
  lines.push(
    "Important: this is controlled runtime activation evidence, not a real-world failure/compromise probability."
  );
  lines.push("");

  for (const productId of ["P1", "P3"]) {
    const rows = results.filter(
      (r) => r.productId === productId
    );

    if (!rows.length) continue;

    lines.push(`${productId} ${rows[0].product}`);
    lines.push("-".repeat(
      `${productId} ${rows[0].product}`.length
    ));

    for (const r of rows) {
      lines.push(`Workload: ${r.workload}`);
      lines.push("  T_e(p): 1");
      lines.push(
        `  L_o(p,w) on-finished loaded: ${
          r.onFinishedLoaded ? 1 : 0
        } (requests=${r.onFinishedLoadRequests})`
      );
      lines.push(
        `  O(p,w) on-finished invoked: ${
          r.onFinishedInvoked ? 1 : 0
        } (calls=${r.onFinishedInvocations})`
      );
      lines.push(
        `  L_e(p,w) ee-first loaded from on-finished: ${
          r.eeFirstLoadedFromOnFinished ? 1 : 0
        } (requests=${r.eeFirstLoadRequestsFromOnFinished})`
      );
      lines.push(
        `  A_e(p,w) ee-first invoked from on-finished: ${
          r.edgeActivated ? 1 : 0
        } (calls=${r.eeFirstInvocationsFromOnFinished})`
      );

      lines.push(
        `  on-finished load parents: ${
          r.onFinishedLoadParents?.length
            ? r.onFinishedLoadParents.join("; ")
            : "none"
        }`
      );

      lines.push(
        `  ee-first load parents: ${
          r.eeFirstLoadParents?.length
            ? r.eeFirstLoadParents.join("; ")
            : "none"
        }`
      );

      if (
        r.outcome &&
        r.outcome.statusCode !== undefined
      ) {
        lines.push(
          `  HTTP status: ${r.outcome.statusCode}`
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

  lines.push("SUMMARY");
  lines.push("-------");
  lines.push(`Workloads: ${results.length}`);

  const onFinishedLoaded = results.filter(
    (r) => r.onFinishedLoaded
  ).length;

  const onFinishedInvoked = results.filter(
    (r) => r.onFinishedInvoked
  ).length;

  const edgeLoaded = results.filter(
    (r) => r.eeFirstLoadedFromOnFinished
  ).length;

  const edgeActivated = results.filter(
    (r) => r.edgeActivated
  ).length;

  lines.push(
    `Workloads with on-finished loaded: ${onFinishedLoaded}/${results.length}`
  );
  lines.push(
    `Workloads with on-finished invoked: ${onFinishedInvoked}/${results.length}`
  );
  lines.push(
    `Workloads with on-finished->ee-first load observed: ${edgeLoaded}/${results.length}`
  );
  lines.push(
    `Workloads with ee-first invoked from on-finished: ${edgeActivated}/${results.length}`
  );

  lines.push("");
  lines.push("MODEL INTERPRETATION");
  lines.push("--------------------");
  lines.push(
    "This experiment separates exact-edge topology membership, module loading, on-finished API invocation, and downstream ee-first execution."
  );
  lines.push(
    "If A_e differs across workloads, the same shared edge has workload-conditioned runtime activation."
  );
  lines.push(
    "Topology presence and package loading alone must not be interpreted as downstream execution."
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
        fatalError: {
          name: "ParseError",
          message: err.message,
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
      "onfinished-eefirst-shared-edge-activation-results.json"
    ),
    JSON.stringify(
      {
        exactEdge:
          "on-finished@2.4.1 -> ee-first@1.1.1",
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
      "onfinished-eefirst-shared-edge-activation-report.txt"
    ),
    report,
    "utf8"
  );

  console.log(report);
  console.log("");
  console.log("Files created:");
  console.log(
    "  results/onfinished-eefirst-shared-edge-activation/onfinished-eefirst-shared-edge-activation-report.txt"
  );
  console.log(
    "  results/onfinished-eefirst-shared-edge-activation/onfinished-eefirst-shared-edge-activation-results.json"
  );
}

if (process.argv[2] === "--child") {
  childMain();
} else {
  parentMain();
}
