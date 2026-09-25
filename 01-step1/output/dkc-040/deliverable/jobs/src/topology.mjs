/**
 * DKC-040 — semantik for beskedtopologien.
 *
 * Skemaet håndhæver formen; denne modul håndhæver beslutningerne:
 *
 *   - brokeren skal være holdbar med publisher confirms, consumer-acks og et
 *     quorum på mindst tre replikaer i tre fejldomæner; usikre writes ved
 *     quorumtab afvises,
 *   - outboxen skal være transaktionel sammen med mindst én domænetabel og
 *     bekræfte via broker-ack (ingen tavs fire-and-forget),
 *   - inboxen skal dedupliere pr. tenant/begivenhed og håndhæve logisk
 *     rækkefølge pr. ressource med `defer` ved huller og `skip` ved forsinkede
 *     begivenheder,
 *   - singletonjobs skal have et monotont fencing-token,
 *   - backpressure og poison-isolation skal være synlige og tenantafgrænsede,
 *   - leveringsgarantien må ikke påstå exactly-once.
 *
 * Validatoren erstatter ikke en rigtig broker; den efterprøver kontrakten.
 */
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

function err(path, message) {
  return { path, message };
}

function quorumFor(memberCount) {
  return Math.floor(memberCount / 2) + 1;
}

export function messagingTopologyProblems(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object") return [err("/", "beskedtopologien er ikke et objekt")];
  if (!isNamedHuman(plan.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "topologien skal have et navngivet menneske som ejer"));
  }
  if (plan.deliveryGuarantee !== "at-least-once") {
    problems.push(err("/deliveryGuarantee", "leveringsgarantien skal være 'at-least-once' — exactly-once påstås ikke"));
  }

  // --- Broker ---------------------------------------------------------------
  const broker = plan.broker ?? {};
  if (!(broker.technology ?? "").trim()) problems.push(err("/broker/technology", "brokeren skal navngives"));
  if (broker.durable !== true) problems.push(err("/broker/durable", "brokeren skal være holdbar"));
  if (broker.publisherConfirms !== true) problems.push(err("/broker/publisherConfirms", "publisher confirms er obligatorisk"));
  if (broker.consumerAcks !== true) problems.push(err("/broker/consumerAcks", "consumer acknowledgements er obligatoriske"));
  const replicas = broker.replicas ?? 0;
  if (replicas < 3) problems.push(err("/broker/replicas", "brokeren skal have mindst tre replikaer"));
  if ((broker.failureDomains ?? 0) < 3) problems.push(err("/broker/failureDomains", "brokeren skal fordeles på mindst tre fejldomæner"));
  if (!Number.isInteger(broker.quorum) || broker.quorum < quorumFor(replicas) || broker.quorum > replicas) {
    problems.push(err("/broker/quorum", `quorum (${broker.quorum}) skal være mindst ${quorumFor(replicas)} og højst ${replicas}`));
  }
  if (broker.unsafeWritesOnQuorumLoss !== false) {
    problems.push(err("/broker/unsafeWritesOnQuorumLoss", "usikre writes ved quorumtab må ikke være tilladt"));
  }
  if (!(broker.tenantIsolation ?? "").trim()) {
    problems.push(err("/broker/tenantIsolation", "brokeren skal erklære tenantadskillelse"));
  }
  const retention = broker.retention ?? {};
  if (!(retention.maxAgeHours > 0)) problems.push(err("/broker/retention/maxAgeHours", "retention skal have en positiv aldersgrænse"));
  if (!(retention.maxBytes > 0)) problems.push(err("/broker/retention/maxBytes", "retention skal have en positiv størrelsesgrænse"));

  // --- Outbox ---------------------------------------------------------------
  const outbox = plan.outbox ?? {};
  if (!Array.isArray(outbox.transactionalWith) || outbox.transactionalWith.length === 0) {
    problems.push(err("/outbox/transactionalWith", "outboxen skal skrives transaktionelt med mindst én domænetabel"));
  }
  if (outbox.confirmMode !== "broker-ack") {
    problems.push(err("/outbox/confirmMode", "udgivelse skal bekræftes af brokeren ('broker-ack'), ikke fire-and-forget"));
  }
  if (!Number.isInteger(outbox.maxAttempts) || outbox.maxAttempts < 1 || outbox.maxAttempts > 50) {
    problems.push(err("/outbox/maxAttempts", "outboxens forsøgsgrænse skal være mellem 1 og 50"));
  }
  if (!(outbox.baseDelayMs > 0) || !(outbox.maxDelayMs >= outbox.baseDelayMs)) {
    problems.push(err("/outbox/maxDelayMs", "backoff skal være positiv og maxDelayMs ≥ baseDelayMs"));
  }
  if (!(outbox.batchSize > 0)) problems.push(err("/outbox/batchSize", "batch-størrelsen skal være positiv"));
  if (!(outbox.leaseMs > 0)) problems.push(err("/outbox/leaseMs", "outbox-leasen skal være positiv"));

  // --- Inbox og rækkefølge --------------------------------------------------
  const inbox = plan.inbox ?? {};
  if (inbox.dedup !== "unique-tenant-event") {
    problems.push(err("/inbox/dedup", "inboxen skal dedupliere på (tenant, begivenhed)"));
  }
  if (inbox.ordering !== "per-resource") problems.push(err("/inbox/ordering", "logisk rækkefølge skal være pr. ressource"));
  if (inbox.gapPolicy !== "defer") problems.push(err("/inbox/gapPolicy", "et hul i versionsrækken skal udsætte behandlingen, ikke springe den over"));
  if (inbox.stalePolicy !== "skip") problems.push(err("/inbox/stalePolicy", "en forsinket begivenhed skal afvises"));
  if (!(inbox.maxAttempts >= 1)) problems.push(err("/inbox/maxAttempts", "inboxens forsøgsgrænse skal være mindst 1"));

  const ordering = plan.ordering ?? {};
  if (ordering.mode !== "per-resource") problems.push(err("/ordering/mode", "rækkefølgemodus skal være pr. ressource"));
  if (!Array.isArray(ordering.resourceTypes) || ordering.resourceTypes.length === 0) {
    problems.push(err("/ordering/resourceTypes", "mindst én ressource-type skal være ordensstyret"));
  }

  // --- Singletonjobs --------------------------------------------------------
  const singletons = plan.singletons ?? [];
  if (singletons.length === 0) problems.push(err("/singletons", "mindst ét singletonjob skal være erklæret"));
  const seen = new Set();
  for (const [i, entry] of singletons.entries()) {
    const at = `/singletons/${i}`;
    if (!(entry.name ?? "").trim()) problems.push(err(`${at}/name`, "singletonjobbet mangler et navn"));
    if (seen.has(entry.name)) problems.push(err(`${at}/name`, `singletonjobbet '${entry.name}' er erklæret flere gange`));
    seen.add(entry.name);
    if (entry.fencing !== "monotonic-token") problems.push(err(`${at}/fencing`, "singletonjobbet skal bruge et monotont fencing-token"));
    if (!(entry.leaseMs > 0)) problems.push(err(`${at}/leaseMs`, "singletonjobbet skal have en positiv lease"));
  }

  // --- Backpressure og poison ----------------------------------------------
  const bp = plan.backpressure ?? {};
  if (!(bp.maxBacklog > 0)) problems.push(err("/backpressure/maxBacklog", "backpressure skal have en positiv backlog-grænse"));
  if (!(bp.maxOldestAgeSeconds > 0)) problems.push(err("/backpressure/maxOldestAgeSeconds", "backpressure skal have en positiv aldersgrænse"));
  if (bp.strategy !== "pause-publishers") problems.push(err("/backpressure/strategy", "backpressure skal pause udgivere"));
  if (bp.visible !== true) problems.push(err("/backpressure/visible", "køtilstanden skal være synlig"));

  const poison = plan.poison ?? {};
  if (poison.isolation !== "per-tenant") problems.push(err("/poison/isolation", "poison-beskeder skal isoleres pr. tenant"));
  if (poison.quarantine !== true) problems.push(err("/poison/quarantine", "poison-beskeder skal sættes i karantæne"));
  if (!(poison.maxAttempts >= 1)) problems.push(err("/poison/maxAttempts", "poison-grænsen skal være mindst 1"));

  // --- Tenantadskillelse ----------------------------------------------------
  const ti = plan.tenantIsolation ?? {};
  if (ti.eventIdBoundToTenant !== true) problems.push(err("/tenantIsolation/eventIdBoundToTenant", "event-ID'er skal være bundet til tenanten"));
  if (ti.crossTenantConsume !== false) problems.push(err("/tenantIsolation/crossTenantConsume", "krydskunde-forbrug må ikke være tilladt"));
  if (ti.streamPerTenant !== true) problems.push(err("/tenantIsolation/streamPerTenant", "hver tenant skal have sin egen strøm"));

  return problems;
}
