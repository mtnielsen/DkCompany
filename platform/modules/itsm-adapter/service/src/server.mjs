import { createServer } from "node:http";
import { createAdapterSdk } from "../../../../adapter-sdk/src/sdk.mjs";
import { AdapterError } from "../../../../adapter-sdk/src/errors.mjs";
import { createItsmService, ItsmError } from "./serviceregistry.mjs";

/**
 * DKC-044 — ITSM-adapteren.
 *
 * Adapteren wrapper GLPI uændret og genbruger den fælles adapter-SDK (DKC-023)
 * til auth, tenantudledning, fail-closed PDP, audit, idempotens, health og
 * versionsforhandling. Denne fil beskriver oversættelsen fra platformens
 * serviceproces til GLPI's API.
 *
 * Nøglepunktet er ærlighed og menneskeligt ejerskab:
 *   - én alarm bliver én korreleret incident med ejer og berørte tjenester,
 *   - manglende kvittering eskalerer og stopper risikofyldt handling,
 *   - et problem/en kendt fejl kræver menneskelig validering,
 *   - en kunde ser kun egne sager,
 *   - en AI kan ikke lukke en major incident, heller ikke på et grønt
 *     healthcheck.
 */
function actorFrom(principal, tenantId) {
  return {
    kind: principal.kind,
    id: principal.id,
    name: principal.name ?? principal.id,
    tenantId,
    role: principal.role ?? null,
    groups: principal.groups ?? [],
    disabled: principal.disabled === true,
  };
}

/**
 * Find de sagsrecords, et subjekt optræder i. Adapteren har ingen pålidelig
 * subjektnøgle ud over de referencer GLPI-ticket'en bærer, så matchningen er
 * bevidst konservativ: et identifierende felt skal optræde i recorden.
 */
function recordsForSubject(records, identifiers = []) {
  const values = identifiers.map((i) => i?.value).filter(Boolean);
  if (values.length === 0) return [];
  return records.filter((record) => {
    const hay = JSON.stringify({ owner: record.owner, requester: record.requester });
    return values.some((v) => hay.includes(v));
  });
}

export function createItsmAdapter({
  authenticate,
  pdp,
  client,
  catalog,
  rotations,
  idempotency = null,
  upstream = null,
  serviceName = "itsm-adapter",
  version = "1.0.0",
  environment = "dev",
  profile = "production",
  source = "urn:platform:module:itsm-adapter",
  policy = {},
  onAudit = () => {},
  onEvent = () => {},
} = {}) {
  if (!client) throw new Error("kræver client");
  if (!catalog) throw new Error("kræver catalog");

  const itsm = createItsmService({ client, catalog, rotations, policy, onAudit });

  const sdk = createAdapterSdk({
    serviceName,
    version,
    environment,
    profile,
    source,
    authenticate,
    pdp,
    idempotency,
    upstream:
      upstream ?? {
        name: "glpi",
        version: "10.0.16",
        edition: "Network",
        supportedRanges: ["^10.0.0"],
        supportedEditions: ["Network", "Community"],
        onUnsupported: "refuse",
        ping: () => client.ping(),
      },
    onAudit,
    onEvent,
    // Læsende verber må replayes; muterende serviceproces-handlinger må ikke.
    replayable: (verb) => verb.endsWith(".read") || verb.endsWith(".list") || verb.startsWith("subject.") || verb === "itsm.process.validate",
  });

  function runItsm(verb, req, res, fn) {
    return sdk.guard(req, res, verb, async (ctx) => {
      try {
        return await fn(ctx);
      } catch (err) {
        if (err instanceof ItsmError) throw new AdapterError(err.message, { code: err.code, status: err.status });
        throw err;
      }
    });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const { method, pathname } = { method: req.method, pathname: url.pathname };

    if (method === "GET" && pathname === "/healthz") {
      return sdk.health().then(({ code, body }) => sdk.respond(res, code, body));
    }

    // ---- Alarmer og incidents ------------------------------------------
    if (method === "POST" && pathname === "/v1/itsm/alarms") {
      return runItsm("itsm.alarm.ingest", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        const result = await itsm.ingestAlarm({ actor, alert: body.alert ?? body, serviceId: body.serviceId ?? body.alert?.serviceId, tenantId });
        return { incidentId: result.incident.id, correlated: result.correlated, created: result.created, owner: result.incident.owner, affectedServices: result.incident.affectedServices, severity: result.incident.severity };
      });
    }

    if (method === "POST" && pathname === "/v1/itsm/incidents/acknowledge") {
      return runItsm("itsm.incident.acknowledge", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return itsm.acknowledgeIncident({ actor, incidentId: body.incidentId, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/itsm/incidents/escalate") {
      return runItsm("itsm.incident.escalate", req, res, async ({ body, tenantId }) => itsm.escalateIncident({ incidentId: body.incidentId, tenantId }));
    }

    if (method === "POST" && pathname === "/v1/itsm/incidents/close") {
      return runItsm("itsm.incident.close", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return itsm.closeIncident({ actor, incidentId: body.incidentId, tenantId, healthcheck: body.healthcheck ?? null, approvals: body.approvals ?? [] });
      });
    }

    // ---- Requests, problemer og changes --------------------------------
    if (method === "POST" && pathname === "/v1/itsm/requests") {
      return runItsm("itsm.request.create", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return itsm.createRequest({ actor, request: body.request ?? body, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/itsm/problems") {
      return runItsm("itsm.problem.create", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return itsm.createProblem({ actor, proposal: body.proposal ?? body, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/itsm/changes") {
      return runItsm("itsm.change.create", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return itsm.createChange({ actor, change: body.change ?? body, tenantId, approvals: body.approvals ?? [] });
      });
    }

    // ---- Kundevisning og procesvalidering ------------------------------
    if (method === "POST" && pathname === "/v1/itsm/cases") {
      return runItsm("itsm.case.list", req, res, async ({ tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return { cases: await itsm.listCustomerCases({ actor, tenantId }) };
      });
    }

    if (method === "POST" && pathname === "/v1/itsm/processes/validate") {
      return runItsm("itsm.process.validate", req, res, async ({ body }) => {
        const { serviceProcessProblems } = await import("./serviceregistry.mjs");
        const problems = serviceProcessProblems({ process: body.process, agents: body.agents ?? [] });
        return { ok: problems.length === 0, problems };
      });
    }

    if (method === "POST" && pathname === "/v1/itsm/editions/assess") {
      return runItsm("itsm.edition.assess", req, res, async ({ body }) => itsm.assess(body.combination));
    }

    if (method === "GET" && pathname === "/v1/itsm/backup-declaration") {
      return sdk.respond(res, 200, {
        backup: { conformance: "partial", reason: "GLPI kan tage database- og filbackup, men adapteren kan ikke garantere et konsistent snapshot af alle plugins gennem API'et." },
        restore: { conformance: "unsupported", reason: "Gendannelse sker på database-/filniveau og kan ikke udføres gennem GLPI's API." },
        verifyRestore: { conformance: "unsupported", reason: "Verifikation af en gendannelse kræver adgang til backup- og databaselaget." },
      });
    }

    // ---- Privacy-verber (ærligt partial/unsupported) -------------------
    if (method === "POST" && pathname === "/v1/privacy/locate") {
      return runItsm("subject.locate", req, res, async ({ body, tenantId }) => {
        const records = (await client.listRecords({ tenantId })) ?? [];
        const matches = recordsForSubject(records, body.identifiers ?? []);
        return {
          count: matches.length,
          matches: matches.map((r) => ({ id: r.id, recordKind: r.recordKind, serviceId: r.serviceId, state: r.state })),
          partial: true,
          note: "Matchningen hviler på de subjektreferencer GLPI-ticket'en bærer; en e-mail er ikke en verificeret subjektnøgle.",
        };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/export") {
      return runItsm("subject.export", req, res, async ({ body, tenantId }) => {
        const records = (await client.listRecords({ tenantId })) ?? [];
        const matches = recordsForSubject(records, body.identifiers ?? []);
        return {
          count: matches.length,
          records: matches.map((r) => ({ id: r.id, recordKind: r.recordKind, title: r.title, state: r.state, serviceId: r.serviceId, owner: r.owner, requester: r.requester })),
          partial: true,
          note: "Eksporten dækker sagsfelterne; audit- og backupkopier følger platformens DSAR-proces (DKC-020).",
        };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/erase") {
      return runItsm("subject.erase", req, res, async ({ tenantId }) => {
        const records = (await client.listRecords({ tenantId })) ?? [];
        return {
          recordsAffected: 0,
          partial: true,
          remainingCopies: [
            { location: "glpi-database", reason: "Sletning af sagsrecords kræver en godkendt GLPI-sletteproces" },
            { location: "audit", reason: "Revisionssporet bevares jf. DKC-021" },
            { location: "backup", reason: "Backups er adskilt og slettes efter retention" },
          ],
          note: "Adapteren sletter ikke sager uden en godkendt sletteproces; verbet er partial og rapporterer de kopier den ikke kan fjerne (DKC-021).",
        };
      });
    }

    return sdk.respond(res, 404, { error: "not found" });
  });

  return {
    server,
    sdk,
    itsm,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
