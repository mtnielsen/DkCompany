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
