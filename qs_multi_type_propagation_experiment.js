#!/usr/bin/env node
"use strict";

/*
  qs_multi_type_propagation_experiment.js

  Safe local experiment for measuring multiple dependency-impact types.

  Real dependency paths:
    W1: research-app -> express -> qs
    W2: research-app -> express -> body-parser -> qs

  Synthetic perturbations:
    CORRUPTION : changes probe=healthy to probe=corrupted
    EXCEPTION  : throws a controlled error inside qs.parse()
    DELAY      : injects a controlled 100 ms delay
    MALFORMED  : removes the expected "probe" field

  This does NOT exploit a real vulnerability and does NOT modify node_modules.

  Outputs:
    results/propagation-multitype/qs-multitype-report.txt
    results/propagation-multitype/qs-multitype-results.csv
    results/propagation-multitype/qs-multitype-results.json
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const { performance } = require("perf_hooks");

const qs = require("qs");
const originalQsParse = qs.parse;

let experimentMode = "BASELINE";
let activeTrial = null;

const INJECTED_DELAY_MS = 100;
const LATENCY_IMPACT_THRESHOLD_MS = 75;

function controlledSleep(ms) {
  // Safe synchronous local delay; no network or external target is involved.
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

qs.parse = function patchedParse(input, options) {
  if (activeTrial) {
    activeTrial.qsParseInvoked = true;
  }

  const normallyParsed = originalQsParse.call(this, input, options);

  const triggerPresent =
    normallyParsed &&
    (String(normallyParsed.trigger || "") === "1" ||
      String(normallyParsed.trigger || "").toLowerCase() === "true");

  if (!triggerPresent || experimentMode === "BASELINE") {
    return normallyParsed;
  }

  if (activeTrial) {
    activeTrial.syntheticPerturbationActivated = true;
  }

  switch (experimentMode) {
    case "CORRUPTION":
      if (
        normallyParsed &&
        Object.prototype.hasOwnProperty.call(normallyParsed, "probe")
      ) {
        normallyParsed.probe = "corrupted";
      }
      return normallyParsed;

    case "EXCEPTION":
      throw new Error("SYNTHETIC_QS_EXCEPTION");

    case "DELAY":
      controlledSleep(INJECTED_DELAY_MS);
      return normallyParsed;

    case "MALFORMED":
      if (normallyParsed) {
        delete normallyParsed.probe;
        normallyParsed.syntheticMalformed = true;
      }
      return normallyParsed;

    default:
      return normallyParsed;
  }
};

// Patch qs before Express/body-parser are loaded.
const express = require("express");
const app = express();

// W1: research-app -> express -> qs
app.set("query parser", (str) => qs.parse(str));

// W2: research-app -> express -> body-parser -> qs
app.use(express.urlencoded({ extended: true }));

function inspectParentValue(container) {
  const hasProbe =
    container &&
    Object.prototype.hasOwnProperty.call(container, "probe");

  const probe = hasProbe ? container.probe : undefined;
  const schemaValid = hasProbe && typeof probe === "string";
  const integrityImpact = schemaValid && probe !== "healthy";
  const malformedImpact = !schemaValid;

  if (activeTrial) {
    activeTrial.parentObservedProbe =
      probe === undefined ? null : probe;
    activeTrial.parentSchemaValid = Boolean(schemaValid);
    activeTrial.parentIntegrityImpact = Boolean(integrityImpact);
    activeTrial.parentMalformedImpact = Boolean(malformedImpact);
  }

  return {
    probe: probe === undefined ? null : probe,
    schemaValid,
    integrityImpact,
    malformedImpact,
  };
}

app.get("/query", (req, res) => {
  const observation = inspectParentValue(req.query);

  res.json({
    path: "query",
    probe: observation.probe,
    schemaValid: observation.schemaValid,
    integrityImpact: observation.integrityImpact,
    malformedImpact: observation.malformedImpact,
  });
});

app.post("/form", (req, res) => {
  const observation = inspectParentValue(req.body);

  res.json({
    path: "body",
    probe: observation.probe,
    schemaValid: observation.schemaValid,
    integrityImpact: observation.integrityImpact,
    malformedImpact: observation.malformedImpact,
  });
});

// Controlled error handler for the EXCEPTION perturbation.
app.use((err, req, res, next) => {
  if (activeTrial) {
    activeTrial.serverExceptionObserved = true;
  }

  res.status(500).json({
    error: "controlled_dependency_exception",
    message:
      err && err.message === "SYNTHETIC_QS_EXCEPTION"
        ? err.message
        : "controlled_server_error",
  });
});

function requestJson({ port, method, route, body }) {
  return new Promise((resolve, reject) => {
    const payload = body || "";
    const start = performance.now();

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
          const elapsedMs = performance.now() - start;

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }

          resolve({
            statusCode: res.statusCode,
            response: parsed,
            responseMs: elapsedMs,
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
    "httpStatus",
    "responseMs",
    "availabilityImpact",
    "integrityImpact",
    "latencyImpact",
    "malformedImpact",
    "anyImpact",
    "parentObservedProbe",
    "parentSchemaValid",
    "serverExceptionObserved",
  ];

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) =>
      headers.map((h) => csvEscape(r[h])).join(",")
    ),
  ];

  fs.writeFileSync(fileName, lines.join("\n"), "utf8");
}

function fraction(n, d) {
  return d ? n / d : null;
}

function targetDimension(mode) {
  switch (mode) {
    case "CORRUPTION":
      return "integrityImpact";
    case "EXCEPTION":
      return "availabilityImpact";
    case "DELAY":
      return "latencyImpact";
    case "MALFORMED":
      return "malformedImpact";
    default:
      return "anyImpact";
  }
}

function summarize(rows, mode, pathType, workload) {
  const subset = rows.filter(
    (r) =>
      r.mode === mode &&
      r.path === pathType &&
      r.workload === workload
  );

  const dimension = targetDimension(mode);
  const impacted = subset.filter((r) => Boolean(r[dimension])).length;
  const activated = subset.filter(
    (r) => r.syntheticPerturbationActivated
  ).length;

  const avgResponseMs =
    subset.length === 0
      ? null
      : subset.reduce((sum, r) => sum + r.responseMs, 0) /
        subset.length;

  return {
    mode,
    path: pathType,
    workload,
    targetDimension: dimension,
    runs: subset.length,
    perturbationActivatedRuns: activated,
    impactedRuns: impacted,
    qHat: fraction(impacted, subset.length),
    averageResponseMs: avgResponseMs,
  };
}

async function main() {
  const outputDir = path.join(
    process.cwd(),
    "results",
    "propagation-multitype"
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) =>
    server.once("listening", resolve)
  );

  const port = server.address().port;

  const rows = [];
  let trialCounter = 0;

  const modes = [
    "BASELINE",
    "CORRUPTION",
    "EXCEPTION",
    "DELAY",
    "MALFORMED",
  ];

  const paths = ["query", "body"];

  const workloads = [
    { name: "BENIGN", trigger: false },
    { name: "TRIGGERED", trigger: true },
  ];

  const repetitionsPerCell = 15;

  console.log("QS MULTI-TYPE DEPENDENCY PROPAGATION EXPERIMENT");
  console.log("===============================================");
  console.log(`Local test server port: ${port}`);
  console.log(`Repetitions per cell: ${repetitionsPerCell}`);
  console.log(`Injected delay: ${INJECTED_DELAY_MS} ms`);
  console.log(
    `Latency impact threshold: ${LATENCY_IMPACT_THRESHOLD_MS} ms`
  );
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
            parentSchemaValid: null,
            parentIntegrityImpact: false,
            parentMalformedImpact: false,
            serverExceptionObserved: false,
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

          const availabilityImpact =
            result.statusCode >= 500;

          const integrityImpact = Boolean(
            result.response &&
              result.response.integrityImpact
          );

          const malformedImpact = Boolean(
            result.response &&
              result.response.malformedImpact
          );

          const latencyImpact =
            result.responseMs >= LATENCY_IMPACT_THRESHOLD_MS;

          const anyImpact =
            availabilityImpact ||
            integrityImpact ||
            malformedImpact ||
            latencyImpact;

          rows.push({
            ...activeTrial,
            httpStatus: result.statusCode,
            responseMs: Number(result.responseMs.toFixed(3)),
            availabilityImpact,
            integrityImpact,
            latencyImpact,
            malformedImpact,
            anyImpact,
          });

          activeTrial = null;
        }
      }
    }
  }

  await new Promise((resolve) => server.close(resolve));
  qs.parse = originalQsParse;

  const summaries = [];

  for (const mode of modes) {
    for (const pathType of paths) {
      for (const workload of ["BENIGN", "TRIGGERED"]) {
        summaries.push(
          summarize(rows, mode, pathType, workload)
        );
      }
    }
  }

  const baselineRows = rows.filter(
    (r) => r.mode === "BASELINE"
  );

  const baselineAnyImpacts = baselineRows.filter(
    (r) => r.anyImpact
  ).length;

  const output = {
    model: {
      dependencyDirection: "parent -> dependency",
      impactDirection: "dependency -> parent/application",
      estimator:
        "q_hat^(s,W) = impacted runs / total runs for perturbation s and workload W",
      safety:
        "Synthetic local perturbations only; no real vulnerability exploitation and no on-disk node_modules modification.",
    },
    dimensions: {
      CORRUPTION: "integrity",
      EXCEPTION: "availability",
      DELAY: "latency",
      MALFORMED: "schema/integrity",
    },
    configuration: {
      repetitionsPerCell,
      totalTrials: rows.length,
      injectedDelayMs: INJECTED_DELAY_MS,
      latencyImpactThresholdMs:
        LATENCY_IMPACT_THRESHOLD_MS,
      paths: {
        query: "research-app -> express -> qs",
        body:
          "research-app -> express -> body-parser -> qs",
      },
    },
    validation: {
      baselineAnyImpactCount: baselineAnyImpacts,
      baselineShouldBeZero:
        baselineAnyImpacts === 0,
    },
    summaries,
    trials: rows,
  };

  const jsonPath = path.join(
    outputDir,
    "qs-multitype-results.json"
  );
  const csvPath = path.join(
    outputDir,
    "qs-multitype-results.csv"
  );
  const reportPath = path.join(
    outputDir,
    "qs-multitype-report.txt"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  writeCsv(csvPath, rows);

  const report = [];

  report.push("QS MULTI-TYPE DEPENDENCY PROPAGATION REPORT");
  report.push("===========================================");
  report.push("");
  report.push("Controlled paths:");
  report.push("  W1: research-app -> express -> qs");
  report.push(
    "  W2: research-app -> express -> body-parser -> qs"
  );
  report.push("");
  report.push("Synthetic perturbations:");
  report.push(
    "  CORRUPTION : probe=healthy becomes probe=corrupted"
  );
  report.push(
    "  EXCEPTION  : controlled exception inside qs.parse()"
  );
  report.push(
    `  DELAY      : controlled ${INJECTED_DELAY_MS} ms parsing delay`
  );
  report.push(
    "  MALFORMED  : expected probe field is removed"
  );
  report.push("");
  report.push(`Total trials: ${rows.length}`);
  report.push(
    `Baseline runs with any measured impact: ${baselineAnyImpacts}`
  );
  report.push("");
  report.push("TRIGGERED WORKLOAD PROPAGATION ESTIMATES");
  report.push("----------------------------------------");

  for (const mode of [
    "CORRUPTION",
    "EXCEPTION",
    "DELAY",
    "MALFORMED",
  ]) {
    for (const pathType of paths) {
      const s = summaries.find(
        (x) =>
          x.mode === mode &&
          x.path === pathType &&
          x.workload === "TRIGGERED"
      );

      report.push(
        `${mode.padEnd(10)} | ${pathType.padEnd(5)} | ` +
          `${s.targetDimension} | impacted=${s.impactedRuns}/${s.runs} | ` +
          `q_hat=${s.qHat.toFixed(4)} | ` +
          `avg_ms=${s.averageResponseMs.toFixed(3)}`
      );
    }
  }

  report.push("");
  report.push("BENIGN WORKLOAD CONTROL");
  report.push("-----------------------");

  for (const mode of [
    "CORRUPTION",
    "EXCEPTION",
    "DELAY",
    "MALFORMED",
  ]) {
    for (const pathType of paths) {
      const s = summaries.find(
        (x) =>
          x.mode === mode &&
          x.path === pathType &&
          x.workload === "BENIGN"
      );

      report.push(
        `${mode.padEnd(10)} | ${pathType.padEnd(5)} | ` +
          `${s.targetDimension} | impacted=${s.impactedRuns}/${s.runs} | ` +
          `q_hat=${s.qHat.toFixed(4)} | ` +
          `avg_ms=${s.averageResponseMs.toFixed(3)}`
      );
    }
  }

  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push(
    "Each q_hat is conditioned on a specific synthetic perturbation,"
  );
  report.push(
    "dependency path, workload, and measurement definition."
  );
  report.push(
    "These values validate propagation behavior in this controlled"
  );
  report.push(
    "environment; they are not universal compromise probabilities."
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
    "  results\\propagation-multitype\\qs-multitype-report.txt"
  );
  console.log(
    "  results\\propagation-multitype\\qs-multitype-results.csv"
  );
  console.log(
    "  results\\propagation-multitype\\qs-multitype-results.json"
  );
}

main().catch((err) => {
  qs.parse = originalQsParse;
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
