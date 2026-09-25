/**
 * DKC-055 — præcis én uforanderlig rolle pr. agentidentitet.
 *
 * En agent må aldrig kombinere planlægning, implementering, uafhængig kontrol
 * eller eksekvering. Rollerne herunder er den ene kilde til:
 *   - hvilke verber en rolle overhovedet må deklarere,
 *   - hvilke artefakter rollen må producere og modtage,
 *   - hvilke tools rollen må bruge,
 *   - hvem der må godkende (aldrig en AI).
 *
 * `runtime`, conformance og agent-registry bruger samme klassifikation.
 */

export const ROLES = ["observer", "planner", "implementer", "verifier", "executor", "auditor"];

/** Roller der ligner en menneskelig godkender og derfor aldrig må tildeles en AI. */
export const FORBIDDEN_AI_ROLES = [
  "approver",
  "approver-agent",
  "ai-approver",
  "reviewer-approver",
  "human-approver",
  "admin",
  "superuser",
  "root",
  "owner",
];

/** Læsende/diagnostiske verber som alle roller må deklarere. */
export const READ_VERBS = [
  "observe.read",
  "observe.correlate",
  "diagnose",
  "health",
  "slo",
  "retention.policy",
  "subject.locate",
];

/** Kontrolverber der hverken planlægger eller eksekverer. */
export const CHECK_VERBS = ["upgrade.dry-run", "verify-restore"];

/** Kun planlæggere og implementører må fremlægge et forslag. */
export const PROPOSE_VERBS = ["propose"];

/** Muterende eksekveringsverber. */
export const EXECUTE_VERBS = [
  "restart",
  "scale",
  "rotate-credential",
  "drain",
  "upgrade",
  "upgrade.patch",
  "upgrade.minor",
  "upgrade.major",
  "config.apply",
  "backup",
  "restore",
  "migrate",
  "migrate.schema",
  "rollback",
  "subject.export",
  "subject.erase",
  "subject.legal_hold",
];

/** Rolle → de verber rollen må deklarere i sit manifest. */
export const ROLE_VERBS = {
  observer: [...READ_VERBS, ...CHECK_VERBS],
  planner: [...READ_VERBS, ...PROPOSE_VERBS],
  implementer: [...READ_VERBS, ...PROPOSE_VERBS, "upgrade.dry-run"],
  verifier: [...READ_VERBS, ...CHECK_VERBS],
  executor: [...READ_VERBS, ...CHECK_VERBS, ...EXECUTE_VERBS],
  auditor: [...READ_VERBS],
};

/** Roller der må deploye/eksekvere en godkendt ændring. */
export const DEPLOY_ROLES = new Set(["executor"]);

/** Roller der producerer henholdsvis implementerer, verificerer og eksekverer. */
export const ROLE_PRODUCES = {
  observer: ["observation", "diagnosis"],
  planner: ["plan"],
  implementer: ["diff", "implementation", "runbook"],
  verifier: ["verification"],
  executor: ["execution"],
  auditor: ["audit-report"],
};

/** Artefakttyper rollen må modtage som input. */
export const ROLE_CONSUMES = {
  observer: [],
  planner: ["observation", "diagnosis"],
  implementer: ["plan"],
  verifier: ["diff", "implementation", "runbook"],
  executor: ["verification", "runbook"],
  auditor: ["audit-events"],
};

/** Rolle → tilladte tools. Separate credentials udstedes pr. rolle. */
export const ROLE_TOOLS = {
  observer: ["read", "query", "metrics"],
  planner: ["read", "query", "metrics", "plan-write"],
  implementer: ["read", "query", "code-write", "test-run", "plan-read"],
  verifier: ["read", "query", "test-run", "verify-write", "plan-read"],
  executor: ["read", "query", "execute", "deploy", "rollback", "backup", "restore"],
  auditor: ["read", "query", "audit-read"],
};

/**
 * Handoff-grafen: hvilke roller må producere et artefakt, og hvem må modtage
 * det. Grafen er asymmetrisk, så en agent aldrig kan overdrage til sig selv
 * eller springe den uafhængige kontrol over.
 */
export const HANDOFF_RULES = {
  plan: { producer: ["planner"], receiver: ["implementer"] },
  diff: { producer: ["implementer"], receiver: ["verifier"] },
  runbook: { producer: ["implementer"], receiver: ["verifier", "executor"] },
  verification: { producer: ["verifier"], receiver: ["executor"] },
};

const KNOWN_VERBS = new Set([...READ_VERBS, ...CHECK_VERBS, ...PROPOSE_VERBS, ...EXECUTE_VERBS]);

export function isRole(value) {
  return ROLES.includes(value);
}

export function isForbiddenAiRole(value) {
  return FORBIDDEN_AI_ROLES.includes(value);
}

export function roleAllowsVerb(role, verb) {
  const allowed = ROLE_VERBS[role];
  if (Array.isArray(allowed) && allowed.includes(verb)) return true;
  // Et nyt, ukendt ops-verbum er muterende og hører kun til eksekveringsrollen.
  // Det er bevidst fail-closed: det mødes stadig af A4-klassifikationen og
  // PDP'en ved runtime, men en planner/verifier kan ikke deklarere det.
  if (role === "executor" && typeof verb === "string" && verb.trim() !== "" && !KNOWN_VERBS.has(verb) && !PROPOSE_VERBS.includes(verb)) {
    return true;
  }
  return false;
}

export function roleMayProduce(role, artifactKind) {
  return (ROLE_PRODUCES[role] ?? []).includes(artifactKind);
}

export function roleMayConsume(role, artifactKind) {
  return (ROLE_CONSUMES[role] ?? []).includes(artifactKind);
}

export function roleMayDeploy(role) {
  return DEPLOY_ROLES.has(role);
}

/** En AI er aldrig godkender — uanset rolle. */
export function roleMayApprove() {
  return false;
}

export function roleAllowedVerbs(role) {
  return [...(ROLE_VERBS[role] ?? [])];
}

export function roleAllowedTools(role) {
  return [...(ROLE_TOOLS[role] ?? [])];
}

export function roleAllowedArtifacts(role) {
  return [...(ROLE_PRODUCES[role] ?? [])];
}

export function handoffRule(artifactKind) {
  return HANDOFF_RULES[artifactKind] ?? null;
}

/**
 * Validér at et manifest har præcis én rolle, og at alle deklarerede
 * capabilities er tilladte for den rolle. Returnerer `{ ok, errors, role }`.
 */
export function validateRoleManifest(manifest) {
  const errors = [];
  const role = manifest?.role;

  if (manifest?.roles !== undefined) {
    errors.push({ path: "/roles", message: "en agent må have præcis én rolle; et 'roles'-felt er ikke tilladt" });
  }
  if (Array.isArray(role)) {
    errors.push({ path: "/role", message: "role skal være en enkelt streng, ikke en liste" });
  } else if (isForbiddenAiRole(role)) {
    errors.push({ path: "/role", message: `rollen '${role}' er en godkender-/administratorrolle og kan ikke tildeles en AI` });
  } else if (!isRole(role)) {
    errors.push({ path: "/role", message: `ukendt eller manglende rolle '${role ?? ""}' (tilladte: ${ROLES.join(", ")})` });
  }

  if (isRole(role)) {
    const caps = manifest?.capabilities;
    if (Array.isArray(caps)) {
      for (const [i, cap] of caps.entries()) {
        if (!roleAllowsVerb(role, cap?.verb)) {
          errors.push({ path: `/capabilities/${i}/verb`, message: `verbet '${cap?.verb}' er ikke tilladt for rollen '${role}'` });
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, role: isRole(role) ? role : null };
}
