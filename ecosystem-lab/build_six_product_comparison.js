#!/usr/bin/env node
"use strict";

/*
  SIX-PRODUCT COMPARISON TABLE

  Purpose:
    Produce an advisor-ready P1-P6 structural/evidence comparison
    from the corrected K=6 topology and K=6 unified model.

  This is descriptive.
  It does not estimate natural lambda and does not create a natural risk score.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTDIR = path.join(ROOT, "results", "six-product-comparison");

const TOPOLOGY_FILE = path.join(
  ROOT,
  "results",
  "ecosystem-topology-6product",
  "ecosystem-topology-6product.json"
);

const UNIFIED_FILE = path.join(
  ROOT,
  "results",
  "unified-ecosystem-model-6product",
  "unified-ecosystem-model-6product.json"
);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required file:\n${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function fmt(v, d = 3) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "NA";
  }
  return Number(v).toFixed(d);
}

ensureDir(OUTDIR);

const topology = readJson(TOPOLOGY_FILE);
const unified = readJson(UNIFIED_FILE);

const requiredEcosystemFields = [
  "physicalPackageInstances",
  "sumPerProductExactIdentities",
  "uniqueExactNodes",
  "sharedExactNodesAtLeast2",
  "uniqueExactNonRootEdges",
  "sharedExactNonRootEdgesAtLeast2",
];

for (const field of requiredEcosystemFields) {
  if (topology.ecosystem[field] === undefined) {
    throw new Error(`Missing expected K=6 ecosystem field: ${field}`);
  }
}

if (Number(topology.ecosystem.K) !== 6) {
  throw new Error(
    `Expected K=6 topology, got K=${topology.ecosystem.K}`
  );
}

if (Number(unified.K) !== 6) {
  throw new Error(
    `Expected K=6 unified model, got K=${unified.K}`
  );
}

const expectedComponents = ["N1", "E1", "E2", "E3"];

for (const id of expectedComponents) {
  if (!unified.components.find(c => c.id === id)) {
    throw new Error(
      `Missing component ${id} in K=6 unified model`
    );
  }
}

const productRows = topology.products.map(p => ({
  productId: p.productId,
  label: p.label,
  root: `${p.rootName}${p.rootVersion ? "@" + p.rootVersion : ""}`,
  packageNodeInstances: p.packageNodeInstances,
  exactIdentities: p.exactPackageVersionIdentities,
  nonRootPhysicalEdges: p.nonRootPhysicalDependencyEdges,
  rootDirectEdges: p.rootDirectEdges,
  totalEdgesIncludingRoot: p.totalPhysicalEdgesIncludingRoot,
  physicalDAG: p.physicalDAG ? "YES" : "NO",
  maxDepthIncludingRoot: p.physicalMaxDepthIncludingRoot,
  duplicatePackageNames: p.duplicatePackageNameCount,
  unresolvedDependencies: p.unresolvedDependencies.length,
}));

const components = [
  {
    id: "N1",
    component: "depd@2.0.0",
    kind: "NODE",
  },
  {
    id: "E1",
    component: "debug@2.6.9 -> ms@2.0.0",
    kind: "EDGE",
  },
  {
    id: "E2",
    component:
      "on-finished@2.4.1 -> ee-first@1.1.1",
    kind: "EDGE",
  },
  {
    id: "E3",
    component: "debug@4.4.3 -> ms@2.1.3",
    kind: "EDGE",
  },
];

const productIds =
  ["P1", "P2", "P3", "P4", "P5", "P6"];

const membershipRows = [];

for (const productId of productIds) {
  const row = { productId };

  for (const c of components) {
    const modelComp =
      unified.components.find(x => x.id === c.id);

    row[c.id] =
      modelComp.products.includes(productId)
        ? "YES"
        : "NO";
  }

  membershipRows.push(row);
}

const evidenceRows = [
  {
    productId: "P1",
    product: "Express",
    N1:
      "Studied in depd activation/perturbation experiments",
    E1:
      "Exact edge absent",
    E2:
      "Studied in activation/propagation and multi-hop experiments",
    E3:
      "Pre-specified Router activation + propagation validation PASS",
  },
  {
    productId: "P2",
    product: "express-session",
    N1:
      "Studied in depd activation/perturbation experiments",
    E1:
      "Studied in debug->ms activation/propagation experiments",
    E2:
      "Exact edge absent",
    E3:
      "Exact edge absent",
  },
  {
    productId: "P3",
    product: "Morgan",
    N1:
      "Studied in depd activation/perturbation experiments",
    E1:
      "Studied in debug->ms and multi-hop experiments",
    E2:
      "Studied in on-finished->ee-first and multi-hop experiments",
    E3:
      "Exact edge absent",
  },
  {
    productId: "P4",
    product: "Connect",
    N1:
      "Exact node absent",
    E1:
      "Pre-specified activation + propagation validation PASS",
    E2:
      "Exact 2.4.1 edge absent; P4 has on-finished@2.3.0",
    E3:
      "Exact edge absent",
  },
  {
    productId: "P5",
    product: "compression",
    N1:
      "Exact node absent",
    E1:
      "Pre-specified activation + propagation validation PASS",
    E2:
      "Exact edge absent",
    E3:
      "Exact edge absent",
  },
  {
    productId: "P6",
    product: "Socket.IO",
    N1:
      "Exact node absent",
    E1:
      "Exact edge absent",
    E2:
      "Exact edge absent",
    E3:
      "Pre-specified Engine.IO activation + propagation validation PASS",
  },
];

const structuralHeaders = [
  "productId",
  "label",
  "root",
  "packageNodeInstances",
  "exactIdentities",
  "nonRootPhysicalEdges",
  "rootDirectEdges",
  "totalEdgesIncludingRoot",
  "physicalDAG",
  "maxDepthIncludingRoot",
  "duplicatePackageNames",
  "unresolvedDependencies",
];

const structuralCsv = [
  structuralHeaders.join(","),
  ...productRows.map(r =>
    structuralHeaders
      .map(h => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "p1-p6-structural-comparison.csv"
  ),
  structuralCsv,
  "utf8"
);

const membershipHeaders =
  ["productId", "N1", "E1", "E2", "E3"];

const membershipCsv = [
  membershipHeaders.join(","),
  ...membershipRows.map(r =>
    membershipHeaders
      .map(h => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "p1-p6-component-membership.csv"
  ),
  membershipCsv,
  "utf8"
);

const evidenceHeaders =
  ["productId", "product", "N1", "E1", "E2", "E3"];

const evidenceCsv = [
  evidenceHeaders.join(","),
  ...evidenceRows.map(r =>
    evidenceHeaders
      .map(h => csvEscape(r[h]))
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "p1-p6-evidence-comparison.csv"
  ),
  evidenceCsv,
  "utf8"
);

/*
  Add a component-signature CSV so the P1-P6 comparison
  directly captures the current unified-model signatures.
*/

const signatureHeaders = [
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
];

const signatureCsv = [
  signatureHeaders.join(","),
  ...unified.components.map(r =>
    signatureHeaders
      .map(h =>
        csvEscape(
          Array.isArray(r[h])
            ? r[h].join(";")
            : r[h]
        )
      )
      .join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(
    OUTDIR,
    "p1-p6-component-signatures.csv"
  ),
  signatureCsv,
  "utf8"
);

const report = [];

report.push("SIX-PRODUCT COMPARISON");
report.push("======================");
report.push("");

report.push("PRODUCT STRUCTURE");
report.push("-----------------");

for (const p of productRows) {
  report.push(
    `${p.productId} ${p.label}`
  );

  report.push(
    `  nodes=${p.packageNodeInstances} exactIdentities=${p.exactIdentities} nonRootEdges=${p.nonRootPhysicalEdges} totalEdgesIncludingRoot=${p.totalEdgesIncludingRoot}`
  );

  report.push(
    `  DAG=${p.physicalDAG} maxDepth=${p.maxDepthIncludingRoot} duplicateNames=${p.duplicatePackageNames} unresolved=${p.unresolvedDependencies}`
  );
}

report.push("");
report.push("K=6 ECOSYSTEM STRUCTURE");
report.push("-----------------------");

report.push(
  `physical package instances=${topology.ecosystem.physicalPackageInstances}`
);

report.push(
  `sum exact identities across products=${topology.ecosystem.sumPerProductExactIdentities}`
);

report.push(
  `unique exact nodes=${topology.ecosystem.uniqueExactNodes}`
);

report.push(
  `shared exact nodes (>=2 products)=${topology.ecosystem.sharedExactNodesAtLeast2}`
);

report.push(
  `unique exact non-root edges=${topology.ecosystem.uniqueExactNonRootEdges}`
);

report.push(
  `shared exact non-root edges (>=2 products)=${topology.ecosystem.sharedExactNonRootEdgesAtLeast2}`
);

report.push("");

report.push("COMPONENT MEMBERSHIP");
report.push("--------------------");
report.push("N1 = depd@2.0.0");
report.push("E1 = debug@2.6.9 -> ms@2.0.0");
report.push(
  "E2 = on-finished@2.4.1 -> ee-first@1.1.1"
);
report.push("E3 = debug@4.4.3 -> ms@2.1.3");
report.push("");

for (const r of membershipRows) {
  report.push(
    `${r.productId}: N1=${r.N1} E1=${r.E1} E2=${r.E2} E3=${r.E3}`
  );
}

report.push("");
report.push("EXPERIMENTAL EVIDENCE");
report.push("---------------------");

for (const r of evidenceRows) {
  report.push(
    `${r.productId} ${r.product}`
  );

  report.push(`  N1: ${r.N1}`);
  report.push(`  E1: ${r.E1}`);
  report.push(`  E2: ${r.E2}`);
  report.push(`  E3: ${r.E3}`);
}

report.push("");
report.push("CURRENT COMPONENT SIGNATURES");
report.push("----------------------------");

for (const c of unified.components) {
  report.push(
    `${c.id} ${c.component}: products=${c.products.join(",")} rho=${fmt(c.rho)} alpha_bar=${fmt(c.alphaBar)} q_controlled=${fmt(c.qControlledActivePerturbations)} pi_bar=${fmt(c.piBarPerturbed)}`
  );
}

report.push("");
report.push("K=5 -> K=6 CHANGE SUMMARY");
report.push("-------------------------");

report.push(
  "N1 depd@2.0.0: structural reach decreased from 0.600 to 0.500 because P6 does not contain the exact node."
);

report.push(
  "E1 debug@2.6.9 -> ms@2.0.0: structural reach decreased from 0.800 to 0.667 because P6 does not contain the exact edge."
);

report.push(
  "E2 on-finished@2.4.1 -> ee-first@1.1.1: structural reach decreased from 0.400 to 0.333 because P6 does not contain the exact edge."
);

report.push(
  "E3 debug@4.4.3 -> ms@2.1.3 enters the comparison as a new exact shared edge in P1 and P6 with rho=0.333."
);

report.push("");

report.push("E3 CROSS-PRODUCT VALIDATION");
report.push("---------------------------");

report.push(
  "P6 Socket.IO/Engine.IO first validated the new exact E3 version pair under a network-handshake workload."
);

report.push(
  "P1 Express/Router then reproduced the same pre-specified activation and controlled propagation mechanism under a different parent and HTTP request workload."
);

report.push(
  "This gives E3 both version-level evidence relative to E1 and cross-product evidence for the exact E3 version pair."
);

report.push(
  "E1 and E3 remain separate exact package-version edges even though both belong to the observed debug->ms timing-humanization mechanism family."
);

report.push("");

report.push("INTERPRETATION");
report.push("--------------");

report.push(
  "The six products differ in topology, exact component membership, and experimentally observed runtime behavior."
);

report.push(
  "Structural membership alone does not establish runtime activation or propagation."
);

report.push(
  "E1 has repeated cross-product evidence for debug@2.6.9 -> ms@2.0.0 across P2/P3/P4/P5."
);

report.push(
  "E3 has cross-product evidence for debug@4.4.3 -> ms@2.1.3 across P1/P6."
);

report.push(
  "The similarity between E1 and E3 supports version-level mechanism generalization within the tested debug->ms family, not generalization to unrelated dependency implementations."
);

report.push(
  "This comparison does not estimate natural lambda and does not rank products by natural risk."
);

fs.writeFileSync(
  path.join(
    OUTDIR,
    "six-product-comparison-report.txt"
  ),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");

console.log(
  "  results\\six-product-comparison\\six-product-comparison-report.txt"
);

console.log(
  "  results\\six-product-comparison\\p1-p6-structural-comparison.csv"
);

console.log(
  "  results\\six-product-comparison\\p1-p6-component-membership.csv"
);

console.log(
  "  results\\six-product-comparison\\p1-p6-evidence-comparison.csv"
);

console.log(
  "  results\\six-product-comparison\\p1-p6-component-signatures.csv"
);
