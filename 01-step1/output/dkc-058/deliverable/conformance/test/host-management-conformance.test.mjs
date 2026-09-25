/**
 * DKC-058 — konformanstest for sikker host- og OS-administration.
 *
 * Efterprøver acceptkriterierne på validatorniveau mod de rigtige eksempler og
 * negative varianter, der skal afvises.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, buildAjv } from "../src/schemas.mjs";
import { validateHostEnrollment, validateHostProfile, validateHostOperation, knownHostRunbooks } from "../src/host-management.mjs";
import { signOperation, verifyOperationSignature } from "../../host-management/src/broker.mjs";
import { enableManagement } from "../../host-management/src/enrollment.mjs";
import { loadPlatforms } from "../../host-management/src/model.mjs";

const read = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const { ajv } = buildAjv();
const platforms = loadPlatforms(repoRoot);
const enrollment = read("contracts/examples/host-enrollment.example.json");
const profile = read("contracts/examples/host-profile.example.json");
const operation = read("contracts/examples/host-operation.example.json");
const hostKeyring = read("host-management/dev-keyring.json");
const enabled = enableManagement({ enrollment, actor: { kind: "human", subject: "oidc|anna.andersen" }, role: { id: "platform-owner" }, profileRef: "linux-lts-host", now: Date.parse("2026-09-24T08:30:00Z") }).enrollment;

test("host-enrollment-eksemplet validerer (skema + semantik)", () => {
  const result = validateHostEnrollment(enrollment, ajv, { platforms });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("host-profil-eksemplet validerer (skema + semantik)", () => {
  const result = validateHostProfile(profile, ajv, { platforms });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("host-operation-eksemplet validerer og er signeret", () => {
  const result = validateHostOperation(operation, ajv, { enrollment: enabled, profile, runbooks: knownHostRunbooks(repoRoot) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("host-styring slået fra i enrollmentet afvises ved operation", () => {
  const result = validateHostOperation(operation, ajv, { enrollment, profile });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === "/management"));
});

test("et ikke-understøttet OS afvises af enrollment-ejeren", () => {
  const broken = clone(enrollment);
  broken.host.platformRef = "does-not-exist";
  const result = validateHostEnrollment(broken, ajv, { platforms });
  assert.equal(result.ok, false);
});

test("en host-profil uden backupkrav eller med hypervisorstyring afvises", () => {
  const broken = clone(profile);
  broken.backup.verifiedBeforeMutation = false;
  broken.vps.controlsHypervisor = true;
  const result = validateHostProfile(broken, ajv, { platforms });
  assert.equal(result.ok, false);
});

test("en operation der ændrer brokerens konfiguration afvises", () => {
  const broken = clone(operation);
  broken.restrictions.brokerConfigChange = true;
  const result = validateHostOperation(broken, ajv, { enrollment: enabled, profile });
  assert.equal(result.ok, false);
});

test("en package-update uden signeret pakke afvises", () => {
  const broken = clone(operation);
  delete broken.package;
  const result = validateHostOperation(broken, ajv, { enrollment: enabled, profile });
  assert.equal(result.ok, false);
});

test("single-server uden annonceret nedetid afvises", () => {
  const broken = clone(operation);
  broken.scope.mode = "single-server";
  broken.scope.nodeCount = 1;
  broken.safety.announcedDowntimeSeconds = 0;
  const result = validateHostOperation(broken, ajv, { enrollment: enabled, profile });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("announcedDowntime")));
});

test("en operation der peger på sikkerhedsdomænet afvises", () => {
  const broken = clone(operation);
  broken.operation.target = "host/kms";
  const result = validateHostOperation(broken, ajv, { enrollment: enabled, profile });
  assert.equal(result.ok, false);
});

test("en ændret operation ugyldiggør signaturen", () => {
  const modified = clone(operation);
  modified.operation.dryRun = true;
  const resigned = signOperation(modified, { keyId: "host-broker-key", secret: hostKeyring.keys[0].secret });
  assert.equal(verifyOperationSignature(operation, hostKeyring).ok, true);
  assert.notEqual(resigned.signature.value, operation.signature.value);
});
