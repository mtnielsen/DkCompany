/**
 * DKC-039 — deterministisk rendering af database-HA-manifester.
 *
 * Renderingen er ren: samme plan giver samme filer. Manifesterne demonstrerer
 * de felter planen kræver: en CloudNativePG-`Cluster` med synkron replikering,
 * en planlagt base-backup til WAL-arkivet, et disruption budget der respekterer
 * quorum, en default-deny-netværkspolitik og alarmer for replikations- og
 * arkivfejl.
 *
 * Container-images og secrets refereres symbolsk; de bygges/signeres af
 * DKC-014's forsyningskæde og injiceres af DKC-015's secrets-lag.
 */
export const DB_HA_NAMESPACE = "platform-data";
export const DB_HA_MANIFESTS_DIR = "gitops/manifests/db-ha";

function labels(plan, extra = {}) {
  return {
    "app.kubernetes.io/name": plan.metadata.name,
    "app.kubernetes.io/managed-by": "argocd",
    "platform.example.org/environment": "staging",
    ...extra,
  };
}

export function renderDatabaseHAPlan(plan) {
  const manifests = new Map();
  const topology = plan.topology;
  const namespace = DB_HA_NAMESPACE;
  const syncNames = topology.instances.filter((i) => i.role === "sync-replica").map((i) => i.id);
  const syncList = `${syncNames.join(",")}`;

  manifests.set(`${DB_HA_MANIFESTS_DIR}/cluster.json`, {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Cluster",
    metadata: {
      name: plan.metadata.name,
      namespace,
      labels: labels(plan),
      annotations: {
        "platform.example.org/engine": plan.engine.family,
        "platform.example.org/operator": `${plan.engine.operator}@${plan.engine.operatorVersion}`,
        "platform.example.org/failover-controller": plan.engine.failoverController,
      },
    },
    spec: {
      instances: topology.instances.length,
      primaryUpdateStrategy: "supervised",
      storage: { size: "50Gi", storageClass: "encrypted-ssd-rwo" },
      postgresql: {
        parameters: {
          synchronous_commit: "remote_apply",
          synchronous_standby_names: `ANY ${topology.minSyncReplicasForWrites} (${syncList})`,
          wal_level: "replica",
        },
      },
      minSyncReplicas: topology.minSyncReplicasForWrites,
      maxSyncReplicas: topology.syncReplicas,
      failoverDelay: 0,
      monitoring: { enablePodMonitor: true },
      affinity: {
        topologyKey: "topology.kubernetes.io/zone",
        enablePodAntiAffinity: true,
        nodeSelector: { "platform.example.org/data": "true" },
      },
      backup: {
        barmanObjectStore: {
          destinationPath: plan.wal.archiveTarget,
          wal: { compression: "gzip", encryption: "AES256" },
          data: { compression: "gzip", encryption: "AES256" },
        },
        retentionPolicy: `${plan.wal.retentionHours}h`,
      },
    },
  });

  manifests.set(`${DB_HA_MANIFESTS_DIR}/scheduled-backup.json`, {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "ScheduledBackup",
    metadata: { name: `${plan.metadata.name}-basebackup`, namespace, labels: labels(plan) },
    spec: {
      schedule: plan.wal.baseBackupSchedule,
      backupOwnerReference: "self",
      cluster: { name: plan.metadata.name },
      immediate: true,
    },
  });

  manifests.set(`${DB_HA_MANIFESTS_DIR}/pod-disruption-budget.json`, {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: { name: `${plan.metadata.name}-pdb`, namespace, labels: labels(plan) },
    spec: {
      minAvailable: topology.quorum,
      selector: { matchLabels: { "app.kubernetes.io/name": plan.metadata.name } },
    },
  });

  manifests.set(`${DB_HA_MANIFESTS_DIR}/network-policy.json`, {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: `${plan.metadata.name}-netpol`, namespace, labels: labels(plan) },
    spec: {
      podSelector: { matchLabels: { "app.kubernetes.io/name": plan.metadata.name } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        { from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": plan.metadata.name } } }], ports: [{ port: 5432, protocol: "TCP" }] },
        { from: [{ namespaceSelector: { matchLabels: { "platform.example.org/role": "control-plane" } } }], ports: [{ port: 5432, protocol: "TCP" }] },
      ],
      egress: [
        { to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": plan.metadata.name } } }], ports: [{ port: 5432, protocol: "TCP" }] },
        { to: [{ namespaceSelector: { matchLabels: { "platform.example.org/role": "backup" } } }], ports: [{ port: 443, protocol: "TCP" }] },
      ],
    },
  });

  manifests.set(`${DB_HA_MANIFESTS_DIR}/prometheus-rule.json`, {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "PrometheusRule",
    metadata: { name: `${plan.metadata.name}-alerts`, namespace, labels: labels(plan) },
    spec: {
      groups: [
        {
          name: `${plan.metadata.name}.replication`,
          rules: [
            { alert: "DatabaseSyncReplicaLow", expr: `cnpg_pg_replication_streaming_replicas{cluster="${plan.metadata.name}"} < ${topology.syncReplicas}`, for: "5m", labels: { severity: "critical" }, annotations: { summary: "Færre sync-replikaer end politikken kræver — writes skal afvises." } },
            { alert: "DatabaseWALArchiveFailing", expr: `cnpg_pg_stat_archiver_failed_total{cluster="${plan.metadata.name}"} > 0`, for: "10m", labels: { severity: "critical" }, annotations: { summary: "WAL-arkivering fejler — PITR er i fare." } },
            { alert: "DatabaseFencedNode", expr: `cnpg_collector_fencing_activetotal{cluster="${plan.metadata.name}"} > 0`, for: "1m", labels: { severity: "warning" }, annotations: { summary: "En node er fenced efter promotion." } },
          ],
        },
      ],
    },
  });

  return manifests;
}
