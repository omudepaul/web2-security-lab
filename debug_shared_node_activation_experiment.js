#!/usr/bin/env node
"use strict";

/*
  debug_shared_node_activation_experiment.js

  Experiment 6: Runtime activation of a shared dependency node.

  Goal
  ----
  Measure which topological parent edges of the shared package debug@4.4.3
  are actually exercised under different application workloads.

  Topological parents already observed:
    body-parser
    express
    finalhandler
    router
    send

  Important:
    express-session uses a separate nested debug@2.6.9 instance and is NOT
    part of the shared debug@4.4.3 node studied here.

  This experiment instruments the in-memory export of the top-level
  debug@4.4.3 package before Express and its parent packages are loaded.
  It does not edit node_modules on disk and does not exploit a vulnerability.

  Outputs:
    results/debug-shared-node/debug-shared-node-report.txt
    results/debug-shared-node/debug-shared-node-results.csv
    results/debug-shared-node/debug-shared-node-results.json
*/

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const TOP_DEBUG_PACKAGE = require.resolve("debug/package.json");
const TOP_DEBUG_VERSION = require("debug/package.json").version;
const TOP_DEBUG_ENTRY = require.resolve("debug");

const NESTED_DEBUG_PACKAGE =
  require.resolve("express-session/node_modules/debug/package.json");
const NESTED_DEBUG_VERSION =
  require("express-session/node_modules/debug/package.json").version;

const EXPECTED_PARENTS = [
  "body-parser",
  "express",
  "finalhandler",
  "router",
  "send",
];

let activeTrial = null;

function normalizeStackLine(line) {
  return String(line || "").replace(/\//g, "\\").toLowerCase();
}

function detectParentFromStack() {
  const stack = new Error().stack
    ? new Error().stack.split("\n").slice(2)
    : [];

  for (const raw of stack) {
    const line = normalizeStackLine(raw);

    if (line.includes("\\node_modules\\body-parser\\")) return "body-parser";
    if (line.includes("\\node_modules\\finalhandler\\")) return "finalhandler";
    if (line.includes("\\node_modules\\router\\")) return "router";
    if (line.includes("\\node_modules\\send\\")) return "send";
    if (line.includes("\\node_modules\\express\\")) return "express";
  }

  return "unknown";
}

function recordDebugInvocation(namespace) {
  if (!activeTrial) return;

  const parent = detectParentFromStack();

  activeTrial.totalDebugInvocations += 1;
  activeTrial.parents[parent] =
    (activeTrial.parents[parent] || 0) + 1;
  activeTrial.namespaces[namespace] =
    (activeTrial.namespaces[namespace] || 0) + 1;

  const key = `${parent}::${namespace}`;
  activeTrial.parentNamespaces[key] =
    (activeTrial.parentNamespaces[key] || 0) + 1;
}

// Load the real top-level debug@4.4.3 once, then replace only its in-memory
// export with an instrumented factory. The nested debug@2.6.9 remains intact.
const originalDebugFactory = require("debug");

const instrumentedDebugFactory = new Proxy(originalDebugFactory, {
  apply(target, thisArg, args) {
    const namespace = String(args[0] || "");
    const realLogger = Reflect.apply(target, thisArg, args);

    return new Proxy(realLogger, {
      apply(loggerTarget, loggerThis, loggerArgs) {
        recordDebugInvocation(namespace);
        return Reflect.apply(loggerTarget, loggerThis, loggerArgs);
      },
    });
  },
});

require.cache[TOP_DEBUG_ENTRY].exports = instrumentedDebugFactory;

// Load application packages only after the shared debug node is instrumented.
const express = require("express");
const bodyParser = require("body-parser");

const app = express();

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "debug-shared-node-")
);
const sampleFile = path.join(tempDir, "sample.txt");
fs.writeFileSync(
  sampleFile,
  "shared-debug-runtime-activation-fixture\n",
  "utf8"
);

// Workload 1: normal router/application path.
app.get("/basic", (req, res) => {
  res.json({ ok: true, workload: "BASIC_ROUTE" });
});

// Workload 2: body-parser + router.
app.post(
  "/form",
  bodyParser.urlencoded({ extended: true }),
  (req, res) => {
    res.json({
      ok: true,
      workload: "FORM_BODY",
      probe: req.body && req.body.probe,
    });
  }
);

// Workload 3: static serving, which should exercise send if the current
// package implementation uses it on this path.
app.use("/static", express.static(tempDir));

// Workload 4: controlled thrown error; no custom error handler is installed,
// so Express/finalhandler can process it.
app.get("/boom", (req, res, next) => {
  next(new Error("CONTROLLED_TEST_ERROR"));
});

// Workload 5 is an unmatched route: /does-not-exist

function request({
  port,
  method = "GET",
  route,
  body = "",
  contentType = null,
}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: route,
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            bytes: Buffer.byteLength(data),
          });
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(fileName, rows) {
  const headers = [
    "trialId",
    "workload",
    "statusCode",
    "responseBytes",
    "totalDebugInvocations",
    "body-parser",
    "express",
    "finalhandler",
    "router",
    "send",
    "unknown",
    "namespaces",
  ];

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) =>
      headers
        .map((h) => {
          if (EXPECTED_PARENTS.includes(h) || h === "unknown") {
            return csvEscape(r.parents[h] || 0);
          }
          return csvEscape(r[h]);
        })
        .join(",")
    ),
  ];

  fs.writeFileSync(fileName, lines.join("\n"), "utf8");
}

function summarizeWorkload(rows, workload) {
  const subset = rows.filter((r) => r.workload === workload);

  const parentSummary = {};

  for (const parent of [...EXPECTED_PARENTS, "unknown"]) {
    const activatedTrials = subset.filter(
      (r) => (r.parents[parent] || 0) > 0
    ).length;

    const invocationCount = subset.reduce(
      (sum, r) => sum + (r.parents[parent] || 0),
      0
    );

    parentSummary[parent] = {
      activatedTrials,
      trials: subset.length,
      activationRate:
        subset.length === 0
          ? 0
          : activatedTrials / subset.length,
      invocationCount,
    };
  }

  const namespaceCounts = {};
  for (const r of subset) {
    for (const [ns, count] of Object.entries(r.namespaces)) {
      namespaceCounts[ns] =
        (namespaceCounts[ns] || 0) + count;
    }
  }

  return {
    workload,
    trials: subset.length,
    statusCodes: subset.reduce((acc, r) => {
      acc[r.statusCode] = (acc[r.statusCode] || 0) + 1;
      return acc;
    }, {}),
    totalDebugInvocations: subset.reduce(
      (sum, r) => sum + r.totalDebugInvocations,
      0
    ),
    parents: parentSummary,
    namespaces: Object.entries(namespaceCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([namespace, count]) => ({ namespace, count })),
  };
}

async function main() {
  const outputDir = path.join(
    process.cwd(),
    "results",
    "debug-shared-node"
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) =>
    server.once("listening", resolve)
  );

  const port = server.address().port;

  const workloads = [
    {
      name: "BASIC_ROUTE",
      method: "GET",
      route: "/basic",
    },
    {
      name: "FORM_BODY",
      method: "POST",
      route: "/form",
      body: "probe=healthy",
      contentType: "application/x-www-form-urlencoded",
    },
    {
      name: "STATIC_FILE",
      method: "GET",
      route: "/static/sample.txt",
    },
    {
      name: "MISSING_ROUTE",
      method: "GET",
      route: "/does-not-exist",
    },
    {
      name: "ERROR_ROUTE",
      method: "GET",
      route: "/boom",
    },
  ];

  const repetitionsPerWorkload = 20;
  const rows = [];
  let trialId = 0;

  console.log("DEBUG@4.4.3 SHARED-NODE RUNTIME ACTIVATION EXPERIMENT");
  console.log("====================================================");
  console.log(`Top-level debug: ${TOP_DEBUG_VERSION}`);
  console.log(`Resolved path: ${TOP_DEBUG_PACKAGE}`);
  console.log(`Nested express-session debug: ${NESTED_DEBUG_VERSION}`);
  console.log(`Nested path: ${NESTED_DEBUG_PACKAGE}`);
  console.log(`Local server port: ${port}`);
  console.log(
    `Repetitions per workload: ${repetitionsPerWorkload}`
  );
  console.log("");

  for (const workload of workloads) {
    for (let rep = 1; rep <= repetitionsPerWorkload; rep++) {
      trialId += 1;

      activeTrial = {
        trialId,
        workload: workload.name,
        totalDebugInvocations: 0,
        parents: {},
        namespaces: {},
        parentNamespaces: {},
      };

      const result = await request({
        port,
        method: workload.method,
        route: workload.route,
        body: workload.body || "",
        contentType: workload.contentType || null,
      });

      rows.push({
        trialId,
        workload: workload.name,
        statusCode: result.statusCode,
        responseBytes: result.bytes,
        totalDebugInvocations:
          activeTrial.totalDebugInvocations,
        parents: activeTrial.parents,
        namespaces: activeTrial.namespaces,
        parentNamespaces: activeTrial.parentNamespaces,
      });

      activeTrial = null;
    }
  }

  await new Promise((resolve) => server.close(resolve));

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  const summaries = workloads.map((w) =>
    summarizeWorkload(rows, w.name)
  );

  const observedParents = EXPECTED_PARENTS.filter((parent) =>
    rows.some((r) => (r.parents[parent] || 0) > 0)
  );

  const unobservedParents = EXPECTED_PARENTS.filter(
    (parent) => !observedParents.includes(parent)
  );

  const runtimeEdgeCoverage =
    observedParents.length / EXPECTED_PARENTS.length;

  const output = {
    purpose:
      "Measure workload-conditioned runtime activation of topological parent edges for the shared dependency debug@4.4.3.",
    topology: {
      sharedNode: "debug@4.4.3",
      expectedParents: EXPECTED_PARENTS,
      topologicalParentCount: EXPECTED_PARENTS.length,
      observedRuntimeParents: observedParents,
      unobservedRuntimeParents: unobservedParents,
      runtimeEdgeCoverage,
    },
    resolution: {
      topLevelDebugVersion: TOP_DEBUG_VERSION,
      topLevelDebugPackagePath: TOP_DEBUG_PACKAGE,
      nestedExpressSessionDebugVersion:
        NESTED_DEBUG_VERSION,
      nestedExpressSessionDebugPackagePath:
        NESTED_DEBUG_PACKAGE,
      nestedInstanceExcludedFromSharedNodeStudy: true,
    },
    configuration: {
      repetitionsPerWorkload,
      totalTrials: rows.length,
      workloads: workloads.map((w) => w.name),
    },
    summaries,
    trials: rows,
  };

  const jsonPath = path.join(
    outputDir,
    "debug-shared-node-results.json"
  );
  const csvPath = path.join(
    outputDir,
    "debug-shared-node-results.csv"
  );
  const reportPath = path.join(
    outputDir,
    "debug-shared-node-report.txt"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  writeCsv(csvPath, rows);

  const report = [];

  report.push("DEBUG@4.4.3 SHARED-NODE RUNTIME ACTIVATION REPORT");
  report.push("================================================");
  report.push("");
  report.push("Resolved package instances:");
  report.push(
    `  shared node: debug@${TOP_DEBUG_VERSION}`
  );
  report.push(`  path: ${TOP_DEBUG_PACKAGE}`);
  report.push(
    `  separate nested instance: debug@${NESTED_DEBUG_VERSION}`
  );
  report.push(`  path: ${NESTED_DEBUG_PACKAGE}`);
  report.push("");
  report.push("Topological parents of debug@4.4.3:");
  for (const p of EXPECTED_PARENTS) {
    report.push(`  - ${p}`);
  }
  report.push("");
  report.push(`Total trials: ${rows.length}`);
  report.push(
    `Repetitions per workload: ${repetitionsPerWorkload}`
  );
  report.push(
    `Observed runtime parents: ${observedParents.length}/${EXPECTED_PARENTS.length}`
  );
  report.push(
    `Runtime parent-edge coverage: ${runtimeEdgeCoverage.toFixed(4)}`
  );
  report.push("");
  report.push("WORKLOAD-CONDITIONED PARENT ACTIVATION");
  report.push("--------------------------------------");

  for (const summary of summaries) {
    report.push("");
    report.push(
      `${summary.workload}: total debug invocations=${summary.totalDebugInvocations}`
    );
    report.push(
      `  HTTP statuses: ${JSON.stringify(summary.statusCodes)}`
    );

    for (const parent of EXPECTED_PARENTS) {
      const s = summary.parents[parent];
      report.push(
        `  ${parent.padEnd(12)} activated=${String(
          s.activatedTrials
        ).padStart(2)}/${String(s.trials).padEnd(2)} ` +
          `rate=${s.activationRate.toFixed(4)} ` +
          `invocations=${s.invocationCount}`
      );
    }

    if (summary.parents.unknown.invocationCount > 0) {
      const u = summary.parents.unknown;
      report.push(
        `  ${"unknown".padEnd(12)} activated=${String(
          u.activatedTrials
        ).padStart(2)}/${String(u.trials).padEnd(2)} ` +
          `rate=${u.activationRate.toFixed(4)} ` +
          `invocations=${u.invocationCount}`
      );
    }

    if (summary.namespaces.length > 0) {
      report.push(
        "  top namespaces: " +
          summary.namespaces
            .slice(0, 8)
            .map((x) => `${x.namespace}(${x.count})`)
            .join(", ")
      );
    }
  }

  report.push("");
  report.push("OBSERVED VS TOPOLOGICAL EDGES");
  report.push("-----------------------------");
  report.push(
    `Observed parents: ${
      observedParents.length
        ? observedParents.join(", ")
        : "none"
    }`
  );
  report.push(
    `Not observed in these workloads: ${
      unobservedParents.length
        ? unobservedParents.join(", ")
        : "none"
    }`
  );
  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "A topological dependency edge indicates potential exposure, but"
  );
  report.push(
    "runtime activation is workload-dependent. An unobserved parent edge"
  );
  report.push(
    "in this experiment is not proof that the edge can never be active;"
  );
  report.push(
    "it means these defined workloads did not exercise it."
  );
  report.push(
    "The nested debug@2.6.9 used by express-session is a distinct package"
  );
  report.push(
    "instance and is intentionally excluded from the debug@4.4.3 shared-node"
  );
  report.push(
    "measurements."
  );

  fs.writeFileSync(
    reportPath,
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log(
    "  results\\debug-shared-node\\debug-shared-node-report.txt"
  );
  console.log(
    "  results\\debug-shared-node\\debug-shared-node-results.csv"
  );
  console.log(
    "  results\\debug-shared-node\\debug-shared-node-results.json"
  );
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  process.exit(1);
});
