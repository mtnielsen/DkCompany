/**
 * DKC-021 — releasegate for gendannelse.
 *
 * En gendannelse er ikke færdig når filerne er skrevet: backupen er et
 * øjebliksbillede fra før sletninger, så et miljø der frigives direkte kan
 * genindføre persondata, nogen med rette har fået slettet. Gaten holder det
 * gendannede miljø i karantæne og frigiver det først, når:
 *
 *   1. alle slettebeslutninger nyere end restorepunktet er genanvendt på
 *      karantænemiljøet, og
 *   2. suppressionsjournalen ikke er vokset siden (en ny sletning betyder at
 *      miljøet skal behandles igen), og
 *   3. ingen aktivt hold dækker et subjekt der stadig findes i karantænen.
 *
 * Dermed genanvendes slettebeslutninger **før** systemet frigives, og et hold
 * kan ikke omgås ved at gendanne en gammel backup.
 */
import { randomUUID } from "node:crypto";
import { normalizeTenantId } from "../../identity/src/tenant.mjs";
import { holdCovers } from "./holds.mjs";

export class RestoreGateError extends Error {
  constructor(message, code = "restore_gate_error") {
    super(message);
    this.name = "RestoreGateError";
    this.code = code;
  }
}

/**
 * Karantænemiljø: de gendannede poster før frigivelse. Det er en rigtig,
 * adskilt samling — ikke den kørende database — og en sletning her rører kun
 * karantænen.
 */
export function createQuarantineWorkspace() {
  const records = [];
  return {
    kind: "quarantine-workspace",
    add(tenantId, subjectDigest, resource, value) {
      records.push({ tenantId: normalizeTenantId(tenantId), subjectDigest, resource, value });
      return records.length;
    },
    list(tenantId = null) {
      return records.filter((r) => (tenantId ? r.tenantId === normalizeTenantId(tenantId) : true)).map((r) => ({ ...r }));
    },
    subjects(tenantId) {
      const set = new Set(records.filter((r) => r.tenantId === normalizeTenantId(tenantId)).map((r) => r.subjectDigest));
      return [...set].sort();
    },
    eraseSubject(tenantId, subjectDigest) {
      const tenant = normalizeTenantId(tenantId);
      let removed = 0;
      for (let i = records.length - 1; i >= 0; i -= 1) {
        if (records[i].tenantId === tenant && records[i].subjectDigest === subjectDigest) {
          records.splice(i, 1);
          removed += 1;
        }
      }
      return removed;
    },
    size: () => records.length,
  };
}

export function createRestoreReleaseGate({ store, clock = () => Date.now() } = {}) {
  if (!store) throw new RestoreGateError("createRestoreReleaseGate kræver et register");

  function load(tenantId, gateId) {
    const gate = store.getRestoreGate(tenantId, gateId);
    if (!gate) throw new RestoreGateError(`ukendt releasegate '${gateId}'`, "gate_not_found");
    return gate;
  }

  function save(tenantId, gate) {
    store.saveRestoreGate(tenantId, gate);
    return gate;
  }

  /** Åbn en gate: miljøet er i karantæne indtil slettebeslutninger er anvendt. */
  function openGate({ tenantId, restorePointIso, ledger = null, note = null } = {}) {
    if (!restorePointIso) throw new RestoreGateError("openGate kræver et restorepunkt", "missing_restore_point");
    const tenant = normalizeTenantId(tenantId);
    const gate = {
      gateId: `gate:${tenant}:${randomUUID()}`,
      tenantId: tenant,
      restorePointIso,
      status: "quarantined",
      pinnedLedgerHead: ledger ? ledger.head() : null,
      appliedLedgerHead: null,
      appliedEntries: 0,
      recordsErased: 0,
      openedAt: new Date(clock()).toISOString(),
      releasedAt: null,
      releasedBy: null,
      note,
    };
    return save(tenant, gate);
  }

  /** Antal slettebeslutninger der endnu ikke er anvendt efter restorepunktet. */
  function pendingDecisions({ ledger, restorePointIso } = {}) {
    if (!ledger) return [];
    return ledger.entriesAfter(restorePointIso);
  }

  /**
   * Genanvend slettebeslutninger på karantænemiljøet. Gaten går fra
   * 'quarantined' til 'decisions-applied'.
   */
  function applyDecisions({ tenantId, gateId, ledger, workspace } = {}) {
    const tenant = normalizeTenantId(tenantId);
    const gate = load(tenant, gateId);
    if (!ledger) throw new RestoreGateError("applyDecisions kræver suppressionsjournalen", "missing_ledger");
    if (!workspace) throw new RestoreGateError("applyDecisions kræver karantænemiljøet", "missing_workspace");
    const verification = ledger.verify();
    if (!verification.ok) throw new RestoreGateError("suppressionsjournalen er brudt eller ændret", "ledger_broken");
    if (gate.pinnedLedgerHead && !ledger.isDescendantOf(gate.pinnedLedgerHead)) {
      throw new RestoreGateError("suppressionsjournalen er trunkeret i forhold til restorepunktet", "ledger_truncated");
    }

    let recordsErased = 0;
    const decisions = pendingDecisions({ ledger, restorePointIso: gate.restorePointIso });
    for (const entry of decisions) {
      recordsErased += workspace.eraseSubject(entry.tenantId, entry.subjectKey ?? entry.digest);
    }
    const updated = {
      ...gate,
      status: "decisions-applied",
      appliedLedgerHead: ledger.head(),
      appliedEntries: decisions.length,
      recordsErased,
      appliedAt: new Date(clock()).toISOString(),
    };
    return save(tenant, updated);
  }

  /**
   * Frigiv miljøet. Afvises hvis beslutninger mangler, journalen er vokset siden,
   * eller et aktivt hold dækker et subjekt der stadig findes i karantænen.
   */
  function release({ tenantId, gateId, ledger, workspace, holds = [], releasedBy = "unknown" } = {}) {
    const tenant = normalizeTenantId(tenantId);
    const gate = load(tenant, gateId);
    if (gate.status !== "decisions-applied") {
      throw new RestoreGateError("miljøet kan ikke frigives før slettebeslutningerne er genanvendt", "decisions_pending");
    }
    if (ledger) {
      const head = ledger.head();
      if (head !== gate.appliedLedgerHead) {
        throw new RestoreGateError("suppressionsjournalen er vokset siden beslutningerne blev anvendt; kør applyDecisions igen", "ledger_advanced");
      }
    }
    if (workspace) {
      for (const digest of workspace.subjects(tenant)) {
        const blocking = holds.find((h) => holdCovers(h, { subjectDigest: digest }));
        if (blocking) throw new RestoreGateError(`aktivt hold '${blocking.holdId}' dækker et subjekt i karantænen`, "hold_blocks_release");
      }
    }
    const updated = { ...gate, status: "released", releasedAt: new Date(clock()).toISOString(), releasedBy };
    return save(tenant, updated);
  }

  return { kind: "restore-release-gate", openGate, pendingDecisions, applyDecisions, release, getGate: (tenantId, gateId) => load(normalizeTenantId(tenantId), gateId) };
}
