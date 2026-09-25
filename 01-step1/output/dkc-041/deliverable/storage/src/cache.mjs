/**
 * DKC-041 — genopbyggeligt cache-lag.
 *
 * Cachen ligger i sin **egen** mappe, er pr. tenant og kan smides væk uden at
 * røre det autoritative lager. Den er klassificeret som `cache` i planen:
 * `durable: false`, `rebuildable: true`. En cache-fejl må derfor aldrig ændre
 * autoritative data — det er hele formålet med at skille den ud.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";

export class CacheError extends Error {
  constructor(message, code = "cache_error") {
    super(message);
    this.name = "CacheError";
    this.code = code;
  }
}

export function createEphemeralCache({ rootDir } = {}) {
  if (!rootDir) throw new CacheError("createEphemeralCache kræver en rootDir", "missing_root");
  const keyHash = (key) => createHash("sha256").update(String(key)).digest("hex");
  const fileFor = (tenantId, key) => join(rootDir, normalizeTenantId(tenantId), `${keyHash(key)}.json`);

  return {
    kind: "ephemeral-cache",
    rootDir,
    durable: false,
    rebuildable: true,

    set(tenantIdRaw, key, value, { now = Date.now() } = {}) {
      const tenantId = normalizeTenantId(tenantIdRaw);
      const path = fileFor(tenantId, key);
      mkdirSync(join(rootDir, tenantId), { recursive: true });
      writeFileSync(path, JSON.stringify({ tenantId, key, value, cachedAt: new Date(now).toISOString() }));
      return { cached: true, tenantId, key };
    },

    get(tenantIdRaw, key) {
      const tenantId = normalizeTenantId(tenantIdRaw);
      const path = fileFor(tenantId, key);
      if (!existsSync(path)) return null;
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return parsed.value;
    },

    has(tenantIdRaw, key) {
      return existsSync(fileFor(normalizeTenantId(tenantIdRaw), key));
    },

    /** Smid hele cachen væk. Autoritative data ligger et andet sted. */
    drop() {
      rmSync(rootDir, { recursive: true, force: true });
      return { dropped: true, rootDir };
    },
  };
}
