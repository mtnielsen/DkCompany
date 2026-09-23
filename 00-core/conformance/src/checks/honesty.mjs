import { existsSync, statSync } from "node:fs";
import { declaredVerbs, resolveEvidencePath, readJson } from "../manifest.mjs";

const PLACEHOLDER = /^(n\/?a|todo|tbd|unknown|ved ikke|\.+|-+)$/i;

/**
 * C-003 — Conformance-niveauet skal være ærligt.
 * partial/unsupported kræver en meningsfuld begrundelse. full må ikke
 * understøttes af et 'declared'-bevis (som blot er en påstand).
 */
export const verbHonesty = {
  id: "C-003",
  title: "Conformance-niveauer er ærlige (reason på partial/unsupported)",
  run(ctx) {
    const messages = [];
    const declared = declaredVerbs(ctx.manifest);
    let partial = 0;
    let full = 0;
    for (const { verb, block } of declared) {
      if (block.conformance === "full") {
        full += 1;
        if (block.evidence?.kind === "declared") {
          messages.push(`${verb}: full understøttes kun af 'declared' — kræver fixture/probe`);
        }
      } else {
        partial += 1;
        const reason = (block.reason ?? "").trim();
        if (reason.length < 20) {
          messages.push(`${verb}: begrundelse er for kort (${reason.length} tegn)`);
        } else if (PLACEHOLDER.test(reason)) {
          messages.push(`${verb}: begrundelse er en placeholder ('${reason}')`);
        }
      }
    }
    if (messages.length) return { status: "fail", detail: `${messages.length} uhæderlige deklarationer`, messages };
    return { status: "pass", detail: `${full} full, ${partial} partial/unsupported — alle begrundede` };
  },
};

/**
 * C-004 — Beviset skal kunne findes.
 * For hvert verbum med 'full' conformance skal fixture-filen eksistere og
 * selv validere mod verb-evidence.schema.json. Probes tjekkes kun online.
 */
export const evidenceResolvable = {
  id: "C-004",
  title: "Bevisfiler for full-verber findes og validerer",
  run(ctx) {
    const messages = [];
    let checked = 0;
    let skipped = 0;
    for (const { verb, block } of declaredVerbs(ctx.manifest)) {
      if (block.conformance !== "full") continue;
      const evidence = block.evidence;
      if (!evidence) {
        messages.push(`${verb}: full uden evidence`);
        continue;
      }
      if (evidence.kind === "probe") {
        if (ctx.offline) {
          skipped += 1;
          continue;
        }
        // Online probe udføres af live-probe-checken; her markerer vi kun.
        skipped += 1;
        continue;
      }
      if (evidence.kind !== "fixture") {
        messages.push(`${verb}: ukendt evidence.kind '${evidence.kind}'`);
        continue;
      }
      let path;
      try {
        path = resolveEvidencePath(ctx.moduleDir, evidence.ref);
      } catch (err) {
        messages.push(`${verb}: ${err.message}`);
        continue;
      }
      if (!existsSync(path) || !statSync(path).isFile()) {
        messages.push(`${verb}: fixture '${evidence.ref}' findes ikke`);
        continue;
      }
      let data;
      try {
        data = readJson(path);
      } catch (err) {
        messages.push(`${verb}: fixture '${evidence.ref}' er ikke gyldig JSON (${err.message})`);
        continue;
      }
      const { ok, errors } = ctx.validate(ctx.SCHEMA_IDS.verbEvidence, data);
      if (!ok) {
        messages.push(`${verb}: fixture '${evidence.ref}' matcher ikke verb-evidence: ${errors[0]?.message ?? ""}`);
        continue;
      }
      if (data.verb !== verb) {
        messages.push(`${verb}: fixture rapporterer verb '${data.verb}'`);
        continue;
      }
      checked += 1;
    }
    if (messages.length) return { status: "fail", detail: `${messages.length} bevisproblemer`, messages };
    const detail = `${checked} fixtures verificeret${skipped ? `, ${skipped} probe/offline sprunget over` : ""}`;
    return { status: "pass", detail };
  },
};
