/**
 * DKC-047 — adgangs- og transitionsguard for beskyttede dataklasser.
 *
 * Guarden er en ren, deterministisk funktion. Den er **deny-only** oven på den
 * generelle PDP: den kan kun fjerne rettigheder, aldrig give nye. Dermed kan
 * hverken et allow-svar fra PDP'en, en menneskelig godkendelse eller en adapter
 * omgå beskyttelsen.
 *
 * Tre regelsæt holdes adskilt:
 *   - AI-ændringsforbud: en AI-principal må ikke mutere en beskyttet post,
 *     uanset klasse. Det inkluderer alias-/current-pointer, policy, lifecycle,
 *     nøgler og sletning.
 *   - WORM-retention: retention-locked kræver en vurderet, endelig frist.
 *   - AI-læseforbud: `noAiAccess` udelukker alle AI-flows, også retrieval,
 *     prompts, logs og træning/analyse.
 *
 * Transitioner (kopi, eksport, restore) må ikke nedgradere beskyttelsen: den nye
 * destination skal bære samme klasse og samme no-AI-access-flag, medmindre et
 * navngivet menneske med omklassificeringsmyndighed eksplicit omklassificerer.
 */
import { isProtectedClass, isProtectionPreservingOperation, normalizeOperation } from "./classes.mjs";

export class ProtectedDataError extends Error {
  constructor(message, { decision = "deny", reasons = [] } = {}) {
    super(message);
    this.name = "ProtectedDataError";
    this.decision = decision;
    this.reasons = reasons;
  }
}

function decision(effect, reasons = [], obligations = []) {
  return { decision: effect, allowed: effect === "allow", reasons, obligations };
}

const allow = (obligations = []) => decision("allow", [], obligations);
const deny = (...reasons) => decision("deny", reasons);

export function isReclassifier(principal, record) {
  const id = principal?.id ?? principal?.subject ?? null;
  return (record?.reclassifiers ?? []).some((r) => r.subject === id);
}

/** Stemmer destinationens beskyttelse overens med kilden? */
export function transitionProblems(record, destination) {
  const problems = [];
  if (!destination) {
    problems.push("destinationen for en beskyttet transition mangler — beskyttelsen kan ikke verificeres");
    return problems;
  }
  if (destination.dataClass !== record.dataClass) {
    problems.push(`destinationens klasse '${destination.dataClass}' nedgraderer kilden '${record.dataClass}'`);
  }
  if (Boolean(destination.noAiAccess) !== Boolean(record.noAiAccess)) {
    problems.push("destinationens no-AI-access-flag ændrer beskyttelsen");
  }
  if ((destination.versionId ?? null) && destination.versionId === record.versionId && destination.dataClass === record.dataClass) {
    // Samme version kopieret til et nyt sted er i orden; det er kun et problem
    // hvis ovenstående klasse/flag afviger.
  }
  return problems;
}

/**
 * Retention-/hold-transition. En WORM-post må ikke kopieres, eksporteres eller
 * gendannes uden sin vurderede frist, og et aktivt hold må ikke falde bort.
 */
export function retentionTransitionProblems(source, destination) {
  const problems = [];
  if (source?.dataClass !== "retention-locked") return problems;
  if (!destination?.retention) {
    problems.push("en retention-locked post må ikke kopieres/eksporteres/gendannes uden sin retention");
    return problems;
  }
  if (!Number.isInteger(destination.retention.maxDays) || destination.retention.maxDays < 1) {
    problems.push("destinationens WORM-frist er ikke endelig");
  }
  if (source.retention?.hold?.status === "active" && destination.retention?.hold?.status !== "active") {
    problems.push("et aktivt hold må ikke fjernes ved en transition");
  }
  if (source.retention?.maxDays && destination.retention?.maxDays && destination.retention.maxDays > source.retention.maxDays) {
    problems.push("destinationens frist forlænger WORM ud over den vurderede frist");
  }
  return problems;
}

/**
 * Evaluer én AI-/menneskelig operation mod én beskyttet post.
 *
 * @param {object} args
 * @param {{kind:string,id?:string}} args.principal
 * @param {string} args.operation read|retrieve|prompt|train|analyze|log-access|append|update|delete|copy|export|restore|reclassify|pointer-update|key-rotate
 * @param {object} args.record beskyttelsesposten
 * @param {object} [args.destination] destination for copy/export/restore
 * @param {object} args.policy access-policy.json
 * @param {string} [args.adapter] app|admin|restore (til sporbarhed)
 */
export function evaluateProtectedData({ principal, operation, record, destination = null, policy, adapter = null } = {}) {
  if (!policy) throw new ProtectedDataError("mangler beskyttelsespolitik");
  const op = normalizeOperation(operation);
  const where = adapter ? ` via '${adapter}'-adapteren` : "";

  if (!record) return deny(`ukendt beskyttelsespost${where} — fail-closed`);

  const protectedRecord = isProtectedClass(record.dataClass) || record.noAiAccess === true;
  if (!protectedRecord) return allow();

  const kind = principal?.kind;

  if (kind === "agent") {
    if (record.noAiAccess && policy.noAiAccessDeniesAll !== false) {
      return deny(`no-AI-access${where}: AI må ikke læse, hente, prompte, logge eller træne på '${record.id}'`);
    }
    if ((policy.aiForbiddenOperations ?? []).includes(op)) {
      return deny(`AI må ikke udføre '${op}' på den beskyttede post '${record.id}'${where}`);
    }
    const allowed = policy.agentOperationMatrix?.[record.dataClass] ?? [];
    if (!allowed.includes(op)) {
      return deny(`operationen '${op}' er ikke tilladt for AI på klassen '${record.dataClass}'${where}`);
    }
    if (isProtectionPreservingOperation(op, policy)) {
      const problems = transitionProblems(record, destination);
      if (problems.length) return deny(...problems.map((p) => `${p}${where}`));
    }
    return allow();
  }

  // Menneske (eller service på vegne af et menneske).
  if (op === "reclassify") {
    if (!isReclassifier(principal, record)) {
      return deny(`kun navngivne omklassificeringsmyndigheder må omklassificere '${record.id}'${where}`);
    }
    return allow(["human-process:newVersion"]);
  }

  if (isProtectionPreservingOperation(op, policy)) {
    const problems = transitionProblems(record, destination);
    if (problems.length) return deny(...problems.map((p) => `${p}${where}`));
    const retentionProblems = retentionTransitionProblems(record, destination);
    if (retentionProblems.length) return deny(...retentionProblems.map((p) => `${p}${where}`));
  }

  return allow();
}

/**
 * Eksplicit omklassificering. Kun et navngivet menneske i postens
 * reclassifiers-liste må ændre klassen; AI afvises uanset godkendelse.
 */
export function authorizeReclassification({ principal, record, newClass, newNoAiAccess = null, policy } = {}) {
  if (!policy) throw new ProtectedDataError("mangler beskyttelsespolitik");
  if (principal?.kind !== "human") return deny("kun et navngivet menneske må omklassificere beskyttede data — AI kan ikke omklassificere");
  if (!isReclassifier(principal, record)) return deny(`'${principal?.id}' er ikke i reclassifiers for '${record?.id}'`);
  if (!policy.agentOperationMatrix?.[newClass] && newClass !== "ordinary") return deny(`ukendt dataklasse '${newClass}'`);
  const obligations = ["human-process:newVersion"];
  if (newNoAiAccess === true) obligations.push("no-ai-access:reinforced");
  return allow(obligations);
}

/**
 * Guard for adapterkald. App-, admin- og restore-adaptere deler præcis samme
 * regel, så en beskyttet klasse ikke kan omgås ved at vælge en anden indgang.
 */
export function guardAdapterCall({ adapter, ...rest }) {
  return evaluateProtectedData({ ...rest, adapter });
}
