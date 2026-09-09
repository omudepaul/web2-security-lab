#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const baseDir = process.cwd();
const topologyPath = path.join(baseDir, "dependency-topology.json");

if (!fs.existsSync(topologyPath)) {
  console.error("ERROR: dependency-topology.json was not found in this folder.");
  console.error("Run this script from your research-app folder.");
  process.exit(1);
}

const topology = JSON.parse(fs.readFileSync(topologyPath, "utf8"));
const observationTime = new Date();
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function yearsBetween(start, end) {
  if (!start) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  return Math.max((e - s) / MS_PER_YEAR, 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalAdvisoryKey(v) {
  if (!v || !v.id) return JSON.stringify(v);
  if (v.id.startsWith("MAL-")) return v.id;

  const aliases = Array.isArray(v.aliases) ? v.aliases : [];
  const cves = aliases.filter((x) => /^CVE-/i.test(x)).sort();
  if (cves.length) return cves[0].toUpperCase();

  const ghsas = [v.id, ...aliases]
    .filter((x) => /^GHSA-/i.test(x))
    .sort();
  if (ghsas.length) return ghsas[0].toUpperCase();

  return v.id;
}

function dedupeAdvisories(vulns) {
  const map = new Map();
  for (const v of vulns || []) {
    const key = canonicalAdvisoryKey(v);
    if (!map.has(key)) map.set(key, v);
  }
  return [...map.values()];
}

function classifyAdvisories(vulns) {
  const unique = dedupeAdvisories(vulns);
  const malware = unique.filter((v) => String(v.id || "").startsWith("MAL-"));
  const vulnerability = unique.filter(
    (v) => !String(v.id || "").startsWith("MAL-")
  );

  return {
    total: unique.length,
    malwareCount: malware.length,
    vulnerabilityCount: vulnerability.length,
    ids: unique.map((v) => v.id),
  };
}

async function osvQuery(name, version = null) {
  const payload = {
    package: {
      name,
      ecosystem: "npm",
    },
  };

  if (version) payload.version = version;

  let all = [];
  let pageToken = null;

  do {
    const request = { ...payload };
    if (pageToken) request.page_token = pageToken;

    const response = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OSV HTTP ${response.status}: ${text.slice(0, 180)}`);
    }

    const data = await response.json();
    all.push(...(data.vulns || []));
    pageToken = data.next_page_token || null;
  } while (pageToken);

  return all;
}

async function fetchNpmMetadata(name) {
  const encodedName = encodeURIComponent(name);
  const response = await fetch(`https://registry.npmjs.org/${encodedName}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`npm registry HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  return response.json();
}

function aggregateTopologyNodes(nodes) {
  const map = new Map();

  for (const n of nodes || []) {
    if (!n.name || n.id === "ROOT" || n.packagePath === "") continue;

    const key = `${n.name}@${n.version || "UNKNOWN"}`;

    if (!map.has(key)) {
      map.set(key, {
        name: n.name,
        version: n.version || "",
        installedInstances: 0,
        anyDirect: false,
        minimumDepth: null,
        totalInDegreeAcrossInstances: 0,
        maximumInDegree: 0,
        maximumOutDegree: 0,
      });
    }

    const a = map.get(key);
    a.installedInstances += 1;
    a.anyDirect = a.anyDirect || Boolean(n.direct);
    a.minimumDepth =
      a.minimumDepth === null
        ? n.depth
        : Math.min(a.minimumDepth, n.depth ?? a.minimumDepth);
    a.totalInDegreeAcrossInstances += Number(n.inDegree || 0);
    a.maximumInDegree = Math.max(a.maximumInDegree, Number(n.inDegree || 0));
    a.maximumOutDegree = Math.max(a.maximumOutDegree, Number(n.outDegree || 0));
  }

  return [...map.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  );
}

function safeRate(count, years) {
  if (years === null || years <= 0) return null;
  return count / years;
}

function round(value, digits = 6) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value.toFixed(digits));
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function writeCsv(fileName, rows) {
  if (!rows.length) return;

  const headers = [
    "name",
    "version",
    "installedInstances",
    "anyDirect",
    "minimumDepth",
    "maximumInDegree",
    "maximumOutDegree",
    "packageCreated",
    "versionPublished",
    "packageAgeYears",
    "installedVersionAgeYears",
    "totalPublishedVersions",
    "maintainerCount",
    "deprecated",
    "exactVersionKnownVulnerabilityCount",
    "exactVersionKnownMalwareCount",
    "packageHistoricalVulnerabilityReportCount",
    "packageHistoricalMalwareReportCount",
    "observedAdvisoryRatePerPackageYear",
    "observedMalwareReportRatePerPackageYear",
    "exactVersionAdvisoryIds",
    "historicalAdvisoryIds",
    "dataCollectionError",
  ];

  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")),
  ];

  fs.writeFileSync(fileName, lines.join("\n"), "utf8");
}

async function main() {
  const packageVersions = aggregateTopologyNodes(topology.nodes || []);

  console.log("SECURITY EVIDENCE COLLECTION");
  console.log("============================");
  console.log(`Observation time: ${observationTime.toISOString()}`);
  console.log(`Unique installed package-version pairs: ${packageVersions.length}`);
  console.log("");
  console.log("This may take a few minutes. Do not close the window.");
  console.log("");

  const results = [];

  for (let i = 0; i < packageVersions.length; i++) {
    const p = packageVersions[i];
    const label = `${p.name}@${p.version}`;
    process.stdout.write(`[${i + 1}/${packageVersions.length}] ${label} ... `);

    const row = {
      ...p,
      packageCreated: null,
      packageModified: null,
      versionPublished: null,
      packageAgeYears: null,
      installedVersionAgeYears: null,
      totalPublishedVersions: null,
      maintainerCount: null,
      deprecated: null,
      exactVersionKnownVulnerabilityCount: null,
      exactVersionKnownMalwareCount: null,
      exactVersionAdvisoryIds: [],
      packageHistoricalVulnerabilityReportCount: null,
      packageHistoricalMalwareReportCount: null,
      historicalAdvisoryIds: [],
      observedAdvisoryRatePerPackageYear: null,
      observedMalwareReportRatePerPackageYear: null,
      dataCollectionError: "",
    };

    const errors = [];

    try {
      const npm = await fetchNpmMetadata(p.name);
      const time = npm.time || {};
      const versionEntry = (npm.versions || {})[p.version] || {};

      row.packageCreated = time.created || null;
      row.packageModified = time.modified || null;
      row.versionPublished = time[p.version] || null;
      row.packageAgeYears = round(
        yearsBetween(row.packageCreated, observationTime),
        4
      );
      row.installedVersionAgeYears = round(
        yearsBetween(row.versionPublished, observationTime),
        4
      );
      row.totalPublishedVersions = Object.keys(npm.versions || {}).length;
      row.maintainerCount = Array.isArray(npm.maintainers)
        ? npm.maintainers.length
        : null;
      row.deprecated = versionEntry.deprecated || "";
    } catch (err) {
      errors.push(`npm: ${err.message}`);
    }

    try {
      const exact = classifyAdvisories(
        await osvQuery(p.name, p.version || null)
      );
      row.exactVersionKnownVulnerabilityCount = exact.vulnerabilityCount;
      row.exactVersionKnownMalwareCount = exact.malwareCount;
      row.exactVersionAdvisoryIds = exact.ids;
    } catch (err) {
      errors.push(`OSV exact: ${err.message}`);
    }

    try {
      const historical = classifyAdvisories(await osvQuery(p.name));
      row.packageHistoricalVulnerabilityReportCount =
        historical.vulnerabilityCount;
      row.packageHistoricalMalwareReportCount = historical.malwareCount;
      row.historicalAdvisoryIds = historical.ids;

      row.observedAdvisoryRatePerPackageYear = round(
        safeRate(
          historical.vulnerabilityCount + historical.malwareCount,
          row.packageAgeYears
        )
      );

      row.observedMalwareReportRatePerPackageYear = round(
        safeRate(historical.malwareCount, row.packageAgeYears)
      );
    } catch (err) {
      errors.push(`OSV historical: ${err.message}`);
    }

    row.dataCollectionError = errors.join(" | ");
    results.push(row);

    console.log(errors.length ? `DONE with ${errors.length} warning(s)` : "DONE");
    await sleep(120);
  }

  const successful = results.filter((r) => !r.dataCollectionError).length;
  const exactAffected = results.filter(
    (r) =>
      Number(r.exactVersionKnownVulnerabilityCount || 0) > 0 ||
      Number(r.exactVersionKnownMalwareCount || 0) > 0
  );
  const historicalMalware = results.filter(
    (r) => Number(r.packageHistoricalMalwareReportCount || 0) > 0
  );

  const byExactAdvisories = [...results].sort(
    (a, b) =>
      (Number(b.exactVersionKnownVulnerabilityCount || 0) +
        Number(b.exactVersionKnownMalwareCount || 0)) -
        (Number(a.exactVersionKnownVulnerabilityCount || 0) +
          Number(a.exactVersionKnownMalwareCount || 0)) ||
      a.name.localeCompare(b.name)
  );

  const byHistoricalRate = [...results]
    .filter((r) => r.observedAdvisoryRatePerPackageYear !== null)
    .sort(
      (a, b) =>
        b.observedAdvisoryRatePerPackageYear -
          a.observedAdvisoryRatePerPackageYear ||
        a.name.localeCompare(b.name)
    );

  const output = {
    methodology: {
      observationTime: observationTime.toISOString(),
      topologyModel: topology.symbolicModel || null,
      importantCaution:
        "The computed rates are observed public advisory/report incidence rates. They are NOT true component failure probabilities or true compromise probabilities.",
      exactVersionMeasure:
        "Known OSV records that affect the exact installed npm package version.",
      historicalRate:
        "Deduplicated public OSV vulnerability/malware records for the package divided by package age in years.",
      securityCompromiseRateLambdaC:
        "Not directly estimated here. True compromise is latent and requires incident evidence and/or controlled experiments.",
      propagationProbabilityQ:
        "Not estimated from advisory databases. It should be estimated experimentally on graph edges under a defined workload and attack/fault model.",
    },
    summary: {
      uniquePackageVersionPairs: results.length,
      rowsWithoutCollectionWarnings: successful,
      exactInstalledVersionsWithKnownSecurityRecords: exactAffected.length,
      packagesWithHistoricalMalwareReports: historicalMalware.length,
    },
    packages: results,
  };

  fs.writeFileSync(
    path.join(baseDir, "security-evidence.json"),
    JSON.stringify(output, null, 2),
    "utf8"
  );

  writeCsv(path.join(baseDir, "security-evidence.csv"), results);

  const report = [];
  report.push("EMPIRICAL SECURITY EVIDENCE REPORT");
  report.push("==================================");
  report.push(`Observation time: ${observationTime.toISOString()}`);
  report.push(`Unique installed package-version pairs: ${results.length}`);
  report.push(`Rows without collection warnings: ${successful}`);
  report.push(
    `Installed versions with known OSV security records: ${exactAffected.length}`
  );
  report.push(
    `Packages with historical malware reports: ${historicalMalware.length}`
  );
  report.push("");
  report.push("IMPORTANT METHODOLOGY NOTE");
  report.push("--------------------------");
  report.push(
    "Do NOT call the advisory-rate columns 'true failure rate' or 'true compromise probability'."
  );
  report.push(
    "They are observed security-advisory/report incidence rates based on public records."
  );
  report.push(
    "The true compromise rate lambda^C is not directly observable from vulnerability databases."
  );
  report.push(
    "Edge propagation q should be estimated later through controlled experiments."
  );
  report.push("");
  report.push("TOP INSTALLED VERSIONS BY CURRENT KNOWN SECURITY RECORDS");
  report.push("--------------------------------------------------------");

  const nonzeroExact = byExactAdvisories.filter(
    (r) =>
      Number(r.exactVersionKnownVulnerabilityCount || 0) +
        Number(r.exactVersionKnownMalwareCount || 0) >
      0
  );

  if (!nonzeroExact.length) {
    report.push("No matching OSV security records found for the exact installed versions.");
  } else {
    for (const r of nonzeroExact.slice(0, 20)) {
      report.push(
        `${r.name}@${r.version} | vulnerabilities=${r.exactVersionKnownVulnerabilityCount} | malware=${r.exactVersionKnownMalwareCount} | depth=${r.minimumDepth} | max-in-degree=${r.maximumInDegree}`
      );
    }
  }

  report.push("");
  report.push("TOP PACKAGES BY OBSERVED HISTORICAL ADVISORY RATE");
  report.push("-------------------------------------------------");

  for (const r of byHistoricalRate.slice(0, 20)) {
    report.push(
      `${r.name}@${r.version} | rate=${r.observedAdvisoryRatePerPackageYear}/package-year | historical-vulns=${r.packageHistoricalVulnerabilityReportCount} | historical-malware=${r.packageHistoricalMalwareReportCount}`
    );
  }

  report.push("");
  report.push("NEXT RESEARCH STEP");
  report.push("------------------");
  report.push(
    "Define controlled propagation experiments for q_ji = P(downstream impact at i | dependency j compromised, workload W)."
  );

  fs.writeFileSync(
    path.join(baseDir, "security-evidence-report.txt"),
    report.join("\n"),
    "utf8"
  );

  console.log("");
  console.log(report.join("\n"));
  console.log("");
  console.log("Files created:");
  console.log("  security-evidence.json");
  console.log("  security-evidence.csv");
  console.log("  security-evidence-report.txt");
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
