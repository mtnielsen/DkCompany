import { test } from "node:test";
import assert from "node:assert/strict";
import { createS3Backend } from "../src/backends/s3.mjs";
import { createBackendForTarget } from "../src/backends/index.mjs";
import { BackupTargetError } from "../src/errors.mjs";
import { createMockS3 } from "./support/mock-s3.mjs";
import { hasOpenssl, tlsFixtures } from "../../data-services/test/support/tls-fixtures.mjs";

function backend(server, overrides = {}) {
  return createS3Backend({
    endpoint: server.url,
    region: "eu-west-1",
    bucket: server.bucket,
    credentials: { accessKeyId: "TESTKEY", secretAccessKey: "TESTSECRET" },
    tls: { verify: false },
    ...overrides,
  });
}

test("S3-backenden skriver, læser, lister og sletter med verificeret SigV4", async () => {
  const server = await createMockS3({ objectLock: false, versioning: true });
  try {
    const be = backend(server);
    await be.headBucket();
    const put = await be.putObject("components/a.enc", Buffer.from("hemmelig chiffertekst"));
    assert.equal(put.bytes, 21);
    const got = await be.getObject("components/a.enc");
    assert.equal(got.toString("utf8"), "hemmelig chiffertekst");
    const head = await be.headObject("components/a.enc");
    assert.equal(head.bytes, 21);
    const list = await be.listObjects("components/");
    assert.deepEqual(list.map((o) => o.key), ["components/a.enc"]);
    assert.equal(await be.deleteObject("components/a.enc"), true);
    assert.equal(await be.headObject("components/a.enc"), null);
    // Serveren har verificeret hver signatur; ellers var kaldene afvist.
    assert.ok(server.requests.every((r) => r.signed));
  } finally {
    await server.close();
  }
});

test("pathPrefix holdes ude af de logiske nøgler", async () => {
  const server = await createMockS3();
  try {
    const be = backend(server, { pathPrefix: "prod" });
    await be.putObject("backups/acme/b1/manifest.json", Buffer.from("{}"));
    const list = await be.listObjects("backups/acme/b1");
    assert.deepEqual(list.map((o) => o.key), ["backups/acme/b1/manifest.json"]);
    assert.ok([...server.store.keys()][0].startsWith("prod/"));
  } finally {
    await server.close();
  }
});

test("preflight opdager object-lock og versionsstyring", async () => {
  const withLock = await createMockS3({ objectLock: true, objectLockMode: "COMPLIANCE", objectLockDays: 90, versioning: true });
  const withoutLock = await createMockS3({ objectLock: false, versioning: false });
  try {
    const locked = await backend(withLock).preflight();
    assert.equal(locked.ok, true);
    assert.equal(locked.capabilities.objectLock, true);
    assert.equal(locked.capabilities.objectLockMode, "COMPLIANCE");
    assert.equal(locked.capabilities.minRetentionDays, 90);
    assert.equal(locked.capabilities.versioning, true);

    const plain = await backend(withoutLock).preflight();
    assert.equal(plain.ok, true);
    assert.equal(plain.capabilities.objectLock, false);
    assert.equal(plain.capabilities.versioning, false);
  } finally {
    await withLock.close();
    await withoutLock.close();
  }
});

test("en forkert nøgle afvises som credential-fejl", async () => {
  const server = await createMockS3();
  try {
    const be = backend(server, { credentials: { accessKeyId: "TESTKEY", secretAccessKey: "FORKERT" } });
    await assert.rejects(() => be.headBucket(), (err) => err instanceof BackupTargetError && err.code === "credentials_error");
  } finally {
    await server.close();
  }
});

test("manglende plads rapporteres som space_error", async () => {
  const server = await createMockS3();
  try {
    const be = backend(server);
    server.setFailure("space");
    await assert.rejects(() => be.putObject("x", Buffer.from("data")), (err) => err.code === "space_error");
  } finally {
    await server.close();
  }
});

test("object-lock blokerer sletning og rapporteres som retention_error", async () => {
  const server = await createMockS3({ objectLock: true });
  try {
    const be = backend(server);
    await be.putObject("canary", Buffer.from("data"));
    await assert.rejects(() => be.deleteObject("canary"), (err) => err.code === "retention_error");
  } finally {
    await server.close();
  }
});

test("backendvælgeren afviser en objektlagerprofil uden credentials", () => {
  assert.throws(
    () => createBackendForTarget({ targetType: "object-store", endpoint: { url: "https://s3.example.org", region: "eu-west-1", bucket: "b" } }, {}),
    (err) => err.code === "credentials_error"
  );
});

const tlsSkip = hasOpenssl() ? false : "openssl er ikke installeret";

test("et ubetroet certifikat afvises, og en betroet CA accepteres", { skip: tlsSkip }, async () => {
  const fixtures = tlsFixtures();
  const server = await createMockS3({ tls: fixtures.server1 });
  try {
    const untrusted = backend(server, { tls: { verify: true, minVersion: "1.2" } });
    await assert.rejects(() => untrusted.headBucket(), (err) => err.code === "certificate_error");

    const trusted = backend(server, { tls: { verify: true, minVersion: "1.2", ca: fixtures.ca1 } });
    const info = await trusted.headBucket();
    assert.equal(info.bucket, server.bucket);
  } finally {
    await server.close();
  }
});
