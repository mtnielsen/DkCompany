import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePostgres } from "./support/fake-postgres.mjs";
import { tlsFixtures, hasOpenssl } from "./support/tls-fixtures.mjs";
import { createPostgresDriver } from "../src/drivers/postgres.mjs";
import { createNotesRepository } from "../src/app-repository.mjs";
import { NetworkError, CertificateError, VersionMismatchError, AuthenticationError } from "../src/errors.mjs";

const tlsSkip = hasOpenssl() ? false : "openssl er ikke installeret; TLS-fixtures kan ikke genereres";

async function withServer(options, fn) {
  const server = await createFakePostgres(options);
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

function connect(server, extra = {}) {
  return createPostgresDriver({
    host: server.host,
    port: server.port,
    user: server.user,
    database: server.database,
    ssl: { mode: "disable" },
    ...extra,
  });
}

test("samme app-repository kører over PostgreSQL-wire-protokollen", async () => {
  await withServer({ auth: "trust" }, async (server) => {
    const driver = connect(server);
    const info = await driver.connect();
    assert.equal(info.engine, "postgresql");
    assert.equal(info.version, "16.4.0");

    const repo = createNotesRepository(driver);
    await repo.migrate();
    await repo.create({ id: "n1", body: "første", createdAt: "2026-01-01T00:00:00.000Z" });
    await repo.create({ id: "n2", body: "anden", createdAt: "2026-01-02T00:00:00.000Z" });

    assert.equal(await repo.count(), 2);
    assert.deepEqual(await repo.get("n1"), { id: "n1", body: "første", created_at: "2026-01-01T00:00:00.000Z" });
    assert.deepEqual((await repo.list()).map((r) => r.id), ["n1", "n2"]);
    const schema = await driver.discoverSchema({ schemas: ["main"] });
    assert.ok(schema.schemas.some((s) => s.tables.some((t) => t.name === "app_notes")));
    await driver.close();
  });
});

for (const auth of ["cleartext", "md5", "scram"]) {
  test(`autentisering med ${auth}`, async () => {
    await withServer({ auth, password: "s3cret" }, async (server) => {
      const driver = connect(server, { password: "s3cret" });
      await assert.doesNotReject(() => driver.connect());
      await driver.close();
    });
  });

  test(`forkert adgangskode med ${auth} afvises`, async () => {
    await withServer({ auth, password: "s3cret" }, async (server) => {
      const driver = connect(server, { password: "forkert" });
      await assert.rejects(() => driver.connect(), AuthenticationError);
    });
  });
}

test("TLS verify-full mod en betroet CA", { skip: tlsSkip }, async () => {
  const tls = tlsFixtures();
  await withServer({ auth: "trust", tls: tls.server1 }, async (server) => {
    const driver = connect(server, { ssl: { mode: "verify-full", minVersion: "1.2", ca: tls.ca1 } });
    const info = await driver.connect();
    assert.equal(info.tls.enabled, true);
    assert.equal(info.tls.mode, "verify-full");
    await driver.close();
  });
});

test("certifikatrotation opdages: serverens certifikat er signeret af en anden CA", { skip: tlsSkip }, async () => {
  const tls = tlsFixtures();
  await withServer({ auth: "trust", tls: tls.server2 }, async (server) => {
    const driver = connect(server, { ssl: { mode: "verify-full", minVersion: "1.2", ca: tls.ca1 } });
    await assert.rejects(() => driver.connect(), (err) => err instanceof CertificateError || err.code === "certificate_error");
  });
});

test("pinned leaf-certifikat afviser en roteret server", { skip: tlsSkip }, async () => {
  const tls = tlsFixtures();
  await withServer({ auth: "trust", tls: tls.server2 }, async (server) => {
    const driver = connect(server, { ssl: { mode: "verify-full", minVersion: "1.2", certSha256: tls.server1Fingerprint } });
    await assert.rejects(() => driver.connect(), CertificateError);
  });
});

test("pinned leaf-certifikat accepterer den rigtige server", { skip: tlsSkip }, async () => {
  const tls = tlsFixtures();
  await withServer({ auth: "trust", tls: tls.server1 }, async (server) => {
    const driver = connect(server, { ssl: { mode: "verify-full", minVersion: "1.2", certSha256: tls.server1Fingerprint } });
    await assert.doesNotReject(() => driver.connect());
    await driver.close();
  });
});

test("versionsmismatch giver en kontrolleret fejl", async () => {
  await withServer({ auth: "trust", serverVersion: "13.2" }, async (server) => {
    const driver = connect(server, { supportedRanges: [">=15.0.0 <17.0.0"] });
    await assert.rejects(() => driver.connect(), VersionMismatchError);
  });
});

test("netværksudfald giver en kontrolleret fejl", async () => {
  const server = await createFakePostgres({ auth: "trust" });
  const port = server.port;
  await server.close();
  const driver = createPostgresDriver({ host: "127.0.0.1", port, user: "app", database: "appdb", ssl: { mode: "disable" } });
  await assert.rejects(() => driver.connect(), NetworkError);
});
