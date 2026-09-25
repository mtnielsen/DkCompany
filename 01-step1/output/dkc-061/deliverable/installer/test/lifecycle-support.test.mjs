import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadSupportPolicy, supportBundleProblems, scanForbiddenContent } from "../src/lifecycle-model.mjs";
import { buildSupportBundle, assertNoHiddenRemoteAccess, diagnosticsMustRedact, SupportBundleError } from "../src/lifecycle-support.mjs";
import { decideLifecycleAccess } from "../src/lifecycle-permissions.mjs";

const policy = loadSupportPolicy(repoRoot);
const AT = "2026-03-01T00:00:00Z";

const baseSources = {
  "installer-status": { status: "done", steps: 8, apiKey: "should-be-redacted" },
  "release-version": { release: "1.4.0", channel: "stable" },
  "component-versions": { "platform-core": "1.4.0" },
  "preflight-checks": { ok: true, checks: 24 },
};

test("supportbundlen redigeres og validerer", () => {
  const bundle = buildSupportBundle({ policy, installationId: "acme-prod", sources: baseSources, at: AT });
  assert.equal(bundle.redacted, true);
  assert.equal(bundle.content["installer-status"].apiKey, "[REDACTED]");
  assert.equal(supportBundleProblems(bundle, { policy }).length, 0);
  assert.equal(assertNoHiddenRemoteAccess(bundle).ok, true);
});

test("supportbundlen har ingen skjult fjernadgang som standard", () => {
  const bundle = buildSupportBundle({ policy, installationId: "acme-prod", sources: baseSources, at: AT });
  assert.equal(bundle.remoteAccess.enabled, false);
  assert.equal(bundle.remoteAccess.hiddenAccess, false);
  assert.equal(bundle.collected.length, Object.keys(baseSources).length);
});

test("en rå hemmelighed blokerer bundlen", () => {
  assert.throws(() => buildSupportBundle({ policy, installationId: "acme-prod", sources: { "installer-status": { token: "ghp_" + "a".repeat(30) } }, at: AT }), (e) => e instanceof SupportBundleError && /hemmelighed/.test(e.message));
});

test("ikke-godkendt HR-indhold blokerer bundlen", () => {
  assert.throws(() => buildSupportBundle({ policy, installationId: "acme-prod", sources: { "component-versions": { payroll: 42000 } }, at: AT }), (e) => e instanceof SupportBundleError && /HR/.test(e.message));
  assert.ok(scanForbiddenContent({ nested: { sickLeave: 3 } }).length > 0);
});

test("en kilde uden for allowlisten afvises", () => {
  assert.throws(() => buildSupportBundle({ policy, installationId: "acme-prod", sources: { "raw-database-dump": { rows: 1 } }, at: AT }), /allowlisten/);
});

test("fjernadgang kræver et navngivent menneskes samtykke og en TTL", () => {
  assert.throws(() => buildSupportBundle({ policy, installationId: "acme-prod", sources: baseSources, remoteAccess: { enabled: true }, at: AT }), /samtykke/);
  const bundle = buildSupportBundle({ policy, installationId: "acme-prod", sources: baseSources, remoteAccess: { enabled: true, consentRef: "oidc|ada.acme", ttlMinutes: 30 }, at: AT });
  assert.equal(bundle.remoteAccess.enabled, true);
  assert.equal(supportBundleProblems(bundle, { policy }).length, 0);
  assert.throws(() => buildSupportBundle({ policy, installationId: "acme-prod", sources: baseSources, remoteAccess: { enabled: true, consentRef: "oidc|ada.acme", ttlMinutes: 9999 }, at: AT }), /TTL/);
});

test("diagnostik afviser hemmelighedssignaturer", () => {
  const result = diagnosticsMustRedact({ note: "sk-abcdefghijklmnopqrstuvwxyz" });
  assert.equal(result.secretScan, "fail");
});

test("fjernadgangshandlingen kræver samtykke i adgangskontrollen", () => {
  const ada = { id: "oidc|ada.acme", tenantId: "acme", roles: ["lifecycle-admin"] };
  assert.equal(decideLifecycleAccess({ principal: ada, tenantId: "acme", action: "remote-access", consent: { enabled: false } }).allowed, false);
  assert.equal(decideLifecycleAccess({ principal: ada, tenantId: "acme", action: "remote-access", consent: { enabled: true, consentRef: "oidc|ada.acme", ttlMinutes: 30 } }).allowed, true);
  assert.equal(decideLifecycleAccess({ principal: ada, tenantId: "acme", action: "delete-data", consent: { secondHumanSubject: ada.id } }).allowed, false);
});
