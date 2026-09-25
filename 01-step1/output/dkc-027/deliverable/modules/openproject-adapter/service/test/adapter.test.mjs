import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenProjectAdapter } from "../src/server.mjs";
import { createOpenProjectClient } from "../src/openproject.mjs";
import { createMockOpenProject } from "../src/mock-openproject.mjs";
import { ROLES } from "../src/constants.mjs";

const ROLES_BY_USER = { anna: ROLES.TENANT_ADMIN, bo: ROLES.MEMBER, carla: ROLES.MEMBER, gus: ROLES.GUEST };

function testAuthenticate(_auth, headers = {}) {
  const kind = headers["x-test-kind"];
  if (!kind) {
    const err = new Error("manglende verificeret identitet");
    err.code = "unauthenticated";
    throw err;
  }
  const userId = headers["x-test-user"] ?? "anna";
  const tenantId = headers["x-test-tenant"] ?? "acme";
  return { kind, id: userId, tenantId, role: ROLES_BY_USER[userId] ?? null, groups: [tenantId] };
}

const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const denyPdp = { decide: async () => ({ decision: "deny", reasons: ["nej"], matchedRules: ["r"] }) };
const downPdp = {
  decide: async () => {
    const err = new Error("timeout");
    err.name = "GovernanceUnavailable";
    throw err;
  },
};

async function setup(pdp, policy = {}) {
  const mock = createMockOpenProject();
  const mockPort = await mock.listen(0);
  const adapter = createOpenProjectAdapter({
    authenticate: testAuthenticate,
    pdp,
    client: createOpenProjectClient({ baseUrl: `http://127.0.0.1:${mockPort}`, token: "test-token" }),
    policy,
  });
  const port = await adapter.listen(0);
  const call = (path, { method = "POST", body, headers = {} } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-test-kind": "human", "x-test-user": "anna", "x-test-tenant": "acme", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { mock, port, call, adapter, close: async () => { await adapter.close(); await mock.close(); } };
}

test("health spejler upstreams version og ping", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/healthz", { method: "GET" });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.upstream, "openproject");
    assert.equal(body.upstreamStatus, "ok");
    assert.equal(body.upstreamVersion, "14.6.0");
  } finally {
    await close();
  }
});

test("manglende verificeret identitet afvises", async () => {
  const { port, close } = await setup(allowPdp);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/projects/list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("fremmed tenantpåstand afvises", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/projects/list", { headers: { "x-test-tenant": "globex" }, body: { tenantId: "acme", evidence: ["policy-allow"] } });
    assert.equal(res.status, 403);
  } finally {
    await close();
  }
});

test("en bruger ser kun sine egne projekter", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/projects/list", { headers: { "x-test-user": "bo" }, body: { evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.result.projects.map((p) => p.id).sort(), ["10", "11"]);
  } finally {
    await close();
  }
});

test("en projektgæst ser kun sit eget projekt", async () => {
  const { call, close } = await setup(allowPdp, { guestAccess: "own-projects-only" });
  try {
    const own = await call("/v1/projects/read", { headers: { "x-test-user": "gus" }, body: { projectId: "10", evidence: ["policy-allow"] } });
    assert.equal(own.status, 200);
    const other = await call("/v1/projects/read", { headers: { "x-test-user": "gus" }, body: { projectId: "11", evidence: ["policy-allow"] } });
    assert.equal(other.status, 403);
    assert.equal((await other.json()).code, "access_denied");
  } finally {
    await close();
  }
});

test("et almindeligt medlem må ikke ændre medlemskaber (403)", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/projects/members", { headers: { "x-test-user": "bo" }, body: { projectId: "10", principal: "gus", role: ROLES.READER, evidence: ["policy-allow"] } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "access_denied");
  } finally {
    await close();
  }
});

test("deny stopper oprettelse og fail-closed PDP giver 503", async () => {
  const denied = await setup(denyPdp);
  try {
    const res = await denied.call("/v1/projects/work-packages", { body: { projectId: "10", workPackage: { subject: "X" }, evidence: ["policy-allow"] } });
    assert.equal(res.status, 403);
  } finally {
    await denied.close();
  }
  const down = await setup(downPdp);
  try {
    const res = await down.call("/v1/projects/work-packages", { body: { projectId: "10", workPackage: { subject: "X" }, evidence: ["policy-allow"] } });
    assert.equal(res.status, 503);
  } finally {
    await down.close();
  }
});

test("en projekt-admin opretter og opdaterer en arbejdspakke", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const created = await call("/v1/projects/work-packages", { body: { projectId: "10", workPackage: { subject: "Ny opgave", type: "task", status: "new" }, evidence: ["policy-allow"] } });
    const createdBody = await created.json();
    assert.equal(created.status, 200);
    assert.equal(createdBody.result.subject, "Ny opgave");
    const updated = await call("/v1/projects/work-packages/update", { body: { projectId: "10", workPackageId: createdBody.result.id, patch: { status: "in_progress" }, evidence: ["policy-allow"] } });
    const updatedBody = await updated.json();
    assert.equal(updated.status, 200);
    assert.equal(updatedBody.result.status, "in_progress");
  } finally {
    await close();
  }
});

test("en rettighedsændring skubber en ny søgeprojektion og forældede svar afvises", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const before = (await (await call("/v1/projects/search-scope", { headers: { "x-test-user": "bo" }, body: { evidence: ["policy-allow"] } })).json()).result;
    const added = await call("/v1/projects/members", { body: { projectId: "11", principal: "gus", role: ROLES.READER, evidence: ["policy-allow"] } });
    assert.equal(added.status, 200);
    const after = (await (await call("/v1/projects/search-scope", { headers: { "x-test-user": "bo" }, body: { evidence: ["policy-allow"] } })).json()).result;
    assert.equal(after.version, before.version + 1);
    const stale = await call("/v1/projects/ai-retrieval", { headers: { "x-test-user": "bo" }, body: { projection: before, results: [{ projectId: "10" }], evidence: ["policy-allow"] } });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "stale_projection");
  } finally {
    await close();
  }
});

test("import er idempotent ved retry og giver ingen dubletter", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const exported = (await (await call("/v1/projects/export", { body: { projectId: "10", evidence: ["policy-allow"] } })).json()).result;
    const bundle = { ...exported, workPackages: [...exported.workPackages, { externalId: "WP-NEW", subject: "Ny", type: "task", status: "new", tenantId: "acme" }] };
    // Fjern eksisterende afhængigheder som ikke længere findes i mock'en.
    const first = await call("/v1/projects/import", { body: { bundle, approvals: [{ verdict: "approve" }], evidence: ["policy-allow"] } });
    assert.equal(first.status, 200);
    const second = await call("/v1/projects/import", { body: { bundle, approvals: [{ verdict: "approve" }], evidence: ["policy-allow"] } });
    const body = await second.json();
    assert.equal(body.result.created, 0);
    assert.equal(body.result.idempotent, true);
  } finally {
    await close();
  }
});

test("import kræver godkendelse", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const exported = (await (await call("/v1/projects/export", { body: { projectId: "10", evidence: ["policy-allow"] } })).json()).result;
    const res = await call("/v1/projects/import", { body: { bundle: exported, approvals: [], evidence: ["policy-allow"] } });
    assert.equal(res.status, 428);
    assert.equal((await res.json()).code, "approval_required");
  } finally {
    await close();
  }
});

test("privacy locate/export/erase over HTTP", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const locate = await call("/v1/privacy/locate", { headers: { "x-test-kind": "agent" }, body: { identifiers: [{ type: "email", value: "bo@acme.example" }], evidence: ["policy-allow"] } });
    const locateBody = await locate.json();
    assert.equal(locate.status, 200);
    assert.ok(locateBody.result.count >= 2);

    const exp = await call("/v1/privacy/export", { headers: { "x-test-kind": "agent" }, body: { identifiers: [{ type: "email", value: "bo@acme.example" }], evidence: ["policy-allow"] } });
    const expBody = await exp.json();
    assert.equal(exp.status, 200);
    assert.equal(expBody.result.aclPreserved, true);

    const erase = await call("/v1/privacy/erase", { headers: { "x-test-kind": "agent" }, body: { identifiers: [{ type: "email", value: "bo@acme.example" }], reason: "DSAR fra kunden", approvals: [{ verdict: "approve" }], evidence: ["policy-allow"] } });
    const eraseBody = await erase.json();
    assert.equal(erase.status, 200);
    assert.equal(eraseBody.result.partial, true);
    assert.ok(eraseBody.result.remainingCopies.some((c) => c.location === "backup"));
  } finally {
    await close();
  }
});

test("backup-erklæringen er ærlig partial/unsupported", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/projects/backup-declaration", { method: "GET" });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.backup.conformance, "partial");
    assert.equal(body.restore.conformance, "unsupported");
    assert.equal(body.upgrade.conformance, "partial");
  } finally {
    await close();
  }
});

test("editionkombinationen vurderes pr. feature over HTTP", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/projects/edition", { body: { combination: "openproject-community", evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.features.sso.released, false);
    assert.equal(body.result.features.projects.released, true);
  } finally {
    await close();
  }
});

test("en principal fra en anden tenant kan ikke læse projektet via HTTP", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    // bo er acme-principal og forsøger at læse globex-projektet 12.
    const res = await call("/v1/projects/read", { headers: { "x-test-user": "bo", "x-test-tenant": "acme" }, body: { projectId: "12", evidence: ["policy-allow"] } });
    assert.equal(res.status, 403);
  } finally {
    await close();
  }
});
