/**
 * DKC-047 — beskyttede dataklasser (AI-immutable).
 *
 * Tre forbud adskilles bevidst, så de ikke smelter sammen:
 *
 *   1. **AI må ikke ændre** dataene (`ai-read-only`, `append-only`,
 *      `retention-locked`). Direkte og indirekte ændring, alias-/
 *      current-pointer, policy, lifecycle, nøgler og sletning er omfattet.
 *   2. **WORM-retention** (`retention-locked`) kræver en vurderet, formålsbestemt
 *      og endelig frist. Det er en opbevaringsbeslutning, ikke et AI-forbud.
 *   3. **AI må ikke læse** (`noAiAccess`), et selvstændigt adgangsflag der også
 *      udelukker retrieval, prompts, logs og trænings-/analyseflows.
 *
 * Klasserne er rene data; håndhævelsen ligger i guard.mjs og policyen i
 * policy/access-policy.json.
 */

/** De fire dataklasser. `ordinary` er ubeskyttet. */
export const DATA_CLASSES = ["ordinary", "ai-read-only", "append-only", "retention-locked"];

/** Klasser der er beskyttede. */
export const PROTECTED_CLASSES = ["ai-read-only", "append-only", "retention-locked"];

/** AI-operationer, inkl. de læseflows no-AI-access skal udelukke. */
export const AI_OPERATIONS = [
  "read",
  "retrieve",
  "prompt",
  "train",
  "analyze",
  "log-access",
  "append",
  "update",
  "delete",
  "copy",
  "export",
  "restore",
  "reclassify",
  "pointer-update",
  "key-rotate",
];

/** Læseflows. */
export const READ_OPERATIONS = new Set(["read", "retrieve", "prompt", "train", "analyze", "log-access"]);

/** Operationer der ændrer data, metadata, pointer, nøgler eller livscyklus. */
export const MUTATING_OPERATIONS = new Set(["append", "update", "delete", "copy", "export", "restore", "reclassify", "pointer-update", "key-rotate"]);

/** De otte forbud en beskyttet post skal dække. */
export const PROHIBITIONS = [
  "direct-change",
  "indirect-change",
  "alias-pointer",
  "authoritative-pointer",
  "policy",
  "lifecycle",
  "keys",
  "deletion",
];

export function isProtectedClass(dataClass) {
  return PROTECTED_CLASSES.includes(dataClass);
}

export function isReadOperation(operation) {
  return READ_OPERATIONS.has(String(operation ?? "").trim().toLowerCase());
}

export function isMutatingOperation(operation) {
  return MUTATING_OPERATIONS.has(String(operation ?? "").trim().toLowerCase());
}

export function normalizeOperation(operation) {
  return String(operation ?? "").trim().toLowerCase();
}

/**
 * Oversæt et verbum fra ops-/privacy-kontrakten til en AI-operation.
 * Ukendte verber behandles som muterende (fail-safe), jf. DKC-007.
 */
export function operationForVerb(verb) {
  const v = String(verb ?? "").trim().toLowerCase();
  const map = {
    "observe.read": "read",
    "observe.correlate": "read",
    diagnose: "analyze",
    propose: "analyze",
    "upgrade.dry-run": "read",
    "verify-restore": "read",
    health: "read",
    slo: "read",
    "subject.locate": "retrieve",
    "retention.policy": "read",
    backup: "read",
    "subject.export": "export",
    "subject.erase": "delete",
    "subject.legal_hold": "update",
    restore: "restore",
    rollback: "restore",
    migrate: "update",
    "migrate.schema": "update",
    upgrade: "update",
    "upgrade.patch": "update",
    "upgrade.minor": "update",
    "upgrade.major": "update",
    "config.apply": "update",
    restart: "update",
    scale: "update",
    drain: "update",
    "rotate-credential": "key-rotate",
  };
  return map[v] ?? "update";
}

/** Kræver operationen at beskyttelsen bevares på destinationen? */
export function isProtectionPreservingOperation(operation, policy) {
  return (policy?.transitionPreservesProtection ?? ["copy", "export", "restore"]).includes(normalizeOperation(operation));
}
