/**
 * DKC-008 — adskilte databaseidentiteter.
 *
 * Hvert afgrænset domæne ejer sin egen databasefil og åbner den med sin egen
 * identitet. Identiteten bestemmer:
 *   - hvilken fil der åbnes,
 *   - om forbindelsen er skrivebeskyttet (`readOnly` håndhæves af SQLite),
 *   - hvilke domænerepos der overhovedet eksponeres (least privilege).
 *
 * I et klyngeopsætning er den tilsvarende revidering separate PostgreSQL-roller
 * med GRANTs; kontrakten (identitet → database → tilladte repos) er den samme,
 * og adapterne taler kun SQL. Det er dokumenteret i `docs/spec/persistence.md`.
 */
import { join } from "node:path";
import { openDatabase } from "./db.mjs";
import { createMigrator } from "./migrations.mjs";
import { createSqliteApprovalStore } from "./adapters/approvals.mjs";
import { createSqliteJobStore } from "./adapters/jobs.mjs";
import { createSqliteBudgetStore } from "./adapters/budgets.mjs";
import { createSqliteAuditLog } from "./adapters/audit.mjs";

export const DB_IDENTITIES = {
  approvals: { file: "approvals.db", component: "approvals", domains: ["approvals"] },
  runtime: { file: "runtime.db", component: "agent-runtime", domains: ["jobs", "budgets"] },
  audit: { file: "audit.db", component: "audit-service", domains: ["audit"] },
};

/** Anvend alle ventende migrationer på en database. */
export function migrateDatabase(db, options = {}) {
  const migrator = createMigrator({ db, ...options });
  const result = migrator.apply();
  return { ...result, status: migrator.status() };
}

function buildRepositories(db) {
  return {
    approvals: createSqliteApprovalStore({ db }),
    jobs: createSqliteJobStore({ db }),
    budgets: createSqliteBudgetStore({ db }),
    audit: createSqliteAuditLog({ db }),
  };
}

/**
 * Åbn en identitets database og returnér kun dens tilladte repos.
 * `readOnly` åbner en skrivebeskyttet forbindelse; et skrivningsforsøg afvises
 * både af identitetskontrollen og af SQLite.
 */
export function openIdentity(name, { dataDir, readOnly = false, migrate = true, clock = () => Date.now() } = {}) {
  const spec = DB_IDENTITIES[name];
  if (!spec) throw new Error(`ukendt databaseidentitet '${name}'`);
  if (!dataDir) throw new Error("openIdentity kræver en dataDir");
  const path = join(dataDir, spec.file);
  const db = openDatabase({ path, readOnly });
  if (migrate && !readOnly) migrateDatabase(db);
  const repositories = buildRepositories(db);

  function repository(domain) {
    if (readOnly && !["approvals", "jobs", "budgets", "audit"].includes(domain)) {
      throw new Error(`identiteten '${name}' har ikke adgang til '${domain}'`);
    }
    if (!repositories[domain]) throw new Error(`ukendt domæne '${domain}'`);
    return repositories[domain];
  }

  return {
    name,
    component: spec.component,
    path,
    readOnly,
    domains: readOnly ? ["approvals", "jobs", "budgets", "audit"] : [...spec.domains],
    db,
    repository,
    /** Alle domæner i én rolle (bruges af testværktøj, ikke af tjenester). */
    repositories,
    close() {
      db.close();
    },
  };
}

/**
 * Åbn alle platformens identiteter under én data-mappe. Returnerer et map fra
 * identitetsnavn til den åbnede identitet.
 */
export function openPlatform({ dataDir, clock } = {}) {
  const opened = {};
  for (const name of Object.keys(DB_IDENTITIES)) opened[name] = openIdentity(name, { dataDir, clock });
  return {
    approvals: opened.approvals,
    runtime: opened.runtime,
    audit: opened.audit,
    all: opened,
    close() {
      for (const identity of Object.values(opened)) identity.close();
    },
  };
}

/** Skrivebeskyttet rapporteringsidentitet mod en navngiven database. */
export function openReadOnlyIdentity(name, { dataDir } = {}) {
  return openIdentity(name, { dataDir, readOnly: true, migrate: false });
}
