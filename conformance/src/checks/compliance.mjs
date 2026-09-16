import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../manifest.mjs";

/**
 * C-011 — Kontrolpåstande er velformede og dækker persondata.
 *
 * OSCAL-evidenspakken (3.1) kan kun sige noget meningsfuldt om de kontroller,
 * modulet faktisk påstår at opfylde. Er påstandene tomme, dubletterede eller
 * uden rolle, er evidensen intetsigende — og så skal suiten sige det, ikke
 * lade den passere. Moduler uden compliance-blok springes over.
 */
export const complianceClaims = {
  id: "C-011",
  title: "Compliance-kontrolpåstande er velformede og dækker persondata",
  run(ctx) {
    const compliance = ctx.manifest?.compliance;
    if (!compliance) return { status: "skip", detail: "modulet deklarerer ingen compliance-blok" };

    const messages = [];
    const refs = compliance.controlRefs ?? [];
    if (refs.length === 0) {
      messages.push("compliance.controlRefs er tom — OSCAL-evidens uden kontrolpåstande er intetsigende");
    }
    const seen = new Set();
    for (const ref of refs) {
      if (!/^[a-z]{2}-[0-9]+$/.test(ref)) messages.push(`controlRef '${ref}' er ikke en kontrol-id (forventet fx 'ac-2')`);
      if (seen.has(ref)) messages.push(`controlRef '${ref}' er angivet flere gange`);
      seen.add(ref);
    }
    if (!compliance.dataProcessingRole) messages.push("compliance.dataProcessingRole mangler");

    const categories = ctx.manifest?.privacy?.dataCategories ?? [];
    const personal = categories.some((c) => c === "personal" || c === "special-category");
    if (personal && !compliance.dpiaRef) {
      messages.push("modulet behandler persondata men mangler compliance.dpiaRef (GDPR art. 35)");
    }

    if (messages.length) return { status: "fail", detail: `${messages.length} compliance-problemer`, messages };
    return {
      status: "pass",
      detail: `${refs.length} kontrolpåstande · rolle '${compliance.dataProcessingRole}'${compliance.dpiaRef ? " · DPIA henvist" : ""}`,
    };
  },
};

/**
 * C-012 — Modulet må kun påstå kontroller, der findes i den regulatoriske
 * kortlægning. En controlRef uden mapping er en påstand uden modpart: vi kan
 * ikke sige, hvilket NIS2-/GDPR-/AI Act-krav den tjener. Kortlægningen er
 * kilden i compliance/control-mapping.json (3.2).
 */
export const controlMapped = {
  id: "C-012",
  title: "Modulets kontrolpåstande findes i den regulatoriske kortlægning",
  run(ctx) {
    const registryPath = join(ctx.repoRoot, "compliance", "control-mapping.json");
    if (!existsSync(registryPath)) return { status: "skip", detail: "ingen compliance/control-mapping.json" };
    const refs = ctx.manifest?.compliance?.controlRefs ?? [];
    if (refs.length === 0) return { status: "skip", detail: "modulet har ingen controlRefs" };

    let registry;
    try {
      registry = readJson(registryPath);
    } catch (err) {
      return { status: "fail", detail: `kan ikke læse kontrolkortlægningen: ${err.message}` };
    }
    const known = new Set((registry.controls ?? []).map((c) => c.id));
    const missing = refs.filter((ref) => !known.has(ref));
    if (missing.length) {
      return {
        status: "fail",
        detail: `${missing.length} ukendte kontrol-id'er`,
        messages: missing.map((ref) => `controlRef '${ref}' findes ikke i compliance/control-mapping.json`),
      };
    }
    return { status: "pass", detail: `${refs.length} kontrolpåstande kortlagt mod NIS2/GDPR/AI Act` };
  },
};
