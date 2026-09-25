/**
 * DKC-018 — accepttests for adskillelsen mellem kontraktchecks, integration og
 * driftsbevis.
 *
 * Dækker:
 *   - evidensposter bærer mode, commit, image-digest, miljø, upstream-version,
 *     run-ID og udløb og validerer mod kontrakten,
 *   - et fixture-only-sæt kan ikke få produktionsbadge,
 *   - udløbet eller forkert image-/commit-bundet evidens afvises,
 *   - en manuel redigering af PASS i JSON accepteres ikke (digest brudt),
 *   - en frakoblet PDP blokerer den faktiske mutation (dødemandsgreb),
 *   - direkte endpoints afviser kald uden verificeret identitet (negativ
 *     bypass-test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildAjv } from "../src/schemas.mjs";
import {
  validateEvidenceRecord,
  evidenceRecordProblems,
  assessRecord,
  productionBadge,
  verifyReleaseEvidence,
  sealRecord,
  signRecord,
  verifyRecordSignature,
  recordDigest,
  PRODUCTION_MODES,
} from "../src/evidence-mode.mjs";
import { createAgentRuntime } from "../../runtime/src/runtime.mjs";
import { createMemoryAuditLog, GovernanceUnavailable } from "../../runtime/src/clients.mjs";
import { createWorkloadVerifier, principalAssertion } from "../../identity/src/identity.mjs";
import { resolveIngressPrincipal } from "../../gateway/src/ingress.mjs";
import { generateKeyPair } from "../../supply-chain/src/signature.mjs";

const ajv = buildAjv().ajv;
const NOW = Date.parse("2026-09-23T09:00:00Z");
const COMMIT = "a".repeat(40);
const IMAGE = `sha256:${"1".repeat(64)}`;

function record(overrides = {}) {
  return sealRecord({
    apiVersion: "contracts.platform/v1alpha1",
    kind: "EvidenceRecord",
    id: `evidence-${randomUUID().slice(0, 8)}`,
    subject: { kind: "verb", name: "dummy-ok", verb: "backup" },
    mode: "runtime",
    result: "pass",
    commit: COMMIT,
    imageDigest: IMAGE,
    environment: "staging",
    upstreamVersion: "dummy-ok@1.2.0",
    runId: "run-1",
    capturedAt: "2026-09-23T08:00:00Z",
    expiresAt: "2026-10-23T08:00:00Z",
    producer: { type: "runtime", name: "runtime", subject: "spiffe://platform.example.org/modules/dummy-ok" },
    command: ["probe", "GET", "https://dummy-ok.example.org/ops/backup"],
    artifact: { uri: "evidence/generated/backup.evidence.json", sha256: "2".repeat(64) },
    ...overrides,
  });
}

/* --- Kontrakt og positivt bevis ----------------------------------------- */

test("evidenseksemplet validerer mod skema og semantik", () => {
  const example = JSON.parse(readFileSync(new URL("../../contracts/examples/evidence-record.example.json", import.meta.url), "utf8"));
  assert.equal(example.digest, recordDigest(example));
  const result = validateEvidenceRecord(example, ajv, { now: Date.parse(example.capturedAt) + 1000 });
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
});

test("en frisk, bundet integration/runtime-post er gyldig", () => {
  const r = record();
  assert.deepEqual(evidenceRecordProblems(r, { now: NOW, expected: { commit: COMMIT, imageDigest: IMAGE, environment: "staging", modes: PRODUCTION_MODES } }), []);
  assert.equal(assessRecord(r, { now: NOW, expected: { commit: COMMIT, imageDigest: IMAGE, environment: "staging" } }).status, "eligible");
});

/* --- Fixture-only må ikke blive produktion ------------------------------- */

test("fixture-only-sæt kan ikke få produktionsbadge", () => {
  const fixture = record({ mode: "fixture", imageDigest: null });
  const badge = productionBadge({ requirements: [{ id: "REQ-BACKUP" }], records: [fixture], now: NOW, expected: { commit: COMMIT, environment: "staging" } });
  assert.equal(badge.productionReady, false);
  assert.equal(badge.badge, "fixture-only");
  assert.equal(badge.coverage[0].eligible.length, 0);
  assert.match(badge.reasons.join(" "), /kun fixture.*bevis/i);
});

test("contraktcheck alene kan heller ikke give produktionsbadge", () => {
  const contract = record({ mode: "contract" });
  const badge = productionBadge({ requirements: [{ id: "REQ-BACKUP" }], records: [contract], now: NOW, expected: { commit: COMMIT, environment: "staging" } });
  assert.equal(badge.productionReady, false);
  assert.equal(badge.badge, "fixture-only");
});

test("et integration/runtime-bevis pr. krav giver produktionsbadge", () => {
  const records = [
    record({ id: "runtime-backup", subject: { kind: "verb", name: "dummy-ok", verb: "backup" } }),
    record({ id: "integration-restore", subject: { kind: "verb", name: "dummy-ok", verb: "restore" } }),
  ];
  const badge = productionBadge({
    requirements: [
      { id: "REQ-BACKUP", subject: { name: "dummy-ok", verb: "backup" } },
      { id: "REQ-RESTORE", subject: { name: "dummy-ok", verb: "restore" } },
    ],
    records,
    now: NOW,
    expected: { commit: COMMIT, environment: "staging" },
  });
  assert.equal(badge.badge, "production");
  assert.equal(badge.productionReady, true);
});

/* --- Udløb og forkert binding ------------------------------------------- */

test("udløbet evidens afvises", () => {
  const expired = record({ expiresAt: "2026-08-01T00:00:00Z" });
  const problems = evidenceRecordProblems(expired, { now: NOW });
  assert.ok(problems.some((p) => p.path === "/expiresAt" && /udløb/.test(p.message)));
  assert.equal(assessRecord(expired, { now: NOW }).status, "expired");
});

test("fremtidsdateret evidens afvises", () => {
  const future = record({ capturedAt: "2027-01-01T00:00:00Z", expiresAt: "2027-02-01T00:00:00Z" });
  const problems = evidenceRecordProblems(future, { now: NOW });
  assert.ok(problems.some((p) => p.path === "/capturedAt" && /fremtiden/.test(p.message)));
});

test("forkert image-digest afvises", () => {
  const wrong = record({ imageDigest: `sha256:${"9".repeat(64)}` });
  const problems = evidenceRecordProblems(wrong, { now: NOW, expected: { imageDigest: IMAGE } });
  assert.ok(problems.some((p) => p.path === "/imageDigest"));
  assert.equal(assessRecord(wrong, { now: NOW, expected: { imageDigest: IMAGE } }).status, "wrong-artifact");
});

test("forkert commit/miljø/upstream afvises", () => {
  const wrong = record({ commit: "b".repeat(40) });
  assert.equal(assessRecord(wrong, { now: NOW, expected: { commit: COMMIT } }).status, "wrong-artifact");
  const wrongEnv = record({ environment: "prod" });
  assert.equal(assessRecord(wrongEnv, { now: NOW, expected: { environment: "staging" } }).status, "wrong-artifact");
  const wrongUpstream = record({ upstreamVersion: "dummy-ok@1.1.0" });
  assert.ok(evidenceRecordProblems(wrongUpstream, { now: NOW, expected: { upstreamVersion: "dummy-ok@1.2.0" } }).some((p) => p.path === "/upstreamVersion"));
});

/* --- Manuel redigering af PASS ------------------------------------------ */

test("en manuel redigering af result til pass afvises (digest brudt)", () => {
  const failing = record({ result: "fail" });
  const tampered = { ...failing, result: "pass" };
  assert.notEqual(recordDigest(tampered), failing.digest);
  const problems = evidenceRecordProblems(tampered, { now: NOW });
  assert.ok(problems.some((p) => p.path === "/digest" && /ændret manuelt/.test(p.message)));
  assert.equal(assessRecord(tampered, { now: NOW }).status, "tampered");
});

/* --- Signatur ----------------------------------------------------------- */

test("en signeret post verificeres, og en ændret post afvises", () => {
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  const signed = signRecord(privateKeyPem, record());
  assert.equal(verifyRecordSignature(signed, { [signed.signature.keyId]: publicKeyPem }).ok, true);
  assert.deepEqual(evidenceRecordProblems(signed, { now: NOW, trustKeys: { [signed.signature.keyId]: publicKeyPem } }), []);
  // Enhver ændring af digesten (eller af indholdet, som efterlader digesten
  // uændret) opdages: digesten er bundet til indholdet, signaturen til digesten.
  const tampered = { ...signed, digest: "f".repeat(64) };
  assert.equal(verifyRecordSignature(tampered, { [signed.signature.keyId]: publicKeyPem }).ok, false);
  const edited = { ...signed, environment: "prod" };
  assert.ok(evidenceRecordProblems(edited, { now: NOW }).some((p) => p.path === "/digest"));
});

test("release uden integration/runtime-evidens accepteres ikke", () => {
  const fixture = record({ mode: "fixture" });
  const result = verifyReleaseEvidence({ requirements: [{ id: "REQ-BACKUP" }], records: [fixture], now: NOW, expected: { commit: COMMIT, environment: "staging" } });
  assert.equal(result.accepted, false);
  assert.equal(result.badge, "fixture-only");
});

/* --- Frakoblet PDP blokerer mutation ------------------------------------ */

const baseManifest = JSON.parse(readFileSync(new URL("../../modules/dummy-ok/agents/backup-agent.json", import.meta.url), "utf8"));

test("frakoblet PDP blokerer den faktiske mutation", async () => {
  const executed = [];
  const runtime = createAgentRuntime({
    manifest: structuredClone(baseManifest),
    pdp: { decide: async () => { throw new GovernanceUnavailable("PDP utilgængelig: ECONNREFUSED"); } },
    auditLog: createMemoryAuditLog(),
    executors: { "observe.read": async () => { executed.push("observe.read"); return { summary: "read" }; } },
  });
  const result = await runtime.runTask({
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: randomUUID(),
    tenantId: "acme",
    agentRef: "dummy-ok-upgrader",
    objective: "dkc-018 pdp-outage",
    actions: [{ verb: "observe.read", target: "dummy-ok", environment: "staging", evidence: ["policy-allow"] }],
  });
  assert.equal(result.status, "halted");
  assert.match(result.reason, /governance utilgængelig/);
  assert.deepEqual(executed, [], "executor må ikke kaldes når PDP er frakoblet");
});

/* --- Direkte endpoints (negativ bypass) --------------------------------- */

test("direkte endpoint-kald uden verificeret identitet afvises", () => {
  const now = () => 1_700_000_000_000;
  const verifier = createWorkloadVerifier({ trustDomain: "platform.example.org", trustedProxies: ["10.0.0.1"], proxySecret: "s3cret", now });
  // Direkte kald fra en utillidtværdig adresse med en klientleveret principal.
  assert.throws(
    () => verifier.verify({ remoteAddress: "203.0.113.9", headers: { "x-platform-principal": "human|anna|acme|admin|9999999999|forfalsket" } }),
    /utillidtværdig adresse/
  );
  // Rå x-spiffe-id er ikke identitet.
  assert.throws(() => verifier.verify({ remoteAddress: "203.0.113.9", headers: { "x-spiffe-id": "spiffe://platform.example.org/modules/evil" } }), /manglende verificerbar/);
  // Gennem den betroede proxy virker den signerede assertion.
  const assertion = principalAssertion({ kind: "human", id: "anna", tenantId: "acme", roles: ["admin"] }, { secret: "s3cret", now });
  const principal = verifier.verify({ remoteAddress: "10.0.0.1", headers: { "x-platform-principal": assertion } });
  assert.equal(principal.id, "anna");
  assert.equal(principal.tenantId, "acme");
});

test("gatewayens ingress afviser manglende token (default-deny)", async () => {
  await assert.rejects(() => resolveIngressPrincipal({ headers: {}, oidc: null }), /ingen verificerbar identitet/);
});
