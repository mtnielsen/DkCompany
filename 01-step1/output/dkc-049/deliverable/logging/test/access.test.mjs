import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogAccess } from "../src/access.mjs";
import { makeLedger, makeCorrelation, sensorRecord, PRINCIPAL, POLICY } from "./support/fixture.mjs";

async function seeded() {
  const { ledger } = makeLedger();
  const correlation = makeCorrelation();
  await ledger.append(sensorRecord({ correlation }));
  return ledger;
}

test("en kunde kan læse sin egen log og læsningen logges", async () => {
  const ledger = await seeded();
  const access = createLogAccess({ ledger, policy: POLICY });
  const result = await access.read({ principal: PRINCIPAL, tenantId: "acme" });
  assert.equal(result.allowed, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.decision.decision, "allow");
  // Den ekstra post er selve access-beslutningen.
  const all = await ledger.read({ tenantId: "acme" });
  assert.equal(all.length, 2);
  assert.equal(all.some((r) => r.observation?.source === "log-access"), true);
});

test("en kunde afvises for en fremmed tenant og forsøget logges", async () => {
  const ledger = await seeded();
  const access = createLogAccess({ ledger, policy: POLICY });
  const result = await access.read({ principal: PRINCIPAL, tenantId: "globex" });
  assert.equal(result.allowed, false);
  assert.equal(result.records.length, 0);
  assert.equal(result.decision.decision, "deny");
  const globex = await ledger.read({ tenantId: "globex" });
  assert.equal(globex.length, 1);
  assert.equal(globex[0].provenance, "system");
});

test("en principal uden læserrolle afvises (default-deny)", async () => {
  const ledger = await seeded();
  const access = createLogAccess({ ledger, policy: POLICY });
  const result = await access.read({ principal: { id: "oidc|nobody", tenantId: "acme", roles: [] }, tenantId: "acme" });
  assert.equal(result.allowed, false);
  assert.match(result.decision.reason, /læserrolle/);
});

test("en scopet platformadmin kan læse en fremmed tenant", async () => {
  const ledger = await seeded();
  const access = createLogAccess({ ledger, policy: POLICY });
  const result = await access.read({ principal: { id: "oidc|admin", roles: ["platform-admin:acme"] }, tenantId: "acme" });
  assert.equal(result.allowed, true);
  assert.equal(result.decision.crossTenant, true);
  assert.equal(result.records.length, 1);
});
