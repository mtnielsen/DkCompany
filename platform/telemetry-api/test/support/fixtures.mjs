import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalSigner, signersToJwks } from "../../../credentials/src/keys.mjs";
import { signJws } from "../../../credentials/src/jws.mjs";
import { loadCollectorRegistry } from "../../src/envelope.mjs";
import { createJwsAuthenticator } from "../../src/server.mjs";

export const root = new URL("../../..", import.meta.url).pathname;
export const NOW = Date.parse("2025-09-01T10:00:00Z");
export const TRACE = "0123456789abcdef0123456789abcdef";
export const registry = loadCollectorRegistry(root);

export function makeEnvelope(overrides = {}) {
  const base = {
    schemaVersion: "1.0",
    kind: "TelemetryEnvelope",
    id: "env-1",
    occurredAt: new Date(NOW).toISOString(),
    signal: "metric",
    source: { id: "otel-collector", kind: "otel", version: "0.110.0" },
    scope: { tenantId: "acme", environment: "staging", service: "dummy-ok" },
    resource: "res://acme/service/dummy-ok",
    dataClassification: "operational",
    otel: { metric: { name: "http_requests_total", value: 100, unit: "1" } },
    labels: { status: "200" },
  };
  const merged = { ...base, ...overrides };
  const tenantId = merged.scope?.tenantId ?? "acme";
  merged.resource = overrides.resource ?? `res://${tenantId}/service/dummy-ok`;
  merged.relations = overrides.relations ?? { environment: "res://platform/environment/staging", trace: `res://${tenantId}/trace/${TRACE}` };
  return merged;
}

export function metricEnvelope(name, value, { tenantId = "acme", at = new Date(NOW).toISOString(), labels = {}, id = `${name}-${value}` } = {}) {
  return makeEnvelope({ id, occurredAt: at, scope: { tenantId, environment: "staging", service: "dummy-ok" }, resource: `res://${tenantId}/service/dummy-ok`, labels, otel: { metric: { name, value } } });
}

/** Principaler. */
export const acmeOperator = { id: "oidc|acme-operator", tenantId: "acme", roles: ["operator"], viewScope: ["view:operations", "view:vulnerabilities", "view:test-release"], environment: "staging" };
export const acmeAdmin = { id: "oidc|acme-admin", tenantId: "acme", roles: ["platform-admin"], viewScope: ["view:operations", "view:vulnerabilities", "view:test-release", "view:recovery", "view:ai"], environment: "staging" };
export const globexPlatformAdmin = { id: "oidc|platform-admin", roles: ["platform-admin", "platform-admin:globex"], viewScope: ["view:operations", "view:vulnerabilities", "view:test-release", "view:recovery", "view:ai"], environment: "staging" };
export const securityOfficer = { id: "oidc|cecilia.christensen", tenantId: "acme", roles: ["security-officer"], viewScope: ["view:vulnerabilities"], environment: "staging" };
export const aiOwner = { id: "oidc|ai-owner", tenantId: "acme", roles: ["ai-owner"], viewScope: ["view:ai"], environment: "staging" };

/** Byg en fungerende authenticator + token-udsteder til servertests. */
export function createTestAuth() {
  const signer = createLocalSigner({ kid: "telemetry-test" });
  const jwks = signersToJwks([signer]);
  const authenticator = createJwsAuthenticator({ jwks, clock: () => NOW, maxSkewSeconds: 60 });
  function token(principal, { expSeconds = 3600, aud = "telemetry-api", iat = Math.floor(NOW / 1000) } = {}) {
    return signJws({
      signer,
      claims: {
        sub: principal.id,
        tenantId: principal.tenantId ?? undefined,
        roles: principal.roles ?? [],
        viewScope: principal.viewScope ?? [],
        environment: principal.environment ?? "staging",
        service: principal.service ?? undefined,
        kind: principal.kind ?? "service",
        aud,
        iat,
        exp: iat + expSeconds,
      },
    });
  }
  return { signer, jwks, authenticator, token };
}

export function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}
