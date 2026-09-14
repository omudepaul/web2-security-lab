#!/usr/bin/env node
"use strict";

/*
  ecosystem_topology_analyzer.js

  Builds a multi-product open-source dependency ecosystem from three
  independently generated dependency-topology.json files.

  Expected folders under the current directory:
    product-express/
    product-session/
    product-morgan/

  Exact ecosystem node identity:
    package-name@installed-version

  This means:
    debug@4.4.3 != debug@2.6.9

  The analyzer also reports "same package name, different version"
  overlaps separately.

  Ecosystem model:
    G_E = ( union_k V_k, union_k E_k )

  Outputs:
    ecosystem-topology.json
    ecosystem-shared-nodes.csv
    ecosystem-shared-edges.csv
    ecosystem-version-overlaps.csv
    ecosystem-topology.dot
    ecosystem-topology-report.txt
*/

const fs = require("fs");
const path = require("path");

const baseDir = process.cwd();

const productConfigs = [
  {
    id: "P1",
    label: "Express",
    dir: "product-express",
  },
  {
    id: "P2",
    label: "express-session",
    dir: "product-session",
  },
  {
    id: "P3",
    label: "Morgan",
    dir: "product-morgan",
  },
];

function die(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    die(`Missing file:\n${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function exactKey(name, version) {
  return `${name}@${version}`;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(filePath, headers, rows) {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) =>
      headers.map((h) => csvEscape(row[h])).join(",")
    ),
  ];

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

// ---------------------------------------------------------------------
// Load product graphs
// ---------------------------------------------------------------------

const products = productConfigs.map((cfg) => {
  const filePath = path.join(
    baseDir,
    cfg.dir,
    "dependency-topology.json"
  );

  const graph = readJson(filePath);

  return {
    ...cfg,
    filePath,
    graph,
  };
});

// ---------------------------------------------------------------------
// Build exact package-version ecosystem node membership
// ---------------------------------------------------------------------

const ecosystemNodes = new Map();
const nameVersionMembership = new Map();
const packageNameMembership = new Map();

for (const product of products) {
  const idToNode = new Map();

  for (const node of product.graph.nodes || []) {
    idToNode.set(node.id, node);
  }

  product.idToNode = idToNode;

  // Exclude the synthetic/local project root from shared package analysis.
  const packageNodes = (product.graph.nodes || []).filter(
    (n) => n.id !== "ROOT" && n.packagePath !== ""
  );

  for (const node of packageNodes) {
    const key = exactKey(node.name, node.version);

    if (!ecosystemNodes.has(key)) {
      ecosystemNodes.set(key, {
        key,
        name: node.name,
        version: node.version,
        products: new Set(),
        productIds: new Set(),
        instancesByProduct: {},
        minimumDepthByProduct: {},
        maximumInDegreeByProduct: {},
        maximumOutDegreeByProduct: {},
      });
    }

    const record = ecosystemNodes.get(key);

    record.products.add(product.label);
    record.productIds.add(product.id);
    record.instancesByProduct[product.id] =
      (record.instancesByProduct[product.id] || 0) + 1;

    const depth = node.depth ?? null;

    if (
      record.minimumDepthByProduct[product.id] === undefined ||
      (depth !== null &&
        depth < record.minimumDepthByProduct[product.id])
    ) {
      record.minimumDepthByProduct[product.id] = depth;
    }

    record.maximumInDegreeByProduct[product.id] = Math.max(
      record.maximumInDegreeByProduct[product.id] || 0,
      node.inDegree || 0
    );

    record.maximumOutDegreeByProduct[product.id] = Math.max(
      record.maximumOutDegreeByProduct[product.id] || 0,
      node.outDegree || 0
    );

    if (!nameVersionMembership.has(key)) {
      nameVersionMembership.set(key, new Set());
    }
    nameVersionMembership.get(key).add(product.id);

    if (!packageNameMembership.has(node.name)) {
      packageNameMembership.set(node.name, {
        name: node.name,
        products: new Set(),
        versionsByProduct: {},
      });
    }

    const nameRec = packageNameMembership.get(node.name);
    nameRec.products.add(product.id);

    if (!nameRec.versionsByProduct[product.id]) {
      nameRec.versionsByProduct[product.id] = new Set();
    }

    nameRec.versionsByProduct[product.id].add(node.version);
  }
}

// ---------------------------------------------------------------------
// Build exact package-version ecosystem edges
// ---------------------------------------------------------------------

const ecosystemEdges = new Map();

for (const product of products) {
  const idToNode = product.idToNode;

  for (const edge of product.graph.edges || []) {
    // Skip root -> direct dependency for shared-edge analysis only if
    // source is ROOT. Root/product attachment is product-specific.
    if (edge.source === "ROOT") continue;

    const sourceNode = idToNode.get(edge.source);
    const targetNode = idToNode.get(edge.target);

    if (!sourceNode || !targetNode) continue;

    const sourceKey = exactKey(
      sourceNode.name,
      sourceNode.version
    );

    const targetKey = exactKey(
      targetNode.name,
      targetNode.version
    );

    const edgeKey = `${sourceKey} -> ${targetKey}`;

    if (!ecosystemEdges.has(edgeKey)) {
      ecosystemEdges.set(edgeKey, {
        key: edgeKey,
        source: sourceKey,
        target: targetKey,
        sourceName: sourceNode.name,
        sourceVersion: sourceNode.version,
        targetName: targetNode.name,
        targetVersion: targetNode.version,
        products: new Set(),
        productIds: new Set(),
        occurrencesByProduct: {},
      });
    }

    const rec = ecosystemEdges.get(edgeKey);

    rec.products.add(product.label);
    rec.productIds.add(product.id);
    rec.occurrencesByProduct[product.id] =
      (rec.occurrencesByProduct[product.id] || 0) + 1;
  }
}

// ---------------------------------------------------------------------
// Shared exact nodes and shared exact edges
// ---------------------------------------------------------------------

const exactNodeRows = [...ecosystemNodes.values()]
  .map((r) => ({
    key: r.key,
    name: r.name,
    version: r.version,
    productCount: r.productIds.size,
    products: [...r.products].sort(),
    productIds: [...r.productIds].sort(),
    instancesByProduct: r.instancesByProduct,
    minimumDepthByProduct: r.minimumDepthByProduct,
    maximumInDegreeByProduct: r.maximumInDegreeByProduct,
    maximumOutDegreeByProduct: r.maximumOutDegreeByProduct,
  }))
  .sort(
    (a, b) =>
      b.productCount - a.productCount ||
      a.key.localeCompare(b.key)
  );

const sharedExactNodes = exactNodeRows.filter(
  (r) => r.productCount > 1
);

const exactEdgeRows = [...ecosystemEdges.values()]
  .map((r) => ({
    edge: r.key,
    source: r.source,
    target: r.target,
    productCount: r.productIds.size,
    products: [...r.products].sort(),
    productIds: [...r.productIds].sort(),
    occurrencesByProduct: r.occurrencesByProduct,
  }))
  .sort(
    (a, b) =>
      b.productCount - a.productCount ||
      a.edge.localeCompare(b.edge)
  );

const sharedExactEdges = exactEdgeRows.filter(
  (r) => r.productCount > 1
);

// ---------------------------------------------------------------------
// Same-name / different-version overlaps
// ---------------------------------------------------------------------

const versionOverlapRows = [];

for (const rec of packageNameMembership.values()) {
  if (rec.products.size < 2) continue;

  const allVersions = new Set();

  const versionsByProduct = {};

  for (const product of products) {
    const versions =
      rec.versionsByProduct[product.id]
        ? [...rec.versionsByProduct[product.id]].sort()
        : [];

    if (versions.length) {
      versionsByProduct[product.id] = versions;
      versions.forEach((v) => allVersions.add(v));
    }
  }

  if (allVersions.size > 1) {
    versionOverlapRows.push({
      packageName: rec.name,
      productCount: rec.products.size,
      products: [...rec.products].sort(),
      versions: [...allVersions].sort(),
      versionsByProduct,
    });
  }
}

versionOverlapRows.sort(
  (a, b) =>
    b.productCount - a.productCount ||
    a.packageName.localeCompare(b.packageName)
);

// ---------------------------------------------------------------------
// Pairwise exact-node intersections
// ---------------------------------------------------------------------

function productNodeSet(productId) {
  const set = new Set();

  for (const row of exactNodeRows) {
    if (row.productIds.includes(productId)) {
      set.add(row.key);
    }
  }

  return set;
}

const nodeSets = Object.fromEntries(
  products.map((p) => [p.id, productNodeSet(p.id)])
);

function intersection(a, b) {
  return [...a].filter((x) => b.has(x)).sort();
}

const pairwise = [];

for (let i = 0; i < products.length; i++) {
  for (let j = i + 1; j < products.length; j++) {
    const a = products[i];
    const b = products[j];

    const shared = intersection(
      nodeSets[a.id],
      nodeSets[b.id]
    );

    pairwise.push({
      productA: a.id,
      productALabel: a.label,
      productB: b.id,
      productBLabel: b.label,
      exactSharedNodeCount: shared.length,
      exactSharedNodes: shared,
    });
  }
}

const allThreeExactNodes = exactNodeRows
  .filter((r) => r.productCount === products.length)
  .map((r) => r.key);

const allThreeExactEdges = exactEdgeRows
  .filter((r) => r.productCount === products.length)
  .map((r) => r.edge);

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

const perProductSummary = products.map((p) => ({
  id: p.id,
  label: p.label,
  project: p.graph.summary.project,
  projectVersion: p.graph.summary.projectVersion,
  packageNodes: p.graph.summary.packageNodes,
  edges: p.graph.summary.edges,
  maximumDependencyDepth:
    p.graph.summary.maximumDependencyDepth,
  isAcyclic: p.graph.summary.isAcyclic,
}));

const totalIndividualPackageNodeCounts =
  perProductSummary.reduce(
    (sum, p) => sum + p.packageNodes,
    0
  );

const totalIndividualEdgeCounts =
  perProductSummary.reduce(
    (sum, p) => sum + p.edges,
    0
  );

// Root edges were excluded from exact ecosystem edge union.
const nonRootIndividualEdges = products.reduce(
  (sum, p) =>
    sum +
    (p.graph.edges || []).filter(
      (e) => e.source !== "ROOT"
    ).length,
  0
);

const output = {
  symbolicModel: {
    expression:
      "G_E = (∪_k V_k, ∪_k E_k)",
    exactNodeIdentity:
      "package-name@installed-version",
    note:
      "Same package name with different versions is reported separately and is not collapsed into one exact node.",
  },

  products: perProductSummary,

  summary: {
    productCount: products.length,
    sumOfIndividualPackageNodeInstances:
      totalIndividualPackageNodeCounts,
    uniqueExactPackageVersionNodes:
      exactNodeRows.length,
    exactSharedNodesAcrossAtLeastTwoProducts:
      sharedExactNodes.length,
    exactNodesSharedAcrossAllProducts:
      allThreeExactNodes.length,
    sumOfIndividualEdgesIncludingRootEdges:
      totalIndividualEdgeCounts,
    sumOfIndividualNonRootEdges:
      nonRootIndividualEdges,
    uniqueExactNonRootEdges:
      exactEdgeRows.length,
    exactSharedEdgesAcrossAtLeastTwoProducts:
      sharedExactEdges.length,
    exactEdgesSharedAcrossAllProducts:
      allThreeExactEdges.length,
    sameNameDifferentVersionOverlaps:
      versionOverlapRows.length,
  },

  pairwiseExactNodeIntersections: pairwise,
  sharedExactNodes,
  sharedExactEdges,
  sameNameDifferentVersionOverlaps:
    versionOverlapRows,
  allThreeExactNodes,
  allThreeExactEdges,
  ecosystemNodes: exactNodeRows,
  ecosystemEdges: exactEdgeRows,
};

// ---------------------------------------------------------------------
// Write JSON and CSV outputs
// ---------------------------------------------------------------------

fs.writeFileSync(
  path.join(baseDir, "ecosystem-topology.json"),
  JSON.stringify(output, null, 2),
  "utf8"
);

writeCsv(
  path.join(baseDir, "ecosystem-shared-nodes.csv"),
  [
    "key",
    "name",
    "version",
    "productCount",
    "products",
    "productIds",
    "instancesByProduct",
    "minimumDepthByProduct",
  ],
  sharedExactNodes
);

writeCsv(
  path.join(baseDir, "ecosystem-shared-edges.csv"),
  [
    "edge",
    "source",
    "target",
    "productCount",
    "products",
    "productIds",
    "occurrencesByProduct",
  ],
  sharedExactEdges
);

writeCsv(
  path.join(baseDir, "ecosystem-version-overlaps.csv"),
  [
    "packageName",
    "productCount",
    "products",
    "versions",
    "versionsByProduct",
  ],
  versionOverlapRows
);

// ---------------------------------------------------------------------
// DOT visualization
// ---------------------------------------------------------------------

const dot = [];

dot.push("digraph Ecosystem {");
dot.push("  rankdir=LR;");
dot.push('  graph [label="Open-Source Multi-Product Dependency Ecosystem", labelloc=t];');
dot.push("  node [shape=box];");

for (const row of exactNodeRows) {
  const membership = row.productIds.join(",");
  const label =
    `${row.key}\\nProducts: ${membership}`;

  const attrs = [`label=${JSON.stringify(label)}`];

  if (row.productCount === 3) {
    attrs.push("penwidth=3");
  } else if (row.productCount === 2) {
    attrs.push("penwidth=2");
  }

  dot.push(
    `  ${JSON.stringify(row.key)} [${attrs.join(", ")}];`
  );
}

for (const edge of exactEdgeRows) {
  const attrs = [];

  if (edge.productCount === 3) {
    attrs.push("penwidth=3");
  } else if (edge.productCount === 2) {
    attrs.push("penwidth=2");
  }

  attrs.push(
    `label=${JSON.stringify(edge.productIds.join(","))}`
  );

  dot.push(
    `  ${JSON.stringify(edge.source)} -> ${JSON.stringify(
      edge.target
    )} [${attrs.join(", ")}];`
  );
}

dot.push("}");

fs.writeFileSync(
  path.join(baseDir, "ecosystem-topology.dot"),
  dot.join("\n"),
  "utf8"
);

// ---------------------------------------------------------------------
// Human-readable report
// ---------------------------------------------------------------------

const report = [];

report.push(
  "MULTI-PRODUCT OPEN-SOURCE ECOSYSTEM TOPOLOGY REPORT"
);
report.push(
  "=================================================="
);
report.push("");

report.push(
  "Model: G_E = (union_k V_k, union_k E_k)"
);
report.push(
  "Exact node identity: package-name@installed-version"
);
report.push(
  "Direction: source -> target means source depends on target"
);
report.push("");

report.push("PRODUCT GRAPHS");
report.push("--------------");

for (const p of perProductSummary) {
  report.push(
    `${p.id} ${p.label}: nodes=${p.packageNodes}, edges=${p.edges}, max-depth=${p.maximumDependencyDepth}, DAG=${p.isAcyclic ? "YES" : "NO"}`
  );
}

report.push("");
report.push("ECOSYSTEM SUMMARY");
report.push("-----------------");
report.push(
  `Products: ${output.summary.productCount}`
);
report.push(
  `Sum of individual package-node instances: ${output.summary.sumOfIndividualPackageNodeInstances}`
);
report.push(
  `Unique exact package-version nodes in union: ${output.summary.uniqueExactPackageVersionNodes}`
);
report.push(
  `Exact nodes shared by >=2 products: ${output.summary.exactSharedNodesAcrossAtLeastTwoProducts}`
);
report.push(
  `Exact nodes shared by all 3 products: ${output.summary.exactNodesSharedAcrossAllProducts}`
);
report.push(
  `Unique exact non-root edges in union: ${output.summary.uniqueExactNonRootEdges}`
);
report.push(
  `Exact edges shared by >=2 products: ${output.summary.exactSharedEdgesAcrossAtLeastTwoProducts}`
);
report.push(
  `Exact edges shared by all 3 products: ${output.summary.exactEdgesSharedAcrossAllProducts}`
);
report.push(
  `Same-name/different-version overlaps: ${output.summary.sameNameDifferentVersionOverlaps}`
);

report.push("");
report.push("PAIRWISE EXACT NODE INTERSECTIONS");
report.push("---------------------------------");

for (const p of pairwise) {
  report.push(
    `${p.productA} ${p.productALabel} ∩ ${p.productB} ${p.productBLabel}: ${p.exactSharedNodeCount} exact nodes`
  );

  for (const node of p.exactSharedNodes) {
    report.push(`  - ${node}`);
  }
}

report.push("");
report.push("EXACT NODES SHARED BY >=2 PRODUCTS");
report.push("----------------------------------");

if (!sharedExactNodes.length) {
  report.push("None detected.");
} else {
  for (const row of sharedExactNodes) {
    report.push(
      `${row.key} | products=${row.productIds.join(",")} | count=${row.productCount}`
    );
  }
}

report.push("");
report.push("EXACT NODES SHARED BY ALL 3 PRODUCTS");
report.push("------------------------------------");

if (!allThreeExactNodes.length) {
  report.push("None detected.");
} else {
  for (const node of allThreeExactNodes) {
    report.push(`  - ${node}`);
  }
}

report.push("");
report.push("EXACT EDGES SHARED BY >=2 PRODUCTS");
report.push("----------------------------------");

if (!sharedExactEdges.length) {
  report.push("None detected.");
} else {
  for (const edge of sharedExactEdges) {
    report.push(
      `${edge.edge} | products=${edge.productIds.join(",")} | count=${edge.productCount}`
    );
  }
}

report.push("");
report.push("SAME PACKAGE NAME, DIFFERENT VERSION");
report.push("------------------------------------");

if (!versionOverlapRows.length) {
  report.push("None detected.");
} else {
  for (const row of versionOverlapRows) {
    report.push(
      `${row.packageName} | versions=${row.versions.join(", ")} | products=${row.products.join(", ")}`
    );

    for (const product of products) {
      const versions =
        row.versionsByProduct[product.id];

      if (versions) {
        report.push(
          `  ${product.id} ${product.label}: ${versions.join(", ")}`
        );
      }
    }
  }
}

report.push("");
report.push("INTERPRETATION");
report.push("--------------");
report.push(
  "A package-version node shared across products represents exact dependency reuse."
);
report.push(
  "A package name shared with different installed versions represents logical package overlap but not an identical executable dependency node."
);
report.push(
  "Shared exact edges identify dependency relationships reused across multiple products."
);
report.push(
  "These shared nodes and edges provide candidate ecosystem-level propagation points for later runtime/security experiments."
);

fs.writeFileSync(
  path.join(baseDir, "ecosystem-topology-report.txt"),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log("  ecosystem-topology.json");
console.log("  ecosystem-shared-nodes.csv");
console.log("  ecosystem-shared-edges.csv");
console.log("  ecosystem-version-overlaps.csv");
console.log("  ecosystem-topology.dot");
console.log("  ecosystem-topology-report.txt");
