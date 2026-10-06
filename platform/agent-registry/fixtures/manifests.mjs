/**
 * DKC-055 — syntetiske agent-manifester til test. Disse er fixtures, ikke
 * driftskonfiguration.
 */

const CAPABILITIES = {
  observer: [{ verb: "observe.read", target: "dummy-ok", autonomyClass: "A0" }],
  planner: [{ verb: "propose", target: "dummy-ok", autonomyClass: "A1" }],
  implementer: [{ verb: "propose", target: "dummy-ok", autonomyClass: "A1" }],
  verifier: [{ verb: "verify-restore", target: "dummy-ok", autonomyClass: "A0" }],
  executor: [{ verb: "upgrade.patch", target: "dummy-ok", autonomyClass: "A3", requiredEvidence: ["policy-allow"] }],
  auditor: [{ verb: "observe.read", target: "dummy-ok", autonomyClass: "A0" }],
};

export function manifestFor(role, overrides = {}) {
  const name = overrides.name ?? `test-${role}`;
  const base = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentManifest",
    role,
    metadata: {
      name,
      version: "1.0.0",
      description: `Testagent med rollen ${role}`,
      accountableHuman: { subject: "oidc|anna.andersen", role: "Platform Owner" },
    },
    identity: {
      spiffeId: overrides.spiffeId ?? `spiffe://platform.example.org/agents/${name}`,
      credentialMode: "just-in-time",
      maxCredentialTtlSeconds: 900,
    },
    scope: { ownedComponents: ["dummy-ok"], environments: ["staging"], dataCategories: ["operational"] },
    capabilities: overrides.capabilities ?? CAPABILITIES[role] ?? [{ verb: "observe.read", target: "dummy-ok", autonomyClass: "A0" }],
    escalation: { confidenceThreshold: 0.85, repeatFailureLimit: 3, onGovernanceUnreachable: "halt" },
    model: overrides.model ?? { provider: "anthropic", model: "claude-sonnet", modelVersion: "2025-01", promptRef: "prompts/test.md" },
    oversight: { killSwitch: { perAgent: true, global: true }, approverGroups: ["platform-approvers"] },
  };
  return { ...base, ...overrides };
}

export function humanAdmin(id = "oidc|admin", roles = ["platform-admin"]) {
  return { kind: "human", id, roles };
}

export function humanOwner(id = "oidc|owner") {
  return { kind: "human", id, roles: ["agent-owner"] };
}
