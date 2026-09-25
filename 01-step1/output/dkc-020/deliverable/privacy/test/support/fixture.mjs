import { openDatabase, createMigrator, createSqliteDsarStore } from "../../../persistence/src/index.mjs";
import { createMemoryArtifactStore, createExportService } from "../../src/index.mjs";

export function makeStore() {
  const db = openDatabase({ path: ":memory:" });
  createMigrator({ db }).apply();
  const store = createSqliteDsarStore({ db });
  return { db, store, cleanup: () => db.close() };
}

export function makeExportService(store) {
  const artifactStore = createMemoryArtifactStore();
  const exportService = createExportService({ store, artifactStore });
  return { artifactStore, exportService };
}

export const DP0 = { kind: "human", id: "oidc|dpo.anna", name: "Anna DPO", tenantId: "acme", roles: ["dpo"] };
