import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, contractsDir } from "../src/schemas.mjs";
import {
  backupTargetProblems,
  backupTargetSetProblems,
  externalSourceCoverageProblems,
  validateBackupTarget,
  validateBackupTargetDir,
  validateBackupTargetSet,
  validateBackupTargetSetDir,
} from "../src/backup.mjs";

const examplesDir = join(contractsDir, "examples");
const { ajv } = buildAjv();
const target = JSON.parse(readFileSync(join(examplesDir, "backup-target.object-store.example.json"), "utf8"));
const targetSet = JSON.parse(readFileSync(join(examplesDir, "backup-target-set.example.json"), "utf8"));

test("de committede backupmål- og målsæt-eksempler validerer", () => {
  for (const r of validateBackupTargetDir(examplesDir, ajv)) assert.equal(r.ok, true, `${r.file}: ${JSON.stringify(r.errors)}`);
  for (const r of validateBackupTargetSetDir(examplesDir, ajv)) assert.equal(r.ok, true, `${r.file}: ${JSON.stringify(r.errors)}`);
});

test("et WORM-krav uden verificeret WORM afvises", () => {
  const bad = structuredClone(target);
  bad.retention.immutability.verified = false;
  assert.ok(backupTargetProblems(bad).some((p) => /WORM/.test(p.message)));
});

test("produktion kræver TLS-verifikation og TLS 1.3", () => {
  const bad = structuredClone(target);
  bad.tls.verify = false;
  bad.tls.minVersion = "1.2";
  const problems = backupTargetProblems(bad);
  assert.ok(problems.some((p) => /tls\/verify/.test(p.path)));
  assert.ok(problems.some((p) => /tls\/minVersion/.test(p.path)));
});

test("credentials som rå hemmelighed afvises", () => {
  const bad = structuredClone(target);
  bad.credentialsRef = "password=hemmelig1234567890";
  assert.ok(backupTargetProblems(bad).some((p) => /reference/.test(p.message)));
});

test("et understøttet mål skal være valideret af et navngivet menneske", () => {
  const bad = structuredClone(target);
  bad.support.validatedBy = null;
  assert.ok(backupTargetProblems(bad).some((p) => /valideret af et navngivet menneske/.test(p.message)));
});

test("målsæt med et ikke-godkendt aktivt mål afvises", () => {
  const proposed = { ...structuredClone(target), status: "proposed", approvedBy: null, approvedAt: null };
  const problems = backupTargetSetProblems(targetSet, { targets: [proposed, { metadata: { name: "legacy-nas" }, status: "approved", support: { status: "supported" }, failureDomain: {} }] });
  assert.ok(problems.some((p) => /ikke godkendt/.test(p.message)));
});

test("målsæt i samme eneste fejl-/adgangsdomæne afvises", () => {
  const same = { ...structuredClone(target), failureDomain: { id: "primary-zone-a", accessDomain: "platform-prod-account", region: "eu-west-1" } };
  const problems = backupTargetSetProblems(targetSet, { targets: [same, { metadata: { name: "legacy-nas" }, status: "approved", support: { status: "supported" }, failureDomain: {} }] });
  assert.ok(problems.some((p) => /samme eneste fejl/.test(p.message)));
});

test("owner-backup uden ejer og authorized-platform-backup uden aftale afvises", () => {
  const bad = structuredClone(targetSet);
  bad.externalSources = [
    { sourceRef: "hr-source", handling: "owner-backup", owner: null },
    { sourceRef: "billing-source", handling: "authorized-platform-backup", agreementRef: null },
  ];
  const problems = backupTargetSetProblems(bad);
  assert.ok(problems.some((p) => /navngiven ejer/.test(p.message)));
  assert.ok(problems.some((p) => /scope-aftale/.test(p.message)));
});

test("en ekstern kilde uden håndtering erklæres ikke beskyttet", () => {
  const problems = externalSourceCoverageProblems({ externalSources: [{ sourceRef: "hr-source", handling: "owner-backup", owner: { subject: "oidc|ingrid.iversen", name: "Ingrid Iversen", role: "HR Data Owner" } }] }, [
    { metadata: { name: "hr-source" }, sourceType: "hr", externalPolicy: { scopeAgreementRef: "scope://x" } },
    { metadata: { name: "analytics-source" }, sourceType: "analytics", externalPolicy: { scopeAgreementRef: "scope://y" } },
  ]);
  assert.ok(problems.some((p) => /analytics-source/.test(p)));
});

test("authorized-platform-backup skal matche kildens scope-aftale", () => {
  const problems = externalSourceCoverageProblems({ externalSources: [{ sourceRef: "hr", handling: "authorized-platform-backup", agreementRef: "scope://forkert" }] }, [
    { metadata: { name: "hr" }, sourceType: "hr", externalPolicy: { autoBackup: true, scopeAgreementRef: "scope://rigtig" } },
  ]);
  assert.ok(problems.some((p) => /matcher ikke/.test(p)));
});

test("validateBackupTarget afviser et ugyldigt skema", () => {
  const bad = structuredClone(target);
  delete bad.failureDomain;
  const result = validateBackupTarget(bad, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});
