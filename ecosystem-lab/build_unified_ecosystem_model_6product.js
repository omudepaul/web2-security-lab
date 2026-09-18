#!/usr/bin/env node
"use strict";

/*
  SIX-PRODUCT UNIFIED ECOSYSTEM MODEL

  Updates the validated K=5 unified model to K=6 after adding:
    P6 = socket.io@4.8.1

  Components:
    N1: depd@2.0.0
    E1: debug@2.6.9 -> ms@2.0.0
    E2: on-finished@2.4.1 -> ee-first@1.1.1
    E3: debug@4.4.3 -> ms@2.1.3

  Structural reach rho is taken from the corrected K=6 topology.

  Runtime/context evidence:
    N1 remains the existing P1/P2/P3 depd evidence.
    E1 remains the validated P2/P3/P4/P5 evidence.
    E2 remains the validated P1/P3 evidence.
    E3 is newly validated in both:
      - P6 Socket.IO / Engine.IO
      - P1 Express / Router

  IMPORTANT:
    rho = structural reach only.
    alpha = runtime activation under designated tested contexts.
    q = conditional propagation under controlled perturbation.
    pi = alpha * q.
    Natural lambda is NOT estimated.

  Canonical debug->ms context aggregation:
    Each validation product contributes two DEBUG-enabled canonical contexts:
      - colors off -> inactive
      - colors on  -> active

    DEBUG-off/colors-on controls are retained as auxiliary evidence but are
    excluded from alpha_bar so E1 and E3 use comparable canonical contexts.

  E1 and E3 remain distinct exact package-version edges.
  Shared mechanism-family behavior does not collapse version identities.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTDIR = path.join(
  ROOT,
  "results",
  "unified-ecosystem-model-6product"
);

const TOPOLOGY_FILE = path.join(
  ROOT,
  "results",
  "ecosystem-topology-6product",
  "ecosystem-topology-6product.json"
);

const K5_UNIFIED_FILE = path.join(
  ROOT,
  "results",
  "unified-ecosystem-model-5product",
  "unified-ecosystem-model-5product.json"
);

const P6_ACTIVATION_FILE = path.join(
  ROOT,
  "results",
  "p6-engineio-debug44-ms21-activation-validation",
  "p6-engineio-debug44-ms21-activation-validation.json"
);

const P6_PROPAGATION_FILE = path.join(
  ROOT,
  "results",
  "p6-engineio-debug44-ms21-propagation-validation",
  "p6-engineio-debug44-ms21-propagation-validation.json"
);

const P1_E3_ACTIVATION_FILE = path.join(
  ROOT,
  "results",
  "p1-express-e3-activation-validation",
  "p1-express-e3-activation-validation.json"
);

const P1_E3_PROPAGATION_FILE = path.join(
  ROOT,
  "results",
  "p1-express-e3-propagation-validation",
  "p1-express-e3-propagation-validation.json"
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
const k5 = mustReadJson(K5_UNIFIED_FILE);
const p6Activation = mustReadJson(P6_ACTIVATION_FILE);
const p6Propagation = mustReadJson(P6_PROPAGATION_FILE);
const p1E3Activation = mustReadJson(P1_E3_ACTIVATION_FILE);
const p1E3Propagation = mustReadJson(P1_E3_PROPAGATION_FILE);

const K = topology.ecosystem.K;

if (K !== 6) {
  throw new Error(`Expected K=6 but topology reports K=${K}`);
}

function findSharedNode(nodeId) {
  const row = topology.ecosystem.sharedNodes.find(
    r => r.node === nodeId
  );

  if (!row) {
    throw new Error(`Shared node not found: ${nodeId}`);
  }

  return row;
}

function findSharedEdge(edgeId) {
  const row = topology.ecosystem.sharedEdges.find(
    r => r.edge === edgeId
  );

  if (!row) {
    throw new Error(`Shared edge not found: ${edgeId}`);
  }

  return row;
}

function findK5Component(id) {
  const row = k5.components.find(
    r => r.id === id
  );

  if (!row) {
    throw new Error(`K=5 component not found: ${id}`);
  }

  return row;
}

const depdTopo =
  findSharedNode("depd@2.0.0");

const e1Topo =
  findSharedEdge("debug@2.6.9 -> ms@2.0.0");

const e2Topo =
  findSharedEdge(
    "on-finished@2.4.1 -> ee-first@1.1.1"
  );

const e3Topo =
  findSharedEdge("debug@4.4.3 -> ms@2.1.3");

const k5N1 = findK5Component("N1");
const k5E1 = findK5Component("E1");
const k5E2 = findK5Component("E2");

/*
  Validate P6 E3 activation evidence.

  Canonical contexts:
    colors off -> inactive
    colors on  -> active

  DEBUG-off/colors-on remains auxiliary.
*/

const p6ActSummary =
  p6Activation.summary || [];

const p6C1 = p6ActSummary.find(
  r => r.config === "C1_DEBUG_OFF_COLORS_ON"
);

const p6C2 = p6ActSummary.find(
  r => r.config === "C2_DEBUG_ON_COLORS_OFF"
);

const p6C3 = p6ActSummary.find(
  r => r.config === "C3_DEBUG_ON_COLORS_ON"
);

if (!p6C1 || !p6C2 || !p6C3) {
  throw new Error(
    "Expected all three P6 E3 activation configurations."
  );
}

if (
  Number(p6C1.observedA) !== 0 ||
  Number(p6C2.observedA) !== 0 ||
  Number(p6C3.observedA) !== 1
) {
  throw new Error(
    "Unexpected P6 E3 activation result."
  );
}

if (
  Number(p6Activation.overallPredictionAccuracy) !== 1 ||
  !p6Activation.validationPass
) {
  throw new Error(
    "P6 E3 activation validation did not pass exactly."
  );
}

/*
  Validate P1 E3 activation evidence.
*/

const p1ActSummary =
  p1E3Activation.summary || [];

const p1C1 = p1ActSummary.find(
  r => r.config === "C1_DEBUG_OFF_COLORS_ON"
);

const p1C2 = p1ActSummary.find(
  r => r.config === "C2_ROUTER_ON_COLORS_OFF"
);

const p1C3 = p1ActSummary.find(
  r => r.config === "C3_ROUTER_ON_COLORS_ON"
);

if (!p1C1 || !p1C2 || !p1C3) {
  throw new Error(
    "Expected all three P1 E3 activation configurations."
  );
}

if (
  Number(p1C1.observedA) !== 0 ||
  Number(p1C2.observedA) !== 0 ||
  Number(p1C3.observedA) !== 1
) {
  throw new Error(
    "Unexpected P1 E3 activation result."
  );
}

if (
  Number(p1E3Activation.overallPredictionAccuracy) !== 1 ||
  !p1E3Activation.validationPass
) {
  throw new Error(
    "P1 E3 activation validation did not pass exactly."
  );
}

/*
  Validate propagation evidence for both E3 products.

  For each product:
    inactive non-baseline:
      alpha = 0
      impact = 0

    active non-baseline:
      alpha = 1
      q|active = 1
      impact = 1
*/

function validatePropagation(label, result) {
  if (!result.validationPass) {
    throw new Error(`${label} validationPass is false.`);
  }

  if (
    Number(result.overallAlphaPredictionAccuracy) !== 1 ||
    Number(result.overallImpactPredictionAccuracy) !== 1
  ) {
    throw new Error(
      `${label} prediction accuracy is not exactly 1.0.`
    );
  }

  const rows = result.summary || [];

  const nonBaseline =
    rows.filter(r => r.condition !== "BASELINE");

  const inactive =
    nonBaseline.filter(
      r => r.context === "INACTIVE_COLORS_OFF"
    );

  const active =
    nonBaseline.filter(
      r => r.context === "ACTIVE_COLORS_ON"
    );

  if (inactive.length !== 3 || active.length !== 3) {
    throw new Error(
      `${label} does not contain expected propagation cells.`
    );
  }

  for (const row of inactive) {
    if (
      Number(row.observedAlpha) !== 0 ||
      Number(row.impactRate) !== 0
    ) {
      throw new Error(
        `${label} unexpected inactive propagation result.`
      );
    }
  }

  for (const row of active) {
    if (
      Number(row.observedAlpha) !== 1 ||
      Number(row.qConditionalOnActive) !== 1 ||
      Number(row.impactRate) !== 1
    ) {
      throw new Error(
        `${label} unexpected active propagation result.`
      );
    }
  }
}

validatePropagation(
  "P6 E3 propagation",
  p6Propagation
);

validatePropagation(
  "P1 E3 propagation",
  p1E3Propagation
);

/*
  Build K=6 component signatures.

  N1, E1, E2:
    runtime evidence unchanged from K=5;
    structural denominator changes to K=6.

  E3:
    exact edge appears in P1 and P6.
    Each product contributes two canonical DEBUG-enabled contexts:
      inactive colors-off
      active colors-on

    Therefore:
      contexts = 4
      active = 2
      inactive = 2
      alpha_bar = 0.5

    Controlled active non-baseline perturbations reproduced:
      q = 1

    Hence descriptive pi_bar_perturbed = alpha_bar * q = 0.5
*/

const e3Contexts = 4;
const e3Active = 2;
const e3Inactive = 2;
const e3AlphaBar =
  e3Active / e3Contexts;

const components = [
  {
    id: "N1",
    type: "NODE",
    component: "depd@2.0.0",

    products: depdTopo.products,
    productCount: depdTopo.productCount,
    rho: depdTopo.rho,

    contextsTested:
      Number(k5N1.contextsTested),

    activeContexts:
      Number(k5N1.activeContexts),

    inactiveContexts:
      Number(k5N1.inactiveContexts),

    alphaBar:
      Number(k5N1.alphaBar),

    qControlledActivePerturbations:
      Number(
        k5N1.qControlledActivePerturbations
      ),

    piBarPerturbed:
      Number(k5N1.piBarPerturbed),

    evidence:
      "Existing depd activation/perturbation experiments across P1/P2/P3; P4/P5/P6 do not structurally contain depd@2.0.0.",
  },

  {
    id: "E1",
    type: "EDGE",
    component:
      "debug@2.6.9 -> ms@2.0.0",

    mechanismFamily:
      "debug -> ms timing-humanization",

    products: e1Topo.products,
    productCount: e1Topo.productCount,
    rho: e1Topo.rho,

    contextsTested:
      Number(k5E1.contextsTested),

    activeContexts:
      Number(k5E1.activeContexts),

    inactiveContexts:
      Number(k5E1.inactiveContexts),

    alphaBar:
      Number(k5E1.alphaBar),

    qControlledActivePerturbations:
      Number(
        k5E1.qControlledActivePerturbations
      ),

    piBarPerturbed:
      Number(k5E1.piBarPerturbed),

    auxiliaryControl:
      k5E1.auxiliaryControl ||
      "DEBUG-off/colors-on controls are auxiliary and excluded from canonical alpha_bar.",

    evidence:
      "Validated across P2/P3, P4 Connect, and P5 Compression for the exact edge debug@2.6.9 -> ms@2.0.0. P6 does not contain this exact edge.",
  },

  {
    id: "E2",
    type: "EDGE",
    component:
      "on-finished@2.4.1 -> ee-first@1.1.1",

    products: e2Topo.products,
    productCount: e2Topo.productCount,
    rho: e2Topo.rho,

    contextsTested:
      Number(k5E2.contextsTested),

    activeContexts:
      Number(k5E2.activeContexts),

    inactiveContexts:
      Number(k5E2.inactiveContexts),

    alphaBar:
      Number(k5E2.alphaBar),

    qControlledActivePerturbations:
      Number(
        k5E2.qControlledActivePerturbations
      ),

    piBarPerturbed:
      Number(k5E2.piBarPerturbed),

    evidence:
      "Existing P1/P3 on-finished@2.4.1 -> ee-first@1.1.1 experiments. P4 uses on-finished@2.3.0; P5 and P6 do not contain the exact E2 relation.",
  },

  {
    id: "E3",
    type: "EDGE",
    component:
      "debug@4.4.3 -> ms@2.1.3",

    mechanismFamily:
      "debug -> ms timing-humanization",

    products: e3Topo.products,
    productCount: e3Topo.productCount,
    rho: e3Topo.rho,

    contextsTested:
      e3Contexts,

    activeContexts:
      e3Active,

    inactiveContexts:
      e3Inactive,

    alphaBar:
      e3AlphaBar,

    qControlledActivePerturbations: 1,

    piBarPerturbed:
      e3AlphaBar,

    auxiliaryControl:
      "P1 and P6 each also tested DEBUG-off/colors-on and correctly remained inactive. These controls are excluded from canonical alpha_bar.",

    evidence:
      "Exact E3 edge validated in two products: P6 Socket.IO/Engine.IO and P1 Express/Router. Both activation and deterministic controlled propagation reproduced the pre-specified colors/enabled gate.",
  },
];

const model = {
  name:
    "Six-product unified ecosystem model",

  K,

  products:
    ["P1", "P2", "P3", "P4", "P5", "P6"],

  productLabels: {
    P1: "Express",
    P2: "express-session",
    P3: "Morgan",
    P4: "Connect",
    P5: "compression",
    P6: "Socket.IO",
  },

  formalModel:
    "M_E = ({G_p}_{p=1..K}, C_s, mu, X, S, Lambda, Alpha, Q, Pi)",

  definitions: {
    rho:
      "rho_c = |mu(c)| / K",

    alpha:
      "alpha_c(p,x) = P(A_c=1 | T_c=1,p,x)",

    q:
      "q_c(p,x,s) = P(I_c=1 | A_c=1,p,x,s)",

    pi:
      "pi_c(p,x,s) = alpha_c(p,x) * q_c(p,x,s)",

    naturalRisk:
      "R_c = lambda_c * alpha_c * q_c only when a defensible natural lambda_c is available",
  },

  aggregationNote:
    "alphaBar is an unweighted descriptive average over designated canonical tested contexts, not an estimate of real-world workload frequency. Real deployment aggregation requires defensible context weights.",

  components,

  mechanismFamilies: [
    {
      family:
        "debug -> ms timing-humanization",

      exactEdges: [
        "debug@2.6.9 -> ms@2.0.0",
        "debug@4.4.3 -> ms@2.1.3",
      ],

      interpretation:
        "E1 and E3 show a repeated activation/propagation mechanism across different debug/ms version pairs. They remain separate exact package-version edges and must not be merged into one structural identity.",
    },
  ],

  principles: [
    "Structural reach is not runtime activation.",
    "Runtime activation is not conditional propagation.",
    "Controlled q=1 validates the deterministic mechanism under the tested perturbation; it is not a natural compromise/failure probability.",
    "Natural lambda remains unestimated.",
    "E3 provides both version-level and cross-product mechanism validation because the exact debug@4.4.3 -> ms@2.1.3 edge was tested in P1 and P6.",
    "E1 and E3 belong to the same observed mechanism family but remain distinct exact versioned edges.",
    "Exact package-version identity remains distinct from physical installed-instance identity.",
    "DEBUG-off activation controls are retained as auxiliary evidence but excluded from canonical alphaBar context aggregates.",
  ],
};

fs.writeFileSync(
  path.join(
    OUTDIR,
    "unified-ecosystem-model-6product.json"
  ),
  JSON.stringify(model, null, 2),
  "utf8"
);

const headers = [
  "id",
  "type",
  "component",
  "mechanismFamily",
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
    headers
      .map(h => csvEscape(row[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "unified-ecosystem-model-6product.csv"
  ),
  csv,
  "utf8"
);

const report = [];

report.push(
  "SIX-PRODUCT UNIFIED ECOSYSTEM MODEL"
);

report.push(
  "==================================="
);

report.push("");
report.push(`Products K=${K}`);

report.push(
  "P1=Express, P2=express-session, P3=Morgan, P4=Connect, P5=compression, P6=Socket.IO"
);

report.push("");

report.push("FORMAL MODEL");
report.push("------------");

report.push(
  "M_E = ({G_p}_{p=1..K}, C_s, mu, X, S, Lambda, Alpha, Q, Pi)"
);

report.push("");

report.push(
  "rho_c = |mu(c)| / K"
);

report.push(
  "pi_c = alpha_c * q_c"
);

report.push("");

report.push(
  "COMPONENT SIGNATURES"
);

report.push(
  "--------------------"
);

for (const c of components) {
  report.push(
    `${c.id} ${c.type}: ${c.component}`
  );

  if (c.mechanismFamily) {
    report.push(
      `  mechanism family=${c.mechanismFamily}`
    );
  }

  report.push(
    `  products=${c.products.join(",")} count=${c.productCount}/${K} rho=${fmt(c.rho)}`
  );

  report.push(
    `  canonical tested contexts=${c.contextsTested} active=${c.activeContexts} inactive=${c.inactiveContexts}`
  );

  report.push(
    `  alpha_bar=${fmt(c.alphaBar)} q_controlled=${fmt(c.qControlledActivePerturbations)} pi_bar_perturbed=${fmt(c.piBarPerturbed)}`
  );

  report.push(
    `  evidence=${c.evidence}`
  );

  if (c.auxiliaryControl) {
    report.push(
      `  auxiliary control=${c.auxiliaryControl}`
    );
  }
}

report.push("");

report.push(
  "K=5 -> K=6 STRUCTURAL CHANGES"
);

report.push(
  "-----------------------------"
);

report.push(
  `N1 depd@2.0.0: rho changed from ${fmt(k5N1.rho)} to ${fmt(depdTopo.rho)} because P6 does not contain the exact node.`
);

report.push(
  `E1 debug@2.6.9 -> ms@2.0.0: rho changed from ${fmt(k5E1.rho)} to ${fmt(e1Topo.rho)} because P6 does not contain the exact edge.`
);

report.push(
  `E2 on-finished@2.4.1 -> ee-first@1.1.1: rho changed from ${fmt(k5E2.rho)} to ${fmt(e2Topo.rho)} because P6 does not contain the exact edge.`
);

report.push(
  `E3 debug@4.4.3 -> ms@2.1.3 enters the unified model with products=${e3Topo.products.join(",")}, count=${e3Topo.productCount}/${K}, rho=${fmt(e3Topo.rho)}.`
);

report.push("");

report.push(
  "E3 VALIDATION"
);

report.push(
  "-------------"
);

report.push(
  "P6 Socket.IO/Engine.IO reproduced the pre-specified activation gate: DEBUG-enabled/colors-off inactive; DEBUG-enabled/colors-on active."
);

report.push(
  "P1 Express/Router independently reproduced the same exact E3 activation gate under a different parent and request workload."
);

report.push(
  "Both products reproduced deterministic controlled propagation: active CORRUPT_HUMANIZE, EMPTY_HUMANIZE, and DELAY_HUMANIZE each had q=1 and impact=1; inactive contexts blocked those perturbations through E3."
);

report.push(
  "Across canonical E3 contexts: active=2, inactive=2, alpha_bar=0.500."
);

report.push(
  "P1 and P6 DEBUG-off/colors-on controls also remained inactive and are retained as auxiliary controls, not included in canonical alpha_bar."
);

report.push("");

report.push(
  "VERSION-LEVEL MECHANISM GENERALIZATION"
);

report.push(
  "--------------------------------------"
);

report.push(
  "E1 and E3 are distinct exact edges but both support the observed debug->ms timing-humanization activation pattern under the tested DEBUG/colors contexts."
);

report.push(
  "This supports version-level mechanism generalization from debug@2.6.9 -> ms@2.0.0 to debug@4.4.3 -> ms@2.1.3."
);

report.push(
  "Because E3 was validated in both P1 and P6, it also has cross-product evidence for the exact new version pair."
);

report.push(
  "This does not establish generalization to unrelated dependency implementations."
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

report.push(
  "E1 and E3 must remain separate exact package-version edges even though they show a similar tested mechanism."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "unified-ecosystem-model-6product-report.txt"
  ),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));

console.log("");
console.log("Files created:");

console.log(
  "  results\\unified-ecosystem-model-6product\\unified-ecosystem-model-6product-report.txt"
);

console.log(
  "  results\\unified-ecosystem-model-6product\\unified-ecosystem-model-6product.csv"
);

console.log(
  "  results\\unified-ecosystem-model-6product\\unified-ecosystem-model-6product.json"
);
