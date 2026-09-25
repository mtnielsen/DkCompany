/**
 * DKC-014 — rigtig sårbarhedsscanning af afhængigheder mod OSV-databasen.
 *
 * `scan` henter levende advisories fra `https://api.osv.dev` for de præcise
 * npm-pakker og -versioner i lockfilerne og cacher resultatet i
 * `supply-chain/vuln/cache.json`. `check` evaluerer den cachede scanning mod en
 * ejergodkendt politik uden netværk, så CI er deterministisk.
 *
 * En advisory uden en gyldig, tidsbegrænset undtagelse med et navngivet menneske
 * bag blokerer. En scanning der er ældre end politikken tillader, afvises.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { collectLockComponents } from "./sbom.mjs";

export const CACHE_PATH = "supply-chain/vuln/cache.json";
export const POLICY_PATH = "supply-chain/vuln/scan-policy.json";

export function loadVulnerabilityPolicy(root) {
  const path = join(root, POLICY_PATH);
  if (!existsSync(path)) throw new Error(`Mangler ${POLICY_PATH}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadScanCache(root) {
  const path = join(root, CACHE_PATH);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeScanCache(root, scan) {
  const path = join(root, CACHE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(scan, null, 2) + "\n");
}

/** Unikke npm-pakker og -versioner fra samtlige lockfiler. */
export function collectNpmDependencies(root) {
  const byPurl = new Map();
  for (const component of collectLockComponents(root)) {
    byPurl.set(component.purl, { name: component.name, version: component.version });
  }
  return [...byPurl.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

export function classifySeverity(advisory) {
  const raw = advisory?.database_specific?.severity;
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : "unknown";
}

function fixedVersionsOf(advisory) {
  const fixed = {};
  for (const affected of advisory?.affected ?? []) {
    const pkg = affected.package?.name;
    if (!pkg) continue;
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) fixed[pkg] = event.fixed;
      }
    }
  }
  return fixed;
}

/**
 * Spørg OSV for en liste af `{name, version}`. `fetchImpl` kan injiceres i
 * tests. Netværkskaldet sker kun her, aldrig i `check`.
 */
export async function queryOsv(dependencies, { fetchImpl = fetch, chunkSize = 200, now = () => new Date() } = {}) {
  const results = [];
  const advisoryIds = new Set();
  for (let i = 0; i < dependencies.length; i += chunkSize) {
    const chunk = dependencies.slice(i, i + chunkSize);
    const body = {
      queries: chunk.map((d) => ({ package: { name: d.name, ecosystem: "npm" }, version: d.version })),
    };
    const response = await fetchImpl("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OSV querybatch fejlede: HTTP ${response.status}`);
    const data = await response.json();
    for (const [index, entry] of (data.results ?? []).entries()) {
      const vulns = (entry.vulns ?? []).map((v) => v.id);
      for (const id of vulns) advisoryIds.add(id);
      results.push({ name: chunk[index].name, version: chunk[index].version, vulns });
    }
  }

  const advisories = {};
  for (const id of [...advisoryIds].sort()) {
    const response = await fetchImpl(`https://api.osv.dev/v1/vulns/${id}`);
    if (!response.ok) throw new Error(`OSV advisory ${id} fejlede: HTTP ${response.status}`);
    const data = await response.json();
    advisories[id] = {
      id: data.id ?? id,
      aliases: data.aliases ?? [],
      summary: data.summary ?? "",
      severity: classifySeverity(data),
      fixedVersions: fixedVersionsOf(data),
    };
  }

  return {
    schemaVersion: 1,
    ecosystem: "npm",
    source: "https://api.osv.dev",
    queriedAt: now().toISOString(),
    dependencies: results,
    advisories,
  };
}

function validException(exception, { now, maxExceptionDays }) {
  if (!exception || exception.status === "closed") return false;
  const approved = Date.parse(exception.approvedAt);
  const expires = Date.parse(exception.expiresAt);
  if (!Number.isFinite(approved) || !Number.isFinite(expires)) return false;
  if (approved > now || expires <= now) return false;
  if (Number.isFinite(maxExceptionDays) && (expires - approved) / (1000 * 60 * 60 * 24) > maxExceptionDays) return false;
  if (!exception.owner?.subject || !exception.owner?.name || !exception.reason) return false;
  return true;
}

/**
 * Evaluer en cachet scanning mod politikken. Returnerer en liste af
 * menneskelæsbare problemer; tom liste betyder bestået.
 */
export function evaluateVulnerabilities(scan, policy, { now = Date.now() } = {}) {
  const problems = [];
  if (!scan) return { ok: false, problems: ["der findes ingen cachet scanning; kør 'make supply-chain-scan'"], summary: null };
  if (scan.ecosystem !== policy.ecosystem) problems.push(`scanningens ecosystem '${scan.ecosystem}' matcher ikke politikken '${policy.ecosystem}'`);

  const queriedAt = Date.parse(scan.queriedAt);
  const maxAgeDays = policy.maxCacheAgeDays ?? 30;
  if (!Number.isFinite(queriedAt)) problems.push("scanningen mangler et gyldigt queriedAt");
  else if ((now - queriedAt) / (1000 * 60 * 60 * 24) > maxAgeDays) {
    problems.push(`scanningen er ældre end ${maxAgeDays} dage; kør 'make supply-chain-scan' igen`);
  }

  const failOn = new Set(policy.failOn ?? []);
  const exceptions = policy.exceptions ?? [];
  const summary = { packages: scan.dependencies.length, advisories: 0, failed: 0, excepted: 0, bySeverity: {} };

  for (const dep of scan.dependencies) {
    for (const id of dep.vulns ?? []) {
      summary.advisories += 1;
      const advisory = scan.advisories?.[id] ?? { id, severity: "unknown" };
      summary.bySeverity[advisory.severity] = (summary.bySeverity[advisory.severity] ?? 0) + 1;
      if (!failOn.has(advisory.severity)) continue;
      const exception = exceptions.find((e) => e.id === id && (!e.package || e.package === dep.name));
      if (validException(exception, { now, maxExceptionDays: policy.maxExceptionDays })) {
        summary.excepted += 1;
        continue;
      }
      summary.failed += 1;
      problems.push(`${dep.name}@${dep.version}: ${id} (${advisory.severity}) — ${advisory.summary}`);
    }
  }
  return { ok: problems.length === 0, problems, summary };
}
