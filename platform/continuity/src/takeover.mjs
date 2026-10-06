/**
 * DKC-052 — beredskabsøvelser og overtagelseskontrol.
 *
 * Mennesker skal kunne overtage og gendanne tjenesten, også når AI'en og den
 * primære platform er nede. Modulet er en deterministisk orkestrator for en
 * gentagelig øvelse med et eksplicit tilstands- og trinmodell:
 *
 *   takeover → restore → failback → validation
 *
 * Hvert trin er enten `machine` (en probe mod den rigtige kode/et rigtigt
 * artefakt) eller `human` (en out-of-band handling, der kun kan udføres af et
 * navngivet menneske). En menneskestyret handling bliver **aldrig** automatisk
 * `pass`: den forbliver `pending`, indtil et navngivet menneske faktisk har
 * udført den og efterladt evidens. Agenten kan derfor ikke godkende beredskab —
 * `agentCanApprove` er altid `false`, og en kritisk incident lukkes først efter
 * servicevalidering og en menneskelig accept.
 *
 * En timeout på et menneskeligt trin eskalerer gennem en kæde af navngivne
 * mennesker. Ingen ansvarskæde ender hos en agent.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const TAKEOVER_STATUS = ["validated", "awaiting-human", "blocked", "not-run"];
export const STEP_STATUS = ["pending", "pass", "fail", "blocked", "not-run"];
export const STEP_KINDS = ["machine", "human"];
export const DRILL_PHASES = ["takeover", "restore", "failback", "validation"];
export const TAKEOVER_ROLES = ["serviceOwner", "substitute", "onCall", "incidentLead", "changeAuthority", "dataProtection"];
export const SCENARIO_KINDS = ["single-server", "ha", "ai-offline", "iam-loss", "site-catastrophe"];

const TEAM_SCHEMES = new Set(["team", "group", "agent", "service", "robot", "bot"]);

/** Et navngivet menneske — ikke en agent, et team eller en tom streng. */
export function isNamedHuman(owner) {
  if (!owner || typeof owner.subject !== "string") return false;
  const [scheme, ...rest] = owner.subject.split("|");
  const id = rest.join("|").trim();
  if (!id || id.length < 3) return false;
  if (TEAM_SCHEMES.has((scheme ?? "").toLowerCase())) return false;
  if (!owner.name || owner.name.trim().length < 2) return false;
  if (!owner.role || owner.role.trim().length < 2) return false;
  return true;
}

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function err(path, message) {
  return { path, message };
}

/** Byg rolle → menneske fra planen, evt. med overrides for en øvelse. */
export function buildOperators(plan, overrides = null) {
  const ops = {};
  for (const role of TAKEOVER_ROLES) {
    ops[role] = plan?.roles?.[role] ?? null;
  }
  if (overrides) {
    for (const [role, human] of Object.entries(overrides)) {
      if (human) ops[role] = human;
    }
  }
  return ops;
}

/**
 * Eskalationskæden for et trin. En `pending` menneskelig handling ved sin
 * ack-frist eskalerer til de næste navngivne mennesker. Sidste led er altid et
 * menneske; kæden kan ikke ende hos en agent.
 */
export function escalationFor(plan, step) {
  const chain = plan?.contactChannel?.escalation ?? [];
  const ack = step?.ackMinutes ?? 0;
  const strip = (h) => (h ? { subject: h.subject, name: h.name, role: h.role } : null);
  const escalations = chain
    .filter((e) => Number(e.afterMinutes) >= ack)
    .map((e) => ({ afterMinutes: e.afterMinutes, to: strip(e.to) }))
    .filter((e) => e.to);
  if (escalations.length === 0) {
    const onCall = plan?.roles?.onCall ?? null;
    if (onCall) escalations.push({ afterMinutes: ack, to: strip(onCall) });
  }
  return escalations;
}

/* -------------------------------------------------------------------------- */
/* Semantik for overtagelsesplanen                                            */
/* -------------------------------------------------------------------------- */

export function takeoverPlanProblems(plan, { root = null } = {}) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "overtagelsesplanen er ikke et objekt")];
  if (plan.kind !== "TakeoverPlan") problems.push(err("/kind", "planen skal være af typen TakeoverPlan"));
  if (!isNamedHuman(plan.metadata?.accountableHuman)) problems.push(err("/metadata/accountableHuman", "planen skal have et navngivet menneske som ejer"));
  if (!(plan.metadata?.lastReviewed ?? "").trim()) problems.push(err("/metadata/lastReviewed", "planen mangler en gennemgangsdato"));

  const roles = plan.roles ?? {};
  for (const role of TAKEOVER_ROLES) {
    if (!isNamedHuman(roles[role])) problems.push(err(`/roles/${role}`, `rollen '${role}' skal være et navngivet menneske`));
  }
  if (isNamedHuman(roles.serviceOwner) && isNamedHuman(roles.substitute) && roles.serviceOwner.subject === roles.substitute.subject) {
    problems.push(err("/roles/substitute", "stedfortræderen må ikke være den samme person som serviceejeren"));
  }
  if (isNamedHuman(roles.onCall) && roles.onCall.channel == null) problems.push(err("/roles/onCall/channel", "on-call skal have en uafhængig kontaktkanal"));

  const channel = plan.contactChannel ?? {};
  if (channel.independent !== true) problems.push(err("/contactChannel/independent", "kontaktkanalen skal være uafhængig af platformen"));
  if ((channel.testRecipients ?? []).length < 2) problems.push(err("/contactChannel/testRecipients", "der skal være mindst to testmodtagere til eskalationsøvelser"));
  for (const [i, r] of (channel.testRecipients ?? []).entries()) {
    if (!isNamedHuman(r)) problems.push(err(`/contactChannel/testRecipients/${i}`, "en testmodtager skal være et navngivet menneske"));
  }
  const escalation = channel.escalation ?? [];
  if (escalation.length === 0) problems.push(err("/contactChannel/escalation", "der skal findes en eskalationskæde"));
  for (const [i, e] of escalation.entries()) {
    if (!isNamedHuman(e.to)) problems.push(err(`/contactChannel/escalation/${i}/to`, "en eskalation skal gå til et navngivet menneske"));
  }

  const offline = plan.offlineRunbooks ?? {};
  if ((offline.copies ?? []).length < 2) problems.push(err("/offlineRunbooks/copies", "der skal findes en offline/recoverykopi af runbooks"));
  if (!(offline.independentMedium ?? "").trim()) problems.push(err("/offlineRunbooks/independentMedium", "offline-kopien skal ligge på et uafhængigt medie"));

  const credentials = plan.credentials ?? {};
  if (credentials.underHumanControl !== true) problems.push(err("/credentials/underHumanControl", "credentials skal være under menneskelig kontrol"));
  if ((credentials.custodians ?? []).length < 2) problems.push(err("/credentials/custodians", "mindst to mennesker skal være depositarer for credentials"));
  if (credentials.breakGlass?.requiresTwoPerson !== true) problems.push(err("/credentials/breakGlass/requiresTwoPerson", "break-glass skal kræve to-personers kontrol"));

  const restore = plan.restorePlan ?? {};
  if (!isNamedHuman(restore.owner)) problems.push(err("/restorePlan/owner", "restoreplanen skal have et navngivet menneske som ejer"));
  const priority = restore.priority ?? [];
  if (priority.length < 3) problems.push(err("/restorePlan/priority", "restoreplanen skal prioritere mindst tre komponenter"));
  const orders = priority.map((p) => p.order).sort((a, b) => a - b);
  if (new Set(orders).size !== orders.length) problems.push(err("/restorePlan/priority", "prioritetsrækkefølgen må ikke gentage et trin"));
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i + 1) {
      problems.push(err("/restorePlan/priority", "prioritetsrækkefølgen skal være sammenhængende fra 1"));
      break;
    }
  }

  const profiles = plan.profiles ?? {};
  if (profiles.formallyChosen !== true) problems.push(err("/profiles/formallyChosen", "HA-/immutable-/self-healing-profilen skal være formelt valgt"));
  if (!isNamedHuman(profiles.chosenBy)) problems.push(err("/profiles/chosenBy", "profilvalget skal være truffet af et navngivet menneske"));
  if ((profiles.testedBy ?? []).length === 0) problems.push(err("/profiles/testedBy", "profilvalget skal være testet og refereret"));

  const drills = plan.drills ?? {};
  const schedule = drills.schedule ?? {};
  for (const key of ["accessReviewDays", "backupControlDays", "capacityReviewDays", "drDrillDays", "runbookRecertificationDays"]) {
    if (!(schedule[key] > 0)) problems.push(err(`/drills/schedule/${key}`, `kadencen '${key}' skal være positiv`));
  }
  const scenarios = drills.scenarios ?? [];
  if (scenarios.length < 2) problems.push(err("/drills/scenarios", "der skal findes mindst to scenarier"));
  const kinds = new Set(scenarios.map((s) => s.kind));
  for (const required of ["single-server", "ha"]) {
    if (!kinds.has(required)) problems.push(err("/drills/scenarios", `der mangler et '${required}'-scenarie`));
  }
  const ids = new Set();
  for (const [i, scenario] of scenarios.entries()) {
    const at = `/drills/scenarios/${i}`;
    if (ids.has(scenario.id)) problems.push(err(`${at}/id`, `scenariet '${scenario.id}' er erklæret flere gange`));
    ids.add(scenario.id);
    if (!SCENARIO_KINDS.includes(scenario.kind)) problems.push(err(`${at}/kind`, `ukendt scenariekind '${scenario.kind}'`));
    const steps = scenario.steps ?? [];
    if (steps.length < 6) problems.push(err(`${at}/steps`, `scenariet '${scenario.id}' skal have mindst seks trin`));
    const stepIds = new Set();
    let hasHuman = false;
    let hasAcceptance = false;
    for (const [j, step] of steps.entries()) {
      const sat = `${at}/steps/${j}`;
      if (stepIds.has(step.id)) problems.push(err(`${sat}/id`, `trinnet '${step.id}' er erklæret flere gange`));
      stepIds.add(step.id);
      if (!DRILL_PHASES.includes(step.phase)) problems.push(err(`${sat}/phase`, `ukendt fase '${step.phase}'`));
      if (!STEP_KINDS.includes(step.kind)) problems.push(err(`${sat}/kind`, `ukendt trinkind '${step.kind}'`));
      if (step.kind === "human") {
        hasHuman = true;
        if (!TAKEOVER_ROLES.includes(step.ownerRole)) problems.push(err(`${sat}/ownerRole`, `et menneskeligt trin skal have en navngivet rolle`));
        if (step.evidenceKind === "incident-acceptance") hasAcceptance = true;
      }
      if (step.kind === "machine" && !step.probe) problems.push(err(`${sat}/probe`, `et maskintrin skal pege på en probe`));
      if (step.required && step.ackMinutes > 0 && (channel.escalation ?? []).length === 0) {
        problems.push(err(`${sat}/ackMinutes`, "et påkrævet trin med ack-frist kræver en eskalationskæde"));
      }
    }
    if (!hasHuman) problems.push(err(`${at}/steps`, `scenariet '${scenario.id}' skal indeholde mindst ét menneskeligt trin`));
    if (!hasAcceptance) problems.push(err(`${at}/steps`, `scenariet '${scenario.id}' skal slutte med en menneskelig incidentaccept`));
  }

  if (root) {
    for (const [i, scenario] of scenarios.entries()) {
      for (const [key, ref] of Object.entries(scenario.artifacts ?? {})) {
        if (!existsSync(`${root}/${ref}`)) problems.push(err(`/drills/scenarios/${i}/artifacts/${key}`, `artefakten '${ref}' findes ikke`));
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Semantik for øvelsesrapporten                                              */
/* -------------------------------------------------------------------------- */

export function recoveryDrillProblems(report) {
  const problems = [];
  if (!report || typeof report !== "object") return [err("/", "øvelsesrapporten er ikke et objekt")];
  if (report.kind !== "RecoveryDrill") problems.push(err("/kind", "rapporten skal være af typen RecoveryDrill"));
  if (report.agentCanApprove !== false) problems.push(err("/agentCanApprove", "agenten må ikke kunne godkende beredskab"));
  if (report.requiresHumanAcceptance !== true) problems.push(err("/requiresHumanAcceptance", "en kritisk incident kræver menneskelig accept"));
  if (report.measured !== false) problems.push(err("/measured", "øvelsen må ikke erklære en målt kørsel"));

  const steps = report.steps ?? [];
  const required = steps.filter((s) => s.required !== false);
  const humanSteps = steps.filter((s) => s.kind === "human");
  const acceptance = steps.find((s) => s.evidenceKind === "incident-acceptance");

  for (const [i, step] of steps.entries()) {
    const at = `/steps/${i}`;
    if (step.kind === "human") {
      if (step.status === "pass" && !isNamedHuman(step.owner)) problems.push(err(`${at}/owner`, "et bestået menneskeligt trin kræver et navngivet menneske som udfører"));
      if (step.status === "pass" && !(step.at ?? "").trim()) problems.push(err(`${at}/at`, "et bestået menneskeligt trin kræver et tidsstempel"));
      if (step.status !== "pass" && step.owner && !isNamedHuman(step.owner)) problems.push(err(`${at}/owner`, "en ansvarlig operatør skal være et navngivet menneske"));
      for (const [j, e] of (step.escalation ?? []).entries()) {
        if (!isNamedHuman(e.to)) problems.push(err(`${at}/escalation/${j}/to`, "en eskalation skal gå til et navngivet menneske"));
      }
    }
    if (step.kind === "machine" && step.status === "pass" && !(step.at ?? "").trim()) problems.push(err(`${at}/at`, "et bestået maskintrin kræver et tidsstempel"));
  }

  if (!humanSteps.length) problems.push(err("/steps", "øvelsen skal indeholde mindst ét menneskeligt trin"));
  if (!acceptance) problems.push(err("/steps", "øvelsen skal indeholde en menneskelig incidentaccept"));

  const validated = report.status === "validated";
  if (validated) {
    if ((report.gate?.status ?? "") !== "pass") problems.push(err("/gate/status", "en 'validated'-øvelse skal have en 'pass'-gate"));
    if ((report.gate?.reasons ?? []).length) problems.push(err("/gate/reasons", "en 'pass'-gate må ikke bære begrundelser"));
    for (const step of required) {
      if (step.status !== "pass") problems.push(err("/steps", `en 'validated'-øvelse kræver at '${step.id}' består (var '${step.status}')`));
    }
    if (acceptance?.status !== "pass" || !isNamedHuman(acceptance?.owner)) problems.push(err("/steps", "en 'validated'-øvelse kræver en menneskelig incidentaccept"));
    if (report.measurements?.dataIntegrityOk !== true) problems.push(err("/measurements/dataIntegrityOk", "en 'validated'-øvelse kræver målt dataintegritet"));
  } else if (report.status === "awaiting-human") {
    if ((report.gate?.status ?? "") !== "awaiting-human") problems.push(err("/gate/status", "en 'awaiting-human'-øvelse skal have en 'awaiting-human'-gate"));
    if (!steps.some((s) => s.kind === "human" && s.status === "pending")) problems.push(err("/steps", "en 'awaiting-human'-øvelse skal have mindst ét afventende menneskeligt trin"));
    if (steps.some((s) => s.required !== false && (s.status === "fail" || s.status === "blocked"))) problems.push(err("/steps", "en 'awaiting-human'-øvelse må ikke have et fejlet påkrævet trin"));
  } else if (report.status === "blocked") {
    if ((report.gate?.status ?? "") !== "blocked") problems.push(err("/gate/status", "en 'blocked'-øvelse skal have en 'blocked'-gate"));
    if ((report.gate?.reasons ?? []).length === 0) problems.push(err("/gate/reasons", "en 'blocked'-gate skal forklare hvorfor"));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Øvelsesrunner                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} options
 * @param {object} options.plan    Den kanoniske TakeoverPlan.
 * @param {object} [options.probes] Kort fra probe-navn → async funktion.
 * @param {Function} [options.clock]
 * @param {string} [options.root]
 */
export function createRecoveryDrill({ plan, probes = {}, clock = () => Date.now(), root = null } = {}) {
  if (!plan) throw new Error("createRecoveryDrill kræver en overtagelsesplan");

  function resolveScenario(scenarioId) {
    const scenario = (plan.drills?.scenarios ?? []).find((s) => s.id === scenarioId);
    if (!scenario) throw new Error(`ukendt øvelsesscenarie '${scenarioId}'`);
    return scenario;
  }

  function artifactBindingsFor(scenario) {
    return Object.entries(scenario.artifacts ?? {}).map(([kind, ref]) => {
      const path = root ? `${root}/${ref}` : ref;
      if (!existsSync(path)) return { kind, ref, digest: null, present: false };
      return { kind, ref, digest: `sha256:${sha256Hex(readFileSync(path))}`, present: true };
    });
  }

  /**
   * Kør ét scenarie. Menneskelige trin forbliver `pending`, medmindre der
   * leveres rigtig evidens i `humanEvidence`.
   */
  async function runScenario(scenarioId, { operators = null, humanEvidence = {}, injectedFailures = {}, now = clock(), drillId = null } = {}) {
    const scenario = resolveScenario(scenarioId);
    const ops = buildOperators(plan, operators);
    const startedAt = new Date(now).toISOString();
    const artifactBindings = artifactBindingsFor(scenario);
    const steps = [];
    const decisions = [];
    const measurements = {
      dataIntegrityOk: null,
      restoreVerified: null,
      failbackVerified: null,
      rpoMinutes: null,
      rtoMinutes: null,
      rpoTargetMinutes: null,
      rtoTargetMinutes: null,
    };
    const blockedReasons = [];
    let blocked = false;

    for (const def of scenario.steps) {
      let status = "pending";
      let owner = def.ownerRole ? ops[def.ownerRole] ?? null : null;
      let at = null;
      let artifactRef = null;
      let artifactDigest = null;
      let result = null;
      let escalation = [];
      let notes = null;

      if (blocked && def.required !== false) {
        status = "not-run";
        notes = "forrige påkrævede trin stoppede øvelsen";
      } else if (def.kind === "machine") {
        if (injectedFailures[def.id]) {
          status = "fail";
          result = `injecteret fejl: ${String(injectedFailures[def.id])}`;
        } else if (def.probe && typeof probes[def.probe] === "function") {
          const probeResult = (await probes[def.probe]({ plan, scenario, step: def, operators: ops, now, root })) ?? {};
          status = STEP_STATUS.includes(probeResult.status) ? probeResult.status : "pass";
          result = probeResult.result ?? null;
          artifactRef = probeResult.artifactRef ?? null;
          artifactDigest = probeResult.artifactDigest ?? null;
          at = probeResult.at ?? (status === "pass" ? new Date(now).toISOString() : null);
          if (probeResult.measurements) {
            for (const [k, v] of Object.entries(probeResult.measurements)) {
              if (k in measurements) measurements[k] = v;
            }
          }
        } else {
          status = "blocked";
          result = `mangler probe eller evidens for '${def.probe}'`;
        }
      } else {
        const evidence = humanEvidence[def.id];
        if (evidence && isNamedHuman(evidence.by)) {
          const expected = def.ownerRole ? ops[def.ownerRole] : null;
          const allowedSubjects = new Set([expected?.subject, expected?.substitute?.subject].filter(Boolean));
          if (expected && allowedSubjects.size && !allowedSubjects.has(evidence.by.subject)) {
            status = "blocked";
            result = "operatøren har ikke den påkrævede rolle";
          } else {
            status = "pass";
            owner = evidence.by;
            at = evidence.at ?? new Date(now).toISOString();
            result = evidence.decision ?? "menneskelig handling udført";
          }
          if (evidence.decision && ["owner-decision", "incident-acceptance"].includes(def.evidenceKind)) {
            decisions.push({ phase: def.phase, decision: evidence.decision, by: evidence.by, at, evidenceRef: evidence.evidenceRef ?? null });
          }
        } else {
          status = "pending";
          result = "afventer menneskelig handling";
          escalation = escalationFor(plan, def);
        }
      }

      if (def.required !== false && (status === "fail" || status === "blocked")) {
        blocked = true;
        blockedReasons.push(`${def.id}: ${result}`);
      }

      steps.push({
        id: def.id,
        phase: def.phase,
        kind: def.kind,
        status,
        ownerRole: def.ownerRole ?? null,
        owner: owner && isNamedHuman(owner) ? { subject: owner.subject, name: owner.name, role: owner.role } : null,
        at,
        artifactRef,
        artifactDigest,
        evidenceKind: def.evidenceKind,
        probe: def.probe ?? null,
        result,
        escalation,
        notes,
      });
    }

    const requiredSteps = steps.filter((s) => scenario.steps.find((d) => d.id === s.id)?.required !== false);
    const failedRequired = requiredSteps.filter((s) => s.status === "fail" || s.status === "blocked");
    const pendingHuman = steps.filter((s) => s.kind === "human" && s.status === "pending");
    const acceptance = steps.find((s) => s.evidenceKind === "incident-acceptance");

    let status;
    let gate;
    if (failedRequired.length || blocked) {
      status = "blocked";
      gate = { status: "blocked", reasons: blockedReasons.length ? blockedReasons : failedRequired.map((s) => `${s.id}: ${s.result}`) };
    } else if (acceptance && acceptance.status === "pass") {
      status = "validated";
      gate = { status: "pass", reasons: [] };
    } else {
      status = "awaiting-human";
      gate = {
        status: "awaiting-human",
        reasons: [
          ...pendingHuman.map((s) => `trinnet '${s.id}' afventer ${s.ownerRole ?? "et menneske"}`),
          ...(acceptance && acceptance.status !== "pass" ? ["kritisk incident er ikke accepteret af et menneske"] : []),
        ],
      };
    }

    return {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "RecoveryDrill",
      drillId: drillId ?? `drill-${scenario.id}-${startedAt}`,
      scenarioId: scenario.id,
      scenarioKind: scenario.kind,
      environment: scenario.environment,
      status,
      startedAt,
      finishedAt: new Date(clock()).toISOString(),
      planRef: plan.metadata?.name ?? "takeover-plan",
      planVersion: plan.metadata?.version ?? "0.0.0",
      operators: TAKEOVER_ROLES.map((role) => ({ role, human: ops[role] ? { subject: ops[role].subject, name: ops[role].name, role: ops[role].role } : null })),
      artifactBindings,
      steps,
      measurements,
      decisions,
      gate,
      agentCanApprove: false,
      requiresHumanAcceptance: true,
      measured: false,
    };
  }

  async function runAll(options = {}) {
    const drills = [];
    for (const scenario of plan.drills?.scenarios ?? []) {
      drills.push(await runScenario(scenario.id, options));
    }
    return drills;
  }

  return { plan, probes, runScenario, runAll, scenarioIds: (plan.drills?.scenarios ?? []).map((s) => s.id) };
}
