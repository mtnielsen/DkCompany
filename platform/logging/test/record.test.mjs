import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLogRecord, recordProblems, approvalDigestOf } from "../src/record.mjs";
import { POLICY, makeCorrelation, sensorRecord, humanRecord, modelRecord } from "./support/fixture.mjs";

test("bygger en gyldig sensorpost og fjerner hemmeligheder", () => {
  const record = buildLogRecord(
    {
      correlation: makeCorrelation(),
      scope: { tenantId: "acme", environment: "dev", service: "observability", resource: "res://acme/service/api" },
      provenance: "sensor",
      observation: { source: "otel", freshness: "fresh", value: { token: "supersecretvalue123", metric: 1 } },
      dataClassification: "operational",
      retentionClass: "operational",
    },
    { policy: POLICY }
  );
  assert.equal(record.observation.value.token, "[REDACTED]");
  assert.equal(record.minimized, true);
  assert.ok(record.redactions.length >= 1);
  assert.deepEqual(recordProblems(record, { policy: POLICY }), []);
});

test("afviser at blande provenance-blokke", () => {
  const correlation = makeCorrelation();
  const problems = recordProblems({
    schemaVersion: "1.0",
    kind: "LogRecord",
    id: "r1",
    occurredAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    correlation,
    scope: { tenantId: "acme", environment: "dev", service: "runtime", resource: "res://acme/service/api" },
    provenance: "model",
    model: { provider: "p", name: "m", promptVersion: "v", decisionSummary: "s" },
    observation: { source: "otel", freshness: "fresh", value: {} },
    dataClassification: "operational",
    retentionClass: "operational",
    minimized: true,
    redactions: [],
  });
  assert.ok(problems.some((p) => /observation/.test(p.path)));
});

test("afviser en muterende handling uden holdbar kvittering", () => {
  const correlation = makeCorrelation();
  const problems = recordProblems({
    schemaVersion: "1.0",
    kind: "LogRecord",
    id: "r2",
    occurredAt: new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    correlation,
    scope: { tenantId: "acme", environment: "dev", service: "runtime", resource: "res://acme/service/api" },
    provenance: "system",
    observation: { source: "intent", freshness: "fresh", value: {} },
    action: { mutating: true },
    dataClassification: "operational",
    retentionClass: "operational",
    minimized: true,
    redactions: [],
  });
  assert.ok(problems.some((p) => /receipt/.test(p.path)));
});

test("afviser tenant-/ressourcemismatch og fremtidige tidsstempler", () => {
  const correlation = makeCorrelation();
  const future = new Date(Date.now() + 3600_000).toISOString();
  const problems = recordProblems({
    schemaVersion: "1.0",
    kind: "LogRecord",
    id: "r3",
    occurredAt: future,
    recordedAt: future,
    correlation,
    scope: { tenantId: "acme", environment: "dev", service: "runtime", resource: "res://globex/service/api" },
    provenance: "sensor",
    observation: { source: "otel", freshness: "fresh", value: {} },
    dataClassification: "operational",
    retentionClass: "operational",
    minimized: true,
    redactions: [],
  });
  assert.ok(problems.some((p) => /tilhører/.test(p.message)));
  assert.ok(problems.some((p) => /fremtiden/.test(p.message)));
});

test("binder en godkendelse til et forløb med en stabil digest", () => {
  const correlation = makeCorrelation();
  const human = humanRecord({ correlation });
  const digest1 = approvalDigestOf(human);
  const digest2 = approvalDigestOf({ ...human });
  assert.equal(digest1, digest2);
  assert.match(digest1, /^[a-f0-9]{64}$/);
  const changed = approvalDigestOf({ ...human, human: { ...human.human, decision: "reject" } });
  assert.notEqual(digest1, changed);
});

test("modelposten kræver ingen observation, men sensorposten gør", () => {
  const model = modelRecord({ correlation: makeCorrelation() });
  assert.equal(model.observation, undefined);
  assert.deepEqual(recordProblems(model, { policy: POLICY }), []);
  const sensor = sensorRecord({ correlation: makeCorrelation() });
  assert.ok(sensor.observation);
});
