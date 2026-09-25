/**
 * DKC-044 — servicekatalog og on-call-rotation.
 *
 * Ren, sideeffektfri læsning af det autoritative servicekatalog og den
 * menneskelige on-call-rotation. Både adapteren, conformance-valideringen og
 * testene bruger disse funktioner, så kataloget har én fortolkning.
 *
 * Principperne:
 *   - en tjeneste har et navngivet menneske som ejer og en on-call-rotation,
 *   - den aktuelt vagthavende er altid et menneske; en AI er aldrig
 *     eskalationspunkt,
 *   - eskalationskæden er strengt stigende i minutter,
 *   - en tjenestes afhængigheder er transitive, så en incident kan melde de
 *     berørte tjenester præcist.
 */

const SEVERITIES = ["sev1", "sev2", "sev3", "sev4"];

function isHuman(value) {
  return Boolean(value?.subject && value?.name && value?.role);
}

/** Byg et indeks over kataloget: id → tjeneste. */
export function indexCatalog(catalog) {
  const services = Array.isArray(catalog?.services) ? catalog.services : [];
  const byId = new Map(services.map((s) => [s.id, s]));
  return { services, byId };
}

/**
 * De tjenester en incident på `serviceId` berører: tjenesten selv plus alle
 * transitive afhængigheder. Ukendte referencer ignoreres bevidst, så en
 * manglende CI-relation ikke skjuler den berørte tjeneste.
 */
export function affectedServices(catalog, serviceId) {
  const { byId } = indexCatalog(catalog);
  const seen = new Set();
  const order = [];
  const visit = (id) => {
    if (!id || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const dep of byId.get(id).dependsOn ?? []) visit(dep);
  };
  visit(serviceId);
  return order;
}

/** Ejeren (navngivet menneske) for en tjeneste. */
export function ownerForService(catalog, serviceId) {
  return indexCatalog(catalog).byId.get(serviceId)?.owner ?? null;
}

/** Slå rotationen op for en tjeneste. */
export function rotationForService(rotations, serviceId) {
  const list = Array.isArray(rotations?.rotations) ? rotations.rotations : [];
  return list.find((r) => r.serviceId === serviceId) ?? null;
}

/** Den vagthavende primære (altid et menneske). */
export function currentOnCall(rotation) {
  return rotation?.primary ?? null;
}

/** Den fulde eskalationskæde: primær først, derefter de stigende trin. */
export function escalationChain(rotation) {
  if (!rotation) return [];
  const chain = [];
  if (rotation.primary) chain.push(rotation.primary);
  for (const step of rotation.escalation ?? []) {
    if (step?.to) chain.push(step.to);
  }
  return chain;
}

/**
 * Hvilket menneske der skal kontaktes, når en kvittering er `overdueMinutes`
 * forsinket. Falder tilbage til sidste led i kæden.
 */
export function escalationTarget(rotation, overdueMinutes) {
  const steps = rotation?.escalation ?? [];
  let target = escalationChain(rotation)[0] ?? null;
  for (const step of steps) {
    if (Number(overdueMinutes) >= Number(step.afterMinutes)) target = step.to;
  }
  return target;
}

/** Kvitteringsfristen for en incident i minutter. */
export function ackDeadlineMinutes(catalog, rotation, severity) {
  const fromService = (indexCatalog(catalog).byId.get(rotation?.serviceId)?.sla ?? []).find((s) => s.severity === severity);
  if (fromService && Number.isFinite(fromService.responseMinutes)) return fromService.responseMinutes;
  if (Number.isFinite(rotation?.ackMinutes)) return rotation.ackMinutes;
  return 60;
}

/** Er alle fire alvorlighedsgrader dækket af en SLA-liste? */
export function slaCoversAllSeverities(sla) {
  const set = new Set((sla ?? []).map((s) => s.severity));
  return SEVERITIES.every((s) => set.has(s));
}

export { SEVERITIES };
