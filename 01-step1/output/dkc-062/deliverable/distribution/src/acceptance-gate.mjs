/**
 * DKC-062 — den profilbevidste acceptgate.
 *
 * Gaten muterer intet. Den samler for et konkret acceptmål:
 *   - de fælles gates (sikkerhed, privacy, restore, rolle) og
 *   - de særskilte profilgates (HA, host management, immutable, self-healing),
 * som kun er aktive når profilen/kapabiliteten er valgt.
 *
 * Hver aktiv gate kræver:
 *   - at forudsætningskapabiliteterne findes i kode/register,
 *   - gyldigt og friskt testbevis (aldrig manglende, forældet eller bundet til
 *     et andet commit/artefakt),
 *   - at de relevante brugerrejser består, og
 *   - en særskilt registreret menneskelig ejeraccept.
 *
 * 'accepted' udstedes derfor aldrig alene af en grøn check.
 */
import { isNamedHuman } from "../../conformance/src/architecture.mjs";
import { gateApplies, worstStatus, scenariosForTarget } from "./acceptance-model.mjs";

const DAY_MS = 1000 * 60 * 60 * 24;

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value);
  return Number(value);
}

function isExternal(check) {
  return Boolean(check?.external || check?.level === "integration");
}

function evidenceStatusOf({ checkId, registry, checkEvidence, now, freshnessDays, targetCommit, artifactDigest }) {
  const check = registry.find((c) => c.id === checkId);
  if (!check) return { status: "missing", reason: `checken '${checkId}' findes ikke i baseline-registeret`, external: false };
  if (!checkEvidence) return { status: null, reason: null, external: isExternal(check) };
  const raw = checkEvidence[checkId];
  if (!raw) return { status: "missing", reason: `der findes ingen evidens for '${checkId}'`, external: isExternal(check) };
  const value = raw.status;
  let status = value === "pass" || value === "passed" ? "passed" : value === "fail" || value === "error" ? "failed" : "not-run";
  let reason = raw.reason ?? null;
  if (status === "passed") {
    if (raw.generatedAt && (now - Date.parse(raw.generatedAt)) / DAY_MS > freshnessDays) {
      status = "stale";
      reason = `evidensen for '${checkId}' er ældre end ${freshnessDays} dage`;
    } else if (targetCommit && raw.commit && raw.commit !== targetCommit) {
      status = "wrong-artifact";
      reason = `evidensen for '${checkId}' er bundet til et andet commit`;
    } else if (artifactDigest && raw.artifactDigest && raw.artifactDigest !== artifactDigest) {
      status = "wrong-artifact";
      reason = `evidensen for '${checkId}' er bundet til et andet artefakt`;
    }
  }
  return { status, reason, external: isExternal(check) };
}

function requirementStatusOf({ requirementId, registry, matrix, checkEvidence, now, freshnessDays, targetCommit, artifactDigest, externalPolicy = "pending" }) {
  const requirement = (matrix?.requirements ?? []).find((r) => r.id === requirementId);
  if (!requirement) return { status: "missing", reason: `kravet '${requirementId}' findes ikke i testmatricen` };
  const statuses = [];
  for (const ref of requirement.checks ?? []) {
    const res = evidenceStatusOf({ checkId: ref.id, registry, checkEvidence, now, freshnessDays, targetCommit, artifactDigest });
    if (!res.status) continue;
    if (res.status === "not-run" && res.external && externalPolicy === "pending") continue;
    statuses.push(res.status);
  }
  if (statuses.length === 0) return { status: null, reason: null };
  return { status: worstStatus(statuses), reason: null };
}

/**
 * Den deterministiske evidensfordeling: alle ikke-eksterne checks er bestået af
 * den kørende acceptsuite; eksterne integrationer er NOT RUN (aldrig PASS).
 * Bruges kun til den committede, deterministiske rapport; release-gaten
 * (DKC-063) bruger den faktiske baseline.
 */
export function deterministicCheckEvidence({ registry = [], targetCommit = null, artifactDigest = null, generatedAt = "2026-03-01T00:00:00Z" } = {}) {
  const map = {};
  for (const check of registry) {
    const external = isExternal(check);
    map[check.id] = {
      status: external ? "not-run" : "pass",
      commit: targetCommit,
      artifactDigest,
      generatedAt,
      reason: external ? (check.reason ?? "eksternt testbevis er ikke kørt i dette miljø") : null,
    };
  }
  return map;
}

function matchingOwnerAcceptance({ gateId, ownerAcceptance, policy, now, targetCommit, artifactDigest, profileRef }) {
  const entries = (ownerAcceptance?.accepted ?? []).filter((e) => e.gateId === gateId);
  for (const entry of entries) {
    if (!isNamedHuman(entry.acceptedBy)) continue;
    if (!(policy?.ownerAcceptance?.acceptedByRoles ?? []).includes(entry.acceptedBy.role)) continue;
    const at = Date.parse(entry.acceptedAt);
    if (!Number.isFinite(at) || at > now + 60000) continue;
    if ((now - at) / DAY_MS > policy.ownerAcceptance.maxAgeDays) continue;
    if (targetCommit && entry.targetCommit !== targetCommit) continue;
    if (artifactDigest && entry.artifactDigest !== artifactDigest) continue;
    if (profileRef && entry.profileRef && entry.profileRef !== profileRef) continue;
    if (!entry.evidenceRef) continue;
    return entry;
  }
  return null;
}

function scenarioStatusFor({ gate, scenarioSet, outcomesById, target }) {
  const applicable = scenariosForTarget(scenarioSet, target).filter((s) => (gate.journeys ?? []).includes(s.journey));
  const statuses = [];
  const reasons = [];
  for (const scenario of applicable) {
    const outcome = outcomesById.get(scenario.id);
    if (!outcome) {
      statuses.push("missing");
      reasons.push(`scenariet '${scenario.id}' er ikke kørt`);
      continue;
    }
    if (outcome.status === "passed") statuses.push("passed");
    else if (outcome.status === "not-run") statuses.push("not-run");
    else {
      statuses.push("failed");
      reasons.push(`scenariet '${scenario.id}' fejlede: ${(outcome.problems ?? []).slice(0, 2).join("; ") || outcome.status}`);
    }
  }
  if (statuses.length === 0) return { status: null, reasons };
  return { status: worstStatus(statuses), reasons };
}

/**
 * @param {object} options
 * @param {object} options.target          acceptmål (profil/platform/flags)
 * @param {object} options.policy          AcceptanceGatePolicy
 * @param {Array}  options.registry        baseline-register (checks)
 * @param {Array}  [options.components]    baseline-register (komponenter)
 * @param {object} [options.matrix]        testmatrix
 * @param {object} [options.scenarioSet]   AcceptanceScenarioSet
 * @param {Array}  [options.scenarioOutcomes]
 * @param {object|null} [options.checkEvidence] map checkId -> { status, commit, generatedAt, artifactDigest, reason }
 * @param {object} [options.ownerAcceptance]
 * @param {Array}  [options.roleViolations]
 * @param {number|Date|string} [options.now]
 * @param {string} [options.targetCommit]
 * @param {string} [options.artifactDigest]
 * @param {object} [options.producer]
 * @param {string} [options.externalPolicy] "pending" eller "blocking"
 */
export function aggregateAcceptance({
  target,
  policy,
  registry = [],
  components = [],
  matrix = null,
  scenarioSet = { scenarios: [] },
  scenarioOutcomes = [],
  checkEvidence = null,
  ownerAcceptance = { accepted: [] },
  roleViolations = [],
  now: nowInput = Date.now(),
  targetCommit = null,
  artifactDigest = null,
  producer = { type: "implementer", name: "acceptance-suite", subject: "process|acceptance" },
  externalPolicy = "pending",
  environment = { measured: false },
} = {}) {
  const now = toMs(nowInput);
  const freshnessDays = policy?.freshnessDays ?? 30;
  const componentIds = new Set(components.map((c) => c.id));
  const outcomesById = new Map(scenarioOutcomes.map((o) => [o.id, o]));

  const gates = (policy?.gates ?? []).map((gate) => {
    const applicable = gateApplies(gate, target);
    const reasons = [];
    const pendingExternal = [];

    // Forudsætningskapabiliteter skal findes i koden.
    for (const capability of gate.requiresCapabilities ?? []) {
      if (!componentIds.has(capability)) reasons.push(`forudsætningskapabiliteten '${capability}' findes ikke i kode/register`);
    }

    const evidenceStatuses = [];
    for (const check of gate.checks ?? []) {
      const res = evidenceStatusOf({ checkId: check, registry, checkEvidence, now, freshnessDays, targetCommit, artifactDigest });
      if (!res.status) continue;
      if (res.status === "not-run" && res.external && externalPolicy === "pending") {
        pendingExternal.push(check);
        continue;
      }
      evidenceStatuses.push(res.status);
      if (res.reason) reasons.push(res.reason);
    }
    for (const requirementId of gate.requirementRefs ?? []) {
      const res = requirementStatusOf({ requirementId, registry, matrix, checkEvidence, now, freshnessDays, targetCommit, artifactDigest, externalPolicy });
      if (res.status) {
        evidenceStatuses.push(res.status);
        if (res.reason) reasons.push(res.reason);
      }
    }
    const scenario = scenarioStatusFor({ gate, scenarioSet, outcomesById, target });
    if (scenario.status) evidenceStatuses.push(scenario.status);
    reasons.push(...scenario.reasons);

    const capabilityMissing = (gate.requiresCapabilities ?? []).some((c) => !componentIds.has(c));
    const evidenceStatus = capabilityMissing ? "missing" : worstStatus(evidenceStatuses);

    const acceptance = matchingOwnerAcceptance({ gateId: gate.id, ownerAcceptance, policy, now, targetCommit, artifactDigest, profileRef: target?.profileRef });
    const ownerAcceptanceStatus = applicable ? (acceptance ? "accepted" : "pending") : "not-applicable";

    let status;
    if (!applicable) status = "not-applicable";
    else if (evidenceStatus !== "passed") status = evidenceStatus;
    else if (!acceptance) status = "unapproved";
    else status = "passed";

    if (applicable && !acceptance) reasons.push("afventer en særskilt registreret menneskelig ejeraccept");
    if (pendingExternal.length) reasons.push(`afventer eksternt testbevis: ${pendingExternal.join(", ")}`);

    return {
      id: gate.id,
      title: gate.title,
      kind: gate.kind,
      applicable,
      mandatory: gate.mandatory !== false,
      status,
      evidenceStatus,
      ownerAcceptanceStatus,
      checks: gate.checks ?? [],
      requirementRefs: gate.requirementRefs ?? [],
      owner: gate.owner ?? null,
      reasons: reasons.filter(Boolean),
    };
  });

  const statuses = { total: gates.length, passed: 0, failed: 0, notApplicable: 0, missing: 0, stale: 0, wrongArtifact: 0, unapproved: 0, notRun: 0 };
  const COUNT_KEY = { passed: "passed", failed: "failed", "not-applicable": "notApplicable", missing: "missing", stale: "stale", "wrong-artifact": "wrongArtifact", unapproved: "unapproved", "not-run": "notRun" };
  for (const g of gates) statuses[COUNT_KEY[g.status]] = (statuses[COUNT_KEY[g.status]] ?? 0) + 1;

  const active = gates.filter((g) => g.applicable);
  const blocking = active.filter((g) => g.evidenceStatus !== "passed");
  const pendingGates = active.filter((g) => g.evidenceStatus === "passed" && g.ownerAcceptanceStatus === "pending").map((g) => g.id);
  const acceptedGates = active.filter((g) => g.ownerAcceptanceStatus === "accepted").map((g) => g.id);

  let decision;
  if (blocking.length > 0) decision = "blocked";
  else if (pendingGates.length > 0) decision = "pending-owner-acceptance";
  else decision = "accepted";

  const violations = (roleViolations ?? []).slice().sort();
  const reasons = [];
  if (violations.length) reasons.push(`rolle-adskillelsen er brudt: ${violations.join(", ")}`);
  if (decision === "pending-owner-acceptance") reasons.push("Den menneskelige ejeraccept er en særskilt begivenhed og er endnu ikke registreret for alle aktive gates.");
  if (decision === "blocked") reasons.push("En eller flere aktive gates har ikke gyldigt testbevis.");

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AcceptanceResult",
    generatedAt: new Date(now).toISOString(),
    targetCommit: targetCommit ?? "unknown",
    artifactDigest: artifactDigest ?? "sha256:" + "0".repeat(64),
    producer,
    profile: target?.profileRef ?? "unknown",
    target: {
      id: target?.id ?? target?.profileRef ?? "unknown",
      profileRef: target?.profileRef ?? "unknown",
      profileType: target?.profileType ?? "unknown",
      platformRef: target?.platformRef ?? "unknown",
      hostManagement: Boolean(target?.hostManagement),
      immutable: Boolean(target?.immutable),
      selfHealing: Boolean(target?.selfHealing),
      acceptedDowntimeMinutes: target?.acceptedDowntimeMinutes ?? 0,
      recoveryProfile: target?.recoveryProfile ?? "non-HA-accepted",
    },
    decision,
    statuses,
    gates,
    roles: { separated: violations.length === 0, violations },
    ownerAcceptance: {
      required: true,
      registryRef: policy?.ownerAcceptance?.registryRef ?? "distribution/acceptance/owner-acceptance.json",
      acceptedGates,
      pendingGates,
    },
    environment,
    reasons,
  };
}

/** Afled acceptmål fra scenariesættet og de faktiske installationsprofiler. */
export function deriveTargets({ scenarioSet, profiles = [] } = {}) {
  const byProfile = new Map();
  for (const scenario of scenarioSet?.scenarios ?? []) {
    if (!byProfile.has(scenario.profileRef)) byProfile.set(scenario.profileRef, []);
    byProfile.get(scenario.profileRef).push(scenario);
  }
  const targets = [];
  for (const [profileRef, scenarios] of byProfile) {
    const profile = profiles.find((p) => p.metadata?.name === profileRef);
    const flags = {
      hostManagement: scenarios.some((s) => s.hostManagement === true),
      immutable: scenarios.some((s) => s.immutable === true),
      selfHealing: scenarios.some((s) => s.selfHealing === true),
      ha: scenarios.some((s) => s.ha === true),
    };
    const profileType = profile?.profileType ?? "unknown";
    targets.push({
      id: `${profileRef}-${flags.hostManagement ? "host" : "core"}${flags.immutable ? "-immutable" : ""}${flags.selfHealing ? "-selfhealing" : ""}`,
      profileRef,
      profileType,
      platformRef: scenarios[0]?.platformRef ?? "unknown",
      hostManagement: flags.hostManagement,
      immutable: flags.immutable,
      selfHealing: flags.selfHealing,
      acceptedDowntimeMinutes: profile?.migration?.expectedDowntimeMinutes ?? 0,
      recoveryProfile: profileType === "single-server" ? "non-HA-accepted" : flags.ha ? "HA-measured-pending" : "HA",
    });
  }
  return targets.sort((a, b) => a.id.localeCompare(b.id));
}
