#!/usr/bin/env node
"use strict";

/*
  morgan_multihop_path_activation_experiment.js

  Studies two REAL 2-hop dependency paths in P3 (Morgan):

    PA: morgan@1.12.1 -> debug@2.6.9 -> ms@2.0.0
    PB: morgan@1.12.1 -> on-finished@2.4.1 -> ee-first@1.1.1

  Goal:
    Estimate JOINT path activation under different runtime contexts.

  Important:
    For a path P = (e1,...,ek), define trace-level path activation as

      A_P(t) = product_j A_ej(t)

    because A_ej(t) is binary for a single trace.

    But at the probability level:

      alpha_P(x) = P(all edges in P are active | x)

    is NOT generally equal to product_j alpha_ej(x) unless suitable
    independence assumptions are justified.

  This experiment measures alpha_P directly from joint runtime traces.
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const P3ROOT = path.join(ROOT, "product-morgan");
const MORGAN_PATH = path.join(
  P3ROOT,
  "node_modules",
  "morgan"
);

const TOPOLOGY_FILE = path.join(
  ROOT,
  "ecosystem-topology.json"
);

const OUTDIR = path.join(
  ROOT,
  "results",
  "multihop-path-activation"
);

const REPS = 10;

const PATHS = {
  PA: {
    label:
      "morgan@1.12.1 -> debug@2.6.9 -> ms@2.0.0",
    edges: [
      ["morgan@1.12.1", "debug@2.6.9"],
      ["debug@2.6.9", "ms@2.0.0"],
    ],
  },
  PB: {
    label:
      "morgan@1.12.1 -> on-finished@2.4.1 -> ee-first@1.1.1",
    edges: [
      ["morgan@1.12.1", "on-finished@2.4.1"],
      ["on-finished@2.4.1", "ee-first@1.1.1"],
    ],
  },
};

const CONDITIONS = [
  {
    id: "C1_DEBUG_OFF_NORMAL",
    debug: "",
    colors: "1",
    immediate: false,
  },
  {
    id: "C2_DEBUG_ON_COLORS_OFF_NORMAL",
    debug: "morgan",
    colors: "0",
    immediate: false,
  },
  {
    id: "C3_DEBUG_ON_COLORS_ON_NORMAL",
    debug: "morgan",
    colors: "1",
    immediate: false,
  },
  {
    id: "C4_DEBUG_ON_COLORS_ON_IMMEDIATE",
    debug: "morgan",
    colors: "1",
    immediate: true,
  },
  {
    id: "C5_DEBUG_OFF_IMMEDIATE",
    debug: "",
    colors: "1",
    immediate: true,
  },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function norm(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function mean(xs) {
  const a = xs.filter(
    (x) => typeof x === "number" && Number.isFinite(x)
  );
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function fmt(v, d = 3) {
  if (
    v === null ||
    v === undefined ||
    !Number.isFinite(Number(v))
  ) return "NA";
  return Number(v).toFixed(d);
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function topologyCheck() {
  if (!fs.existsSync(TOPOLOGY_FILE)) {
    throw new Error(
      `Topology file not found: ${TOPOLOGY_FILE}`
    );
  }

  const topo = JSON.parse(
    fs.readFileSync(TOPOLOGY_FILE, "utf8")
  );

  function edgePresent(src, dst) {
    return topo.ecosystemEdges.some(
      (e) =>
        e.source === src &&
        e.target === dst &&
        Array.isArray(e.productIds) &&
        e.productIds.includes("P3")
    );
  }

  const results = {};

  for (const [pathId, def] of Object.entries(PATHS)) {
    results[pathId] = {
      label: def.label,
      edgePresence: def.edges.map(([src, dst]) => ({
        source: src,
        target: dst,
        presentInP3: edgePresent(src, dst),
      })),
    };

    results[pathId].pathPresentInP3 =
      results[pathId].edgePresence.every(
        (x) => x.presentInP3
      );
  }

  return results;
}

async function runChild(condition) {
  process.env.DEBUG = condition.debug;
  process.env.DEBUG_COLORS = condition.colors;

  const Module = require("module");
  const originalLoad = Module._load;

  const c = {
    morganToDebugLoad: 0,
    debugFactoryCalls: 0,
    debugLoggerCalls: 0,

    debugToMsLoad: 0,
    msCalls: 0,

    morganToOnFinishedLoad: 0,
    onFinishedCalls: 0,

    onFinishedToEeFirstLoad: 0,
    eeFirstCalls: 0,

    morganWrites: 0,
  };

  Module._load = function(request, parent, isMain) {
    const exp = originalLoad.apply(this, arguments);
    const pf = norm(parent && parent.filename);

    if (
      request === "debug" &&
      pf.includes("/node_modules/morgan/")
    ) {
      c.morganToDebugLoad++;

      return new Proxy(exp, {
        apply(target, thisArg, args) {
          c.debugFactoryCalls++;

          const logger = Reflect.apply(
            target,
            thisArg,
            args
          );

          if (typeof logger !== "function") {
            return logger;
          }

          return new Proxy(logger, {
            apply(logTarget, logThis, logArgs) {
              c.debugLoggerCalls++;
              return Reflect.apply(
                logTarget,
                logThis,
                logArgs
              );
            },
          });
        },
      });
    }

    if (
      request === "ms" &&
      pf.includes("/node_modules/debug/")
    ) {
      c.debugToMsLoad++;

      if (typeof exp !== "function") {
        return exp;
      }

      return new Proxy(exp, {
        apply(target, thisArg, args) {
          c.msCalls++;
          return Reflect.apply(
            target,
            thisArg,
            args
          );
        },
      });
    }

    if (
      request === "on-finished" &&
      pf.includes("/node_modules/morgan/")
    ) {
      c.morganToOnFinishedLoad++;

      if (typeof exp !== "function") {
        return exp;
      }

      return new Proxy(exp, {
        apply(target, thisArg, args) {
          c.onFinishedCalls++;
          return Reflect.apply(
            target,
            thisArg,
            args
          );
        },
      });
    }

    if (
      request === "ee-first" &&
      pf.includes("/node_modules/on-finished/")
    ) {
      c.onFinishedToEeFirstLoad++;

      if (typeof exp !== "function") {
        return exp;
      }

      return new Proxy(exp, {
        apply(target, thisArg, args) {
          c.eeFirstCalls++;
          return Reflect.apply(
            target,
            thisArg,
            args
          );
        },
      });
    }

    return exp;
  };

  let morgan;
  try {
    morgan = require(MORGAN_PATH);
  } finally {
    // Keep instrumentation installed through the workload.
  }

  const stream = {
    write(line) {
      c.morganWrites++;
    },
  };

  const middleware = morgan("tiny", {
    immediate: condition.immediate,
    stream,
  });

  const server = http.createServer(
    (req, res) => {
      middleware(req, res, () => {
        res.statusCode = 200;
        res.setHeader(
          "content-type",
          "text/plain"
        );
        res.end("ok");
      });
    }
  );

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;

  const requestResult =
    await new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/multihop-test",
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (d) => {
            body += d;
          });
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode,
              body,
            });
          });
        }
      );

      req.on("error", reject);
    });

  // Give finish/on-finished logging a brief deterministic
  // window to complete before collecting counters.
  await new Promise((r) => setTimeout(r, 30));

  await new Promise((resolve) =>
    server.close(resolve)
  );

  Module._load = originalLoad;

  const edgeA1 =
    c.debugLoggerCalls > 0 ? 1 : 0;
  const edgeA2 =
    c.msCalls > 0 ? 1 : 0;
  const pathA =
    edgeA1 && edgeA2 ? 1 : 0;

  const edgeB1 =
    c.onFinishedCalls > 0 ? 1 : 0;
  const edgeB2 =
    c.eeFirstCalls > 0 ? 1 : 0;
  const pathB =
    edgeB1 && edgeB2 ? 1 : 0;

  return {
    condition: condition.id,
    debugSetting:
      condition.debug || "OFF",
    debugColors: condition.colors,
    immediate: condition.immediate,

    statusCode: requestResult.statusCode,

    ...c,

    edgeA1_morgan_debug_active: edgeA1,
    edgeA2_debug_ms_active: edgeA2,
    pathA_joint_active: pathA,

    edgeB1_morgan_onFinished_active:
      edgeB1,
    edgeB2_onFinished_eeFirst_active:
      edgeB2,
    pathB_joint_active: pathB,
  };
}

async function childMain() {
  const encoded = process.argv[3];
  if (!encoded) {
    throw new Error(
      "Missing encoded condition for child mode."
    );
  }

  const condition = JSON.parse(
    Buffer.from(encoded, "base64").toString("utf8")
  );

  const result = await runChild(condition);
  process.stdout.write(
    JSON.stringify(result)
  );
}

function runOne(condition) {
  const encoded = Buffer.from(
    JSON.stringify(condition),
    "utf8"
  ).toString("base64");

  const child = spawnSync(
    process.execPath,
    [
      __filename,
      "--child",
      encoded,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    }
  );

  if (child.error) {
    return {
      condition: condition.id,
      fatalError: child.error.message,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(
      child.stdout || "{}"
    );
  } catch (err) {
    return {
      condition: condition.id,
      fatalError:
        `Could not parse child JSON: ${err.message}`,
      childStdout: child.stdout,
      childStderr: child.stderr,
    };
  }

  if (child.stderr && child.stderr.trim()) {
    parsed.debugStderrObserved = 1;
  } else {
    parsed.debugStderrObserved = 0;
  }

  return parsed;
}

function summarizeGroup(rows) {
  const valid = rows.filter(
    (r) => !r.fatalError
  );

  return {
    trials: valid.length,

    edgeA1Rate: mean(
      valid.map(
        (r) =>
          r.edgeA1_morgan_debug_active
      )
    ),
    edgeA2Rate: mean(
      valid.map(
        (r) =>
          r.edgeA2_debug_ms_active
      )
    ),
    pathAObservedJointRate: mean(
      valid.map(
        (r) =>
          r.pathA_joint_active
      )
    ),

    edgeB1Rate: mean(
      valid.map(
        (r) =>
          r.edgeB1_morgan_onFinished_active
      )
    ),
    edgeB2Rate: mean(
      valid.map(
        (r) =>
          r.edgeB2_onFinished_eeFirst_active
      )
    ),
    pathBObservedJointRate: mean(
      valid.map(
        (r) =>
          r.pathB_joint_active
      )
    ),

    meanMorganWrites: mean(
      valid.map((r) => r.morganWrites)
    ),
  };
}

async function main() {
  ensureDir(OUTDIR);

  const topology = topologyCheck();

  for (const p of Object.values(topology)) {
    if (!p.pathPresentInP3) {
      throw new Error(
        `Required path is not topologically present in P3: ${p.label}`
      );
    }
  }

  const trials = [];

  for (const condition of CONDITIONS) {
    for (let rep = 1; rep <= REPS; rep++) {
      const result = runOne(condition);
      result.repetition = rep;
      trials.push(result);
    }
  }

  const summaries = CONDITIONS.map(
    (condition) => {
      const rows = trials.filter(
        (r) =>
          r.condition === condition.id
      );

      const s = summarizeGroup(rows);

      return {
        condition: condition.id,
        debug:
          condition.debug || "OFF",
        debugColors: condition.colors,
        immediate: condition.immediate,
        ...s,

        pathANaiveMarginalProduct:
          s.edgeA1Rate !== null &&
          s.edgeA2Rate !== null
            ? s.edgeA1Rate * s.edgeA2Rate
            : null,

        pathBNaiveMarginalProduct:
          s.edgeB1Rate !== null &&
          s.edgeB2Rate !== null
            ? s.edgeB1Rate * s.edgeB2Rate
            : null,
      };
    }
  );

  const pooled =
    summarizeGroup(trials);

  const pooledComparisons = {
    pathAObservedJointRate:
      pooled.pathAObservedJointRate,
    pathANaiveProductOfPooledMarginals:
      pooled.edgeA1Rate *
      pooled.edgeA2Rate,
    pathAAbsoluteDifference:
      Math.abs(
        pooled.pathAObservedJointRate -
        pooled.edgeA1Rate *
          pooled.edgeA2Rate
      ),

    pathBObservedJointRate:
      pooled.pathBObservedJointRate,
    pathBNaiveProductOfPooledMarginals:
      pooled.edgeB1Rate *
      pooled.edgeB2Rate,
    pathBAbsoluteDifference:
      Math.abs(
        pooled.pathBObservedJointRate -
        pooled.edgeB1Rate *
          pooled.edgeB2Rate
      ),
  };

  const fatalTrials = trials.filter(
    (r) => r.fatalError
  ).length;

  const output = {
    experiment:
      "Morgan multi-hop joint path activation",
    repetitionsPerCondition: REPS,
    totalTrials: trials.length,
    fatalTrials,
    topology,
    paths: PATHS,
    formalModel: {
      traceLevel:
        "A_P(t) = product_{e in P} A_e(t), because each A_e(t) is binary for one execution trace.",
      probabilityLevel:
        "alpha_P(x) = P(intersection_{e in P}{A_e=1} | x)",
      caution:
        "alpha_P(x) is not generally equal to product_{e in P} alpha_e(x) unless suitable independence assumptions are justified.",
    },
    summaries,
    pooled,
    pooledComparisons,
    trials,
  };

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "morgan-multihop-path-activation.json"
    ),
    JSON.stringify(output, null, 2),
    "utf8"
  );

  const headers = [
    "condition",
    "debug",
    "debugColors",
    "immediate",
    "trials",
    "edgeA1Rate",
    "edgeA2Rate",
    "pathAObservedJointRate",
    "pathANaiveMarginalProduct",
    "edgeB1Rate",
    "edgeB2Rate",
    "pathBObservedJointRate",
    "pathBNaiveMarginalProduct",
    "meanMorganWrites",
  ];

  const csv = [
    headers.join(","),
    ...summaries.map((r) =>
      headers
        .map((h) => csvEscape(r[h]))
        .join(",")
    ),
  ].join("\n");

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "morgan-multihop-path-activation-summary.csv"
    ),
    csv,
    "utf8"
  );

  const report = [];

  report.push(
    "MORGAN MULTI-HOP JOINT PATH ACTIVATION EXPERIMENT"
  );
  report.push(
    "================================================"
  );
  report.push("");

  report.push("VERIFIED P3 PATHS");
  report.push("-----------------");
  report.push(`PA: ${PATHS.PA.label}`);
  report.push(`PB: ${PATHS.PB.label}`);
  report.push("");

  report.push("FORMAL PATH MODEL");
  report.push("-----------------");
  report.push(
    "For one execution trace t with binary edge activations:"
  );
  report.push(
    "  A_P(t) = product_{e in P} A_e(t)"
  );
  report.push("");
  report.push(
    "At the probability level:"
  );
  report.push(
    "  alpha_P(x) = P(all edges in P are active | x)"
  );
  report.push("");
  report.push(
    "Do NOT generally replace this with product_e alpha_e(x) unless independence is justified."
  );
  report.push("");

  report.push("TOPOLOGY CHECK");
  report.push("--------------");
  for (const [id, p] of Object.entries(topology)) {
    report.push(
      `${id}: ${p.pathPresentInP3 ? "PRESENT" : "MISSING"}`
    );
    for (const e of p.edgePresence) {
      report.push(
        `  ${e.source} -> ${e.target}: ${
          e.presentInP3 ? "yes" : "no"
        }`
      );
    }
  }
  report.push("");

  report.push("CONDITION RESULTS");
  report.push("-----------------");

  for (const s of summaries) {
    report.push(s.condition);
    report.push(
      `  DEBUG=${s.debug} DEBUG_COLORS=${s.debugColors} immediate=${s.immediate}`
    );
    report.push(
      `  PA edge1=${fmt(s.edgeA1Rate)} edge2=${fmt(s.edgeA2Rate)} joint alpha_P=${fmt(s.pathAObservedJointRate)} naive-product=${fmt(s.pathANaiveMarginalProduct)}`
    );
    report.push(
      `  PB edge1=${fmt(s.edgeB1Rate)} edge2=${fmt(s.edgeB2Rate)} joint alpha_P=${fmt(s.pathBObservedJointRate)} naive-product=${fmt(s.pathBNaiveMarginalProduct)}`
    );
    report.push(
      `  mean Morgan log writes=${fmt(s.meanMorganWrites)}`
    );
  }

  report.push("");
  report.push("POOLED COMPARISON");
  report.push("-----------------");
  report.push(
    `PA observed joint activation: ${fmt(pooledComparisons.pathAObservedJointRate)}`
  );
  report.push(
    `PA product of pooled edge marginals: ${fmt(pooledComparisons.pathANaiveProductOfPooledMarginals)}`
  );
  report.push(
    `PA absolute difference: ${fmt(pooledComparisons.pathAAbsoluteDifference)}`
  );
  report.push("");
  report.push(
    `PB observed joint activation: ${fmt(pooledComparisons.pathBObservedJointRate)}`
  );
  report.push(
    `PB product of pooled edge marginals: ${fmt(pooledComparisons.pathBNaiveProductOfPooledMarginals)}`
  );
  report.push(
    `PB absolute difference: ${fmt(pooledComparisons.pathBAbsoluteDifference)}`
  );
  report.push("");

  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "This experiment estimates multi-hop path activation directly from joint runtime traces."
  );
  report.push(
    "It distinguishes topological path existence from actual traversal of every edge in the path."
  );
  report.push(
    "The two Morgan paths are intentionally useful because one is configuration-conditioned (debug -> ms) while the other is workload-conditioned (on-finished -> ee-first)."
  );
  report.push(
    "Any equality between joint path activation and a product of marginal edge rates inside a deterministic condition is not evidence of edge independence."
  );
  report.push(
    "The pooled comparison is included to reveal whether naive multiplication can misrepresent joint path activation across heterogeneous contexts."
  );
  report.push(
    `Fatal trials: ${fatalTrials}`
  );

  fs.writeFileSync(
    path.join(
      OUTDIR,
      "morgan-multihop-path-activation-report.txt"
    ),
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log(
    "  results/multihop-path-activation/morgan-multihop-path-activation-report.txt"
  );
  console.log(
    "  results/multihop-path-activation/morgan-multihop-path-activation-summary.csv"
  );
  console.log(
    "  results/multihop-path-activation/morgan-multihop-path-activation.json"
  );
}

if (process.argv[2] === "--child") {
  childMain().catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}
