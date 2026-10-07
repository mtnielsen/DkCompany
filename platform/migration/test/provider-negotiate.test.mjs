import { test } from "node:test";
import assert from "node:assert/strict";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, loadSwapFixtures } from "../src/provider-model.mjs";
import { negotiateCapabilities, classifySwitch, preflightSwap } from "../src/provider-negotiate.mjs";

const all = loadAll(repoRoot);
const byId = (id) => all.providers.providers.find((p) => p.id === id);
const preflight = (from, to, overrides = null) =>
  preflightSwap({ providers: overrides ?? all.providers, catalog: all.catalog, matrix: all.matrix, policy: all.policy, from, to });

test("katalog og register dækker alle syv providerklasser", () => {
  assert.equal(new Set(all.providers.providers.map((p) => p.class)).size, 7);
  assert.ok(all.catalog.capabilities.some((c) => c.mandatory && c.securityCritical));
});

test("versionsforhandling tillader et planlagt skift med stærkere mål", () => {
  const result = negotiateCapabilities({ source: byId("sqlite-local"), target: byId("postgres-managed"), catalog: all.catalog, policy: all.policy });
  assert.equal(result.status, "supported");
  assert.equal(result.problems.length, 0);
});

test("en manglende obligatorisk capability afviser skiftet", () => {
  const result = negotiateCapabilities({ source: byId("sqlite-local"), target: byId("mysql-managed"), catalog: all.catalog, policy: all.policy });
  assert.equal(result.status, "unsupported");
  assert.ok(result.problems.some((p) => p.code === "missing_mandatory_capability" && p.capability === "database.row-tenant-isolation"));
});

test("en sikkerhedskritisk nedgradering afvises", () => {
  const result = negotiateCapabilities({ source: byId("object-store-s3"), target: byId("filesystem-local"), catalog: all.catalog, policy: all.policy });
  assert.equal(result.status, "unsupported");
  assert.ok(result.problems.some((p) => p.code === "security_capability_missing" || p.code === "security_downgrade_level"));
});

test("et IAM-skift må ikke nedgradere MFA, agentidentitet eller audit-provenance", () => {
  const result = negotiateCapabilities({ source: byId("keycloak-iam"), target: byId("legacy-ldap-iam"), catalog: all.catalog, policy: all.policy });
  assert.equal(result.status, "unsupported");
  assert.ok(result.problems.some((p) => p.capability === "iam.mfa" || p.capability === "iam.agent-identity" || p.capability === "iam.audit-provenance"));
});

test("en capability under minimumsversionen afvises", () => {
  const target = { ...byId("postgres-managed"), capabilities: { ...byId("postgres-managed").capabilities, "database.tls": { version: "0.0.1", level: "enforced" } } };
  const result = negotiateCapabilities({ source: byId("sqlite-local"), target, catalog: all.catalog, policy: all.policy });
  assert.ok(result.problems.some((p) => p.code === "capability_below_min_version"));
});

test("en ukendt capability afvises", () => {
  const source = { ...byId("sqlite-local"), capabilities: { ...byId("sqlite-local").capabilities, "database.quantum": { version: "1.0.0", level: "enforced" } } };
  const result = negotiateCapabilities({ source, target: byId("postgres-managed"), catalog: all.catalog, policy: all.policy });
  assert.ok(result.problems.some((p) => p.code === "unknown_capability"));
});

test("supportmatricen klassificerer drop-in, planlagt og ikke-understøttet", () => {
  assert.equal(classifySwitch({ source: byId("local-llm"), target: byId("external-llm"), matrix: all.matrix }).mode, "drop-in");
  assert.equal(classifySwitch({ source: byId("sqlite-local"), target: byId("postgres-managed"), matrix: all.matrix }).mode, "planned-migration");
  assert.equal(classifySwitch({ source: byId("nextcloud"), target: byId("bookstack"), matrix: all.matrix }).mode, "unsupported");
});

test("et skift uden en kompatibilitetsrække afvises", () => {
  const result = classifySwitch({ source: byId("filesystem-local"), target: byId("nfs-shared"), matrix: all.matrix });
  assert.equal(result.mode, "unsupported");
  assert.ok(result.problems.some((p) => p.code === "no_compatibility_row"));
});

test("en identisk forbindelsesstreng omgår ikke capability-gaten", () => {
  const sqlite = byId("sqlite-local");
  const cloned = { ...all.providers, providers: all.providers.providers.map((p) => (p.id === "mysql-managed" ? { ...p, connection: { scheme: sqlite.connection.scheme, endpoint: sqlite.connection.endpoint } } : p)) };
  const result = preflight("sqlite-local", "mysql-managed", cloned);
  assert.equal(result.connectionStringMatches, true);
  assert.equal(result.allowed, false);
  assert.ok(result.problems.some((p) => p.code === "missing_mandatory_capability"));
});

test("drop-in-skiftet er tilladt og kræver ikke datamigration", () => {
  const result = preflight("local-llm", "external-llm");
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "drop-in");
  assert.equal(result.requiredMappings.data, false);
  assert.equal(result.requiredMappings.migrationProof, false);
});

test("et planlagt skift kræver mappings, godkendelse og rollback", () => {
  const result = preflight("filesystem-local", "object-store-s3");
  assert.equal(result.allowed, true);
  assert.equal(result.mode, "planned-migration");
  assert.deepEqual(result.requiredMappings, { data: true, ids: true, acl: true, migrationProof: true });
  assert.equal(result.cutover.requiresHumanApproval, true);
  assert.equal(result.cutover.oldProviderReadOnly, true);
  assert.equal(result.cutover.revokeCredentials, true);
});

test("hver fixture peger på en klassificeret kompatibilitetsrække", () => {
  for (const { fixture } of loadSwapFixtures(repoRoot)) {
    const result = preflight(fixture.from, fixture.to);
    assert.equal(result.mode, fixture.mode);
    assert.equal(result.allowed, true);
  }
});
