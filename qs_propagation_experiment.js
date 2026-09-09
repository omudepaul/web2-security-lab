#!/usr/bin/env node
"use strict";

/*
  qs_propagation_experiment.js

  Safe local dependency-propagation experiment.

  Goal:
    Estimate workload-conditioned propagation from qs -> parent -> research-app
    using a synthetic, reversible perturbation. This does NOT exploit a real
    vulnerability and does NOT modify node_modules on disk.

  Paths tested:
    W1: research-app -> express -> qs
        (query-string parsing via an explicit qs-backed query parser)

    W2: research-app -> express -> body-parser -> qs
        (URL-encoded body parsing with extended:true)

  Synthetic perturbation:
    When experiment mode is PERTURBED and input contains trigger=1,
    qs.parse() changes probe=healthy to probe=corrupted.

  Interpretation:
    q_hat(W) = impacted runs / perturbed runs under workload W

  Outputs:
    results/propagation/qs-propagation-results.json
    results/propagation/qs-propagation-results.csv
    results/propagation/qs-propagation-report.txt
*/

const fs = require("fs");
const path = require("path");
const http = require("http");

const qs = require("qs");

// IMPORTANT: patch qs BEFORE loading Express/body-parser.
const originalQsParse = qs.parse;

let experimentMode = "BASELINE";
let activeTrial = null;

qs.parse = function patchedParse(input, options) {
  const parsed = originalQsParse.call(this, input, options);

  if (activeTrial) {
    activeTrial.qsParseInvoked = true;
  }

  const triggerPresent =
    parsed &&
    (String(parsed.trigger || "") === "1" ||
      String(parsed.trigger || "").toLowerCase() === "true");

  if (
    experimentMode === "PERTURBED" &&
    triggerPresent &&
    parsed &&
    Object.prototype.hasOwnProperty.call(parsed, "probe")
  ) {
    if (activeTrial) {
      activeTrial.syntheticPerturbationActivated = true;
    }

    parsed.probe = "corrupted";
  }

  return parsed;
};

const express = require("express");

const app = express();

// W1: Explicitly make Express query parsing use qs so this path is controlled.
app.set("query parser", (str) => qs.parse(str));

// W2: Express -> body-parser -> qs.
app.use(express.urlencoded({ extended: true }));

function recordParentObservation(req, pathType) {
  let observedProbe = null;

  if (pathType === "query") {
    observedProbe = req.query ? req.query.probe : null;
  } else if (pathType === "body") {
    observedProbe = req.body ? req.body.probe : null;
  }

  if (activeTrial) {
    activeTrial.parentObservedProbe = observedProbe;
    activeTrial.parentImpact =
      observedProbe !== null &&
      observedProbe !== undefined &&
      String(observedProbe) !== "healthy";
  }

  return observedProbe;
}

app.get("/query", (req, res) => {
  const probe = recordParentObservation(req, "query");

  res.json({
    path: "query",
    probe,
    expected: "healthy",
    appImpact: String(probe) !== "healthy",
  });
});

app.post("/form", (req, res) => {
  const probe = recordParentObservation(req, "body");

  res.json({
    path: "body",
    probe,
    expected: "healthy",
    appImpact: String(probe) !== "healthy",
  });
});

function requestJson({ port, method, route, body }) {
  return new Promise((resolve, reject) => {
    const payload = body || "";

    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: route,
        method,
        headers:
          method === "POST"
            ? {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {},
      },
      (res) => {
        let data = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }

          resolve({
            statusCode: res.statusCode,
            response: parsed,
          });
        });
      }
    );

    req.on("error", reject);

    if (method === "POST") {
      req.write(payload);
    }

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
    "mode",
    "path",
    "workload",
    "trigger",
    "qsParseInvoked",
    "syntheticPerturbationActivated",
    "parentObservedProbe",
    "parentImpact",
    "appObservedProbe",
    "appImpact",
    "httpStatus",
  ];

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];

  fs.writeFileSync(fileName, lines.join("\n"), "utf8");
}

function fraction(n, d) {
  return d ? n / d : null;
}

function summarize(rows, pathType, workload) {
  const subset = rows.filter(
    (r) =>
      r.mode === "PERTURBED" &&
      r.path === pathType &&
      r.workload === workload
  );

  const impacted = subset.filter((r) => r.appImpact).length;
  const activated = subset.filter(
    (r) => r.syntheticPerturbationActivated
  ).length;

  return {
    path: pathType,
    workload,
    perturbedRuns: subset.length,
    perturbationActivatedRuns: activated,
    impactedRuns: impacted,
    qHat: fraction(impacted, subset.length),
  };
}

async function main() {
  const outputDir = path.join(
    process.cwd(),
    "results",
    "propagation"
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => server.once("listening", resolve));

  const address = server.address();
  const port = address.port;

  const rows = [];
  let trialCounter = 0;

  const modes = ["BASELINE", "PERTURBED"];
  const paths = ["query", "body"];
  const workloads = [
    { name: "BENIGN", trigger: false },
    { name: "TRIGGERED", trigger: true },
  ];

  const repetitionsPerCell = 15;

  console.log("QS DEPENDENCY PROPAGATION EXPERIMENT");
  console.log("====================================");
  console.log(`Local test server port: ${port}`);
  console.log(`Repetitions per mode/path/workload cell: ${repetitionsPerCell}`);
  console.log("");

  for (const mode of modes) {
    experimentMode = mode;

    for (const pathType of paths) {
      for (const workload of workloads) {
        for (let rep = 1; rep <= repetitionsPerCell; rep++) {
          trialCounter += 1;

          activeTrial = {
            trialId: trialCounter,
            mode,
            path: pathType,
            workload: workload.name,
            trigger: workload.trigger,
            qsParseInvoked: false,
            syntheticPerturbationActivated: false,
            parentObservedProbe: null,
            parentImpact: false,
          };

          const params = workload.trigger
            ? "probe=healthy&trigger=1"
            : "probe=healthy&trigger=0";

          let result;

          if (pathType === "query") {
            result = await requestJson({
              port,
              method: "GET",
              route: `/query?${params}`,
            });
          } else {
            result = await requestJson({
              port,
              method: "POST",
              route: "/form",
              body: params,
            });
          }

          const row = {
            ...activeTrial,
            appObservedProbe:
              result.response && result.response.probe !== undefined
                ? result.response.probe
                : null,
            appImpact:
              Boolean(result.response && result.response.appImpact),
            httpStatus: result.statusCode,
          };

          rows.push(row);
          activeTrial = null;
        }
      }
    }
  }

  server.close();
  qs.parse = originalQsParse;

  const summaries = [
    summarize(rows, "query", "BENIGN"),
    summarize(rows, "query", "TRIGGERED"),
    summarize(rows, "body", "BENIGN"),
    summarize(rows, "body", "TRIGGERED"),
  ];

  const baselineImpacts = rows.filter(
    (r) => r.mode === "BASELINE" && r.appImpact
  ).length;

  const output = {
    model: {
      dependencyDirection: "parent -> dependency",
      impactDirection: "dependency -> parent/application",
      estimator:
        "q_hat(W) = impacted perturbed runs / total perturbed runs under workload W",
      syntheticPerturbation:
        "When mode=PERTURBED and trigger=1, qs.parse changes probe=healthy to probe=corrupted.",
      safety:
        "No real vulnerability is exploited. node_modules is not modified on disk.",
    },
    configuration: {
      repetitionsPerCell,
      totalTrials: rows.length,
      paths: {
        query: "research-app -> express -> qs",
        body: "research-app -> express -> body-parser -> qs",
      },
    },
    validation: {
      baselineImpactCount: baselineImpacts,
      baselineShouldBeZero: baselineImpacts === 0,
    },
    summaries,
    trials: rows,
  };

  const jsonPath = path.join(
    outputDir,
    "qs-propagation-results.json"
  );
  const csvPath = path.join(
    outputDir,
    "qs-propagation-results.csv"
  );
  const reportPath = path.join(
    outputDir,
    "qs-propagation-report.txt"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  writeCsv(csvPath, rows);

  const report = [];

  report.push("QS DEPENDENCY PROPAGATION REPORT");
  report.push("================================");
  report.push("");
  report.push("Controlled paths:");
  report.push("  W1: research-app -> express -> qs");
  report.push("  W2: research-app -> express -> body-parser -> qs");
  report.push("");
  report.push(
    "Synthetic perturbation: in PERTURBED mode only, qs.parse changes"
  );
  report.push(
    "probe=healthy to probe=corrupted when trigger=1."
  );
  report.push("");
  report.push(
    `Total trials: ${rows.length}`
  );
  report.push(
    `Baseline downstream impacts: ${baselineImpacts}`
  );
  report.push("");
  report.push("ESTIMATED PROPAGATION");
  report.push("---------------------");

  for (const s of summaries) {
    report.push(
      `${s.path} / ${s.workload}: impacted=${s.impactedRuns}/${s.perturbedRuns}, q_hat=${s.qHat === null ? "NA" : s.qHat.toFixed(4)}`
    );
  }

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "q_hat is workload-conditioned experimental propagation, not a universal"
  );
  report.push(
    "probability and not a real-world compromise probability."
  );
  report.push(
    "A value near 1 for TRIGGERED workloads means the synthetic dependency"
  );
  report.push(
    "perturbation consistently reaches the observed parent/application layer."
  );

  fs.writeFileSync(
    reportPath,
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log("  results\\propagation\\qs-propagation-results.json");
  console.log("  results\\propagation\\qs-propagation-results.csv");
  console.log("  results\\propagation\\qs-propagation-report.txt");
}

main().catch((err) => {
  qs.parse = originalQsParse;
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
