/**
 * DKC-016 — suppressionsjournal for slettede persondata.
 *
 * En backup er et øjebliksbillede fra **før** en sletning. Gendanner man det
 * ukontrolleret, genindfører man persondata, som en registreret med rette har
 * fået slettet. Journalen er derfor kilden til sandhed for sletninger og ligger
 * uden for backup-lageret:
 *
 *   - den er append-only og hash-kædet, så en ændret eller manglende post
 *     opdages,
 *   - backup-manifestet pinner journalens hoved, så en trunkeret journal
 *     afvises ved gendannelse,
 *   - gendannelsen anvender kun poster nyere end backupens oprettelsestid, så
 *     data der var slettet før backupen, ikke genopstår.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const GENESIS = "0".repeat(64);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}

function hashEntry(prevHash, body) {
  return createHash("sha256").update(`${prevHash}|${canonical(body)}`).digest("hex");
}

export class SuppressionError extends Error {
  constructor(message, code = "suppression_error") {
    super(message);
    this.name = "SuppressionError";
    this.code = code;
  }
}

export function createSuppressionLedger({ path } = {}) {
  if (!path) throw new SuppressionError("createSuppressionLedger kræver en sti uden for backup-lageret", "missing_path");

  function readAll() {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }

  function head() {
    const all = readAll();
    return all.length ? all[all.length - 1].hash : GENESIS;
  }

  return {
    kind: "suppression-ledger",
    path,
    genesis: GENESIS,
    entries: readAll,
    head,
    count: () => readAll().length,

    verify() {
      const all = readAll();
      const problems = [];
      let prev = GENESIS;
      for (const entry of all) {
        const body = { seq: entry.seq, tenantId: entry.tenantId, digest: entry.digest, subjectKey: entry.subjectKey, erasedAt: entry.erasedAt, reason: entry.reason };
        if (entry.prevHash !== prev) problems.push({ type: "broken-link", seq: entry.seq });
        if (entry.hash !== hashEntry(prev, body)) problems.push({ type: "changed", seq: entry.seq });
        prev = entry.hash;
      }
      return { ok: problems.length === 0, problems, head: prev, count: all.length };
    },

    /**
     * Er det pinned hoved stadig en del af kæden? En tom journal er kun
     * kompatibel med GENESIS-hovedet; ellers skal det pinnede hoved findes som
     * en forfader, så en trunkeret journal afvises.
     */
    isDescendantOf(pinnedHead) {
      if (pinnedHead === GENESIS) return true;
      return readAll().some((entry) => entry.hash === pinnedHead);
    },

    entriesAfter(iso) {
      const cutoff = Date.parse(iso);
      return readAll().filter((entry) => Date.parse(entry.erasedAt) > cutoff);
    },

    append({ tenantId, digest, subjectKey = null, erasedAt = null, reason = "dsar-erasure" } = {}) {
      if (!tenantId) throw new SuppressionError("suppression kræver en tenantId", "missing_tenant");
      if (!/^[a-f0-9]{64}$/.test(String(digest ?? ""))) throw new SuppressionError("suppression kræver et SHA-256-digest af posten", "bad_digest");
      const all = readAll();
      const prev = all.length ? all[all.length - 1].hash : GENESIS;
      const body = { seq: all.length + 1, tenantId, digest, subjectKey, erasedAt: erasedAt ?? new Date().toISOString(), reason };
      const entry = { ...body, prevHash: prev, hash: hashEntry(prev, body) };
      appendFileSync(path, `${JSON.stringify(entry)}\n`);
      return entry;
    },
  };
}
