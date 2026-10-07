/**
 * DKC-016 — separat nøgleadgang.
 *
 * Backupen ligger i et lager; krypteringsnøglen ligger i et **andet** magasin.
 * En operatør der kan læse backup-lageret kan derfor ikke dekryptere det uden
 * nøglen, og en nøgleprovider rapporterer eksplicit at den ikke er en del af
 * lageret (`storeContainsKey: false`). Nøglen skrives kun med mode 0600 og
 * forlader aldrig processen i klartekst gennem manifestet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export class KeyAccessError extends Error {
  constructor(message, code = "key_access_denied") {
    super(message);
    this.name = "KeyAccessError";
    this.code = code;
  }
}

function assertKeyId(keyId) {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(String(keyId ?? ""))) {
    throw new KeyAccessError(`ugyldigt nøgle-id '${keyId}'`, "bad_key_id");
  }
}

/** Nøgleprovider der læser nøglen fra en mappe uden for backup-lageret. */
export function createFileKeyProvider({ keyDir, keyId = "backup", create = false } = {}) {
  if (!keyDir) throw new KeyAccessError("createFileKeyProvider kræver en keyDir uden for backup-lageret", "missing_key_dir");
  assertKeyId(keyId);
  const keyPath = join(keyDir, `${keyId}.key`);

  function ensureKey() {
    if (existsSync(keyPath)) return;
    if (!create) {
      throw new KeyAccessError(`backup-nøglen '${keyId}' findes ikke i det separate nøglemagasin`, "key_not_found");
    }
    mkdirSync(keyDir, { recursive: true });
    writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
  }

  return {
    kind: "file-key-provider",
    keyId,
    keyDir,
    keyPath,
    storeContainsKey: false,
    exists: () => existsSync(keyPath),
    getKey() {
      ensureKey();
      return readFileSync(keyPath, "utf8").trim();
    },
  };
}

/** In-memory nøgleprovider til tests og til kortlivede jobprocesser. */
export function createMemoryKeyProvider({ key = randomBytes(32).toString("hex"), keyId = "backup" } = {}) {
  assertKeyId(keyId);
  let current = key;
  return {
    kind: "memory-key-provider",
    keyId,
    storeContainsKey: false,
    exists: () => true,
    getKey: () => current,
    /** Rotation bruges kun i tests; i drift leveres nøglen af KMS/secret-store. */
    rotate: (next) => {
      current = next ?? randomBytes(32).toString("hex");
      return current;
    },
  };
}
