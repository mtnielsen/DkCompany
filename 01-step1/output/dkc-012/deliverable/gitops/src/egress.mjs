/**
 * DKC-012 — GitOps-kontrol af model-egress.
 *
 * Beviser at den ønskede klyngetilstand afviser direkte leverandør-egress fra
 * agent-workloads:
 *
 *   1. der findes en default-deny egress-politik for alle pods,
 *   2. kun gatewayens pods har en egress-allow til leverandørværterne, og den
 *      kanoniske værtsliste matcher koden,
 *   3. ingen ikke-gateway-container bærer leverandørnøgler eller peger på en
 *      leverandørvært.
 *
 * Kontrollen er statisk og supplerer netværkstesten i `gateway/test/`, som
 * forsøger et rigtigt egress fra en workload-identitet og viser at det afvises.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PROVIDER_HOSTS } from "../../gateway/src/egress.mjs";
import { repoRoot, loadManifests } from "./verify.mjs";

const GATEWAY_NAME = "ai-gateway";
const PROVIDER_KEY_RE = /(openai|anthropic|gemini|google|mistral|model_provider|provider_api|llm)[_-]?(api[_-]?key|token|secret|key)/i;

function resourcesFrom(root) {
  return loadManifests(root).map((m) => m.data);
}

function containerEnv(container) {
  return container.env ?? [];
}

export function verifyModelEgress(root = repoRoot) {
  const resources = resourcesFrom(root);
  const checks = [];
  const add = (id, title, status, detail, messages = []) => checks.push({ id, title, status, detail, messages });

  // E-001 — default-deny egress for alle pods.
  {
    const messages = [];
    const deny = resources.find((r) => r.kind === "NetworkPolicy" && r.metadata?.name === "model-egress-default-deny");
    if (!deny) messages.push("NetworkPolicy 'model-egress-default-deny' mangler");
    else {
      if (Object.keys(deny.spec?.podSelector ?? { x: 1 }).length !== 0) messages.push("default-deny skal vælge alle pods (tom podSelector)");
      if (!(deny.spec?.policyTypes ?? []).includes("Egress")) messages.push("default-deny skal omfatte Egress");
      if ((deny.spec?.egress ?? []).length !== 0) messages.push("default-deny skal ikke tillade nogen egress");
    }
    add("E-001", "Default-deny egress for alle pods", messages.length ? "fail" : "pass", "model-egress-default-deny", messages);
  }

  // E-002 — kun gatewayen må nå leverandørværter, og listen matcher koden.
  {
    const messages = [];
    const policy = resources.find((r) => r.kind === "CiliumNetworkPolicy" && r.metadata?.name === "model-egress-gateway-allow");
    if (!policy) messages.push("CiliumNetworkPolicy 'model-egress-gateway-allow' mangler");
    else {
      const selected = policy.spec?.endpointSelector?.matchLabels?.["app.kubernetes.io/name"];
      if (selected !== GATEWAY_NAME) messages.push(`egress-allow skal vælge '${GATEWAY_NAME}', ikke '${selected ?? "intet"}'`);
      const hosts = (policy.spec?.egress ?? []).flatMap((rule) => rule.toFQDNs?.map((t) => t.matchName) ?? []);
      for (const host of DEFAULT_PROVIDER_HOSTS) if (!hosts.includes(host)) messages.push(`egress-allow mangler værten '${host}'`);
      for (const host of hosts) if (!DEFAULT_PROVIDER_HOSTS.includes(host)) messages.push(`egress-allow tillader en ukendt vært '${host}'`);
    }
    add("E-002", "Kun gatewayen har leverandør-egress (kanonisk liste)", messages.length ? "fail" : "pass", `${DEFAULT_PROVIDER_HOSTS.length} værter`, messages);
  }

  // E-003 — ingen workload ud over gatewayen bærer leverandørnøgler/værter.
  {
    const messages = [];
    for (const r of resources) {
      if (r.kind !== "Deployment") continue;
      if (r.metadata?.labels?.["app.kubernetes.io/name"] === GATEWAY_NAME) continue;
      for (const c of r.spec?.template?.spec?.containers ?? []) {
        for (const env of containerEnv(c)) {
          if (PROVIDER_KEY_RE.test(env.name ?? "")) messages.push(`${r.metadata.name}/${c.name}: env '${env.name}' bærer en leverandørnøgle uden for gatewayen`);
          const value = typeof env.value === "string" ? env.value : "";
          for (const host of DEFAULT_PROVIDER_HOSTS) {
            if (value.includes(host)) messages.push(`${r.metadata.name}/${c.name}: peger direkte på leverandørværten '${host}'`);
          }
        }
      }
    }
    add("E-003", "Ingen workload ud over gatewayen har direkte leverandøradgang", messages.length ? "fail" : "pass", "", messages);
  }

  const failed = checks.filter((c) => c.status === "fail");
  return { status: failed.length ? "fail" : "pass", checks, summary: { pass: checks.length - failed.length, fail: failed.length, total: checks.length } };
}

export function runEgressCheck(root = repoRoot) {
  const report = verifyModelEgress(root);
  for (const c of report.checks) {
    console.log(`  ${c.status === "pass" ? "✔" : "✘"} ${c.id}  ${c.title}${c.detail ? ` — ${c.detail}` : ""}`);
    for (const m of c.messages) console.log(`      - ${m}`);
  }
  console.log(`\n${report.status === "pass" ? "✔ Model-egress-gates bestået" : "✘ Model-egress-gates fejlede"} (${report.summary.pass}/${report.summary.total})`);
  return report;
}

export { existsSync, readFileSync, join };
