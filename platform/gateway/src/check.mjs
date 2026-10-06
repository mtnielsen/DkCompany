#!/usr/bin/env node
/**
 * DKC-012 — fokuseret kontrol af den serverstyrede routing og egress-allowlisten.
 *
 *   node gateway/src/check.mjs
 *
 * Kontrollerer uden et levende leverandør-setup at:
 *   - hver route er velformet og peger på en kendt leverandør,
 *   - personhenførbare dataklasser kun er tilladt med godkendt databehandling,
 *   - alle leverandørværter i koden også står i egress-allowlisten,
 *   - den kanoniske hostliste i gatewayen matcher GitOps-netværkspolitikken.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_CLASSES, PERSONAL_DATA_CLASSES } from "./routing.mjs";
import { DEFAULT_PROVIDER_HOSTS } from "./egress.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/** Kendte leverandører → den vært egress-vagten tillader. */
export const PROVIDER_HOSTS = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  google: "generativelanguage.googleapis.com",
  mistral: "api.mistral.ai",
};

const errors = [];
const notes = [];
const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const config = JSON.parse(readFileSync(join(repoRoot, "gateway", "routes.json"), "utf8"));
check(config.kind === "GatewayRoutes", "routes.json skal være af typen GatewayRoutes");
check(Array.isArray(config.routes) && config.routes.length > 0, "routes.json skal have mindst én route");

const seenIds = new Set();
for (const route of config.routes ?? []) {
  const where = route.id ?? "<uden id>";
  check(typeof route.id === "string" && /^[a-z0-9][a-z0-9-]{2,63}$/.test(route.id), `${where}: ugyldigt route-id`);
  check(!seenIds.has(route.id), `${where}: dubleret route-id`);
  seenIds.add(route.id);
  check(typeof route.agentRef === "string" && route.agentRef.length > 0, `${where}: agentRef mangler`);
  check(typeof route.provider === "string" && route.provider.length > 0, `${where}: provider mangler`);
  check(PROVIDER_HOSTS[route.provider], `${where}: ukendt leverandør '${route.provider}' (tilføj den til egress-allowlisten)`);
  check(typeof route.model === "string" && typeof route.modelVersion === "string", `${where}: model/modelVersion mangler`);
  check(Array.isArray(route.dataClasses) && route.dataClasses.length > 0, `${where}: dataClasses mangler`);
  for (const dc of route.dataClasses ?? []) {
    check(DATA_CLASSES.includes(dc), `${where}: ukendt dataklasse '${dc}'`);
    if (PERSONAL_DATA_CLASSES.has(dc)) {
      check(route.approvedDataProcessing === true, `${where}: personhenførbar dataklasse '${dc}' kræver approvedDataProcessing`);
      check(typeof route.processor === "string" && route.processor.length > 0, `${where}: personhenførbar dataklasse '${dc}' kræver en processor`);
    }
  }
  check(Number.isInteger(route.maxOutputTokens) && route.maxOutputTokens > 0, `${where}: maxOutputTokens mangler`);
  check(Number.isInteger(route.timeoutMs) && route.timeoutMs > 0, `${where}: timeoutMs mangler`);
  check(Number.isFinite(route.costPerTokenEur) && route.costPerTokenEur >= 0, `${where}: costPerTokenEur mangler`);
}

// Hver vært en leverandør kan pege på skal være i egress-allowlisten.
const allowed = new Set(DEFAULT_PROVIDER_HOSTS);
for (const [provider, host] of Object.entries(PROVIDER_HOSTS)) {
  check(allowed.has(host), `leverandøren '${provider}' peger på '${host}', som ikke er i egress-allowlisten`);
}

// GitOps-netværkspolitikken skal indeholde præcis den samme kanoniske liste.
const policyPath = join(repoRoot, "gitops", "manifests", "dev", "model-egress-gateway-allow.json");
try {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const hosts = policy?.spec?.egress?.flatMap((rule) => rule.toFQDNs?.map((t) => t.matchName) ?? []) ?? [];
  for (const host of DEFAULT_PROVIDER_HOSTS) {
    check(hosts.includes(host), `GitOps-netværkspolitikken mangler leverandørværten '${host}'`);
  }
} catch (err) {
  errors.push(`kunne ikke læse GitOps-netværkspolitikken: ${err.message}`);
}

notes.push(`${config.routes.length} routes`);
notes.push(`${Object.keys(PROVIDER_HOSTS).length} leverandører`);
notes.push(`${DEFAULT_PROVIDER_HOSTS.length} egress-værter`);

if (errors.length) {
  console.error("✘ Model-gateway-kontrol fejlede:\n");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Model-gateway-kontrol bestået (${notes.join("; ")})`);
console.log(`✔ Dataklasser: ${DATA_CLASSES.join(", ")} — ukendte afvises`);
