/**
 * DKC-057 — eksterne backupmål: preflight, canary, synkronisering og skift.
 *
 * Modulet binder backend-kontrakten (objektlager/filsystem) sammen med
 * kontrakterne `BackupTarget`/`BackupTargetSet`:
 *
 *   - `resolveCredentials` opløser en credentials-reference gennem en injiceret
 *     resolver; hemmeligheden forlader aldrig kaldet,
 *   - `preflightTarget` kører read-only checks og klassificerer fejl (credentials,
 *     certifikat, plads, retention, manglende capabilities) **før** godkendelse,
 *   - `canaryTarget` skriver/læser/sletter en lille fil (særskilt markeret),
 *   - `syncBackupToTarget`/`fetchBackupFromTarget` flytter en krypteret beholder,
 *   - `planTargetSwitch` bevarer den gamle recoveryhistorik til retentionen er
 *     opfyldt.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { BackupTargetError } from "./errors.mjs";
import { createBackendForTarget } from "./backends/index.mjs";

export function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Indlæs backupmål fra en mappe med JSON-filer. */
export function loadBackupTargets(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, path: join(dir, file), data: JSON.parse(readFileSync(join(dir, file), "utf8")) }));
}

/** Find et mål på `metadata.name` i en liste. */
export function findTarget(targets, name) {
  return (targets ?? []).find((t) => (t.data ?? t)?.metadata?.name === name) ?? null;
}

/** Kræver målet opløste credentials? Objektlagre gør; lokale/monterede mål gør ikke. */
export function targetNeedsCredentials(target) {
  const type = target?.targetType;
  return type === "object-store" || type === "cloud" || /^s3:\/\//.test(target?.endpoint?.url ?? "");
}

/**
 * Opløs en credentials-reference. Understøtter JSON `{accessKeyId, secretAccessKey}`
 * og `accessKeyId:secretAccessKey`.
 */
export async function resolveCredentials({ credentialsRef, secretResolver } = {}) {
  if (!secretResolver) throw new BackupTargetError("credentials kræver en secretResolver", "credentials_error");
  let value;
  try {
    value = await secretResolver(credentialsRef);
  } catch (err) {
    throw new BackupTargetError(`kunne ikke opløse credentials '${credentialsRef}'`, "credentials_error", { cause: err });
  }
  if (value === undefined || value === null || value === "") {
    throw new BackupTargetError(`credentials '${credentialsRef}' er ikke konfigureret`, "credentials_error");
  }
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      if (parsed.accessKeyId && parsed.secretAccessKey) return { accessKeyId: parsed.accessKeyId, secretAccessKey: parsed.secretAccessKey };
    } catch {
      /* falder igennem til næste format */
    }
  }
  if (typeof value === "string" && value.includes(":")) {
    const index = value.indexOf(":");
    return { accessKeyId: value.slice(0, index), secretAccessKey: value.slice(index + 1) };
  }
  if (value && typeof value === "object" && value.accessKeyId && value.secretAccessKey) {
    return { accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey };
  }
  throw new BackupTargetError("credentials har et ukendt format (forventer JSON eller accessKeyId:secretAccessKey)", "credentials_error");
}

/**
 * Read-only preflight. Returnerer `{ ok, target, checks, errors, capabilities }`.
 * Fejlklasserne er stabile, så en fejl vises før profilen godkendes.
 */
export async function preflightTarget({ target, secretResolver = null, backend = null, localRoot = null, now = () => Date.now() } = {}) {
  if (!target) throw new BackupTargetError("preflightTarget kræver et mål", "target_error");
  const checks = [];
  const errors = [];
  const push = (name, status, detail) => checks.push({ name, status, detail });

  let credentials = null;
  if (target.credentialsRef && targetNeedsCredentials(target)) {
    try {
      credentials = await resolveCredentials({ credentialsRef: target.credentialsRef, secretResolver });
      push("credentials", "pass", "credentials-referencen blev opløst");
    } catch (err) {
      push("credentials", "fail", err.message);
      errors.push(err);
    }
  } else if (target.credentialsRef) {
    push("credentials", "pass", "målet bruger en lokalt monteret backend og kræver ikke cloud-credentials");
  }

  if (target.environment === "production") {
    if (target.tls?.verify !== true) {
      const err = new BackupTargetError("produktion kræver certifikatverifikation mod backupmålet", "certificate_error");
      push("tls-config", "fail", err.message);
      errors.push(err);
    } else {
      push("tls-config", "pass", `TLS ${target.tls.minVersion} med verifikation`);
    }
  }

  let be = backend;
  if (!be) {
    try {
      be = createBackendForTarget(target, { credentials, localRoot, now });
    } catch (err) {
      push("backend", "fail", err.message);
      errors.push(err);
    }
  }

  let capabilities = null;
  if (be) {
    try {
      const result = await be.preflight();
      checks.push(...result.checks);
      errors.push(...result.errors);
      capabilities = result.capabilities;
    } catch (err) {
      push("backend", "fail", err.message);
      errors.push(err);
    }
  }

  if (capabilities && target.retention?.immutability?.required === true) {
    if (capabilities.objectLock !== true) {
      const err = new BackupTargetError("målet kræver immutable backup, men object-lock/WORM er ikke verificeret", "retention_error");
      push("retention", "fail", err.message);
      errors.push(err);
    } else {
      push("retention", "pass", `object-lock understøtter retention (${capabilities.objectLockMode ?? "ukendt"})`);
    }
  }

  return { ok: errors.length === 0, target: target.metadata?.name ?? null, checks, errors, capabilities };
}

/**
 * Canary: skriv en lille fil, læs den tilbage og verificér digesten, og slet
 * den igen. Adskilt fra preflight, fordi den skriver. Plads-/kvotefejl og
 * manglende skriverettigheder viser sig her.
 */
export async function canaryTarget({ target, backend, secretResolver = null, localRoot = null, now = () => Date.now(), keep = false } = {}) {
  if (!target) throw new BackupTargetError("canaryTarget kræver et mål", "target_error");
  const checks = [];
  const errors = [];
  let be = backend;
  try {
    if (!be) {
      const credentials = target.credentialsRef && targetNeedsCredentials(target) ? await resolveCredentials({ credentialsRef: target.credentialsRef, secretResolver }) : null;
      be = createBackendForTarget(target, { credentials, localRoot, now });
    }
  } catch (err) {
    return { ok: false, checks: [{ name: "canary-backend", status: "fail", detail: err.message }], errors: [err], cleanup: "not-started" };
  }

  const id = `${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const key = `_canary/${id}.json`;
  const payload = Buffer.from(JSON.stringify({ target: target.metadata?.name ?? null, at: new Date(now()).toISOString(), nonce: randomUUID() }), "utf8");
  const digest = sha256Hex(payload);

  try {
    await be.putObject(key, payload);
    checks.push({ name: "canary-write", status: "pass", detail: "canary blev skrevet" });
  } catch (err) {
    checks.push({ name: "canary-write", status: "fail", detail: err.message });
    errors.push(err);
    return { ok: false, checks, errors, cleanup: "not-written" };
  }

  try {
    const readBack = await be.getObject(key);
    if (sha256Hex(readBack) !== digest) throw new BackupTargetError("canary blev læst tilbage med et andet digest", "backend_error");
    checks.push({ name: "canary-read", status: "pass", detail: "canary blev læst tilbage og digesten matcher" });
  } catch (err) {
    checks.push({ name: "canary-read", status: "fail", detail: err.message });
    errors.push(err);
  }

  let cleanup = "deleted";
  if (!keep) {
    try {
      await be.deleteObject(key);
      checks.push({ name: "canary-cleanup", status: "pass", detail: "canary blev slettet" });
    } catch (err) {
      if (err.code === "retention_error") {
        cleanup = "retained-by-object-lock";
        checks.push({ name: "canary-cleanup", status: "warn", detail: "canary blev holdt tilbage af object-lock (forventet for immutable mål)" });
      } else {
        checks.push({ name: "canary-cleanup", status: "fail", detail: err.message });
        errors.push(err);
      }
    }
  } else {
    cleanup = "kept";
  }

  return { ok: errors.length === 0, checks, errors, cleanup, key };
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs, base));
    else if (entry.isFile()) out.push({ rel: relative(base, abs).split("\\").join("/"), abs });
  }
  return out;
}

/** Upload en krypteret backupbeholder til målet. */
export async function syncBackupToTarget({ storeDir, target, backend, secretResolver = null, localRoot = null, keyPrefix = null, now = () => Date.now() } = {}) {
  if (!storeDir) throw new BackupTargetError("syncBackupToTarget kræver en storeDir", "target_error");
  const manifest = JSON.parse(readFileSync(join(storeDir, "manifest.json"), "utf8"));
  let be = backend;
  if (!be) {
    const credentials = target.credentialsRef && targetNeedsCredentials(target) ? await resolveCredentials({ credentialsRef: target.credentialsRef, secretResolver }) : null;
    be = createBackendForTarget(target, { credentials, localRoot, now });
  }
  const prefix = keyPrefix ?? `backups/${manifest.tenantId}/${manifest.backupId}`;
  const uploaded = [];
  let bytes = 0;
  for (const file of walkFiles(storeDir)) {
    const buffer = readFileSync(file.abs);
    await be.putObject(`${prefix}/${file.rel}`, buffer);
    uploaded.push(`${prefix}/${file.rel}`);
    bytes += buffer.length;
  }
  return { prefix, uploaded, bytes, backupId: manifest.backupId, tenantId: manifest.tenantId };
}

/** Download en backupbeholder fra målet til en lokal mappe. */
export async function fetchBackupFromTarget({ target, tenantId, backupId, destDir, backend, secretResolver = null, localRoot = null, keyPrefix = null, now = () => Date.now() } = {}) {
  if (!destDir || !backupId) throw new BackupTargetError("fetchBackupFromTarget kræver destDir og backupId", "target_error");
  let be = backend;
  if (!be) {
    const credentials = target.credentialsRef && targetNeedsCredentials(target) ? await resolveCredentials({ credentialsRef: target.credentialsRef, secretResolver }) : null;
    be = createBackendForTarget(target, { credentials, localRoot, now });
  }
  const prefix = keyPrefix ?? `backups/${tenantId}/${backupId}`;
  const objects = await be.listObjects(prefix);
  if (objects.length === 0) throw new BackupTargetError(`der findes ingen backup '${backupId}' på målet`, "not_found");
  let bytes = 0;
  for (const object of objects) {
    const rel = object.key.startsWith(`${prefix}/`) ? object.key.slice(prefix.length + 1) : object.key;
    const buffer = await be.getObject(object.key);
    const path = join(destDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer);
    bytes += buffer.length;
  }
  return { destDir, files: objects.length, bytes, backupId, tenantId };
}

/**
 * Planlæg et skift af aktivt backupmål. Det gamle mål bevares som
 * `previousTargets` indtil dets retention er opfyldt; et mål kan kun forlade
 * sættet når `retainedUntil` er passeret.
 */
export function planTargetSwitch({ currentSet, newTarget, currentTarget = null, lastBackupAt = null, now = () => Date.now() } = {}) {
  if (!currentSet || !newTarget) throw new BackupTargetError("planTargetSwitch kræver currentSet og newTarget", "target_error");
  const nowMs = now();
  const blockers = [];
  if (newTarget.status !== "approved") blockers.push(`det nye mål '${newTarget.metadata?.name}' er ikke godkendt`);
  if (newTarget.support?.status !== "supported") blockers.push(`det nye mål '${newTarget.metadata?.name}' er ikke understøttet`);

  const primary = currentSet.primaryFailureDomain ?? {};
  const domain = newTarget.failureDomain ?? {};
  if (newTarget.environment === "production" && domain.id === primary.id && domain.accessDomain === primary.accessDomain) {
    blockers.push("det nye mål ligger i samme eneste fejl-/adgangsdomæne som primæret");
  }
  if (blockers.length) return { ok: false, blockers, nextSet: currentSet, purgeable: [] };

  const previous = [...(currentSet.previousTargets ?? [])];
  const known = new Set(previous.map((p) => p.targetRef));
  const oldRef = currentSet.activeTargetRef;
  if (oldRef && oldRef !== newTarget.metadata.name && !known.has(oldRef)) {
    const retentionDays = currentTarget?.retention?.days ?? previous.find((p) => p.targetRef === oldRef)?.retentionDays ?? 365;
    const from = Date.parse(lastBackupAt ?? new Date(nowMs).toISOString());
    previous.push({
      targetRef: oldRef,
      retainedUntil: new Date(from + retentionDays * 86_400_000).toISOString(),
      retentionDays,
      purgeApprovedBy: null,
    });
  }

  const purgeable = previous.filter((p) => Date.parse(p.retainedUntil) <= nowMs);
  const retained = previous.filter((p) => Date.parse(p.retainedUntil) > nowMs);
  return {
    ok: true,
    blockers: [],
    nextSet: { ...currentSet, activeTargetRef: newTarget.metadata.name, previousTargets: retained },
    purgeable,
  };
}

/** Sandt hvis et tidligere mål må fjernes nu (retention opfyldt eller godkendt). */
export function canPurgePreviousTarget(entry, nowMs = Date.now()) {
  if (!entry) return false;
  if (entry.purgeApprovedBy) return true;
  return Date.parse(entry.retainedUntil) <= nowMs;
}

export function statBackupStore(storeDir) {
  if (!existsSync(storeDir)) return { files: 0, bytes: 0 };
  const files = walkFiles(storeDir);
  return { files: files.length, bytes: files.reduce((sum, f) => sum + statSync(f.abs).size, 0) };
}
