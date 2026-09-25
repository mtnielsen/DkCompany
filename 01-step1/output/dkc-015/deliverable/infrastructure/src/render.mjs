/**
 * DKC-015 — deterministisk rendering af GitOps-manifester og Argo CD-apps fra
 * infrastrukturplanen.
 *
 * Renderingen er ren: samme plan giver samme filer. Den skriver ikke selv;
 * `cli.mjs` står for I/O. Container-images pinnes bevidst til en
 * pladsholder-digest (nul), indtil DKC-014's CI har bygget og signeret dem;
 * `infrastructure/src/drift.mjs` og DKC-014's gate afviser den.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlan, pendingDigest, RENDERED_ENVIRONMENTS } from "./plan.mjs";
import { digestOf } from "../../policy/pdp/src/crypto.mjs";

const BUNDLE_NAME = "platform";
const BUNDLE_VERSION = "1.0.0";

function bundleDigest(root) {
  const bundle = JSON.parse(readFileSync(join(root, "policy", "bundles", BUNDLE_NAME, BUNDLE_VERSION, "bundle.json"), "utf8"));
  return digestOf(bundle);
}

function labels(env, module, extra = {}) {
  return {
    "app.kubernetes.io/name": module,
    "app.kubernetes.io/managed-by": "argocd",
    "platform.example.org/module": module,
    "platform.example.org/environment": env.id,
    ...extra,
  };
}

/** Navnet på den namespace-kontrakt hver ressource bærer. */
function ns(env) {
  return env.namespace;
}

function resourcesFor(port) {
  return { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } };
}

function securityContext() {
  return { runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } };
}

function containerSecurityContext() {
  return { readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } };
}

function argsFor(service) {
  if (service.name === "pdp") return ["serve", "--port", String(service.port)];
  if (service.name === "approvals") return ["--port", String(service.port), "--data-dir", "/data"];
  if (service.workload === "cronjob") {
    return [
      "--manifest",
      "modules/dummy-ok/agents/backup-agent.json",
      "--task",
      "contracts/examples/agent-task.example.json",
    ];
  }
  return [];
}

function serviceAccount(env, service) {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: service.name, namespace: ns(env), labels: labels(env, service.module) },
  };
}

function deployment(env, service, digest) {
  const container = {
    name: service.name,
    image: `${service.image}@sha256:${digest}`,
    args: argsFor(service),
    envFrom: (env.secrets?.references ?? []).map((ref) => ({ secretRef: { name: ref.name } })),
    securityContext: containerSecurityContext(),
    resources: resourcesFor(service.port),
    volumeMounts: [{ name: "data", mountPath: "/data" }],
  };
  if (service.port) {
    container.ports = [{ containerPort: service.port, name: "http" }];
    container.readinessProbe = { httpGet: { path: "/healthz", port: service.port } };
    container.livenessProbe = { httpGet: { path: "/healthz", port: service.port } };
  }
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: service.name, namespace: ns(env), labels: labels(env, service.module) },
    spec: {
      replicas: env.replicas,
      selector: { matchLabels: { "app.kubernetes.io/name": service.name } },
      template: {
        metadata: { labels: labels(env, service.module, { "app.kubernetes.io/name": service.name }) },
        spec: {
          serviceAccountName: service.name,
          securityContext: securityContext(),
          containers: [container],
          volumes: [{ name: "data", persistentVolumeClaim: { claimName: "platform-data" } }],
        },
      },
    },
  };
}

function cronJob(env, service, digest) {
  const container = {
    name: service.name,
    image: `${service.image}@sha256:${digest}`,
    args: argsFor(service),
    envFrom: (env.secrets?.references ?? []).map((ref) => ({ secretRef: { name: ref.name } })),
    securityContext: containerSecurityContext(),
    resources: resourcesFor(null),
  };
  return {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: { name: service.name, namespace: ns(env), labels: labels(env, service.module) },
    spec: {
      schedule: "0 * * * *",
      concurrencyPolicy: "Forbid",
      jobTemplate: {
        spec: {
          template: {
            metadata: { labels: labels(env, service.module, { "app.kubernetes.io/name": service.name }) },
            spec: {
              serviceAccountName: service.name,
              restartPolicy: "Never",
              securityContext: securityContext(),
              containers: [container],
            },
          },
        },
      },
    },
  };
}

function serviceResource(env, service) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: service.name, namespace: ns(env), labels: labels(env, service.module) },
    spec: { selector: { "app.kubernetes.io/name": service.name }, ports: [{ name: "http", port: 443, targetPort: service.port }] },
  };
}

function namespace(env) {
  return { apiVersion: "v1", kind: "Namespace", metadata: { name: ns(env), labels: labels(env, "platform") } };
}

function resourceQuota(env) {
  const services = env.services ?? [];
  const cpu = 500 * env.replicas * services.length;
  const mem = 256 * env.replicas * services.length;
  return {
    apiVersion: "v1",
    kind: "ResourceQuota",
    metadata: { name: `${env.id}-quota`, namespace: ns(env), labels: labels(env, "platform") },
    spec: { hard: { "requests.cpu": `${cpu}m`, "requests.memory": `${mem}Mi`, "limits.cpu": `${cpu * 2}m`, "limits.memory": `${mem * 2}Mi`, "persistentvolumeclaims": "4" } },
  };
}

function limitRange(env) {
  return {
    apiVersion: "v1",
    kind: "LimitRange",
    metadata: { name: `${env.id}-limits`, namespace: ns(env), labels: labels(env, "platform") },
    spec: { limits: [{ type: "Container", default: { cpu: "500m", memory: "256Mi" }, defaultRequest: { cpu: "100m", memory: "128Mi" } }] },
  };
}

function storage(env) {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: "platform-data", namespace: ns(env), labels: labels(env, "platform", { "platform.example.org/encrypted": "true" }) },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: env.storage.className,
      resources: { requests: { storage: `${env.storage.sizeGiB}Gi` } },
    },
  };
}

function pdpBundle(env, digest) {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "pdp-bundle", namespace: ns(env), labels: labels(env, "pdp") },
    data: { bundleName: BUNDLE_NAME, bundleVersion: BUNDLE_VERSION, bundleSha256: digest, failMode: "closed", trustedKeysRef: "pdp-trusted-keys" },
  };
}

function ingress(env) {
  const primary = (env.services ?? []).find((s) => s.port) ?? (env.services ?? [])[0];
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: { name: `${env.id}-ingress`, namespace: ns(env), labels: labels(env, "platform"), annotations: { "cert-manager.io/cluster-issuer": env.tls.issuer } },
    spec: {
      ingressClassName: "nginx",
      tls: [{ hosts: [env.hostname], secretName: env.tls.secretName }],
      rules: [{ host: env.hostname, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: primary.name, port: { number: 443 } } } }] } }],
    },
  };
}

function defaultDeny(env) {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "default-deny", namespace: ns(env), labels: labels(env, "platform") },
    spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"], ingress: [], egress: [] },
  };
}

function allowDns(env) {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "allow-dns", namespace: ns(env), labels: labels(env, "platform") },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        {
          to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }],
          ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }],
        },
      ],
    },
  };
}

function allowInternal(env) {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "allow-internal", namespace: ns(env), labels: labels(env, "platform") },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": ns(env) } } }] }],
      egress: [{ to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": ns(env) } } }] }],
    },
  };
}

function modelEgress(env) {
  return {
    apiVersion: "cilium.io/v2",
    kind: "CiliumNetworkPolicy",
    metadata: { name: "model-egress-gateway-allow", namespace: ns(env), labels: labels(env, "ai-gateway") },
    spec: {
      endpointSelector: { matchLabels: { "app.kubernetes.io/name": "ai-gateway" } },
      egress: [
        {
          toFQDNs: [{ matchName: "api.anthropic.com" }, { matchName: "api.openai.com" }],
          toPorts: [{ ports: [{ port: "443", protocol: "TCP" }] }],
        },
      ],
    },
  };
}

function application(env, service) {
  return {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: { name: `${service.name}-${env.id}`, namespace: "argocd", labels: labels(env, service.module) },
    spec: {
      project: "platform",
      source: { repoURL: "https://git.example.org/platform/contracts.git", targetRevision: "main", path: `gitops/manifests/${env.id}` },
      destination: { server: "https://kubernetes.default.svc", namespace: ns(env) },
      syncPolicy: { automated: { prune: true, selfHeal: true, allowEmpty: false }, syncOptions: ["CreateNamespace=true", "PrunePropagationPolicy=foreground"] },
    },
  };
}

/**
 * Render hele leverancen. Returnerer `{ manifests, apps, environment }` hvor
 * nøglerne er pakkerod-relative stier og værdierne er JSON-objekter.
 */
export function renderPlan(root) {
  const plan = loadPlan(root);
  const digest = bundleDigest(root);
  const manifests = new Map();
  const apps = new Map();
  const pending = pendingDigest();

  for (const env of (plan.environments ?? []).filter((e) => RENDERED_ENVIRONMENTS.includes(e.id))) {
    const base = `gitops/manifests/${env.id}`;
    const put = (name, resource) => manifests.set(`${base}/${name}.json`, resource);
    put("namespace", namespace(env));
    put("resourcequota", resourceQuota(env));
    put("limitrange", limitRange(env));
    put("storage-data", storage(env));
    put("pdp-bundle", pdpBundle(env, digest));
    put("ingress-tls", ingress(env));
    put("network-default-deny", defaultDeny(env));
    put("network-allow-dns", allowDns(env));
    put("network-allow-internal", allowInternal(env));
    put("network-ai-gateway-egress", modelEgress(env));

    for (const service of env.services ?? []) {
      put(`${service.name}-serviceaccount`, serviceAccount(env, service));
      if (service.workload === "cronjob") put(`${service.name}-cronjob`, cronJob(env, service, pending));
      else put(`${service.name}-deployment`, deployment(env, service, pending));
      if (service.port) put(`${service.name}-service`, serviceResource(env, service));
      apps.set(`gitops/apps/${env.id}/${service.name}-application.json`, application(env, service));
    }
  }
  return { manifests, apps, plan };
}
