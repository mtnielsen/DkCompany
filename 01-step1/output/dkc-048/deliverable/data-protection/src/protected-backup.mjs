/**
 * DKC-048 — backup/restore af beskyttet tilstand.
 *
 * En gendannelse må ikke kun give bytes tilbage: versioner, WORM-låse og
 * adgangsregler skal bevares, ellers kan en gendannelse bruges til at omgå
 * beskyttelsen. Denne model eksporterer den fulde beskyttede tilstand
 * (versioner, låse, autoritativ pointer og den håndhævede politik) og kan
 * importere den igen i et rent lager, så versioner og låse genskabes.
 */
import { createHash } from "node:crypto";

export function exportProtectedState({ store, tenantId, policy = null, clock = () => Date.now() } = {}) {
  if (!store) throw new Error("exportProtectedState kræver en lagerinstans");
  const items = [];
  for (const entry of store.list(tenantId)) {
    const versions = store.versions(tenantId, entry.key);
    const authoritative = store.authoritative(tenantId, entry.key);
    const payloads = versions.map((v) => ({ version: v.version, buffer: store.get(tenantId, entry.key, { version: v.version }).buffer }));
    items.push({ key: entry.key, versions, authoritative, payloads });
  }
  items.sort((a, b) => a.key.localeCompare(b.key));
  const digest = createHash("sha256").update(JSON.stringify(items.map((i) => ({ key: i.key, versions: i.versions, authoritative: i.authoritative.version })))).digest("hex");
  return {
    kind: "protected-state-export",
    tenantId,
    exportedAt: new Date(clock()).toISOString(),
    digest,
    policy,
    items,
  };
}

export function importProtectedState({ store, state, tenantId = null, clock = () => Date.now() } = {}) {
  if (!store) throw new Error("importProtectedState kræver en lagerinstans");
  if (!state) throw new Error("importProtectedState kræver en eksporteret tilstand");
  const target = tenantId ?? state.tenantId;
  const at = clock();
  const restored = [];
  for (const item of state.items) {
    const ordered = [...item.payloads].sort((a, b) => a.version - b.version);
    let last = null;
    for (const payload of ordered) {
      const result = store.put(target, item.key, payload.buffer, { classification: "object-store", now: at });
      if (!result.committed) throw new Error(`gendannelse af '${item.key}' version ${payload.version} fejlede: ${result.reason}`);
      last = result.version;
    }
    // Genskab låse på de oprindelige versionsnumre.
    for (const version of item.versions) {
      if (!version.lock) continue;
      const lock = store.lockVersion(target, item.key, version.version, { mode: version.lock.mode, retainUntil: version.lock.retainUntil, now: at });
      if (!lock.committed) throw new Error(`kunne ikke genskabe lås på '${item.key}' version ${version.version}: ${lock.reason}`);
    }
    const authoritative = store.authoritative(target, item.key);
    restored.push({ key: item.key, versions: ordered.length, latest: last, authoritative: authoritative.version, locks: item.versions.filter((v) => v.lock).length });
  }
  return { kind: "protected-state-restore", tenantId: target, restored, policyPreserved: Boolean(state.policy) };
}

/** Sammenlign eksporteret og gendannet tilstand for versions- og låsebevarelse. */
export function compareProtectedState(exported, restored) {
  const problems = [];
  const byKey = new Map(restored.restored.map((r) => [r.key, r]));
  for (const item of exported.items) {
    const r = byKey.get(item.key);
    if (!r) {
      problems.push({ key: item.key, reason: "missing-after-restore" });
      continue;
    }
    if (r.versions !== item.payloads.length) problems.push({ key: item.key, reason: "version-count-mismatch" });
    if (r.authoritative !== item.authoritative.version) problems.push({ key: item.key, reason: "authoritative-pointer-mismatch" });
    if (r.locks !== item.versions.filter((v) => v.lock).length) problems.push({ key: item.key, reason: "lock-count-mismatch" });
  }
  return { ok: problems.length === 0, problems };
}
