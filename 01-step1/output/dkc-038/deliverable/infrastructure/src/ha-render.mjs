/**
 * DKC-038 — deterministisk rendering af HA-manifester fra HA-planen.
 *
 * Renderingen er ren: samme plan giver samme filer. Den skriver ikke selv.
 * Manifestet demonstrerer de HA-felter planen kræver: replikaer, startup-/
 * readiness-/liveness-probes, topology spread, disruption budgets,
 * ressourcegrænser, mTLS-annoteringer og default-deny-netværkspolitik.
 *
 * Container-images pinnes bevidst til en pladsholder-digest (nul), indtil
 * DKC-014's CI har bygget og signeret dem.
 */
import { pendingDigest } from "./plan.mjs";

export const HA_NAMESPACE = "platform-ha";
export const HA_MANIFESTS_DIR = "gitops/manifests/ha";

function labels(module, extra = {}) {
  return {
    "app.kubernetes.io/name": module,
    "app.kubernetes.io/managed-by": "argocd",
    "platform.example.org/module": module,
    "platform.example.org/environment": "ha",
    ...extra,
  };
}

function podSpec(plan, workload, digest, extra = {}) {
  return {
    serviceAccountName: workload.id,
    securityContext: { runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
    containers: [
      {
        name: workload.id,
        image: `ghcr.io/example/platform-${workload.id}@sha256:${digest}`,
        ports: workload.port ? [{ containerPort: workload.port, name: "http" }] : [],
        startupProbe: probeFor(workload.probes.startup),
        readinessProbe: probeFor(workload.probes.readiness),
        livenessProbe: probeFor(workload.probes.liveness),
        resources: workload.resources,
        securityContext: { readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
      },
    ],
    ...extra,
  };
}

function probeFor(probe) {
  return {
    httpGet: { path: probe.path, port: probe.port },
    initialDelaySeconds: probe.initialDelaySeconds,
    periodSeconds: probe.periodSeconds,
    failureThreshold: probe.failureThreshold,
  };
}

function topologySpread(workload) {
  const spread = workload.topologySpread;
  if (!spread) return undefined;
  return [
    {
      maxSkew: spread.maxSkew,
      topologyKey: spread.domainLabel,
      whenUnsatisfiable: spread.whenUnsatisfiable,
      labelSelector: { matchLabels: { "app.kubernetes.io/name": workload.id } },
    },
  ];
}

function deployment(plan, workload, digest) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: workload.id,
      namespace: HA_NAMESPACE,
      labels: labels(workload.id),
      annotations: mTLSAnnotations(plan),
    },
    spec: {
      replicas: workload.replicas,
      selector: { matchLabels: { "app.kubernetes.io/name": workload.id } },
      template: {
        metadata: { labels: labels(workload.id), annotations: mTLSAnnotations(plan) },
        spec: podSpec(plan, workload, digest, { topologySpreadConstraints: topologySpread(workload) }),
      },
    },
  };
}

function statefulSet(plan, workload, digest) {
  return {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: {
      name: workload.id,
      namespace: HA_NAMESPACE,
      labels: labels(workload.id),
      annotations: { ...mTLSAnnotations(plan), "platform.example.org/write-mode": workload.statefulPlan.writeMode },
    },
    spec: {
      serviceName: workload.id,
      replicas: workload.replicas,
      podManagementPolicy: "Parallel",
      selector: { matchLabels: { "app.kubernetes.io/name": workload.id } },
      template: {
        metadata: { labels: labels(workload.id), annotations: mTLSAnnotations(plan) },
        spec: podSpec(plan, workload, digest),
      },
      volumeClaimTemplates: [
        {
          metadata: { name: "data" },
          spec: { accessModes: ["ReadWriteOnce"], storageClassName: "encrypted-ssd-rwo", resources: { requests: { storage: "50Gi" } } },
        },
      ],
    },
  };
}

function service(workload) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: workload.id, namespace: HA_NAMESPACE, labels: labels(workload.id), annotations: { "platform.example.org/service-discovery": "headless" } },
    spec: {
      clusterIP: "None",
      selector: { "app.kubernetes.io/name": workload.id },
      ports: workload.port ? [{ name: "http", port: workload.port, targetPort: workload.port }] : [],
    },
  };
}

function pdb(workload) {
  return {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: { name: workload.id, namespace: HA_NAMESPACE, labels: labels(workload.id) },
    spec: { minAvailable: workload.disruptionBudget.minAvailable, maxUnavailable: workload.disruptionBudget.maxUnavailable, selector: { matchLabels: { "app.kubernetes.io/name": workload.id } } },
  };
}

function mTLSAnnotations(plan) {
  return { "platform.example.org/mtls": plan.certificates.peerIdentity, "platform.example.org/cert-rotation-days": String(plan.certificates.rotationDays) };
}

function namespace() {
  return { apiVersion: "v1", kind: "Namespace", metadata: { name: HA_NAMESPACE, labels: labels("platform") } };
}

function defaultDeny() {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "default-deny", namespace: HA_NAMESPACE, labels: labels("platform") },
    spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"], ingress: [], egress: [] },
  };
}

function allowInternal() {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "allow-internal", namespace: HA_NAMESPACE, labels: labels("platform") },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": HA_NAMESPACE } } }] }],
      egress: [{ to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": HA_NAMESPACE } } }] }],
    },
  };
}

function allowIngress() {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "allow-ingress", namespace: HA_NAMESPACE, labels: labels("platform") },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "ingress-controller" } } }] }],
    },
  };
}

function allowDns() {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "allow-dns", namespace: HA_NAMESPACE, labels: labels("platform") },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [{ to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }] }],
    },
  };
}

function ciliumCrossTenantDeny() {
  return {
    apiVersion: "cilium.io/v2",
    kind: "CiliumNetworkPolicy",
    metadata: { name: "cross-tenant-deny", namespace: HA_NAMESPACE, labels: labels("platform") },
    spec: {
      endpointSelector: {},
      ingressDeny: [{ fromEntities: ["all"] }],
      ingress: [{ fromEndpoints: [{ matchLabels: { "k8s:io.kubernetes.pod.namespace": HA_NAMESPACE } }] }],
    },
  };
}

function ingressController(plan) {
  const health = plan.ingress.healthCheck;
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "ingress-controller", namespace: HA_NAMESPACE, labels: labels("ingress-controller") },
    spec: {
      replicas: plan.ingress.replicas,
      selector: { matchLabels: { "app.kubernetes.io/name": "ingress-controller" } },
      template: {
        metadata: { labels: labels("ingress-controller") },
        spec: {
          topologySpreadConstraints: [
            { maxSkew: 1, topologyKey: "topology.kubernetes.io/zone", whenUnsatisfiable: "DoNotSchedule", labelSelector: { matchLabels: { "app.kubernetes.io/name": "ingress-controller" } } },
          ],
          containers: [
            {
              name: "ingress-controller",
              image: `ghcr.io/example/${plan.ingress.controller}@sha256:${pendingDigest()}`,
              ports: [{ containerPort: 443, name: "https" }, { containerPort: health.port, name: "health" }],
              readinessProbe: probeFor(health),
              livenessProbe: probeFor(health),
              resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } },
            },
          ],
        },
      },
    },
  };
}

function ingressControllerPdb(plan) {
  return {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: { name: "ingress-controller", namespace: HA_NAMESPACE, labels: labels("ingress-controller") },
    spec: { minAvailable: Math.max(1, plan.ingress.replicas - 1), selector: { matchLabels: { "app.kubernetes.io/name": "ingress-controller" } } },
  };
}

function ingressTls(plan) {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name: "ha-ingress",
      namespace: HA_NAMESPACE,
      labels: labels("platform"),
      annotations: { "cert-manager.io/cluster-issuer": plan.certificates.issuer, "platform.example.org/dns-failover": plan.dns.failover },
    },
    spec: {
      ingressClassName: plan.ingress.controller,
      tls: [{ hosts: [`ha.${plan.dns.zone}`], secretName: "ha-platform-tls" }],
      rules: [
        {
          host: `ha.${plan.dns.zone}`,
          http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: plan.workloads[0].id, port: { number: plan.workloads[0].port } } } }] },
        },
      ],
    },
  };
}

/** Render alle HA-manifester. Returnerer en Map<pakkerod-relativ sti, objekt>. */
export function renderHAPlan(plan) {
  const manifests = new Map();
  const put = (name, resource) => manifests.set(`${HA_MANIFESTS_DIR}/${name}.json`, resource);
  put("namespace", namespace());
  put("network-default-deny", defaultDeny());
  put("network-allow-internal", allowInternal());
  put("network-allow-ingress", allowIngress());
  put("network-allow-dns", allowDns());
  put("network-cross-tenant-deny", ciliumCrossTenantDeny());
  put("ingress-controller-deployment", ingressController(plan));
  put("ingress-controller-pdb", ingressControllerPdb(plan));
  put("ingress-tls", ingressTls(plan));
  for (const workload of plan.workloads ?? []) {
    put(`${workload.id}-${workload.kind}`, workload.stateless ? deployment(plan, workload, pendingDigest()) : statefulSet(plan, workload, pendingDigest()));
    put(`${workload.id}-service`, service(workload));
    put(`${workload.id}-pdb`, pdb(workload));
  }
  return manifests;
}
