import { createHash, randomUUID } from "node:crypto";
import { normalizeTenantId } from "../../../../identity/src/tenant.mjs";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

/**
 * Append-only audit-log med hash-kæde.
 *
 * Hvert event bærer hashen af det foregående. Dermed kan enhver efterfølgende
 * ændring opdages: at ændre et gammelt event brækker kæden fra det punkt og
 * frem. Det er den egenskab, der gør loggen til bevis og ikke bare en fil.
 */
export function createAuditLog({ genesis = "0".repeat(64) } = {}) {
  const events = [];
  let lastHash = genesis;

  function append(input) {
    const event = {
      seq: events.length + 1,
      id: randomUUID(),
      at: input.at ?? new Date().toISOString(),
      type: input.type,
      verb: input.verb ?? null,
      principal: input.principal,
      tenantId: input.tenantId ?? null,
      payload: input.payload ?? {},
      prevHash: lastHash,
    };
    const hash = createHash("sha256").update(lastHash + canonical(event)).digest("hex");
    const stored = { ...event, hash };
    events.push(stored);
    lastHash = hash;
    return stored;
  }

  function verifyChain() {
    let prev = genesis;
    for (const event of events) {
      const { hash, ...rest } = event;
      const expected = createHash("sha256").update(prev + canonical(rest)).digest("hex");
      if (expected !== hash) return { ok: false, brokenAt: event.seq };
      prev = hash;
    }
    return { ok: true, length: events.length };
  }

  return { events, append, verifyChain, get lastHash() { return lastHash; } };
}

/**
 * Subjektregister. records er de persondata audit-servicen behandler på vegne
 * af modulerne, så privacy-verberne har noget at finde, eksportere og slette.
 *
 * DKC-006: hver post er bundet til en tenant, og locate/erase kræver tenanten
 * som første argument. Identiske identifikatorer hos to kunder kan derfor ikke
 * læses eller slettes på tværs af kunder.
 */
export function createSubjectStore() {
  let records = [];
  const withTenant = (tenantId) => normalizeTenantId(tenantId);
  return {
    add(record) {
      if (!record?.tenantId) throw new Error("subject-record kræver tenantId");
      records.push({ id: randomUUID(), createdAt: new Date().toISOString(), ...record, tenantId: withTenant(record.tenantId) });
    },
    forTenant(tenantId) {
      const tenant = withTenant(tenantId);
      return records.filter((r) => r.tenantId === tenant);
    },
    locate(tenantId, identifiers) {
      const tenant = withTenant(tenantId);
      return records.filter((r) => r.tenantId === tenant && matchesAny(r, identifiers));
    },
    erase(tenantId, identifiers) {
      const tenant = withTenant(tenantId);
      const hit = records.filter((r) => r.tenantId === tenant && matchesAny(r, identifiers));
      records = records.filter((r) => !(r.tenantId === tenant && matchesAny(r, identifiers)));
      return hit;
    },
    count(tenantId) {
      return this.forTenant(tenantId).length;
    },
  };
}

/** Filtrér en delt audit-liste efter tenant; uden tenant returneres intet. */
export function filterEventsByTenant(events, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return (events ?? []).filter((e) => e.tenantId === tenant);
}

function matchesAny(record, identifiers = []) {
  if (!identifiers.length) return false;
  const own = record.subjects ?? [];
  return identifiers.some((want) =>
    own.some((have) => have.type === want.type && String(have.value) === String(want.value))
  );
}
