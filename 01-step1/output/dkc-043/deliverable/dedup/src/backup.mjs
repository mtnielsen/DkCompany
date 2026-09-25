/**
 * DKC-043 — dedup af backupblokke oven på den eksisterende, gennemprøvede
 * backupbeholder (`backup/src/vault.mjs`).
 *
 * En krypteret backup læses komponent for komponent, opdeles i
 * indholdsdefinerede chunks og lægges i dedup-lageret under domænet
 * tenant + krypteringsdomæne + retentionklasse. Den oprindelige
 * backupbeholder røres ikke, så dedup er et additivt lag: hvis det fjernes,
 * kan backupen stadig læses direkte.
 *
 * `verifyDedupedRestore` genforener hver komponent og sammenligner dens
 * sha256 med manifestets klartekst-digest, og `restoreDedupedBackup` skriver
 * den fulde, gendannede backup til et isoleret målmiljø. Det er den fulde
 * restore som besparelsesgaten kræver.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { computeManifestDigest, readBackup } from "../../backup/src/vault.mjs";
import { sha256Hex } from "./chunker.mjs";
import { normalizeDedupDomain } from "./store.mjs";

export function snapshotIdFor(backupId, component) {
  return `${backupId}:${component.kind}:${component.name}`;
}

/**
 * Læg alle komponenter fra en krypteret backup ind i dedup-lageret.
 *
 * @returns {{backupId:string,domain:object,snapshots:Array,logicalBytes:number,measure:object}}
 */
export function deduplicateBackup({ storeDir, manifest, keyProvider, store, domain: domainRaw, protectedSnapshot = false, retentionUntil = null } = {}) {
  if (!store) throw new Error("deduplicateBackup kræver et dedup-lager");
  if (!manifest) throw new Error("deduplicateBackup kræver et backup-manifest");
  const domain = normalizeDedupDomain(domainRaw);
  const components = readBackup({ storeDir, manifest, keyProvider });
  const snapshots = [];
  let logicalBytes = 0;
  for (const component of Object.values(components)) {
    const result = store.putSnapshot({
      domain,
      snapshotId: snapshotIdFor(manifest.backupId, component),
      buffer: component.buffer,
      protected: protectedSnapshot,
      retentionUntil,
    });
    snapshots.push(result);
    logicalBytes += result.logicalBytes;
  }
  return { backupId: manifest.backupId, domain, snapshots, logicalBytes, componentCount: snapshots.length, measure: store.measure({ domain }) };
}

/**
 * Genforen hver komponent fra dedup-lageret og sammenlign mod manifestet.
 * Returnerer `ok: false` hvis en digest afviger — det er selve
 * integritetsbeviset for en fuld restore efter dedup.
 */
export function verifyDedupedRestore({ store, manifest, backupId = manifest?.backupId, domain: domainRaw } = {}) {
  if (!store || !manifest) throw new Error("verifyDedupedRestore kræver et lager og et manifest");
  const domain = normalizeDedupDomain(domainRaw);
  const checks = [];
  for (const component of manifest.components ?? []) {
    const snapshotId = `${backupId}:${component.kind}:${component.name}`;
    try {
      const buffer = store.readSnapshot({ domain, snapshotId });
      const digest = sha256Hex(buffer);
      checks.push({ name: component.name, kind: component.kind, expectedSha256: component.sha256, actualSha256: digest, bytes: buffer.length, ok: digest === component.sha256 });
    } catch (error) {
      checks.push({ name: component.name, kind: component.kind, expectedSha256: component.sha256, actualSha256: null, bytes: 0, ok: false, error: error.code ?? error.message });
    }
  }
  const manifestDigestOk = computeManifestDigest(manifest) === manifest.checksums?.manifestDigest;
  return { ok: checks.every((check) => check.ok) && manifestDigestOk, manifestDigestOk, checks };
}

/**
 * Gendan en dedup'et backup til et isoleret målmiljø. Skriver kun efter at
 * hver komponent er verificeret mod manifestet, så et brudt dedup-lager ikke
 * kan producere en tavst forkert gendannelse.
 */
export function restoreDedupedBackup({ store, manifest, backupId = manifest?.backupId, domain: domainRaw, targetDir } = {}) {
  if (!targetDir) throw new Error("restoreDedupedBackup kræver en targetDir");
  const verification = verifyDedupedRestore({ store, manifest, backupId, domain: domainRaw });
  if (!verification.ok) {
    const failed = verification.checks.filter((check) => !check.ok).map((check) => check.name).join(", ");
    throw new Error(`dedup-gendannelsen kunne ikke verificeres (${failed || "manifestdigest"})`);
  }
  const domain = normalizeDedupDomain(domainRaw);
  mkdirSync(targetDir, { recursive: true });
  let dbPath = null;
  for (const component of manifest.components ?? []) {
    const buffer = store.readSnapshot({ domain, snapshotId: `${backupId}:${component.kind}:${component.name}` });
    if (component.kind === "database") {
      dbPath = join(targetDir, "database.db");
      writeFileSync(dbPath, buffer);
    } else if (component.kind === "config") {
      writeFileSync(join(targetDir, "config.json"), buffer);
    } else if (component.kind === "objects") {
      const path = join(targetDir, "objects", component.name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buffer);
    }
  }
  return { targetDir, dbPath, verification };
}
