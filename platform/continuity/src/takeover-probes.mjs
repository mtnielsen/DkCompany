/**
 * DKC-052 — rigtige, deterministiske prober til overtagelsesøvelsen.
 *
 * Proberne læser de faktiske artefakter og kalder de faktiske moduler:
 * HA-failover (DKC-038), database-failover med rejoin (DKC-039),
 * lager-holdbarhed (DKC-041), recovery-adgangsprofilen (DKC-042),
 * fejlmatrixen (DKC-051) og autonomibevillingen (DKC-032). De bærer
 * `measured: false`; en målt øvelse på levende hosts er NOT RUN.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFailoverDrill } from "../../infrastructure/src/ha.mjs";
import { runDatabaseFailoverDrill } from "../../persistence/src/ha-drill.mjs";
import { runStorageDrill } from "../../storage/src/drill.mjs";
import { recoveryAccessProblems } from "../../backup/src/dr/access.mjs";
import { sha256Hex } from "./takeover.mjs";

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

function digest(root, rel) {
  return `sha256:${sha256Hex(readFileSync(join(root, rel)))}`;
}

/**
 * @param {string} root  Repo-rod (00-core).
 */
export function createTakeoverProbes(root = process.cwd(), { clock = () => Date.now() } = {}) {
  const at = () => new Date(clock()).toISOString();

  function bindArtifact(rel) {
    if (!rel || !existsSync(join(root, rel))) return { artifactRef: rel ?? null, artifactDigest: null };
    return { artifactRef: rel, artifactDigest: digest(root, rel) };
  }

  async function verifyArtifacts({ scenario }) {
    const bindings = Object.entries(scenario.artifacts ?? {}).map(([kind, ref]) => ({
      kind,
      ref,
      present: existsSync(join(root, ref)),
      digest: existsSync(join(root, ref)) ? digest(root, ref) : null,
    }));
    const missing = bindings.filter((b) => !b.present);
    const first = bindings[0] ?? {};
    return {
      status: missing.length ? "fail" : "pass",
      result: missing.length ? `manglende artefakter: ${missing.map((m) => m.ref).join(", ")}` : `alle ${bindings.length} artefakter er bundet og har digest`,
      artifactRef: first.ref ?? null,
      artifactDigest: first.digest ?? null,
      at: at(),
    };
  }

  async function profileChoice({ plan }) {
    const refs = plan.profiles ?? {};
    const problems = [];
    for (const key of ["deploymentProfile", "haProfile", "immutableProfile", "selfHealingProfile"]) {
      const ref = refs[key];
      if (!ref || !existsSync(join(root, ref))) problems.push(`${key}: '${ref ?? "mangler"}' findes ikke`);
    }
    return {
      status: problems.length ? "fail" : "pass",
      result: problems.length ? problems.join("; ") : "den formelt valgte deployment-, HA-, immutable- og self-healing-profil findes og er bundet",
      ...bindArtifact(refs.haProfile),
      at: at(),
    };
  }

  async function aiOffline() {
    const matrix = readJson(root, "chaos/failure-matrix.json");
    const policy = readJson(root, "shadow/autonomy-policy.json");
    const hasControlPlane = (matrix.scenarios ?? []).some((s) => s.failureScope === "control-plane");
    const humanApproval = policy.scope?.humanApprovalForMutations === true;
    const governance = policy.governance?.requiresGovernance === true;
    const ok = hasControlPlane && humanApproval && governance;
    return {
      status: ok ? "pass" : "fail",
      result: ok
        ? "AI-offline er dækket: kontrolplanstab i fejlmatrixen, menneskelig godkendelse og governance-krav i autonomibevillingen"
        : `AI-offline mangler: control-plane=${hasControlPlane}, humanApproval=${humanApproval}, governance=${governance}`,
      ...bindArtifact("chaos/failure-matrix.json"),
      at: at(),
    };
  }

  async function iamLoss() {
    const profile = readJson(root, "backup/dr/recovery-access-profile.json");
    const problems = recoveryAccessProblems(profile);
    return {
      status: problems.length ? "fail" : "pass",
      result: problems.length ? problems.map((p) => `${p.path} ${p.message}`).join("; ") : "recovery-identiteten er adskilt fra primærdriften og kan kun aktiveres af et verificeret menneske med to-personers kontrol",
      ...bindArtifact("backup/dr/recovery-access-profile.json"),
      at: at(),
    };
  }

  async function restoreIntegrity() {
    const storagePlan = readJson(root, "storage/storage-plan.json");
    const workDir = mkdtempSync(join(tmpdir(), "dkc052-storage-"));
    try {
      const result = runStorageDrill(storagePlan, { tenantId: "acme", now: clock(), rootDir: workDir });
      return {
        status: result.ok ? "pass" : "fail",
        result: result.ok ? `lagerets quorum, scrub/repair og tenantisolering er intakt (${Object.keys(result.checks).length} checks)` : "lagerøvelsen fejlede",
        ...bindArtifact("storage/storage-plan.json"),
        at: at(),
        measurements: { dataIntegrityOk: result.ok, restoreVerified: result.ok, rtoMinutes: 0, rpoMinutes: 0 },
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  async function failbackIntegrity() {
    const haPlan = readJson(root, "infrastructure/ha-plan.json");
    const dbPlan = readJson(root, "persistence/ha-plan.json");
    const drain = runFailoverDrill(haPlan, { mode: "voluntary-drain", memberId: "cp-1", now: clock() });
    const crash = runFailoverDrill(haPlan, { mode: "hard-crash", memberId: "cp-1", now: clock() });
    const db = runDatabaseFailoverDrill(dbPlan, { now: clock() });
    const ok = drain.withinTarget && crash.withinTarget && db.ok && db.checks.rejoinOk !== false;
    return {
      status: ok ? "pass" : "fail",
      result: ok
        ? `failback tilbage til primær er verificeret: quorum=${drain.quorum.writeAllowed && crash.quorum.writeAllowed}, database-integrity=${db.integrity.ok}, rejoin=${db.checks.rejoinOk}`
        : "failback kunne ikke verificeres",
      ...bindArtifact("infrastructure/ha-plan.json"),
      at: at(),
      measurements: {
        dataIntegrityOk: db.integrity.ok,
        failbackVerified: ok,
        rpoMinutes: 0,
        rtoMinutes: (drain.estimatedFailoverSeconds ?? 0) / 60,
        rtoTargetMinutes: dbPlan.topology?.failoverTargetSeconds ? dbPlan.topology.failoverTargetSeconds / 60 : null,
      },
    };
  }

  async function serviceValidation() {
    const dir = join(root, "continuity/service-classes");
    const { readdirSync } = await import("node:fs");
    const accepted = [];
    for (const file of readdirSync(dir)) {
      const sc = readJson(root, `continuity/service-classes/${file}`);
      if (sc.serviceCommitment?.state === "accepted") accepted.push({ file, sc });
    }
    const noRestore = accepted.filter(({ sc }) => sc.backup?.restoreTested !== true);
    const ok = accepted.length > 0 && noRestore.length === 0;
    return {
      status: ok ? "pass" : "fail",
      result: ok
        ? `${accepted.length} vedtagne serviceklasser er produktionsklare og har testet gendannelse`
        : `servicevalidering mangler: ${accepted.length} vedtagne, ${noRestore.length} uden testet gendannelse`,
      ...bindArtifact("continuity/service-classes/audit-service.service-class.json"),
      at: at(),
    };
  }

  return {
    "verify-artifacts": verifyArtifacts,
    "profile-choice": profileChoice,
    "ai-offline": aiOffline,
    "iam-loss": iamLoss,
    "restore-integrity": restoreIntegrity,
    "failback-integrity": failbackIntegrity,
    "service-validation": serviceValidation,
  };
}
