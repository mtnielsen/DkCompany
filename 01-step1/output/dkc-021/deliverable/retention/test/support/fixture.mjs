/**
 * DKC-021 — fælles testfixture.
 */
import { createMemoryRetentionStore } from "../../src/holds.mjs";
import { createMemoryAuditTrail } from "../../src/audit.mjs";
import { createDeletionService } from "../../src/deletion-service.mjs";

export const PRINCIPAL = { id: "oidc|pia.privat", name: "Pia Privat", tenantId: "acme", roles: ["privacy-officer", "data-protection-officer"], kind: "human" };
export const APPROVER = { subject: "oidc|lars.lov", name: "Lars Lov", role: "legal-counsel" };

export function makeService({ policy, surfaces, store = createMemoryRetentionStore(), audit = createMemoryAuditTrail() }) {
  const service = createDeletionService({ policy, store, surfaces, audit });
  return { service, store, audit };
}

export function fullSurface(id, kind, dataClasses = ["personal"]) {
  let erased = 0;
  return {
    id,
    kind,
    dataClasses,
    coverage: "full",
    erased: () => erased,
    locate: () => [],
    erase: () => {
      erased += 1;
      return { status: "full", recordsAffected: 1, remainingCopies: [] };
    },
  };
}

export function partialSurface(id, kind, reason, dataClasses = ["personal"]) {
  return {
    id,
    kind,
    dataClasses,
    coverage: "partial",
    locate: () => [],
    erase: () => ({
      status: "partial",
      recordsAffected: 1,
      reason,
      remainingCopies: [{ kind: "upstream", resource: "provider-copy", reason: "ingen slette-API", expiresAt: new Date(Date.now() + 86400000).toISOString() }],
    }),
  };
}

export function unsupportedSurface(id, kind, reason, dataClasses = ["personal"]) {
  return {
    id,
    kind,
    dataClasses,
    coverage: "unsupported",
    locate: () => [],
    erase: () => ({ status: "unsupported", recordsAffected: 0, reason, remainingCopies: [{ kind: "upstream", resource: "provider-copy", reason, expiresAt: new Date(Date.now() + 86400000).toISOString() }] }),
  };
}
