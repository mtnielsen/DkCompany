/**
 * 3.1 — OSCAL-evidens-emitter.
 *
 * Bygger en OSCAL 1.1 assessment-results-profil ud fra de artefakter
 * platformen allerede producerer. Modulet er rent: det læser ingen filer og
 * kalder ingen tjenester. Indsamlingen ligger i collect.mjs, så builderen kan
 * testes deterministisk med håndlavede artefakter.
 *
 * Feltnavnene følger OSCALs kebab-case. Det er med vilje: en revisor skal
 * kunne læse pakken med standardværktøjer uden en oversættelsestabel.
 */
import { createHash } from "node:crypto";

export const OSCAL_VERSION = "1.1.2";
export const ASSESSMENT_PLAN_HREF = "urn:platform:assessment-plan:governance";

const UUID_NAMESPACE = "platform.evidence.oscal";

/**
 * Deterministisk UUID i RFC 4122-format udledt af navnerum + nøgle. Samme
 * input giver samme id, så evidenspakker kan diffes mellem kørsler.
 */
export function uuidFor(key) {
  const hex = createHash("sha256").update(`${UUID_NAMESPACE}:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; // versionsnibble
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // variant
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const iso = (value, fallback) => (typeof value === "string" && value.length > 0 ? value : fallback);

/**
 * Ét conformance-tjek → ét OSCAL-finding. pass bliver 'satisfied'; alt andet
 * bliver 'not-satisfied' med den rå begrundelse. Skip må ikke pyntes til pass.
 */
export function findingFromCheck({ prefix, check, relatedObservations = [] }) {
  const satisfied = check.status === "pass";
  const finding = {
    uuid: uuidFor(`${prefix}:${check.id}`),
    title: `${check.id} ${check.title}`,
    description: check.detail || "Ingen detaljer",
    target: {
      type: "objective-id",
      "target-id": check.id,
      title: check.title,
      status: satisfied ? { state: "satisfied" } : { state: "not-satisfied" },
    },
  };
  if (!satisfied) {
    const reason = (check.messages ?? []).filter(Boolean).slice(0, 5).join("; ") || check.detail || "kravet er ikke opfyldt";
    finding.target.status.reason = reason;
  }
  if (relatedObservations.length > 0) {
    finding["related-observations"] = relatedObservations.map((uuid) => ({ "observation-uuid": uuid }));
  }
  return finding;
}

/**
 * reviewed-controls deklarerer hvilke kontroller resultatet dækker. Modulet
 * leverer sine egne controlRefs; kender vi dem ikke, siger vi include-all i
 * stedet for at lade som om vi ved det.
 */
export function reviewedControls(controlRefs) {
  if (Array.isArray(controlRefs) && controlRefs.length > 0) {
    return { "control-selections": [{ "include-controls": controlRefs.map((id) => ({ "control-id": id })) }] };
  }
  return { "control-selections": [{ "include-all": {} }] };
}

function evidenceObservation(moduleName, item, fallback) {
  return {
    uuid: uuidFor(`obs:${moduleName}:verb:${item.verb}`),
    title: `Bevis for verbet ${item.verb}`,
    description: `${item.verb} mod ${moduleName}: result=${item.data?.result ?? "ukendt"}.`,
    methods: ["TEST"],
    "relevant-evidence": [
      { href: item.ref, description: `verb-evidence (result=${item.data?.result ?? "ukendt"})` },
    ],
    collected: iso(item.data?.capturedAt, fallback),
  };
}

function decisionObservation(moduleName, decision, fallback) {
  const d = decision.data ?? {};
  const pdp = d.pdp ?? {};
  return {
    uuid: uuidFor(`obs:${moduleName}:policy-decision`),
    title: "PDP-beslutning",
    description:
      `Beslutning '${d.decision ?? "ukendt"}' fra ${pdp.name ?? "ukendt"}@${pdp.version ?? "?"} ` +
      `med bundle ${pdp.bundleName ?? "?"}@${pdp.bundleVersion ?? "?"}.`,
    methods: ["EXAMINE", "ANALYZE"],
    "relevant-evidence": [{ href: decision.ref, description: "policy-decision fixture" }],
    collected: iso(d.evaluatedAt, fallback),
  };
}

function eventObservation(moduleName, event, fallback) {
  const e = event.data ?? {};
  const principal = e.principal ?? {};
  return {
    uuid: uuidFor(`obs:${moduleName}:event:${event.ref}`),
    title: `Audit-hændelse ${e.type ?? "(ukendt type)"}`,
    description: `CloudEvent fra ${e.source ?? "ukendt"} med principal ${principal.kind ?? "?"}:${principal.id ?? "?"}.`,
    methods: ["EXAMINE"],
    "relevant-evidence": [{ href: event.ref, description: "CloudEvent (audit-log)" }],
    collected: iso(e.time, fallback),
  };
}

/** Samler observationerne for ét modul og husker deres id'er til finding-links. */
function moduleObservations(module, generatedAt) {
  const observations = [];
  const verbUuids = [];
  const eventUuids = [];
  let decisionUuid = null;

  for (const item of module.evidence ?? []) {
    const obs = evidenceObservation(module.name, item, generatedAt);
    verbUuids.push(obs.uuid);
    observations.push(obs);
  }
  if (module.decision) {
    const obs = decisionObservation(module.name, module.decision, generatedAt);
    decisionUuid = obs.uuid;
    observations.push(obs);
  }
  for (const event of module.events ?? []) {
    const obs = eventObservation(module.name, event, generatedAt);
    eventUuids.push(obs.uuid);
    observations.push(obs);
  }
  return { observations, links: { verbUuids, eventUuids, decisionUuid } };
}

function relatedObservationsFor(check, links) {
  if (check.id === "C-004") return links.verbUuids;
  if (check.id === "C-009" || check.id === "C-010") return links.decisionUuid ? [links.decisionUuid] : [];
  if (["C-006", "C-007", "C-008"].includes(check.id)) return links.eventUuids;
  return [];
}

function moduleResult(module, generatedAt) {
  const report = module.report ?? { checks: [] };
  const { observations, links } = moduleObservations(module, generatedAt);
  const findings = (report.checks ?? []).map((check) =>
    findingFromCheck({
      prefix: `finding:${module.name}`,
      check,
      relatedObservations: relatedObservationsFor(check, links),
    })
  );
  const controlRefs = module.manifest?.compliance?.controlRefs ?? [];
  return {
    uuid: uuidFor(`result:module:${module.name}`),
    title: `${module.name} konformans`,
    description: `Konformansresultater for ${module.name}@${module.version ?? "?"}.`,
    start: iso(report.startedAt, generatedAt),
    end: iso(report.finishedAt, generatedAt),
    "reviewed-controls": reviewedControls(controlRefs),
    observations,
    findings,
    remarks: `${controlRefs.length} kontrolpåstande · ${observations.length} observationer.`,
  };
}

function changeControlResult({ gitops, changelog, generatedAt }) {
  const unsigned = (changelog ?? []).filter((e) => !e.signedOff);
  const gitLogUuid = uuidFor("obs:change-control:git-log");
  const observations = [
    {
      uuid: gitLogUuid,
      title: "Git change log",
      description: `${(changelog ?? []).length} commits, ${unsigned.length} uden DCO sign-off.`,
      methods: ["EXAMINE"],
      "relevant-evidence": [
        { href: ".conformance-out/CHANGELOG.jsonl", description: "Maskinlæsbar git-historik (NIS2)" },
      ],
      collected: generatedAt,
    },
  ];
  const findings = (gitops?.checks ?? []).map((check) =>
    findingFromCheck({ prefix: "finding:change-control", check })
  );
  findings.push({
    uuid: uuidFor("finding:change-control:DCO"),
    title: "DCO sign-off på alle commits",
    description: unsigned.length === 0 ? "Alle commits er signeret" : `${unsigned.length} commits mangler sign-off`,
    target: {
      type: "objective-id",
      "target-id": "DCO",
      title: "DCO sign-off",
      status:
        unsigned.length === 0
          ? { state: "satisfied" }
          : { state: "not-satisfied", reason: `${unsigned.length} commits uden Signed-off-by` },
    },
    "related-observations": [{ "observation-uuid": gitLogUuid }],
  });
  return {
    uuid: uuidFor("result:change-control"),
    title: "GitOps og change control",
    description: "Git er den eneste ændringskanal: policy-gates, reconcile og DCO-signering.",
    start: generatedAt,
    end: generatedAt,
    "reviewed-controls": reviewedControls([]),
    observations,
    findings,
    remarks: `${findings.length} gate-resultater.`,
  };
}

export function buildAssessmentResults({ modules = [], gitops = null, changelog = [], generatedAt = new Date().toISOString() }) {
  const partyUuid = uuidFor("party:platform");
  const results = modules.map((m) => moduleResult(m, generatedAt));
  results.push(changeControlResult({ gitops, changelog, generatedAt }));

  return {
    "assessment-results": {
      uuid: uuidFor("assessment-results"),
      metadata: {
        title: "Platformens compliance-evidens",
        published: generatedAt,
        "last-modified": generatedAt,
        version: "1.0.0",
        "oscal-version": OSCAL_VERSION,
        roles: [
          { "role-id": "platform-owner", title: "Platformsejer" },
          { "role-id": "prepared-by", title: "Evidens-emitter" },
        ],
        parties: [
          {
            uuid: partyUuid,
            type: "organization",
            name: "Platformsteamet",
            "email-addresses": ["platform@example.org"],
          },
        ],
        "responsible-parties": [{ "role-id": "platform-owner", "party-uuids": [partyUuid] }],
        remarks: "Genereret maskinelt af evidence/src/cli.mjs. Prosa er ikke evidens.",
      },
      "import-ap": {
        href: ASSESSMENT_PLAN_HREF,
        remarks: "Assessment-planen er platformens kontrakt- og konformanssuite.",
      },
      results,
    },
  };
}
