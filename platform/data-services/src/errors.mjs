/**
 * DKC-056 — fejltyper for datatjenester.
 *
 * Fejlene er typede, så connectors, recovery og UI kan skelne en netværksfejl
 * fra en certifikatfejl, en versionsafvigelse eller en afvist skrivning. En
 * ukontrolleret fejl må ikke forveksles med en kontrolleret afvisning.
 */

export class DataServiceError extends Error {
  constructor(message, { code = "data_service_error", cause = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/** Netværket kunne ikke nås (DNS, TCP, timeout). */
export class NetworkError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "network_error", ...opts });
  }
}

/** TLS/certifikatet kunne ikke verificeres, eller den pinned CA er roteret. */
export class CertificateError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "certificate_error", ...opts });
  }
}

/** TLS er påkrævet, men serveren afviste det. */
export class TlsRequiredError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "tls_required", ...opts });
  }
}

/** Motorens version er ikke i profilens understøttede interval. */
export class VersionMismatchError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "version_mismatch", ...opts });
  }
}

/** Autentisering fejlede. */
export class AuthenticationError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "authentication_error", ...opts });
  }
}

/** Forespørgslen blev afvist af motoren. */
export class QueryError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "query_error", ...opts });
  }
}

/** En hemmelighed kunne ikke opløses. Værdien logges aldrig. */
export class SecretError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "secret_error", ...opts });
  }
}

/** Scopet tillader ikke operationen. */
export class ScopeError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "scope_error", ...opts });
  }
}

/** En skrivning blev afvist mod en read-only kilde. */
export class ReadOnlyError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "read_only", ...opts });
  }
}

/** En migration ville ramme et fremmed schema eller slette data. */
export class MigrationScopeError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "migration_scope_error", ...opts });
  }
}

/** Backup/restore ville omfatte en ekstern kilde uden scope. */
export class BackupScopeError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "backup_scope_error", ...opts });
  }
}

/** Tenantbindingen kunne ikke opfyldes. */
export class TenantBindingError extends DataServiceError {
  constructor(message, opts = {}) {
    super(message, { code: "tenant_binding_error", ...opts });
  }
}
