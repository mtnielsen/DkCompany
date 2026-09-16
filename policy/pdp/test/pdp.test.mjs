import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPdp, loadBundle, defaultBundleDir, defaultTrustedKeys } from "../src/pdp.mjs";

const agent = (autonomyClass) => ({
  principal: {
    kind: "agent",
    id: "spiffe://platform.example.org/agents/x",
    spiffeId: "spiffe://platform.example.org/agents/x",
    autonomyClass,
  },
  action: { verb: "upgrade", target: "dummy-ok", environment: "staging", autonomyClass },
  context: { tenantId: "acme", evidence: ["policy-allow", "tests-pass", "dry-run-clean", "rollback-tested"] },
});

test("upgrade kræver to godkendelser og rollback-bevis", () => {
  const pdp = createPdp();
  const decision = pdp.decide(agent("A3"));
  assert.equal(decision.decision, "allow-with-approval");
  assert.equal(decision.requiredApprovals, 2);
  assert.ok(decision.requiredEvidence.includes("rollback-tested"));
  assert.deepEqual(decision.matchedRules, ["ops.upgrade.requires-approval"]);
  assert.match(decision.pdp.bundleSha256, /^[a-f0-9]{64}$/);
});

test("default er deny (fail-closed) og bærer en begrundelse", () => {
  const pdp = createPdp();
  const decision = pdp.decide({
    principal: { kind: "human", id: "oidc|a" },
    action: { verb: "delete-everything", target: "dummy-ok", environment: "prod" },
  });
  assert.equal(decision.decision, "deny");
  assert.deepEqual(decision.matchedRules, []);
  assert.ok(decision.reasons.length >= 1);
});

test("A0/A1-agent i produktion afvises af guardrail", () => {
  const pdp = createPdp();
  const input = agent("A1");
  input.action.environment = "prod";
  const decision = pdp.decide(input);
  assert.equal(decision.decision, "deny");
  assert.ok(decision.matchedRules.includes("guardrails.prod-requires-a2-or-human"));
});

test("guardrail kan ikke overrules: policy-bundle er A4", () => {
  const pdp = createPdp();
  const input = agent("A3");
  input.action.target = "policy/bundles/platform";
  const decision = pdp.decide(input);
  assert.equal(decision.decision, "deny");
  assert.ok(decision.matchedRules.includes("guardrails.policy-integrity"));
});

test("untrusted input kræver to godkendelser og manuel gennemgang", () => {
  const pdp = createPdp();
  const input = agent("A3");
  input.context.untrustedInput = true;
  input.context.changeUri = "https://issues.example.org/42";
  const decision = pdp.decide(input);
  assert.equal(decision.decision, "allow-with-approval");
  assert.equal(decision.requiredApprovals, 2);
  assert.ok(decision.obligations.some((o) => o.type === "manual-review"));
});

test("samme input giver samme beslutning (deterministisk)", () => {
  const pdp = createPdp();
  const a = pdp.decide(agent("A3"));
  const b = pdp.decide(agent("A3"));
  assert.equal(a.decision, b.decision);
  assert.deepEqual(a.matchedRules, b.matchedRules);
  assert.equal(a.inputSha256, b.inputSha256);
});

test("en manipuleret bundle afvises ved load", () => {
  const dir = mkdtempSync(join(tmpdir(), "pdp-tamper-"));
  try {
    copyFileSync(join(defaultBundleDir, "bundle.json"), join(dir, "bundle.json"));
    copyFileSync(join(defaultBundleDir, "bundle.sig.json"), join(dir, "bundle.sig.json"));
    const bundle = JSON.parse(readFileSync(join(dir, "bundle.json"), "utf8"));
    bundle.policies[0].effect = "allow"; // ophæv guardrail
    writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle));

    assert.throws(() => loadBundle(dir, JSON.parse(readFileSync(defaultTrustedKeys, "utf8"))), /signatur ugyldig|digest/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PDP'en svarer over HTTP og afviser ugyldigt input", async () => {
  const pdp = createPdp();
  const port = await pdp.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/data/platform/ops/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: agent("A3") }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.decision, "allow-with-approval");

    const bad = await fetch(`http://127.0.0.1:${port}/v1/data/platform/ops/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { principal: { kind: "human" } } }),
    });
    assert.equal(bad.status, 422);
    const badBody = await bad.json();
    assert.ok(badBody.violations.some((v) => v.includes("action.verb")));

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
  } finally {
    await pdp.close();
  }
});
