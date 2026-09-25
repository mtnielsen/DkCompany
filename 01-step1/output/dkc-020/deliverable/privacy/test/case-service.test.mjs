import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDatabase, createMigrator, createSqliteDsarStore } from "../../persistence/src/index.mjs";
import { createMemoryArtifactStore, createExportService, createCaseService, PrivacyAuthorizationError } from "../src/index.mjs";
import { loadAllModules } from "../../conformance/src/dsar.mjs";
import { assertionSignature } from "../../identity/src/identity.mjs";
import { createSpiffeAuthenticator } from "../../modules/mattermost-adapter/service/src/auth.mjs";
import { createMattermostAdapter } from "../../modules/mattermost-adapter/service/src/server.mjs";
import { createMattermostClient } from "../../modules/mattermost-adapter/service/src/mattermost.mjs";
import { createMockMattermost } from "../../modules/mattermost-adapter/service/src/mock-mattermost.mjs";
import { createKeycloakAdapter } from "../../modules/keycloak-adapter/service/src/server.mjs";
import { createKeycloakClient } from "../../modules/keycloak-adapter/service/src/keycloak.mjs";
import { createMockKeycloak } from "../../modules/keycloak-adapter/service/src/mock-keycloak.mjs";

const PROXY_SECRET = "test-proxy-secret";
const AGENT = "spiffe://platform.example.org/agents/dsar";
const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };
const DP0 = { kind: "human", id: "oidc|dpo.anna", name: "Anna DPO", tenantId: "acme", roles: ["dpo"] };

function assertion(tenantId) {
  const ts = Math.floor(Date.now() / 1000);
  return `${AGENT}|${tenantId}|${ts}|${assertionSignature({ spiffeId: AGENT, tenantId, timestamp: ts }, PROXY_SECRET)}`;
}

function authenticator() {
  return createSpiffeAuthenticator({ trustDomain: "platform.example.org", trustedProxies: ["127.0.0.1"], proxySecret: PROXY_SECRET });
}

function makeService({ modules, fanout } = {}) {
  const db = openDatabase({ path: ":memory:" });
  createMigrator({ db }).apply();
  const store = createSqliteDsarStore({ db });
  const artifactStore = createMemoryArtifactStore();
  const exportService = createExportService({ store, artifactStore });
  const audit = [];
  const caseService = createCaseService({ store, artifactStore, exportService, modules, fanout, audit: (event) => audit.push(event) });
  return { db, store, artifactStore, exportService, caseService, audit, cleanup: () => db.close() };
}

async function withTwoApps(fn) {
  const mm = createMockMattermost({ posts: [{ id: "p1", userId: "u1", message: "hej fra kunden" }, { id: "p2", userId: "u1", message: "farvel" }] });
  const kc = createMockKeycloak();
  const mmPort = await mm.listen(0);
  const kcPort = await kc.listen(0);
  const mmAdapter = createMattermostAdapter({
    authenticate: authenticator(),
    pdp: allowPdp,
    client: createMattermostClient({ baseUrl: `http://127.0.0.1:${mmPort}`, token: "test-token" }),
    profile: "test",
  });
  const kcAdapter = createKeycloakAdapter({
    authenticate: authenticator(),
    pdp: allowPdp,
    client: createKeycloakClient({ baseUrl: `http://127.0.0.1:${kcPort}`, realm: "platform", token: "test-token" }),
    profile: "test",
  });
  const mmAdapterPort = await mmAdapter.listen(0);
  const kcAdapterPort = await kcAdapter.listen(0);
  const modules = loadAllModules().filter((m) => ["mattermost-adapter", "keycloak-adapter"].includes(m.manifest.metadata.name));
  const endpoints = {
    "mattermost-adapter": `http://127.0.0.1:${mmAdapterPort}/v1/privacy/export`,
    "keycloak-adapter": `http://127.0.0.1:${kcAdapterPort}/v1/privacy/export`,
  };
  const headers = { "x-platform-assertion": assertion("acme") };
  try {
    return await fn({ modules, endpoints, headers });
  } finally {
    await mmAdapter.close();
    await kcAdapter.close();
    await mm.close();
    await kc.close();
  }
}

test("en syntetisk person findes og eksporteres på tværs af to rigtige adaptere", async () => {
  await withTwoApps(async ({ modules, endpoints, headers }) => {
    const { caseService, cleanup } = makeService({ modules });
    try {
      const identifiers = [{ type: "email", value: "kunde@example.org", normalised: "kunde@example.org" }];
      const sag = caseService.openCase({ tenantId: "acme", verb: "subject.export", identifiers, principal: DP0 });
      const run = await caseService.runCase({ tenantId: "acme", caseId: sag.caseId, principal: DP0, endpoints, headers });
      assert.equal(run.status, "completed", JSON.stringify(run.response, null, 2));
      assert.equal(run.response.summary.modulesQueried, 2);
      assert.equal(run.response.summary.full, 2);
      assert.ok(run.response.results.every((r) => r.status === "full"));

      const exp = caseService.createExport({ tenantId: "acme", caseId: sag.caseId, principal: DP0 });
      const redeemed = caseService.redeemExport({ tenantId: "acme", exportId: exp.exportId, principal: DP0 });
      // 2 opslag fra Mattermost + 3 poster fra Keycloak.
      assert.ok(redeemed.payload.recordCount >= 5, JSON.stringify(redeemed.payload));
      assert.equal(redeemed.status, "redeemed");
    } finally {
      cleanup();
    }
  });
});

test("samme e-mail i en anden tenant udleveres ikke", async () => {
  await withTwoApps(async ({ modules, endpoints }) => {
    const { caseService, cleanup } = makeService({ modules });
    try {
      const globex = { ...DP0, tenantId: "globex" };
      const identifiers = [{ type: "email", value: "kunde@example.org", normalised: "kunde@example.org" }];
      const sag = caseService.openCase({ tenantId: "globex", verb: "subject.export", identifiers, principal: globex });
      // Kalderen forsøger at bruge acme-identiteten mod modulerne; adapterne afviser.
      const run = await caseService.runCase({ tenantId: "globex", caseId: sag.caseId, principal: globex, endpoints, headers: { "x-platform-assertion": assertion("acme") } });
      assert.notEqual(run.status, "completed");
      assert.equal(run.response.summary.full, 0);
      assert.ok(run.response.results.every((r) => r.status === "failed" || r.status === "unknown"));
    } finally {
      cleanup();
    }
  });
});

test("timeout og nedetid giver failed/unknown, aldrig fuld succes", async () => {
  // En server der aldrig svarer, og et lukket endpoint (connection refused).
  const hanging = createServer(() => {});
  const hangingPort = await new Promise((resolve) => hanging.listen(0, "127.0.0.1", () => resolve(hanging.address().port)));
  const modules = [
    { dir: "slow", manifest: { metadata: { name: "slow", version: "1.0.0" }, privacy: { subject: {}, dsarEndpoint: "http://x", "subject.export": { conformance: "full" } } } },
    { dir: "down", manifest: { metadata: { name: "down", version: "1.0.0" }, privacy: { dsarEndpoint: "http://x", "subject.export": { conformance: "full" } } } },
  ];
  const endpoints = { slow: `http://127.0.0.1:${hangingPort}/v1/privacy/export`, down: "http://127.0.0.1:1/v1/privacy/export" };
  const { caseService, cleanup } = makeService({ modules });
  try {
    const identifiers = [{ type: "email", value: "kunde@example.org", normalised: "kunde@example.org" }];
    const sag = caseService.openCase({ tenantId: "acme", verb: "subject.export", identifiers, principal: DP0 });
    const run = await caseService.runCase({ tenantId: "acme", caseId: sag.caseId, principal: DP0, endpoints, timeoutMs: 150 });
    assert.equal(run.status, "partially-completed");
    assert.equal(run.response.summary.full, 0);
    assert.equal(run.response.summary.failed, 1);
    assert.equal(run.response.summary.unknown, 1);
  } finally {
    cleanup();
    await new Promise((r) => hanging.close(r));
  }
});

test("en genoptaget kørsel springer allerede afsluttede moduler over", async () => {
  await withTwoApps(async ({ modules, endpoints, headers }) => {
    const { caseService, cleanup } = makeService({ modules });
    try {
      const identifiers = [{ type: "email", value: "kunde@example.org", normalised: "kunde@example.org" }];
      const sag = caseService.openCase({ tenantId: "acme", verb: "subject.export", identifiers, principal: DP0 });
      await caseService.runCase({ tenantId: "acme", caseId: sag.caseId, principal: DP0, endpoints, headers });
      // Genoptag uden endpoints: de afsluttede moduler kaldes ikke, så intet fejler.
      const again = await caseService.runCase({ tenantId: "acme", caseId: sag.caseId, principal: DP0, endpoints: {}, headers });
      assert.equal(again.status, "completed");
      assert.equal(again.response.summary.full, 2);
    } finally {
      cleanup();
    }
  });
});

test("en uautoriseret sagsbehandler afvises", () => {
  const { caseService, cleanup } = makeService({ modules: [] });
  try {
    const identifiers = [{ type: "email", value: "kunde@example.org", normalised: "kunde@example.org" }];
    const operator = { kind: "human", id: "oidc|op", tenantId: "acme", roles: ["operator"] };
    assert.throws(() => caseService.openCase({ tenantId: "acme", verb: "subject.export", identifiers, principal: operator }), (err) => err instanceof PrivacyAuthorizationError);
  } finally {
    cleanup();
  }
});

test("idempotency-key giver ikke to sager", () => {
  const { caseService, cleanup } = makeService({ modules: [] });
  try {
    const identifiers = [{ type: "email", value: "kunde@example.org", normalised: "kunde@example.org" }];
    const a = caseService.openCase({ tenantId: "acme", verb: "subject.export", identifiers, principal: DP0, idempotencyKey: "k-1" });
    const b = caseService.openCase({ tenantId: "acme", verb: "subject.export", identifiers, principal: DP0, idempotencyKey: "k-1" });
    assert.equal(a.caseId, b.caseId);
    assert.equal(b.replayed, true);
  } finally {
    cleanup();
  }
});
