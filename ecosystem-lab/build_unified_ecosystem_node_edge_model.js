#!/usr/bin/env node
"use strict";

/*
  build_unified_ecosystem_node_edge_model.js

  Unifies the current shared-node and shared-edge empirical evidence:

    N1: depd@2.0.0
    E1: debug@2.6.9 -> ms@2.0.0
    E2: on-finished@2.4.1 -> ee-first@1.1.1

  The model intentionally separates:
    topology membership/reach
    context-conditioned activation
    conditional propagation
    effective controlled impact

  It does NOT fabricate a natural failure/compromise rate lambda.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTDIR = path.join(
  ROOT,
  "results",
  "unified-ecosystem-model"
);

const TOTAL_PRODUCTS = 3;

const SOURCES = [
  {
    componentId: "N1",
    componentType: "NODE",
    component: "depd@2.0.0",
    activationMechanism: "workload-conditioned invocation",
    file: path.join(
      ROOT,
      "results",
      "ecosystem-model",
      "depd-ecosystem-empirical-matrix.json"
    ),
  },
  {
    componentId: "E1",
    componentType: "EDGE",
    component: "debug@2.6.9 -> ms@2.0.0",
    activationMechanism:
      "configuration-conditioned downstream execution",
    file: path.join(
      ROOT,
      "results",
      "shared-edge-model",
      "debug-ms-shared-edge-empirical-matrix.json"
    ),
  },
  {
    componentId: "E2",
    componentType: "EDGE",
    component:
      "on-finished@2.4.1 -> ee-first@1.1.1",
    activationMechanism:
      "workload-conditioned downstream execution",
    file: path.join(
      ROOT,
      "results",
      "onfinished-eefirst-model",
      "onfinished-eefirst-empirical-matrix.json"
    ),
  },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mustReadJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required source file not found:\n${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function firstDefined(obj, names) {
  for (const name of names) {
    if (
      obj &&
      obj[name] !== undefined &&
      obj[name] !== null
    ) {
      return obj[name];
    }
  }
  return null;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getRows(data) {
  const candidates = [
    data.matrix,
    data.rows,
    data.entries,
    data.results,
    data.empiricalMatrix,
    data.data,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  return [];
}

function normalizeRow(source, row) {
  const productId = firstDefined(row, [
    "productId",
    "product_id",
  ]);

  const product = firstDefined(row, [
    "product",
    "productName",
    "label",
  ]);

  const workload = firstDefined(row, [
    "workload",
    "workloadId",
    "scenario",
  ]);

  const configuration = firstDefined(row, [
    "configuration",
    "config",
    "condition",
  ]);

  const perturbation = firstDefined(row, [
    "perturbation",
    "fault",
    "attack",
    "faultType",
  ]);

  const topologyPresent = numOrNull(
    firstDefined(row, [
      "topologyPresent",
      "T_e",
      "T",
      "topology",
    ])
  );

  const loadRate = numOrNull(
    firstDefined(row, [
      "loadRate",
      "edgeLoadRate",
      "L_e",
      "L",
    ])
  );

  const activationRate = numOrNull(
    firstDefined(row, [
      "activationRate",
      "edgeActivationRate",
      "A_e_perturbation_experiment",
      "A_e",
      "alpha_e",
      "alpha",
      "A",
    ])
  );

  const q = numOrNull(
    firstDefined(row, [
      "qHatConditionalOnActive",
      "q_hat_conditional_on_active",
      "q_hat",
      "q_e",
      "q",
    ])
  );

  const pi = numOrNull(
    firstDefined(row, [
      "piHat",
      "pi_hat_model",
      "pi_hat",
      "pi_e",
      "pi",
    ])
  );

  const activeTrials = numOrNull(
    firstDefined(row, [
      "activeTrials",
      "active_trials",
    ])
  );

  const impactedTrials = numOrNull(
    firstDefined(row, [
      "impactedTrials",
      "impacted_trials",
    ])
  );

  const impactType =
    firstDefined(row, [
      "impactType",
      "impact",
      "impact_type",
    ]) || "NONE";

  const contextKey =
    workload !== null && workload !== undefined
      ? `${productId}::workload=${workload}`
      : `${productId}::configuration=${configuration}`;

  return {
    componentId: source.componentId,
    componentType: source.componentType,
    component: source.component,
    activationMechanism:
      source.activationMechanism,

    productId,
    product,
    workload,
    configuration,
    contextKey,
    perturbation,

    topologyPresent,
    loadRate,
    activationRate,
    qHatConditionalOnActive: q,
    piHat: pi,

    activeTrials,
    impactedTrials,
    impactType,
  };
}

function unique(values) {
  return [
    ...new Set(
      values.filter(
        (v) =>
          v !== null &&
          v !== undefined &&
          v !== ""
      )
    ),
  ];
}

function mean(values) {
  const xs = values.filter(
    (v) => typeof v === "number" && Number.isFinite(v)
  );
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function minVal(values) {
  const xs = values.filter(
    (v) => typeof v === "number" && Number.isFinite(v)
  );
  return xs.length ? Math.min(...xs) : null;
}

function maxVal(values) {
  const xs = values.filter(
    (v) => typeof v === "number" && Number.isFinite(v)
  );
  return xs.length ? Math.max(...xs) : null;
}

function fmt(v, digits = 3) {
  if (
    v === null ||
    v === undefined ||
    !Number.isFinite(Number(v))
  ) {
    return "NA";
  }
  return Number(v).toFixed(digits);
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function isBaseline(row) {
  return String(row.perturbation || "")
    .toUpperCase() === "BASELINE";
}

ensureDir(OUTDIR);

const normalizedRows = [];
const diagnostics = [];

for (const source of SOURCES) {
  const data = mustReadJson(source.file);
  const rows = getRows(data);

  if (!rows.length) {
    throw new Error(
      `No matrix/rows array found in ${source.file}\n` +
      `Top-level keys: ${Object.keys(data).join(", ")}`
    );
  }

  normalizedRows.push(
    ...rows.map((r) => normalizeRow(source, r))
  );

  diagnostics.push({
    componentId: source.componentId,
    component: source.component,
    sourceFile: path
      .relative(ROOT, source.file)
      .replaceAll("\\", "/"),
    sourceTopLevelKeys: Object.keys(data),
    rawRowCount: rows.length,
  });
}

const componentSummaries = [];

for (const source of SOURCES) {
  const rows = normalizedRows.filter(
    (r) => r.componentId === source.componentId
  );

  const products = unique(rows.map((r) => r.productId));

  // Deduplicate activation contexts because each perturbation repeats
  // the same workload/configuration context.
  const contextMap = new Map();

  for (const r of rows) {
    if (!contextMap.has(r.contextKey)) {
      contextMap.set(r.contextKey, r);
    } else {
      const current = contextMap.get(r.contextKey);

      // Prefer BASELINE for the activation-context representative.
      if (!isBaseline(current) && isBaseline(r)) {
        contextMap.set(r.contextKey, r);
      }
    }
  }

  const contexts = [...contextMap.values()];

  const activeContexts = contexts.filter(
    (r) =>
      r.activationRate !== null &&
      r.activationRate > 0
  );

  const inactiveContexts = contexts.filter(
    (r) => r.activationRate === 0
  );

  const perturbedRows = rows.filter(
    (r) => !isBaseline(r)
  );

  const activePerturbedRows = perturbedRows.filter(
    (r) =>
      r.activationRate !== null &&
      r.activationRate > 0
  );

  const impactedPerturbedRows =
    perturbedRows.filter(
      (r) =>
        r.piHat !== null &&
        r.piHat > 0
    );

  const activeImpactedRows =
    activePerturbedRows.filter(
      (r) =>
        r.piHat !== null &&
        r.piHat > 0
    );

  const membershipReach =
    products.length / TOTAL_PRODUCTS;

  const alphaBar = mean(
    contexts.map((r) => r.activationRate)
  );

  const qBarActive = mean(
    activePerturbedRows.map(
      (r) => r.qHatConditionalOnActive
    )
  );

  // Effective controlled impact over all tested perturbed
  // product-context-perturbation groups, including inactive controls.
  const piBarPerturbed = mean(
    perturbedRows.map((r) => r.piHat)
  );

  componentSummaries.push({
    componentId: source.componentId,
    componentType: source.componentType,
    component: source.component,
    activationMechanism:
      source.activationMechanism,

    membershipProducts: products,
    membershipCount: products.length,
    ecosystemProductCount: TOTAL_PRODUCTS,
    topologyReachRho: membershipReach,

    testedRows: rows.length,
    uniqueContexts: contexts.length,
    activeContexts: activeContexts.length,
    inactiveContexts: inactiveContexts.length,

    perturbedRows: perturbedRows.length,
    activePerturbedRows:
      activePerturbedRows.length,
    impactedPerturbedRows:
      impactedPerturbedRows.length,
    activeImpactedRows:
      activeImpactedRows.length,

    alphaBarTestedContexts: alphaBar,
    qBarActivePerturbations: qBarActive,
    piBarPerturbedGroups: piBarPerturbed,

    alphaMin: minVal(
      contexts.map((r) => r.activationRate)
    ),
    alphaMax: maxVal(
      contexts.map((r) => r.activationRate)
    ),
    qMin: minVal(
      activePerturbedRows.map(
        (r) => r.qHatConditionalOnActive
      )
    ),
    qMax: maxVal(
      activePerturbedRows.map(
        (r) => r.qHatConditionalOnActive
      )
    ),
    piMin: minVal(
      perturbedRows.map((r) => r.piHat)
    ),
    piMax: maxVal(
      perturbedRows.map((r) => r.piHat)
    ),
  });
}

const formalModel = {
  name:
    "Unified Context-Conditioned OSS Ecosystem Propagation Model",

  ecosystem:
    "M_E = ({G_p}_{p=1..K}, C_s, mu, X, S, Lambda, Alpha, Q, Pi)",

  definitions: {
    G_p:
      "Directed dependency graph for product p.",
    C_s:
      "Set of empirically studied shared components; components may be shared nodes or shared exact dependency edges.",
    mu:
      "mu(c) is the set of products containing shared component c.",
    rho:
      "rho_c = |mu(c)| / K, the topological ecosystem reach of component c.",
    x:
      "Execution context, including workload and/or configuration.",
    s:
      "Controlled perturbation/failure mode.",
    lambda:
      "lambda_c(s) is a natural occurrence/failure rate if defensibly estimated from external or longitudinal evidence; currently unestimated.",
    alpha:
      "alpha_c(p,x) = P(A_c=1 | T_c(p)=1, x), context-conditioned activation.",
    q:
      "q_c(p,x,s) = P(I_c=1 | A_c=1,p,x,s), propagation conditional on activation.",
    pi:
      "pi_c(p,x,s) = alpha_c(p,x) * q_c(p,x,s), effective controlled impact.",
  },

  optionalFutureRateModel:
    "R_c(p,x,s) = lambda_c(s) * alpha_c(p,x) * q_c(p,x,s)",

  noScalarRiskYet:
    "No single ecosystem risk scalar is claimed because lambda is unestimated and the current perturbations are controlled mechanisms rather than natural incident frequencies.",
};

const output = {
  formalModel,
  sourceDiagnostics: diagnostics,
  componentSummaries,
  normalizedRows,
};

fs.writeFileSync(
  path.join(
    OUTDIR,
    "unified-ecosystem-node-edge-model.json"
  ),
  JSON.stringify(output, null, 2),
  "utf8"
);

const matrixHeaders = [
  "componentId",
  "componentType",
  "component",
  "activationMechanism",
  "productId",
  "product",
  "workload",
  "configuration",
  "contextKey",
  "perturbation",
  "topologyPresent",
  "loadRate",
  "activationRate",
  "qHatConditionalOnActive",
  "piHat",
  "activeTrials",
  "impactedTrials",
  "impactType",
];

const matrixCsv = [
  matrixHeaders.join(","),
  ...normalizedRows.map((r) =>
    matrixHeaders
      .map((h) => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "unified-ecosystem-component-matrix.csv"
  ),
  matrixCsv,
  "utf8"
);

const summaryHeaders = [
  "componentId",
  "componentType",
  "component",
  "activationMechanism",
  "membershipProducts",
  "membershipCount",
  "ecosystemProductCount",
  "topologyReachRho",
  "testedRows",
  "uniqueContexts",
  "activeContexts",
  "inactiveContexts",
  "perturbedRows",
  "activePerturbedRows",
  "impactedPerturbedRows",
  "alphaBarTestedContexts",
  "qBarActivePerturbations",
  "piBarPerturbedGroups",
  "alphaMin",
  "alphaMax",
  "qMin",
  "qMax",
  "piMin",
  "piMax",
];

const summaryCsv = [
  summaryHeaders.join(","),
  ...componentSummaries.map((s) => {
    const copy = {
      ...s,
      membershipProducts:
        s.membershipProducts.join("|"),
    };

    return summaryHeaders
      .map((h) => csvEscape(copy[h]))
      .join(",");
  }),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "unified-ecosystem-component-summary.csv"
  ),
  summaryCsv,
  "utf8"
);

const report = [];

report.push(
  "UNIFIED OSS ECOSYSTEM NODE-AND-EDGE PROPAGATION MODEL"
);
report.push(
  "======================================================"
);
report.push("");

report.push("FORMAL ECOSYSTEM");
report.push("----------------");
report.push(
  "M_E = ({G_p}_{p=1..K}, C_s, mu, X, S, Lambda, Alpha, Q, Pi)"
);
report.push("");
report.push(
  "G_p     : directed dependency graph for product p"
);
report.push(
  "C_s     : studied shared components (nodes and exact edges)"
);
report.push(
  "mu(c)   : products containing component c"
);
report.push(
  "rho_c   : |mu(c)| / K, topological ecosystem reach"
);
report.push(
  "x       : execution context (workload/configuration)"
);
report.push(
  "s       : controlled perturbation/failure mode"
);
report.push("");

report.push("COMPONENT-LEVEL MODEL");
report.push("---------------------");
report.push(
  "alpha_c(p,x) = P(A_c=1 | T_c(p)=1, x)"
);
report.push(
  "q_c(p,x,s) = P(I_c=1 | A_c=1, p, x, s)"
);
report.push(
  "pi_c(p,x,s) = alpha_c(p,x) * q_c(p,x,s)"
);
report.push("");
report.push(
  "If a defensible natural occurrence/failure rate later becomes available:"
);
report.push(
  "R_c(p,x,s) = lambda_c(s) * alpha_c(p,x) * q_c(p,x,s)"
);
report.push("");
report.push(
  "lambda_c is intentionally UNESTIMATED in the current controlled experiments."
);
report.push("");

report.push("EMPIRICAL COMPONENT SUMMARIES");
report.push("-----------------------------");

for (const s of componentSummaries) {
  report.push(
    `${s.componentId} [${s.componentType}] ${s.component}`
  );
  report.push(
    `  products: ${s.membershipProducts.join(", ")}`
  );
  report.push(
    `  topology reach rho: ${fmt(s.topologyReachRho)} (${s.membershipCount}/${s.ecosystemProductCount} products)`
  );
  report.push(
    `  activation mechanism: ${s.activationMechanism}`
  );
  report.push(
    `  unique tested contexts: ${s.uniqueContexts}`
  );
  report.push(
    `  active contexts: ${s.activeContexts}`
  );
  report.push(
    `  inactive contexts: ${s.inactiveContexts}`
  );
  report.push(
    `  mean activation alpha_bar over tested contexts: ${fmt(s.alphaBarTestedContexts)}`
  );
  report.push(
    `  mean q over active perturbed groups: ${fmt(s.qBarActivePerturbations)}`
  );
  report.push(
    `  mean pi over all perturbed groups: ${fmt(s.piBarPerturbedGroups)}`
  );
  report.push(
    `  alpha range: ${fmt(s.alphaMin)} to ${fmt(s.alphaMax)}`
  );
  report.push(
    `  q range on active perturbations: ${fmt(s.qMin)} to ${fmt(s.qMax)}`
  );
  report.push(
    `  pi range on perturbed groups: ${fmt(s.piMin)} to ${fmt(s.piMax)}`
  );
  report.push("");
}

report.push("GENERALIZED INTERPRETATION");
report.push("--------------------------");
report.push(
  "1. Shared topology defines where propagation is structurally possible, not where it is guaranteed."
);
report.push(
  "2. Runtime activation is context-dependent and can be controlled by workload, configuration, or both."
);
report.push(
  "3. Conditional propagation q is meaningful only after the component is active."
);
report.push(
  "4. Effective controlled impact pi combines activation with propagation."
);
report.push(
  "5. Topological reach rho distinguishes a component shared by all products from one shared by only a subset."
);
report.push(
  "6. A natural failure/compromise rate lambda must come from defensible real occurrence data; it is not inferred from deterministic perturbation experiments."
);
report.push("");
report.push(
  "No single ecosystem risk score is claimed at this stage."
);
report.push(
  "The current evidence supports a vector-valued component signature:"
);
report.push(
  "  Sigma_c = (rho_c, alpha_c, q_c, pi_c)"
);
report.push(
  "with lambda_c added later when a defensible occurrence model is available."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "unified-ecosystem-node-edge-model-report.txt"
  ),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results/unified-ecosystem-model/unified-ecosystem-node-edge-model-report.txt"
);
console.log(
  "  results/unified-ecosystem-model/unified-ecosystem-component-matrix.csv"
);
console.log(
  "  results/unified-ecosystem-model/unified-ecosystem-component-summary.csv"
);
console.log(
  "  results/unified-ecosystem-model/unified-ecosystem-node-edge-model.json"
);
