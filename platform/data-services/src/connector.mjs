/**
 * DKC-056 — datakildeconnector.
 *
 * Connectoren er grænsen mellem applikationen og et eksternt system. Den:
 *   - kræver en verificeret principal med tenantbinding (tenant udledes, ikke påstås),
 *   - opløser secretreferencen gennem en resolver og lækker aldrig værdien,
 *   - håndhæver read-only: skrive-/DDL-forespørgsler afvises, også i en CTE,
 *   - håndhæver scopet: kun de aftalte schema.tabel-par må læses,
 *   - filtrerer skemadiscovery til scopet,
 *   - skriver et revisionsspor for connect, discovery, query, denied og disconnect.
 */
import { createHash } from "node:crypto";
import { principalTenant } from "../../identity/src/tenant.mjs";
import { createDriver } from "./drivers/index.mjs";
import { assertSecretRef } from "./secrets.mjs";
import { ReadOnlyError, ScopeError, TenantBindingError } from "./errors.mjs";
import { stripComments, MUTATING_KEYWORDS } from "./migration-scope.mjs";

const READ_STATEMENT = /^\s*\(?\s*(select|with|show|explain|values)\b/i;
const TABLE_REF = /\b(?:from|join|update|into)\s+((?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi;

export function tableRefs(sql) {
  const refs = [];
  const clean = stripComments(sql);
  let match;
  while ((match = TABLE_REF.exec(clean))) refs.push(match[1].replace(/"/g, "").toLowerCase());
  return [...new Set(refs)];
}

export function createConnector({ source, secretResolver, clock = () => Date.now(), auditSink = null, driverFactory = createDriver } = {}) {
  if (!source) throw new Error("createConnector kræver en datakilde");
  if (typeof secretResolver !== "function") throw new Error("createConnector kræver en secretResolver");

  const allowedSchemas = new Set((source.access?.allowedSchemas ?? []).map((s) => s.toLowerCase()));
  const allowedTables = new Set((source.access?.allowedTables ?? []).map((s) => s.toLowerCase()));
  const events = [];
  let driver = null;

  function requireTenant(principal) {
    const tenant = principalTenant(principal);
    if (!tenant) throw new TenantBindingError("connectoren kræver en principal med tenantbinding");
    return tenant;
  }

  function record(event) {
    const entry = { at: new Date(clock()).toISOString(), source: source.metadata?.name ?? "?", ...event };
    events.push(entry);
    if (typeof auditSink === "function") auditSink(entry);
    return entry;
  }

  function sqlDigest(sql) {
    return createHash("sha256").update(String(sql)).digest("hex");
  }

  function assertReadOnly(sql) {
    const clean = stripComments(sql).trim();
    if (!READ_STATEMENT.test(clean)) throw new ReadOnlyError("kun read-only forespørgsler er tilladte mod en datakilde");
    if (MUTATING_KEYWORDS.test(clean)) {
      throw new ReadOnlyError("forespørgslen indeholder en skrive- eller DDL-operation og afvises");
    }
  }

  function isAllowed(ref) {
    if (allowedTables.has(ref)) return true;
    if (!ref.includes(".")) {
      for (const table of allowedTables) if (table.endsWith(`.${ref}`)) return true;
    }
    return false;
  }

  function assertScope(sql) {
    const denied = tableRefs(sql).filter((ref) => !isAllowed(ref));
    if (denied.length) {
      throw new ScopeError(
        `forespørgslen rammer tabeller uden for scopet: ${denied.join(", ")} (tilladte: ${[...allowedTables].join(", ") || "ingen"})`
      );
    }
  }

  function driverConfig(secret) {
    const family = source.engine?.family;
    if (family === "sqlite") {
      return { path: source.connection?.path ?? ":memory:", readOnly: true };
    }
    const tls = source.connection?.tls ?? { mode: "disable" };
    return {
      host: source.connection?.host,
      port: source.connection?.port,
      user: source.connection?.user ?? source.metadata?.name,
      password: secret,
      database: source.connection?.database,
      ssl: { mode: tls.mode, minVersion: tls.minVersion, certSha256: tls.certSha256, ca: tls.ca },
      supportedRanges: source.supportedRanges ?? [],
    };
  }

  return {
    source,

    get driver() {
      return driver;
    },

    async connect(principal) {
      const tenant = requireTenant(principal);
      const secretRef = assertSecretRef(source.connection?.secretRef);
      const secret = await secretResolver(secretRef);
      driver = driverFactory(source.engine?.family, driverConfig(secret));
      const info = await driver.connect();
      record({
        tenant,
        principal: principal?.id ?? null,
        operation: "connect",
        allowed: true,
        engine: info.engine,
        version: info.version,
        tls: info.tls,
        secretRef,
      });
      return info;
    },

    async discoverSchema(principal) {
      const tenant = requireTenant(principal);
      if (!driver) throw new ReadOnlyError("connectoren er ikke forbundet");
      const found = await driver.discoverSchema({ schemas: [...allowedSchemas] });
      const schemas = found.schemas.map((schema) => ({
        ...schema,
        tables: schema.tables.filter((table) => isAllowed(`${schema.name}.${table.name}`.toLowerCase())),
      }));
      record({
        tenant,
        principal: principal?.id ?? null,
        operation: "schema-discovery",
        allowed: true,
        schemas: [...allowedSchemas],
        tables: schemas.flatMap((s) => s.tables.map((t) => `${s.name}.${t.name}`)),
      });
      return { schemas };
    },

    async query(principal, sql, params = []) {
      const tenant = requireTenant(principal);
      if (!driver) throw new ReadOnlyError("connectoren er ikke forbundet");
      try {
        assertReadOnly(sql);
        assertScope(sql);
      } catch (err) {
        record({
          tenant,
          principal: principal?.id ?? null,
          operation: "denied",
          allowed: false,
          reason: err.message,
          sqlDigest: sqlDigest(sql),
        });
        throw err;
      }
      const result = await driver.query(sql, params);
      record({
        tenant,
        principal: principal?.id ?? null,
        operation: "query",
        allowed: true,
        tables: tableRefs(sql),
        rows: result.rowCount,
        sqlDigest: sqlDigest(sql),
      });
      return result;
    },

    async close(principal) {
      const tenant = principalTenant(principal);
      if (driver) {
        await driver.close();
        driver = null;
      }
      record({ tenant, principal: principal?.id ?? null, operation: "disconnect", allowed: true });
    },

    auditTrail() {
      return events.map((e) => ({ ...e }));
    },
  };
}
