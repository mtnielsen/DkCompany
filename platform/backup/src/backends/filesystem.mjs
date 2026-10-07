/**
 * DKC-057 — filsystem-backend for et backupmål.
 *
 * Backenden bruges til et lokalt/monteret mål (fx en separat disk eller et
 * netværksmount) og til tests. Den er bevidst den samme kontrakt som den
 * eksterne objektlager-backend, så preflight, canary og synkronisering er
 * backend-uafhængige.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BackupTargetError } from "../errors.mjs";

function safeKey(key) {
  const clean = String(key ?? "").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => part === "..")) {
    throw new BackupTargetError(`ugyldig objektnøgle '${key}'`, "target_error");
  }
  return clean;
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function createFilesystemBackend({ rootDir, clock = () => Date.now() } = {}) {
  if (!rootDir) throw new BackupTargetError("createFilesystemBackend kræver en rootDir", "target_error");
  const resolve = (key) => join(rootDir, safeKey(key));

  return {
    kind: "filesystem-backend",
    rootDir,
    storeContainsKey: false,

    capabilities() {
      return { read: true, write: true, list: true, versioning: false, objectLock: false, objectLockMode: null, minRetentionDays: null };
    },

    async headBucket() {
      try {
        mkdirSync(rootDir, { recursive: true });
        return { region: "filesystem", bucket: rootDir };
      } catch (err) {
        throw new BackupTargetError(`kunne ikke åbne backupmålet: ${err.message}`, "backend_error", { cause: err });
      }
    },

    async putObject(key, buffer) {
      const path = resolve(key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buffer);
      return { key: safeKey(key), bytes: buffer.length, etag: sha256Hex(buffer).slice(0, 32) };
    },

    async getObject(key) {
      const path = resolve(key);
      if (!existsSync(path)) throw new BackupTargetError(`objektet '${key}' findes ikke`, "not_found");
      return readFileSync(path);
    },

    async headObject(key) {
      const path = resolve(key);
      if (!existsSync(path)) return null;
      return { key: safeKey(key), bytes: statSync(path).size, etag: sha256Hex(readFileSync(path)).slice(0, 32) };
    },

    async listObjects(prefix = "") {
      if (!existsSync(rootDir)) return [];
      const out = [];
      const walk = (abs, rel) => {
        for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const childRel = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(join(abs, entry.name), childRel);
          else if (entry.isFile()) out.push({ key: childRel, bytes: statSync(join(abs, entry.name)).size });
        }
      };
      walk(rootDir, "");
      return out.filter((object) => object.key.startsWith(prefix));
    },

    async deleteObject(key) {
      const path = resolve(key);
      if (!existsSync(path)) return false;
      rmSync(path, { force: true });
      return true;
    },

    /** Read-only preflight: findes målet, og kan der listes? */
    async preflight() {
      const checks = [];
      const errors = [];
      try {
        await this.headBucket();
        checks.push({ name: "bucket", status: "pass", detail: "backupmålet er tilgængeligt" });
      } catch (err) {
        checks.push({ name: "bucket", status: "fail", detail: err.message });
        errors.push(err);
      }
      return { ok: errors.length === 0, checks, errors, capabilities: this.capabilities() };
    },

    _clock: clock,
  };
}
