/**
 * DKC-016 — semantiske validatorer for backup og gendannelse.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver de beslutninger skemaet ikke
 * kan udtrykke:
 *
 *   - krypteringsnøglen skal være adskilt fra backup-lageret, og lageret må
 *     ikke indeholde nøglen,
 *   - der skal være en databasekomponent, entydige komponentnavne og en
 *     suppressionsjournal med et digest,
 *   - gendannelsen skal være isoleret, checksums verificeret og databasen intakt
 *     for at gaten kan passere,
 *   - en `pass`-gate må ikke bære afvigelser: RTO/RPO, funktionelle checks,
 *     tenant-afgrænsning, audit-kæden og suppressionsresultatet skal stemme,
 *   - en `blocked`-gate skal forklare sig med mindst én begrundelse.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";
import { looksLikeRawSecret } from "./data-services.mjs";

function err(path, message) {
  return { path, message };
}

const SHA256 = /^[a-f0-9]{64}$/;

export function backupManifestProblems(data) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "manifestet er ikke et objekt")];

  if (data.encryption?.keySeparated !== true) problems.push(err("/encryption/keySeparated", "krypteringsnøglen skal være adskilt fra backup-lageret"));
  if (data.encryption?.storeContainsKey !== false) problems.push(err("/encryption/storeContainsKey", "backup-lageret må ikke indeholde krypteringsnøglen"));
  if (data.encryption?.algorithm !== "aes-256-gcm") problems.push(err("/encryption/algorithm", "kun autentificeret kryptering (aes-256-gcm) er tilladt"));

  const components = Array.isArray(data.components) ? data.components : [];
  if (!components.some((c) => c.kind === "database")) problems.push(err("/components", "backupen skal indeholde en databasekomponent"));
  const names = new Set();
  for (const [i, c] of components.entries()) {
    if (names.has(c.name)) problems.push(err(`/components/${i}/name`, `dubleret komponentnavn '${c.name}'`));
    names.add(c.name);
    if (!SHA256.test(c.sha256 ?? "")) problems.push(err(`/components/${i}/sha256`, "komponentens digest er ikke en SHA-256"));
    if (!SHA256.test(c.ciphertextSha256 ?? "")) problems.push(err(`/components/${i}/ciphertextSha256`, "chiffertekst-digesten er ikke en SHA-256"));
  }

  const order = data.objectives?.restoreOrder ?? [];
  if (!order.includes("database")) problems.push(err("/objectives/restoreOrder", "gendannelsesrækkefølgen skal indeholde 'database'"));

  if (!data.suppression?.ledgerRef) problems.push(err("/suppression/ledgerRef", "suppressionsjournalen mangler en reference"));
  if (!SHA256.test(data.suppression?.ledgerDigest ?? "")) problems.push(err("/suppression/ledgerDigest", "suppressionsjournalens digest er ikke en SHA-256"));

  if (!Number.isFinite(data.objectives?.rpoTargetMinutes)) problems.push(err("/objectives/rpoTargetMinutes", "RPO-målet mangler"));
  if (!Number.isFinite(data.objectives?.rtoTargetMinutes)) problems.push(err("/objectives/rtoTargetMinutes", "RTO-målet mangler"));

  if (Number.isFinite(Date.parse(data.createdAt)) === false) problems.push(err("/createdAt", "oprettelsestidspunktet er ikke en dato"));
  return problems;
}

export function restoreDrillProblems(data) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "rapporten er ikke et objekt")];

  const started = Date.parse(data.startedAt);
  const finished = Date.parse(data.finishedAt);
  if (Number.isFinite(started) && Number.isFinite(finished) && finished < started) {
    problems.push(err("/finishedAt", "øvelsen kan ikke slutte før den starter"));
  }

  if (data.isolated !== true) problems.push(err("/isolated", "gendannelsen skal være gennemført i et isoleret miljø"));

  const m = data.measurements ?? {};
  const derivedRto = Number(m.restoreDurationMs) / 60000;
  if (Number.isFinite(derivedRto) && Math.abs(derivedRto - Number(m.measuredRtoMinutes)) > 0.002) {
    problems.push(err("/measurements/measuredRtoMinutes", "den målte RTO stemmer ikke med den målte varighed"));
  }
  if (Number(m.measuredRpoMinutes) !== Number(m.dataLossMinutes)) {
    problems.push(err("/measurements/measuredRpoMinutes", "det målte RPO skal være lig det målte datatab"));
  }

  const checks = Array.isArray(data.functionalChecks) ? data.functionalChecks : [];
  const failedChecks = checks.filter((c) => c.status !== "pass");
  const gatePass = data.gate?.status === "pass";
  const reasons = data.gate?.reasons ?? [];

  if (gatePass) {
    if (reasons.length) problems.push(err("/gate/reasons", "en 'pass'-gate må ikke have afvigelser"));
    if (data.integrity?.databaseOk !== true) problems.push(err("/integrity/databaseOk", "databasen skal være intakt for en 'pass'-gate"));
    if (data.integrity?.checksumsVerified !== true) problems.push(err("/integrity/checksumsVerified", "checksums skal være verificeret for en 'pass'-gate"));
    if (failedChecks.length) problems.push(err("/functionalChecks", `en 'pass'-gate kræver at alle funktionelle checks består (fejlede: ${failedChecks.map((c) => c.name).join(", ")})`));
    if (data.suppression?.applied !== true) problems.push(err("/suppression/applied", "suppressionsjournalen skal være anvendt for en 'pass'-gate"));
    if (data.tenantIsolation?.ok !== true) problems.push(err("/tenantIsolation/ok", "tenant-afgrænsningen skal være bekræftet for en 'pass'-gate"));
    if (data.audit?.chainOk !== true) problems.push(err("/audit/chainOk", "audit-kæden skal være intakt for en 'pass'-gate"));
    if (data.audit?.checkpointOk === false) problems.push(err("/audit/checkpointOk", "et brudt checkpoint må ikke give en 'pass'-gate"));
    if (Number(m.measuredRtoMinutes) > Number(m.rtoTargetMinutes)) problems.push(err("/measurements/measuredRtoMinutes", "målt RTO overstiger målet og må ikke give 'pass'"));
    if (Number(m.dataLossMinutes) > Number(m.rpoTargetMinutes)) problems.push(err("/measurements/dataLossMinutes", "målt datatab overstiger RPO-målet og må ikke give 'pass'"));
  } else {
    if (reasons.length === 0) problems.push(err("/gate/reasons", "en 'blocked'-gate skal forklare hvorfor"));
  }
  return problems;
}

export function validateBackupManifest(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.backupManifest, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...backupManifestProblems(data));
  return { ok: result.length === 0, errors: result };
}

export function validateRestoreDrill(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.restoreDrill, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...restoreDrillProblems(data));
  return { ok: result.length === 0, errors: result };
}

function readDir(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

export function validateBackupManifestDir(dir, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith("backup-manifest") && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validateBackupManifest(JSON.parse(readFileSync(join(dir, file), "utf8")), instance) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}

export function validateRestoreDrillDir(dir, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith("restore-drill") && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validateRestoreDrill(JSON.parse(readFileSync(join(dir, file), "utf8")), instance) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* DKC-057 — eksterne backupmål                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Semantik for et backupmål:
 *   - credentials er en reference, ikke en hemmelighed,
 *   - et `supported` mål er faktisk valideret af et navngivet menneske,
 *   - immutabilitet kræver verificeret WORM/object-lock med evidens,
 *   - produktion kræver TLS-verifikation og TLS 1.3,
 *   - nøglen er adskilt fra målet.
 */
export function backupTargetProblems(data) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "målet er ikke et objekt")];
  const name = data.metadata?.name ?? "?";

  if (!isNamedHuman(data.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", `'${name}' skal have et navngivet menneske som ejer`));
  }
  if (looksLikeRawSecret(data.credentialsRef)) problems.push(err("/credentialsRef", "credentials skal være en reference, ikke en rå hemmelighed"));

  if (data.support?.status === "supported") {
    if (!data.support.validatedAt) problems.push(err("/support/validatedAt", "et understøttet mål skal have et valideringstidspunkt"));
    if (!isNamedHuman(data.support.validatedBy)) problems.push(err("/support/validatedBy", "et understøttet mål skal være valideret af et navngivet menneske"));
  } else if (!data.support?.reason) {
    problems.push(err("/support/reason", "et ikke-understøttet/ikke-valideret mål skal forklare hvorfor"));
  }

  const imm = data.retention?.immutability;
  if (imm) {
    if (imm.mode !== "none" && imm.verified !== true) {
      problems.push(err("/retention/immutability/verified", "en WORM-tilstand uden verificeret WORM må ikke markeres immutable"));
    }
    if (imm.required === true && imm.verified !== true) {
      problems.push(err("/retention/immutability/verified", "et påkrævet immutable mål skal have verificeret WORM"));
    }
    if (imm.verified === true && imm.mode === "none") {
      problems.push(err("/retention/immutability/mode", "verificeret WORM kræver en object-lock-tilstand"));
    }
    if (imm.verified === true && !imm.evidenceRef) {
      problems.push(err("/retention/immutability/evidenceRef", "verificeret WORM skal have en evidensreference"));
    }
    if (imm.verified === true && imm.minRetentionDays != null && Number(data.retention.days) < Number(imm.minRetentionDays)) {
      problems.push(err("/retention/days", "retentionen er kortere end mindsteretentionen for det immutable mål"));
    }
  }

  if (data.encryption?.mode === "customer-managed" && !data.encryption.keyRef) {
    problems.push(err("/encryption/keyRef", "customer-managed kryptering skal have en nøglereference"));
  }
  if (data.encryption?.keySeparated !== true) problems.push(err("/encryption/keySeparated", "krypteringsnøglen skal være adskilt fra backupmålet"));

  if (data.environment === "production") {
    if (data.tls?.verify !== true) problems.push(err("/tls/verify", "produktion kræver certifikatverifikation mod backupmålet"));
    if (data.tls?.minVersion !== "1.3") problems.push(err("/tls/minVersion", "produktion kræver TLS 1.3 mod backupmålet"));
  }

  if (data.status === "approved") {
    if (!isNamedHuman(data.approvedBy)) problems.push(err("/approvedBy", "et godkendt mål skal være godkendt af et navngivet menneske"));
    if (!data.approvedAt) problems.push(err("/approvedAt", "et godkendt mål skal have et godkendelsestidspunkt"));
  }
  return problems;
}

/**
 * Semantik for et målsæt:
 *   - det aktive mål skal findes, være godkendt og understøttet,
 *   - i produktion må målet ikke dele både fejl- og adgangsdomæne med primæret,
 *   - tidligere mål skal bevares til deres retention er opfyldt,
 *   - enhver ekstern datakilde skal have en eksplicit håndtering.
 */
export function backupTargetSetProblems(data, { targets = null } = {}) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "målsættet er ikke et objekt")];

  if (!isNamedHuman(data.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "målsættet skal have et navngivet menneske som ejer"));
  if (!isNamedHuman(data.recoveryOwner)) problems.push(err("/recoveryOwner", "målsættet skal have en navngiven recoveryejer"));

  const byName = new Map((targets ?? []).map((t) => [t?.metadata?.name, t]));
  const active = byName.get(data.activeTargetRef) ?? null;
  if (targets && !active) problems.push(err("/activeTargetRef", `det aktive mål '${data.activeTargetRef}' findes ikke`));
  if (active) {
    if (active.status !== "approved") problems.push(err("/activeTargetRef", `det aktive mål '${active.metadata?.name}' er ikke godkendt`));
    if (active.support?.status !== "supported") problems.push(err("/activeTargetRef", `det aktive mål '${active.metadata?.name}' er ikke understøttet`));
    const primary = data.primaryFailureDomain ?? {};
    const domain = active.failureDomain ?? {};
    if (active.environment === "production" && domain.id === primary.id && domain.accessDomain === primary.accessDomain) {
      problems.push(err("/primaryFailureDomain", "backupmålet ligger i samme eneste fejl-/adgangsdomæne som primæret"));
    }
  }

  const previousRefs = new Set((data.previousTargets ?? []).map((p) => p.targetRef));
  if (previousRefs.has(data.activeTargetRef)) problems.push(err("/previousTargets", "det aktive mål må ikke også stå som tidligere mål"));
  for (const [i, prev] of (data.previousTargets ?? []).entries()) {
    if (targets && !byName.has(prev.targetRef)) problems.push(err(`/previousTargets/${i}/targetRef`, `det tidligere mål '${prev.targetRef}' findes ikke`));
    if (!prev.retainedUntil) problems.push(err(`/previousTargets/${i}/retainedUntil`, "et tidligere mål skal have en bevaringsfrist"));
  }

  for (const [i, source] of (data.externalSources ?? []).entries()) {
    const at = (suffix) => `/externalSources/${i}${suffix}`;
    if (source.handling === "owner-backup" && !isNamedHuman(source.owner)) {
      problems.push(err(at("/owner"), "eget backup-ansvar (owner-backup) kræver en navngiven ejer"));
    }
    if (source.handling === "authorized-platform-backup" && !source.agreementRef) {
      problems.push(err(at("/agreementRef"), "autoriseret platformsbackup kræver en eksplicit scope-aftale"));
    }
  }
  return problems;
}

/**
 * Krydsreference mod datatjenesternes kilder: en ekstern kilde er ikke
 * beskyttet, blot fordi en connector virker. Hver ekstern kilde skal have en
 * eksplicit håndtering, og `authorized-platform-backup` skal matche kildens
 * faktiske scope-aftale.
 */
export function externalSourceCoverageProblems(targetSet, sources = []) {
  const problems = [];
  const byRef = new Map(sources.map((s) => [s?.metadata?.name, s]));
  const declared = new Map((targetSet?.externalSources ?? []).map((e) => [e.sourceRef, e]));

  for (const [name, source] of byRef) {
    const external = source?.sourceType !== undefined && source?.externalPolicy != null;
    if (!external) continue;
    if (!declared.has(name)) {
      problems.push(`datakilden '${name}' er ekstern, men har ingen eksplicit backuphåndtering i målsættet`);
      continue;
    }
    const entry = declared.get(name);
    if (entry.handling === "authorized-platform-backup") {
      const agreement = source.externalPolicy?.scopeAgreementRef ?? null;
      if (!entry.agreementRef || entry.agreementRef !== agreement) {
        problems.push(`datakilden '${name}': autoriseret platformsbackup matcher ikke kildens scope-aftale`);
      }
      if (source.externalPolicy?.autoBackup !== true) {
        problems.push(`datakilden '${name}': kilden tillader ikke automatisk backup (autoBackup != true)`);
      }
    }
  }
  return problems;
}

export function validateBackupTarget(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.backupTarget, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...backupTargetProblems(data));
  return { ok: result.length === 0, errors: result };
}

export function validateBackupTargetSet(data, ajv, { targets = null } = {}) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_IDS.backupTargetSet, data);
  const result = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...backupTargetSetProblems(data, { targets }));
  return { ok: result.length === 0, errors: result };
}

export function loadTargetExamples(dir) {
  const instances = [];
  for (const file of readDir(dir).filter((f) => f.startsWith("backup-target.") && f.endsWith(".example.json"))) {
    try {
      instances.push({ file, data: JSON.parse(readFileSync(join(dir, file), "utf8")) });
    } catch {
      /* ignoreres; håndteres af dir-validatoren */
    }
  }
  return instances;
}

/** Validér alle `backup-target.*.example.json` og returnér resultater. */
export function validateBackupTargetDir(dir, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith("backup-target.") && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validateBackupTarget(JSON.parse(readFileSync(join(dir, file), "utf8")), instance) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}

/** Validér alle `backup-target-set*.example.json` med krydsreference til målene. */
export function validateBackupTargetSetDir(dir, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const targets = loadTargetExamples(dir).map((t) => t.data);
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith("backup-target-set") && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validateBackupTargetSet(JSON.parse(readFileSync(join(dir, file), "utf8")), instance, { targets }) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}
