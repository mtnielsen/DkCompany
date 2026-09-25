import { createServer } from "node:http";
import { createAdapterSdk } from "../../../../adapter-sdk/src/sdk.mjs";
import { AdapterError } from "../../../../adapter-sdk/src/errors.mjs";
import { createProjectService, ProjectError } from "./projects.mjs";
import { ROLES } from "./constants.mjs";

/**
 * DKC-027 — OpenProject-projektstyringsadapteren.
 *
 * Adapteren wrapper OpenProject uændret og genbruger den fælles adapter-SDK
 * (DKC-023) til auth, tenantudledning, fail-closed PDP, audit, idempotens,
 * health og versionsforhandling. Denne fil beskriver oversættelsen fra
 * platformens projekt-, opgave- og privacyoperationer til OpenProject API v3.
 *
 * Nøglepunktet er ærlighed:
 *   - projekttilgang er default-deny og kræver et dækkende medlemskab,
 *   - en projektgæst ser kun sit eget projekt,
 *   - en rettighedsændring skubber en ny søge-/AI-projektion (et forældet
 *     indeks afvises),
 *   - sletning blokeres af legal hold/retention og efterlader ikke payload i
 *     revisionssporet,
 *   - backup/restore erklæres partial/unsupported, fordi de kræver
 *     database-/volumeadgang som API'et ikke har.
 */
function actorFrom(principal, tenantId) {
  return {
    kind: principal.kind,
    id: principal.id,
    tenantId,
    role: principal.role ?? null,
    groups: principal.groups ?? [],
    disabled: principal.disabled === true,
  };
}

function emailOf(body = {}) {
  const identifiers = body.identifiers ?? body.subject?.identifiers ?? [];
  return identifiers.find((i) => i.type === "email")?.value ?? null;
}

export function createOpenProjectAdapter({
  authenticate,
  pdp,
  client,
  idempotency = null,
  upstream = null,
  serviceName = "openproject-adapter",
  version = "1.0.0",
  environment = "dev",
  profile = "production",
  source = "urn:platform:module:openproject-adapter",
  policy = {},
  onAudit = () => {},
  onEvent = () => {},
} = {}) {
  if (!client) throw new Error("kræver client");

  const projects = createProjectService({ client, policy, onAudit, onEvent });

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
        name: "openproject",
        version: "14.6.0",
        edition: "Enterprise",
        supportedRanges: ["^14.0.0"],
        supportedEditions: ["Enterprise"],
        onUnsupported: "refuse",
        ping: () => client.ping(),
      },
    onAudit,
    onEvent,
    // Læsende verber må replayes; muterende projektoperationer må ikke, så en
    // import/medlemsændring ikke gentages ved en gentaget nøgle.
    replayable: (verb) => verb.startsWith("subject.") || verb.endsWith(".read") || verb.endsWith(".list"),
  });

  function runProject(verb, req, res, fn) {
    return sdk.guard(req, res, verb, async (ctx) => {
      try {
        return await fn(ctx);
      } catch (err) {
        if (err instanceof ProjectError) throw new AdapterError(err.message, { code: err.code, status: err.status });
        throw err;
      }
    });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const method = req.method;
    const { pathname } = url;

    if (method === "GET" && pathname === "/healthz") {
      return sdk.health().then(({ code, body }) => sdk.respond(res, code, body));
    }

    // ---- Privacy-verber -------------------------------------------------
    if (method === "POST" && pathname === "/v1/privacy/locate") {
      return runProject("subject.locate", req, res, async ({ body, tenantId }) => {
        const email = emailOf(body);
        return projects.locateSubject({ subject: { id: body.subject?.id ?? null, email } });
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/export") {
      return runProject("subject.export", req, res, async ({ body, tenantId, principal }) => {
        const email = emailOf(body);
        const actor = actorFrom(principal, tenantId);
        const bundle = await projects.exportSubjectData({ actor, subject: { id: body.subject?.id ?? null, email } });
        return {
          count: bundle.memberships.length + bundle.workPackages.length,
          records: bundle.workPackages,
          memberships: bundle.memberships,
          aclPreserved: bundle.aclPreserved,
          artifactRef: `s3://evidence/dsar/openproject/${body.subject?.id ?? "subject"}.json`,
        };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/erase") {
      return runProject("subject.erase", req, res, async ({ body, tenantId, principal }) => {
        const email = emailOf(body);
        const actor = actorFrom(principal, tenantId);
        const receipt = await projects.requestDeletion({
          actor,
          subject: { id: body.subject?.id ?? null, email },
          reason: body.reason ?? "DSAR-sletning gennem privacy-verbum",
          legalHold: body.legalHold === true,
          retentionDays: body.retentionDays ?? 0,
          approvals: Array.isArray(body.approvals) ? body.approvals : [{ verdict: "approve" }],
        });
        return {
          recordsAffected: receipt.deletedMemberships + receipt.unassignedWorkPackages,
          deletedMemberships: receipt.deletedMemberships,
          unassignedWorkPackages: receipt.unassignedWorkPackages,
          partial: true,
          remainingCopies: receipt.remainingCopies,
          note: "Medlemskaber og tildelinger fjernes gennem API'et. Backups, søgeindeks og revisionsspor kræver en upstream-oprydning (DKC-021).",
        };
      });
    }

    // ---- Projekt- og opgaveverber --------------------------------------
    if (method === "POST" && pathname === "/v1/projects/list") {
      return runProject("project.list", req, res, async ({ tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.listProjects({ actor });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/read") {
      return runProject("project.read", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.readProject({ actor, projectId: body.projectId });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/work-packages") {
      return runProject("workpackage.create", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.createWorkPackage({ actor, projectId: body.projectId, input: body.workPackage ?? body });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/work-packages/update") {
      return runProject("workpackage.update", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.updateWorkPackage({ actor, projectId: body.projectId, workPackageId: body.workPackageId, patch: body.patch ?? {} });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/members") {
      return runProject("project.member.add", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.addMember({ actor, projectId: body.projectId, principal: body.principal, group: body.group, role: body.role });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/members/remove") {
      return runProject("project.member.remove", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.removeMember({ actor, projectId: body.projectId, membershipId: body.membershipId });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/guests") {
      return runProject("project.guest.invite", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.inviteGuest({ actor, projectId: body.projectId, guest: body.guest ?? {} });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/export") {
      return runProject("project.export", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.exportProjectData({ actor, projectId: body.projectId });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/import") {
      return runProject("project.import", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.importProjectBundle({ actor, bundle: body.bundle, approvals: body.approvals ?? [] });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/search-scope") {
      return runProject("project.search.scope", req, res, async ({ tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.searchProjection({ actor });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/ai-retrieval") {
      return runProject("project.ai.retrieve", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return projects.aiRetrieval({ actor, projection: body.projection, results: body.results ?? [] });
      });
    }

    if (method === "POST" && pathname === "/v1/projects/edition") {
      return runProject("project.edition.assess", req, res, async ({ body }) => projects.assessCombination(body.combination));
    }

    if (method === "POST" && pathname === "/v1/projects/features") {
      return runProject("project.features.report", req, res, async ({ body }) => projects.featureReportFor(body.combination));
    }

    if (method === "GET" && pathname === "/v1/projects/backup-declaration") {
      return sdk.respond(res, 200, projects.backupDeclaration());
    }

    return sdk.respond(res, 404, { error: "not found" });
  });

  return {
    server,
    sdk,
    projects,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

export { ROLES };
