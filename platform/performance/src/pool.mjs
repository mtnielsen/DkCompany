/**
 * DKC-050 — connection pools.
 *
 * En pool har et hårdt loft pr. replika og reserverer forbindelser til
 * administration, så tenanttrafik ikke kan sulte drift og failover. En
 * overtegnet pool afviser kontrolleret i stedet for at vente i det uendelige.
 */

export function poolBudget(pool) {
  const usable = pool.maxConnectionsPerReplica - pool.reservedAdminConnections;
  return {
    id: pool.id,
    maxConnectionsPerReplica: pool.maxConnectionsPerReplica,
    reservedAdminConnections: pool.reservedAdminConnections,
    usablePerReplica: usable,
    maxOverflow: pool.maxOverflow,
    hardLimitPerReplica: pool.maxConnectionsPerReplica + pool.maxOverflow,
    connectionTimeoutMs: pool.connectionTimeoutMs,
  };
}

/**
 * Evaluer en pool ved et antal replikaer og et tilbudt antal forbindelser.
 * Returnerer om poolen er mættet, og hvor mange forbindelser der afvises.
 */
export function poolSaturation(pool, { replicas = 1, offeredConnections = 0 } = {}) {
  const budget = poolBudget(pool);
  const totalUsable = budget.usablePerReplica * replicas;
  const totalOverflow = budget.maxOverflow * replicas;
  const accepted = Math.min(offeredConnections, totalUsable);
  const overflowUsed = Math.min(Math.max(0, offeredConnections - totalUsable), totalOverflow);
  const rejected = Math.max(0, offeredConnections - accepted - overflowUsed);
  const utilization = totalUsable > 0 ? offeredConnections / totalUsable : Infinity;
  return {
    id: pool.id,
    replicas,
    offeredConnections,
    totalUsableConnections: totalUsable,
    overflowUsed,
    acceptedConnections: accepted + overflowUsed,
    rejectedConnections: rejected,
    utilizationPercent: Number.isFinite(utilization) ? Math.round(utilization * 1000) / 10 : null,
    saturated: offeredConnections > totalUsable,
    withinHardLimit: offeredConnections <= totalUsable + totalOverflow,
    adminConnectionsReserved: budget.reservedAdminConnections * replicas,
  };
}

/** Alle pools for en plan ved en given replikatælling. */
export function poolPlanSaturation(plan, { replicas = {}, offeredConnections = {} } = {}) {
  return plan.connectionPools.map((pool) =>
    poolSaturation(pool, {
      replicas: replicas[pool.id] ?? 1,
      offeredConnections: offeredConnections[pool.id] ?? 0,
    }),
  );
}
