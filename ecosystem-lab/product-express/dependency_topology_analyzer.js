#!/usr/bin/env node
"use strict";

/*
  dependency_topology_analyzer.js

  Purpose:
  - Read an npm package-lock.json (lockfile v2/v3 "packages" format)
  - Build the resolved runtime dependency graph
  - Treat each installed package instance as a node
  - Treat "package A depends on package B" as a directed edge A -> B
  - Detect cycles / strongly connected components
  - Identify direct, transitive, and shared dependencies
  - Produce JSON, CSV, and Graphviz DOT outputs

  No external npm packages are required.

  Run:
      node dependency_topology_analyzer.js

  Optional:
      node dependency_topology_analyzer.js path\to\package-lock.json
*/

const fs = require("fs");
const path = require("path");

const lockPath = path.resolve(process.argv[2] || "package-lock.json");

if (!fs.existsSync(lockPath)) {
  console.error(`ERROR: package-lock.json not found: ${lockPath}`);
  console.error("Run this script from the project folder or pass the lockfile path.");
  process.exit(1);
}

let lock;
try {
  lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
} catch (err) {
  console.error("ERROR: Could not parse package-lock.json:", err.message);
  process.exit(1);
}

if (!lock.packages || typeof lock.packages !== "object") {
  console.error(
    "ERROR: This analyzer expects an npm lockfile with a top-level 'packages' object (lockfile v2/v3)."
  );
  process.exit(1);
}

const packages = lock.packages;
const rootEntry = packages[""] || {};
const rootName = rootEntry.name || lock.name || "ROOT_PROJECT";
const rootVersion = rootEntry.version || lock.version || "";

function packageNameFromPath(packagePath) {
  if (!packagePath) return rootName;
  const marker = "node_modules/";
  const idx = packagePath.lastIndexOf(marker);
  if (idx < 0) return packagePath;
  return packagePath.slice(idx + marker.length);
}

function resolveDependencyPath(fromPath, depName) {
  let base = fromPath;

  while (true) {
    const candidate = base
      ? `${base}/node_modules/${depName}`
      : `node_modules/${depName}`;

    if (Object.prototype.hasOwnProperty.call(packages, candidate)) {
      return candidate;
    }

    if (!base) break;

    const idx = base.lastIndexOf("/node_modules/");
    if (idx >= 0) {
      base = base.slice(0, idx);
    } else {
      base = "";
    }
  }

  return null;
}

function combinedDependencies(entry) {
  const result = [];

  for (const depName of Object.keys(entry.dependencies || {})) {
    result.push({ name: depName, type: "dependency" });
  }

  for (const depName of Object.keys(entry.optionalDependencies || {})) {
    if (!result.some((x) => x.name === depName)) {
      result.push({ name: depName, type: "optionalDependency" });
    }
  }

  return result;
}

// Build the full installed graph.
const adjacency = new Map();
const reverseAdjacency = new Map();
const edges = [];
const unresolved = [];

function ensureNode(id) {
  if (!adjacency.has(id)) adjacency.set(id, []);
  if (!reverseAdjacency.has(id)) reverseAdjacency.set(id, []);
}

for (const packagePath of Object.keys(packages)) {
  ensureNode(packagePath);
}

for (const [packagePath, entry] of Object.entries(packages)) {
  const deps = combinedDependencies(entry);

  for (const dep of deps) {
    const targetPath = resolveDependencyPath(packagePath, dep.name);

    if (!targetPath) {
      unresolved.push({
        source: packagePath,
        dependency: dep.name,
        type: dep.type,
      });
      continue;
    }

    ensureNode(targetPath);

    const edge = {
      source: packagePath,
      target: targetPath,
      dependencyName: dep.name,
      type: dep.type,
    };

    edges.push(edge);
    adjacency.get(packagePath).push(targetPath);
    reverseAdjacency.get(targetPath).push(packagePath);
  }
}

// Keep only nodes reachable from the root package through runtime/optional dependencies.
const reachable = new Set();
const depth = new Map();
const queue = [""];

reachable.add("");
depth.set("", 0);

for (let qi = 0; qi < queue.length; qi++) {
  const current = queue[qi];

  for (const next of adjacency.get(current) || []) {
    if (!reachable.has(next)) {
      reachable.add(next);
      depth.set(next, depth.get(current) + 1);
      queue.push(next);
    }
  }
}

const runtimeEdges = edges.filter(
  (e) => reachable.has(e.source) && reachable.has(e.target)
);

// Rebuild runtime-only adjacency maps.
const runAdj = new Map();
const runRev = new Map();

for (const id of reachable) {
  runAdj.set(id, []);
  runRev.set(id, []);
}

for (const e of runtimeEdges) {
  runAdj.get(e.source).push(e.target);
  runRev.get(e.target).push(e.source);
}

// Direct dependency targets.
const directTargets = new Set(runAdj.get("") || []);

// Tarjan strongly connected components.
let tarjanIndex = 0;
const stack = [];
const onStack = new Set();
const indexMap = new Map();
const lowMap = new Map();
const sccs = [];

function strongConnect(v) {
  indexMap.set(v, tarjanIndex);
  lowMap.set(v, tarjanIndex);
  tarjanIndex += 1;

  stack.push(v);
  onStack.add(v);

  for (const w of runAdj.get(v) || []) {
    if (!indexMap.has(w)) {
      strongConnect(w);
      lowMap.set(v, Math.min(lowMap.get(v), lowMap.get(w)));
    } else if (onStack.has(w)) {
      lowMap.set(v, Math.min(lowMap.get(v), indexMap.get(w)));
    }
  }

  if (lowMap.get(v) === indexMap.get(v)) {
    const component = [];
    let w;

    do {
      w = stack.pop();
      onStack.delete(w);
      component.push(w);
    } while (w !== v);

    sccs.push(component);
  }
}

for (const v of reachable) {
  if (!indexMap.has(v)) strongConnect(v);
}

const cyclicSCCs = sccs.filter((component) => {
  if (component.length > 1) return true;
  const v = component[0];
  return (runAdj.get(v) || []).includes(v);
});

function nodeRecord(id) {
  const entry = packages[id] || {};
  const name = id === "" ? rootName : packageNameFromPath(id);

  return {
    id: id || "ROOT",
    packagePath: id,
    name,
    version: entry.version || (id === "" ? rootVersion : ""),
    direct: id !== "" && directTargets.has(id),
    transitive: id !== "" && !directTargets.has(id),
    depth: depth.get(id) ?? null,
    inDegree: (runRev.get(id) || []).length,
    outDegree: (runAdj.get(id) || []).length,

    // Placeholders for Dr. Park's reliability/security model.
    nodeFailureRateLambda: null,
    securityCompromiseRateLambdaC: null,
  };
}

const nodes = Array.from(reachable).map(nodeRecord);

const modelEdges = runtimeEdges.map((e) => ({
  source: e.source || "ROOT",
  target: e.target || "ROOT",
  sourceName: e.source === "" ? rootName : packageNameFromPath(e.source),
  targetName: e.target === "" ? rootName : packageNameFromPath(e.target),
  dependencyType: e.type,

  // q_ij: placeholder for conditional propagation probability.
  failurePropagationProbabilityQ: null,
}));

const packageNodes = nodes.filter((n) => n.packagePath !== "");
const directNodes = packageNodes.filter((n) => n.direct);
const transitiveNodes = packageNodes.filter((n) => n.transitive);
const sharedNodes = packageNodes
  .filter((n) => n.inDegree > 1)
  .sort((a, b) => b.inDegree - a.inDegree || a.name.localeCompare(b.name));

const highestFanOut = [...packageNodes]
  .sort((a, b) => b.outDegree - a.outDegree || a.name.localeCompare(b.name))
  .slice(0, 15);

const maxDepth = Math.max(0, ...packageNodes.map((n) => n.depth || 0));

const duplicateNameMap = new Map();
for (const n of packageNodes) {
  if (!duplicateNameMap.has(n.name)) duplicateNameMap.set(n.name, []);
  duplicateNameMap.get(n.name).push(n);
}

const duplicatePackages = Array.from(duplicateNameMap.entries())
  .filter(([, arr]) => arr.length > 1)
  .map(([name, arr]) => ({
    name,
    instances: arr.length,
    versions: [...new Set(arr.map((x) => x.version).filter(Boolean))],
  }))
  .sort((a, b) => b.instances - a.instances || a.name.localeCompare(b.name));

const summary = {
  project: rootName,
  projectVersion: rootVersion,
  lockfileVersion: lock.lockfileVersion,
  graphModel: "Directed resolved dependency graph",
  edgeMeaning: "source depends on target",
  rootIncludedInNodeCount: true,
  totalNodesIncludingRoot: nodes.length,
  packageNodes: packageNodes.length,
  directDependencies: directNodes.length,
  transitiveDependencyInstances: transitiveNodes.length,
  edges: modelEdges.length,
  maximumDependencyDepth: maxDepth,
  isDirected: true,
  isAcyclic: cyclicSCCs.length === 0,
  cyclicStronglyConnectedComponents: cyclicSCCs.length,
  sharedDependencyInstancesInDegreeGreaterThan1: sharedNodes.length,
  duplicatePackageNamesWithMultipleInstalledInstances: duplicatePackages.length,
  unresolvedDependencyReferencesInFullLockfile: unresolved.length,
};

const output = {
  symbolicModel: {
    expression: "G_P = (V, E, Λ, Q)",
    V: "resolved package/component instances",
    E: "directed dependency relationships: v_i -> v_j means v_i depends on v_j",
    Lambda: "node failure-rate vector; values intentionally unassigned",
    Q: "conditional failure/compromise propagation probabilities; values intentionally unassigned",
  },
  summary,
  nodes,
  edges: modelEdges,
  cyclicComponents: cyclicSCCs.map((component) =>
    component.map((id) => ({
      id: id || "ROOT",
      name: id === "" ? rootName : packageNameFromPath(id),
      version: (packages[id] || {}).version || "",
    }))
  ),
  sharedDependencies: sharedNodes.slice(0, 50),
  highestFanOut: highestFanOut,
  duplicatePackages,
  unresolvedReferences: unresolved.slice(0, 200),
};

// CSV helpers.
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(fileName, headers, rows) {
  const content = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ].join("\n");

  fs.writeFileSync(fileName, content, "utf8");
}

const baseDir = path.dirname(lockPath);

fs.writeFileSync(
  path.join(baseDir, "dependency-topology.json"),
  JSON.stringify(output, null, 2),
  "utf8"
);

writeCsv(
  path.join(baseDir, "dependency-nodes.csv"),
  [
    "id",
    "name",
    "version",
    "direct",
    "transitive",
    "depth",
    "inDegree",
    "outDegree",
    "nodeFailureRateLambda",
    "securityCompromiseRateLambdaC",
  ],
  nodes
);

writeCsv(
  path.join(baseDir, "dependency-edges.csv"),
  [
    "source",
    "target",
    "sourceName",
    "targetName",
    "dependencyType",
    "failurePropagationProbabilityQ",
  ],
  modelEdges
);

// Graphviz DOT representation.
const dotLines = [
  "digraph DependencyTopology {",
  '  graph [rankdir="LR"];',
  '  node [shape="box"];',
];

for (const n of nodes) {
  const nodeId = JSON.stringify(n.id);
  const label =
    n.packagePath === ""
      ? `${n.name}${n.version ? "\\n" + n.version : ""}\\n(ROOT)`
      : `${n.name}${n.version ? "\\n" + n.version : ""}`;

  const attrs = [];
  attrs.push(`label=${JSON.stringify(label)}`);

  if (n.packagePath === "") {
    attrs.push('shape="oval"');
  } else if (n.direct) {
    attrs.push('penwidth="2"');
  }

  dotLines.push(`  ${nodeId} [${attrs.join(", ")}];`);
}

for (const e of modelEdges) {
  dotLines.push(
    `  ${JSON.stringify(e.source)} -> ${JSON.stringify(e.target)};`
  );
}

dotLines.push("}");

fs.writeFileSync(
  path.join(baseDir, "dependency-topology.dot"),
  dotLines.join("\n"),
  "utf8"
);

// Human-readable report.
const report = [];
report.push("OPEN-SOURCE DEPENDENCY TOPOLOGY REPORT");
report.push("======================================");
report.push(`Project: ${summary.project}${summary.projectVersion ? "@" + summary.projectVersion : ""}`);
report.push(`Lockfile version: ${summary.lockfileVersion}`);
report.push(`Model: G_P = (V, E, Λ, Q)`);
report.push(`Direction: source -> target means source depends on target`);
report.push("");
report.push(`Package nodes: ${summary.packageNodes}`);
report.push(`Direct dependencies: ${summary.directDependencies}`);
report.push(`Transitive dependency instances: ${summary.transitiveDependencyInstances}`);
report.push(`Edges: ${summary.edges}`);
report.push(`Maximum dependency depth: ${summary.maximumDependencyDepth}`);
report.push(`Directed: YES`);
report.push(`Acyclic (DAG): ${summary.isAcyclic ? "YES" : "NO"}`);
report.push(`Cyclic strongly connected components: ${summary.cyclicStronglyConnectedComponents}`);
report.push(`Shared dependency instances (in-degree > 1): ${summary.sharedDependencyInstancesInDegreeGreaterThan1}`);
report.push(`Duplicate package names with multiple installed instances: ${summary.duplicatePackageNamesWithMultipleInstalledInstances}`);
report.push("");
report.push("TOP SHARED DEPENDENCIES");
report.push("-----------------------");

if (sharedNodes.length === 0) {
  report.push("None detected.");
} else {
  for (const n of sharedNodes.slice(0, 15)) {
    report.push(
      `${n.name}@${n.version || "?"} | in-degree=${n.inDegree} | depth=${n.depth}`
    );
  }
}

report.push("");
report.push("HIGHEST FAN-OUT NODES");
report.push("---------------------");

for (const n of highestFanOut.slice(0, 15)) {
  report.push(
    `${n.name}@${n.version || "?"} | dependencies=${n.outDegree} | depth=${n.depth}`
  );
}

report.push("");
report.push("NOTE");
report.push("----");
report.push("Failure rates λ and propagation probabilities q are intentionally left blank.");
report.push("They must be estimated from a defined empirical failure/security dataset, not invented.");

fs.writeFileSync(
  path.join(baseDir, "dependency-topology-report.txt"),
  report.join("\n"),
  "utf8"
);

console.log(report.join("\n"));
console.log("");
console.log("Files created:");
console.log("  dependency-topology.json");
console.log("  dependency-nodes.csv");
console.log("  dependency-edges.csv");
console.log("  dependency-topology.dot");
console.log("  dependency-topology-report.txt");
