import { findAgentManifests, readJson } from "../manifest.mjs";

/**
 * A-001 — Agent-manifester i modulet skal validere mod agent-kontrakten.
 */
export const agentManifestValid = {
  id: "A-001",
  title: "Agent-manifester validerer mod agent-manifest.schema.json",
  run(ctx) {
    const agents = findAgentManifests(ctx.moduleDir);
    if (agents.length === 0) return { status: "skip", detail: "modulet har ingen agents/*.json" };
    const messages = [];
    for (const a of agents) {
      let data;
      try {
        data = readJson(a.path);
      } catch (err) {
        messages.push(`${a.name}: ugyldig JSON (${err.message})`);
        continue;
      }
      const { ok, errors } = ctx.validate(ctx.SCHEMA_IDS.agentManifest, data);
      if (!ok) messages.push(`${a.name}: ${errors.slice(0, 3).map((e) => `${e.path} ${e.message}`.trim()).join("; ")}`);
    }
    if (messages.length) return { status: "fail", detail: `${messages.length}/${agents.length} agenter fejlede`, messages };
    return { status: "pass", detail: `${agents.length} agent-manifester gyldige` };
  },
};

/**
 * A-002 — Agentens scope og ansvar. Capabilities skal pege inden for
 * scope.ownedComponents, og der skal være et navngivet menneske.
 */
export const agentScope = {
  id: "A-002",
  title: "Agent-capabilities ligger inden for scope; navngivet ansvarlig",
  run(ctx) {
    const agents = findAgentManifests(ctx.moduleDir);
    if (agents.length === 0) return { status: "skip", detail: "modulet har ingen agents/*.json" };
    const messages = [];
    for (const a of agents) {
      let data;
      try {
        data = readJson(a.path);
      } catch {
        continue; // A-001 rapporterer parsefejlen
      }
      const owned = data.scope?.ownedComponents ?? [];
      for (const cap of data.capabilities ?? []) {
        const target = cap.target ?? "";
        if (!owned.some((c) => matchesScope(target, c))) {
          messages.push(`${a.name}: target '${target}' er uden for scope [${owned.join(", ")}]`);
        }
      }
      if (!data.metadata?.accountableHuman?.subject) {
        messages.push(`${a.name}: mangler accountableHuman.subject`);
      }
      if ((data.capabilities ?? []).some((c) => c.autonomyClass === "A4")) {
        messages.push(`${a.name}: A4 kan ikke deklareres`);
      }
    }
    if (messages.length) return { status: "fail", detail: `${messages.length} scope-brud`, messages };
    return { status: "pass", detail: `${agents.length} agenter inden for scope` };
  },
};

/** Simpel scope-matchning: eksakt, præfiks eller '*'/'?'-glob. */
function matchesScope(target, component) {
  if (target === component) return true;
  if (!target.includes("*") && !target.includes("?")) {
    return target.startsWith(component + "/") || component.startsWith(target + "/");
  }
  const re = new RegExp("^" + target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return re.test(component) || component.startsWith(target.replace(/\*+$/, ""));
}
