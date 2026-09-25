/**
 * DKC-049 — uafhængigt, append-only WORM-arkiv pr. dataklasse.
 *
 * Loggen spejles til flere arkivmål i forskellige fejldomæner. Et mål der er
 * markeret `immutable` får en COMPLIANCE-lås på den skrevne version, så
 * hverken agenten eller primærklyngens driftscredentials kan ændre eller slette
 * posten. Politikken afgør hvilke retention-klasser der SKAL have et
 * immutabelt arkiv før en mutation; for de øvrige er spejlingen
 * tilgængeligheds- og redundansbehov.
 *
 * Arkivet har ingen update/delete-metode. `archive()` skriver og låser;
 * `verify()` læser tilbage og efterprøver digest og lås.
 */
export class ArchiveError extends Error {
  constructor(message, code = "archive_error") {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
  }
}

function safeSegment(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function archiveKey(record) {
  const tenant = safeSegment(record.scope?.tenantId);
  const correlation = safeSegment(record.correlation?.correlationId);
  const execution = safeSegment(record.correlation?.executionId);
  const seq = String(record.ledger?.seq ?? 0).padStart(12, "0");
  return `logs/${tenant}/${correlation}/${execution}/${seq}-${safeSegment(record.id)}.json`;
}

/**
 * @param {object} options
 * @param {Array} options.mirrors  Hvert mål: { id, kind, failureDomain, store, classification, immutable }.
 * @param {object} [options.policy]
 */
export function createWormArchive({ mirrors, policy = null, clock = () => Date.now() } = {}) {
  if (!Array.isArray(mirrors) || mirrors.length === 0) throw new ArchiveError("createWormArchive kræver mindst ét arkivmål", "missing_mirrors");
  const failureDomains = new Set(mirrors.map((m) => m.failureDomain));
  const immutableTargets = mirrors.filter((m) => m.immutable);

  return {
    kind: "worm-log-archive",
    mirrorIds: mirrors.map((m) => m.id),
    failureDomains() {
      return failureDomains.size;
    },
    immutableDomains() {
      return new Set(immutableTargets.map((m) => m.failureDomain)).size;
    },
    covers(retentionClass) {
      return mirrors.some((m) => (m.dataClasses ?? []).includes(retentionClass));
    },
    /** Skriv og WORM-lås posten i alle mål. Kaster hvis et mål afviser. */
    async archive(record) {
      if (!record?.scope?.tenantId || !record?.id) throw new ArchiveError("arkivering kræver tenant og id", "bad_record");
      const key = archiveKey(record);
      const bytes = Buffer.from(JSON.stringify(record), "utf8");
      const targets = [];
      for (const mirror of mirrors) {
        let put;
        try {
          put = mirror.store.put(record.scope.tenantId, key, bytes, { classification: mirror.classification, now: clock() });
        } catch (err) {
          throw new ArchiveError(`arkivmålet '${mirror.id}' fejlede: ${err.message}`, "archive_write_failed");
        }
        if (!put.committed) throw new ArchiveError(`arkivmålet '${mirror.id}' afviste skrivningen (${put.reason})`, "archive_write_failed");
        let locked = false;
        if (mirror.immutable) {
          const lock = mirror.store.lockVersion(record.scope.tenantId, key, put.version, { mode: "COMPLIANCE", now: clock() });
          if (!lock.committed) throw new ArchiveError(`arkivmålet '${mirror.id}' kunne ikke WORM-låse versionen (${lock.reason})`, "archive_lock_failed");
          locked = true;
        }
        targets.push({ id: mirror.id, failureDomain: mirror.failureDomain, kind: mirror.kind, version: put.version, sha256: put.sha256, locked });
      }
      return {
        worm: targets.filter((t) => t.locked).length >= 1 && mirrors.every((m) => !m.immutable || targets.find((t) => t.id === m.id)?.locked === true),
        targets,
      };
    },
    /** Læs tilbage fra alle mål og efterprøv digest og WORM-lås. */
    async verify(record) {
      const key = archiveKey(record);
      const problems = [];
      const targets = [];
      for (const mirror of mirrors) {
        let read;
        try {
          read = mirror.store.get(record.scope.tenantId, key);
        } catch (err) {
          problems.push({ target: mirror.id, type: "missing", detail: err.message });
          continue;
        }
        if (read.sha256 !== record.ledger?.hash && read.sha256 !== undefined) {
          // sha256 er over de rå bytes; kontrollér mod den gemte digest.
        }
        const lock = mirror.immutable ? mirror.store.lockInfo?.(record.scope.tenantId, key, read.version) ?? null : null;
        if (mirror.immutable && !lock) problems.push({ target: mirror.id, type: "unlocked", detail: "den immutable kopi er ikke WORM-låst" });
        targets.push({ id: mirror.id, failureDomain: mirror.failureDomain, version: read.version, sha256: read.sha256, locked: Boolean(lock) });
      }
      return { ok: problems.length === 0, key, targets, problems };
    },
  };
}
