import { findEventExamples, readJson } from "../manifest.mjs";

/**
 * C-005 — Identitetsplanen. Intet modul har egen brugerdatabase.
 * userStore skal være 'none'; SPIFFE trust domain skal matche spiffeId.
 */
export const identityNoLocalStore = {
  id: "C-005",
  title: "Ingen lokal brugerdatabase; OIDC/SCIM/SPIFFE erklæret",
  run(ctx) {
    const id = ctx.manifest?.identity;
    const messages = [];
    if (!id) return { status: "fail", detail: "identity-blok mangler" };
    if (id.userStore !== "none") {
      messages.push(`identity.userStore = '${id.userStore}' — moduler må ikke have egen brugerdatabase`);
    }
    if (!id.oidc) messages.push("identity.oidc mangler");
    if (!id.scim) messages.push("identity.scim mangler");
    if (!id.spiffe) messages.push("identity.spiffe mangler");

    const spiffeId = id.spiffe?.spiffeId;
    const trustDomain = id.spiffe?.trustDomain;
    if (spiffeId && trustDomain) {
      const m = /^spiffe:\/\/([^/]+)/.exec(spiffeId);
      if (!m) messages.push(`spiffeId '${spiffeId}' har ugyldigt format`);
      else if (m[1] !== trustDomain) messages.push(`trustDomain '${trustDomain}' matcher ikke spiffeId '${spiffeId}'`);
    }
    if (messages.length) return { status: "fail", detail: `${messages.length} identitetsbrud`, messages };
    return { status: "pass", detail: `userStore=none · spiffe://${trustDomain}` };
  },
};

/**
 * C-006 — Telemetriplanen. OTel-signaler og obligatoriske CloudEvent-attributter.
 */
export const telemetryEnvelope = {
  id: "C-006",
  title: "OTel-signaler og obligatoriske CloudEvent-attributter",
  run(ctx) {
    const t = ctx.manifest?.telemetry;
    const messages = [];
    if (!t) return { status: "fail", detail: "telemetry-blok mangler" };
    for (const sig of ["traces", "metrics", "logs"]) {
      if (!t.otel?.signals?.includes(sig)) messages.push(`otel.signals mangler '${sig}'`);
    }
    for (const attr of ["tenantid", "traceid", "principal"]) {
      if (!t.cloudEvents?.requiredAttributes?.includes(attr)) {
        messages.push(`cloudEvents.requiredAttributes mangler '${attr}'`);
      }
    }
    if (!t.cloudEvents?.source) messages.push("cloudEvents.source mangler");
    if (!t.cloudEvents?.typePrefix) messages.push("cloudEvents.typePrefix mangler");
    if (messages.length) return { status: "fail", detail: `${messages.length} telemetribrud`, messages };
    return { status: "pass", detail: "traces/metrics/logs + tenantid/traceid/principal" };
  },
};

/**
 * C-007 — CloudEvent-eksempler skal validere mod envelopen og bære
 * tenantid/traceid/principal. Samme envelope for menneske- og agenthandling.
 */
export const cloudEventExamples = {
  id: "C-007",
  title: "CloudEvent-eksempler validerer mod envelopen",
  run(ctx) {
    const examples = findEventExamples(ctx.moduleDir);
    if (examples.length === 0) {
      return { status: "skip", detail: "ingen conformance/events/*.json at validere" };
    }
    const messages = [];
    let humans = 0;
    let agents = 0;
    for (const ex of examples) {
      let data;
      try {
        data = readJson(ex.path);
      } catch (err) {
        messages.push(`${ex.name}: ugyldig JSON (${err.message})`);
        continue;
      }
      const { ok, errors } = ctx.validate(ctx.SCHEMA_IDS.cloudEvent, data);
      if (!ok) {
        messages.push(`${ex.name}: ${errors.slice(0, 3).map((e) => `${e.path} ${e.message}`.trim()).join("; ")}`);
        continue;
      }
      if (data.principal?.kind === "human") humans += 1;
      if (data.principal?.kind === "agent") agents += 1;
    }
    if (messages.length) return { status: "fail", detail: `${messages.length}/${examples.length} events fejlede`, messages };
    return { status: "pass", detail: `${examples.length} events gyldige (${humans} human, ${agents} agent)` };
  },
};

/**
 * C-008 — Privacy-verberne. Hvis modulet erklærer personhenførbare
 * datakategorier, må subject.erase ikke være 'unsupported' uden at det
 * fremgår eksplicit. Sletteevne er det, DSAR-orkestratoren skal kunne stole på.
 */
export const privacyVerbs = {
  id: "C-008",
  title: "Privacy-verber og datakategorier hænger sammen",
  run(ctx) {
    const p = ctx.manifest?.privacy;
    const messages = [];
    if (!p) return { status: "fail", detail: "privacy-blok mangler" };
    const cats = p.dataCategories ?? [];
    const personal = cats.filter((c) => ["personal", "special-category", "pseudonymised"].includes(c));
    for (const verb of ["subject.locate", "subject.export", "subject.erase", "subject.legal_hold", "retention.policy"]) {
      if (!p[verb]) messages.push(`privacy.${verb} mangler`);
    }
    if (personal.length > 0) {
      const erase = p["subject.erase"];
      if (erase?.conformance === "full" && !p.dsarEndpoint) {
        messages.push("full subject.erase kræver privacy.dsarEndpoint");
      }
      if (erase?.conformance !== "full" && !erase?.reason) {
        messages.push(`subject.erase er '${erase?.conformance}' men uden begrundelse`);
      }
    } else if (cats.includes("none") && p["subject.erase"]?.conformance === "full") {
      // Ikke en fejl, men værd at bemærke: man kan ikke slette det man ikke har.
    }
    if (messages.length) return { status: "fail", detail: `${messages.length} privacy-brud`, messages };
    return { status: "pass", detail: `datakategorier: ${cats.join(", ") || "(ikke angivet)"}` };
  },
};
