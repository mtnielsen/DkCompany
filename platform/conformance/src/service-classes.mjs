/**
 * DKC-037 — semantiske validatorer for serviceklasser.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, et skema
 * ikke kan udtrykke alene:
 *
 *   - de tre holdbarhedsmål (bekræftede writes, regionsnedbrud, korruption) er
 *     adskilte og hænger logisk sammen,
 *   - adfærd ved netværkspartition er eksplicit, og en ikke-fail-closed adfærd
 *     kan ikke samtidig forbyde split-brain uden quorum,
 *   - flere aktive skrivere kræver eksplicit upstream-understøttelse — man må
 *     ikke antage at alle apps kan køre multi-writer,
 *   - HA-badgen kræver mindst tre failure domains, N+1, ekstern/offsite backup,
 *     særskilt recovery-lokation og mindst tre replikaer,
 *   - single-server er en understøttet non-HA-produktionsprofil, men kan ikke
 *     få HA-badge og kræver accepteret nedetid og ekstern backup,
 *   - en serviceklasse kan være `proposed` eller `accepted`; først når et
 *     navngivet menneske har vedtaget målene, er der en forpligtelse, og en
 *     måling kræver evidens.
 *
 * Validatorerne er rene funktioner og bruges af conformance, continuity-modulet
 * og installeren.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { isNamedHuman } from "./architecture.mjs";

function err(path, message) {
  return { path, message };
}

export function serviceClassProblems(data) {
  const problems = [];

  if (!isNamedHuman(data?.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "skal være et navngivet menneske med subject på formen 'scheme|person', ikke et team-alias"));
  }
  if (!(data?.biaRef ?? "").trim()) {
    problems.push(err("/biaRef", "serviceklassen skal referere til den BIA der begrunder målene"));
  }

  // --- Holdbarhed: tre adskilte mål ---------------------------------------
  const dur = data?.durability ?? {};
  const targets = ["confirmedWrites", "regionFailure", "corruption"];
  for (const key of targets) {
    if (!dur[key]) problems.push(err(`/durability/${key}`, `målet for '${key}' mangler — de tre holdbarhedsmål må ikke slås sammen`));
  }
  const cw = dur.confirmedWrites?.rpoMinutes;
  const rf = dur.regionFailure?.rpoMinutes;
  if (Number.isFinite(cw) && Number.isFinite(rf) && rf < cw) {
    problems.push(err("/durability/regionFailure/rpoMinutes", "et regionsnedbrud kan ikke tabe færre bekræftede writes end den normale write-vej"));
  }
  const seenRpo = targets.map((k) => dur[k]?.rpoMinutes).filter((v) => Number.isFinite(v));
  if (seenRpo.length === 3 && new Set(seenRpo).size === 1) {
    problems.push(err("/durability", "de tre holdbarhedsmål er identiske — bekræftede writes, regionsnedbrud og korruption skal vurderes hver for sig"));
  }

  // --- Netværkspartition ---------------------------------------------------
  const np = data?.failureModel?.networkPartition;
  if (!(np?.description ?? "").trim()) {
    problems.push(err("/failureModel/networkPartition/description", "adfærd ved netværkspartition skal beskrives eksplicit"));
  }
  if (np && np.behavior !== "fail-closed" && np.splitBrain === "forbidden" && np.quorumRequired !== true) {
    problems.push(err("/failureModel/networkPartition/quorumRequired", "en ikke-fail-closed adfærd der forbyder split-brain kræver quorum"));
  }

  // --- Replikering og skrivere --------------------------------------------
  const rep = data?.replication ?? {};
  if (rep.statefulMode && rep.statefulMode !== "stateless" && !(rep.storageClass ?? "").trim()) {
    problems.push(err("/replication/storageClass", "stateful mode kræver en eksplicit storageClass"));
  }
  if (rep.writeMode === "single-writer" && rep.activeWriters > 1) {
    problems.push(err("/replication/activeWriters", "single-writer kan ikke have flere aktive skrivere"));
  }
  if (rep.activeWriters > 1 && rep.upstreamSupportsMultiWriter !== true) {
    problems.push(err("/replication/upstreamSupportsMultiWriter", "flere aktive skrivere kræver at upstream-appen eksplicit understøtter multi-writer"));
  }
  if (rep.activeWriters > 1 && rep.writeMode !== "multi-writer") {
    problems.push(err("/replication/writeMode", "flere aktive skrivere kræver writeMode 'multi-writer'"));
  }

  // --- Backup --------------------------------------------------------------
  const backup = data?.backup ?? {};
  if (backup.required === true && backup.mode === "none") {
    problems.push(err("/backup/mode", "påkrævet backup kan ikke have mode 'none'"));
  }
  if (backup.offsite === true && backup.mode !== "external") {
    problems.push(err("/backup/mode", "offsite backup kræver en ekstern backupdestination"));
  }

  // --- Kompatibilitet med deployment-profiler -----------------------------
  const compat = data?.deploymentProfileCompatibility ?? {};
  const profiles = compat.profiles ?? [];
  const wantsHa = compat.haEligible === true;
  if (wantsHa) {
    if (!(rep.replicas >= 3)) problems.push(err("/replication/replicas", "HA kræver mindst tre replikaer (N+1)"));
    if (!(compat.failureDomains >= 3)) problems.push(err("/deploymentProfileCompatibility/failureDomains", "HA kræver mindst tre uafhængige server-/fejldomæner"));
    if (compat.nPlusOne !== true) problems.push(err("/deploymentProfileCompatibility/nPlusOne", "HA kræver N+1-kapacitet"));
    if (!(compat.recoveryLocation ?? "").trim()) problems.push(err("/deploymentProfileCompatibility/recoveryLocation", "HA kræver en særskilt recovery-lokation"));
    if (backup.required !== true || backup.mode !== "external" || backup.offsite !== true) {
      problems.push(err("/backup", "HA kræver ekstern, offsite backup"));
    }
    if (profiles.includes("single-server")) {
      problems.push(err("/deploymentProfileCompatibility/profiles", "single-server er en non-HA-profil og kan ikke få HA-badge"));
    }
  } else {
    if (profiles.includes("multiple-servers")) {
      problems.push(err("/deploymentProfileCompatibility/profiles", "profileType 'multiple-servers' kræver haEligible: true"));
    }
    if (profiles.includes("single-server")) {
      if (data?.availability?.acceptedDowntime !== true) {
        problems.push(err("/availability/acceptedDowntime", "single-server kræver eksplicit accepteret nedetid"));
      }
      if (!(backup.required === true && backup.mode === "external" && backup.offsite === true)) {
        problems.push(err("/backup", "single-server som produktionsprofil kræver ekstern, offsite backup"));
      }
    }
  }

  // --- Menneskelig vedtagelse og måling ------------------------------------
  const commit = data?.serviceCommitment ?? {};
  if (commit.state === "accepted") {
    if (!isNamedHuman(commit.acceptedBy)) {
      problems.push(err("/serviceCommitment/acceptedBy", "en accepteret serviceklasse kræver at et navngivet menneske har vedtaget målene"));
    }
    if (!(commit.acceptedAt ?? "").trim()) {
      problems.push(err("/serviceCommitment/acceptedAt", "en accepteret serviceklasse kræver et accepttidspunkt"));
    }
    if (!(commit.measured?.evidenceRef ?? "").trim()) {
      problems.push(err("/serviceCommitment/measured/evidenceRef", "en accepteret serviceklasse kræver målt evidens; en konfigurationspost beviser intet serviceniveau"));
    }
  }
  if (commit.state === "proposed" && (isNamedHuman(commit.acceptedBy) || commit.acceptedAt)) {
    problems.push(err("/serviceCommitment", "en 'proposed' klasse må ikke fremstilles som en vedtaget forpligtelse"));
  }
  if (commit.measured && commit.state !== "accepted") {
    problems.push(err("/serviceCommitment/measured", "en måling uden en vedtaget forpligtelse er kun et internt datapunkt"));
  }

  return problems;
}

const SCHEMA_ID = SCHEMA_IDS.serviceClass;

export function validateServiceClass(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, SCHEMA_ID, data);
  const result = errors.map((e) => err(e.path || "/", e.message));
  if (result.length === 0) result.push(...serviceClassProblems(data));
  return { ok: result.length === 0, errors: result };
}

/**
 * Validér serviceklasse-filer i en mappe. Filnavne skal starte med
 * `service-class` (fx `service-class.example.json` eller `<modul>.service-class.json`).
 */
export function validateServiceClassDir(dir, { pattern = /^service-class/ } = {}) {
  const results = [];
  if (!dir || !existsSync(dir)) return results;
  const ajv = buildAjv().ajv;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && pattern.test(f)).sort()) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (err2) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${err2.message}`)] });
      continue;
    }
    const { ok, errors } = validateServiceClass(data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}
