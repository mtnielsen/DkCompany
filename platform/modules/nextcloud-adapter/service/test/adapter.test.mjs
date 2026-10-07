import { test } from "node:test";
import assert from "node:assert/strict";
import { createNextcloudAdapter } from "../src/server.mjs";
import { createNextcloudClient } from "../src/nextcloud.mjs";
import { createMockNextcloud } from "../src/mock-nextcloud.mjs";
import { ROLES, SHARE_TYPES, PERMISSIONS } from "../src/constants.mjs";

const ROLES_BY_USER = { anna: ROLES.TENANT_ADMIN, bo: ROLES.MEMBER, carla: ROLES.MEMBER, gus: ROLES.GUEST };

/**
 * Testdobbel-authenticator. Kræver eksplicit x-test-kind, så et kald uden
 * identitet giver 401 ligesom en rigtig manglende workload-identitet.
 */
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
  const mock = createMockNextcloud();
  const mockPort = await mock.listen(0);
  const adapter = createNextcloudAdapter({
    authenticate: testAuthenticate,
    pdp,
    client: createNextcloudClient({ baseUrl: `http://127.0.0.1:${mockPort}`, token: "test-token" }),
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
    assert.equal(body.upstream, "nextcloud");
    assert.equal(body.upstreamStatus, "ok");
  } finally {
    await close();
  }
});

test("locate finder bruger, filer, delinger, sessioner og kalendere via e-mail", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/privacy/locate", { headers: { "x-test-kind": "agent" }, body: { identifiers: [{ type: "email", value: "anna@acme.example" }], evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.matches[0].subjectId, "anna");
    assert.ok(body.result.count >= 3);
  } finally {
    await close();
  }
});

test("export returnerer filer, delinger og kalendere med ACL markeret", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/privacy/export", { headers: { "x-test-kind": "agent" }, body: { identifiers: [{ type: "email", value: "anna@acme.example" }], evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.aclPreserved, true);
    assert.ok(body.result.records.some((r) => r.path === "/projekt/plan.docx"));
  } finally {
    await close();
  }
});

test("erase sletter filer/delinger/sessioner, men erklærer partial", async () => {
  const { mock, call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/privacy/erase", {
      headers: { "x-test-kind": "agent" },
      body: { identifiers: [{ type: "email", value: "bo@acme.example" }], evidence: ["policy-allow"], approvals: [{ verdict: "approve" }], reason: "DSAR fra kunden" },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.partial, true);
    assert.equal(body.result.recordsAffected, 1);
    assert.ok(body.result.remainingCopies.some((c) => c.location === "backup"));
    assert.equal(mock.files.has("bo:/noter.txt"), false);
  } finally {
    await close();
  }
});

test("manglende verificeret identitet afvises", async () => {
  const { port, close } = await setup(allowPdp);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/privacy/locate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifiers: [{ type: "email", value: "anna@acme.example" }] }),
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("fremmed tenantpåstand afvises", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/workspace/files/read", {
      headers: { "x-test-tenant": "globex" },
      body: { owner: "anna", path: "/projekt/plan.docx", tenantId: "acme", evidence: ["policy-allow"] },
    });
    assert.equal(res.status, 403);
  } finally {
    await close();
  }
});

test("deny stopper en deling", async () => {
  const { mock, call, close } = await setup(denyPdp);
  try {
    const res = await call("/v1/workspace/shares", { body: { owner: "anna", path: "/projekt/plan.docx", shareWith: "bo", permissions: PERMISSIONS.READ, evidence: ["policy-allow"] } });
    assert.equal(res.status, 403);
    assert.equal(mock.shares.size, 0);
  } finally {
    await close();
  }
});

test("utilgængelig PDP betyder ingen deling (fail-closed)", async () => {
  const { mock, call, close } = await setup(downPdp);
  try {
    const res = await call("/v1/workspace/shares", { body: { owner: "anna", path: "/projekt/plan.docx", shareWith: "bo", permissions: PERMISSIONS.READ, evidence: ["policy-allow"] } });
    assert.equal(res.status, 503);
    assert.equal(mock.shares.size, 0);
  } finally {
    await close();
  }
});

test("to brugere deler og redigerer; en tredje uden adgang afvises over HTTP", async () => {
  const { mock, call, close } = await setup(allowPdp);
  try {
    const shared = await call("/v1/workspace/shares", { body: { owner: "anna", path: "/projekt/plan.docx", shareWith: "bo", permissions: PERMISSIONS.READ | PERMISSIONS.UPDATE, evidence: ["policy-allow"] } });
    assert.equal(shared.status, 200);
    assert.equal(mock.shares.size, 1);

    const edit = await call("/v1/workspace/files/edit", { headers: { "x-test-user": "bo" }, body: { owner: "anna", path: "/projekt/plan.docx", content: "version-2", evidence: ["policy-allow"] } });
    assert.equal(edit.status, 200);

    const denied = await call("/v1/workspace/files/read", { headers: { "x-test-user": "carla" }, body: { owner: "anna", path: "/projekt/plan.docx", evidence: ["policy-allow"] } });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "access_denied");
  } finally {
    await close();
  }
});

test("offentligt link afvises af standardpolitikken og tillades af kundepolitikken", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const denied = await call("/v1/workspace/public-links", { body: { owner: "anna", path: "/projekt/plan.docx", ttlDays: 3, password: "langnokadgangskode", evidence: ["policy-allow"] } });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "public_link_denied");
  } finally {
    await close();
  }
  const { call: call2, close: close2 } = await setup(allowPdp, { publicLinks: { enabled: true, requirePassword: true, requireExpiry: true, maxTtlDays: 7, allowUpload: false } });
  try {
    const ok = await call2("/v1/workspace/public-links", { body: { owner: "anna", path: "/projekt/plan.docx", ttlDays: 3, password: "langnokadgangskode", evidence: ["policy-allow"] } });
    const body = await ok.json();
    assert.equal(ok.status, 200);
    assert.ok(body.result.token);
    assert.ok(body.result.expiration);
  } finally {
    await close2();
  }
});

test("gæsteadgang kræver kundepolitik", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const denied = await call("/v1/workspace/guests", { body: { guest: { id: "gus", email: "gus@partner.example" }, evidence: ["policy-allow"] } });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "guest_denied");
  } finally {
    await close();
  }
});

test("offboarding lukker sessioner og delinger over HTTP", async () => {
  const { mock, call, close } = await setup(allowPdp);
  try {
    await call("/v1/workspace/shares", { body: { owner: "anna", path: "/projekt/plan.docx", shareWith: "bo", permissions: PERMISSIONS.READ, evidence: ["policy-allow"] } });
    const res = await call("/v1/workspace/offboard", { body: { subject: { id: "bo" }, evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.closedSessions, 1);
    assert.equal(mock.sessions.get("bo").length, 0);
  } finally {
    await close();
  }
});

test("backup-erklæringen er ærlig partial/unsupported", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/workspace/backup-declaration", { method: "GET" });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.backup.conformance, "partial");
    assert.equal(body.restore.conformance, "unsupported");
  } finally {
    await close();
  }
});

test("office-formater registrerer afvigelser", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/workspace/office-formats", { body: { evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.deviations.length, 0, "mock-kontoredaktøren understøtter alle pilotformater");
    assert.equal(body.result.product, "ONLYOFFICE");
  } finally {
    await close();
  }
});

test("editionkombinationen vurderes pr. delmodul", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/workspace/edition", { body: { combination: "nextcloud-hub-collabora", evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.submodules.editor.released, false);
    assert.equal(body.result.submodules.files.released, true);
  } finally {
    await close();
  }
});

test("shareType-parameteren oversættes til Nextclouds deletype", async () => {
  const { call, close } = await setup(allowPdp);
  try {
    const res = await call("/v1/workspace/shares", { body: { owner: "anna", path: "/projekt/budget.xlsx", shareWith: "acme", shareType: SHARE_TYPES.GROUP, permissions: PERMISSIONS.READ, evidence: ["policy-allow"] } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.share_type, SHARE_TYPES.GROUP);
  } finally {
    await close();
  }
});
