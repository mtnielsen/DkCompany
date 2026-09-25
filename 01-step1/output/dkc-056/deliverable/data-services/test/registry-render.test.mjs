import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseProfileProblems, dataSourceProblems, dataServiceBindingProblems } from "../../conformance/src/data-services.mjs";
import { loadProfiles, loadSources, loadBindings, checkAll } from "../src/registry.mjs";
import { renderMarkdown, renderHtml } from "../src/render.mjs";

const validSource = () => ({
  apiVersion: "contracts.platform/v1alpha1",
  kind: "DataSource",
  metadata: { name: "src", version: "1.0.0", description: "x", dataOwner: { subject: "oidc|owner", name: "Owner", role: "Data Owner" } },
  sourceType: "hr",
  engine: { family: "postgresql", version: "16.4" },
  connection: { host: "h", port: 5432, database: "d", tls: { mode: "verify-full", minVersion: "1.3" }, secretRef: "vault:secret/data/x#password" },
  access: { readOnly: true, allowedSchemas: ["hr"], allowedTables: ["hr.employees"], denyWrites: true, denyDdl: true },
  tenantBinding: { required: true, source: "principal", strategy: "per-tenant-credential" },
  schemaDiscovery: { enabled: true, includeSchemas: ["hr"] },
  dataOwnership: { owner: { subject: "oidc|owner", name: "Owner", role: "Data Owner" }, classification: "personal", agreementRef: "dpa://x", purpose: "test" },
  externalPolicy: { treatAsOwnDatabase: false, autoMigrate: false, autoBackup: false, scopeAgreementRef: "scope://x" },
  auditTrail: { enabled: true, events: ["connect", "schema-discovery", "query", "denied", "disconnect"], sink: "audit://x" },
});

test("den kanoniske registry er konsistent og validerer", () => {
  assert.deepEqual(checkAll(), []);
  assert.ok(loadProfiles().length >= 2);
  assert.ok(loadSources().length >= 2);
});

test("operatør-UI viser hvem der ejer patching, backup, restore, nøgler og omkostninger", () => {
  const { profiles, sources, bindings } = { profiles: loadProfiles(), sources: loadSources(), bindings: loadBindings() };
  const markdown = renderMarkdown({ profiles, sources, bindings });
  for (const heading of ["Ansvarsmatrix", "Patching", "Backup", "Restore", "Nøgler", "Omkostninger"]) {
    assert.ok(markdown.includes(heading), `mangler '${heading}'`);
  }
  assert.ok(markdown.includes("Ingrid Iversen"));
  assert.ok(renderHtml({ profiles, sources, bindings }).includes("<table>"));
});

test("en rå hemmelighed i stedet for en reference afvises", () => {
  const source = validSource();
  source.connection.secretRef = "vault:secret/data/x#password";
  assert.deepEqual(dataSourceProblems(source), []);
  source.connection.secretRef = "password=hunter2";
  assert.ok(dataSourceProblems(source).some((p) => p.path.includes("secretRef")));
});

test("et wildcard-scope afvises for en HR-kilde", () => {
  const source = validSource();
  source.access.allowedTables = ["*"];
  const problems = dataSourceProblems(source);
  assert.ok(problems.some((p) => p.path.includes("allowedTables")));
});

test("en ekstern kilde kan ikke auto-migreres eller auto-sikkerhedskopieres", () => {
  const source = validSource();
  source.externalPolicy.autoMigrate = true;
  source.externalPolicy.autoBackup = true;
  const problems = dataSourceProblems(source);
  assert.ok(problems.some((p) => p.path.includes("autoMigrate")));
  assert.ok(problems.some((p) => p.path.includes("autoBackup")));
});

test("en BYO-profil kan ikke lægge motordriften på platformen alene", () => {
  const profile = loadProfiles().find((p) => p.data.profileType === "byo").data;
  const patched = structuredClone(profile);
  patched.responsibilityMatrix.backup.owner = "platform";
  const problems = databaseProfileProblems(patched);
  assert.ok(problems.some((p) => p.path.includes("/responsibilityMatrix/backup/owner")));
});

test("en binding må ikke udvide scopet og må ikke tillade migration af eksterne kilder", () => {
  const binding = structuredClone(loadBindings()[0].data);
  binding.externalDataHandling.migrationsAllowed = true;
  assert.ok(dataServiceBindingProblems(binding).some((p) => p.path.includes("migrationsAllowed")));
});

test("en administreret profil uden verificeret restore afvises", () => {
  const profile = structuredClone(loadProfiles().find((p) => p.data.profileType === "managed").data);
  profile.backup.verifiedRestore = false;
  assert.ok(databaseProfileProblems(profile).some((p) => p.path.includes("verifiedRestore")));
});
