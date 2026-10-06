/**
 * DKC-050 — autoskalering.
 *
 * Stateless tjenester og køworkers skalerer efter en politik inden for en fast
 * ramme. Stateful workloads autoskalerer aldrig: de kræver en signeret runbook
 * og et menneske. Politikken respekterer cooldowns, så en kort spids ikke
 * udløser skalen-op/ned-svingninger.
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Ønsket replikatælling for én stateless workload.
 * `mode` bestemmer signalet: CPU-utilisering eller kødybde.
 */
export function desiredReplicas(workload, { mode, demandPerSecond = 0, queueDepth = 0, currentReplicas = null, elapsedSeconds = null, lastScaleAtSeconds = null } = {}) {
  const min = workload.replicas.min;
  const max = workload.replicas.max;
  const policy = workload.autoscale;
  let target;

  if (mode === "cpu" || policy?.mode === "cpu") {
    const perReplica = Object.values(workload.capacityPerReplica)[0] || 1;
    const targetUtil = (policy.targetUtilizationPercent ?? 70) / 100;
    target = Math.ceil(demandPerSecond / Math.max(perReplica * targetUtil, 1e-9));
  } else {
    target = Math.ceil(queueDepth / Math.max(policy.targetQueueDepth ?? 1, 1));
  }

  const bounded = clamp(target, min, max);
  const from = currentReplicas ?? min;
  const direction = bounded > from ? "up" : bounded < from ? "down" : "none";
  const cooldown = direction === "up" ? policy.scaleUpCooldownSeconds : policy.scaleDownCooldownSeconds;

  if (currentReplicas !== null && elapsedSeconds !== null && lastScaleAtSeconds !== null && direction !== "none") {
    if (elapsedSeconds - lastScaleAtSeconds < cooldown) {
      return { desired: currentReplicas, target: bounded, direction: "held-by-cooldown", cooldownSeconds: cooldown, capped: bounded === max || bounded === min };
    }
  }
  return { desired: bounded, target: bounded, direction, cooldownSeconds: cooldown, capped: bounded === max || bounded === min };
}

/**
 * Beslut skaleringen for alle workloads. Stateful workloads returneres som
 * `requiresRunbook` og ændres ikke.
 */
export function planAutoscale(plan, { profile, currentReplicas = {}, elapsedSeconds = null, lastScaleAtSeconds = {}, clusterQueueDepth = 0 } = {}) {
  return plan.workloads.map((workload) => {
    if (workload.kind === "stateful") {
      return {
        id: workload.id,
        autoScale: false,
        requiresRunbook: true,
        runbookRef: workload.statefulScaling.runbookRef,
        replicas: workload.replicas.min,
        reason: "stateful-scaling-requires-runbook",
      };
    }
    const perReplica = Object.values(workload.capacityPerReplica)[0] || 1;
    const demandPerSecond = workload.id === "queue-worker" ? profile.jobsPerSecond : workload.id === "ai-gateway" ? profile.aiCallsPerDay / 86400 : profile.requestsPerSecond;
    const decision = desiredReplicas(workload, {
      mode: workload.autoscale.mode,
      demandPerSecond,
      queueDepth: workload.autoscale.mode === "queue-depth" ? clusterQueueDepth : 0,
      currentReplicas: currentReplicas[workload.id] ?? null,
      elapsedSeconds,
      lastScaleAtSeconds: lastScaleAtSeconds[workload.id] ?? null,
    });
    return {
      id: workload.id,
      autoScale: true,
      requiresRunbook: false,
      mode: workload.autoscale.mode,
      demandPerSecond: Math.round(demandPerSecond * 1000) / 1000,
      capacityPerReplica: perReplica,
      replicas: decision.desired,
      target: decision.target,
      direction: decision.direction,
      cooldownSeconds: decision.cooldownSeconds,
      capped: decision.capped,
      reason: "autoscale",
    };
  });
}
