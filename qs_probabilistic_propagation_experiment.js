#!/usr/bin/env node
"use strict";

/* Experiment 3: reproducible probabilistic propagation calibration. */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { performance } = require("perf_hooks");
const qs = require("qs");

const originalQsParse = qs.parse;
let activeConfig = null;
let activeTrial = null;
const DELAY_MS = 50;
const LATENCY_THRESHOLD_MS = 25;
const REPS = 50;

// Seeded xorshift32 for reproducibility.
let rngState = 0x5eeda11;
function rand() {
  let x = rngState | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rngState = x | 0;
  return (x >>> 0) / 4294967296;
}

function sleep(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

qs.parse = function patchedParse(input, options) {
  const parsed = originalQsParse.call(this, input, options);
  if (activeTrial) activeTrial.qsParseInvoked = true;

  const trigger = parsed && String(parsed.trigger || "") === "1";
  if (!activeConfig || !trigger) return parsed;

  if (activeTrial) activeTrial.triggerObserved = true;

  const draw = rand();
  const contained = draw < activeConfig.containmentProbability;
  if (activeTrial) {
    activeTrial.containmentDraw = draw;
    activeTrial.contained = contained;
  }

  if (contained) {
    if (activeTrial) activeTrial.syntheticPerturbationActivated = false;
    return parsed;
  }

  if (activeTrial) activeTrial.syntheticPerturbationActivated = true;

  switch (activeConfig.perturbation) {
    case "CORRUPTION":
      if (Object.prototype.hasOwnProperty.call(parsed, "probe")) parsed.probe = "corrupted";
      return parsed;
    case "EXCEPTION":
      throw new Error("SYNTHETIC_QS_EXCEPTION");
    case "DELAY":
      sleep(DELAY_MS);
      return parsed;
    case "MALFORMED":
      delete parsed.probe;
      parsed.syntheticMalformed = true;
      return parsed;
    default:
      return parsed;
  }
};

// Patch qs before loading Express/body-parser.
const express = require("express");
const app = express();
app.set("query parser", (str) => qs.parse(str));
app.use(express.urlencoded({ extended: true }));

function observe(container) {
  const hasProbe = container && Object.prototype.hasOwnProperty.call(container, "probe");
  const probe = hasProbe ? container.probe : undefined;
  const schemaValid = hasProbe && typeof probe === "string";
  return {
    probe: probe === undefined ? null : probe,
    integrityImpact: schemaValid && probe !== "healthy",
    malformedImpact: !schemaValid,
  };
}

app.get("/query", (req, res) => res.json(observe(req.query)));
app.post("/form", (req, res) => res.json(observe(req.body)));

app.use((err, req, res, next) => {
  if (activeTrial) activeTrial.serverExceptionObserved = true;
  res.status(500).json({ error: "controlled_dependency_exception", message: err.message });
});

function requestJson({ port, method, route, body }) {
  return new Promise((resolve, reject) => {
    const payload = body || "";
    const start = performance.now();
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: route,
      method,
      headers: method === "POST" ? {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(payload),
      } : {},
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => data += c);
      res.on("end", () => {
        let response;
        try { response = JSON.parse(data); } catch { response = { raw: data }; }
        resolve({ statusCode: res.statusCode, response, responseMs: performance.now() - start });
      });
    });
    req.on("error", reject);
    if (method === "POST") req.write(payload);
    req.end();
  });
}

function targetDimension(p) {
  return p === "CORRUPTION" ? "integrityImpact" :
         p === "EXCEPTION" ? "availabilityImpact" :
         p === "DELAY" ? "latencyImpact" :
         p === "MALFORMED" ? "malformedImpact" : "anyImpact";
}

function summarize(rows, perturbation, pathType, containmentProbability) {
  const subset = rows.filter(r => r.perturbation === perturbation && r.path === pathType && r.containmentProbability === containmentProbability);
  const dimension = targetDimension(perturbation);
  const impacted = subset.filter(r => Boolean(r[dimension])).length;
  const qHat = impacted / subset.length;
  const qExpected = 1 - containmentProbability;
  return {
    perturbation, path: pathType, containmentProbability,
    runs: subset.length, impactedRuns: impacted,
    qExpected, qHat, absoluteError: Math.abs(qHat - qExpected),
  };
}

function esc(v) {
  if (v === null || v === undefined) return "";
  const t = String(v);
  return `"${t.replaceAll('"', '""')}"`;
}

async function main() {
  const outDir = path.join(process.cwd(), "results", "propagation-probabilistic");
  fs.mkdirSync(outDir, { recursive: true });

  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const port = server.address().port;

  const perturbations = ["CORRUPTION", "EXCEPTION", "DELAY", "MALFORMED"];
  const paths = ["query", "body"];
  const containments = [0.00, 0.25, 0.50, 0.75];
  const rows = [];
  let trialId = 0;

  console.log("QS PROBABILISTIC PROPAGATION EXPERIMENT");
  console.log("=======================================");
  console.log(`Local test server port: ${port}`);
  console.log(`Repetitions per condition: ${REPS}`);
  console.log("Seed: 0x5eeda11\n");

  for (const perturbation of perturbations) {
    for (const pathType of paths) {
      for (const containmentProbability of containments) {
        activeConfig = { perturbation, containmentProbability };
        for (let rep = 0; rep < REPS; rep++) {
          trialId++;
          activeTrial = {
            trialId, perturbation, path: pathType, containmentProbability,
            triggerObserved: false, containmentDraw: null, contained: false,
            syntheticPerturbationActivated: false, qsParseInvoked: false,
            serverExceptionObserved: false,
          };

          const params = "probe=healthy&trigger=1";
          const result = pathType === "query"
            ? await requestJson({ port, method: "GET", route: `/query?${params}` })
            : await requestJson({ port, method: "POST", route: "/form", body: params });

          const integrityImpact = Boolean(result.response && result.response.integrityImpact);
          const malformedImpact = Boolean(result.response && result.response.malformedImpact);
          const availabilityImpact = result.statusCode >= 500;
          const latencyImpact = result.responseMs >= LATENCY_THRESHOLD_MS;

          rows.push({
            ...activeTrial,
            httpStatus: result.statusCode,
            responseMs: Number(result.responseMs.toFixed(3)),
            integrityImpact, availabilityImpact, latencyImpact, malformedImpact,
            anyImpact: integrityImpact || availabilityImpact || latencyImpact || malformedImpact,
          });
          activeTrial = null;
        }
      }
    }
  }

  await new Promise(r => server.close(r));
  qs.parse = originalQsParse;

  const summaries = [];
  for (const p of perturbations)
    for (const pt of paths)
      for (const c of containments)
        summaries.push(summarize(rows, p, pt, c));

  const mae = summaries.reduce((s, x) => s + x.absoluteError, 0) / summaries.length;

  const json = {
    purpose: "Calibrate intermediate q estimates under known synthetic containment probabilities.",
    model: {
      expected: "q* = 1 - containmentProbability",
      estimator: "q_hat = impacted triggered runs / total triggered runs",
      caution: "Calibration only; not a natural compromise probability.",
    },
    configuration: { repetitionsPerCondition: REPS, totalTrials: rows.length, seed: "0x5eeda11", delayMs: DELAY_MS, latencyThresholdMs: LATENCY_THRESHOLD_MS },
    meanAbsoluteError: mae,
    summaries,
    trials: rows,
  };

  fs.writeFileSync(path.join(outDir, "qs-probabilistic-results.json"), JSON.stringify(json, null, 2));

  const headers = Object.keys(rows[0]);
  const csv = [headers.map(esc).join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
  fs.writeFileSync(path.join(outDir, "qs-probabilistic-results.csv"), csv);

  const report = [];
  report.push("QS PROBABILISTIC PROPAGATION CALIBRATION REPORT");
  report.push("===============================================");
  report.push("");
  report.push("Purpose: validate q_hat against known synthetic containment probabilities.");
  report.push(`Total trials: ${rows.length}`);
  report.push(`Repetitions per condition: ${REPS}`);
  report.push("Seed: 0x5eeda11");
  report.push(`Mean absolute estimation error: ${mae.toFixed(4)}`);
  report.push("");
  report.push("q* = 1 - containment probability; q_hat = observed impacted fraction");
  report.push("");
  report.push("PERTURBATION | PATH  | CONTAIN | q*     | q_hat  | ABS_ERR");
  report.push("-------------|-------|---------|--------|--------|--------");
  for (const s of summaries) {
    report.push(`${s.perturbation.padEnd(12)} | ${s.path.padEnd(5)} | ${s.containmentProbability.toFixed(2).padEnd(7)} | ${s.qExpected.toFixed(4)} | ${s.qHat.toFixed(4)} | ${s.absoluteError.toFixed(4)}`);
  }
  report.push("");
  report.push("INTERPRETATION");
  report.push("--------------");
  report.push("Intermediate q_hat values arise because a known fraction of synthetic");
  report.push("dependency perturbations are contained before reaching the application.");
  report.push("Agreement between q_hat and q* validates the estimator in a controlled setting.");
  report.push("These are calibration results, not natural compromise rates.");

  fs.writeFileSync(path.join(outDir, "qs-probabilistic-report.txt"), report.join("\n"));
  console.log(report.join("\n"));
  console.log("\nFiles created:");
  console.log("  results\\propagation-probabilistic\\qs-probabilistic-report.txt");
  console.log("  results\\propagation-probabilistic\\qs-probabilistic-results.csv");
  console.log("  results\\propagation-probabilistic\\qs-probabilistic-results.json");
}

main().catch((err) => {
  qs.parse = originalQsParse;
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
