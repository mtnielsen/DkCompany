/**
 * DKC-048 — beskyttede KMS-nøgler uden for agentens kontrol.
 *
 * KMS-materiale, signeringsnøgler og trust-konfiguration må ikke kunne slettes
 * eller ændres af en AI-agent eller app-konto. Denne model håndhæver:
 *
 *   - ingen AI-principal kan slette, schedulere sletning af eller ændre en
 *     beskyttet nøgle,
 *   - en nøgle der er bundet til en retention-locked beskyttelsespost kan ikke
 *     slettes, mens posten er beskyttet,
 *   - sletning kræver et navngivet menneske med rollen security-admin **og** en
 *     separat godkender (to-personers-princippet),
 *   - rotation er tilladt, men den gamle nøgleversion bevares, så tidligere
 *     signaturer fortsat kan verificeres.
 *
 * Nøglen forlader ikke modulet i klartekst; kun metadata og livscyklus håndteres.
 */
import { normalizeTenantId } from "../../identity/src/tenant.mjs";

export class KeyProtectionError extends Error {
  constructor(message, code = "key_forbidden") {
    super(message);
    this.name = "KeyProtectionError";
    this.code = code;
  }
}

function deny(reason, code = "key_forbidden") {
  return { decision: "deny", allowed: false, reason, code };
}
function allow(obligations = ["audit"]) {
  return { decision: "allow", allowed: true, reason: null, code: null, obligations };
}

/**
 * @param {object} options
 * @param {object} options.policy       ImmutableEnforcement-politikken.
 * @param {Array}  [options.register]   Beskyttelsesregisterets poster.
 * @param {Function} [options.clock]
 */
export function createProtectedKeyStore({ policy, register = [], clock = () => Date.now() } = {}) {
  if (!policy) throw new KeyProtectionError("createProtectedKeyStore kræver en politik", "missing_policy");
  const keys = new Map();
  const events = [];
  const protectedById = new Map((policy.protectedResources ?? []).map((r) => [r.id, r]));

  function domainOf(keyId) {
    return keys.get(keyId)?.keyDomain ?? null;
  }

  function referencingRecords(keyDomain) {
    const records = Array.isArray(register) ? register : register?.records ?? [];
    return records.filter((r) => r.keyDomain === keyDomain && r.dataClass === "retention-locked");
  }

  return {
    kind: "protected-key-store",
    policy,

    /** Registrér en nøgle (i drift leveres den af KMS; her kun metadata). */
    registerKey({ keyId, keyDomain, protectedKey = false, resourceId = null } = {}) {
      if (!keyId || !keyDomain) throw new KeyProtectionError("registerKey kræver keyId og keyDomain", "missing_key");
      keys.set(keyId, { keyId, keyDomain, protected: protectedKey || protectedById.has(resourceId), resourceId, createdAt: new Date(clock()).toISOString(), versions: [1], current: 1, deletedAt: null, pendingDeletionAt: null });
      return keys.get(keyId);
    },

    get(keyId) {
      return keys.get(keyId) ?? null;
    },

    keys() {
      return [...keys.values()].map((k) => ({ ...k }));
    },

    /**
     * Slet en nøgle. Default-deny: kun et navngivet menneske med security-admin
     * og en separat godkender kan slette, og aldrig en nøgle der stadig
     * understøtter en retention-locked post.
     */
    deleteKey(keyId, { principal, role, approval = null, now = clock() } = {}) {
      const key = keys.get(keyId);
      if (!key) return deny(`ukendt nøgle '${keyId}'`, "unknown_key");
      if (principal?.kind === "agent" || principal?.ai === true || (principal?.kind === "service" && role?.ai === true)) {
        return deny(`AI/app-konto må ikke slette nøglen '${keyId}'`, "ai_forbidden");
      }
      if (principal?.kind !== "human") return deny("kun et navngivet menneske må slette KMS-nøgler", "human_required");
      if (role?.id !== "security-admin") return deny(`rollen '${role?.id ?? "ukendt"}' må ikke slette KMS-nøgler`, "role_required");
      const resource = key.resourceId ? protectedById.get(key.resourceId) : null;
      if (key.protected && resource?.deletionProtected !== false) {
        const referencing = referencingRecords(key.keyDomain);
        if (referencing.length) return deny(`nøglen '${keyId}' understøtter stadig beskyttede poster (${referencing.map((r) => r.id).join(", ")})`, "referenced_by_protected_record");
      }
      if (!policy.twoPersonControl?.governanceBypass?.required && !policy.twoPersonControl?.protectionPolicy?.required) {
        return deny("politikken kræver ikke to-personers kontrol; sletning afvises", "two_person_required");
      }
      if (!approval?.approvedBy || !approval?.approvedAt) return deny("nøglesletning kræver en navngivet godkender og tidspunkt", "approval_required");
      const requester = principal.id ?? principal.subject ?? null;
      if (String(approval.approvedBy) === String(requester)) return deny("godkenderen må ikke være den samme som anmoderen", "separation_of_duties");

      key.pendingDeletionAt = new Date(now).toISOString();
      key.deletedAt = new Date(now).toISOString();
      key.current = null;
      events.push({ type: "key-deleted", keyId, by: requester, approvedBy: approval.approvedBy, at: key.deletedAt });
      return allow(["audit", "two-person-approval"]);
    },

    /** Rotation er tilladt, men historikken bevares (ingen sletning af gamle versioner). */
    rotateKey(keyId, { principal, role, now = clock() } = {}) {
      const key = keys.get(keyId);
      if (!key) return deny(`ukendt nøgle '${keyId}'`, "unknown_key");
      if (principal?.kind === "agent" || (principal?.kind === "service" && role?.ai === true)) return deny(`AI/app-konto må ikke rotere nøglen '${keyId}'`, "ai_forbidden");
      const next = key.current === null ? null : key.current + 1;
      if (next === null) return deny(`nøglen '${keyId}' er slettet`, "deleted");
      key.versions.push(next);
      key.current = next;
      events.push({ type: "key-rotated", keyId, version: next, at: new Date(now).toISOString() });
      return { ...allow(["audit"]), version: next };
    },

    events() {
      return events.map((e) => ({ ...e }));
    },
  };
}
