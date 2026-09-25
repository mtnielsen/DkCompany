/**
 * DKC-041 — genopbyggeligt indeks.
 *
 * Indekset er en afledt struktur over det autoritative lager: det kan
 * genopbygges deterministisk fra objekterne og er klassificeret som
 * `rebuildable`. Det ligger på ephemeral disk, og et tab ændrer ikke de
 * autoritative objekter — kun opslagsmuligheden, indtil indekset er bygget igen.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";

export class IndexError extends Error {
  constructor(message, code = "index_error") {
    super(message);
    this.name = "IndexError";
    this.code = code;
  }
}

export function createRebuildableIndex({ store, rootDir } = {}) {
  if (!store) throw new IndexError("createRebuildableIndex kræver en objektlager-instans", "missing_store");
  if (!rootDir) throw new IndexError("createRebuildableIndex kræver en rootDir", "missing_root");
  const indexPath = (tenantId) => join(rootDir, `${normalizeTenantId(tenantId)}.index.json`);

  return {
    kind: "rebuildable-index",
    rootDir,
    rebuildable: true,
    ephemeral: true,

    /** Byg indekset deterministisk fra lagerets objekter for én tenant. */
    build(tenantIdRaw, { now = Date.now() } = {}) {
      const tenantId = normalizeTenantId(tenantIdRaw);
      const entries = [];
      for (const item of store.list(tenantId)) {
        const object = store.get(tenantId, item.key);
        entries.push({ key: item.key, classification: item.classification, version: object.version, sha256: object.sha256, bytes: object.bytes });
      }
      entries.sort((a, b) => a.key.localeCompare(b.key));
      const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
      mkdirSync(dirname(indexPath(tenantId)), { recursive: true });
      writeFileSync(indexPath(tenantId), JSON.stringify({ tenantId, generatedAt: new Date(now).toISOString(), digest, entries }, null, 2) + "\n");
      return { tenantId, entries: entries.length, digest, path: indexPath(tenantId) };
    },

    lookup(tenantIdRaw, key) {
      const tenantId = normalizeTenantId(tenantIdRaw);
      const path = indexPath(tenantId);
      if (!existsSync(path)) return null;
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      return parsed.entries.find((e) => e.key === key) ?? null;
    },

    drop(tenantIdRaw) {
      rmSync(indexPath(normalizeTenantId(tenantIdRaw)), { force: true });
      return { dropped: true };
    },
  };
}
