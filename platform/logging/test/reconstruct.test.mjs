import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLogRecord, approvalDigestOf } from "../src/record.mjs";
import { reconstructFlow } from "../src/reconstruct.mjs";
import { makeLedger, makeCorrelation, sensorRecord, humanRecord, modelRecord, artifactDigest, POLICY } from "./support/fixture.mjs";

function verifiedRecord({ correlation, parentId, digest, result = "pass" }) {
  return buildLogRecord(
    {
      correlation: { ...correlation, parentId },
      scope: { tenantId: "acme", environment: "dev", service: "runtime", resource: "res://acme/deployment/checkout-api" },
      provenance: "verified",
      verification: { verifier: "platform.verifier", method: "deploy-check", artifactDigest: digest, result, verifiedAt: new Date().toISOString() },
      dataClassification: "operational",
      retentionClass: "operational",
    },
    { policy: POLICY }
  );
}

async function fullFlow() {
  const { ledger } = makeLedger();
  const correlation = makeCorrelation();
  const digest = artifactDigest();
  await ledger.append(sensorRecord({ correlation, value: { digest, latencyP95Ms: 120 } }));
  const human = humanRecord({ correlation });
  await ledger.append(human);
  const approval = approvalDigestOf(human);
  const model = modelRecord({ correlation, approvalDigest: approval });
  await ledger.append(model);
  await ledger.append(verifiedRecord({ correlation, parentId: model.id, digest }));
  return { ledger, correlation, model };
}

test("rekonstruerer et komplet tværserverforløb med artefakt og godkendelse", async () => {
  const { ledger, correlation } = await fullFlow();
  const records = await ledger.read({ tenantId: "acme" });
  const result = reconstructFlow(records, { correlationId: correlation.correlationId, requireServers: 2 });
  assert.equal(result.complete, true, JSON.stringify(result.gaps));
  assert.deepEqual(result.servers, ["observability", "runtime"]);
  assert.equal(result.approvals.length, 1);
  assert.equal(Object.keys(result.artifacts).length, 1);
  assert.equal(Object.values(result.artifacts)[0].matched, true);
});

test("rapporterer manglende godkendelse som et hul", async () => {
  const { ledger } = makeLedger();
  const correlation = makeCorrelation();
  await ledger.append(modelRecord({ correlation, approvalDigest: null }));
  const records = await ledger.read({ tenantId: "acme" });
  const result = reconstructFlow(records, { correlationId: correlation.correlationId });
  assert.equal(result.complete, false);
  assert.ok(result.gaps.some((g) => g.type === "missing-approval"));
});

test("rapporterer et ukendt artefakt som et hul", async () => {
  const { ledger } = makeLedger();
  const correlation = makeCorrelation();
  await ledger.append(sensorRecord({ correlation }));
  const human = humanRecord({ correlation });
  await ledger.append(human);
  const model = modelRecord({ correlation, approvalDigest: approvalDigestOf(human) });
  await ledger.append(model);
  await ledger.append(verifiedRecord({ correlation, parentId: model.id, digest: "f".repeat(64) }));
  const records = await ledger.read({ tenantId: "acme" });
  const result = reconstructFlow(records, { correlationId: correlation.correlationId });
  assert.ok(result.gaps.some((g) => g.type === "unmatched-artifact"));
});

test("rapporterer manglende verificeret outcome for en muterende handling", async () => {
  const { ledger } = makeLedger();
  const correlation = makeCorrelation();
  const human = humanRecord({ correlation });
  await ledger.append(human);
  await ledger.append(modelRecord({ correlation, approvalDigest: approvalDigestOf(human) }));
  const records = await ledger.read({ tenantId: "acme" });
  const result = reconstructFlow(records, { correlationId: correlation.correlationId });
  assert.ok(result.gaps.some((g) => g.type === "missing-verification"));
});
