import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll } from "../src/model.mjs";
import { buildCoverage } from "../src/coverage.mjs";
import { FileMigrationStore } from "../src/store.mjs";

export const AT = "2026-03-01T00:00:00Z";

export const PRINCIPALS = {
  ada: { kind: "human", id: "oidc|ada.acme", name: "Ada Acme", tenantId: "acme", roles: ["content-admin", "crm-admin", "project-admin", "knowledge-admin", "support-admin"], clearance: "confidential" },
  ben: { kind: "human", id: "oidc|ben.acme", name: "Ben Acme", tenantId: "acme", roles: ["content-auditor"], clearance: "internal" },
  gus: { kind: "human", id: "oidc|gus.globex", name: "Gus Globex", tenantId: "globex", roles: ["crm-admin"], clearance: "internal" },
  operator: { kind: "human", id: "oidc|ola.operator", name: "Ola Operator", tenantId: "acme", roles: ["platform-admin:acme"], clearance: "internal" },
};

export function fixture() {
  const all = loadAll(repoRoot);
  const coverage = buildCoverage({ sources: all.sources, at: AT });
  const root = mkdtempSync(join(tmpdir(), "dkc031-test-"));
  const store = FileMigrationStore.open(root);
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));
  const sourceById = (id) => {
    const source = all.sources.sources.find((s) => s.id === id);
    if (!source) throw new Error(`kilden '${id}' findes ikke`);
    return source;
  };
  const objectsFor = (source) => all.corpus.objects.filter((o) => o.appId === source.appId && o.tenantId === source.tenantId);
  const cleanup = () => rmSync(store.root, { recursive: true, force: true });
  return { all, coverage, store, sourceById, objectsFor, cleanup };
}
