/**
 * DKC-016 — krypteret backupbeholder.
 *
 * En backup er en mappe med:
 *   - `manifest.json` (metadata, checksums og nøgle-id — aldrig nøglen),
 *   - `components/*.enc` (AES-256-GCM-krypterede komponenter).
 *
 * Database, objekter og konfiguration krypteres hver for sig, så en enkelt
 * komponent kan verificeres og gendannes uafhængigt. Manifestet bærer
 * klartekst-digesten og chiffertekst-digesten pr. komponent samt en samlet
 * manifestdigest, så både indhold, rækkefølge og metadata kan verificeres.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { backupDatabase } from "../../persistence/src/index.mjs";
import { redactSecrets } from "../../persistence/src/redact.mjs";
import { digestOf } from "../../persistence/src/adapters/data-register.mjs";
import { decryptComponent, encryptComponent, sha256Hex } from "./crypto.mjs";
import { collectObjectFiles } from "./objects.mjs";

export class BackupIntegrityError extends Error {
  constructor(message, code = "backup_integrity") {
    super(message);
    this.name = "BackupIntegrityError";
    this.code = code;
  }
}

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Beregn manifestdigesten. `manifestDigest`-feltet indgår som null. */
export function computeManifestDigest(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));
  clone.checksums = { ...clone.checksums, manifestDigest: null };
  return digestOf(clone);
}

function componentAad(manifest, component) {
  return `${manifest.backupId}:${component.kind}:${component.name}`;
}

function writeComponent({ storeDir, manifest, key, keyId, kind, name, plaintext }) {
  const encryption = encryptComponent(plaintext, key, { aad: `${manifest.backupId}:${kind}:${name}` });
  const fileName = `${safeName(kind)}-${safeName(name)}.enc`;
  mkdirSync(join(storeDir, "components"), { recursive: true });
  writeFileSync(join(storeDir, "components", fileName), encryption.ciphertext);
  return {
    kind,
    name,
    uri: `components/${fileName}`,
    sha256: sha256Hex(plaintext),
    bytes: plaintext.length,
    ciphertextSha256: sha256Hex(encryption.ciphertext),
    bytesEncrypted: encryption.ciphertext.length,
    encryption: { algorithm: "aes-256-gcm", keyId, iv: encryption.iv, authTag: encryption.authTag },
  };
}

/**
 * Tag en krypteret backup af database, konfiguration og objekter.
 *
 * @returns {Promise<{manifest: object, storeDir: string}>}
 */
export async function createBackup({
  db,
  tenantId,
  outDir,
  keyProvider,
  suppressionLedger,
  source = {},
  config = null,
  objectDir = null,
  objectFiles = [],
  retentionDays = 365,
  rpoTargetMinutes = 0,
  rtoTargetMinutes = 60,
  restoreOrder = ["database", "config", "objects"],
  auditRef = null,
  backupId = randomUUID(),
  clock = () => Date.now(),
} = {}) {
  if (!db) throw new BackupIntegrityError("createBackup kræver en database", "missing_db");
  if (!outDir) throw new BackupIntegrityError("createBackup kræver en udbakke (outDir)", "missing_out_dir");
  if (!keyProvider) throw new BackupIntegrityError("createBackup kræver en nøgleprovider", "missing_key_provider");
  if (!suppressionLedger) throw new BackupIntegrityError("createBackup kræver en suppressionsjournal", "missing_suppression_ledger");

  mkdirSync(outDir, { recursive: true });
  const key = keyProvider.getKey();
  const createdAt = new Date(clock()).toISOString();
  const components = [];

  // 1) Database: konsistent snapshot via SQLite's online-backup, derefter krypteret.
  const tmpDb = join(outDir, `.snapshot-${backupId}.db`);
  await backupDatabase(db, tmpDb);
  const dbBytes = readFileSync(tmpDb);
  rmSync(tmpDb, { force: true });
  components.push(writeComponent({ storeDir: outDir, manifest: { backupId }, key, keyId: keyProvider.keyId, kind: "database", name: "database", plaintext: dbBytes }));

  // 2) Nødvendig konfiguration: hemmeligheder redigeres væk før kryptering.
  if (config !== null) {
    const sanitized = redactSecrets(config);
    const cfgBytes = Buffer.from(JSON.stringify(sanitized, null, 2), "utf8");
    components.push(writeComponent({ storeDir: outDir, manifest: { backupId }, key, keyId: keyProvider.keyId, kind: "config", name: "config", plaintext: cfgBytes }));
  }

  // 3) Objekter.
  const files = objectFiles.length ? objectFiles : collectObjectFiles(objectDir);
  for (const file of files) {
    components.push(writeComponent({ storeDir: outDir, manifest: { backupId }, key, keyId: keyProvider.keyId, kind: "objects", name: file.name, plaintext: file.bytes }));
  }

  const manifest = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "BackupManifest",
    backupId,
    tenantId: tenantId ?? null,
    createdAt,
    source: {
      moduleRef: source.moduleRef ?? "platform",
      serviceClassRef: source.serviceClassRef ?? null,
      engine: source.engine ?? "sqlite",
      schemaVersion: String(source.schemaVersion ?? "10"),
      snapshotMethod: source.snapshotMethod ?? "sqlite-online-backup",
    },
    encryption: { algorithm: "aes-256-gcm", keyId: keyProvider.keyId, keySeparated: true, storeContainsKey: false },
    components,
    checksums: { algorithm: "sha256", manifestDigest: null },
    suppression: { ledgerRef: suppressionLedger.path, ledgerDigest: suppressionLedger.head() },
    objectives: { rpoTargetMinutes, rtoTargetMinutes, restoreOrder },
    retentionDays,
    auditRef: auditRef ?? `audit:backup.create.${backupId}`,
  };
  manifest.checksums.manifestDigest = computeManifestDigest(manifest);
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return { manifest, storeDir: outDir };
}

/** Læs og verificér en backup. Returnerer komponenter i klartekst (i hukommelsen). */
export function readBackup({ storeDir, manifest, keyProvider } = {}) {
  if (!storeDir || !manifest) throw new BackupIntegrityError("readBackup kræver storeDir og manifest", "missing_args");
  if (!keyProvider) throw new BackupIntegrityError("readBackup kræver en nøgleprovider", "missing_key_provider");
  const expected = computeManifestDigest(manifest);
  if (manifest?.checksums?.manifestDigest !== expected) {
    throw new BackupIntegrityError("manifestdigesten matcher ikke manifestets indhold", "manifest_digest_mismatch");
  }
  const key = keyProvider.getKey();
  const out = {};
  for (const component of manifest.components ?? []) {
    const path = join(storeDir, component.uri);
    if (!existsSync(path)) throw new BackupIntegrityError(`komponenten '${component.name}' mangler i lageret`, "component_missing");
    const ciphertext = readFileSync(path);
    if (sha256Hex(ciphertext) !== component.ciphertextSha256) {
      throw new BackupIntegrityError(`chifferteksten for '${component.name}' er ændret`, "ciphertext_changed");
    }
    const plaintext = decryptComponent(
      { ciphertext, iv: component.encryption.iv, authTag: component.encryption.authTag },
      key,
      { aad: componentAad(manifest, component) }
    );
    if (sha256Hex(plaintext) !== component.sha256) {
      throw new BackupIntegrityError(`klarteksten for '${component.name}' matcher ikke digesten`, "plaintext_changed");
    }
    out[component.name] = { kind: component.kind, name: component.name, buffer: plaintext };
  }
  return out;
}
