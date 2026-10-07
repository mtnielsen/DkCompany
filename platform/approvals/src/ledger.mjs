/**
 * DKC-004 — beskyttet audit-log for godkendelsesbeslutninger.
 *
 * Hver beslutning (oprettelse, godkendelse, afvisning, ændring, udløb,
 * tilbagekaldelse) skrives som en append-only post, der bærer hashen af den
 * foregående. Er der konfigureret en hemmelighed, bruges en HMAC, så en angriber
 * med skriveadgang til filen ikke kan genberegne kæden uden nøglen. Enhver
 * efterfølgende ændring af en gammel post bryder kæden fra det punkt og frem.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stableStringify } from "./binding.mjs";

export function createApprovalLedger({ path = null, secret = null, genesis = "0".repeat(64), fileStore = null } = {}) {
  const fs = fileStore ?? { appendFileSync, existsSync, mkdirSync, readFileSync };
  const entries = [];
  let lastHash = genesis;

  function digest(prevHash, entry) {
    const data = `${prevHash}|${stableStringify(entry)}`;
    return secret
      ? createHmac("sha256", secret).update(data).digest("hex")
      : createHash("sha256").update(data).digest("hex");
  }

  function append(input) {
    const entry = {
      seq: entries.length + 1,
      id: input.id,
      type: input.type,
      at: input.at ?? new Date().toISOString(),
      tenantId: input.tenantId ?? null,
      state: input.state ?? null,
      bindingDigest: input.bindingDigest ?? null,
      actor: input.actor ?? null,
      detail: input.detail ?? null,
      prevHash: lastHash,
    };
    const stored = { ...entry, hash: digest(lastHash, entry) };
    entries.push(stored);
    lastHash = stored.hash;
    if (path) {
      fs.mkdirSync(dirname(path), { recursive: true });
      fs.appendFileSync(path, JSON.stringify(stored) + "\n");
    }
    return stored;
  }

  function verifyChain() {
    let prev = genesis;
    for (const entry of entries) {
      const { hash, ...rest } = entry;
      if (digest(prev, rest) !== hash) return { ok: false, brokenAt: entry.seq, length: entries.length };
      prev = hash;
    }
    return { ok: true, length: entries.length };
  }

  // Indlæs og verificér en eksisterende log. En brudt kæde er en hård fejl:
  // beslutningshistorikken er bevis, og et brud må ikke ignoreres.
  if (path && fs.existsSync(path)) {
    const raw = fs.readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const stored = JSON.parse(line);
      const { hash, ...rest } = stored;
      if (digest(lastHash, rest) !== hash) {
        const err = new Error(`audit-log er brudt ved seq ${stored.seq}`);
        err.code = "AUDIT_CHAIN_BROKEN";
        throw err;
      }
      entries.push(stored);
      lastHash = hash;
    }
  }

  return {
    kind: "approval-ledger",
    path,
    entries,
    append,
    verifyChain,
    genesis,
    get lastHash() {
      return lastHash;
    },
    /** Et nyt, unikt event-id til test/logning. */
    newId: randomUUID,
  };
}
