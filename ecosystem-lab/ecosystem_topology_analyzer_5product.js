#!/usr/bin/env node
"use strict";

/*
  FIVE-PRODUCT ECOSYSTEM TOPOLOGY REBUILD

  Physical installed package instances are used for DAG/cycle analysis.
  Exact name@version identities are used for cross-product sharing.

  P1 Express
  P2 express-session
  P3 Morgan
  P4 Connect
  P5 compression
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const PRODUCTS = [
  { id: "P1", label: "Express", dir: "product-express" },
  { id: "P2", label: "express-session", dir: "product-session" },
  { id: "P3", label: "Morgan", dir: "product-morgan" },
  { id: "P4", label: "Connect", dir: "product-connect" },
  { id: "P5", label: "compression", dir: "product-compression" },
];

const OUTDIR = path.join(ROOT, "results", "ecosystem-topology-5product");

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function normalizeKey(k) { return String(k || "").replace(/\\/g, "/").replace(/\/+$/, ""); }

function inferPackageName(lockKey, entry) {
  if (entry && entry.name) return entry.name;
  const k = normalizeKey(lockKey);
  const marker = "/node_modules/";
  let tail;
  if (k.startsWith("node_modules/")) tail = k.slice("node_modules/".length);
  else {
    const i = k.lastIndexOf(marker);
    tail = i >= 0 ? k.slice(i + marker.length) : k;
  }
  const parts = tail.split("/");
  if (parts[0] && parts[0].startsWith("@") && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] || null;
}

function parentPackageKey(lockKey) {
  const k = normalizeKey(lockKey);
  if (!k) return null;
  const parts = k.split("/");
  if (parts.length >= 2 && parts[parts.length - 2] === "node_modules") {
    parts.splice(parts.length - 2, 2);
  } else if (
    parts.length >= 3 &&
    parts[parts.length - 3] === "node_modules" &&
    parts[parts.length - 2].startsWith("@")
  ) {
    parts.splice(parts.length - 3, 3);
  } else return null;
  return parts.join("/");
}

function dependencyCandidate(baseKey, depName) {
  return baseKey ? `${normalizeKey(baseKey)}/node_modules/${depName}` : `node_modules/${depName}`;
}

function resolveDependencyPath(packages, sourceKey, depName) {
  let cur = normalizeKey(sourceKey);
  while (true) {
    const candidate = dependencyCandidate(cur, depName);
    if (packages[candidate]) return candidate;
    if (!cur) break;
    const parent = parentPackageKey(cur);
    if (parent === null) break;
    cur = parent;
  }
  const rootCandidate = `node_modules/${depName}`;
  return packages[rootCandidate] ? rootCandidate : null;
}

function graphStats(nodes, edges) {
  const adj = new Map();
  const indeg = new Map();
  for (const n of nodes) { adj.set(n, []); indeg.set(n, 0); }
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    if (!indeg.has(e.source)) indeg.set(e.source, 0);
    if (!indeg.has(e.target)) indeg.set(e.target, 0);
    adj.get(e.source).push(e.target);
    indeg.set(e.target, indeg.get(e.target) + 1);
  }
  const queue = [];
  for (const [n, d] of indeg.entries()) if (d === 0) queue.push(n);
  const topo = [];
  while (queue.length) {
    const n = queue.shift();
    topo.push(n);
    for (const v of adj.get(n) || []) {
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  const isDAG = topo.length === indeg.size;
  if (!isDAG) return { isDAG: false, maxDepth: null };
  const dist = new Map();
  for (const n of topo) dist.set(n, 0);
  for (const u of topo) {
    for (const v of adj.get(u) || []) {
      dist.set(v, Math.max(dist.get(v), dist.get(u) + 1));
    }
  }
  return { isDAG: true, maxDepth: Math.max(0, ...dist.values()) };
}

function readProduct(product) {
  const productDir = path.join(ROOT, product.dir);
  const lockFile = path.join(productDir, "package-lock.json");
  if (!fs.existsSync(lockFile)) throw new Error(`Missing package-lock.json: ${lockFile}`);
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  if (!lock.packages || typeof lock.packages !== "object") throw new Error(`No packages map in ${lockFile}`);

  const packages = {};
  for (const [rawKey, entry] of Object.entries(lock.packages)) {
    packages[normalizeKey(rawKey)] = entry;
  }

  const rootEntry = packages[""] || {};
  const physical = new Map();

  for (const [lockKey, entry] of Object.entries(packages)) {
    if (!lockKey || !entry || !entry.version) continue;
    const name = inferPackageName(lockKey, entry);
    if (!name) continue;
    physical.set(lockKey, {
      lockKey,
      name,
      version: String(entry.version),
      exactId: `${name}@${entry.version}`,
      entry,
    });
  }

  const exactNodes = new Set();
  const versionsByName = new Map();

  for (const pkg of physical.values()) {
    exactNodes.add(pkg.exactId);
    if (!versionsByName.has(pkg.name)) versionsByName.set(pkg.name, new Set());
    versionsByName.get(pkg.name).add(pkg.version);
  }

  const physicalEdges = [];
  const exactNonRootEdges = new Set();
  const unresolved = [];

  for (const pkg of physical.values()) {
    const deps = pkg.entry.dependencies || {};
    for (const depName of Object.keys(deps)) {
      const targetKey = resolveDependencyPath(packages, pkg.lockKey, depName);
      if (!targetKey || !physical.has(targetKey)) {
        unresolved.push({
          sourcePhysical: pkg.lockKey,
          sourceExact: pkg.exactId,
          dependency: depName,
          requested: deps[depName],
        });
        continue;
      }
      const target = physical.get(targetKey);
      physicalEdges.push({
        source: pkg.lockKey,
        target: targetKey,
        sourceExact: pkg.exactId,
        targetExact: target.exactId,
      });
      exactNonRootEdges.add(`${pkg.exactId} -> ${target.exactId}`);
    }
  }

  const rootNode = `ROOT::${product.id}`;
  const rootEdges = [];
  const directDependencies = [];

  for (const depName of Object.keys(rootEntry.dependencies || {})) {
    const targetKey = resolveDependencyPath(packages, "", depName);
    if (targetKey && physical.has(targetKey)) {
      rootEdges.push({ source: rootNode, target: targetKey });
      directDependencies.push(physical.get(targetKey).exactId);
    }
  }

  const physicalGraph = graphStats(
    [rootNode, ...physical.keys()],
    [...rootEdges, ...physicalEdges.map(e => ({ source: e.source, target: e.target }))]
  );

  const duplicatePackageNames = Array.from(versionsByName.entries())
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({ name, versions: Array.from(versions).sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    productId: product.id,
    label: product.label,
    directory: product.dir,
    rootName: rootEntry.name || lock.name || product.dir,
    rootVersion: rootEntry.version || lock.version || null,
    packageNodeInstances: physical.size,
    exactPackageVersionIdentities: exactNodes.size,
    nonRootPhysicalDependencyEdges: physicalEdges.length,
    uniqueExactNonRootDependencyEdges: exactNonRootEdges.size,
    rootDirectEdges: rootEdges.length,
    totalPhysicalEdgesIncludingRoot: physicalEdges.length + rootEdges.length,
    directDependencies: directDependencies.sort(),
    physicalDAG: physicalGraph.isDAG,
    physicalMaxDepthIncludingRoot: physicalGraph.maxDepth,
    duplicatePackageNameCount: duplicatePackageNames.length,
    duplicatePackageNames,
    unresolvedDependencies: unresolved,
    exactNodes: Array.from(exactNodes).sort(),
    exactNonRootEdges: Array.from(exactNonRootEdges).sort(),
  };
}

function buildEcosystem(products) {
  const K = products.length;
  const nodeProducts = new Map();
  const edgeProducts = new Map();
  const versionsByNameAcrossProducts = new Map();

  for (const p of products) {
    for (const node of p.exactNodes) {
      if (!nodeProducts.has(node)) nodeProducts.set(node, new Set());
      nodeProducts.get(node).add(p.productId);

      const at = node.lastIndexOf("@");
      const name = node.slice(0, at);
      const version = node.slice(at + 1);

      if (!versionsByNameAcrossProducts.has(name)) versionsByNameAcrossProducts.set(name, new Map());
      const vm = versionsByNameAcrossProducts.get(name);
      if (!vm.has(version)) vm.set(version, new Set());
      vm.get(version).add(p.productId);
    }

    for (const edge of p.exactNonRootEdges) {
      if (!edgeProducts.has(edge)) edgeProducts.set(edge, new Set());
      edgeProducts.get(edge).add(p.productId);
    }
  }

  const sharedNodes = Array.from(nodeProducts.entries())
    .filter(([, ps]) => ps.size >= 2)
    .map(([node, ps]) => ({
      node,
      productCount: ps.size,
      products: Array.from(ps).sort(),
      rho: ps.size / K,
    }))
    .sort((a, b) => b.productCount - a.productCount || a.node.localeCompare(b.node));

  const sharedEdges = Array.from(edgeProducts.entries())
    .filter(([, ps]) => ps.size >= 2)
    .map(([edge, ps]) => ({
      edge,
      productCount: ps.size,
      products: Array.from(ps).sort(),
      rho: ps.size / K,
    }))
    .sort((a, b) => b.productCount - a.productCount || a.edge.localeCompare(b.edge));

  const versionOverlaps = [];
  for (const [name, vm] of versionsByNameAcrossProducts.entries()) {
    if (vm.size < 2) continue;
    versionOverlaps.push({
      name,
      versions: Array.from(vm.entries())
        .map(([version, ps]) => ({ version, products: Array.from(ps).sort() }))
        .sort((a, b) => a.version.localeCompare(b.version)),
    });
  }
  versionOverlaps.sort((a, b) => a.name.localeCompare(b.name));

  return {
    K,
    sumIndividualPackageNodeInstances: products.reduce((s, p) => s + p.packageNodeInstances, 0),
    sumIndividualExactIdentityCounts: products.reduce((s, p) => s + p.exactPackageVersionIdentities, 0),
    uniqueExactNodesAcrossEcosystem: nodeProducts.size,
    exactNodesSharedGE2: sharedNodes.length,
    exactNodesSharedAllK: sharedNodes.filter(x => x.productCount === K).length,
    sumIndividualNonRootPhysicalEdges: products.reduce((s, p) => s + p.nonRootPhysicalDependencyEdges, 0),
    sumIndividualRootDirectEdges: products.reduce((s, p) => s + p.rootDirectEdges, 0),
    sumIndividualTotalPhysicalEdgesIncludingRoot: products.reduce((s, p) => s + p.totalPhysicalEdgesIncludingRoot, 0),
    uniqueExactNonRootEdgesAcrossEcosystem: edgeProducts.size,
    exactEdgesSharedGE2: sharedEdges.length,
    exactEdgesSharedAllK: sharedEdges.filter(x => x.productCount === K).length,
    sameNameDifferentVersionOverlapCount: versionOverlaps.length,
    sharedNodes,
    sharedEdges,
    versionOverlaps,
  };
}

function csvEscape(v) {
  const s = Array.isArray(v) ? v.join(";") : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, headers, rows) {
  const lines = [headers.join(","), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))];
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

function main() {
  ensureDir(OUTDIR);
  const products = PRODUCTS.map(readProduct);
  const ecosystem = buildEcosystem(products);

  const output = {
    analysis: "Five-product ecosystem topology rebuild",
    graphConvention: "u -> v means u depends on v",
    physicalIdentity: "package-lock install path",
    crossProductExactIdentity: "package-name@installed-version",
    products,
    ecosystem,
  };

  fs.writeFileSync(
    path.join(OUTDIR, "ecosystem-topology-5product.json"),
    JSON.stringify(output, null, 2),
    "utf8"
  );

  writeCsv(
    path.join(OUTDIR, "shared-nodes-5product.csv"),
    ["node", "productCount", "products", "rho"],
    ecosystem.sharedNodes
  );

  writeCsv(
    path.join(OUTDIR, "shared-edges-5product.csv"),
    ["edge", "productCount", "products", "rho"],
    ecosystem.sharedEdges
  );

  const report = [];
  report.push("FIVE-PRODUCT ECOSYSTEM TOPOLOGY REBUILD");
  report.push("=======================================");
  report.push("");
  report.push("MODEL");
  report.push("-----");
  report.push("Physical install-path nodes are used for DAG/cycle analysis.");
  report.push("Exact name@version identities are used for cross-product sharing.");
  report.push(`Ecosystem product count K=${ecosystem.K}.`);
  report.push("");

  report.push("PRODUCT SUMMARIES");
  report.push("-----------------");
  for (const p of products) {
    report.push(`${p.productId} ${p.label}`);
    report.push(`  root=${p.rootName}${p.rootVersion ? "@" + p.rootVersion : ""}`);
    report.push(`  package node instances=${p.packageNodeInstances}`);
    report.push(`  exact identities=${p.exactPackageVersionIdentities}`);
    report.push(`  non-root physical edges=${p.nonRootPhysicalDependencyEdges}`);
    report.push(`  root/direct edges=${p.rootDirectEdges}`);
    report.push(`  total physical edges including root=${p.totalPhysicalEdgesIncludingRoot}`);
    report.push(`  DAG=${p.physicalDAG ? "YES" : "NO"} maxDepthIncludingRoot=${p.physicalMaxDepthIncludingRoot ?? "NA"}`);
    report.push(`  duplicate package names=${p.duplicatePackageNameCount}`);
    report.push(`  unresolved dependency edges=${p.unresolvedDependencies.length}`);
  }

  report.push("");
  report.push("ECOSYSTEM SUMMARY");
  report.push("-----------------");
  report.push(`Products K=${ecosystem.K}`);
  report.push(`Sum individual package node instances=${ecosystem.sumIndividualPackageNodeInstances}`);
  report.push(`Sum individual exact-identity counts=${ecosystem.sumIndividualExactIdentityCounts}`);
  report.push(`Unique exact nodes=${ecosystem.uniqueExactNodesAcrossEcosystem}`);
  report.push(`Exact nodes shared by >=2 products=${ecosystem.exactNodesSharedGE2}`);
  report.push(`Exact nodes shared by all ${ecosystem.K} products=${ecosystem.exactNodesSharedAllK}`);
  report.push(`Sum individual non-root physical edges=${ecosystem.sumIndividualNonRootPhysicalEdges}`);
  report.push(`Sum individual root/direct edges=${ecosystem.sumIndividualRootDirectEdges}`);
  report.push(`Sum individual total physical edges including root=${ecosystem.sumIndividualTotalPhysicalEdgesIncludingRoot}`);
  report.push(`Unique exact non-root edges=${ecosystem.uniqueExactNonRootEdgesAcrossEcosystem}`);
  report.push(`Exact non-root edges shared by >=2 products=${ecosystem.exactEdgesSharedGE2}`);
  report.push(`Exact non-root edges shared by all ${ecosystem.K} products=${ecosystem.exactEdgesSharedAllK}`);
  report.push(`Same-name/different-version overlaps=${ecosystem.sameNameDifferentVersionOverlapCount}`);

  report.push("");
  report.push("SHARED EXACT NODES");
  report.push("------------------");
  for (const n of ecosystem.sharedNodes) {
    report.push(`${n.node} | products=${n.products.join(",")} | count=${n.productCount} | rho=${n.rho.toFixed(3)}`);
  }

  report.push("");
  report.push("SHARED EXACT NON-ROOT EDGES");
  report.push("---------------------------");
  for (const e of ecosystem.sharedEdges) {
    report.push(`${e.edge} | products=${e.products.join(",")} | count=${e.productCount} | rho=${e.rho.toFixed(3)}`);
  }

  report.push("");
  report.push("IMPORTANT");
  report.push("---------");
  report.push("Shared exact identity means reuse of the same package/version or dependency relation across separate installations.");
  report.push("It does not mean one physical runtime object/file is shared.");
  report.push("Topology reach rho is structural exposure only.");

  fs.writeFileSync(
    path.join(OUTDIR, "ecosystem-topology-5product-report.txt"),
    report.join("\n"),
    "utf8"
  );

  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log("  results\\ecosystem-topology-5product\\ecosystem-topology-5product-report.txt");
  console.log("  results\\ecosystem-topology-5product\\ecosystem-topology-5product.json");
  console.log("  results\\ecosystem-topology-5product\\shared-nodes-5product.csv");
  console.log("  results\\ecosystem-topology-5product\\shared-edges-5product.csv");
}

main();
