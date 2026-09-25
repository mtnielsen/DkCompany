/**
 * DKC-015 — secret-injektion.
 *
 * Secrets er referencer, ikke værdier. Denne kontrol afviser et committet
 * Secret-objekt, en reference til en udeklareret secret og klartekst-materiale.
 */
import { findInlineSecrets } from "../../conformance/src/infrastructure.mjs";
import { RENDERED_ENVIRONMENTS } from "./plan.mjs";

function collectSecretRefs(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectSecretRefs(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    if (node.secretRef?.name) out.push(node.secretRef.name);
    if (node.secretKeyRef?.name) out.push(node.secretKeyRef.name);
    for (const value of Object.values(node)) collectSecretRefs(value, out);
  }
  return out;
}

export function checkSecretInjection(plan, resources) {
  const problems = [];
  for (const resource of resources) {
    if (resource.kind === "Secret") {
      problems.push(`${resource.metadata?.namespace}/${resource.metadata?.name}: et Secret-objekt må ikke committes til git`);
    }
  }
  const declared = new Set(
    (plan.environments ?? [])
      .filter((env) => RENDERED_ENVIRONMENTS.includes(env.id))
      .flatMap((env) => (env.secrets?.references ?? []).map((ref) => ref.name))
  );
  const used = new Set(resources.flatMap((resource) => collectSecretRefs(resource)));
  for (const name of used) {
    if (!declared.has(name)) problems.push(`secret '${name}' bruges af et manifest men er ikke deklareret i ${"infrastructure/plan.json"}`);
  }
  for (const required of declared) {
    if (!used.has(required)) problems.push(`secret '${required}' er deklareret i planen men bruges ikke af noget manifest`);
  }
  for (const finding of findInlineSecrets(resources, "")) {
    problems.push(`klartekst-hemmelighed ved ${finding.path}: ${finding.message}`);
  }
  return problems;
}
