import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTenantAuditTrail,
  createTenantCache,
  createTenantFileStore,
  createTenantJobQueue,
  createTenantModelHistory,
  createTenantSearchIndex,
  createTenantStore,
  filterEventsByTenant,
} from "../src/tenant-store.mjs";
import { formatResourceId } from "../src/tenant.mjs";

test("datalager: identiske lokale id'er hos to kunder kolliderer ikke", () => {
  const store = createTenantStore();
  store.put("acme", "42", { title: "acme-faktura" });
  store.put("globex", "42", { title: "globex-faktura" });
  assert.equal(store.get("acme", "42").title, "acme-faktura");
  assert.equal(store.get("globex", "42").title, "globex-faktura");
  assert.equal(store.list("acme").length, 1);
  assert.equal(store.list("globex").length, 1);
  store.delete("acme", "42");
  assert.equal(store.get("acme", "42"), null);
  assert.equal(store.get("globex", "42").title, "globex-faktura");
});

test("datalager: oplæsning via fremmed ressource-ID giver ingen lækage", () => {
  const store = createTenantStore();
  store.put("acme", "42", { title: "acme" });
  const globexId = formatResourceId({ tenantId: "globex", type: "invoice", localId: "42" });
  assert.equal(store.getByResourceId(globexId), null);
  const acmeId = formatResourceId({ tenantId: "acme", type: "invoice", localId: "42" });
  assert.equal(store.getByResourceId(acmeId).title, "acme");
});

test("cache: namespaces er adskilte selv med samme nøgle", () => {
  const cache = createTenantCache();
  cache.set("acme", "session", { user: "a" });
  cache.set("globex", "session", { user: "g" });
  assert.deepEqual(cache.get("acme", "session"), { user: "a" });
  assert.deepEqual(cache.get("globex", "session"), { user: "g" });
  assert.equal(cache.size("acme"), 1);
  assert.equal(cache.has("acme", "session"), true);
  cache.delete("acme", "session");
  assert.equal(cache.get("acme", "session"), null);
  assert.deepEqual(cache.get("globex", "session"), { user: "g" });
});

test("jobkø: baggrundsjob bevarer tenant gennem lease og afslutning", () => {
  const queue = createTenantJobQueue();
  const acmeJob = queue.enqueue("acme", { kind: "export", payload: { report: "a" } });
  const globexJob = queue.enqueue("globex", { kind: "export", payload: { report: "g" } });
  assert.equal(acmeJob.tenantId, "acme");
  assert.equal(globexJob.tenantId, "globex");

  const leasedAcme = queue.lease("acme", "worker-1");
  assert.equal(leasedAcme.id, acmeJob.id);
  assert.equal(leasedAcme.tenantId, "acme");
  // Globex-workeren må ikke lease acme-jobbet, og acme-jobbet er allerede leased.
  const leasedGlobex = queue.lease("globex", "worker-2");
  assert.equal(leasedGlobex.id, globexJob.id);

  const done = queue.complete("acme", acmeJob.id, { artifactRef: "s3://acme/export.json" });
  assert.equal(done.status, "completed");
  assert.equal(done.tenantId, "acme");
  assert.throws(() => queue.complete("globex", acmeJob.id, {}), (e) => e.code === "tenant_mismatch");
  assert.equal(queue.list("globex").length, 1);
});

test("filer: skrivning/læsning er tenant-adskilt og path traversal afvises", () => {
  const dir = mkdtempSync(join(tmpdir(), "dkc-tenant-files-"));
  try {
    const files = createTenantFileStore({ baseDir: dir });
    files.write("acme", "report", { tenant: "acme" });
    files.write("globex", "report", { tenant: "globex" });
    assert.deepEqual(files.read("acme", "report"), { tenant: "acme" });
    assert.deepEqual(files.read("globex", "report"), { tenant: "globex" });
    assert.equal(files.list("acme").length, 1);
    files.delete("acme", "report");
    assert.equal(files.read("acme", "report"), null);
    assert.deepEqual(files.read("globex", "report"), { tenant: "globex" });
    assert.throws(() => files.write("acme", "../../etc/passwd", {}), /ulovlige tegn/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("søgning: resultatet indeholder kun egen kundes dokumenter", () => {
  const index = createTenantSearchIndex();
  index.index("acme", { id: "doc-1", title: "faktura", tags: ["finance"] });
  index.index("globex", { id: "doc-1", title: "faktura", tags: ["finance"] });
  index.index("globex", { id: "doc-2", title: "note", tags: [] });
  assert.equal(index.search("acme", {}).length, 1);
  assert.equal(index.search("acme", { text: "faktura" }).length, 1);
  assert.equal(index.search("globex", { tag: "finance" }).length, 1);
  assert.equal(index.size("acme"), 1);
  assert.equal(index.size("globex"), 2);
});

test("modelhistorik: historik og budget er tenant-bundet", () => {
  const history = createTenantModelHistory();
  history.record({ tenantId: "acme", agentRef: "a", tokens: 10, costEur: 1 });
  history.record({ tenantId: "globex", agentRef: "a", tokens: 20, costEur: 2 });
  assert.equal(history.list("acme").length, 1);
  assert.deepEqual(history.usage("acme", "a"), { tokens: 10, costEur: 1, calls: 1 });
  assert.deepEqual(history.usage("globex", "a"), { tokens: 20, costEur: 2, calls: 1 });
});

test("audit: hash-kæde pr. tenant og ingen krydskunde-læsning", () => {
  const audit = createTenantAuditTrail();
  audit.append({ tenantId: "acme", type: "action.completed", actor: "a" });
  audit.append({ tenantId: "globex", type: "action.completed", actor: "g" });
  audit.append({ tenantId: "acme", type: "action.completed", actor: "a2" });
  assert.equal(audit.eventsFor("acme").length, 2);
  assert.equal(audit.eventsFor("globex").length, 1);
  assert.equal(audit.verify("acme").ok, true);
  assert.equal(audit.verify("globex").ok, true);
  // En fælles log filtreres strengt; uden tenant returneres intet.
  const shared = [...audit.eventsFor("acme"), ...audit.eventsFor("globex")];
  assert.equal(filterEventsByTenant(shared, "acme").length, 2);
  assert.throws(() => filterEventsByTenant(shared, null), (e) => e.code === "tenant_unresolved");
});
