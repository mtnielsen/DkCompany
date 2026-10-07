/**
 * DKC-021 — legal hold-register.
 *
 * Et hold er en begrundet, godkendt blokering af sletning inden for en
 * dokumenteret scope. Modulet indeholder:
 *
 *   - den rene validering (`legalHoldProblems`): begrundelse, et navngivet
 *     menneske der lægger holdet, og en **separat** navngivet godkender,
 *   - et holdbart, tenant-bundet register (`createMemoryRetentionStore`) til
 *     tests, CLI og demo. Den SQLite-baserede variant ligger i
 *     `persistence/src/adapters/retention.mjs` med samme interface.
 *
 * Reglen er fail-closed: kan et hold ikke godkendes af et andet menneske,
 * afvises det, og en aktiv hold-dækning blokerer enhver sletning i scope.
 */
import { createHash } from "node:crypto";

export class HoldError extends Error {
  constructor(message, code = "hold_error") {
    super(message);
    this.name = "HoldError";
    this.code = code;
  }
}

const DIGEST_RE = /^[a-f0-9]{64}$/;

/** SHA-256 af en kanoniseret subjektnøgle; rå identifikatorer gemmes aldrig. */
export function subjectDigestOf(subjectKey) {
  const canonical = typeof subjectKey === "string" ? subjectKey : JSON.stringify(subjectKey ?? null);
  return createHash("sha256").update(canonical).digest("hex");
}

function isNamedHuman(value) {
  return Boolean(value && typeof value.subject === "string" && value.subject.trim() && typeof value.name === "string" && value.name.trim().length >= 2 && typeof value.role === "string" && value.role.trim());
}

/** Semantiske problemer for en LegalHold. Tom liste = gyldig. */
export function legalHoldProblems(hold) {
  const problems = [];
  if (!hold || typeof hold !== "object") return [{ path: "/", message: "holdet mangler" }];
  const push = (path, message) => problems.push({ path, message });
  if (!DIGEST_RE.test(String(hold.subjectDigest ?? ""))) push("/subjectDigest", "subjektets digest skal være en SHA-256");
  if (!(hold.reason ?? "").trim() || String(hold.reason).trim().length < 10) push("/reason", "et hold skal have en dokumenteret begrundelse på mindst 10 tegn");
  if (!isNamedHuman(hold.placedBy)) push("/placedBy", "holdet skal være lagt af et navngivet menneske");
  if (!isNamedHuman(hold.approvedBy)) push("/approvedBy", "holdet skal være godkendt af et navngivet menneske");
  if (isNamedHuman(hold.placedBy) && isNamedHuman(hold.approvedBy) && hold.placedBy.subject === hold.approvedBy.subject) {
    push("/approvedBy", "den der lægger holdet må ikke godkende det selv (to-personers kontrol)");
  }
  if (!(hold.dataClasses ?? []).length) push("/dataClasses", "holdet skal angive hvilke dataklasser det dækker");
  if (hold.status === "released") {
    if (!isNamedHuman(hold.releasedBy)) push("/releasedBy", "et frigivet hold skal angive hvem der frigav det");
    if (!(hold.releasedAt ?? "").trim()) push("/releasedAt", "et frigivet hold skal angive hvornår");
    if (!(hold.releaseReason ?? "").trim() || String(hold.releaseReason).trim().length < 10) push("/releaseReason", "frigivelse kræver en begrundelse");
  }
  return problems;
}

/** Dækker et aktivt hold subjektet og mindst én af de efterspurgte dataklasser? */
export function holdCovers(hold, { subjectDigest, dataClasses = [] } = {}) {
  if (hold.status !== "active") return false;
  if (hold.subjectDigest !== subjectDigest) return false;
  if (!dataClasses.length) return true;
  const covered = new Set(hold.dataClasses ?? []);
  return dataClasses.some((c) => covered.has(c));
}

/** Byg et nyt, aktivt hold med en genereret id. */
export function buildHold({ tenantId, subjectDigest, dataClasses, moduleRef = null, reason, placedBy, approvedBy, reviewAt = null, holdId = null, now = Date.now() } = {}) {
  const hold = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "LegalHold",
    holdId: holdId ?? `hold:${tenantId}:${subjectDigest.slice(0, 12)}:${new Date(now).toISOString()}`,
    tenantId,
    subjectDigest,
    dataClasses: [...new Set(dataClasses ?? [])].sort(),
    moduleRef,
    reason,
    placedBy,
    approvedBy,
    placedAt: new Date(now).toISOString(),
    reviewAt,
    status: "active",
  };
  const problems = legalHoldProblems(hold);
  if (problems.length) throw new HoldError(`holdet er ugyldigt:\n  - ${problems.map((p) => `${p.path} ${p.message}`).join("\n  - ")}`, "hold_invalid");
  return hold;
}

/**
 * In-memory hold- og kvitteringsregister med samme interface som den SQLite-
 * baserede adapter. Tenant-bundet: hver metode filtrerer eksplicit på tenant.
 */
export function createMemoryRetentionStore({ clock = () => Date.now() } = {}) {
  const holds = new Map();
  const receipts = new Map();
  const gates = new Map();

  return {
    kind: "memory-retention-store",

    placeHold(tenantId, hold) {
      const problems = legalHoldProblems(hold);
      if (problems.length) throw new HoldError(problems.map((p) => `${p.path} ${p.message}`).join("; "), "hold_invalid");
      holds.set(`${tenantId}:${hold.holdId}`, structuredClone(hold));
      return structuredClone(hold);
    },
    getHold: (tenantId, holdId) => {
      const found = holds.get(`${tenantId}:${holdId}`);
      return found ? structuredClone(found) : null;
    },
    listHolds(tenantId, { includeReleased = false, subjectDigest = null } = {}) {
      return [...holds.values()]
        .filter((h) => h.tenantId === tenantId)
        .filter((h) => includeReleased || h.status === "active")
        .filter((h) => (subjectDigest ? h.subjectDigest === subjectDigest : true))
        .map((h) => structuredClone(h))
        .sort((a, b) => a.placedAt.localeCompare(b.placedAt));
    },
    activeHoldsFor(tenantId, { subjectDigest, dataClasses = [] } = {}) {
      return [...holds.values()]
        .filter((h) => h.tenantId === tenantId && holdCovers(h, { subjectDigest, dataClasses }))
        .map((h) => structuredClone(h));
    },
    releaseHold(tenantId, holdId, { releasedBy, releaseReason, now = clock() } = {}) {
      const key = `${tenantId}:${holdId}`;
      const current = holds.get(key);
      if (!current) throw new HoldError(`ukendt hold '${holdId}'`, "hold_not_found");
      if (current.status === "released") return structuredClone(current);
      const released = { ...current, status: "released", releasedBy, releaseReason, releasedAt: new Date(now).toISOString() };
      const problems = legalHoldProblems(released);
      if (problems.length) throw new HoldError(problems.map((p) => `${p.path} ${p.message}`).join("; "), "hold_release_invalid");
      holds.set(key, released);
      return structuredClone(released);
    },

    saveReceipt(tenantId, receipt) {
      receipts.set(`${tenantId}:${receipt.receiptId}`, structuredClone(receipt));
      return structuredClone(receipt);
    },
    getReceipt: (tenantId, receiptId) => {
      const found = receipts.get(`${tenantId}:${receiptId}`);
      return found ? structuredClone(found) : null;
    },
    listReceipts: (tenantId) =>
      [...receipts.values()]
        .filter((r) => r.tenantId === tenantId)
        .map((r) => structuredClone(r))
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),

    saveRestoreGate(tenantId, gate) {
      gates.set(`${tenantId}:${gate.gateId}`, structuredClone(gate));
      return structuredClone(gate);
    },
    getRestoreGate: (tenantId, gateId) => {
      const found = gates.get(`${tenantId}:${gateId}`);
      return found ? structuredClone(found) : null;
    },
  };
}
