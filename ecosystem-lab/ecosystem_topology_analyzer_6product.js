#!/usr/bin/env node
"use strict";

/*
  SIX-PRODUCT ECOSYSTEM TOPOLOGY ANALYZER

  Products:
    P1 Express
    P2 express-session
    P3 Morgan
    P4 Connect
    P5 compression
    P6 Socket.IO

  Key modeling rule:
    - Physical installed package instances are used for DAG/cycle analysis.
    - Exact name@version identities are used for cross-product sharing.
    - Exact edge identity is source-name@version -> target-name@version.

  This is structural analysis only.
  Structural reach rho is NOT runtime activation, propagation probability,
  natural failure probability, vulnerability probability, or risk.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUTDIR = path.join(ROOT, "results", "ecosystem-topology-6product");

const PRODUCTS = [
  { id: "P1", dir: "product-express", label: "Express" },
  { id: "P2", dir: "product-session", label: "express-session" },
  { id: "P3", dir: "product-morgan", label: "Morgan" },
  { id: "P4", dir: "product-connect", label: "Connect" },
  { id: "P5", dir: "product-compression", label: "compression" },
  { id: "P6", dir: "product-socketio", label: "Socket.IO" },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeRel(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required file not found:\n${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const idx = lockPath.lastIndexOf(marker);
  if (idx < 0) return null;
  return lockPath.slice(idx + marker.length);
}

function exactId(name, version) {
  return `${name}@${version || "UNKNOWN"}`;
}

function edgeId(sourceExact, targetExact) {
  return `${sourceExact} -> ${targetExact}`;
}

function resolvePhysicalDependency(productDir, sourceAbsDir, depName, physicalByAbs) {
  let cursor = sourceAbsDir;

  while (true) {
    const candidate = path.resolve(cursor, "node_modules", depName);
    const hit = physicalByAbs.get(candidate.toLowerCase());
    if (hit) return hit;

    if (path.resolve(cursor) === path.resolve(productDir)) break;

    const parent = path.dirname(cursor);
    if (parent === cursor) break;

    if (!path.resolve(parent).startsWith(path.resolve(productDir))) break;
    cursor = parent;
  }

  const rootCandidate = path.resolve(productDir, "node_modules", depName);
  return physicalByAbs.get(rootCandidate.toLowerCase()) || null;
}

function analyzeProduct(product) {
  const productDir = path.join(ROOT, product.dir);
  const packageJsonFile = path.join(productDir, "package.json");
  const packageLockFile = path.join(productDir, "package-lock.json");

  const pkg = readJson(packageJsonFile);
  const lock = readJson(packageLockFile);

  if (!lock.packages || typeof lock.packages !== "object") {
    throw new Error(
      `${product.id}: package-lock.json does not contain a packages map`
    );
  }

  const physical = [];
  const physicalByAbs = new Map();

  for (const [lockPathRaw, entry] of Object.entries(lock.packages)) {
    const lockPath = normalizeRel(lockPathRaw);
    if (!lockPath) continue;
    if (!lockPath.includes("node_modules/")) continue;

    const name = entry.name || packageNameFromLockPath(lockPath);
    const version = entry.version || "UNKNOWN";

    if (!name) continue;

    const absDir = path.resolve(productDir, ...lockPath.split("/"));
    const node = {
      physicalId: lockPath,
      absDir,
      name,
      version,
      exact: exactId(name, version),
      dependencies: Object.keys(entry.dependencies || {}),
      optionalDependencies: Object.keys(entry.optionalDependencies || {}),
    };

    physical.push(node);
    physicalByAbs.set(absDir.toLowerCase(), node);
  }

  const physicalEdges = [];
  const unresolved = [];

  for (const source of physical) {
    const depNames = [...new Set(source.dependencies)];

    for (const depName of depNames) {
      const target = resolvePhysicalDependency(
        productDir,
        source.absDir,
        depName,
        physicalByAbs
      );

      if (!target) {
        unresolved.push({
          sourcePhysical: source.physicalId,
          sourceExact: source.exact,
          dependency: depName,
        });
        continue;
      }

      physicalEdges.push({
        sourcePhysical: source.physicalId,
        targetPhysical: target.physicalId,
        sourceExact: source.exact,
        targetExact: target.exact,
        exactEdge: edgeId(source.exact, target.exact),
      });
    }
  }

  const rootDeps = Object.keys(pkg.dependencies || {});
  const rootEdges = [];

  for (const depName of rootDeps) {
    const target = resolvePhysicalDependency(
      productDir,
      productDir,
      depName,
      physicalByAbs
    );

    if (!target) {
      unresolved.push({
        sourcePhysical: "__ROOT__",
        sourceExact: `${pkg.name || product.dir}@${pkg.version || "UNKNOWN"}`,
        dependency: depName,
      });
      continue;
    }

    rootEdges.push({
      sourcePhysical: "__ROOT__",
      targetPhysical: target.physicalId,
      targetExact: target.exact,
    });
  }

  const allNodeIds = ["__ROOT__", ...physical.map(n => n.physicalId)];
  const adjacency = new Map(allNodeIds.map(id => [id, []]));
  const indegree = new Map(allNodeIds.map(id => [id, 0]));

  for (const e of rootEdges) {
    adjacency.get("__ROOT__").push(e.targetPhysical);
    indegree.set(e.targetPhysical, (indegree.get(e.targetPhysical) || 0) + 1);
  }

  for (const e of physicalEdges) {
    if (!adjacency.has(e.sourcePhysical)) adjacency.set(e.sourcePhysical, []);
    adjacency.get(e.sourcePhysical).push(e.targetPhysical);
    indegree.set(e.targetPhysical, (indegree.get(e.targetPhysical) || 0) + 1);
  }

  const queue = [];
  for (const [id, deg] of indegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const topo = [];
  while (queue.length) {
    const id = queue.shift();
    topo.push(id);

    for (const next of adjacency.get(id) || []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  const isDag = topo.length === allNodeIds.length;

  let maxDepth = null;
  if (isDag) {
    const depth = new Map(allNodeIds.map(id => [id, Number.NEGATIVE_INFINITY]));
    depth.set("__ROOT__", 0);

    for (const id of topo) {
      const d = depth.get(id);
      if (!Number.isFinite(d)) continue;

      for (const next of adjacency.get(id) || []) {
        depth.set(next, Math.max(depth.get(next), d + 1));
      }
    }

    maxDepth = Math.max(...[...depth.values()].filter(Number.isFinite));
  }

  const exactSet = new Set(physical.map(n => n.exact));
  const exactEdgeSet = new Set(physicalEdges.map(e => e.exactEdge));

  const nameCounts = new Map();
  for (const n of physical) {
    nameCounts.set(n.name, (nameCounts.get(n.name) || 0) + 1);
  }

  const duplicateNames = [...nameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    productId: product.id,
    label: product.label,
    directory: product.dir,
    rootName: pkg.name || product.dir,
    rootVersion: pkg.version || "UNKNOWN",

    packageNodeInstances: physical.length,
    exactPackageVersionIdentities: exactSet.size,

    nonRootPhysicalDependencyEdges: physicalEdges.length,
    rootDirectEdges: rootEdges.length,
    totalPhysicalEdgesIncludingRoot: physicalEdges.length + rootEdges.length,

    physicalDAG: isDag,
    physicalMaxDepthIncludingRoot: maxDepth,

    duplicatePackageNameCount: duplicateNames.length,
    duplicatePackageNames: duplicateNames,

    unresolvedDependencyCount: unresolved.length,
    unresolvedDependencies: unresolved,

    physicalNodes: physical.map(n => ({
      physicalId: n.physicalId,
      name: n.name,
      version: n.version,
      exact: n.exact,
    })),

    physicalEdges,
    exactNodes: [...exactSet].sort(),
    exactEdges: [...exactEdgeSet].sort(),
  };
}

function csvEscape(v) {
  const s = Array.isArray(v) ? v.join(";") : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

ensureDir(OUTDIR);

const products = PRODUCTS.map(analyzeProduct);
const K = products.length;

const nodeMembership = new Map();
const edgeMembership = new Map();
const versionsByName = new Map();

for (const p of products) {
  for (const exact of p.exactNodes) {
    if (!nodeMembership.has(exact)) nodeMembership.set(exact, new Set());
    nodeMembership.get(exact).add(p.productId);

    const at = exact.lastIndexOf("@");
    const name = exact.slice(0, at);
    const version = exact.slice(at + 1);

    if (!versionsByName.has(name)) versionsByName.set(name, new Set());
    versionsByName.get(name).add(version);
  }

  for (const e of p.exactEdges) {
    if (!edgeMembership.has(e)) edgeMembership.set(e, new Set());
    edgeMembership.get(e).add(p.productId);
  }
}

const sharedNodes = [...nodeMembership.entries()]
  .filter(([, members]) => members.size >= 2)
  .map(([node, members]) => ({
    node,
    products: [...members].sort(),
    productCount: members.size,
    rho: members.size / K,
  }))
  .sort((a, b) => {
    if (b.productCount !== a.productCount) return b.productCount - a.productCount;
    return a.node.localeCompare(b.node);
  });

const sharedEdges = [...edgeMembership.entries()]
  .filter(([, members]) => members.size >= 2)
  .map(([edge, members]) => ({
    edge,
    products: [...members].sort(),
    productCount: members.size,
    rho: members.size / K,
  }))
  .sort((a, b) => {
    if (b.productCount !== a.productCount) return b.productCount - a.productCount;
    return a.edge.localeCompare(b.edge);
  });

const versionOverlaps = [...versionsByName.entries()]
  .filter(([, versions]) => versions.size >= 2)
  .map(([name, versions]) => ({
    name,
    versions: [...versions].sort(),
    versionCount: versions.size,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const ecosystem = {
  K,

  physicalPackageInstances: products.reduce(
    (s, p) => s + p.packageNodeInstances,
    0
  ),

  sumPerProductExactIdentities: products.reduce(
    (s, p) => s + p.exactPackageVersionIdentities,
    0
  ),

  uniqueExactNodes: nodeMembership.size,
  sharedExactNodesAtLeast2: sharedNodes.length,
  sharedExactNodesAllProducts: sharedNodes.filter(r => r.productCount === K).length,

  sumNonRootPhysicalEdges: products.reduce(
    (s, p) => s + p.nonRootPhysicalDependencyEdges,
    0
  ),

  rootEdges: products.reduce((s, p) => s + p.rootDirectEdges, 0),

  totalPhysicalEdgesIncludingRoot: products.reduce(
    (s, p) => s + p.totalPhysicalEdgesIncludingRoot,
    0
  ),

  uniqueExactNonRootEdges: edgeMembership.size,
  sharedExactNonRootEdgesAtLeast2: sharedEdges.length,
  sharedExactNonRootEdgesAllProducts: sharedEdges.filter(
    r => r.productCount === K
  ).length,

  sameNameDifferentVersionOverlaps: versionOverlaps.length,

  sharedNodes,
  sharedEdges,
  versionOverlaps,
};

const output = {
  analysis: "Six-product ecosystem topology",
  modelingBoundary:
    "Physical installed package instances are used for DAG/cycle analysis; exact name@version identities and exact dependency relations are used for cross-product sharing.",
  products,
  ecosystem,
};

fs.writeFileSync(
  path.join(OUTDIR, "ecosystem-topology-6product.json"),
  JSON.stringify(output, null, 2),
  "utf8"
);

const sharedNodeHeaders = ["node", "products", "productCount", "rho"];
const sharedNodeCsv = [
  sharedNodeHeaders.join(","),
  ...sharedNodes.map(r =>
    sharedNodeHeaders.map(h => csvEscape(r[h])).join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(OUTDIR, "shared-exact-nodes-6product.csv"),
  sharedNodeCsv,
  "utf8"
);

const sharedEdgeHeaders = ["edge", "products", "productCount", "rho"];
const sharedEdgeCsv = [
  sharedEdgeHeaders.join(","),
  ...sharedEdges.map(r =>
    sharedEdgeHeaders.map(h => csvEscape(r[h])).join(",")
  ),
].join("\n");

fs.writeFileSync(
  path.join(OUTDIR, "shared-exact-edges-6product.csv"),
  sharedEdgeCsv,
  "utf8"
);

const report = [];

report.push("SIX-PRODUCT ECOSYSTEM TOPOLOGY");
report.push("==============================");
report.push("");
report.push(
  "P1=Express, P2=express-session, P3=Morgan, P4=Connect, P5=compression, P6=Socket.IO"
);
report.push("");

report.push("PER-PRODUCT STRUCTURE");
report.push("---------------------");

for (const p of products) {
  report.push(`${p.productId} ${p.label}`);
  report.push(
    `  physical package instances=${p.packageNodeInstances}`
  );
  report.push(
    `  exact identities=${p.exactPackageVersionIdentities}`
  );
  report.push(
    `  non-root physical edges=${p.nonRootPhysicalDependencyEdges}`
  );
  report.push(
    `  root direct edges=${p.rootDirectEdges}`
  );
  report.push(
    `  total physical edges including root=${p.totalPhysicalEdgesIncludingRoot}`
  );
  report.push(
    `  physical DAG=${p.physicalDAG ? "YES" : "NO"}`
  );
  report.push(
    `  max depth including root=${p.physicalMaxDepthIncludingRoot}`
  );
  report.push(
    `  duplicate package names=${p.duplicatePackageNameCount}`
  );
  report.push(
    `  unresolved regular dependencies=${p.unresolvedDependencyCount}`
  );
}

report.push("");
report.push("ECOSYSTEM");
report.push("---------");
report.push(`K=${ecosystem.K}`);
report.push(
  `physical package instances=${ecosystem.physicalPackageInstances}`
);
report.push(
  `sum per-product exact identities=${ecosystem.sumPerProductExactIdentities}`
);
report.push(`unique exact nodes=${ecosystem.uniqueExactNodes}`);
report.push(
  `shared exact nodes >=2 products=${ecosystem.sharedExactNodesAtLeast2}`
);
report.push(
  `shared exact nodes all ${K} products=${ecosystem.sharedExactNodesAllProducts}`
);
report.push(
  `sum non-root physical edges=${ecosystem.sumNonRootPhysicalEdges}`
);
report.push(`root edges=${ecosystem.rootEdges}`);
report.push(
  `total physical edges including root=${ecosystem.totalPhysicalEdgesIncludingRoot}`
);
report.push(
  `unique exact non-root edges=${ecosystem.uniqueExactNonRootEdges}`
);
report.push(
  `shared exact non-root edges >=2 products=${ecosystem.sharedExactNonRootEdgesAtLeast2}`
);
report.push(
  `shared exact non-root edges all ${K} products=${ecosystem.sharedExactNonRootEdgesAllProducts}`
);
report.push(
  `same-name/different-version overlaps=${ecosystem.sameNameDifferentVersionOverlaps}`
);

report.push("");
report.push("SHARED EXACT NODES");
report.push("------------------");

for (const r of sharedNodes) {
  report.push(
    `${r.node}: products=${r.products.join(",")} count=${r.productCount}/${K} rho=${r.rho.toFixed(3)}`
  );
}

report.push("");
report.push("SHARED EXACT EDGES");
report.push("------------------");

for (const r of sharedEdges) {
  report.push(
    `${r.edge}: products=${r.products.join(",")} count=${r.productCount}/${K} rho=${r.rho.toFixed(3)}`
  );
}

report.push("");
report.push("SAME-NAME / DIFFERENT-VERSION OVERLAPS");
report.push("--------------------------------------");

for (const r of versionOverlaps) {
  report.push(`${r.name}: ${r.versions.join(", ")}`);
}

report.push("");
report.push("P6 VERSION-GENERALIZATION CANDIDATES");
report.push("------------------------------------");
report.push(
  "Socket.IO introduces debug@4.3.7 and debug@4.4.3, both using ms@2.1.3."
);
report.push(
  "This differs from the previously validated exact E1 edge debug@2.6.9 -> ms@2.0.0."
);
report.push(
  "Therefore P6 can support a stronger version-level generalization study after topology inspection."
);

report.push("");
report.push("IMPORTANT");
report.push("---------");
report.push(
  "Structural reach rho is not runtime activation, conditional propagation, natural failure probability, vulnerability probability, or natural risk."
);
report.push(
  "Optional peer dependencies that are intentionally absent are not treated as failed regular dependency resolution."
);
report.push(
  "npm audit output is a point-in-time tool result and is not a natural failure/compromise probability."
);

fs.writeFileSync(
  path.join(OUTDIR, "ecosystem-topology-6product-report.txt"),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log(
  "  results\\ecosystem-topology-6product\\ecosystem-topology-6product-report.txt"
);
console.log(
  "  results\\ecosystem-topology-6product\\ecosystem-topology-6product.json"
);
console.log(
  "  results\\ecosystem-topology-6product\\shared-exact-nodes-6product.csv"
);
console.log(
  "  results\\ecosystem-topology-6product\\shared-exact-edges-6product.csv"
);
