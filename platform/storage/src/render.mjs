/**
 * DKC-041 — deterministisk rendering af lager-manifester fra planen.
 *
 * Renderingen er ren: samme plan giver samme filer. Manifestet demonstrerer de
 * felter planen kræver: en CSI-StorageClass med replikering, topologi-spredning
 * over fejldomæner og kryptering, et S3-kompatibelt objektlager med versions-
 * styring og object-lock, default-deny-netværk, en scrub-CronJob og
 * kapacitetsalarmer.
 *
 * Container-images pinnes bevidst til en pladsholder-digest (nul), indtil
 * DKC-014's CI har bygget og signeret dem.
 */
import { pendingDigest } from "../../infrastructure/src/plan.mjs";

export const STORAGE_NAMESPACE = "platform-storage";
export const STORAGE_MANIFESTS_DIR = "gitops/manifests/storage";

function labels(name) {
  return {
    "app.kubernetes.io/name": name,
    "app.kubernetes.io/managed-by": "argocd",
    "platform.example.org/module": name,
    "platform.example.org/environment": "storage",
  };
}

function namespace() {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: STORAGE_NAMESPACE, labels: labels("platform-storage") },
  };
}

function storageClass(plan) {
  const csi = plan.provider.csi;
  const topology = plan.topology;
  const domains = plan.failureDomains;
  return {
    apiVersion: "storage.k8s.io/v1",
    kind: "StorageClass",
    metadata: {
      name: `${csi.name.toLowerCase()}-replicated`,
      labels: labels("platform-storage"),
      annotations: {
        "platform.example.org/failure-model": csi.failureModel,
        "platform.example.org/docs-ref": csi.docsRef,
        "platform.example.org/replica-factor": String(topology.replicaFactor),
      },
    },
    provisioner: `driver.longhorn.io`,
    reclaimPolicy: "Retain",
    volumeBindingMode: "WaitForFirstConsumer",
    allowVolumeExpansion: true,
    parameters: {
      numberOfReplicas: String(topology.replicaFactor),
      staleReplicaTimeout: "30",
      dataLocality: "best-effort",
      encrypted: "true",
    },
    allowedTopologies: [
      { matchLabelExpressions: [{ key: "topology.kubernetes.io/zone", values: domains }] },
    ],
  };
}

function objectStoreBucket(plan) {
  const store = plan.provider.objectStore;
  const ec = plan.topology.erasureCoding;
  const object = {
    apiVersion: "objectstore.platform.example.org/v1alpha1",
    kind: "ObjectStoreBucket",
    metadata: {
      name: "tenant-object-store",
      namespace: STORAGE_NAMESPACE,
      labels: labels("object-store"),
      annotations: { "platform.example.org/docs-ref": store.docsRef },
    },
    spec: {
      provider: store.name,
      version: store.version,
      s3Compatible: store.s3Compatible,
      versioning: store.versioning,
      objectLock: { enabled: store.objectLock, mode: "GOVERNANCE" },
      failureModel: store.failureModel,
      tenantScopedKeys: plan.keys.tenantScoped,
      keyProvider: plan.keys.provider,
    },
  };
  if (ec) {
    object.spec.erasureCoding = { dataShards: ec.dataShards, parityShards: ec.parityShards, minShards: ec.minShards };
  }
  return object;
}

function defaultDeny() {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "default-deny", namespace: STORAGE_NAMESPACE, labels: labels("platform-storage") },
    spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"], ingress: [], egress: [] },
  };
}

function scrubCronJob(plan) {
  const scrub = plan.scrub;
  return {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: { name: "storage-scrub", namespace: STORAGE_NAMESPACE, labels: labels("storage-scrub") },
    spec: {
      schedule: `0 */${scrub.intervalHours} * * *`,
      concurrencyPolicy: "Forbid",
      jobTemplate: {
        spec: {
          template: {
            metadata: { labels: labels("storage-scrub") },
            spec: {
              restartPolicy: "OnFailure",
              containers: [
                {
                  name: "scrub",
                  image: `ghcr.io/example/platform-storage@sha256:${pendingDigest()}`,
                  args: ["scrub", "--repair"],
                  resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
                },
              ],
            },
          },
        },
      },
    },
  };
}

function capacityAlertRule(plan) {
  const capacity = plan.capacity;
  return {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "PrometheusRule",
    metadata: { name: "storage-capacity-alerts", namespace: STORAGE_NAMESPACE, labels: labels("storage-alerts") },
    spec: {
      groups: [
        {
          name: "storage.capacity",
          rules: capacity.alerts.map((alert) => ({
            alert: alert.name,
            expr: `(storage_host_free_bytes / storage_host_capacity_bytes) * 100 < ${alert.atFreePercent}`,
            for: "10m",
            labels: { severity: alert.severity },
            annotations: { summary: `Lagerkapacitet under ${alert.atFreePercent} % fri` },
          })),
        },
      ],
    },
  };
}

/** Render alle lager-manifester. Returnerer en Map<pakkerod-relativ sti, objekt>. */
export function renderStoragePlan(plan) {
  const manifests = new Map();
  const put = (name, resource) => manifests.set(`${STORAGE_MANIFESTS_DIR}/${name}.json`, resource);
  put("namespace", namespace());
  put("storage-class", storageClass(plan));
  put("object-store-bucket", objectStoreBucket(plan));
  put("network-default-deny", defaultDeny());
  put("scrub-cronjob", scrubCronJob(plan));
  put("capacity-alerts", capacityAlertRule(plan));
  return manifests;
}
