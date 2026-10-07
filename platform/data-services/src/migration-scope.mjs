/**
 * DKC-056 — migrationsscope.
 *
 * En migration må kun ramme de skemaer platformen ejer. Denne guard læser
 * migrationen, finder hvert mål (schema.tabel), og afviser:
 *   - skrivninger mod et fremmed schema,
 *   - DROP/TRUNCATE og DELETE/UPDATE uden WHERE (destruktivt),
 *   - destruktive ændringer uden en navngivet godkender, når profilen kræver det.
 *
 * Guarden er ren og køres FØR nogen forbindelse åbnes. Den erstatter ikke
 * databasens egne rettigheder, men forhindrer at en fejl i applikationskoden
 * rammer en fremmed database.
 */
import { MigrationScopeError } from "./errors.mjs";

const IDENT = `(?:"?[A-Za-z_][A-Za-z0-9_]*"?\\.)?"?[A-Za-z_][A-Za-z0-9_]*"?`;
const READ_OPERATION = /^\s*\(?\s*(select|with|show|explain|values)\b/i;
const MUTATING_KEYWORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|reindex|set|reset)\b/i;

export function stripComments(sql) {
  return String(sql ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/** Split en migration i enkelte statements, uden at røre ';' i strengliteraler. */
export function splitStatements(sql) {
  const out = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      current += ch;
      if (inString && sql[i + 1] === "'") {
        current += sql[i + 1];
        i += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (ch === ";" && !inString) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function normalizeIdentifier(raw) {
  const cleaned = String(raw ?? "").replace(/"/g, "");
  const [schema, table] = cleaned.includes(".") ? cleaned.split(".") : [null, cleaned];
  return { schema: schema ? schema.toLowerCase() : null, table: table.toLowerCase() };
}

/** Find mål og operation for et enkelt statement. */
export function analyzeStatement(statement, { defaultSchema = null } = {}) {
  const sql = stripComments(statement);
  const patterns = [
    { operation: "create-schema", destructive: false, re: new RegExp(`^\\s*create\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})`, "i") },
    { operation: "create-table", destructive: false, re: new RegExp(`^\\s*create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})`, "i") },
    { operation: "alter-table", destructive: true, re: new RegExp(`^\\s*alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${IDENT})`, "i") },
    { operation: "drop-table", destructive: true, re: new RegExp(`^\\s*drop\\s+table\\s+(?:if\\s+exists\\s+)?(${IDENT})`, "i") },
    { operation: "drop-schema", destructive: true, re: new RegExp(`^\\s*drop\\s+schema\\s+(?:if\\s+exists\\s+)?(${IDENT})`, "i") },
    { operation: "truncate", destructive: true, re: new RegExp(`^\\s*truncate\\s+(?:table\\s+)?(${IDENT})`, "i") },
    { operation: "insert", destructive: false, re: new RegExp(`^\\s*insert\\s+into\\s+(${IDENT})`, "i") },
    { operation: "update", destructive: true, re: new RegExp(`^\\s*update\\s+(${IDENT})`, "i") },
    { operation: "delete", destructive: true, re: new RegExp(`^\\s*delete\\s+from\\s+(${IDENT})`, "i") },
  ];

  for (const { operation, destructive, re } of patterns) {
    const match = re.exec(sql);
    if (!match) continue;
    const parsed = operation === "create-schema" || operation === "drop-schema"
      ? { schema: normalizeIdentifier(match[1]).table, table: null }
      : normalizeIdentifier(match[1]);
    const target = { schema: parsed.schema ?? defaultSchema, table: parsed.table };
    const fullTable = ["delete", "update", "truncate"].includes(operation) && !/\bwhere\b/i.test(sql);
    return {
      sql: statement,
      operation,
      target,
      destructive,
      fullTable,
      foreign: Boolean(target.schema && defaultSchema && target.schema !== defaultSchema),
    };
  }

  if (READ_OPERATION.test(sql)) {
    return { sql: statement, operation: "read", target: { schema: null, table: null }, destructive: false, fullTable: false, foreign: false };
  }
  return { sql: statement, operation: "unknown", target: { schema: null, table: null }, destructive: true, fullTable: false, foreign: false };
}

/** Analysér hele migrationen mod profilen. Returnerer en ren rapport. */
export function analyzeMigration(sql, profile, { allowFullTable = false, approvedBy = null } = {}) {
  const ownedSchemas = (profile?.migrations?.ownedSchemas ?? []).map((s) => s.toLowerCase());
  const defaultSchema = ownedSchemas[0] ?? null;
  const owned = new Set(ownedSchemas);
  const statements = splitStatements(sql).map((s) => analyzeStatement(s, { defaultSchema }));
  const errors = [];

  for (const [i, stmt] of statements.entries()) {
    const where = `statement ${i + 1} (${stmt.operation})`;
    if (stmt.operation === "unknown") {
      errors.push(`${where}: ukendt statement; migrationsguarden kan ikke garantere scopet`);
      continue;
    }
    if (stmt.foreign) {
      errors.push(`${where}: rammer schemaet '${stmt.target.schema}', som platformen ikke ejer (ejer: ${[...owned].join(", ") || "intet"})`);
    }
    if (stmt.operation === "drop-schema") {
      errors.push(`${where}: DROP SCHEMA er aldrig tilladt`);
    }
    if (stmt.fullTable && !allowFullTable) {
      errors.push(`${where}: sletter eller ændrer alle rækker uden WHERE; kræver eksplicit tilladelse`);
    }
  }

  const destructive = statements.filter((s) => s.destructive);
  if (destructive.length && profile?.migrations?.destructiveChangesRequireApproval === true && !approvedBy) {
    errors.push(`${destructive.length} destruktiv(e) statement(s) kræver en navngivet godkender (approvedBy)`);
  }

  return {
    ok: errors.length === 0,
    errors,
    statements,
    ownedSchemas,
    destructiveCount: destructive.length,
    hasDestructive: destructive.length > 0,
  };
}

/** Kaster hvis migrationen ikke er tilladt. */
export function assertMigrationAllowed(sql, profile, { approvedBy = null, allowFullTable = false } = {}) {
  const report = analyzeMigration(sql, profile, { allowFullTable, approvedBy });
  if (report.errors.length) throw new MigrationScopeError(`migrationen er afvist:\n  - ${report.errors.join("\n  - ")}`);
  return report;
}

/**
 * Anvend en migration på en managed/BYO-profil. Eksterne datakilder har ingen
 * profil og afvises af `assertExternalMigrationRefused`.
 */
export async function applyMigration(driver, sql, profile, { approvedBy = null, allowFullTable = false, onBeforeBackup = null } = {}) {
  if (profile?.migrations?.strategy === "none") {
    throw new MigrationScopeError(`profilen '${profile?.metadata?.name ?? "?"}' tillader ikke migrationer`);
  }
  const report = assertMigrationAllowed(sql, profile, { approvedBy, allowFullTable });
  if (report.hasDestructive && profile.migrations.backupBeforeMigrate === true && typeof onBeforeBackup === "function") {
    await onBeforeBackup();
  }
  for (const stmt of report.statements) {
    if (stmt.operation === "read") continue;
    await driver.query(stmt.sql);
  }
  return { applied: report.statements.filter((s) => s.operation !== "read").length, destructiveCount: report.destructiveCount };
}

/** Enhver migration mod en ekstern datakilde afvises. */
export function assertExternalMigrationRefused(source) {
  throw new MigrationScopeError(
    `datakilden '${source?.metadata?.name ?? "?"}' er ekstern og må ikke migreres; externalPolicy.autoMigrate er kontraktuelt false`
  );
}

export { MUTATING_KEYWORDS };
