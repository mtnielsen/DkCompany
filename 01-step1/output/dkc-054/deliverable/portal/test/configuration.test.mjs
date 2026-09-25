/**
 * DKC-054 — portalen og den deklarative fil bruger samme schema og API.
 *
 * UI/API-valideringen giver samme digest som filvalideringen, og en
 * konfigurationsændring kræver platform-admin (default-deny).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPortalHandler } from "../src/server.mjs";
import { CUSTOMER_ADMIN, OPERATOR, DEMO, packages, store as newStore } from "./support/fixtures.mjs";
import { repoRoot } from "../../configuration/src/model.mjs";
import { validateConfigurationInput } from "../../configuration/src/validate-api.mjs";

const ADMIN = { id: "oidc|admin", kind: "human", name: "Ada Admin", roles: ["platform-admin", "platform-admin:*"], tenantScope: ["*"] };
const desired = JSON.parse(readFileSync(join(repoRoot, "configuration/desired-state.json"), "utf8"));

function handler() {
  return createPortalHandler({ store: newStore(), packages: packages(), configuration: { desired, actual: desired }, clock: () => Date.parse("2026-09-24T09:00:00Z") });
}

test("portalens validering giver samme digest som filen", async () => {
  const portal = handler();
  const res = await portal.handle({ principal: ADMIN, method: "POST", path: "/api/configuration/validate", body: { configuration: desired } });
  assert.equal(res.status, 200, res.body);
  const body = JSON.parse(res.body);
  const fileResult = validateConfigurationInput(desired, { source: "file" });
  assert.equal(body.digest, fileResult.digest);
  assert.equal(body.ok, true);
});

test("en kunde kan se sin effektive konfiguration, men ikke ændre den", async () => {
  const portal = handler();
  const view = await portal.handle({ principal: CUSTOMER_ADMIN, method: "GET", path: "/api/configuration" });
  assert.equal(view.status, 200);
  const changed = structuredClone(desired);
  changed.installation.logLevel = "warn";
  const denied = await portal.handle({ principal: CUSTOMER_ADMIN, method: "POST", path: "/api/configuration/apply", body: { configuration: changed } });
  assert.equal(denied.status, 403);
  assert.equal(JSON.parse(denied.body).code, "portal_role_missing");
});

test("kun platform-admin med scope må anvende en ændring", async () => {
  const portal = handler();
  const changed = structuredClone(desired);
  changed.installation.logLevel = "warn";
  const operatorDenied = await portal.handle({ principal: OPERATOR, method: "POST", path: "/api/configuration/apply", body: { configuration: changed, tenantId: "acme" } });
  assert.equal(operatorDenied.status, 403);
  const applied = await portal.handle({ principal: ADMIN, method: "POST", path: "/api/configuration/apply", body: { configuration: changed, tenantId: "acme" } });
  assert.equal(applied.status, 200);
  assert.equal(JSON.parse(applied.body).applied, true);
});

test("demo-identiteter afvises på konfigurationsfladen", async () => {
  const portal = handler();
  const res = await portal.handle({ principal: DEMO, method: "GET", path: "/api/configuration" });
  assert.equal(res.status, 403);
});
