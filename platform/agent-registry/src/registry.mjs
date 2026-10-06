/**
 * DKC-055 — agentregister med uforanderlig rolle.
 *
 * Registret er den ene kilde til hvilken rolle en agentidentitet har. Reglerne:
 *
 *   - Kun et **verificeret menneske** med en platformrolle kan oprette,
 *     tilbagetrække eller reprovisionere en agent. En AI kan ikke administrere
 *     agenter (selvoprettelse).
 *   - Rollen er **uforanderlig** pr. identitet. En ny rolle kræver retire +
 *     reprovision til en **ny** identitet; den gamle identitets lineage kan
 *     ikke genbruges.
 *   - Et agentnavn kan ikke genbruges som alias for en anden identitet.
 *   - Hver agent får separate credentials (verbs + tools) udstedt pr. opgave.
 *     Der findes ingen fælles token.
 */
import { digestOf } from "../../policy/pdp/src/crypto.mjs";
import {
  roleAllowedArtifacts,
  roleAllowedTools,
  roleAllowedVerbs,
  validateRoleManifest,
} from "./roles.mjs";

export class AgentRegistryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AgentRegistryError";
    this.code = code;
  }
}

/** Menneskelige platformroller der må administrere agenter. */
export const PLATFORM_ADMIN_ROLES = ["platform-admin", "agent-owner", "security-officer"];

function roleSet(principal) {
  return new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])]);
}

/** Kræv et verificeret menneske med en platformrolle. */
export function assertHumanAuthority(principal, action) {
  if (!principal || principal.kind !== "human") {
    throw new AgentRegistryError(`kun et verificeret menneske kan ${action}`, "human_required");
  }
  if (principal.demo === true) {
    throw new AgentRegistryError("demo-identitet kan ikke administrere agenter", "demo_forbidden");
  }
  const roles = roleSet(principal);
  if (![...roles].some((r) => PLATFORM_ADMIN_ROLES.includes(r))) {
    throw new AgentRegistryError(`principalen mangler en rolle der må ${action}`, "authority_required");
  }
  return principal;
}

export function createAgentRegistry({ clock = () => Date.now() } = {}) {
  const agents = new Map();
  const names = new Map();
  const credentials = new Map();

  function register({ principal, manifest, provenance = {} } = {}) {
    assertHumanAuthority(principal, "oprette agenter");
    const check = validateRoleManifest(manifest);
    if (!check.ok) {
      throw new AgentRegistryError(`manifestet er ugyldigt: ${check.errors.map((e) => e.message).join("; ")}`, "invalid_manifest");
    }
    const spiffeId = manifest.identity?.spiffeId;
    const name = manifest.metadata?.name;
    if (names.has(name) && names.get(name) !== spiffeId) {
      throw new AgentRegistryError(`agentnavnet '${name}' er allerede bundet til en anden identitet (alias-genbrug)`, "alias_reuse");
    }

    const existing = agents.get(spiffeId);
    if (existing) {
      if (existing.role !== manifest.role) {
        throw new AgentRegistryError(`rollen er uforanderlig: '${spiffeId}' er '${existing.role}' og kan ikke blive '${manifest.role}'`, "role_immutable");
      }
      if (existing.status === "retired") {
        throw new AgentRegistryError("agenten er tilbagetrukket; brug reprovision med en ny identitet", "retired");
      }
      return structuredClone(existing);
    }

    const record = {
      spiffeId,
      name,
      role: manifest.role,
      status: "active",
      modelRef: manifest.model ? `${manifest.model.provider}/${manifest.model.model}${manifest.model.modelVersion ? `@${manifest.model.modelVersion}` : ""}` : null,
      allowedVerbs: roleAllowedVerbs(manifest.role),
      allowedTools: roleAllowedTools(manifest.role),
      allowedArtifacts: roleAllowedArtifacts(manifest.role),
      manifestDigest: digestOf(manifest),
      createdBy: principal.id,
      createdAt: new Date(clock()).toISOString(),
      previousIdentity: provenance.previousIdentity ?? null,
    };
    agents.set(spiffeId, record);
    names.set(name, spiffeId);
    return structuredClone(record);
  }

  function get(spiffeId) {
    const agent = agents.get(spiffeId);
    return agent ? structuredClone(agent) : null;
  }

  function byName(name) {
    const id = names.get(name);
    return id ? get(id) : null;
  }

  function list() {
    return [...agents.values()].map((a) => structuredClone(a));
  }

  function byRole(role) {
    return list().filter((a) => a.role === role);
  }

  function assertActive(spiffeId) {
    const agent = agents.get(spiffeId);
    if (!agent) throw new AgentRegistryError("agentidentiteten er ikke registreret", "not_registered");
    if (agent.status !== "active") throw new AgentRegistryError(`agenten '${agent.name}' er ${agent.status}`, "inactive");
    return agent;
  }

  function retire({ principal, spiffeId, reason } = {}) {
    assertHumanAuthority(principal, "tilbagetrække agenter");
    const agent = agents.get(spiffeId);
    if (!agent) throw new AgentRegistryError("agenten findes ikke", "not_found");
    agent.status = "retired";
    agent.retiredAt = new Date(clock()).toISOString();
    agent.retiredBy = principal.id;
    agent.retireReason = reason ?? null;
    credentials.delete(spiffeId);
    agents.set(spiffeId, agent);
    return structuredClone(agent);
  }

  /**
   * Reprovisionering: en rolleændring kræver en ny identitet. Den gamle
   * tilbagetrækkes først, så samme change-lineage ikke kan skifte hat.
   */
  function reprovision({ principal, spiffeId, manifest } = {}) {
    assertHumanAuthority(principal, "reprovisionere agenter");
    const old = agents.get(spiffeId);
    if (!old) throw new AgentRegistryError("agenten findes ikke", "not_found");
    if (manifest?.identity?.spiffeId === spiffeId) {
      throw new AgentRegistryError("reprovision kræver en ny agentidentitet; rollen kan ikke ændres in-place", "identity_reuse");
    }
    retire({ principal, spiffeId, reason: "reprovision" });
    return register({ principal, manifest, provenance: { previousIdentity: spiffeId } });
  }

  /** Udsted et per-opgave-credential bundet til agentens rolle. */
  function issueCredential(spiffeId, { taskId } = {}) {
    const agent = assertActive(spiffeId);
    const token = {
      id: `${spiffeId}#${taskId ?? "no-task"}`,
      spiffeId,
      agentRef: agent.name,
      role: agent.role,
      allowedVerbs: [...agent.allowedVerbs],
      allowedTools: [...agent.allowedTools],
      taskId: taskId ?? null,
      issuedAt: new Date(clock()).toISOString(),
    };
    credentials.set(spiffeId, token);
    return structuredClone(token);
  }

  function credentialFor(spiffeId) {
    const token = credentials.get(spiffeId);
    return token ? structuredClone(token) : null;
  }

  return {
    register,
    get,
    byName,
    list,
    byRole,
    assertActive,
    retire,
    reprovision,
    issueCredential,
    credentialFor,
  };
}
