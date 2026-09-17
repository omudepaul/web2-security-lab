#!/usr/bin/env node
"use strict";

/*
  FOUR-PRODUCT COMPARISON TABLE

  Purpose:
    Produce an advisor-ready P1-P4 structural/evidence comparison
    from the corrected K=4 topology and unified model.

  This is descriptive. It does not create a natural risk score.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTDIR = path.join(ROOT, "results", "four-product-comparison");

const TOPOLOGY_FILE = path.join(
  ROOT,
  "results",
  "ecosystem-topology-4product-corrected",
  "ecosystem-topology-4product-corrected.json"
);

const UNIFIED_FILE = path.join(
  ROOT,
  "results",
  "unified-ecosystem-model-4product",
  "unified-ecosystem-model-4product.json"
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
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

ensureDir(OUTDIR);

const topology = readJson(TOPOLOGY_FILE);
const unified = readJson(UNIFIED_FILE);

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
    component: "on-finished@2.4.1 -> ee-first@1.1.1",
    kind: "EDGE",
  },
];

const membershipRows = [];

for (const p of ["P1", "P2", "P3", "P4"]) {
  const row = { productId: p };

  for (const c of components) {
    const modelComp = unified.components.find(x => x.id === c.id);
    row[c.id] = modelComp.products.includes(p) ? "YES" : "NO";
  }

  membershipRows.push(row);
}

const evidenceRows = [
  {
    productId: "P1",
    product: "Express",
    N1: "Studied in depd experiments",
    E1: "Exact edge absent",
    E2: "Studied in activation/propagation experiments",
  },
  {
    productId: "P2",
    product: "express-session",
    N1: "Studied in depd experiments",
    E1: "Studied in debug->ms experiments",
    E2: "Exact edge absent",
  },
  {
    productId: "P3",
    product: "Morgan",
    N1: "Studied in depd experiments",
    E1: "Studied in debug->ms and multi-hop experiments",
    E2: "Studied in on-finished->ee-first and multi-hop experiments",
  },
  {
    productId: "P4",
    product: "Connect",
    N1: "Exact node absent",
    E1: "Pre-specified activation + propagation validation PASS",
    E2: "Exact 2.4.1 edge absent; P4 has on-finished@2.3.0",
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
    structuralHeaders.map(h => csvEscape(r[h])).join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(OUTDIR, "p1-p4-structural-comparison.csv"),
  structuralCsv,
  "utf8"
);

const membershipHeaders = ["productId", "N1", "E1", "E2"];
const membershipCsv = [
  membershipHeaders.join(","),
  ...membershipRows.map(r =>
    membershipHeaders.map(h => csvEscape(r[h])).join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(OUTDIR, "p1-p4-component-membership.csv"),
  membershipCsv,
  "utf8"
);

const evidenceHeaders = ["productId", "product", "N1", "E1", "E2"];
const evidenceCsv = [
  evidenceHeaders.join(","),
  ...evidenceRows.map(r =>
    evidenceHeaders.map(h => csvEscape(r[h])).join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(OUTDIR, "p1-p4-evidence-comparison.csv"),
  evidenceCsv,
  "utf8"
);

const report = [];

report.push("FOUR-PRODUCT COMPARISON");
report.push("=======================");
report.push("");
report.push("PRODUCT STRUCTURE");
report.push("-----------------");

for (const p of productRows) {
  report.push(`${p.productId} ${p.label}`);
  report.push(
    `  nodes=${p.packageNodeInstances} exactIdentities=${p.exactIdentities} totalEdgesIncludingRoot=${p.totalEdgesIncludingRoot}`
  );
  report.push(
    `  DAG=${p.physicalDAG} maxDepth=${p.maxDepthIncludingRoot} duplicateNames=${p.duplicatePackageNames} unresolved=${p.unresolvedDependencies}`
  );
}

report.push("");
report.push("COMPONENT MEMBERSHIP");
report.push("--------------------");
report.push("N1 = depd@2.0.0");
report.push("E1 = debug@2.6.9 -> ms@2.0.0");
report.push("E2 = on-finished@2.4.1 -> ee-first@1.1.1");
report.push("");

for (const r of membershipRows) {
  report.push(`${r.productId}: N1=${r.N1} E1=${r.E1} E2=${r.E2}`);
}

report.push("");
report.push("EXPERIMENTAL EVIDENCE");
report.push("---------------------");

for (const r of evidenceRows) {
  report.push(`${r.productId} ${r.product}`);
  report.push(`  N1: ${r.N1}`);
  report.push(`  E1: ${r.E1}`);
  report.push(`  E2: ${r.E2}`);
}

report.push("");
report.push("CURRENT COMPONENT SIGNATURES");
report.push("----------------------------");

for (const c of unified.components) {
  report.push(
    `${c.id} ${c.component}: rho=${Number(c.rho).toFixed(3)} alpha_bar=${Number(c.alphaBar).toFixed(3)} q_controlled=${Number(c.qControlledActivePerturbations).toFixed(3)} pi_bar=${Number(c.piBarPerturbed).toFixed(3)}`
  );
}

report.push("");
report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "The four products differ in topology, exact component membership, and experimentally observed runtime behavior."
);
report.push(
  "P4 Connect provides a new parent-product validation environment for E1 while also changing ecosystem structural reach values."
);
report.push(
  "No natural lambda is estimated, so this comparison does not rank products by natural risk."
);

fs.writeFileSync(
  path.join(OUTDIR, "four-product-comparison-report.txt"),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log("  results\\four-product-comparison\\four-product-comparison-report.txt");
console.log("  results\\four-product-comparison\\p1-p4-structural-comparison.csv");
console.log("  results\\four-product-comparison\\p1-p4-component-membership.csv");
console.log("  results\\four-product-comparison\\p1-p4-evidence-comparison.csv");
