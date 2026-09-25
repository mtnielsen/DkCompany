/**
 * DKC-019 — registertjeneste med tenantautorisation.
 *
 * Tjenesten er grænsen mellem API/CLI og persistens. Den:
 *   - udleder tenanten af den verificerede principal (aldrig af et felt
 *     klienten selv kan sætte),
 *   - afviser læsning og skrivning på tværs af kunder uden den særskilte
 *     platformrolle og en eksplicit scope,
 *   - validerer registeret (skema + semantik) før det gemmes, så en post uden
 *     ejerbesluttet grundlag, aftale eller tredjelandsvurdering ikke kan gemmes
 *     som godkendt persondatapost,
 *   - kaster hvis en persondatapost har aktive blockere og alligevel forsøges
 *     gemt som 'approved'.
 *
 * Persistenslaget er tenant-bundet; tjenesten tilføjer autorisationen.
 */
import { assertTenantAccess, normalizeTenantId, formatResourceId, principalTenant } from "../../identity/src/tenant.mjs";
import { validateDataRegister, dataRegisterProblems, entryBlockers, isPersonalEntry } from "../../conformance/src/data-register.mjs";

export class DataRegisterServiceError extends Error {
  constructor(message, { status = 400, code = "data_register_error" } = {}) {
    super(message);
    this.name = "DataRegisterServiceError";
    this.status = status;
    this.code = code;
  }
}

export function createDataRegisterService({ store, clock = () => Date.now() } = {}) {
  if (!store) throw new Error("createDataRegisterService kræver en store");

  /** Udled og autorisér tenant-konteksten. Returnerer den kanoniske tenant. */
  function authorize(principal, tenantId) {
    if (!principal) throw new DataRegisterServiceError("manglende principal", { status: 401, code: "principal_missing" });
    if (tenantId) {
      const target = normalizeTenantId(tenantId);
      assertTenantAccess({ principal, tenantId: target });
      return target;
    }
    const own = principalTenant(principal);
    if (!own) throw new DataRegisterServiceError("en tjeneste uden tenantbinding skal angive tenanten eksplicit", { status: 403, code: "tenant_unresolved" });
    return own;
  }

  function assertRegisterConsistent(register) {
    const { ok, errors } = validateDataRegister(register);
    if (!ok) {
      throw new DataRegisterServiceError(
        "registeret validerer ikke:\n" + errors.map((e) => `  ${e.path} ${e.message}`).join("\n"),
        { status: 422, code: "data_register_invalid" }
      );
    }
    const problems = dataRegisterProblems(register);
    if (problems.length) {
      throw new DataRegisterServiceError(
        "registeret er inkonsistent:\n" + problems.map((p) => `  ${p.path} ${p.message}`).join("\n"),
        { status: 422, code: "data_register_inconsistent" }
      );
    }
    for (const entry of register.entries ?? []) {
      if (entry.status === "approved" && entryBlockers(entry).length) {
        throw new DataRegisterServiceError(`posten '${entry.id}' kan ikke gemmes som 'approved' med aktive blockere`, {
          status: 409,
          code: "data_register_blocked",
        });
      }
    }
  }

  return {
    /** Læs én post under den autoriserede tenant. */
    getEntry(principal, { tenantId, entryId } = {}) {
      const tenant = authorize(principal, tenantId);
      const entry = store.getEntry(tenant, entryId);
      if (!entry) throw new DataRegisterServiceError(`ukendt registerpost '${entryId}'`, { status: 404, code: "not_found" });
      return entry;
    },
    /** List poster for tenanten. */
    listEntries(principal, { tenantId } = {}) {
      const tenant = authorize(principal, tenantId);
      return store.listEntries(tenant);
    },
    /** List aktive blockere for tenanten. */
    listBlockers(principal, { tenantId } = {}) {
      const tenant = authorize(principal, tenantId);
      return store.listBlockers(tenant);
    },
    /** Gem en registerversion. Validerer først, så ugyldige data aldrig når lageret. */
    putVersion(principal, { tenantId, register, approvedBy = null } = {}) {
      const tenant = authorize(principal, tenantId);
      assertRegisterConsistent(register);
      const result = store.saveVersion(tenant, register, { createdBy: principal?.id ?? null, approvedBy });
      return { ...result, tenantId: tenant };
    },
    /** Sæt et aktivt slette-stop på en post. */
    placeHold(principal, { tenantId, entryId, reason, holdId = null } = {}) {
      const tenant = authorize(principal, tenantId);
      const entry = store.getEntry(tenant, entryId);
      if (!entry) throw new DataRegisterServiceError(`ukendt registerpost '${entryId}'`, { status: 404, code: "not_found" });
      return store.placeHold(tenant, { entryId, reason, placedBy: principal?.id ?? "unknown", holdId });
    },
    /** Frigiv et slette-stop. */
    releaseHold(principal, { tenantId, holdId } = {}) {
      const tenant = authorize(principal, tenantId);
      return store.releaseHold(tenant, holdId, { releasedBy: principal?.id ?? "unknown" });
    },
    /** Kanonisk ressource-ID for en post (tenant bæres af ID'et). */
    resourceIdFor(tenantId, entryId) {
      return formatResourceId({ tenantId: normalizeTenantId(tenantId), type: "data-register-entry", localId: entryId });
    },
    /** Hjælpefunktion til API-lag: er posten persondatabærende? */
    isPersonal(entry) {
      return isPersonalEntry(entry);
    },
  };
}
