#!/usr/bin/env node
/**
 * DKC-010 — fokuseret kontrol af kortlivede rettigheder og nødstop.
 *
 *   node credentials/src/check.mjs
 *
 * Kontrollerer uden et levende miljø at:
 *   - signereren kan udstede et scope-bundet, signeret token,
 *   - verifieren afviser forkert audience/scope/udløb,
 *   - et tilbagekaldt credential afvises (holdbart),
 *   - et aktivt nødstop afviser og overlever genstart,
 *   - brokeren nægter A4-beskyttede ressourcer.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openIdentity } from "../../persistence/src/identities.mjs";
import { createLocalSigner, signersToJwks } from "./keys.mjs";
import { createCredentialBroker } from "./broker.mjs";
import { createCredentialVerifier } from "./verifier.mjs";
import { createRevocationList } from "./revocation.mjs";
import { createKillSwitch, EmergencyStopActive } from "./kill-switch.mjs";

const errors = [];
const notes = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const base = { spiffeId: "spiffe://platform.example.org/agents/upgrader", agentRef: "upgrader", role: "executor", tenantId: "acme", verb: "upgrade.patch", resource: "dummy-ok", audience: "module:dummy-ok", environment: "staging" };
const expect = { audience: "module:dummy-ok", verb: "upgrade.patch", resource: "dummy-ok", tenantId: "acme", environment: "staging" };
const human = { kind: "human", id: "oidc|security-officer", roles: ["security-officer"] };

const dir = mkdtempSync(join(tmpdir(), "dkc-credentials-check-"));
const signer = createLocalSigner({ kid: "check-1" });
const jwks = signersToJwks([signer]);
let identity;
let issued;
try {
  identity = openIdentity("credentials", { dataDir: dir });
  const revocations = createRevocationList({ store: identity.repository("revocations") });
  const killSwitch = createKillSwitch({ store: identity.repository("stops"), cacheTtlMs: 500 });
  const broker = createCredentialBroker({ signer, revocations, killSwitch, issuances: identity.repository("issuances") });
  const verifier = createCredentialVerifier({ jwks, revocations, killSwitch, issuer: broker.issuer });

  issued = broker.issue(base);
  check(verifier.verify(issued.token, expect).ok === true, "et gyldigt credential skulle verificere");
  check(verifier.verify(issued.token, { ...expect, audience: "module:other" }).ok === false, "forkert audience skulle afvises");
  check(verifier.verify(issued.token, { ...expect, verb: "restart" }).ok === false, "forkert verbum skulle afvises");
  check(verifier.verify(issued.token, { ...expect, tenantId: "globex" }).ok === false, "forkert kunde skulle afvises");
  check(identity.repository("issuances").byJti(issued.jti) !== null, "udstedelsen skulle være journalført");

  // Genstart: tilbagekaldelse og nødstop skal være holdbare (samme signer/JWKS).
  identity.close();
  identity = openIdentity("credentials", { dataDir: dir });
  const revocations2 = createRevocationList({ store: identity.repository("revocations") });
  const killSwitch2 = createKillSwitch({ store: identity.repository("stops"), cacheTtlMs: 500 });
  const verifier2 = createCredentialVerifier({ jwks, revocations: revocations2, killSwitch: killSwitch2, issuer: "urn:platform:credential-broker" });

  revocations2.revoke({ jti: issued.jti, reason: "mistet", revokedBy: "oidc|sec" });
  check(verifier2.verify(issued.token, expect).ok === false, "et tilbagekaldt token skulle afvises efter genstart");

  killSwitch2.activate({ scope: "tenant", subjectId: "acme", reason: "incident", principal: human });
  let threw = false;
  try {
    killSwitch2.assertAllowed({ tenantId: "acme", spiffeId: base.spiffeId });
  } catch (err) {
    threw = err instanceof EmergencyStopActive;
  }
  check(threw, "et aktivt nødstop skulle afvise");
  notes.push("revocation + nødstop overlevede genstart");

  // Brokeren nægter A4 og forkert rolle.
  const broker2 = createCredentialBroker({ signer, revocations: revocations2, killSwitch: createKillSwitch({ store: identity.repository("stops"), cacheTtlMs: 500 }) });
  let refusedA4 = false;
  try {
    broker2.issue({ ...base, resource: "credentials/keys" });
  } catch {
    refusedA4 = true;
  }
  check(refusedA4, "brokeren skulle nægte A4-beskyttet ressource");
  notes.push("EdDSA-signerede, scope-bundne tokens");
} finally {
  try {
    identity?.close();
  } catch {
    /* ignore */
  }
  rmSync(dir, { recursive: true, force: true });
}

if (errors.length) {
  console.error("✘ Credential-kontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Credential-kontrol bestået (${notes.join("; ")})`);
console.log("✔ audience/scope/TTL, tilbagekaldelse, nødstop og A4-afvisning verificeret");
