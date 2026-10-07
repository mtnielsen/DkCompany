/**
 * DKC-058 — beskyttelse af immutable-nøgler og autoritative kopier.
 *
 * Når en host har privilegier, der ellers ville kunne omgå immutable-lageret,
 * skal nøgler og autoritative kopier ligge i et **separat sikkerhedsdomæne**,
 * som host-operationen ikke kan nå. Host-brokeren må kun røre `host/<id>`;
 * ethvert forsøg på at pege på KMS, nøgler, immutable-lager, policy eller
 * trust-konfiguration afvises, og en operation kan aldrig erklære at skrive
 * immutable data eller destruere eksterne nøgler.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isProtectedResource } from "../../runtime/src/classification.mjs";

export const IMMUTABLE_POLICY_PATH = "data-protection/enforcement/immutable-policy.json";
export const SECURITY_DOMAIN_FORBIDDEN_TOKENS = ["kms", "key", "keys", "secret", "vault", "immutable", "worm", "object-lock", "policy", "trust", "broker"];

export function loadImmutablePolicy(root) {
  return JSON.parse(readFileSync(join(root, IMMUTABLE_POLICY_PATH), "utf8"));
}

export function protectedResourceIds(policy) {
  return (policy?.protectedResources ?? []).map((r) => r.id);
}

/**
 * Enrollmentets sikkerhedsdomæne skal være adskilt, og den refererede
 * immutable-nøgledomæne skal være en beskyttet ressource i DKC-048-politikken.
 */
export function securityDomainProblems({ enrollment, immutablePolicy } = {}) {
  const problems = [];
  const at = (path, message) => problems.push({ path, message });
  const domain = enrollment?.securityDomain ?? {};
  if (domain.separateFromPlatform !== true) at("/securityDomain/separateFromPlatform", "sikkerhedsdomænet skal være adskilt fra platformen");
  if (!domain.immutableKeyDomainRef) at("/securityDomain/immutableKeyDomainRef", "der skal refereres til en immutable-nøgledomæne");
  if (!domain.authoritativeCopyRef) at("/securityDomain/authoritativeCopyRef", "der skal refereres til en autoritativ kopi");
  const resources = immutablePolicy?.protectedResources ?? [];
  const keyResource = resources.find((r) => r.id === domain.immutableKeyDomainRef || r.keyDomain === domain.immutableKeyDomainRef);
  if (resources.length > 0 && !keyResource) {
    at("/securityDomain/immutableKeyDomainRef", `'${domain.immutableKeyDomainRef}' er ikke en beskyttet ressource i immutable-politikken`);
  }
  if (enrollment?.recovery?.consoleSecurityDomainRef && enrollment.recovery.consoleSecurityDomainRef === domain.ref) {
    at("/recovery/consoleSecurityDomainRef", "recoverykonsollen må ikke ligge i samme sikkerhedsdomæne som de beskyttede nøgler");
  }
  return problems;
}

/**
 * Må host-operationen overhovedet pege på dette mål? Default-deny: kun
 * `host/<id>` er tilladt, og intet segment må være en beskyttet ressource eller
 * et sikkerhedsdomæne-token.
 */
export function guardSecurityDomain({ operation, enrollment } = {}) {
  const reasons = [];
  const target = operation?.operation?.target ?? "";
  if (isProtectedResource(target)) reasons.push(`målet '${target}' er en beskyttet ressource`);
  const lower = target.toLowerCase();
  for (const token of SECURITY_DOMAIN_FORBIDDEN_TOKENS) {
    if (new RegExp(`(^|[/-])${token}([/-]|$)`).test(lower)) reasons.push(`målet '${target}' peger på sikkerhedsdomænet ('${token}')`);
  }
  const domainRef = enrollment?.securityDomain?.ref;
  if (domainRef && lower.includes(String(domainRef).toLowerCase())) reasons.push("målet peger på enrollmentets sikkerhedsdomæne");
  if (operation?.restrictions?.immutableWrite !== false) reasons.push("operationen tillader skrivning til immutable data");
  if (operation?.restrictions?.externalKeyDestroy !== false) reasons.push("operationen tillader destruktion af eksterne nøgler");
  return { ok: reasons.length === 0, reasons };
}

/** Simulér en mutation mod sikkerhedsdomænet og bekræft at den altid afvises. */
export function attemptSecurityDomainWrite({ principal, resource, policy } = {}) {
  const isAgent = principal?.kind === "agent" || principal?.ai === true;
  const target = String(resource ?? "");
  const protectedHit = isProtectedResource(target) || (policy?.protectedResources ?? []).some((r) => target.toLowerCase().includes(String(r.id).toLowerCase()));
  if (isAgent && protectedHit) return { decision: "deny", reason: "en agent må ikke skrive til en beskyttet ressource", code: "immutable_write_denied" };
  if (isAgent) return { decision: "deny", reason: "en agent må ikke skrive til sikkerhedsdomænet", code: "security_domain_denied" };
  return { decision: "allow", obligations: ["two-person-approval", "audit"] };
}
