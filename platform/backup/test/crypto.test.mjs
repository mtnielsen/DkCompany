import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { CryptoError, decryptComponent, encryptComponent, sha256Hex, toKeyBytes } from "../src/crypto.mjs";

test("kryptering og dekryptering er en round-trip", () => {
  const key = randomBytes(32).toString("hex");
  const plaintext = Buffer.from("syntetiske persondata", "utf8");
  const encryption = encryptComponent(plaintext, key, { aad: "backup:database" });
  const decrypted = decryptComponent(encryption, key, { aad: "backup:database" });
  assert.equal(decrypted.toString("utf8"), "syntetiske persondata");
  assert.equal(sha256Hex(decrypted), sha256Hex(plaintext));
});

test("en forkert nøgle afvises", () => {
  const encryption = encryptComponent(Buffer.from("hemmeligt"), randomBytes(32).toString("hex"));
  assert.throws(() => decryptComponent(encryption, randomBytes(32).toString("hex")), CryptoError);
});

test("ændret chiffertekst afvises af GCM", () => {
  const key = randomBytes(32).toString("hex");
  const encryption = encryptComponent(Buffer.from("data"), key);
  encryption.ciphertext[0] = encryption.ciphertext[0] ^ 0xff;
  assert.throws(() => decryptComponent(encryption, key), /dekryptering fejlede/);
});

test("AAD binding afviser en komponent der byttes om", () => {
  const key = randomBytes(32).toString("hex");
  const encryption = encryptComponent(Buffer.from("data"), key, { aad: "backup:database:database" });
  assert.throws(() => decryptComponent(encryption, key, { aad: "backup:config:config" }), CryptoError);
});

test("nøgleformat valideres", () => {
  assert.equal(toKeyBytes(randomBytes(32)).length, 32);
  assert.equal(toKeyBytes("a".repeat(64)).length, 32);
  assert.throws(() => toKeyBytes("kort"), /32 byte eller 64 hex/);
  assert.throws(() => toKeyBytes(randomBytes(16)), /32 byte/);
});
