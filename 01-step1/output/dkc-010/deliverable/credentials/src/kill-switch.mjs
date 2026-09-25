/**
 * DKC-010 — nødstop (kill switch) pr. agent, pr. kunde og globalt.
 *
 * Et nødstop skal kunne stoppe nye handlinger hurtigt og fail-closed. Der
 * findes tre uafhængige scopes:
 *
 *   - `agent`  — én agentidentitet (spiffeId),
 *   - `tenant` — alle agenter for én kunde,
 *   - `global` — hele platformen.
 *
 * Hvem der må aktivere/ophæve er eksplicit:
 *
 *   | scope  | aktivér                              | ophæv                                |
 *   |--------|--------------------------------------|--------------------------------------|
 *   | agent  | agent-owner, platform-admin, security-officer | samme                      |
 *   | tenant | tenant-admin, platform-admin, security-officer | samme                     |
 *   | global | platform-admin, security-officer     | platform-admin, security-officer     |
 *
 * Kun et **verificeret menneske** kan betjene et nødstop; en AI/demo-identitet
 * afvises. Aktivering/ophævelse skrives til den holdbare kontroltilstand, og
 * verifikationssiden cacher højst `cacheTtlMs` (≤ 5 s i staging), så et nyt stop
 * slår igennem inden for den grænse — også på tværs af processer/noder.
 */
export const KILL_SWITCH_SCOPES = ["agent", "tenant", "global"];

export const KILL_SWITCH_AUTHORITY = {
  activate: {
    agent: ["agent-owner", "platform-admin", "security-officer"],
    tenant: ["tenant-admin", "platform-admin", "security-officer"],
    global: ["platform-admin", "security-officer"],
  },
  clear: {
    agent: ["agent-owner", "platform-admin", "security-officer"],
    tenant: ["tenant-admin", "platform-admin", "security-officer"],
    global: ["platform-admin", "security-officer"],
  },
};

export class EmergencyStopActive extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "EmergencyStopActive";
    this.code = "EMERGENCY_STOP_ACTIVE";
    this.details = details;
  }
}

export class EmergencyStopAuthorityError extends Error {
  constructor(message, code = "emergency_stop_authority") {
    super(message);
    this.name = "EmergencyStopAuthorityError";
    this.code = code;
  }
}

function createMemoryStore() {
  const map = new Map();
  let clock = () => Date.now();
  return {
    kind: "memory-stop-store",
    setClock(fn) {
      clock = fn;
    },
    key(scope, subjectId) {
      return `${scope}:${subjectId ?? "*"}`;
    },
    put(record) {
      map.set(this.key(record.scope, record.subjectId), record);
      return record;
    },
    get(scope, subjectId) {
      return map.get(this.key(scope, subjectId)) ?? null;
    },
    all() {
      return [...map.values()];
    },
    now() {
      return clock();
    },
  };
}

function rolesOf(principal) {
  return new Set([...(principal?.roles ?? []), ...(principal?.groups ?? [])]);
}

function assertHumanStopAuthority(principal, scope, action) {
  if (!principal || principal.kind !== "human") {
    throw new EmergencyStopAuthorityError(`kun et verificeret menneske kan ${action === "activate" ? "aktivere" : "ophæve"} et nødstop`);
  }
  if (principal.demo === true) {
    throw new EmergencyStopAuthorityError("demo-identitet kan ikke betjene et nødstop");
  }
  const allowed = KILL_SWITCH_AUTHORITY[action][scope] ?? [];
  const roles = rolesOf(principal);
  if (![...roles].some((r) => allowed.includes(r))) {
    throw new EmergencyStopAuthorityError(`principalen mangler en rolle der må ${action === "activate" ? "aktivere" : "ophæve"} '${scope}'-nødstoppet (kræver: ${allowed.join(", ")})`);
  }
  return principal;
}

export function createKillSwitch({ store = createMemoryStore(), clock = () => Date.now(), cacheTtlMs = 1000, kind = "kill-switch" } = {}) {
  if (!store) throw new Error("createKillSwitch kræver en store");
  if (cacheTtlMs > 5000) throw new Error("cacheTtlMs må højst være 5000 ms (kravet er fem sekunder i staging)");
  if (typeof store.setClock === "function") store.setClock(clock);

  let cache = { at: 0, records: null };

  function invalidate() {
    cache = { at: 0, records: null };
  }

  function records() {
    const now = clock();
    if (!cache.records || now - cache.at >= cacheTtlMs) {
      cache = { at: now, records: store.all().filter((r) => r.active === true) };
    }
    return cache.records;
  }

  function isActive(scope, subjectId) {
    return records().some((r) => r.scope === scope && (scope === "global" || String(r.subjectId) === String(subjectId)));
  }

  function activate({ scope, subjectId = null, reason = null, principal } = {}) {
    if (!KILL_SWITCH_SCOPES.includes(scope)) throw new EmergencyStopAuthorityError(`ukendt nødstop-scope '${scope}'`, "unknown_scope");
    if (scope !== "global" && !subjectId) throw new EmergencyStopAuthorityError(`${scope}-nødstop kræver et subjectId`, "subject_required");
    assertHumanStopAuthority(principal, scope, "activate");
    const at = new Date(clock()).toISOString();
    const record = { scope, subjectId: scope === "global" ? null : String(subjectId), active: true, reason, activatedBy: principal.id, activatedAt: at, clearedBy: null, clearedAt: null };
    store.put(record);
    invalidate();
    return record;
  }

  function clear({ scope, subjectId = null, reason = null, principal } = {}) {
    if (!KILL_SWITCH_SCOPES.includes(scope)) throw new EmergencyStopAuthorityError(`ukendt nødstop-scope '${scope}'`, "unknown_scope");
    if (scope !== "global" && !subjectId) throw new EmergencyStopAuthorityError(`${scope}-nødstop kræver et subjectId`, "subject_required");
    assertHumanStopAuthority(principal, scope, "clear");
    const existing = store.get(scope, scope === "global" ? null : String(subjectId));
    if (!existing || existing.active !== true) return { scope, subjectId: scope === "global" ? null : String(subjectId), active: false, changed: false };
    const at = new Date(clock()).toISOString();
    const record = { ...existing, active: false, clearedBy: principal.id, clearedAt: at, clearReason: reason ?? null };
    store.put(record);
    invalidate();
    return { ...record, changed: true };
  }

  function stateFor({ tenantId = null, spiffeId = null } = {}) {
    return {
      global: isActive("global", null),
      tenant: tenantId ? isActive("tenant", tenantId) : false,
      agent: spiffeId ? isActive("agent", spiffeId) : false,
    };
  }

  /** Fail-closed: kaster hvis noget relevant nødstop er aktivt. */
  function assertAllowed({ tenantId = null, spiffeId = null } = {}) {
    const state = stateFor({ tenantId, spiffeId });
    if (state.global || state.tenant || state.agent) {
      throw new EmergencyStopActive("nødstop er aktivt — handlingen afvises", { tenantId, spiffeId, ...state });
    }
    return true;
  }

  return {
    kind,
    store,
    cacheTtlMs,
    maxPropagationMs: cacheTtlMs,
    activate,
    clear,
    stateFor,
    assertAllowed,
    isActive,
    all() {
      return store.all();
    },
    invalidate,
  };
}
