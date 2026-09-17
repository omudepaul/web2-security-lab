#!/usr/bin/env node
"use strict";

/*
  FIVE-PRODUCT UNIFIED ECOSYSTEM MODEL

  Updates the validated K=4 unified model to K=5 after adding:
    P5 = compression@1.7.4

  Components:
    N1: depd@2.0.0
    E1: debug@2.6.9 -> ms@2.0.0
    E2: on-finished@2.4.1 -> ee-first@1.1.1

  Structural reach rho is taken from the K=5 topology.

  Runtime/context evidence:
    N1 remains the existing P1/P2/P3 depd evidence.
    E1 extends the K=4 evidence with P5 Compression validation.
    E2 remains the existing P1/P3 evidence.

  IMPORTANT:
    rho = structural reach only.
    alpha = runtime activation under designated tested contexts.
    q = conditional propagation under controlled perturbation.
    pi = alpha * q.
    Natural lambda is NOT estimated.

  Canonical E1 context aggregation:
    To preserve comparability with the earlier unified model, each validation
    product contributes two DEBUG-enabled canonical contexts:
      - colors off  -> inactive
      - colors on   -> active
    The DEBUG-off configuration is retained as an auxiliary control in the
    activation experiment but is not added to alpha_bar.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTDIR = path.join(ROOT, "results", "unified-ecosystem-model-5product");

const TOPOLOGY_FILE = path.join(
  ROOT,
  "results",
  "ecosystem-topology-5product",
  "ecosystem-topology-5product.json"
);

const K4_UNIFIED_FILE = path.join(
  ROOT,
  "results",
  "unified-ecosystem-model-4product",
  "unified-ecosystem-model-4product.json"
);

const P5_ACTIVATION_FILE = path.join(
  ROOT,
  "results",
  "p5-compression-activation-validation",
  "p5-compression-activation-validation.json"
);

const P5_PROPAGATION_FILE = path.join(
  ROOT,
  "results",
  "p5-compression-propagation-validation",
  "p5-compression-propagation-validation.json"
);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mustReadJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required file not found:\n${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fmt(v, d = 3) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "NA";
  }
  return Number(v).toFixed(d);
}

function csvEscape(v) {
  const s = Array.isArray(v) ? v.join(";") : String(v ?? "");
  return /[",\n]/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

ensureDir(OUTDIR);

const topology = mustReadJson(TOPOLOGY_FILE);
const k4 = mustReadJson(K4_UNIFIED_FILE);
const p5Activation = mustReadJson(P5_ACTIVATION_FILE);
const p5Propagation = mustReadJson(P5_PROPAGATION_FILE);

const K = topology.ecosystem.K;

if (K !== 5) {
  throw new Error(`Expected K=5 but topology reports K=${K}`);
}

function findSharedNode(nodeId) {
  const row = topology.ecosystem.sharedNodes.find(r => r.node === nodeId);
  if (!row) throw new Error(`Shared node not found: ${nodeId}`);
  return row;
}

function findSharedEdge(edgeId) {
  const row = topology.ecosystem.sharedEdges.find(r => r.edge === edgeId);
  if (!row) throw new Error(`Shared edge not found: ${edgeId}`);
  return row;
}

function findK4Component(id) {
  const row = k4.components.find(r => r.id === id);
  if (!row) throw new Error(`K=4 component not found: ${id}`);
  return row;
}

const depdTopo = findSharedNode("depd@2.0.0");
const debugMsTopo = findSharedEdge("debug@2.6.9 -> ms@2.0.0");
const onfEeTopo = findSharedEdge("on-finished@2.4.1 -> ee-first@1.1.1");

const k4N1 = findK4Component("N1");
const k4E1 = findK4Component("E1");
const k4E2 = findK4Component("E2");

/*
  Validate P5 activation evidence.

  We keep C1 DEBUG-off as an auxiliary control.
  Canonical E1 aggregate adds C2 and C3 only:
    C2 DEBUG on, colors off -> A=0
    C3 DEBUG on, colors on  -> A=1
*/

const actSummary = p5Activation.summary || [];

const p5C1 = actSummary.find(r => r.config === "C1_DEBUG_OFF_COLORS_ON");
const p5C2 = actSummary.find(r => r.config === "C2_DEBUG_ON_COLORS_OFF");
const p5C3 = actSummary.find(r => r.config === "C3_DEBUG_ON_COLORS_ON");

if (!p5C1 || !p5C2 || !p5C3) {
  throw new Error("Expected all three P5 activation summary configurations.");
}

if (
  Number(p5C1.observedA) !== 0 ||
  Number(p5C2.observedA) !== 0 ||
  Number(p5C3.observedA) !== 1
) {
  throw new Error(
    `Unexpected P5 activation results: C1=${p5C1.observedA}, C2=${p5C2.observedA}, C3=${p5C3.observedA}`
  );
}

if (Number(p5Activation.overallPredictionAccuracy) !== 1) {
  throw new Error(
    `P5 activation prediction accuracy is not 1.0: ${p5Activation.overallPredictionAccuracy}`
  );
}

/*
  Validate P5 propagation evidence.

  Active non-baseline conditions must reproduce:
    alpha = 1
    q|active = 1
    impact = 1

  Inactive non-baseline conditions must reproduce:
    alpha = 0
    impact = 0
*/

const propSummary = p5Propagation.summary || [];

const activeNonBaseline = propSummary.filter(
  r =>
    r.context === "ACTIVE_COLORS_ON" &&
    r.condition !== "BASELINE"
);

const inactiveNonBaseline = propSummary.filter(
  r =>
    r.context === "INACTIVE_COLORS_OFF" &&
    r.condition !== "BASELINE"
);

if (activeNonBaseline.length !== 3 || inactiveNonBaseline.length !== 3) {
  throw new Error(
    `Unexpected P5 propagation summary cell count: active=${activeNonBaseline.length}, inactive=${inactiveNonBaseline.length}`
  );
}

for (const r of activeNonBaseline) {
  if (
    Number(r.observedAlpha) !== 1 ||
    Number(r.qConditionalOnActive) !== 1 ||
    Number(r.impactRate) !== 1
  ) {
    throw new Error(
      `P5 active propagation cell failed expected validation: ${r.condition}`
    );
  }
}

for (const r of inactiveNonBaseline) {
  if (
    Number(r.observedAlpha) !== 0 ||
    Number(r.impactRate) !== 0
  ) {
    throw new Error(
      `P5 inactive propagation cell failed expected validation: ${r.condition}`
    );
  }
}

if (!p5Propagation.validationPass) {
  throw new Error("P5 propagation validationPass is false.");
}

/*
  Build K=5 component signatures.

  N1: structural denominator changes only; runtime evidence unchanged.
  E1: P5 adds two canonical contexts (one inactive, one active).
  E2: structural denominator changes only; runtime evidence unchanged.
*/

const e1Contexts = Number(k4E1.contextsTested) + 2;
const e1Active = Number(k4E1.activeContexts) + 1;
const e1Inactive = Number(k4E1.inactiveContexts) + 1;
const e1AlphaBar = e1Active / e1Contexts;

const components = [
  {
    id: "N1",
    type: "NODE",
    component: "depd@2.0.0",
    products: depdTopo.products,
    productCount: depdTopo.productCount,
    rho: depdTopo.rho,

    contextsTested: Number(k4N1.contextsTested),
    activeContexts: Number(k4N1.activeContexts),
    inactiveContexts: Number(k4N1.inactiveContexts),
    alphaBar: Number(k4N1.alphaBar),

    qControlledActivePerturbations:
      Number(k4N1.qControlledActivePerturbations),
    piBarPerturbed: Number(k4N1.piBarPerturbed),

    evidence:
      "Existing depd activation/perturbation experiments across P1/P2/P3; P4 and P5 do not structurally contain depd@2.0.0.",
  },

  {
    id: "E1",
    type: "EDGE",
    component: "debug@2.6.9 -> ms@2.0.0",
    products: debugMsTopo.products,
    productCount: debugMsTopo.productCount,
    rho: debugMsTopo.rho,

    contextsTested: e1Contexts,
    activeContexts: e1Active,
    inactiveContexts: e1Inactive,
    alphaBar: e1AlphaBar,

    qControlledActivePerturbations: 1,
    piBarPerturbed: e1AlphaBar,

    auxiliaryControl:
      "P5 C1 DEBUG-off/colors-on was also tested and correctly remained inactive, but is excluded from the canonical alpha_bar aggregate to preserve the two-context-per-validation-product comparison.",

    evidence:
      "Earlier P2/P3 experiments, P4 Connect validation, and P5 Compression activation/propagation validation.",
  },

  {
    id: "E2",
    type: "EDGE",
    component: "on-finished@2.4.1 -> ee-first@1.1.1",
    products: onfEeTopo.products,
    productCount: onfEeTopo.productCount,
    rho: onfEeTopo.rho,

    contextsTested: Number(k4E2.contextsTested),
    activeContexts: Number(k4E2.activeContexts),
    inactiveContexts: Number(k4E2.inactiveContexts),
    alphaBar: Number(k4E2.alphaBar),

    qControlledActivePerturbations:
      Number(k4E2.qControlledActivePerturbations),
    piBarPerturbed: Number(k4E2.piBarPerturbed),

    evidence:
      "Existing P1/P3 on-finished@2.4.1 -> ee-first@1.1.1 experiments. P4 uses on-finished@2.3.0 and P5 does not contain the exact E2 relation.",
  },
];

const model = {
  name: "Five-product unified ecosystem model",
  K,
  products: ["P1", "P2", "P3", "P4", "P5"],

  productLabels: {
    P1: "Express",
    P2: "express-session",
    P3: "Morgan",
    P4: "Connect",
    P5: "compression",
  },

  formalModel:
    "M_E = ({G_p}_{p=1..K}, C_s, mu, X, S, Lambda, Alpha, Q, Pi)",

  definitions: {
    rho: "rho_c = |mu(c)| / K",
    alpha: "alpha_c(p,x) = P(A_c=1 | T_c=1,p,x)",
    q: "q_c(p,x,s) = P(I_c=1 | A_c=1,p,x,s)",
    pi: "pi_c(p,x,s) = alpha_c(p,x) * q_c(p,x,s)",
    naturalRisk:
      "R_c = lambda_c * alpha_c * q_c only when a defensible natural lambda_c is available",
  },

  aggregationNote:
    "alphaBar is an unweighted descriptive average over designated canonical tested contexts, not an estimate of real-world workload frequency. Real deployment aggregation requires defensible context weights.",

  components,

  principles: [
    "Structural reach is not runtime activation.",
    "Runtime activation is not conditional propagation.",
    "Controlled q=1 validates the deterministic mechanism under the tested perturbation; it is not a natural compromise/failure probability.",
    "Natural lambda remains unestimated.",
    "P5 extends E1 validation to another independent parent-product package environment.",
    "Exact package-version identity remains distinct from physical installed-instance identity.",
    "The DEBUG-off activation control is retained as auxiliary evidence but excluded from the canonical E1 alphaBar context aggregate.",
  ],
};

fs.writeFileSync(
  path.join(OUTDIR, "unified-ecosystem-model-5product.json"),
  JSON.stringify(model, null, 2),
  "utf8"
);

const headers = [
  "id",
  "type",
  "component",
  "products",
  "productCount",
  "rho",
  "contextsTested",
  "activeContexts",
  "inactiveContexts",
  "alphaBar",
  "qControlledActivePerturbations",
  "piBarPerturbed",
  "evidence",
];

const csv = [
  headers.join(","),
  ...components.map(row =>
    headers.map(h => csvEscape(row[h])).join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(OUTDIR, "unified-ecosystem-model-5product.csv"),
  csv,
  "utf8"
);

const report = [];

report.push("FIVE-PRODUCT UNIFIED ECOSYSTEM MODEL");
report.push("====================================");
report.push("");
report.push(`Products K=${K}`);
report.push(
  "P1=Express, P2=express-session, P3=Morgan, P4=Connect, P5=compression"
);
report.push("");

report.push("FORMAL MODEL");
report.push("------------");
report.push(
  "M_E = ({G_p}_{p=1..K}, C_s, mu, X, S, Lambda, Alpha, Q, Pi)"
);
report.push("");
report.push("rho_c = |mu(c)| / K");
report.push("pi_c = alpha_c * q_c");
report.push("");

report.push("COMPONENT SIGNATURES");
report.push("--------------------");

for (const c of components) {
  report.push(`${c.id} ${c.type}: ${c.component}`);
  report.push(
    `  products=${c.products.join(",")} count=${c.productCount}/${K} rho=${fmt(c.rho)}`
  );
  report.push(
    `  canonical tested contexts=${c.contextsTested} active=${c.activeContexts} inactive=${c.inactiveContexts}`
  );
  report.push(
    `  alpha_bar=${fmt(c.alphaBar)} q_controlled=${fmt(
      c.qControlledActivePerturbations
    )} pi_bar_perturbed=${fmt(c.piBarPerturbed)}`
  );
  report.push(`  evidence=${c.evidence}`);
  if (c.auxiliaryControl) {
    report.push(`  auxiliary control=${c.auxiliaryControl}`);
  }
}

report.push("");
report.push("K=4 -> K=5 STRUCTURAL CHANGES");
report.push("-----------------------------");
report.push(
  "N1 depd@2.0.0: rho changed from 0.750 to 0.600 because P5 does not contain the exact node."
);
report.push(
  "E1 debug@2.6.9 -> ms@2.0.0: rho changed from 0.750 to 0.800 because P5 contains the exact edge."
);
report.push(
  "E2 on-finished@2.4.1 -> ee-first@1.1.1: rho changed from 0.500 to 0.400 because P5 does not contain the exact edge."
);

report.push("");
report.push("P5 VALIDATION EFFECT ON E1");
report.push("--------------------------");
report.push(
  "P5 reproduced the pre-specified activation gate: DEBUG-on/colors-off inactive; DEBUG-on/colors-on active."
);
report.push(
  "P5 also reproduced deterministic controlled propagation: active CORRUPT_HUMANIZE, EMPTY_HUMANIZE, and DELAY_HUMANIZE each had q=1 and impact=1."
);
report.push(
  "Across the canonical combined E1 contexts: active=4, inactive=4, alpha_bar=0.500."
);
report.push(
  "The P5 DEBUG-off/colors-on configuration also correctly remained inactive and is retained as an auxiliary control, not included in canonical alpha_bar."
);

report.push("");
report.push("IMPORTANT");
report.push("---------");
report.push(
  "rho is structural reach only. It must not be interpreted as runtime activation, conditional propagation, or natural risk."
);
report.push(
  "alpha_bar is an unweighted descriptive average over designated tested contexts, not a real-world workload-frequency estimate."
);
report.push(
  "q=1 is a controlled deterministic mechanism result, not a natural compromise/failure probability."
);
report.push(
  "No natural lambda is claimed. Therefore no scalar natural risk score is produced."
);

fs.writeFileSync(
  path.join(OUTDIR, "unified-ecosystem-model-5product-report.txt"),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results\\unified-ecosystem-model-5product\\unified-ecosystem-model-5product-report.txt"
);
console.log(
  "  results\\unified-ecosystem-model-5product\\unified-ecosystem-model-5product.csv"
);
console.log(
  "  results\\unified-ecosystem-model-5product\\unified-ecosystem-model-5product.json"
);
