/**
 * DKC-055 — scheduler/route uden adgang til alle agenters credentials.
 *
 * Scheduleren må gerne vælge hvilken rolle en opgave skal til, men den får kun
 * udstedt et enkelt, rollebundet credential for den agent den router til. Den
 * har bevidst ingen metode der returnerer alle agenters credentials.
 */
import { AgentRegistryError } from "./registry.mjs";

export function createScheduler({ registry } = {}) {
  if (!registry) throw new AgentRegistryError("createScheduler kræver et agentregister", "registry_required");

  /** Kandidater til en opgave, filtreret på rolle og aktiv status. */
  function candidates({ role, tenantId = null } = {}) {
    return registry
      .byRole(role)
      .filter((a) => a.status === "active")
      .filter((a) => (tenantId ? a.spiffeId != null : true));
  }

  /**
   * Route en opgave til én agent og udsted kun dennes credential. Returnerer
   * aldrig andre agenters credentials.
   */
  function dispatch(task = {}, { choose = null } = {}) {
    const pool = candidates(task);
    if (pool.length === 0) throw new AgentRegistryError(`ingen aktiv agent med rollen '${task.role}'`, "no_agent");
    const selected = choose ? choose(pool) : pool[0];
    if (!selected) throw new AgentRegistryError("kunne ikke vælge en agent", "no_agent");
    const credential = registry.issueCredential(selected.spiffeId, { taskId: task.taskId ?? null });
    return { agent: registry.get(selected.spiffeId), credential };
  }

  /** Bevidst forbudt: scheduleren må ikke samle alle credentials. */
  function allCredentials() {
    throw new AgentRegistryError("scheduleren må ikke hente alle agenters credentials", "all_credentials_forbidden");
  }

  return { candidates, dispatch, allCredentials };
}
