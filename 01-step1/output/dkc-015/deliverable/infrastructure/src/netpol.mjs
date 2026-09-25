/**
 * DKC-015 — statisk netværksisolation.
 *
 * Formålet er at bevise, uden en klynge, at et workload i ét miljø ikke kan nå
 * et andet miljøs (eller en anden kundes) database:
 *
 *   - hver namespace har en default-deny for både ingress og egress,
 *   - ingen politik tillader et tomt/wildcard namespace- eller IP-selector,
 *   - ingen egress peger på et andet miljøs namespace.
 */
const OWN_NS = "kubernetes.io/metadata.name";

export function checkNetworkIsolation(resources) {
  const problems = [];
  const namespaces = [...new Set(resources.map((r) => r.metadata?.namespace).filter(Boolean))];
  const policies = resources.filter((r) => r.kind === "NetworkPolicy" || r.kind === "CiliumNetworkPolicy");

  for (const namespace of namespaces) {
    const nsPolicies = policies.filter((p) => p.metadata?.namespace === namespace);
    const deny = nsPolicies.find((p) => p.metadata?.name === "default-deny");
    if (!deny) {
      problems.push(`${namespace}: mangler en 'default-deny' NetworkPolicy`);
      continue;
    }
    const types = deny.spec?.policyTypes ?? [];
    if (!types.includes("Ingress") || !types.includes("Egress")) problems.push(`${namespace}: default-deny skal dække både Ingress og Egress`);
    if ((deny.spec?.ingress ?? []).length > 0 || (deny.spec?.egress ?? []).length > 0) problems.push(`${namespace}: default-deny skal have tomme ingress- og egress-lister`);
  }

  for (const policy of policies) {
    const namespace = policy.metadata?.namespace ?? "?";
    const spec = policy.spec ?? {};
    const inspect = (rules, direction) => {
      for (const rule of rules ?? []) {
        for (const peer of rule.to ?? rule.from ?? []) {
          if (peer.ipBlock?.cidr === "0.0.0.0/0" || peer.ipBlock?.cidr === "::/0") {
            problems.push(`${namespace}/${policy.metadata?.name}: ${direction} tillader et wildcard-IP (${peer.ipBlock.cidr})`);
          }
          const selector = peer.namespaceSelector;
          if (selector && Object.keys(selector.matchLabels ?? {}).length === 0) {
            problems.push(`${namespace}/${policy.metadata?.name}: ${direction} tillader alle namespaces (tom namespaceSelector)`);
          } else if (selector?.matchLabels?.[OWN_NS] && selector.matchLabels[OWN_NS] !== namespace && selector.matchLabels[OWN_NS] !== "kube-system") {
            problems.push(`${namespace}/${policy.metadata?.name}: ${direction} peger på et andet miljøs namespace '${selector.matchLabels[OWN_NS]}'`);
          }
        }
        for (const fqdn of rule.toFQDNs ?? []) {
          if (fqdn.matchName === "*" || fqdn.matchName === "*.example.org") problems.push(`${namespace}/${policy.metadata?.name}: egress tillader et wildcard-domæne`);
        }
      }
    };
    inspect(spec.egress, "egress");
    inspect(spec.ingress, "ingress");
  }
  return problems;
}
