import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitSbom, integrityToHash, serialNumberFor, verifySbomSync } from "../src/sbom.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dkc014-sbom-"));
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "app", "package.json"), JSON.stringify({ name: "app", version: "1.0.0" }));
  const integrity = "sha512-" + Buffer.alloc(64, 7).toString("base64");
  writeFileSync(
    join(root, "app", "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { name: "app", version: "1.0.0" },
        "node_modules/left-pad": { version: "1.3.0", integrity },
      },
    })
  );
  return root;
}

test("integrity konverteres fra base64 til hex", () => {
  const hash = integrityToHash("sha512-" + Buffer.alloc(64, 7).toString("base64"));
  assert.equal(hash.alg, "SHA-512");
  assert.equal(hash.content.length, 128);
  assert.equal(hash.content, "07".repeat(64));
});

test("SBOM'en er deterministisk og indeholder første- og tredjepart", () => {
  const root = fixture();
  const a = emitSbom(root, { timestamp: "1970-01-01T00:00:00.000Z" });
  const b = emitSbom(root, { timestamp: "1970-01-01T00:00:00.000Z" });
  assert.deepEqual(a, b);
  assert.equal(a.serialNumber, serialNumberFor(a.components));
  const names = a.components.map((c) => c.name).sort();
  assert.deepEqual(names, ["app", "left-pad"]);
  const leftPad = a.components.find((c) => c.name === "left-pad");
  assert.equal(leftPad.hashes[0].content, "07".repeat(64));
});

test("verifySbomSync opdager drift", () => {
  const root = fixture();
  const committed = emitSbom(root, { timestamp: "1970-01-01T00:00:00.000Z" });
  assert.equal(verifySbomSync(root, committed, { timestamp: "1970-01-01T00:00:00.000Z" }).ok, true);
  const tampered = structuredClone(committed);
  tampered.components.pop();
  const result = verifySbomSync(root, tampered, { timestamp: "1970-01-01T00:00:00.000Z" });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /ude af trit/);
});
