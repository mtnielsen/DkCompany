#!/usr/bin/env node
/**
 * DKC-045 — signér en runbook med en nøgle fra miljøet.
 *
 *   RUNBOOK_SIGNING_KEY=... node runbooks/sign.mjs runbooks/min-runbook.json [keyId]
 *
 * Skriver den signerede runbook til stdout. Nøglen læses udelukkende fra
 * miljøet og logges eller gemmes aldrig. I produktion kommer nøglen fra KMS/HSM,
 * ikke fra en fil. Uden `RUNBOOK_SIGNING_KEY` afvises kaldet (NOT RUN) i stedet
 * for at signere med en tavs standardnøgle.
 */
import { readFileSync } from "node:fs";
import { signRunbook, verifyRunbookSignature, runbookDigest } from "../approvals/src/runbook.mjs";

const [, , input, keyId = "runbook-signing"] = process.argv;
if (!input) {
  console.error("Brug: RUNBOOK_SIGNING_KEY=... node runbooks/sign.mjs <runbook.json> [keyId]");
  process.exit(2);
}
const secret = process.env.RUNBOOK_SIGNING_KEY;
if (!secret) {
  console.error("RUNBOOK_SIGNING_KEY er ikke sat — nægter at signere med en tavs standardnøgle.");
  process.exit(3);
}

const runbook = JSON.parse(readFileSync(input, "utf8"));
const signed = signRunbook(runbook, { keyId, secret });
const verified = verifyRunbookSignature(signed, { [keyId]: secret });
if (!verified.ok) {
  console.error(`Signeringen kunne ikke verificeres: ${verified.reason}`);
  process.exit(1);
}
process.stdout.write(JSON.stringify(signed, null, 2) + "\n");
console.error(`✔ signeret ${signed.metadata?.name}@${signed.metadata?.version} med '${keyId}' (digest ${runbookDigest(signed).slice(0, 12)}…)`);
