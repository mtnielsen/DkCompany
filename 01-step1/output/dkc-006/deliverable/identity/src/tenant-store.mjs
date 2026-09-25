/**
 * DKC-006 — tenantafgrænsninger i datalaget.
 *
 * Hver adapter herunder tager tenanten som et eksplicit, første argument og
 * nægter at returnere data på tværs af kunder. Identiske lokale objekt-ID'er
 * hos to kunder ligger i hver sin tenant-namespace, så de hverken kolliderer
 * eller kan læses ved at bytte tenant. Adapterne er rigtige implementeringer
 * (hash-kæde, filskrivning, kø, indeks) — ikke attrapper.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuthorizationError } from "./errors.mjs";
import { assertResourceTenant, normalizeTenantId, parseResourceId } from "./tenant.mjs";

function key(tenantId, localId) {
  return `${normalizeTenantId(tenantId)}\u0000${String(localId)}`;
}

function assertLocalId(localId) {
  const value = String(localId ?? "");
  if (!value) throw new AuthorizationError("lokal ressource-id mangler", { status: 400, code: "resource_invalid" });
  if (value.includes("\u0000") || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new AuthorizationError(`lokal ressource-id '${value}' indeholder ulovlige tegn`, { status: 400, code: "resource_invalid" });
  }
  return value;
}

function assertNoLeak(result, tenantId) {
  if (result && result.tenantId && result.tenantId !== normalizeTenantId(tenantId)) {
    throw new AuthorizationError("tenantafgrænsning brudt: fremmed tenant i resultatet", { status: 500, code: "tenant_leak" });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Database/dokumentlager                                                     */
/* -------------------------------------------------------------------------- */

export function createTenantStore() {
  const records = new Map();
  return {
    kind: "tenant-store",
    put(tenantId, localId, value) {
      const id = assertLocalId(localId);
      const entry = { ...structuredClone(value), tenantId: normalizeTenantId(tenantId), localId: id };
      records.set(key(tenantId, id), entry);
      return structuredClone(entry);
    },
    get(tenantId, localId) {
      const entry = records.get(key(tenantId, assertLocalId(localId)));
      return entry ? structuredClone(entry) : null;
    },
    getByResourceId(resourceId) {
      const { tenantId, localId } = parseResourceId(resourceId);
      return this.get(tenantId, localId);
    },
    delete(tenantId, localId) {
      return records.delete(key(tenantId, assertLocalId(localId)));
    },
    list(tenantId) {
      const prefix = `${normalizeTenantId(tenantId)}\u0000`;
      return [...records.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => structuredClone(v));
    },
    count(tenantId) {
      return this.list(tenantId).length;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

export function createTenantCache({ now = () => Date.now() } = {}) {
  const cache = new Map();
  return {
    kind: "tenant-cache",
    set(tenantId, cacheKey, value, { ttlMs = 0 } = {}) {
      const full = key(tenantId, assertLocalId(cacheKey));
      cache.set(full, { value: structuredClone(value), expiresAt: ttlMs > 0 ? now() + ttlMs : null });
      return value;
    },
    get(tenantId, cacheKey) {
      const full = key(tenantId, assertLocalId(cacheKey));
      const entry = cache.get(full);
      if (!entry) return null;
      if (entry.expiresAt !== null && now() > entry.expiresAt) {
        cache.delete(full);
        return null;
      }
      return structuredClone(entry.value);
    },
    has(tenantId, cacheKey) {
      return this.get(tenantId, cacheKey) !== null;
    },
    delete(tenantId, cacheKey) {
      return cache.delete(key(tenantId, assertLocalId(cacheKey)));
    },
    /** Antal nøgler for tenanten — bruges til at bevise at namespaces er adskilte. */
    size(tenantId) {
      const prefix = `${normalizeTenantId(tenantId)}\u0000`;
      return [...cache.keys()].filter((k) => k.startsWith(prefix)).length;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Jobkø                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Baggrundsjob bærer tenanten fra det øjeblik de sættes i kø, til de leases og
 * afsluttes. En worker for én kunde kan ikke lease eller se en andens job.
 */
export function createTenantJobQueue({ now = () => Date.now() } = {}) {
  const jobs = new Map();

  /** Hent et job og afvis hvis det tilhører en anden tenant. */
  function owned(tenantId, jobId) {
    const job = jobs.get(jobId);
    if (!job) throw new AuthorizationError("jobbet findes ikke", { status: 404, code: "not_found" });
    if (job.tenantId !== normalizeTenantId(tenantId)) {
      throw new AuthorizationError("jobbet tilhører en anden kunde", { status: 403, code: "tenant_mismatch" });
    }
    return job;
  }

  return {
    kind: "tenant-job-queue",
    enqueue(tenantId, job = {}) {
      const record = {
        id: job.id ?? randomUUID(),
        tenantId: normalizeTenantId(tenantId),
        kind: job.kind ?? "task",
        payload: structuredClone(job.payload ?? null),
        status: "queued",
        attempts: 0,
        enqueuedAt: new Date(now()).toISOString(),
        leasedBy: null,
        leasedAt: null,
        result: null,
        error: null,
      };
      jobs.set(record.id, record);
      return structuredClone(record);
    },
    lease(tenantId, workerId) {
      const tenant = normalizeTenantId(tenantId);
      const job = [...jobs.values()].find((j) => j.tenantId === tenant && j.status === "queued");
      if (!job) return null;
      job.status = "leased";
      job.leasedBy = workerId ?? null;
      job.leasedAt = new Date(now()).toISOString();
      job.attempts += 1;
      return structuredClone(job);
    },
    complete(tenantId, jobId, result = null) {
      const job = owned(tenantId, jobId);
      job.status = "completed";
      job.result = structuredClone(result);
      return structuredClone(job);
    },
    fail(tenantId, jobId, error) {
      const job = owned(tenantId, jobId);
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      return structuredClone(job);
    },
    list(tenantId) {
      const tenant = normalizeTenantId(tenantId);
      return [...jobs.values()].filter((j) => j.tenantId === tenant).map((j) => structuredClone(j));
    },
    get(tenantId, jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      return assertNoLeak(structuredClone(job), tenantId);
    },
    owned,
  };
}

/* -------------------------------------------------------------------------- */
/* Filer                                                                      */
/* -------------------------------------------------------------------------- */

function safeSegment(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function createTenantFileStore({ baseDir } = {}) {
  if (!baseDir) throw new Error("createTenantFileStore kræver en baseDir");
  const dirFor = (tenantId) => join(baseDir, safeSegment(normalizeTenantId(tenantId)));
  const fileFor = (tenantId, localId) => join(dirFor(tenantId), `${safeSegment(assertLocalId(localId))}.json`);

  return {
    kind: "tenant-files",
    write(tenantId, localId, data) {
      const dir = dirFor(tenantId);
      mkdirSync(dir, { recursive: true });
      const path = fileFor(tenantId, localId);
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
      renameSync(tmp, path);
      return { tenantId: normalizeTenantId(tenantId), localId: String(localId) };
    },
    read(tenantId, localId) {
      const path = fileFor(tenantId, localId);
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf8"));
    },
    delete(tenantId, localId) {
      const path = fileFor(tenantId, localId);
      if (!existsSync(path)) return false;
      unlinkSync(path);
      return true;
    },
    list(tenantId) {
      const dir = dirFor(tenantId);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Søgning                                                                    */
/* -------------------------------------------------------------------------- */

export function createTenantSearchIndex() {
  const docs = new Map();
  return {
    kind: "tenant-search",
    index(tenantId, doc = {}) {
      const id = assertLocalId(doc.id ?? randomUUID());
      const record = { ...structuredClone(doc), id, tenantId: normalizeTenantId(tenantId) };
      docs.set(key(tenantId, id), record);
      return structuredClone(record);
    },
    search(tenantId, query = {}) {
      const tenant = normalizeTenantId(tenantId);
      const text = String(query.text ?? "").toLowerCase();
      const tag = query.tag;
      return [...docs.values()]
        .filter((d) => d.tenantId === tenant)
        .filter((d) => (text ? `${d.id} ${d.title ?? ""} ${d.body ?? ""}`.toLowerCase().includes(text) : true))
        .filter((d) => (tag ? (d.tags ?? []).includes(tag) : true))
        .map((d) => structuredClone(d));
    },
    remove(tenantId, localId) {
      return docs.delete(key(tenantId, assertLocalId(localId)));
    },
    size(tenantId) {
      const prefix = `${normalizeTenantId(tenantId)}\u0000`;
      return [...docs.keys()].filter((k) => k.startsWith(prefix)).length;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Modelhistorik                                                              */
/* -------------------------------------------------------------------------- */

export function createTenantModelHistory({ now = () => Date.now() } = {}) {
  const calls = [];
  return {
    kind: "tenant-model-history",
    record({ tenantId, ...call } = {}) {
      const entry = {
        id: call.id ?? randomUUID(),
        tenantId: normalizeTenantId(tenantId),
        at: call.at ?? new Date(now()).toISOString(),
        agentRef: call.agentRef ?? null,
        provider: call.provider ?? null,
        model: call.model ?? null,
        modelVersion: call.modelVersion ?? null,
        tokens: call.tokens ?? 0,
        costEur: call.costEur ?? 0,
        route: call.route ?? null,
      };
      calls.push(entry);
      return structuredClone(entry);
    },
    list(tenantId, { agentRef } = {}) {
      const tenant = normalizeTenantId(tenantId);
      return calls
        .filter((c) => c.tenantId === tenant)
        .filter((c) => (agentRef ? c.agentRef === agentRef : true))
        .map((c) => structuredClone(c));
    },
    usage(tenantId, agentRef) {
      return this.list(tenantId, { agentRef }).reduce((acc, c) => ({ tokens: acc.tokens + c.tokens, costEur: acc.costEur + c.costEur, calls: acc.calls + 1 }), {
        tokens: 0,
        costEur: 0,
        calls: 0,
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/**
 * Tenantafgrænset audit-trail med hash-kæde pr. tenant. At læse en anden kundes
 * events kræver den scopede adgang, og kæden gør efterfølgende ændringer
 * opdagelige.
 */
export function createTenantAuditTrail({ genesis = "0".repeat(64) } = {}) {
  const trails = new Map();
  const lastHash = new Map();

  function trailFor(tenantId) {
    const tenant = normalizeTenantId(tenantId);
    if (!trails.has(tenant)) {
      trails.set(tenant, []);
      lastHash.set(tenant, genesis);
    }
    return tenant;
  }

  return {
    kind: "tenant-audit",
    append({ tenantId, ...input } = {}) {
      const tenant = trailFor(tenantId);
      const events = trails.get(tenant);
      const prev = lastHash.get(tenant);
      const event = {
        seq: events.length + 1,
        id: randomUUID(),
        at: input.at ?? new Date().toISOString(),
        type: input.type,
        tenantId: tenant,
        actor: input.actor ?? null,
        verb: input.verb ?? null,
        payload: input.payload ?? {},
        prevHash: prev,
      };
      const hash = createHash("sha256").update(prev + canonical(event)).digest("hex");
      const stored = { ...event, hash };
      events.push(stored);
      lastHash.set(tenant, hash);
      return stored;
    },
    eventsFor(tenantId) {
      return (trails.get(normalizeTenantId(tenantId)) ?? []).map((e) => structuredClone(e));
    },
    verify(tenantId) {
      const tenant = normalizeTenantId(tenantId);
      const events = trails.get(tenant) ?? [];
      let prev = genesis;
      for (const event of events) {
        const { hash, ...rest } = event;
        if (createHash("sha256").update(prev + canonical(rest)).digest("hex") !== hash) return { ok: false, brokenAt: event.seq };
        prev = hash;
      }
      return { ok: true, length: events.length };
    },
    size(tenantId) {
      return (trails.get(normalizeTenantId(tenantId)) ?? []).length;
    },
  };
}

/**
 * Filtrér en delt audit-liste efter tenant. Bruges af tjenester der læser en
 * fælles log: uden et gyldigt tenant-filter returneres intet.
 */
export function filterEventsByTenant(events, tenantId) {
  if (!tenantId) throw new AuthorizationError("audit-oplæsning kræver en tenant", { status: 403, code: "tenant_unresolved" });
  const tenant = normalizeTenantId(tenantId);
  return (events ?? []).filter((e) => e.tenantId === tenant).map((e) => structuredClone(e));
}

export { assertResourceTenant };
