/**
 * DKC-049 — rekonstruktion af et tværserverforløb.
 *
 * Rekonstruktionen læser de poster der bærer samme correlation/execution og
 * samler forløbet uden at stole på nogen agents egen forklaring. Den:
 *
 *   - adskiller sensorobservationer, modeludsagn og verificerede resultater,
 *   - binder hver muterende modelhandling til en menneskelig godkendelse med
 *     matchende digest,
 *   - kræver at hvert verificeret resultat peger på et kendt artefakt, og at
 *     hver muterende handling har et verificeret outcome,
 *   - rapporterer huller (manglende kvittering, manglende godkendelse,
 *     ikke-monotone sekvenser) frem for at påstå et komplet forløb.
 */
import { approvalDigestOf } from "./record.mjs";

export function reconstructFlow(records, { correlationId, executionId = null, requireServers = 1 } = {}) {
  const filtered = (records ?? [])
    .filter((r) => r.correlation?.correlationId === correlationId && (executionId === null || r.correlation.executionId === executionId))
    .sort((a, b) => (a.ledger?.seq ?? 0) - (b.ledger?.seq ?? 0));

  const servers = [...new Set(filtered.map((r) => r.scope?.service).filter(Boolean))].sort();
  const sensors = filtered.filter((r) => r.provenance === "sensor" || r.provenance === "system");
  const models = filtered.filter((r) => r.provenance === "model");
  const verified = filtered.filter((r) => r.provenance === "verified");
  const humans = filtered.filter((r) => r.provenance === "human");
  const gaps = [];

  if (servers.length < requireServers) gaps.push({ type: "missing-servers", detail: `forløbet spænder over ${servers.length} servere, kræver ${requireServers}` });

  // Godkendelsesbinding: en muterende modelhandling kræver en menneskelig godkendelse med matchende digest.
  const approvals = new Map();
  for (const human of humans) approvals.set(approvalDigestOf(human), human);
  for (const model of models) {
    if (model.action?.mutating !== true) continue;
    if (!model.receipt) gaps.push({ type: "missing-receipt", id: model.id });
    if (!model.action.approvalDigest) {
      gaps.push({ type: "missing-approval", id: model.id });
    } else if (!approvals.has(model.action.approvalDigest)) {
      gaps.push({ type: "unmatched-approval", id: model.id, digest: model.action.approvalDigest });
    }
  }

  // Artefaktbinding: verificerede resultater skal pege på et kendt artefakt.
  const modelDigests = new Set(models.map((m) => m.model?.responseDigest).filter(Boolean));
  const sensorDigests = new Set(sensors.map((s) => s.observation?.value?.digest).filter(Boolean));
  const artifacts = {};
  for (const record of verified) {
    const artifactDigest = record.verification?.artifactDigest;
    const matched = modelDigests.has(artifactDigest) || sensorDigests.has(artifactDigest);
    artifacts[artifactDigest] = { result: record.verification?.result ?? null, matched };
    if (!matched) gaps.push({ type: "unmatched-artifact", id: record.id, digest: artifactDigest });
  }

  // Hver muterende handling skal have et verificeret, bestået outcome.
  for (const model of models) {
    if (model.action?.mutating !== true) continue;
    const target = model.action?.tool?.target;
    const related = verified.filter((v) => v.correlation?.parentId === model.id || (target && v.scope?.resource === target));
    if (!related.some((v) => v.verification?.result === "pass")) gaps.push({ type: "missing-verification", id: model.id });
  }

  // Monotone sekvenser.
  let previous = null;
  for (const record of filtered) {
    const seq = record.ledger?.seq;
    if (!Number.isInteger(seq)) continue;
    if (previous !== null && seq <= previous) gaps.push({ type: "non-monotonic-sequence", at: seq });
    previous = seq;
  }

  return {
    correlationId,
    executionId,
    servers,
    counts: { total: filtered.length, sensors: sensors.length, models: models.length, verified: verified.length, humans: humans.length },
    timeline: filtered.map((r) => ({ id: r.id, seq: r.ledger?.seq ?? null, service: r.scope?.service, provenance: r.provenance, occurredAt: r.occurredAt })),
    artifacts,
    approvals: humans.map((h) => ({ subject: h.human?.subject ?? null, role: h.human?.role ?? null, decision: h.human?.decision ?? null, digest: approvalDigestOf(h) })),
    gaps,
    complete: gaps.length === 0,
  };
}
