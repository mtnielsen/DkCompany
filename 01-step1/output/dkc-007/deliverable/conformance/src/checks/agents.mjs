import { existsSync } from "node:fs";
import { join } from "node:path";
import { findAgentManifests, readJson } from "../manifest.mjs";
import { capabilityWithinOwned, isA4Violation } from "../../../runtime/src/classification.mjs";
import { validateManifest } from "../../../runtime/src/boundary.mjs";

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
      const shape = validateManifest(data);
      if (!shape.ok) {
        for (const e of shape.errors) messages.push(`${a.name}: ${e.path} ${e.message}`);
      }
      for (const cap of data.capabilities ?? []) {
        const target = cap.target ?? "";
        // Ensrettet: capability-scope skal ligge inden for de ejede komponenter.
        if (!capabilityWithinOwned(target, owned)) {
          messages.push(`${a.name}: capability-target '${target}' er uden for scope [${owned.join(", ")}]`);
        }
        // En capability til en beskyttet A4-ressource med et muterende verbum
        // kan ikke deklareres; klassifikationen er fælles med runtimen.
        if (isA4Violation(cap.verb, target)) {
          messages.push(`${a.name}: capability '${cap.verb}' mod beskyttet ressource '${target}' er A4 og kan ikke deklareres`);
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
/**
 * A-003 — Agenten skal være bundet til AI-gatewayen.
 * Uden model.gatewayRef og en aktiv route kan agenten ikke nå en model.
 */
export const agentGatewayBinding = {
  id: "A-003",
  title: "Agenten er bundet til AI-gateway (ingen direkte leverandørkald)",
  run(ctx) {
    const agents = findAgentManifests(ctx.moduleDir);
    if (agents.length === 0) return { status: "skip", detail: "modulet har ingen agents/*.json" };
    const routesPath = join(ctx.repoRoot, "gateway", "routes.json");
    const routes = existsSync(routesPath) ? readJson(routesPath).routes ?? [] : null;
    const messages = [];
    for (const a of agents) {
      let data;
      try {
        data = readJson(a.path);
      } catch {
        continue; // A-001 rapporterer parsefejlen
      }
      if (!data.model?.gatewayRef) messages.push(`${a.name}: model.gatewayRef mangler — direkte leverandørkald er forbudt`);
      if (routes) {
        const route = routes.find((r) => r.agentRef === data.metadata?.name && r.enabled !== false);
        if (!route) messages.push(`${a.name}: ingen aktiv gateway-route — agenten kan ikke nå en model`);
      }
    }
    if (messages.length) return { status: "fail", detail: `${messages.length} gateway-brud`, messages };
    return { status: "pass", detail: `${agents.length} agenter bundet til gateway` };
  },
};
