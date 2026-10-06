/**
 * DKC-010 — kryptografisk bundne rettigheder, udløb, tilbagekaldelse og nødstop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalSigner, signersToJwks, keyResolverFromJwks } from "../src/keys.mjs";
import { createCredentialBroker } from "../src/broker.mjs";
import { createCredentialVerifier } from "../src/verifier.mjs";
import { createExecutorGuard, CredentialRejected } from "../src/receiver.mjs";
import { createRevocationList } from "../src/revocation.mjs";
import { createKillSwitch, EmergencyStopActive, EmergencyStopAuthorityError } from "../src/kill-switch.mjs";

const HUMAN = (roles) => ({ kind: "human", id: `oidc|${roles[0]}`, roles });

function fixture({ ttlSeconds = 300 } = {}) {
  let now = 1_700_000_000_000;
  const clock = () => now;
  const signer = createLocalSigner({ kid: "test-key-1" });
  const jwks = signersToJwks([signer]);
  const revocations = createRevocationList({ clock });
  const killSwitch = createKillSwitch({ clock, cacheTtlMs: 500 });
  const broker = createCredentialBroker({ signer, clock, revocations, killSwitch, maxTtlSeconds: ttlSeconds });
  const verifier = createCredentialVerifier({ jwks, clock, revocations, killSwitch, issuer: broker.issuer });
  const advance = (ms) => {
    now += ms;
  };
  return { clock, signer, jwks, revocations, killSwitch, broker, verifier, advance, now: () => now };
}

const base = { spiffeId: "spiffe://platform.example.org/agents/upgrader", agentRef: "upgrader", role: "executor", tenantId: "acme", verb: "upgrade.patch", resource: "dummy-ok", audience: "module:dummy-ok", environment: "staging" };
const expect = { audience: "module:dummy-ok", verb: "upgrade.patch", resource: "dummy-ok", tenantId: "acme", environment: "staging" };

test("credential virker kun hos tilsigtet executor (audience)", () => {
  const { broker, verifier } = fixture();
  const { token } = broker.issue(base);
  assert.equal(verifier.verify(token, expect).ok, true);
  const wrong = verifier.verify(token, { ...expect, audience: "module:other" });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reasons.join(" "), /ikke 'module:other'/);
});

test("credential virker kun til det tilladte scope", () => {
  const { broker, verifier } = fixture();
  const { token } = broker.issue(base);
  assert.equal(verifier.verify(token, { ...expect, verb: "restart" }).ok, false);
  assert.equal(verifier.verify(token, { ...expect, resource: "dummy-ok/other-child" }).ok, true, "barn er inden for scope");
  assert.equal(verifier.verify(token, { ...expect, resource: "another-module" }).ok, false);
  assert.equal(verifier.verify(token, { ...expect, tenantId: "globex" }).ok, false);
  assert.equal(verifier.verify(token, { ...expect, environment: "prod" }).ok, false);
});

test("udløb afviser efterfølgende handling", () => {
  const { broker, verifier, advance } = fixture();
  const { token, claims } = broker.issue({ ...base, ttlSeconds: 10 });
  assert.equal(verifier.verify(token, expect).ok, true);
  advance(20_000);
  const expired = verifier.verify(token, expect);
  assert.equal(expired.ok, false);
  assert.match(expired.reasons.join(" "), /udløbet/);
  assert.equal(claims.exp - claims.iat, 10);
});

test("tilbagekaldelse afviser efterfølgende handling hos modtageren", () => {
  const { broker, verifier, revocations } = fixture();
  const first = broker.issue(base);
  assert.equal(verifier.verify(first.token, expect).ok, true);
  revocations.revoke({ jti: first.jti, reason: "mistet", revokedBy: "oidc|sec" });
  const revoked = verifier.verify(first.token, expect);
  assert.equal(revoked.ok, false);
  assert.match(revoked.reasons.join(" "), /tilbagekaldt/);

  // Agent-niveau tilbagekalder alle tokens for identiteten.
  const second = broker.issue(base);
  revocations.revoke({ scope: "agent", spiffeId: base.spiffeId, reason: "agent kompromitteret", revokedBy: "oidc|sec" });
  assert.equal(verifier.verify(second.token, expect).ok, false);
});

test("nødstop afviser nye handlinger for agent, kunde og globalt", () => {
  const { broker, verifier, killSwitch } = fixture();
  const security = HUMAN(["security-officer"]);
  // Udsted først (intet stop), aktivér derefter agentstoppet.
  const issued = broker.issue(base);
  killSwitch.activate({ scope: "agent", subjectId: base.spiffeId, reason: "mistanke", principal: security });
  assert.throws(() => killSwitch.assertAllowed({ tenantId: "acme", spiffeId: base.spiffeId }), EmergencyStopActive);
  // Både udstederen og modtageren afviser.
  assert.throws(() => broker.issue(base), EmergencyStopActive);
  const denied = verifier.verify(issued.token, expect);
  assert.equal(denied.ok, false);
  assert.match(denied.reasons.join(" "), /nødstop/);

  // Ophæv og prøv kunde- og globalt niveau.
  killSwitch.clear({ scope: "agent", subjectId: base.spiffeId, principal: security });
  assert.equal(killSwitch.assertAllowed({ tenantId: "acme", spiffeId: base.spiffeId }), true);
  killSwitch.activate({ scope: "tenant", subjectId: "acme", principal: HUMAN(["tenant-admin"]) });
  assert.equal(killSwitch.stateFor({ tenantId: "acme", spiffeId: base.spiffeId }).tenant, true);
  killSwitch.activate({ scope: "global", principal: security });
  assert.equal(killSwitch.stateFor({ tenantId: "globex", spiffeId: "spiffe://x/y" }).global, true);
});

test("kun et verificeret menneske med den rette rolle må betjene et nødstop", () => {
  const { killSwitch } = fixture();
  assert.throws(() => killSwitch.activate({ scope: "global", principal: { kind: "agent", id: "spiffe://x" } }), EmergencyStopAuthorityError);
  assert.throws(() => killSwitch.activate({ scope: "global", principal: { kind: "human", id: "u", roles: ["developer"] } }), EmergencyStopAuthorityError);
  assert.throws(() => killSwitch.activate({ scope: "global", principal: { kind: "human", id: "u", roles: ["platform-admin"], demo: true } }), EmergencyStopAuthorityError);
  const record = killSwitch.activate({ scope: "global", principal: HUMAN(["platform-admin"]) });
  assert.equal(record.active, true);
  killSwitch.clear({ scope: "global", principal: HUMAN(["security-officer"]) });
  assert.equal(killSwitch.stateFor({}).global, false);
});

test("brokeren nægter at udstede til A4-beskyttede ressourcer", () => {
  const { broker } = fixture();
  for (const resource of ["policy/bundles", "audit/log", "credentials/keys", "iam/roles"]) {
    assert.throws(() => broker.issue({ ...base, resource }), /A4-beskyttet/);
  }
});

test("brokeren nægter verber rollen ikke må, og kræver binding", () => {
  const { broker } = fixture();
  assert.throws(() => broker.issue({ ...base, role: "observer" }), /må ikke udstede/);
  assert.throws(() => broker.issue({ ...base, tenantId: null }), /kunde/);
  assert.throws(() => broker.issue({ ...base, audience: null }), /audience/);
  assert.throws(() => broker.issue({ ...base, environment: null }), /miljø/);
});

test("receiver-vagten afviser forkert audience og udfører det rigtige", async () => {
  const { broker, verifier } = fixture();
  const executed = [];
  const guard = createExecutorGuard({ verifier, audience: "module:dummy-ok" });
  const executor = guard.guard(async (action) => {
    executed.push(action.verb);
    return { summary: "ok" };
  });
  const ok = broker.issue(base);
  await executor({ verb: "upgrade.patch", target: "dummy-ok", tenantId: "acme", environment: "staging", credential: ok });
  assert.deepEqual(executed, ["upgrade.patch"]);

  const other = broker.issue({ ...base, audience: "module:other" });
  await assert.rejects(() => executor({ verb: "upgrade.patch", target: "dummy-ok", tenantId: "acme", environment: "staging", credential: other }), CredentialRejected);
  assert.deepEqual(executed, ["upgrade.patch"], "afvist credential udfører intet");
});
