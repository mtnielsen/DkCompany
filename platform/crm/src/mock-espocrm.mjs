/**
 * DKC-030 — testdobbel for EspoCRM's API.
 *
 * Den holder rigtig tilstand (virksomheder, kontakter, salgsforløb og
 * aktiviteter) pr. tenant, så import, opdatering, eksport, retry,
 * dublethåndtering, rollebeskyttelse og tværgående sletning kan efterprøves
 * uden en levende EspoCRM-installation. Autentificering sker med én API-nøgle
 * pr. tenant; adgangskontrollen ligger i platformens permissionslag.
 */
import { createServer } from "node:http";

const ENTITY_TYPES = ["Account", "Contact", "Opportunity", "Activity"];

export function createMockEspocrm({ corpus, clock = () => new Date().toISOString() } = {}) {
  if (!corpus?.tenants) throw new Error("createMockEspocrm kræver et corpus");
  const keyToTenant = new Map();
  const records = new Map();
  const idempotency = new Map();
  const counters = new Map();
  for (const [tenant, block] of Object.entries(corpus.tenants)) {
    keyToTenant.set(block.token, tenant);
    counters.set(tenant, 9000);
    for (const [entityType, list] of Object.entries(block.records ?? {})) {
      for (const record of list) records.set(`${tenant}:${entityType}:${record.id}`, { ...record, id: String(record.id) });
    }
  }

  const listFor = (tenant, entityType) =>
    [...records.entries()].filter(([k]) => k.startsWith(`${tenant}:${entityType}:`)).map(([, v]) => v);
  const nextId = (tenant) => {
    const n = (counters.get(tenant) ?? 9000) + 1;
    counters.set(tenant, n);
    return String(n);
  };

  const server = createServer((req, res) => {
    const apiKey = req.headers["x-api-key"];
    const tenant = keyToTenant.get(apiKey);
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const readBody = () =>
      new Promise((resolve) => {
        let raw = "";
        req.on("data", (c) => {
          raw += c;
        });
        req.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            resolve({});
          }
        });
      });

    if (!tenant) return json(401, { error: "ugyldig API-nøgle" });
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/v1/App/user") return json(200, { user: { userName: tenant, tenant } });

    const match = url.pathname.match(/^\/api\/v1\/([A-Za-z]+)(?:\/([^/]+))?$/);
    if (!match) return json(404, { error: "ukendt rute" });
    const entityType = match[1];
    const id = match[2] ? decodeURIComponent(match[2]) : null;
    if (!ENTITY_TYPES.includes(entityType)) return json(404, { error: `ukendt entitetstype '${entityType}'` });

    if (entityType !== null && id === null && req.method === "GET") {
      const list = listFor(tenant, entityType);
      return json(200, { list, total: list.length });
    }
    if (id !== null && req.method === "GET") {
      const record = records.get(`${tenant}:${entityType}:${id}`);
      if (!record) return json(404, { error: "post findes ikke" });
      return json(200, record);
    }
    if (id === null && req.method === "POST") {
      readBody().then((body) => {
        const idem = req.headers["idempotency-key"] ?? null;
        if (idem) {
          const existing = idempotency.get(`${tenant}:${entityType}:${idem}`);
          if (existing) return json(200, records.get(`${tenant}:${entityType}:${existing}`));
        }
        const newId = nextId(tenant);
        const now = clock();
        const record = { id: newId, version: 1, createdAt: now, updatedAt: now, ...body };
        records.set(`${tenant}:${entityType}:${newId}`, record);
        if (idem) idempotency.set(`${tenant}:${entityType}:${idem}`, newId);
        return json(201, record);
      });
      return undefined;
    }
    if (id !== null && req.method === "PATCH") {
      readBody().then((patch) => {
        const key = `${tenant}:${entityType}:${id}`;
        const record = records.get(key);
        if (!record) return json(404, { error: "post findes ikke" });
        const updated = { ...record, ...patch, id: record.id, version: (record.version ?? 1) + 1, updatedAt: clock() };
        records.set(key, updated);
        return json(200, updated);
      });
      return undefined;
    }
    if (id !== null && req.method === "DELETE") {
      const key = `${tenant}:${entityType}:${id}`;
      if (!records.has(key)) return json(404, { error: "post findes ikke" });
      records.delete(key);
      return json(200, { deleted: true, id });
    }
    return json(405, { error: "metode ikke tilladt" });
  });

  return {
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
    getRecord(tenant, entityType, id) {
      return records.get(`${tenant}:${entityType}:${id}`) ?? null;
    },
    listTenant(tenant, entityType) {
      return listFor(tenant, entityType);
    },
    setRecord(tenant, entityType, record) {
      records.set(`${tenant}:${entityType}:${record.id}`, { ...record, id: String(record.id) });
    },
    removeRecord(tenant, entityType, id) {
      records.delete(`${tenant}:${entityType}:${id}`);
    },
  };
}
