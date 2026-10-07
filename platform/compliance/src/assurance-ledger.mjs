/**
 * DKC-022 — append-only beslutningsjournal for accepter af krav.
 *
 * En accept af et krav er en menneskelig beslutning og skal bevares, så den
 * kan revideres uden at kunne ændres i det stille. Journalen er en
 * hash-kædet, append-only JSONL-fil: hver post bærer det foregående hash, og
 * en efterfølgende ændring bryder kæden. Et krav kan accepteres flere gange
 * (fx efter en ny vurdering); den seneste post er gældende.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const GENESIS = "genesis";

function hashEntry(entry) {
  const { hash: _hash, ...rest } = entry;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

export function createFileAcceptanceLedger({ path } = {}) {
  if (!path) throw new Error("createFileAcceptanceLedger kræver en path");

  function readEntries() {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  const headHash = (entries) => (entries.length ? entries[entries.length - 1].hash : GENESIS);

  return {
    kind: "file-acceptance-ledger",
    path,

    entries() {
      return readEntries();
    },

    head() {
      return headHash(readEntries());
    },

    /** Verificér hash-kæden; en brudt kæde afvises. */
    verify() {
      const entries = readEntries();
      let prev = GENESIS;
      for (const entry of entries) {
        if (entry.prevHash !== prev) return { ok: false, reason: `brudt kæde ved '${entry.id ?? "?"}'` };
        if (hashEntry(entry) !== entry.hash) return { ok: false, reason: `hash matcher ikke ved '${entry.id ?? "?"}'` };
        prev = entry.hash;
      }
      return { ok: true, entries: entries.length, head: prev };
    },

    /** Tilføj en accepthændelse. Returnerer den forseglede post. */
    append(entry) {
      const entries = readEntries();
      const record = { ...entry, prevHash: headHash(entries) };
      record.hash = hashEntry(record);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(record) + "\n");
      return record;
    },
  };
}
