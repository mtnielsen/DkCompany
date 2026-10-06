import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnector } from "../src/connector.mjs";
import { inMemorySecretResolver } from "../src/secrets.mjs";
import { createFakePostgres } from "./support/fake-postgres.mjs";
import { ScopeError, ReadOnlyError, TenantBindingError, SecretError } from "../src/errors.mjs";

const INIT = `
ATTACH ':memory:' AS hr;
CREATE TABLE hr.employees(id TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO hr.employees VALUES ('e1', 'Ada');
CREATE TABLE hr.payroll(id TEXT PRIMARY KEY, salary INTEGER);
INSERT INTO hr.payroll VALUES ('e1', 100);
`;

const PRINCIPAL = { id: "svc:hr-reader", tenantId: "acme" };

function hrSource(server, overrides = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "DataSource",
    metadata: { name: "hr-source", version: "1.0.0", description: "x", dataOwner: { subject: "oidc|ingrid", name: "Ingrid", role: "HR" } },
    sourceType: "hr",
    engine: { family: "postgresql", version: "16.4" },
    connection: { host: server.host, port: server.port, database: server.database, user: server.user, tls: { mode: "disable" }, secretRef: "env:HR_PASSWORD" },
    access: { readOnly: true, allowedSchemas: ["hr"], allowedTables: ["hr.employees"], denyWrites: true, denyDdl: true },
    tenantBinding: { required: true, source: "principal", strategy: "per-tenant-credential" },
    schemaDiscovery: { enabled: true, includeSchemas: ["hr"] },
    dataOwnership: { owner: { subject: "oidc|ingrid", name: "Ingrid", role: "HR" }, classification: "personal", agreementRef: "dpa://hr", purpose: "opslag" },
    externalPolicy: { treatAsOwnDatabase: false, autoMigrate: false, autoBackup: false, scopeAgreementRef: "scope://hr" },
    auditTrail: { enabled: true, events: ["connect", "schema-discovery", "query", "denied", "disconnect"], sink: "audit://x" },
    ...overrides,
  };
}

async function withConnector(fn, options = {}) {
  const server = await createFakePostgres({ auth: "cleartext", password: "hunter2", init: INIT, ...options });
  const connector = createConnector({
    source: hrSource(server, options.overrides),
    secretResolver: inMemorySecretResolver({ "env:HR_PASSWORD": "hunter2" }),
  });
  try {
    return await fn(server, connector);
  } finally {
    await connector.close(PRINCIPAL);
    await server.close();
  }
}

test("HR-connector giver kun adgang til det aftalte scope", async () => {
  await withConnector(async (_server, connector) => {
    const info = await connector.connect(PRINCIPAL);
    assert.equal(info.engine, "postgresql");

    const allowed = await connector.query(PRINCIPAL, "SELECT id, name FROM hr.employees ORDER BY id");
    assert.deepEqual(allowed.rows, [{ id: "e1", name: "Ada" }]);

    await assert.rejects(() => connector.query(PRINCIPAL, "SELECT * FROM hr.payroll"), ScopeError);
  });
});

test("connectoren afviser skrivning og DDL", async () => {
  await withConnector(async (_server, connector) => {
    await connector.connect(PRINCIPAL);
    await assert.rejects(() => connector.query(PRINCIPAL, "DELETE FROM hr.employees"), ReadOnlyError);
    await assert.rejects(() => connector.query(PRINCIPAL, "UPDATE hr.employees SET name = 'x'"), ReadOnlyError);
    await assert.rejects(() => connector.query(PRINCIPAL, "DROP TABLE hr.employees"), ReadOnlyError);
    await assert.rejects(
      () => connector.query(PRINCIPAL, "WITH gone AS (DELETE FROM hr.employees RETURNING id) SELECT * FROM gone"),
      ReadOnlyError
    );
  });
});

test("connectoren kræver en principal med tenantbinding", async () => {
  await withConnector(async (_server, connector) => {
    await assert.rejects(() => connector.connect({ id: "svc:ingen-tenant" }), TenantBindingError);
  });
});

test("en uopløst hemmelighed giver en kontrolleret fejl og lækker ikke værdien", async () => {
  const server = await createFakePostgres({ auth: "cleartext", password: "hunter2", init: INIT });
  const connector = createConnector({
    source: hrSource(server),
    secretResolver: inMemorySecretResolver({}),
  });
  try {
    await assert.rejects(() => connector.connect(PRINCIPAL), SecretError);
    assert.equal(connector.auditTrail().some((e) => JSON.stringify(e).includes("hunter2")), false);
  } finally {
    await server.close();
  }
});

test("revisionssporet indeholder connect, query, denied og disconnect", async () => {
  await withConnector(async (_server, connector) => {
    await connector.connect(PRINCIPAL);
    await connector.query(PRINCIPAL, "SELECT id FROM hr.employees");
    await assert.rejects(() => connector.query(PRINCIPAL, "SELECT * FROM hr.payroll"));
    await connector.close(PRINCIPAL);
    const operations = connector.auditTrail().map((e) => e.operation);
    for (const op of ["connect", "query", "denied", "disconnect"]) assert.ok(operations.includes(op), `mangler ${op}`);
    assert.equal(connector.auditTrail().every((e) => e.tenant === "acme"), true);
  });
});
