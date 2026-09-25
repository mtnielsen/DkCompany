/**
 * DKC-004 — autentiske godkendelser bundet til ændringen.
 *
 * Konformanstestene efterprøver de fem acceptkriterier mod den rigtige
 * approval-service og den fælles identitetsverifikation fra DKC-003:
 *
 *   1. Oprettelse med approved-state afvises
 *   2. Samme person kan ikke tælle som to godkendere
 *   3. Forfalskede grupper og kursusbeviser afvises
 *   4. Ændret diff, tenant, mål eller parametre ugyldiggør godkendelsen
 *   5. Afvist, udløbet eller tilbagekaldt beslutning kan ikke anvendes
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { createApprovalService } from "../../approvals/src/approval-service.mjs";
import { computeBindingDigest } from "../../approvals/src/binding.mjs";
import { createPlatformAuthenticator } from "../../identity/src/identity.mjs";
import { signJwt } from "../../identity/src/jwt.mjs";

const approvalExample = JSON.parse(readFileSync(new URL("../../contracts/examples/approval-request.example.json", import.meta.url), "utf8"));
const TRAINING = ["evidence-over-prose", "when-to-reject"];
const NOW = Date.parse("2025-09-02T00:00:00Z");

const human = (id, groups = ["platform-approvers"], extra = {}) => ({ kind: "human", id, tenantId: "acme", groups, ...extra });
const cloneExample = () => structuredClone(approvalExample);

function serviceWith({ training = () => TRAINING, policy } = {}) {
  const state = { now: NOW };
  const service = createApprovalService({ trainingRegistry: training, approvalPolicy: policy, clock: () => state.now });
  return { service, state };
}

/** Kør et helt forløb frem til `approved` med to unikke godkendere. */
function approveWithTwo(service) {
  const req = service.create(cloneExample());
  service.decide(req.id, { principal: human("oidc|approver.one"), verdict: "approve" });
  service.decide(req.id, { principal: human("oidc|approver.two"), verdict: "approve" });
  return req;
}

/* -------------------------------------------------------------------------- */
/* 1. Oprettelse med approved-state afvises                                   */
/* -------------------------------------------------------------------------- */
test("1. oprettelse med approved-state afvises", () => {
  const { service } = serviceWith();
  const payload = cloneExample();
  payload.decision.state = "approved";
  assert.throws(() => service.create(payload), (err) => err.status === 400 && /pending/.test(err.message));

  const rejected = cloneExample();
  rejected.decision.state = "rejected";
  assert.throws(() => service.create(rejected), (err) => err.status === 400);
});

test("1b. oprettelse med medsendte godkendelser afvises", () => {
  const { service } = serviceWith();
  const payload = cloneExample();
  payload.decision.approvals = [{ subject: "oidc|forged", at: "2025-09-01T00:00:00Z", verdict: "approve" }];
  assert.throws(() => service.create(payload), (err) => err.status === 400 && /godkendelser/.test(err.message));
});

test("1c. serveren overskriver klientens binding og sætter egen pending-tilstand", () => {
  const { service } = serviceWith();
  const payload = cloneExample();
  payload.decision.state = "pending";
  payload.decision.binding = { algorithm: "sha256", digest: "f".repeat(64) };
  const req = service.create(payload);
  assert.equal(req.decision.state, "pending");
  assert.notEqual(req.decision.binding.digest, "f".repeat(64));
  assert.equal(req.decision.binding.digest, computeBindingDigest(req));
});

/* -------------------------------------------------------------------------- */
/* 2. Samme person kan ikke tælle som to godkendere                            */
/* -------------------------------------------------------------------------- */
test("2. samme person kan ikke godkende to gange", () => {
  const { service } = serviceWith();
  const req = service.create(cloneExample());
  service.decide(req.id, { principal: human("oidc|same.person"), verdict: "approve" });
  assert.throws(
    () => service.decide(req.id, { principal: human("oidc|same.person"), verdict: "approve" }),
    (err) => err.status === 409 && /samme person/.test(err.message)
  );
  assert.equal(service.mergeCheck(req.id).mergeable, false, "én unik godkender er ikke nok til to");
  assert.equal(req.decision.approvals.length, 1);
});

/* -------------------------------------------------------------------------- */
/* 3. Forfalskede grupper og kursusbeviser afvises                            */
/* -------------------------------------------------------------------------- */
test("3. klientens gruppepåstand ignoreres — verificeret gruppe er afgørende", () => {
  const { service } = serviceWith();
  const req = service.create(cloneExample());
  // Identiteten er ikke i approver-gruppen, men påstår det i payloaden.
  assert.throws(
    () => service.decide(req.id, { principal: human("oidc|outsider", ["random-group"]), groups: ["platform-approvers"], verdict: "approve" }),
    (err) => err.status === 403 && /gruppe/.test(err.message)
  );
});

test("3b. klientens kursusbevis ignoreres — serverens træningsopslag er afgørende", () => {
  const { service } = serviceWith({ training: () => [] });
  const req = service.create(cloneExample());
  assert.throws(
    () => service.decide(req.id, { principal: human("oidc|liar"), completedTrainingModules: TRAINING, verdict: "approve" }),
    (err) => err.status === 428 && /træningsmoduler/.test(err.message)
  );
});

test("3c. uverificeret eller agent-identitet kan ikke godkende", () => {
  const { service } = serviceWith();
  const req = service.create(cloneExample());
  assert.throws(() => service.decide(req.id, { verdict: "approve" }), (err) => err.status === 401);
  assert.throws(
    () => service.decide(req.id, { principal: { kind: "agent", id: "spiffe://platform/agent" }, verdict: "approve" }),
    (err) => err.status === 403
  );
});

/* -------------------------------------------------------------------------- */
/* 4. Ændret diff, tenant, mål eller parametre ugyldiggør godkendelsen        */
/* -------------------------------------------------------------------------- */
test("4. ændret diff ugyldiggør godkendelsen", () => {
  const { service } = serviceWith();
  const req = approveWithTwo(service);
  assert.equal(service.mergeCheck(req.id).mergeable, true);

  service.amend(req.id, { change: { diff: { ...req.change.diff, sha256: "a".repeat(64) } } });
  assert.equal(req.decision.state, "pending", "ændringen nulstiller til pending");
  assert.equal(req.decision.approvals.length, 0, "tidligere godkendelser ryddes");
  assert.equal(service.mergeCheck(req.id).mergeable, false);
});

test("4b. ændret tenant ugyldiggør godkendelsen", () => {
  const { service } = serviceWith();
  const req = approveWithTwo(service);
  service.amend(req.id, { tenantId: "globex" });
  assert.equal(service.mergeCheck(req.id).mergeable, false);
  assert.equal(req.decision.state, "pending");
});

test("4c. ændret mål ugyldiggør godkendelsen", () => {
  const { service } = serviceWith();
  const req = approveWithTwo(service);
  service.amend(req.id, { change: { targets: ["another-service"] } });
  assert.equal(service.mergeCheck(req.id).mergeable, false);
});

test("4d. ændrede parametre ugyldiggør godkendelsen", () => {
  const { service } = serviceWith();
  const req = approveWithTwo(service);
  service.amend(req.id, { change: { parameters: { ...req.change.parameters, to: "9.9.9" } } });
  assert.equal(service.mergeCheck(req.id).mergeable, false);
});

test("4e. ændret policy-bundle-version ugyldiggør godkendelsen", () => {
  const { service } = serviceWith();
  const req = approveWithTwo(service);
  service.amend(req.id, { evidence: { policyEvaluation: { ...req.evidence.policyEvaluation, bundleVersion: "2099.01.01.1" } } });
  assert.equal(service.mergeCheck(req.id).mergeable, false);
});

test("4f. en godkender med en forkert digest afvises, og godkendelsen ugyldiggøres", () => {
  const { service } = serviceWith();
  const req = service.create(cloneExample());
  assert.throws(
    () => service.decide(req.id, { principal: human("oidc|a"), verdict: "approve", changeDigest: "b".repeat(64) }),
    (err) => err.status === 409 && /binding-mismatch/.test(err.message)
  );
  assert.equal(req.decision.approvals.length, 0);
});

/* -------------------------------------------------------------------------- */
/* 5. Afvist, udløbet eller tilbagekaldt beslutning kan ikke anvendes         */
/* -------------------------------------------------------------------------- */
test("5a. en afvist beslutning kan ikke anvendes", () => {
  const { service } = serviceWith();
  const req = service.create(cloneExample());
  service.decide(req.id, { principal: human("oidc|rejecter"), verdict: "reject", comment: "utilstrækkelig evidens" });
  assert.equal(req.decision.state, "rejected");
  assert.equal(service.mergeCheck(req.id).mergeable, false);
  assert.throws(() => service.decide(req.id, { principal: human("oidc|approver.one"), verdict: "approve" }), (err) => err.status === 409);
});

test("5b. en udløbet beslutning kan ikke anvendes", () => {
  const { service, state } = serviceWith();
  const req = service.create(cloneExample());
  service.decide(req.id, { principal: human("oidc|approver.one"), verdict: "approve" });
  service.decide(req.id, { principal: human("oidc|approver.two"), verdict: "approve" });
  assert.equal(service.mergeCheck(req.id).mergeable, true);

  state.now = Date.parse(req.decision.expiresAt) + 1000;
  assert.equal(service.get(req.id).decision.state, "expired");
  const merge = service.mergeCheck(req.id);
  assert.equal(merge.mergeable, false);
  assert.ok(merge.reasons.some((r) => /udløbet/.test(r)));
});

test("5c. en tilbagekaldt beslutning kan ikke anvendes", () => {
  const { service } = serviceWith();
  const req = approveWithTwo(service);
  const revoked = service.revoke(req.id, { principal: human("oidc|security", ["security-officer"]), reason: "mistanke om kompromittering" });
  assert.equal(revoked.decision.state, "revoked");
  assert.equal(revoked.decision.revokedBy, "oidc|security");
  assert.equal(service.mergeCheck(req.id).mergeable, false);
  assert.throws(() => service.decide(req.id, { principal: human("oidc|approver.three"), verdict: "approve" }), (err) => err.status === 409);
});

test("5d. kun politikudpegede roller må tilbagekalde", () => {
  const { service } = serviceWith();
  const req = approveWithTwo(service);
  assert.throws(
    () => service.revoke(req.id, { principal: human("oidc|approver.one") }),
    (err) => err.status === 403 && /tilbagekalde/.test(err.message)
  );
  assert.equal(service.mergeCheck(req.id).mergeable, true, "uautoriseret tilbagekaldelse må ikke ændre tilstanden");
});

/* -------------------------------------------------------------------------- */
/* 6. Selv-godkendelse efter rollepolitik                                     */
/* -------------------------------------------------------------------------- */
test("6. anmoderen kan ikke godkende sin egen ændring", () => {
  const { service } = serviceWith();
  const req = service.create(cloneExample(), { principal: human("oidc|requester") });
  assert.equal(req.decision.requestedBy, "oidc|requester");
  assert.throws(
    () => service.decide(req.id, { principal: human("oidc|requester"), verdict: "approve" }),
    (err) => err.status === 403 && /selv-godkendelse/.test(err.message)
  );
});

/* -------------------------------------------------------------------------- */
/* 7. Verificeret identitet gennem DKC-003 (HTTP)                             */
/* -------------------------------------------------------------------------- */
const OIDC_ISSUER = "https://idp.test";
const OIDC_AUDIENCE = "platform";
const { publicKey: OIDC_PUBLIC_KEY, privateKey: OIDC_PRIVATE_KEY } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const OIDC_JWK = { ...OIDC_PUBLIC_KEY.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

function tokenFor(sub, groups) {
  return signJwt(
    { sub, tenant_id: "acme", groups, roles: [], iss: OIDC_ISSUER, aud: OIDC_AUDIENCE },
    { alg: "RS256", key: OIDC_PRIVATE_KEY, kid: "test-key" }
  );
}

function httpService() {
  const authenticator = createPlatformAuthenticator({
    oidc: { jwks: { keys: [OIDC_JWK] }, issuer: OIDC_ISSUER, audience: OIDC_AUDIENCE },
    profile: "test",
  });
  const service = createApprovalService({ authenticator, trainingRegistry: () => TRAINING, clock: () => NOW });
  return service;
}

test("7. kun et gyldigt, berettiget OIDC-token kan godkende over HTTP", async (t) => {
  const service = httpService();
  const requesterToken = tokenFor("oidc|requester", ["platform-approvers"]);
  const approverToken = tokenFor("oidc|approver.one", ["platform-approvers"]);
  const outsiderToken = tokenFor("oidc|outsider", ["random-group"]);

  const port = await service.listen(0);
  t.after(() => service.close());
  const base = `http://127.0.0.1:${port}`;

  // Opret med en verificeret anmoder.
  const created = await fetch(`${base}/v1/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify(cloneExample()),
  });
  assert.equal(created.status, 201);
  const req = await created.json();
  assert.equal(req.decision.requestedBy, "oidc|requester");

  // Uden token afvises.
  const anonymous = await fetch(`${base}/v1/approvals/${req.id}/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verdict: "approve" }),
  });
  assert.equal(anonymous.status, 401);

  // Berettiget token godkender.
  const approved = await fetch(`${base}/v1/approvals/${req.id}/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${approverToken}` },
    body: JSON.stringify({ verdict: "approve" }),
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).decision.approvals.length, 1);

  // Token uden den rette gruppe afvises, selvom headeren påstår noget andet.
  const denied = await fetch(`${base}/v1/approvals/${req.id}/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${outsiderToken}`, "x-forwarded-groups": "platform-approvers" },
    body: JSON.stringify({ verdict: "approve" }),
  });
  assert.equal(denied.status, 403);
});
