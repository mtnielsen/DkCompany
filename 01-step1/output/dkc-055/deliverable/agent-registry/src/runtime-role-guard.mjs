/**
 * DKC-055 — rollegrænse ved runtime.
 *
 * Runtimen kalder denne vagt efter scope-/miljøvalideringen og før en executor.
 * Den håndhæver at en agents ene rolle ikke kan overskride sine beføjelser:
 *
 *   - planner/observer/auditor må ikke eksekvere eller deploye,
 *   - implementer må ikke ændre et godkendt scope eller godkende,
 *   - verifier må ikke producere implementeringsartefakter,
 *   - executor må ikke planlægge og må ikke skabe ny plan/kode ved fejl.
 */
import { isA4Violation, isMutatingVerb } from "../../runtime/src/classification.mjs";
import { roleAllowsVerb, roleMayApprove, roleMayDeploy, roleMayProduce } from "./roles.mjs";

export function guardRoleAction({ manifest, action, approvedScope = null, verifierOf = null, verifierIdentity = null } = {}) {
  const role = manifest?.role;
  const errors = [];
  const verb = action?.verb;

  if (!roleAllowsVerb(role, verb)) {
    errors.push({ path: "/verb", message: `rollen '${role ?? "?"}' må ikke udføre '${verb}'` });
  }
  if (isMutatingVerb(verb) && !roleMayDeploy(role)) {
    errors.push({ path: "/verb", message: `rollen '${role}' må ikke udføre det muterende verbum '${verb}'` });
  }
  if (isA4Violation(verb, action?.target)) {
    // A4 håndhæves også før denne vagt; gentages her for rollegrænsen.
    errors.push({ path: "/target", message: `rollen '${role}' må ikke røre den A4-beskyttede ressource '${action?.target}'` });
  }

  // Implementer må ikke ændre et godkendt scope.
  if (role === "implementer" && approvedScope && action?.scopeChange) {
    errors.push({ path: "/scopeChange", message: "implementøren kan ikke ændre det godkendte scope" });
  }
  if (roleMayApprove(role) === false && action?.approves === true) {
    errors.push({ path: "/approves", message: `rollen '${role}' kan ikke godkende` });
  }

  // Kun en verifier må udstede det uafhængige verifier-resultat.
  if (action?.produces !== undefined && !roleMayProduce(role, action.produces)) {
    errors.push({ path: "/produces", message: `rollen '${role}' må ikke producere '${action.produces}'` });
  }
  if (action?.produces === "verification" && role !== "verifier") {
    errors.push({ path: "/produces", message: "kun rollen 'verifier' må udstede et uafhængigt verifier-resultat" });
  }

  // Executor må ikke generere ny plan/kode ved fejl.
  if (role === "executor" && ["propose", "plan", "code"].includes(action?.onFailure)) {
    errors.push({ path: "/onFailure", message: "executoren må ikke generere ny plan eller kode ved fejl" });
  }

  return { ok: errors.length === 0, errors, role };
}

/**
 * Kræv at verifikationen er uafhængig af producenten. Kaldes når en
 * verifier-agent skal udstede et resultat for en ændring produceret af en
 * anden agent.
 */
export function guardIndependentVerification({ producer, verifier } = {}) {
  const errors = [];
  if (!producer || !verifier) {
    return { ok: false, errors: [{ path: "/verifier", message: "producent og verifier kræves" }] };
  }
  if (producer.spiffeId === verifier.spiffeId) errors.push({ path: "/verifier", message: "verifieren er samme identitet som producenten" });
  if (producer.role === verifier.role) errors.push({ path: "/verifier", message: "verifieren har samme rolle som producenten" });
  if (producer.modelRef && verifier.modelRef && producer.modelRef === verifier.modelRef) {
    errors.push({ path: "/verifier", message: "samme model i to identiteter er ikke uafhængig modelkvalitet" });
  }
  return { ok: errors.length === 0, errors };
}
