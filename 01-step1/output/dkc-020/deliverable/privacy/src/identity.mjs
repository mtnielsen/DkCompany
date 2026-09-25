/**
 * DKC-020 — sikker identitetsmatchning for en DSAR.
 *
 * En DSAR må kun udlevere den registreredes egne oplysninger. Denne modul er den
 * rene, deterministiske kerne der afgør:
 *
 *   - hvordan en identifikator normaliseres (fx e-mail til små bogstaver),
 *   - om en post overhovedet tilhører sagens tenant (en fremmed tenant må
 *     aldrig matche, uanset identisk e-mailtekst),
 *   - om en post tilhører subjektet eller en anden person.
 *
 * Reglen er fail-closed: en post med en eksplicit anden ejer droppes, og en
 * post med en eksplicit fremmed tenant droppes. En post uden ejer-/tenant-markør
 * antages at være afgrænset af modulet til subjektet, men tælles særskilt, så
 * eksporten kan vise hvor mange poster der blev udeladt.
 */
const IDENTIFIER_TYPES = new Set(["oidc-sub", "email", "customer-id", "employee-id", "device-id", "phone", "other"]);

export class IdentityMatchError extends Error {
  constructor(message, code = "identity_match_error") {
    super(message);
    this.name = "IdentityMatchError";
    this.code = code;
  }
}

export function normalizeIdentifier({ type, value } = {}) {
  if (!type || !IDENTIFIER_TYPES.has(type)) throw new IdentityMatchError(`ukendt identifikatortype '${type ?? ""}'`, "unknown_identifier_type");
  if (value === undefined || value === null || String(value).trim() === "") throw new IdentityMatchError("identifikator mangler en værdi", "empty_identifier");
  const raw = String(value).trim();
  const normalised = type === "email" ? raw.toLowerCase() : raw;
  return { type, value: raw, normalised };
}

export function normalizeIdentifiers(identifiers = []) {
  return identifiers.map(normalizeIdentifier);
}

function recordTenant(record) {
  return record?.tenantId ?? record?.tenant_id ?? null;
}

function recordOwner(record) {
  return record?.subjectId ?? record?.subject_id ?? record?.subject ?? record?.owner ?? record?.userId ?? record?.user_id ?? null;
}

function recordIdentifiers(record) {
  const list = record?.identifiers ?? record?.identifier ?? null;
  if (!list) return [];
  return Array.isArray(list) ? list : [list];
}

/**
 * Sandt hvis posten tilhører subjektet i den rigtige tenant.
 * En fremmed tenant eller en eksplicit anden ejer giver altid false.
 */
export function subjectMatch({ tenantId, identifiers, record, subjectIds = [] } = {}) {
  const tenant = recordTenant(record);
  if (tenant !== null && String(tenant) !== String(tenantId)) return false;

  const owner = recordOwner(record);
  const recordIds = recordIdentifiers(record);
  const wantedIds = new Set([...subjectIds].map(String));
  if (owner !== null && owner !== undefined) {
    if (wantedIds.has(String(owner))) return true;
    if (recordIds.length === 0) return false; // eksplicit anden ejer uden identifikator
  }

  // Hverken ejer- eller identifikatormarkør: modulet har allerede afgrænset
  // posten til subjektet, så den følger med.
  if (recordIds.length === 0) return true;

  const wanted = normalizeIdentifiers(identifiers ?? []);
  return recordIds.some((rid) => wanted.some((w) => sameIdentifier(w, rid)));
}

function sameIdentifier(a, b) {
  try {
    return a.type === b.type && normalizeIdentifier(a).normalised === normalizeIdentifier(b).normalised;
  } catch {
    return false;
  }
}

/**
 * Filtrér en modulbesvarelses poster, så kun subjektets egne poster følger med.
 * Returnerer de beholdte poster og et antal udeladte, så eksporten kan være
 * ærlig om, at andres data blev udeladt.
 */
export function filterSubjectRecords({ tenantId, identifiers, subjectIds = [], records = [] } = {}) {
  const kept = [];
  let dropped = 0;
  for (const record of records ?? []) {
    if (record !== null && typeof record === "object" && !Array.isArray(record)) {
      if (subjectMatch({ tenantId, identifiers, record, subjectIds })) kept.push(record);
      else dropped += 1;
    } else {
      // En skalarværdi bærer ingen ejer; modulet har allerede afgrænset den.
      kept.push(record);
    }
  }
  return { records: kept, dropped };
}
