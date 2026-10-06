import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { openAuditWriter, openAuditReader } from "../../persistence/src/audit-roles.mjs";
import { openDatabase } from "../../persistence/src/db.mjs";
import { createLogLedger } from "../src/ledger.mjs";
import { createMutationRecorder } from "../src/receipt.mjs";
import { reconstructFlow } from "../src/reconstruct.mjs";
import { approvalDigestOf } from "../src/record.mjs";
import { makeArchive, makeCorrelation, sensorRecord, humanRecord, modelRecord, artifactDigest, POLICY, tempRoot } from "./support/fixture.mjs";

test("holdbar SQLite-ledger: mutation, arkivering og rekonstruktion", async () => {
  const { root, cleanup } = tempRoot();
  const dataDir = join(root, "audit");
  const writer = openAuditWriter({ dataDir });
  try {
    const ledger = createLogLedger({ audit: writer.log });
    const { archive } = makeArchive(join(root, "archive"));
    const recorder = createMutationRecorder({ ledger, journal: writer.journal, archive, policy: POLICY });

    const correlation = makeCorrelation({ correlationId: "corr-e2e", executionId: "exec-e2e" });
    const digest = artifactDigest();
    await ledger.append(sensorRecord({ correlation, service: "observability", value: { digest } }));
    const human = humanRecord({ correlation });
    await ledger.append(human);
    const approval = approvalDigestOf(human);
    await ledger.append(modelRecord({ correlation, approvalDigest: approval, retentionClass: "personal" }));

    let mutated = false;
    const recorded = await recorder.recordMutation({
      tenantId: "acme",
      idempotencyId: "idem-e2e",
      verb: "scale",
      target: "res://acme/deployment/checkout-api",
      correlation,
      service: "runtime",
      retentionClass: "personal",
      approvalDigest: approval,
      artifactDigest: digest,
      tool: { name: "kubectl.scale", verb: "scale", target: "res://acme/deployment/checkout-api" },
      mutation: async () => { mutated = true; return { replicas: 4 }; },
    });
    assert.equal(mutated, true);

    const all = await ledger.read({ tenantId: "acme" });
    const result = reconstructFlow(all, { correlationId: "corr-e2e", requireServers: 2 });
    assert.equal(result.complete, true, JSON.stringify(result.gaps));
    assert.equal(result.artifacts[digest].result, "pass");

    const chain = await ledger.verify("acme");
    assert.equal(chain.ok, true);

    const archiveCheck = await archive.verify(recorded.intent);
    assert.equal(archiveCheck.ok, true);

    // Læserrollen kan verificere men har ingen skriveflade.
    writer.close();
    const reader = openAuditReader({ dataDir });
    try {
      assert.equal(typeof reader.append, "undefined");
      assert.equal(reader.verifyChain("acme").ok, true);
      const records = reader.events("acme").filter((e) => e.type === "log.record");
      assert.equal(records.length >= 5, true);
    } finally {
      reader.close();
    }
  } finally {
    try { writer.close(); } catch { /* allerede lukket */ }
    cleanup();
  }
});

test("enhver ændring af den gemte log opdages af hash-kæden (fail-closed)", async () => {
  const { root, cleanup } = tempRoot();
  const dataDir = join(root, "audit");
  const writer = openAuditWriter({ dataDir });
  const ledger = createLogLedger({ audit: writer.log });
  await ledger.append(sensorRecord({ correlation: makeCorrelation({ correlationId: "corr-tamper", executionId: "exec-tamper" }) }));
  writer.close();

  // Direkte indgreb i den gemte log (som en kompromitteret driftskonto ville gøre).
  const db = openDatabase({ path: join(dataDir, "audit.db") });
  const first = db.get("SELECT seq FROM audit_events WHERE tenant_id = 'acme' ORDER BY seq ASC LIMIT 1");
  db.run("UPDATE audit_events SET payload = ? WHERE seq = ?", JSON.stringify({ kind: "LogRecord", tampered: true }), first.seq);
  db.close();

  const reader = openAuditReader({ dataDir });
  try {
    const verification = reader.verifyChain("acme");
    assert.equal(verification.ok, false);
  } finally {
    reader.close();
    cleanup();
  }
});
