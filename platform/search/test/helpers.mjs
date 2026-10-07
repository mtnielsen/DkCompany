import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll } from "../src/model.mjs";
import { FileKnowledgeIndex } from "../src/index-store.mjs";
import { createBookstackClient } from "../src/bookstack.mjs";
import { createMockBookstack } from "../src/mock-bookstack.mjs";
import { syncSource } from "../src/ingest.mjs";

export const EMPLOYEE = { kind: "human", id: "oidc|bo.bertelsen", tenantId: "acme", groups: ["acme"], roles: ["employee"], clearance: "internal" };
export const HR = { kind: "human", id: "oidc|carla.christensen", tenantId: "acme", groups: ["acme", "hr"], roles: ["hr-specialist"], clearance: "special-category" };
export const GLOBEX = { kind: "human", id: "oidc|gus.globex", tenantId: "globex", groups: ["globex"], roles: ["support"], clearance: "confidential" };

/** Start en mock-upstream, et filindeks og synkronisér alle kilder. */
export async function setupSearch({ at = "2026-03-01T00:00:00Z" } = {}) {
  const all = loadAll(repoRoot);
  const mock = createMockBookstack({ corpus: all.corpus });
  const port = await mock.listen(0);
  const index = FileKnowledgeIndex.open(mkdtempSync(join(tmpdir(), "dkc028-test-")));
  for (const source of all.sources.sources) {
    const token = all.corpus.tenants[source.tenantId]?.token ?? "missing";
    const client = createBookstackClient({ baseUrl: `http://127.0.0.1:${port}`, token });
    await syncSource({ client, source, index, at });
  }
  const aclFor = (doc) => mock.getPage(doc.tenantId, doc.externalId)?.permissions ?? null;
  return {
    all,
    mock,
    index,
    aclFor,
    close: async () => {
      await mock.close();
      rmSync(index.root, { recursive: true, force: true });
    },
  };
}
