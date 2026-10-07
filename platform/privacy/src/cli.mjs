#!/usr/bin/env node
/**
 * DKC-020 — demonstration af den holdbare DSAR-proces uden levende apps.
 *
 *   node privacy/src/cli.mjs demo
 *
 * Kører en sag mod de deklarerede moduler (offline syntese), udsteder en sikret
 * eksport og indløser den som den navngivne modtager. Rigtige apps prøves af
 * `privacy-test` (to adaptere) og af live-integrationerne.
 */
import { openDatabase, createMigrator, createSqliteDsarStore } from "../../persistence/src/index.mjs";
import { createMemoryArtifactStore, createExportService, createCaseService } from "./index.mjs";
import { orchestrate } from "../../conformance/src/dsar.mjs";

const DP0 = { kind: "human", id: "oidc|dpo.anna", name: "Anna DPO", tenantId: "acme", roles: ["dpo"] };

function demo() {
  const db = openDatabase({ path: ":memory:" });
  createMigrator({ db }).apply();
  const store = createSqliteDsarStore({ db });
  const artifactStore = createMemoryArtifactStore();
  const exportService = createExportService({ store, artifactStore });
  // Offline demo: brug de deklarerede modul-conformances i stedet for HTTP.
  const caseService = createCaseService({
    store,
    artifactStore,
    exportService,
    fanout: (request, modules) => orchestrate(request, modules, { offline: true }),
  });

  const identifiers = [{ type: "email", value: "syntetisk@example.org", normalised: "syntetisk@example.org" }];
  const created = caseService.openCase({ tenantId: "acme", verb: "subject.locate", identifiers, principal: DP0, idempotencyKey: "demo-1" });
  console.log(`Sag ${created.caseId} oprettet for tenant acme af ${created.caseworker.subject}`);

  return caseService
    .runCase({ tenantId: "acme", caseId: created.caseId, principal: DP0 })
    .then((sag) => {
      console.log(`Status: ${sag.status} — ${JSON.stringify(sag.response.summary)}`);
      for (const r of sag.response.results) console.log(`  ${r.module}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
      const exp = caseService.createExport({ tenantId: "acme", caseId: created.caseId, principal: DP0 });
      console.log(`Eksport ${exp.exportId} udstedt, udløber ${exp.expiresAt}, digest ${exp.artifact.sha256.slice(0, 12)}…`);
      const redeemed = caseService.redeemExport({ tenantId: "acme", exportId: exp.exportId, principal: DP0 });
      console.log(`Indløst af ${exp.recipient}: ${redeemed.payload.recordCount} poster, ${redeemed.payload.dropped} udeladt`);
      db.close();
    });
}

if (process.argv[2] === "demo") {
  demo().catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
} else {
  console.error("Brug: node privacy/src/cli.mjs demo");
  process.exit(2);
}
