/**
 * DKC-048 — deterministisk rendering af håndhævelsesmanifester.
 *
 * Renderingen er ren: samme politik giver samme filer. Manifestet demonstrerer
 * den faktiske håndhævelse: object-lock-konfiguration på bucket'en, en
 * RBAC-/policy-nægtelse af AI-roller og indirekte adminveje, en append-only
 * audit-ingest-rolle, en KMS-nøglepolitik der forbyder AI-sletning, samt
 * to-personers godkendelsespolitik og default-deny-netværk.
 */
/**
 * DKC-048 — deterministisk rendering af håndhævelsesmanifester.
 *
 * Renderingen er ren: samme politik giver samme filer. Manifestet demonstrerer
 * den faktiske håndhævelse: object-lock-konfiguration på bucket'en, en
 * RBAC-/policy-nægtelse af AI-roller og indirekte adminveje, en append-only
 * audit-ingest-rolle, en KMS-nøglepolitik der forbyder AI-sletning, samt
 * to-personers godkendelsespolitik og default-deny-netværk.
 */
export const IMMUTABLE_NAMESPACE = "platform-data-protection";
export const IMMUTABLE_MANIFESTS_DIR = "gitops/manifests/data-protection";

function labels(name) {
  return {
    "app.kubernetes.io/name": name,
    "app.kubernetes.io/managed-by": "argocd",
    "platform.example.org/module": name,
    "platform.example.org/environment": "data-protection",
  };
}

function namespace() {
  return { apiVersion: "v1", kind: "Namespace", metadata: { name: IMMUTABLE_NAMESPACE, labels: labels("platform-data-protection") } };
}

function objectLockConfiguration(policy) {
  return {
    apiVersion: "objectstore.platform.example.org/v1alpha1",
    kind: "ObjectLockConfiguration",
    metadata: { name: "immutable-object-lock", namespace: IMMUTABLE_NAMESPACE, labels: labels("object-lock") },
    spec: {
      product: policy.storageProduct.name,
      version: policy.storageProduct.version,
      versioning: policy.storageProduct.versioning,
      objectLock: policy.storageProduct.objectLock,
      lockModes: policy.storageProduct.lockModes,
      defaultMode: "COMPLIANCE",
      governanceBypassRequiresHuman: policy.storageProduct.verification.governanceBypassRequiresHuman,
      complianceNonBypassable: policy.storageProduct.verification.complianceNonBypassable,
      verifyBeforeRelease: true,
    },
  };
}

function agentDenyPolicy(policy) {
  return {
    apiVersion: "kyverno.io/v1",
    kind: "ClusterPolicy",
    metadata: { name: "deny-ai-immutable-admin", labels: labels("agent-deny") },
    spec: {
      validationFailureAction: "Enforce",
      background: false,
      rules: [
        {
          name: "deny-ai-mutations",
          match: { any: [{ resources: { kinds: ["ObjectStoreObject", "BucketPolicy", "KMSKey", "ServiceAccount", "TrustConfig"] } }] },
          preconditions: {
            any: [{ key: "{{ request.userInfo.groups }}", operator: "AnyIn", value: ["platform:ai-agents"] }],
          },
          validate: {
            message: "AI-agenter må ikke mutere beskyttede data eller deres nøgler",
            deny: {
              conditions: {
                any: (policy.agentDenials.forbiddenOperations ?? []).map((op) => ({ key: `{{ request.operation }}`, operator: "Equals", value: op })),
              },
            },
          },
        },
        {
          name: "deny-indirect-admin-paths",
          match: { any: [{ resources: { kinds: ["ClusterRoleBinding", "BucketPolicy", "KMSKeyPolicy", "TokenRequest"] } }] },
          preconditions: { any: [{ key: "{{ request.userInfo.groups }}", operator: "AnyIn", value: ["platform:ai-agents"] }] },
          validate: { message: "AI-agenter må ikke bruge indirekte adminveje", deny: { conditions: { any: [{ key: "{{ request.operation }}", operator: "In", value: ["create", "update", "patch", "delete"] }] } } },
        },
      ],
    },
  };
}

function auditIngestRbac(policy) {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    metadata: { name: "audit-ingest-append-only", namespace: IMMUTABLE_NAMESPACE, labels: labels("audit-ingest") },
    rules: [
      { apiGroups: ["objectstore.platform.example.org"], resources: ["objectstoreobjects"], verbs: ["create"] },
      { apiGroups: ["objectstorage.k8s.io"], resources: ["objects"], verbs: ["create"] },
    ],
    annotations: {
      "platform.example.org/mode": policy.auditIngest.mode,
      "platform.example.org/cannot-delete": String(policy.auditIngest.cannotDelete),
      "platform.example.org/cannot-update": String(policy.auditIngest.cannotUpdate),
      "platform.example.org/separate-from-admin": String(policy.auditIngest.separateFromAdmin),
    },
  };
}

function kmsKeyPolicy(policy) {
  const keyResources = (policy.protectedResources ?? []).filter((r) => r.kind === "kms-key");
  return {
    apiVersion: "kms.platform.example.org/v1alpha1",
    kind: "KeyPolicy",
    metadata: { name: "protect-kms-keys", namespace: IMMUTABLE_NAMESPACE, labels: labels("kms-key-policy") },
    spec: {
      keyResources: keyResources.map((r) => ({ id: r.id, ref: r.ref, deletionProtected: r.deletionProtected, keyDomain: r.keyDomain })),
      denyAiDelete: true,
      denyAiRotate: false,
      deletionRequiresTwoPerson: true,
      retainOldVersions: true,
    },
  };
}

function twoPersonPolicy(policy) {
  return {
    apiVersion: "governance.platform.example.org/v1alpha1",
    kind: "ApprovalPolicy",
    metadata: { name: "immutable-two-person", namespace: IMMUTABLE_NAMESPACE, labels: labels("two-person") },
    spec: {
      controls: Object.entries(policy.twoPersonControl).map(([id, rule]) => ({ id, required: rule.required, requesterMayNotApprove: rule.requesterMayNotApprove })),
    },
  };
}

function defaultDeny() {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "default-deny", namespace: IMMUTABLE_NAMESPACE, labels: labels("platform-data-protection") },
    spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"], ingress: [], egress: [] },
  };
}

/** Render alle håndhævelsesmanifester. Returnerer Map<pakkerod-relativ sti, objekt>. */
export function renderImmutablePolicy(policy) {
  const manifests = new Map();
  const put = (name, resource) => manifests.set(`${IMMUTABLE_MANIFESTS_DIR}/${name}.json`, resource);
  put("namespace", namespace());
  put("object-lock-policy", objectLockConfiguration(policy));
  put("agent-deny-policy", agentDenyPolicy(policy));
  put("audit-ingest-rbac", auditIngestRbac(policy));
  put("kms-key-policy", kmsKeyPolicy(policy));
  put("two-person-approval-policy", twoPersonPolicy(policy));
  put("network-default-deny", defaultDeny());
  return manifests;
}
