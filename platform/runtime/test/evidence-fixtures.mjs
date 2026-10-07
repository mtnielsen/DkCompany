/**
 * DKC-007 — syntetiske, digest-bundne bevisartefakter til runtime-testene.
 *
 * Hvert bevis skrives som en rigtig fil, og referencen bærer filens faktiske
 * SHA-256. Runtimen læser filen og genberegner digesten, så testene beviser
 * den rigtige binding — ikke en attrap.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATUS = {
  "tests-pass": "pass",
  "dry-run-clean": "clean",
  "rollback-tested": "pass",
  "restore-verified": "pass",
  "scan-clean": "clean",
};

export function evidenceFixture(labels = ["tests-pass", "dry-run-clean", "rollback-tested"], { commit = "a".repeat(40), changeDigest = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dkc-007-evidence-"));
  // Ryd de syntetiske beviser op når testprocessen afslutter.
  process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
  const index = {};
  for (const label of labels) {
    const body = JSON.stringify({ label, status: STATUS[label] ?? "pass", detail: `syntetisk bevis for ${label}` });
    const uri = join(dir, `${label}.json`);
    writeFileSync(uri, body);
    index[label] = {
      uri,
      sha256: createHash("sha256").update(body).digest("hex"),
      commit,
      status: STATUS[label] ?? "pass",
      ...(changeDigest ? { digest: changeDigest } : {}),
    };
  }
  return { dir, index };
}
