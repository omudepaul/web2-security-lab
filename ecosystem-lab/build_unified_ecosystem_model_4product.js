#!/usr/bin/env node
"use strict";

/*
  FOUR-PRODUCT UNIFIED ECOSYSTEM MODEL

  Updates the earlier K=3 unified model to K=4 after adding:
    P4 = connect@3.7.0

  Components:
    N1: depd@2.0.0
    E1: debug@2.6.9 -> ms@2.0.0
    E2: on-finished@2.4.1 -> ee-first@1.1.1

  Structural reach rho is taken from the corrected four-product topology.

  Runtime/context evidence:
    N1 uses the existing depd ecosystem experiment.
    E1 combines earlier P2/P3 evidence with the new P4 Connect validation.
    E2 remains based on the existing P1/P3 evidence because P4 contains
       on-finished@2.3.0, not on-finished@2.4.1.

  IMPORTANT:
    rho = structural reach only.
    alpha = runtime activation under tested contexts.
    q = conditional propagation under controlled perturbation.
    pi = alpha * q.
    Natural lambda is NOT estimated.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTDIR = path.join(ROOT, "results", "unified-ecosystem-model-4product");

const TOPOLOGY_FILE = path.join(
  ROOT,
  "results",
  "ecosystem-topology-4product-corrected",
  "ecosystem-topology-4product-corrected.json"
);

const P4_ACTIVATION_FILE = path.join(
  ROOT,
  "results",
  "p4-connect-activation-validation",
  "p4-connect-activation-validation.json"
);

const P4_PROPAGATION_FILE = path.join(
  ROOT,
  "results",
  "p4-connect-propagation-validation",
  "p4-connect-propagation-validation.json"
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

function mean(xs) {
  const a = xs.filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
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
const p4Activation = mustReadJson(P4_ACTIVATION_FILE);
const p4Propagation = mustReadJson(P4_PROPAGATION_FILE);

const K = topology.ecosystem.K;

if (K !== 4) {
  throw new Error(`Expected K=4 but topology reports K=${K}`);
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

const depdTopo = findSharedNode("depd@2.0.0");
const debugMsTopo = findSharedEdge("debug@2.6.9 -> ms@2.0.0");
const onfEeTopo = findSharedEdge("on-finished@2.4.1 -> ee-first@1.1.1");

/*
  Existing experimentally established summaries from the earlier K=3 unified model.

  N1 depd:
    9 contexts, 5 active, 4 inactive -> alpha_bar = 5/9
    deterministic active perturbations -> q = 1
    perturbed pi_bar = 5/9

  E1 debug->ms before P4:
    P2/P3, 4 contexts total, 2 active, 2 inactive -> alpha_bar = .5
    deterministic active perturbations -> q = 1
    perturbed pi_bar = .5

  E2 on-finished->ee-first:
    P1/P3, 4 contexts total, 2 active, 2 inactive -> alpha_bar = .5
    deterministic active perturbations -> q = 1
    perturbed pi_bar = .5

  P4 adds two pre-specified activation contexts for E1:
    inactive colors-off -> A=0
    active colors-on -> A=1
  so E1 becomes 6 contexts, 3 active, 3 inactive -> alpha_bar=.5.
*/

const p4ActivationSummary = p4Activation.summary || [];

const p4Inactive = p4ActivationSummary.find(
  r => r.config === "C2_DEBUG_ON_COLORS_OFF"
);
const p4Active = p4ActivationSummary.find(
  r => r.config === "C3_DEBUG_ON_COLORS_ON"
);

if (!p4Inactive || !p4Active) {
  throw new Error(
    "Expected P4 activation summary rows C2_DEBUG_ON_COLORS_OFF and C3_DEBUG_ON_COLORS_ON."
  );
}

if (Number(p4Inactive.observedA) !== 0 || Number(p4Active.observedA) !== 1) {
  throw new Error(
    `Unexpected P4 activation observations: inactive=${p4Inactive.observedA}, active=${p4Active.observedA}`
  );
}

const p4PropSummary = p4Propagation.summary || [];

const activePerturbationRows = p4PropSummary.filter(
  r =>
    r.context === "ACTIVE_COLORS_ON" &&
    r.condition !== "BASELINE"
);

if (activePerturbationRows.length !== 3) {
  throw new Error(
    `Expected 3 active P4 perturbation rows, found ${activePerturbationRows.length}`
  );
}

for (const r of activePerturbationRows) {
  if (
    Number(r.observedAlpha) !== 1 ||
    Number(r.qConditionalOnActive) !== 1 ||
    Number(r.impactRate) !== 1
  ) {
    throw new Error(
      `P4 propagation row does not match expected controlled validation: ${r.condition}`
    );
  }
}

const components = [
  {
    id: "N1",
    type: "NODE",
    component: "depd@2.0.0",
    products: depdTopo.products,
    productCount: depdTopo.productCount,
    rho: depdTopo.rho,

    contextsTested: 9,
    activeContexts: 5,
    inactiveContexts: 4,
    alphaBar: 5 / 9,

    qControlledActivePerturbations: 1,
    piBarPerturbed: 5 / 9,

    evidence:
      "Existing depd activation/perturbation experiments across P1/P2/P3; P4 does not structurally contain depd@2.0.0.",
  },

  {
    id: "E1",
    type: "EDGE",
    component: "debug@2.6.9 -> ms@2.0.0",
    products: debugMsTopo.products,
    productCount: debugMsTopo.productCount,
    rho: debugMsTopo.rho,

    contextsTested: 6,
    activeContexts: 3,
    inactiveContexts: 3,
    alphaBar: 3 / 6,

    qControlledActivePerturbations: 1,
    piBarPerturbed: 3 / 6,

    evidence:
      "Earlier P2/P3 debug->ms experiments plus pre-specified P4 Connect activation and propagation validation.",
  },

  {
    id: "E2",
    type: "EDGE",
    component: "on-finished@2.4.1 -> ee-first@1.1.1",
    products: onfEeTopo.products,
    productCount: onfEeTopo.productCount,
    rho: onfEeTopo.rho,

    contextsTested: 4,
    activeContexts: 2,
    inactiveContexts: 2,
    alphaBar: 2 / 4,

    qControlledActivePerturbations: 1,
    piBarPerturbed: 2 / 4,

    evidence:
      "Existing P1/P3 on-finished@2.4.1 -> ee-first@1.1.1 experiments. P4 has on-finished@2.3.0, so it is not counted as the same exact edge.",
  },
];

const model = {
  name: "Four-product unified ecosystem model",
  K,
  products: ["P1", "P2", "P3", "P4"],

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

  components,

  principles: [
    "Structural reach is not runtime activation.",
    "Runtime activation is not conditional propagation.",
    "Controlled q=1 validates the deterministic mechanism under the tested perturbation; it is not a natural compromise/failure probability.",
    "Natural lambda remains unestimated.",
    "P4 extends E1 validation to a new parent-product environment.",
    "Exact package-version identity must remain distinct from physical installed-instance identity.",
  ],
};

fs.writeFileSync(
  path.join(OUTDIR, "unified-ecosystem-model-4product.json"),
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
  path.join(OUTDIR, "unified-ecosystem-model-4product.csv"),
  csv,
  "utf8"
);

const report = [];

report.push("FOUR-PRODUCT UNIFIED ECOSYSTEM MODEL");
report.push("====================================");
report.push("");
report.push(`Products K=${K}`);
report.push("P1=Express, P2=express-session, P3=Morgan, P4=Connect");
report.push("");
report.push("FORMAL MODEL");
report.push("------------");
report.push("M_E = ({G_p}_{p=1..K}, C_s, mu, X, S, Lambda, Alpha, Q, Pi)");
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
    `  tested contexts=${c.contextsTested} active=${c.activeContexts} inactive=${c.inactiveContexts}`
  );
  report.push(
    `  alpha_bar=${fmt(c.alphaBar)} q_controlled=${fmt(c.qControlledActivePerturbations)} pi_bar_perturbed=${fmt(c.piBarPerturbed)}`
  );
  report.push(`  evidence=${c.evidence}`);
}

report.push("");
report.push("K=3 -> K=4 STRUCTURAL CHANGES");
report.push("-----------------------------");
report.push(
  "N1 depd@2.0.0: rho changed from 1.000 to 0.750 because P4 does not contain the exact node."
);
report.push(
  "E1 debug@2.6.9 -> ms@2.0.0: rho changed from 0.667 to 0.750 because P4 contains the exact edge."
);
report.push(
  "E2 on-finished@2.4.1 -> ee-first@1.1.1: rho changed from 0.667 to 0.500 because P4 contains on-finished@2.3.0, not 2.4.1."
);
report.push("");
report.push("P4 VALIDATION EFFECT ON E1");
report.push("--------------------------");
report.push(
  "P4 added one inactive and one active pre-specified context for the reused exact debug->ms edge."
);
report.push(
  "Across the combined tested E1 contexts: active=3, inactive=3, alpha_bar=0.500."
);
report.push(
  "Under active deterministic controlled perturbations, P4 reproduced q=1 for corruption, suppression, and latency effects."
);
report.push("");
report.push("IMPORTANT");
report.push("---------");
report.push(
  "rho is structural reach only. It must not be interpreted as runtime activation, conditional propagation, or natural risk."
);
report.push(
  "q=1 is a controlled deterministic mechanism result, not a natural compromise/failure probability."
);
report.push(
  "No natural lambda is claimed. Therefore no scalar natural risk score is produced."
);

fs.writeFileSync(
  path.join(OUTDIR, "unified-ecosystem-model-4product-report.txt"),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log("  results\\unified-ecosystem-model-4product\\unified-ecosystem-model-4product-report.txt");
console.log("  results\\unified-ecosystem-model-4product\\unified-ecosystem-model-4product.csv");
console.log("  results\\unified-ecosystem-model-4product\\unified-ecosystem-model-4product.json");
