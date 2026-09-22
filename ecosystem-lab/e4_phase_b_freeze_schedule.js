#!/usr/bin/env node
"use strict";

// Generates assignments only. Does not load products or execute experiments.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert/strict");

const seed = "E4-LAMBDA-2026";
const protocolCommit = "ab8e1d3bec69e2aa3ac837b9fae77fdddcb9f4d2";
const output = path.join(__dirname, "E4_PHASE_B_FROZEN_SCHEDULE.json");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");

function makeSchedule() {
  const cells = [];
  for (const product of ["P5", "P6"]) {
    for (const percent of [0, 25, 50, 75, 100]) {
      const label = `${product}|${(percent / 100).toFixed(2)}`;
      let counter = 0;
      // One unsigned big-endian 32-bit word from each SHA-256 digest.
      // Rejection sampling avoids modulo bias in Fisher-Yates selection.
      function below(bound) {
        const limit = Math.floor(4294967296 / bound) * bound;
        let word;
        do {
          word = crypto.createHash("sha256")
            .update(`${seed}|${label}|${counter++}`, "utf8")
            .digest().readUInt32BE(0);
        } while (word >= limit);
        return word % bound;
      }
      const assigned = Array.from({ length: 40 }, (_, i) => Number(i < percent * 40 / 100));
      for (let i = assigned.length - 1; i > 0; i--) {
        const j = below(i + 1);
        [assigned[i], assigned[j]] = [assigned[j], assigned[i]];
      }
      cells.push({
        product, label, lambdaCtrl: percent / 100,
        plannedTrials: 40, plannedInjections: percent * 40 / 100,
        trials: assigned.map((injectionAssigned, index) => ({
          trialId: `${product}-L${String(percent).padStart(3, "0")}-T${String(index + 1).padStart(2, "0")}`,
          repetition: index + 1,
          injectionAssigned,
          context: "ACTIVE_ELIGIBLE_GZIP",
          perturbation: "EMPTY_ENCODINGS",
          predictedAlpha: 1,
          predictedInjection: injectionAssigned,
          predictedImpact: injectionAssigned,
          predictedContentEncoding: injectionAssigned ? "identity" : "gzip",
        })),
      });
    }
  }
  return {
    schemaVersion: 1, experiment: "E4 Phase B controlled-lambda",
    protocolFile: "E4_ACCEPTS_NEGOTIATOR_PROPAGATION_PREDICTION.md",
    protocolCommit, seed,
    exactEdge: "accepts@1.3.8 -> negotiator@0.6.3",
    algorithm: "Fisher-Yates descending i=39..1; SHA256 UTF8(seed|product|lambda.toFixed(2)|counter), counter starts at 0 per cell; first uint32 big-endian; reject values >= floor(2^32/bound)*bound, then modulo bound. Initial array contains assigned ones followed by zeros.",
    executionOrder: "P5 then P6; rates ascending; trials in listed order; fresh process per trial.",
    totalPlannedTrials: 400,
    interpretation: "Assignments are controlled and fixed-count, not independent Bernoulli occurrence samples. No natural failure probability is estimated. q is undefined when no active injected trials exist. Wilson intervals are descriptive controlled-sample summaries, not natural-risk intervals.",
    cells,
  };
}

function validate(schedule) {
  assert.equal(schedule.cells.length, 10);
  const trials = schedule.cells.flatMap(cell => cell.trials);
  assert.equal(trials.length, 400);
  assert.equal(new Set(trials.map(trial => trial.trialId)).size, 400);
  for (const cell of schedule.cells) {
    assert.equal(cell.trials.length, 40);
    assert.equal(cell.trials.reduce((sum, trial) => sum + trial.injectionAssigned, 0), cell.plannedInjections);
    assert.equal(cell.plannedInjections, cell.lambdaCtrl * 40);
  }
}

try {
  if (process.argv.slice(2).some(arg => arg !== "--check")) {
    throw new Error("Usage: node e4_phase_b_freeze_schedule.js [--check]");
  }
  const schedule = makeSchedule();
  validate(schedule);
  const serialized = JSON.stringify(schedule, null, 2) + "\n";
  assert.equal(serialized, JSON.stringify(makeSchedule(), null, 2) + "\n");
  if (fs.existsSync(output)) {
    assert.equal(fs.readFileSync(output, "utf8"), serialized,
      "Existing schedule differs. Refusing to overwrite the frozen schedule.");
  } else if (process.argv.includes("--check")) {
    throw new Error("Schedule missing; run without --check to create it.");
  } else {
    fs.writeFileSync(output, serialized, { flag: "wx" });
  }
  console.log("E4 PHASE-B SCHEDULE: VERIFIED");
  for (const cell of schedule.cells) {
    console.log(`${cell.product} lambda=${cell.lambdaCtrl.toFixed(2)}: ${cell.plannedInjections}/40 assigned injections`);
  }
  console.log(`SHA256: ${digest(serialized)}`);
  console.log(`Schedule: ${output}`);
  console.log("No runtime trials executed. Commit this schedule before collecting Phase-B outcomes.");
} catch (error) {
  console.error(error.stack || String(error));
  process.exitCode = 1;
}
