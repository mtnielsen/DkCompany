/**
 * DKC-037 — health-/recovery-rapportering.
 *
 * Rapporten forbinder de validerede mål i en serviceklasse med faktiske målinger.
 * Den er bevidst konservativ:
 *
 *   - et mål i konfigurationen er `proposed` indtil et navngivet menneske har
 *     vedtaget det; først da er der en forpligtelse,
 *   - en `measured`-blok i konfigurationen er kun en *erklæring*; den kan ikke i
 *     sig selv certificere et serviceniveau,
 *   - `measured` i rapporten er `not-measured`/`declared-only` med mindre der
 *     findes en frisk probe inden for freshnesvinduet,
 *   - `haBadge` kræver en vedtaget forpligtelse, HA-egnethed, tre failure
 *     domains, N+1, særskilt recovery-lokation og en frisk failover-måling.
 */
import { createHash } from "node:crypto";

function digestOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ageDays(capturedAt, clock) {
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return Infinity;
  return (clock() - t) / (1000 * 60 * 60 * 24);
}

function freshProbe(probes, moduleRef, kind, { clock, freshnessDays }) {
  return (
    probes
      .filter((p) => p.moduleRef === moduleRef && p.kind === kind)
      .filter((p) => ageDays(p.capturedAt, clock) <= freshnessDays)
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] ?? null
  );
}

/**
 * @param {object} options
 * @param {Array} options.serviceClasses   `{ file, data }` eller rå serviceklasser
 * @param {Array} options.probes           `{ moduleRef, kind: "availability"|"failover"|"restore", value, capturedAt, evidenceRef }`
 * @param {Function} [options.clock]
 * @param {number} [options.freshnessDays]
 */
export function buildRecoveryReport({ serviceClasses = [], probes = [], clock = () => Date.now(), freshnessDays = 90 } = {}) {
  const entries = serviceClasses.map((sc) => {
    const data = sc.data ?? sc;
    const name = data.metadata?.name ?? data.moduleRef;
    const moduleRef = data.moduleRef;
    const committed = data.serviceCommitment?.state === "accepted";
    const haEligible = data.deploymentProfileCompatibility?.haEligible === true;
    const declared = data.serviceCommitment?.measured ?? null;
    const availabilityProbe = freshProbe(probes, moduleRef, "availability", { clock, freshnessDays });
    const failoverProbe = freshProbe(probes, moduleRef, "failover", { clock, freshnessDays });
    const restoreProbe = freshProbe(probes, moduleRef, "restore", { clock, freshnessDays });

    const measured = {
      status: availabilityProbe ? "measured" : declared ? "declared-only" : "not-measured",
      source: availabilityProbe ? "probe" : declared?.source ?? null,
      availabilityPercent: availabilityProbe?.value ?? declared?.availabilityPercent ?? null,
      capturedAt: availabilityProbe?.capturedAt ?? declared?.capturedAt ?? null,
      evidenceRef: availabilityProbe?.evidenceRef ?? declared?.evidenceRef ?? null,
      fresh: Boolean(availabilityProbe),
    };

    const gaps = [];
    if (!committed) gaps.push("målene er foreslåede og ikke vedtaget af et menneske");
    if (!availabilityProbe && declared) gaps.push("kun en erklæret måling; ingen frisk probe");
    if (!availabilityProbe && !declared) gaps.push("ingen måling af tilgængelighed");
    if (availabilityProbe && data.availability?.targetPercent != null && availabilityProbe.value < data.availability.targetPercent) {
      gaps.push(`målt tilgængelighed ${availabilityProbe.value} % er under målet ${data.availability.targetPercent} %`);
    }
    if (data.backup?.restoreTested !== true) gaps.push("gendannelse er ikke testet");
    if (haEligible && !failoverProbe) gaps.push("HA-egnet, men der findes ingen frisk failover-måling");
    if (haEligible && !committed) gaps.push("HA-badge kræver en vedtaget forpligtelse");

    const haBadge = Boolean(
      committed &&
        haEligible &&
        availabilityProbe &&
        failoverProbe &&
        availabilityProbe.value >= (data.availability?.targetPercent ?? 0) &&
        (data.deploymentProfileCompatibility?.failureDomains ?? 0) >= 3 &&
        data.deploymentProfileCompatibility?.nPlusOne === true
    );
    const productionReady = committed && data.backup?.restoreTested === true && (haBadge || data.availability?.acceptedDowntime === true);

    return {
      name,
      moduleRef,
      classFile: sc.file ?? null,
      criticality: data.criticality,
      commitment: data.serviceCommitment?.state ?? "proposed",
      acceptedBy: committed ? data.serviceCommitment?.acceptedBy?.name ?? null : null,
      networkPartition: data.failureModel?.networkPartition?.behavior ?? null,
      targets: {
        availabilityPercent: data.availability?.targetPercent ?? null,
        rpoConfirmedWritesMinutes: data.durability?.confirmedWrites?.rpoMinutes ?? null,
        rpoRegionFailureMinutes: data.durability?.regionFailure?.rpoMinutes ?? null,
        rpoCorruptionMinutes: data.durability?.corruption?.rpoMinutes ?? null,
        rtoMinutes: data.recovery?.rtoMinutes ?? null,
      },
      acceptedTargets: committed ? true : false,
      measured,
      failoverMeasured: Boolean(failoverProbe),
      restoreMeasured: Boolean(restoreProbe) || data.backup?.restoreTested === true,
      haEligible,
      haBadge,
      productionReady,
      gaps,
      digest: digestOf({ name, commitment: data.serviceCommitment?.state ?? "proposed", targets: data.availability, rpo: data.durability, rto: data.recovery?.rtoMinutes }),
    };
  });

  return {
    generatedAt: new Date(clock()).toISOString(),
    freshnessDays,
    entries,
    summary: summarize({ entries }),
  };
}

export function summarize(report) {
  const entries = report.entries ?? report;
  const by = (fn) => entries.filter(fn).length;
  return {
    total: entries.length,
    accepted: by((e) => e.commitment === "accepted"),
    proposed: by((e) => e.commitment === "proposed"),
    measured: by((e) => e.measured?.status === "measured"),
    declaredOnly: by((e) => e.measured?.status === "declared-only"),
    notMeasured: by((e) => e.measured?.status === "not-measured"),
    haBadge: by((e) => e.haBadge),
    productionReady: by((e) => e.productionReady),
    withGaps: by((e) => (e.gaps ?? []).length > 0),
  };
}

export function renderMarkdown(report) {
  const lines = [
    "# Recovery-rapport (DKC-037)",
    "",
    `Genereret: ${report.generatedAt}. Freshness: ${report.freshnessDays} dage.`,
    "",
    "> En konfigurationspost er ikke et målt serviceniveau. `declared-only` og `not-measured` er ikke PASS.",
    "",
    "| Modul | Kritikalitet | Forpligtelse | Netværkspartition | Målt | HA-badge | Produktionsklar |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const e of report.entries) {
    lines.push(`| \`${e.name}\` | ${e.criticality} | ${e.commitment} | ${e.networkPartition} | ${e.measured.status} | ${e.haBadge ? "ja" : "nej"} | ${e.productionReady ? "ja" : "nej"} |`);
  }
  lines.push("", `**Opsummering:** ${JSON.stringify(report.summary)}`, "");
  for (const e of report.entries) {
    if (!e.gaps.length) continue;
    lines.push(`## ${e.name} — udestår`, "");
    for (const g of e.gaps) lines.push(`- ${g}`);
    lines.push("");
  }
  return lines.join("\n");
}
