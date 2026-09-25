/**
 * DKC-050 — deterministisk rendering af skaleringspolitikker og kapacitetsrapport.
 *
 * Renderingen er ren: samme plan giver samme filer. Manifestet demonstrerer
 * stateless- og køworker-autoskalering, en tenantkvote og et disruption budget.
 * Kapacitetsrapporten er en model (`measured: false`); den levende lasttest
 * ligger uden for dette miljø.
 */
import { CAPACITY_MANIFESTS_DIR, CAPACITY_REPORT_PATH, CAPACITY_DOC_PATH } from "./model.mjs";

function labels(name) {
  return {
    "app.kubernetes.io/name": name,
    "app.kubernetes.io/managed-by": "argocd",
    "platform.example.org/module": name,
    "platform.example.org/environment": "performance",
  };
}

function autoscaleManifest(workload) {
  const name = workload.id;
  const spec = {
    scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name },
    minReplicas: workload.autoscale.minReplicas,
    maxReplicas: workload.autoscale.maxReplicas,
    behavior: {
      scaleUp: { stabilizationWindowSeconds: workload.autoscale.scaleUpCooldownSeconds },
      scaleDown: { stabilizationWindowSeconds: workload.autoscale.scaleDownCooldownSeconds },
    },
  };
  if (workload.autoscale.mode === "cpu") {
    spec.metrics = [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: workload.autoscale.targetUtilizationPercent } } }];
  } else {
    spec.metrics = [
      {
        type: "External",
        external: {
          metric: { name: "queue_depth", selector: { matchLabels: { module: workload.moduleRef } } },
          target: { type: "AverageValue", averageValue: `${workload.autoscale.targetQueueDepth}` },
        },
      },
    ];
  }
  return {
    apiVersion: "autoscaling/v2",
    kind: "HorizontalPodAutoscaler",
    metadata: { name: `${name}-autoscaler`, labels: labels(name) },
    spec,
  };
}

function tenantQuotaManifest(plan) {
  const q = plan.tenantQuotas.default;
  return {
    apiVersion: "v1",
    kind: "ResourceQuota",
    metadata: { name: "tenant-quota-template", labels: labels("tenant-quota") },
    spec: {
      hard: {
        "requests.cpu": `${q.maxConnections}`,
        "requests.memory": `${q.maxStorageGb}Gi`,
        "limits.cpu": `${q.maxConnections}`,
        "limits.memory": `${q.maxStorageGb}Gi`,
        "count/jobs.batch": String(q.maxConcurrentJobs),
        "requests.nvidia.com/gpu": "0",
      },
      annotations: {
        "platform.example.org/max-requests-per-second": String(q.maxRequestsPerSecond),
        "platform.example.org/max-ai-calls-per-day": String(q.maxAiCallsPerDay),
        "platform.example.org/max-share-percent": String(plan.tenantQuotas.maxSharePercent),
        "platform.example.org/on-exceed": plan.tenantQuotas.onExceed,
      },
    },
  };
}

function disruptionBudgetManifest(plan) {
  const workloads = plan.workloads.filter((w) => w.kind === "stateless");
  return {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: { name: "performance-stateless-pdb", labels: labels("performance") },
    spec: {
      minAvailable: workloads.length ? Math.max(1, Math.min(...workloads.map((w) => w.replicas.min - 1))) : 1,
      selector: { matchLabels: { "platform.example.org/tier": "stateless" } },
    },
  };
}

function reportMarkdown(report) {
  const lines = [];
  lines.push("# Kapacitets- og skaleringsrapport");
  lines.push("");
  lines.push("> Genereret fra `performance/capacity-plan.json` med `make performance-render`.");
  lines.push("> Tallene er en **deterministisk model** (`measured: false`). En levende lasttest pa mindst tre hosts er en ekstern integration, se [`live-load-test.md`](live-load-test.md).");
  lines.push("");
  lines.push("## Skaleringsfaktorer");
  lines.push("");
  lines.push(`Faktorer: ${report.scalingFactors.map((f) => `${f}x`).join(", ")}.`);
  lines.push("");
  for (const profile of report.profiles) {
    lines.push(`## ${profile.name} (\`${profile.profileId}\`)`);
    lines.push("");
    lines.push("| Faktor | Throughput/s | Fejlrate % | p95 ms | p99 ms | Køalder s | Replikeringslag ms | Pris/md | Flaskehals |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const run of profile.runs) {
      lines.push(
        `| ${run.scaleFactor}x | ${run.throughputPerSecond} | ${run.errorRatePercent} | ${run.p95Ms} | ${run.p99Ms} | ${run.queueAgeSeconds} | ${run.replicationLagMs} | ${run.price.totalMonthly} ${run.price.currency} | ${run.bottleneck ? `${run.bottleneck.id} (${run.bottleneck.utilizationPercent}%)` : "-"} |`,
      );
    }
    lines.push("");
  }
  lines.push("## N+1 efter hosttab");
  lines.push("");
  const n = report.nPlusOne;
  lines.push(`- Hosts: ${n.hostCount}, heraf ${n.downHosts} nede → ${n.remainingHosts} tilbage.`);
  lines.push(`- Baseline-throughput: ${n.baselineThroughputPerSecond}/s; efter tab: ${n.throughputAfterLossPerSecond}/s, fejlrate ${n.errorRateAfterLossPercent} %.`);
  lines.push(`- N+1 ${n.sufficient ? "er opfyldt i modellen" : "er IKKE opfyldt i modellen"}.`);
  lines.push("");
  lines.push("## Ikke-lineær skalering");
  lines.push("");
  lines.push("Tabellen nedenfor viser realiseret gennemstrømning i forhold til 1x. Et forhold under skaleringsfaktoren betyder, at en flaskehals (fx en stateful app uden multi-active-support eller en replikaramme) begrænser skalereringen.");
  lines.push("");
  lines.push("| Profil | Faktor | Realiseret forhold | Lineær? | Flaskehals |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const [profileId, info] of Object.entries(report.scalingRealized)) {
    for (const step of info.steps) {
      lines.push(`| ${profileId} | ${step.scaleFactor}x | ${step.throughputRatio} | ${step.linear ? "ja" : "nej"} | ${step.bottleneck ? `${step.bottleneck.id} (${step.bottleneck.utilizationPercent}%)` : "-"} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Render alle DKC-050-artefakter. Returnerer et Map fra repo-relativ sti til
 * enten et JSON-objekt eller en markdown-streng.
 */
export function renderCapacityPlan(plan, report) {
  const manifests = new Map();
  for (const workload of plan.workloads.filter((w) => w.kind === "stateless")) {
    manifests.set(`${CAPACITY_MANIFESTS_DIR}/autoscale-${workload.id}.json`, autoscaleManifest(workload));
  }
  manifests.set(`${CAPACITY_MANIFESTS_DIR}/tenant-quota.json`, tenantQuotaManifest(plan));
  manifests.set(`${CAPACITY_MANIFESTS_DIR}/pod-disruption-budget.json`, disruptionBudgetManifest(plan));
  manifests.set(CAPACITY_REPORT_PATH, report);
  manifests.set(CAPACITY_DOC_PATH, reportMarkdown(report));
  return manifests;
}
