import { createServer } from "node:http";
import { createAdapterSdk } from "../../../../adapter-sdk/src/sdk.mjs";
import { AdapterError } from "../../../../adapter-sdk/src/errors.mjs";
import { createWorkspaceService, WorkspaceError } from "./workspace.mjs";
import { SHARE_TYPES } from "./constants.mjs";

/**
 * DKC-026 — Nextcloud-arbejdspladsadapteren.
 *
 * Adapteren wrapper Nextcloud uændret og genbruger den fælles adapter-SDK
 * (DKC-023) til auth, tenantudledning, fail-closed PDP, audit, idempotens,
 * health og versionsforhandling. Denne fil beskriver oversættelsen fra
 * platformens arbejdsplads- og privacyoperationer til Nextclouds API.
 *
 * Nøglepunktet er ærlighed:
 *   - deling og offentlige links håndhæver kundepolitikken,
 *   - offboarding lukker sessioner og delinger,
 *   - sletning blokeres af legal hold/retention og efterlader ikke payload i
 *     revisionssporet,
 *   - backup/restore erklæres partial/unsupported, fordi de kræver
 *     volume-adgang som API'et ikke har.
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

async function userByEmail(client, email) {
  if (!email) return null;
  try {
    const result = await client.getUser(email);
    return result ?? null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export function createNextcloudAdapter({
  authenticate,
  pdp,
  client,
  idempotency = null,
  upstream = null,
  serviceName = "nextcloud-adapter",
  version = "1.0.0",
  environment = "dev",
  profile = "production",
  source = "urn:platform:module:nextcloud-adapter",
  policy = {},
  onAudit = () => {},
  onEvent = () => {},
} = {}) {
  if (!client) throw new Error("kræver client");

  const workspace = createWorkspaceService({ client, policy, onAudit });

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
        name: "nextcloud",
        version: "30.0.0",
        edition: "Enterprise",
        supportedRanges: ["^30.0.0"],
        supportedEditions: ["Enterprise"],
        onUnsupported: "refuse",
        ping: () => client.ping(),
      },
    onAudit,
    onEvent,
    // Læsende verber må replayes; muterende arbejdspladsoperationer må ikke
    // genafspilles, så en deling/sletning ikke gentages ved en gentaget nøgle.
    replayable: (verb) => verb.startsWith("subject.") || verb.endsWith(".read"),
  });

  // Konvertér domænefejl til adapterfejl, så HTTP-status og kode bevares
  // (403/404/409) i stedet for at blive en generisk upstream-fejl.
  function runWorkspace(verb, req, res, fn) {
    return sdk.guard(req, res, verb, async (ctx) => {
      try {
        return await fn(ctx);
      } catch (err) {
        if (err instanceof WorkspaceError) {
          throw new AdapterError(err.message, { code: err.code, status: err.status });
        }
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

    // ---- Privacy-verber -------------------------------------------------
    if (method === "POST" && pathname === "/v1/privacy/locate") {
      return runWorkspace("subject.locate", req, res, async ({ body, tenantId }) => {
        const email = emailOf(body);
        const user = await userByEmail(client, email);
        if (!user) return { count: 0, matches: [] };
        const files = (await client.listFiles(user.id))?.files ?? [];
        const shares = ((await client.listShares({})) ?? []).filter((s) => s.uid_owner === user.id || s.share_with === user.id);
        const sessions = (await client.listSessions(user.id))?.sessions ?? [];
        const calendars = (await client.listCalendars(user.id))?.calendars ?? [];
        const count = files.length + shares.length + sessions.length + calendars.length;
        return {
          count,
          matches: [
            { subjectId: user.id, tenantId, kind: "user", files: files.length, shares: shares.length, sessions: sessions.length, calendars: calendars.length },
          ],
        };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/export") {
      return runWorkspace("subject.export", req, res, async ({ body, tenantId, principal }) => {
        const email = emailOf(body);
        const user = await userByEmail(client, email);
        if (!user) return { count: 0, records: [], artifactRef: null };
        const actor = actorFrom(principal, tenantId);
        const bundle = await workspace.exportUserData({ actor, subject: { id: user.id }, tenantId });
        return { count: bundle.files.length, records: bundle.files, shares: bundle.shares, calendars: bundle.calendars, aclPreserved: bundle.aclPreserved, artifactRef: `s3://evidence/dsar/nextcloud/${user.id}.json` };
      });
    }

    if (method === "POST" && pathname === "/v1/privacy/erase") {
      return runWorkspace("subject.erase", req, res, async ({ body, tenantId, principal }) => {
        const email = emailOf(body);
        const user = await userByEmail(client, email);
        if (!user) return { recordsAffected: 0, partial: true, note: "subjektet findes ikke" };
        const actor = actorFrom(principal, tenantId);
        const receipt = await workspace.requestDeletion({
          actor,
          subject: { id: user.id },
          tenantId,
          reason: body.reason ?? "DSAR-sletning gennem privacy-verbum",
          legalHold: body.legalHold === true,
          retentionDays: body.retentionDays ?? 0,
          approvals: Array.isArray(body.approvals) ? body.approvals : [{ verdict: "approve" }],
        });
        return {
          recordsAffected: receipt.deletedFiles,
          deletedShares: receipt.deletedShares,
          partial: true,
          remainingCopies: receipt.remainingCopies,
          note: "Filer, delinger og sessioner slettes gennem API'et. Backups, versions-/papirkurvshistorik og søgeindeks er ikke fjernet og skal håndteres af upstream-drift (DKC-021).",
        };
      });
    }

    // ---- Arbejdsplads: filer -------------------------------------------
    if (method === "POST" && pathname === "/v1/workspace/files/read") {
      return runWorkspace("workspace.file.read", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.readFile({ actor, owner: body.owner, path: body.path, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/workspace/files/edit") {
      return runWorkspace("workspace.file.edit", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.editFile({ actor, owner: body.owner, path: body.path, content: body.content, tenantId });
      });
    }

    // ---- Arbejdsplads: deling og links ---------------------------------
    if (method === "POST" && pathname === "/v1/workspace/shares") {
      return runWorkspace("workspace.share.create", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.shareFile({
          actor,
          owner: body.owner,
          path: body.path,
          shareWith: body.shareWith,
          shareType: body.shareType ?? SHARE_TYPES.USER,
          permissions: body.permissions,
          targetDomain: body.targetDomain,
          tenantId,
        });
      });
    }

    if (method === "POST" && pathname === "/v1/workspace/shares/revoke") {
      return runWorkspace("workspace.share.revoke", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.revokeShare({ actor, shareId: body.shareId, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/workspace/public-links") {
      return runWorkspace("workspace.link.create", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.createPublicLink({
          actor,
          owner: body.owner,
          path: body.path,
          tenantId,
          ttlDays: body.ttlDays,
          password: body.password,
          permissions: body.permissions,
        });
      });
    }

    // ---- Arbejdsplads: gæster og offboarding ---------------------------
    if (method === "POST" && pathname === "/v1/workspace/guests") {
      return runWorkspace("workspace.guest.invite", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.inviteGuest({ actor, guest: body.guest ?? {}, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/workspace/guests/suspend") {
      return runWorkspace("workspace.guest.suspend", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.suspendGuest({ actor, guestId: body.guestId, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/workspace/guests/remove") {
      return runWorkspace("workspace.guest.remove", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.removeGuest({ actor, guestId: body.guestId, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/workspace/offboard") {
      return runWorkspace("workspace.user.offboard", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.offboardUser({ actor, subject: body.subject ?? {}, tenantId });
      });
    }

    // ---- Arbejdsplads: kalender, formater og kombination ---------------
    if (method === "POST" && pathname === "/v1/workspace/calendar") {
      return runWorkspace("workspace.calendar.read", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.listCalendar({ actor, owner: body.owner, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/workspace/calendar/events") {
      return runWorkspace("workspace.calendar.event.create", req, res, async ({ body, tenantId, principal }) => {
        const actor = actorFrom(principal, tenantId);
        return workspace.createEvent({ actor, owner: body.owner, calendar: body.calendar, event: body.event, tenantId });
      });
    }

    if (method === "POST" && pathname === "/v1/workspace/office-formats") {
      return runWorkspace("workspace.office.formats", req, res, async () => workspace.officeFormats());
    }

    if (method === "POST" && pathname === "/v1/workspace/edition") {
      return runWorkspace("workspace.edition.assess", req, res, async ({ body }) => workspace.assessCombination(body.combination));
    }

    if (method === "GET" && pathname === "/v1/workspace/backup-declaration") {
      return sdk.respond(res, 200, workspace.backupDeclaration());
    }

    return sdk.respond(res, 404, { error: "not found" });
  });

  return {
    server,
    sdk,
    workspace,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
