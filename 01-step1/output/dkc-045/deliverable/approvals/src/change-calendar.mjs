/**
 * DKC-045 — change-kalender, konflikter, vedligeholdelsesvinduer og låse.
 *
 * To samtidige ændringer på samme ressource må ikke kunne omgå hinandens låse.
 * Kalenderen er derfor den ene koordinator for:
 *
 *   - vedligeholdelsesvinduer (hvornår en ændring overhovedet må planlægges),
 *   - tidsmæssige konflikter mellem ændringer på samme mål,
 *   - en atomisk lås pr. mål, så to changes ikke kan implementeres samtidigt.
 *
 * Låsen kan holdes i hukommelsen (én resolver-proces) eller i et filbaseret
 * lager, hvor `open(..., 'wx')` giver den samme gensidige udelukkelse på tværs
 * af processer. Begge dele er reelle spærringer — ikke en kosmetisk status.
 */
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TERMINAL_STATES = new Set(["implemented", "rolled_back", "cancelled", "rejected"]);

function normalizeTarget(target) {
  return String(target).trim().toLowerCase();
}

/** Låselager i hukommelsen med atomisk claim/release. */
export function createMemoryLockStore() {
  const locks = new Map();
  return {
    kind: "memory",
    read(key) {
      const value = locks.get(key);
      return value ? structuredClone(value) : null;
    },
    create(key, record) {
      if (locks.has(key)) return false;
      locks.set(key, structuredClone(record));
      return true;
    },
    remove(key) {
      return locks.delete(key);
    },
    keys() {
      return [...locks.keys()];
    },
  };
}

/** Filbaseret låselager: `wx`-flaget giver gensidig udelukkelse mellem processer. */
export function createFileLockStore({ dir, fileStore = null } = {}) {
  if (!dir) throw new Error("createFileLockStore kræver en mappe (dir)");
  const fs = fileStore ?? { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync };
  fs.mkdirSync(dir, { recursive: true });
  const pathFor = (key) => join(dir, `${Buffer.from(key).toString("hex")}.lock`);
  return {
    kind: "file",
    dir,
    read(key) {
      const path = pathFor(key);
      if (!fs.existsSync(path)) return null;
      try {
        return JSON.parse(fs.readFileSync(path, "utf8"));
      } catch {
        return null;
      }
    },
    create(key, record) {
      const path = pathFor(key);
      try {
        fs.writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
        return true;
      } catch (err) {
        if (err.code === "EEXIST") return false;
        throw err;
      }
    },
    remove(key) {
      const path = pathFor(key);
      if (!fs.existsSync(path)) return false;
      fs.unlinkSync(path);
      return true;
    },
    keys() {
      return [];
    },
  };
}

/**
 * Change-kalender. `lockStore` kan udskiftes; standard er hukommelsen.
 */
export function createChangeCalendar({ clock = () => Date.now(), lockStore = null, windows = [], changes = [] } = {}) {
  const locks = lockStore ?? createMemoryLockStore();
  const maintenanceWindows = windows.map((w) => ({ ...w, targets: [...(w.targets ?? [])] }));
  const changeRecords = new Map(changes.map((c) => [c.id, structuredClone(c)]));

  function activeLocks() {
    const now = clock();
    const out = [];
    for (const key of locks.keys()) {
      const record = locks.read(key);
      if (!record) continue;
      if (record.expiresAt <= now) {
        locks.remove(key);
        continue;
      }
      out.push({ key, ...record });
    }
    return out;
  }

  function lockKey(target) {
    return `target:${normalizeTarget(target)}`;
  }

  /** Er tidspunktet inde i et vedligeholdelsesvindue for målet? */
  function withinMaintenanceWindow({ target, environment, at = clock() }) {
    return maintenanceWindows.filter((w) => {
      if (w.environment && w.environment !== environment) return false;
      const start = Date.parse(w.start);
      const end = Date.parse(w.end);
      if (!(at >= start && at < end)) return false;
      const targets = w.targets ?? [];
      if (targets.includes("*")) return true;
      return targets.some((pattern) => pattern === target || pattern.endsWith("/*") && String(target).startsWith(pattern.slice(0, -1)));
    });
  }

  /**
   * Find aktive changes der overlapper det ønskede tidsrum på samme mål.
   * Terminale changes tælles ikke.
   */
  function conflicts({ targets = [], environment = null, start, end, excludeChangeId = null }) {
    const wantedTargets = new Set(targets.map(normalizeTarget));
    const from = Date.parse(start);
    const to = Date.parse(end);
    const found = [];
    for (const change of changeRecords.values()) {
      if (excludeChangeId && change.id === excludeChangeId) continue;
      if (TERMINAL_STATES.has(change.state)) continue;
      if (environment && change.environment && change.environment !== environment) continue;
      const overlapTarget = (change.targets ?? []).some((t) => wantedTargets.has(normalizeTarget(t)));
      if (!overlapTarget) continue;
      const cStart = Date.parse(change.window?.start ?? change.createdAt);
      const cEnd = Date.parse(change.window?.end ?? change.createdAt);
      if (cStart < to && cEnd > from) found.push(change);
    }
    return found;
  }

  /**
   * Tag en atomisk lås på hvert mål. Returnerer `{ ok:false, heldBy }` hvis
   * nogen af låsene allerede holdes af en anden change. Er der taget nogle låse
   * og en senere fejler, frigives de igen, så vi ikke efterlader delvise låse.
   */
  function acquireLocks({ targets = [], changeId, ttlSeconds = 900, at = clock() }) {
    const acquired = [];
    for (const target of targets) {
      const key = lockKey(target);
      const record = { changeId, target: normalizeTarget(target), acquiredAt: at, expiresAt: at + ttlSeconds * 1000 };
      const existing = locks.read(key);
      if (existing && existing.expiresAt <= at) locks.remove(key);
      const ok = locks.create(key, record);
      if (!ok) {
        for (const held of acquired) locks.remove(held);
        const holder = locks.read(key);
        return { ok: false, heldBy: holder?.changeId ?? "ukendt", target, acquired };
      }
      acquired.push(key);
    }
    return { ok: true, acquired };
  }

  function releaseLocks({ targets = [], changeId }) {
    const released = [];
    for (const target of targets) {
      const key = lockKey(target);
      const held = locks.read(key);
      if (held && held.changeId === changeId) {
        locks.remove(key);
        released.push(key);
      }
    }
    return released;
  }

  function upsertChange(change) {
    changeRecords.set(change.id, structuredClone(change));
    return change;
  }

  function getChange(id) {
    const value = changeRecords.get(id);
    return value ? structuredClone(value) : null;
  }

  function listChanges() {
    return [...changeRecords.values()].map((c) => structuredClone(c));
  }

  function registerWindow(window) {
    maintenanceWindows.push({ ...window, targets: [...(window.targets ?? [])] });
    return window;
  }

  return {
    kind: "change-calendar",
    lockStore: locks,
    maintenanceWindows,
    withinMaintenanceWindow,
    conflicts,
    acquireLocks,
    releaseLocks,
    activeLocks,
    upsertChange,
    getChange,
    listChanges,
    registerWindow,
  };
}
