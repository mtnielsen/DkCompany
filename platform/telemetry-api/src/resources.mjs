/**
 * DKC-066 — stabile ressource-ID'er og relationer.
 *
 * En telemetrihændelse skal kunne korreleres på tværs af tjeneste, miljø,
 * tenant, installeret version, deployment, ændring, incident, alarm og trace.
 * Modulet bygger på den fælles ressource-ID fra DKC-006
 * (`res://<tenant>/<type>/<lokal-id>`) og tilføjer:
 *
 *   - et lukket sæt af ressourcetyper, så en relation ikke kan pege på en vilkårlig
 *     streng,
 *   - en tenant-grænse: en relation må ikke krydse tenant, med mindre den er en
 *     eksplicit global (reserveret scope `platform`) ressource,
 *   - en kanonisk graf (noder + kanter), som korrelationen bygges på.
 *
 * Ren funktion, så korrelationen kan efterprøves uden en kørende collector.
 */
import { formatResourceId, parseResourceId } from "../../identity/src/tenant.mjs";

/** Reserveret scope for globale ressourcer (fx miljøer og hosts). */
export const RESERVED_SCOPE = "platform";

export const RESOURCE_TYPES = [
  "environment",
  "service",
  "tenant",
  "deployment",
  "version",
  "change",
  "incident",
  "alert",
  "trace",
  "test-run",
  "finding",
  "recovery",
  "host",
  "agent-action",
];

export const RELATION_KINDS = ["environment", "service", "version", "deployment", "change", "incident", "alert", "trace"];

const TYPE_SET = new Set(RESOURCE_TYPES);
const RELATION_SET = new Set(RELATION_KINDS);

/** Byg en ressource-ID og dens afledte scope. Kaster på en ukendt type. */
export function resource({ tenantId, type, localId, attributes = null } = {}) {
  if (!TYPE_SET.has(type)) throw new TypeError(`ukendt ressourcetype '${type}'`);
  const id = formatResourceId({ tenantId, type, localId });
  const parsed = parseResourceId(id);
  return { id, tenantId: parsed.tenantId, type: parsed.type, localId: parsed.localId, ...(attributes ? { attributes } : {}) };
}

/** Tenant-scope udledt af en ressource-ID. */
export function tenantOf(resourceId) {
  return parseResourceId(resourceId).tenantId;
}

export function typeOf(resourceId) {
  return parseResourceId(resourceId).type;
}

export function isGlobal(resourceId) {
  return tenantOf(resourceId) === RESERVED_SCOPE;
}

/**
 * Validér en relation. En relation må kun krydse tenant, når målet er en global
 * (platform) ressource; ellers afvises den. Det forhindrer, at en hændelse
 * binder tenant A's trace til tenant B's incident.
 */
export function assertRelation(fromId, relation, toId, { allowGlobal = true } = {}) {
  if (!RELATION_SET.has(relation)) throw new TypeError(`ukendt relation '${relation}'`);
  const from = parseResourceId(fromId);
  const to = parseResourceId(toId);
  if (from.tenantId === to.tenantId) return { from: from.tenantId, to: to.tenantId, global: false };
  if (allowGlobal && to.tenantId === RESERVED_SCOPE) return { from: from.tenantId, to: to.tenantId, global: true };
  throw new Error(`relation '${relation}' krydser tenant (${from.tenantId} → ${to.tenantId})`);
}

/**
 * Byg en korrelationsgraf for én hændelse. `root` er hændelsens ressource;
 * `relations` er et map fra relation til ressource-ID.
 */
export function buildCorrelation({ root, relations = {}, allowGlobal = true } = {}) {
  if (!root) throw new Error("korrelationen kræver en root-ressource");
  const rootId = typeof root === "string" ? root : root.id;
  const rootParsed = parseResourceId(rootId);
  const nodes = new Map([[rootId, { id: rootId, type: rootParsed.type, tenantId: rootParsed.tenantId }]]);
  const edges = [];
  for (const [relation, target] of Object.entries(relations)) {
    if (target === undefined || target === null) continue;
    const boundary = assertRelation(rootId, relation, target, { allowGlobal });
    const parsed = parseResourceId(target);
    nodes.set(target, { id: target, type: parsed.type, tenantId: parsed.tenantId });
    edges.push({ from: rootId, to: target, relation, crossesTenantToGlobal: boundary.global });
  }
  return { root: rootId, nodes: [...nodes.values()], edges };
}

/**
 * Slå to korrelationsgrafer sammen (fx en trace og den incident, den udløste).
 * Returnerer en ny graf uden at mutere input.
 */
export function mergeCorrelations(...graphs) {
  const nodes = new Map();
  const edges = [];
  for (const graph of graphs) {
    if (!graph) continue;
    for (const node of graph.nodes ?? []) nodes.set(node.id, node);
    for (const edge of graph.edges ?? []) edges.push(edge);
  }
  return { nodes: [...nodes.values()], edges };
}

/** Alle ressourcer i en graf for en given tenant (bruges til tenant-scopet visning). */
export function resourcesForTenant(graph, tenantId) {
  return (graph?.nodes ?? []).filter((n) => n.tenantId === tenantId);
}
