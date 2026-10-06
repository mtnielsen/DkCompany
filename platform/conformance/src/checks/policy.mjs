import { existsSync } from "node:fs";
import { join } from "node:path";
import { declaredVerbs, resolveEvidencePath, readJson } from "../manifest.mjs";
import { digestOf, verifyBundleSignature } from "../../../policy/pdp/src/crypto.mjs";
import { isMutatingVerb } from "../../../runtime/src/classification.mjs";

/**
 * C-009 — Modulet skal være bundet til den centrale PDP.
 * "Modul uden PDP-kald fejler konformans": uden en policy-blok med fail-closed,
 * et gyldigt endpoint, en signeret bundle og dækning af alle muterende verber
 * kan vi ikke vide, om modulet spørger nogen. Så fejler det.
 */
export const policyBinding = {
  id: "C-009",
  title: "Modulet er bundet til central PDP (fail-closed)",
  run(ctx) {
    const policy = ctx.manifest?.policy;
    const messages = [];
    if (!policy) return { status: "fail", detail: "policy-blok mangler — modulet kan ikke bevise at det spørger PDP" };

    if (policy.failMode !== "closed") {
      messages.push(`failMode er '${policy.failMode}' — skal være 'closed'`);
    }
    if (policy.pdp?.protocol !== "http-json") {
      messages.push(`pdp.protocol er '${policy.pdp?.protocol}' — skal være 'http-json'`);
    }
    if (!/^https:\/\//.test(policy.pdp?.endpoint ?? "")) {
      messages.push("pdp.endpoint skal være HTTPS");
    }

    const gated = new Set(policy.gatedVerbs ?? []);
    // Fælles klassifikation: ethvert muterende verbum (kendt eller nyt) skal
    // være gated. Ukendte verber regnes som muterende (fail-safe).
    const declaredMutating = declaredVerbs(ctx.manifest).map((v) => v.verb).filter(isMutatingVerb);
    const missing = declaredMutating.filter((v) => !gated.has(v));
    if (missing.length) messages.push(...missing.map((v) => `gatedVerbs mangler '${v}'`));

    // Bundlen modulet pinner skal være den signerede, aktive bundle.
    const bundle = policy.bundle;
    if (bundle?.name && bundle?.version) {
      const bundleDir = join(ctx.repoRoot, "policy", "bundles", bundle.name, bundle.version);
      if (!existsSync(bundleDir)) {
        messages.push(`bundle ${bundle.name}@${bundle.version} findes ikke under /policy/bundles`);
      } else {
        const content = readJson(join(bundleDir, "bundle.json"));
        const sigPath = join(bundleDir, "bundle.sig.json");
        const trustedPath = join(ctx.repoRoot, "policy", "keys", "trusted.json");
        if (!existsSync(sigPath) || !existsSync(trustedPath)) {
          messages.push(`bundle ${bundle.name}@${bundle.version} er ikke signeret eller mangler trusted keys`);
        } else {
          const trusted = readJson(trustedPath);
          const sig = readJson(sigPath);
          const { ok, digest, errors } = verifyBundleSignature(content, sig, trusted);
          if (!ok) messages.push(`bundle-signatur ugyldig: ${errors.join("; ")}`);
          else if (digest !== bundle.sha256) {
            messages.push(`pinnet digest matcher ikke den signerede bundle (pinnet ${bundle.sha256.slice(0, 12)}…, faktisk ${digest.slice(0, 12)}…)`);
          }
        }
      }
    }

    // Beviset skal være en faktisk PDP-beslutning, ikke en påstand.
    const evidence = policy.evidence;
    if (!evidence) {
      messages.push("policy.evidence mangler — en påstand om PDP-kald er ikke bevis");
    } else if (evidence.kind === "fixture") {
      let decision;
      try {
        decision = readJson(resolveEvidencePath(ctx.moduleDir, evidence.ref));
      } catch (err) {
        messages.push(`policy.evidence: ${err.message}`);
      }
      if (decision) {
        const { ok, errors } = ctx.validate(ctx.SCHEMA_IDS.policyDecision, decision);
        if (!ok) messages.push(`policy.evidence matcher ikke policy-decision: ${(errors[0] ?? {}).message ?? ""}`);
        else if (decision.pdp?.bundleSha256 && bundle?.sha256 && decision.pdp.bundleSha256 !== bundle.sha256) {
          messages.push("policy.evidence blev truffet med en anden bundle end den pinnede");
        }
      }
    }

    if (messages.length) return { status: "fail", detail: `${messages.length} policy-brud`, messages };
    return { status: "pass", detail: `${gated.size} gatede verber · fail-closed · bundle ${bundle.name}@${bundle.version}` };
  },
};

/** C-010 — Den aktive bundle skal selv validere og være signeret. */
export const activeBundleValid = {
  id: "C-010",
  title: "Aktiv policy-bundle er skemagyldig og signeret",
  run(ctx) {
    const bundlesDir = join(ctx.repoRoot, "policy", "bundles");
    if (!existsSync(bundlesDir)) return { status: "skip", detail: "ingen /policy/bundles" };
    const policy = ctx.manifest?.policy;
    const trust = policy?.bundle ?? { name: "platform", version: "1.0.0" };
    const bundleDir = join(bundlesDir, trust.name, trust.version);
    if (!existsSync(bundleDir)) return { status: "fail", detail: `bundle-mappe mangler: ${bundleDir}` };

    const content = readJson(join(bundleDir, "bundle.json"));
    const messages = [];
    const { ok, errors } = ctx.validate(ctx.SCHEMA_IDS.policyBundle, content);
    if (!ok) messages.push(...errors.slice(0, 5).map((e) => `${(e.path || "/").trim()} ${e.message}`));
    if (content.default !== "deny") messages.push("bundle.default skal være 'deny'");

    const trustedPath = join(ctx.repoRoot, "policy", "keys", "trusted.json");
    if (!existsSync(trustedPath)) {
      messages.push("policy/keys/trusted.json mangler");
    } else {
      const { ok: sigOk, errors: sigErrors } = verifyBundleSignature(content, readJson(join(bundleDir, "bundle.sig.json")), readJson(trustedPath));
      if (!sigOk) messages.push(...sigErrors);
    }
    if (messages.length) return { status: "fail", detail: `${messages.length} bundle-problemer`, messages };
    return { status: "pass", detail: `${content.metadata.name}@${content.metadata.version} · ${content.policies.length} regler · sha256 ${digestOf(content).slice(0, 12)}…` };
  },
};
