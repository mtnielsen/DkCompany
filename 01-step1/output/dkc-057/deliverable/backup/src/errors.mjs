/**
 * DKC-057 — fejltyper for eksterne backupmål.
 *
 * Fejlene bærer en stabil `code`, så preflight kan klassificere en fejl som
 * fx credential-, certifikat-, plads- eller retention-problem uden at lække
 * hemmeligheder eller rå svar fra målet.
 */
export class BackupTargetError extends Error {
  constructor(message, code = "target_error", { cause = null, status = null } = {}) {
    super(message);
    this.name = "BackupTargetError";
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

export const TARGET_ERROR_CODES = [
  "credentials_error",
  "certificate_error",
  "network_error",
  "bucket_not_found",
  "not_found",
  "space_error",
  "retention_error",
  "unsupported_capability",
  "backend_error",
  "target_error",
];

/** Klassificér en HTTP-status eller en Node-fejl til en stabil fejlkode. */
export function classifyTargetError(err, status = null) {
  if (err instanceof BackupTargetError) return err;
  const code = err?.code ?? "";
  if (String(code).startsWith("CERT_") || ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "HOSTNAME_MISMATCH"].includes(code)) {
    return new BackupTargetError(`certifikatfejl mod backupmålet: ${err.message}`, "certificate_error", { cause: err });
  }
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
    return new BackupTargetError(`kunne ikke nå backupmålet: ${err.message}`, "network_error", { cause: err });
  }
  if (status === 401 || status === 403) return new BackupTargetError("adgang nægtet af backupmålet (credentials eller rettigheder)", "credentials_error", { status });
  if (status === 404) return new BackupTargetError("backupmålet blev ikke fundet", "bucket_not_found", { status });
  if (status === 507) return new BackupTargetError("backupmålet rapporterer ingen ledig plads", "space_error", { status });
  if (status === 409) return new BackupTargetError("backupmålet afviste skrivningen (retention/object-lock)", "retention_error", { status });
  if (status >= 500) return new BackupTargetError(`backupmålet svarede med fejl (${status})`, "backend_error", { status });
  return new BackupTargetError(err?.message ?? String(err), "target_error", { cause: err, status });
}
