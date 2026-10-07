/**
 * DKC-048 — verifikation af storage-produktets faktiske WORM-semantik.
 *
 * S3-kompatibilitet alene er ikke et WORM-bevis. Denne verifikation udfører
 * negative håndhævelsestests mod en konkret lagerinstans: en aktiv
 * COMPLIANCE-lås skal afvise sletning, retention må ikke kunne forkortes, en ny
 * version må ikke skjule den autoritative låste version, og en GOVERNANCE-lås
 * skal kunne ses og kun brydes med et eksplicit flag.
 *
 * Resultatet er en deterministisk selvtest (`verifiedByHuman: false`); en målt
 * verifikation på et levende storage-produkt kræver en uafhængig kørsel og er
 * `integration-immutable-live` (NOT RUN).
 */
export function verifyStorageSemantics({ store, policy, clock = () => Date.now(), now = null } = {}) {
  if (!store) throw new Error("verifyStorageSemantics kræver en lagerinstans");
  const at = now ?? clock();
  const tenantId = "semantics-verify";
  const checks = [];
  const push = (id, expectation, actual, ok) => checks.push({ id, expectation, actual, ok });

  const key = `verify/${at}.bin`;
  const first = store.put(tenantId, key, Buffer.from("autoritativ-version-1"), { classification: "object-store", now: at });
  if (!first.committed) throw new Error(`kunne ikke skrive verifikationsobjekt: ${first.reason}`);

  // 1) Læg en aktiv COMPLIANCE-lås.
  const retainUntil = new Date(at + 10 * 365 * 24 * 3600 * 1000).toISOString();
  const locked = store.lockVersion(tenantId, key, first.version, { mode: "COMPLIANCE", retainUntil, now: at });
  push("compliance-lock-applied", "locked", locked.committed === true, locked.committed === true);

  // 2) Sletning af en aktiv COMPLIANCE-lås skal afvises.
  const deleteAttempt = store.deleteVersion(tenantId, key, first.version, { now: at });
  push("delete-compliance-locked", "denied", deleteAttempt.reason === "compliance-locked" ? "denied" : deleteAttempt.reason, deleteAttempt.deleted === false && deleteAttempt.reason === "compliance-locked");

  // 3) Retention må ikke forkortes.
  const shorten = store.lockVersion(tenantId, key, first.version, { mode: "COMPLIANCE", retainUntil: new Date(at + 24 * 3600 * 1000).toISOString(), now: at });
  push("shorten-retention", "denied", shorten.reason ?? "extended", shorten.committed === false && shorten.reason === "retention-shorten");

  // 4) En ny version må ikke skjule den autoritative låste version.
  const second = store.put(tenantId, key, Buffer.from("ny-version-2"), { classification: "object-store", now: at + 1000 });
  const authoritative = store.authoritative(tenantId, key);
  const readAuthoritative = store.getAuthoritative(tenantId, key);
  push("new-version-does-not-hide-locked", "preserved", authoritative.version === first.version ? "preserved" : `latest=${authoritative.version}`, second.committed === true && authoritative.version === first.version && authoritative.locked === true && readAuthoritative.buffer.toString() === "autoritativ-version-1");

  // 5) GOVERNANCE-lås kan ikke brydes uden bypass-flag, men kan med.
  const govKey = `verify/gov-${at}.bin`;
  const govPut = store.put(tenantId, govKey, Buffer.from("governance"), { classification: "object-store", now: at });
  store.lockVersion(tenantId, govKey, govPut.version, { mode: "GOVERNANCE", retainUntil, now: at });
  const govNoBypass = store.deleteVersion(tenantId, govKey, govPut.version, { now: at });
  const govBypass = store.deleteVersion(tenantId, govKey, govPut.version, { bypassGovernance: true, now: at });
  push("governance-bypass-requires-flag", "denied", govNoBypass.reason === "governance-locked" ? "denied" : govNoBypass.reason, govNoBypass.deleted === false);
  push("governance-bypass-with-flag", "audited", govBypass.deleted === true ? "deleted" : govBypass.reason, govBypass.deleted === true);

  // 6) COMPLIANCE kan ikke omgås, heller ikke med bypass-flag.
  const complianceBypass = store.deleteVersion(tenantId, key, first.version, { bypassGovernance: true, now: at });
  push("compliance-non-bypassable", "denied", complianceBypass.deleted === false ? "denied" : "deleted", complianceBypass.deleted === false && complianceBypass.reason === "compliance-locked");

  // Ryd op: låsens levetid er lang, så vi kan ikke slette; brug en separat fixture-dir i tests.
  return {
    product: policy?.storageProduct?.name ?? null,
    method: "negative-enforcement-tests",
    verifiedByHuman: false,
    requiresLiveVerification: true,
    checks,
    ok: checks.every((c) => c.ok),
  };
}
