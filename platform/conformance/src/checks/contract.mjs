import { VERB_GROUPS } from "../manifest.mjs";

/**
 * C-001 — Manifestet skal validere mod module-manifest.schema.json.
 * Dette er selve indgangen til konformans: et ugyldigt manifest er ikke et
 * spørgsmål om fortolkning, det er en hård fejl.
 */
export const schemaValid = {
  id: "C-001",
  title: "module-manifest.json validerer mod kontrakten",
  run(ctx) {
    const { ok, errors } = ctx.validate(ctx.SCHEMA_IDS.moduleManifest, ctx.manifest);
    if (ok) return { status: "pass", detail: "Manifest matcher module-manifest.schema.json" };
    return {
      status: "fail",
      detail: `${errors.length} skemafejl`,
      messages: errors.slice(0, 20).map((e) => `${e.path} ${e.message}`.trim()),
    };
  },
};

/**
 * C-002 — Alle verber i ops- og privacy-kontrakten skal være deklareret.
 * Manglende deklaration er en fejl, ikke en hemmelighed: ellers kan
 * orkestratoren ikke se forskel på "kan ikke" og "glemte at nævne".
 */
export const verbsDeclared = {
  id: "C-002",
  title: "Alle ops- og privacy-verber er deklareret",
  run(ctx) {
    const missing = [];
    for (const verb of VERB_GROUPS.ops) {
      if (!ctx.manifest?.verbs?.[verb]) missing.push(`verbs.${verb}`);
    }
    for (const verb of VERB_GROUPS.privacy) {
      if (!ctx.manifest?.privacy?.[verb]) missing.push(`privacy.${verb}`);
    }
    if (missing.length === 0) {
      return { status: "pass", detail: `${VERB_GROUPS.ops.length + VERB_GROUPS.privacy.length} verber deklareret` };
    }
    return { status: "fail", detail: `${missing.length} manglende verber`, messages: missing };
  },
};
