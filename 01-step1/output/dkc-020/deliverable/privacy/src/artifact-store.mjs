/**
 * DKC-020 — artefaktlager for sikrede eksporter.
 *
 * Selve eksportens persondata ligger i et artefakt, ikke i DSAR-registeret.
 * Dermed bliver registeret ikke selv et nyt personregister, og en eksport kan
 * udløbe, tilbagekaldes og revideres via metadata alene.
 *
 * Denne offline-implementering holder artefakterne i hukommelsen. En rigtig
 * deployment bruger en krypteret objektbutik; interfacet (`put`/`get`) er det
 * samme.
 */
import { createHash } from "node:crypto";

function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

export function createMemoryArtifactStore() {
  const objects = new Map();
  return {
    kind: "memory-artifact-store",
    put(uri, value) {
      const raw = JSON.stringify(value, null, 2);
      objects.set(uri, raw);
      return { uri, sha256: sha256(raw), bytes: Buffer.byteLength(raw) };
    },
    get(uri) {
      const raw = objects.get(uri);
      if (raw === undefined) throw new Error(`ukendt artefakt '${uri}'`);
      return JSON.parse(raw);
    },
    raw(uri) {
      return objects.get(uri) ?? null;
    },
    digest(uri) {
      const raw = objects.get(uri);
      return raw === undefined ? null : sha256(raw);
    },
  };
}

export { sha256 };
