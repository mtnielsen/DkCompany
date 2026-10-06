/**
 * DKC-010 — audit-servicen som modtager: den afviser et manglende, forkert,
 * udløbet eller tilbagekaldt credential før handleren kaldes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuditService } from "../src/server.mjs";
import { AuthError } from "../src/auth.mjs";
import { createLocalSigner, signersToJwks } from "../../../../credentials/src/keys.mjs";
import { createCredentialBroker } from "../../../../credentials/src/broker.mjs";
import { createCredentialVerifier } from "../../../../credentials/src/verifier.mjs";
import { createRevocationList } from "../../../../credentials/src/revocation.mjs";
import { createKillSwitch } from "../../../../credentials/src/kill-switch.mjs";

const AUDIENCE = "module:audit-service";
const agent = { kind: "agent", id: "spiffe://platform.example.org/agents/ops", spiffeId: "spiffe://platform.example.org/agents/ops", tenantId: "acme", autonomyClass: "A2" };
const authenticate = (auth) => {
  if (!auth) throw new AuthError("manglende token");
  return agent;
};
const allowPdp = { decide: async () => ({ decision: "allow", requiredEvidence: ["policy-allow"] }) };

function fixture() {
  let now = 1_700_000_000_000;
  const clock = () => now;
  const signer = createLocalSigner({ kid: "svc-1" });
  const revocations = createRevocationList({ clock });
  const killSwitch = createKillSwitch({ clock, cacheTtlMs: 500 });
  const broker = createCredentialBroker({ signer, clock, revocations, killSwitch, maxTtlSeconds: 900 });
  const verifier = createCredentialVerifier({ jwks: signersToJwks([signer]), clock, revocations, killSwitch, issuer: broker.issuer });
  return { clock, advance: (ms) => { now += ms; }, broker, verifier, revocations, killSwitch };
}

const baseIssue = { spiffeId: agent.spiffeId, agentRef: "ops", role: "executor", tenantId: "acme", verb: "backup", resource: "dummy-ok", audience: AUDIENCE, environment: "dev" };

async function start(creds) {
  const service = createAuditService({ authenticate, pdp: allowPdp, credentialVerifier: creds.verifier, credentialAudience: AUDIENCE });
  const port = await service.listen(0);
  const call = (path, { body, credential } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test", ...(credential ? { "x-platform-credential": credential } : {}) },
      body: JSON.stringify(body ?? {}),
    });
  return { service, call, close: () => service.close() };
}

test("uden credential afvises den privilegerede handling (fail-closed)", async () => {
  const creds = fixture();
  const { call, close } = await start(creds);
  try {
    const res = await call("/v1/ops/backup", { body: { target: "dummy-ok", evidence: ["policy-allow"] } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).failMode, "closed");
  } finally {
    await close();
  }
});

test("et gyldigt, scope-bundet credential lukker handlingen igennem", async () => {
  const creds = fixture();
  const { call, close } = await start(creds);
  try {
    const { token } = creds.broker.issue({ ...baseIssue });
    const res = await call("/v1/ops/backup", { body: { target: "dummy-ok", evidence: ["policy-allow"] }, credential: token });
    assert.equal(res.status, 200);
  } finally {
    await close();
  }
});

test("forkert audience, verbum og kunde afvises hos tjenesten", async () => {
  const creds = fixture();
  const { call, close } = await start(creds);
  try {
    const wrongAudience = creds.broker.issue({ ...baseIssue, audience: "module:other" });
    assert.equal((await call("/v1/ops/backup", { body: { target: "dummy-ok", evidence: ["policy-allow"] }, credential: wrongAudience.token })).status, 403);

    const wrongVerb = creds.broker.issue({ ...baseIssue, verb: "restore" });
    assert.equal((await call("/v1/ops/backup", { body: { target: "dummy-ok", evidence: ["policy-allow"] }, credential: wrongVerb.token })).status, 403);

    const wrongTenant = creds.broker.issue({ ...baseIssue, tenantId: "globex" });
    assert.equal((await call("/v1/ops/backup", { body: { target: "dummy-ok", evidence: ["policy-allow"] }, credential: wrongTenant.token })).status, 403);
  } finally {
    await close();
  }
});

test("udløb, tilbagekaldelse og nødstop afviser efterfølgende handlinger", async () => {
  const creds = fixture();
  const { call, close } = await start(creds);
  try {
    const expired = creds.broker.issue({ ...baseIssue, ttlSeconds: 5 });
    creds.advance(20_000);
    assert.equal((await call("/v1/ops/backup", { body: { target: "dummy-ok", evidence: ["policy-allow"] }, credential: expired.token })).status, 403);

    const revoked = creds.broker.issue({ ...baseIssue });
    creds.revocations.revoke({ jti: revoked.jti, reason: "test", revokedBy: "oidc|sec" });
    assert.equal((await call("/v1/ops/backup", { body: { target: "dummy-ok", evidence: ["policy-allow"] }, credential: revoked.token })).status, 403);

    const stopped = creds.broker.issue({ ...baseIssue });
    creds.killSwitch.activate({ scope: "global", reason: "incident", principal: { kind: "human", id: "oidc|sec", roles: ["security-officer"] } });
    assert.equal((await call("/v1/ops/backup", { body: { target: "dummy-ok", evidence: ["policy-allow"] }, credential: stopped.token })).status, 403);
  } finally {
    await close();
  }
});
