import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * Testdobbel for OpenProject API v3.
 *
 * Den holder rigtig tilstand (projekter, medlemskaber, arbejdspakker,
 * relationer, aktiviteter og vedhæftninger), så et import-/eksport- og
 * rettighedsforløb kan efterprøves uden en rigtig OpenProject-installation.
 * Den er bevidst minimal og svarer HAL-lignende, ligesom upstream. Den er ikke
 * en sikkerhedsmodel: autentificering sker med én service-token, og
 * adgangskontrollen ligger i adapterens domænelag.
 */
export function createMockOpenProject({
  token = "test-token",
  version = "14.6.0",
  edition = "Enterprise",
  projects = [
    { id: "10", identifier: "projekt-alpha", name: "Projekt Alpha", tenantId: "acme", status: "active", visibility: "private" },
    { id: "11", identifier: "projekt-beta", name: "Projekt Beta", tenantId: "acme", status: "active", visibility: "private" },
    { id: "12", identifier: "projekt-gamma", name: "Projekt Gamma", tenantId: "globex", status: "active", visibility: "private" },
  ],
  members = [
    { id: "100", projectId: "10", principal: "anna", role: "project-admin", tenantId: "acme" },
    { id: "101", projectId: "10", principal: "bo", role: "member", tenantId: "acme" },
    { id: "102", projectId: "11", principal: "bo", role: "member", tenantId: "acme" },
    { id: "103", projectId: "10", principal: "gus", role: "external-guest", tenantId: "acme" },
    { id: "104", projectId: "12", principal: "carla", role: "member", tenantId: "globex" },
  ],
  workPackages = [
    { id: "500", externalId: "WP-1", projectId: "10", subject: "Planlæg pilot", type: "task", status: "in_progress", assigneeId: "bo", priority: "high", version: 3, tenantId: "acme" },
    { id: "501", externalId: "WP-2", projectId: "10", subject: "Skriv runbook", type: "task", status: "new", assigneeId: "anna", priority: "normal", version: 1, tenantId: "acme" },
    { id: "502", externalId: "WP-3", projectId: "11", subject: "Beta-opgave", type: "bug", status: "new", assigneeId: "bo", version: 1, tenantId: "acme" },
  ],
  relations = [{ id: "900", fromId: "501", toId: "500", type: "blocked_by" }],
  attachments = [{ id: "700", workPackageId: "500", filename: "plan.pdf", sha256: "a".repeat(64), sizeBytes: 1234 }],
} = {}) {
  const projectStore = new Map(projects.map((p) => [p.id, { ...p }]));
  const memberStore = new Map(members.map((m) => [m.id, { ...m }]));
  const wpStore = new Map(workPackages.map((wp) => [wp.id, { ...wp }]));
  const relationStore = new Map(relations.map((r) => [r.id, { ...r }]));
  const attachmentStore = new Map(attachments.map((a) => [a.id, { ...a }]));
  const activityStore = [];
  let wpCounter = 600;
  let memberCounter = 200;
  let relationCounter = 1000;

  const now = () => new Date().toISOString();

  const relationsFor = (wpId) => [...relationStore.values()].filter((r) => r.fromId === wpId || r.toId === wpId);

  function dependsOn(wpId) {
    // `blocked_by`: fromId afhænger af toId.
    return relationsFor(wpId)
      .filter((r) => r.type === "blocked_by" && r.fromId === wpId)
      .map((r) => r.toId)
      .filter(Boolean);
  }

  function projectHAL(p) {
    return {
      id: Number(p.id),
      identifier: p.identifier,
      name: p.name,
      active: p.status === "active",
      public: p.visibility === "public",
      tenantId: p.tenantId,
      _links: {
        self: { href: `/api/v3/projects/${p.id}` },
        parent: p.parentId ? { href: `/api/v3/projects/${p.parentId}` } : { href: null },
      },
    };
  }

  function wpHAL(wp) {
    return {
      id: Number(wp.id),
      externalId: wp.externalId,
      subject: wp.subject,
      version: wp.version,
      startDate: wp.startDate ?? null,
      dueDate: wp.dueDate ?? null,
      priority: wp.priority ?? "normal",
      _links: {
        self: { href: `/api/v3/work_packages/${wp.id}` },
        project: { href: `/api/v3/projects/${wp.projectId}` },
        type: { href: "/api/v3/types/1", title: wp.type },
        status: { href: "/api/v3/statuses/1", title: wp.status },
        assignee: wp.assigneeId ? { href: `/api/v3/users/${wp.assigneeId}`, title: wp.assigneeId } : { href: null },
        parent: wp.parentId ? { href: `/api/v3/work_packages/${wp.parentId}` } : { href: null },
        dependsOn: dependsOn(wp.id).map((id) => ({ href: `/api/v3/work_packages/${id}`, title: wpStore.get(id)?.externalId })),
      },
    };
  }

  function memberHAL(m) {
    return {
      id: Number(m.id),
      _links: {
        self: { href: `/api/v3/memberships/${m.id}` },
        project: { href: `/api/v3/projects/${m.projectId}` },
        principal: m.principal ? { href: `/api/v3/users/${m.principal}`, title: m.principal } : { href: null },
        group: m.group ? { href: `/api/v3/groups/${m.group}`, title: m.group } : { href: null },
        roles: [{ href: `/api/v3/roles/${m.role}`, title: m.role }],
      },
    };
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (code, body, headers = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { message: "unauthorized" });

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      handle(url, body);
    });

    function handle(url, body) {
      const { pathname } = url;
      const method = req.method;

      if (method === "GET" && pathname === "/api/v3/configuration") {
        return json(200, { coreVersion: version, edition });
      }

      if (method === "GET" && pathname === "/api/v3/projects") {
        return json(200, { _embedded: { elements: [...projectStore.values()].map(projectHAL) } });
      }
      const projectById = pathname.match(/^\/api\/v3\/projects\/([^/]+)$/);
      if (method === "GET" && projectById) {
        const p = projectStore.get(decodeURIComponent(projectById[1]));
        return p ? json(200, projectHAL(p)) : json(404, { message: "project not found" });
      }

      const projectWp = pathname.match(/^\/api\/v3\/projects\/([^/]+)\/work_packages$/);
      if (projectWp) {
        const projectId = decodeURIComponent(projectWp[1]);
        if (!projectStore.has(projectId)) return json(404, { message: "project not found" });
        if (method === "GET") {
          return json(200, { _embedded: { elements: [...wpStore.values()].filter((wp) => wp.projectId === projectId).map(wpHAL) } });
        }
        if (method === "POST") {
          const id = String(wpCounter++);
          const wp = {
            id,
            externalId: body.externalId ?? `WP-${id}`,
            projectId,
            subject: body.subject ?? `Arbejdspakke ${id}`,
            type: body.type ?? "task",
            status: body.status ?? "new",
            assigneeId: body.assigneeId ?? null,
            priority: body.priority ?? "normal",
            startDate: body.startDate ?? null,
            dueDate: body.dueDate ?? null,
            parentId: body.parentId ?? null,
            version: 1,
            tenantId: projectStore.get(projectId).tenantId,
          };
          wpStore.set(id, wp);
          activityStore.push({ id: randomUUID(), workPackageId: id, type: "created", at: now(), actor: body.actor ?? null });
          for (const dep of body.dependsOn ?? []) {
            const target = [...wpStore.values()].find((x) => x.externalId === dep);
            if (target) relationStore.set(String(relationCounter++), { id: `rel-${relationCounter}`, fromId: id, toId: target.id, type: "blocked_by" });
          }
          return json(201, wpHAL(wp));
        }
      }

      const wpById = pathname.match(/^\/api\/v3\/work_packages\/([^/]+)$/);
      if (wpById) {
        const wp = wpStore.get(decodeURIComponent(wpById[1]));
        if (!wp) return json(404, { message: "work package not found" });
        if (method === "GET") return json(200, wpHAL(wp));
        if (method === "PATCH") {
          if (body.lockVersion !== undefined && Number(body.lockVersion) !== wp.version) {
            return json(409, { message: "conflict: version mismatch", _embedded: { errors: [{ message: "version mismatch" }] } });
          }
          Object.assign(wp, {
            ...(body.subject !== undefined ? { subject: body.subject } : {}),
            ...(body.type !== undefined ? { type: body.type } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
            ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
            ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
            version: wp.version + 1,
          });
          activityStore.push({ id: randomUUID(), workPackageId: wp.id, type: "updated", at: now(), actor: body.actor ?? null });
          return json(200, wpHAL(wp));
        }
      }

      const wpActivities = pathname.match(/^\/api\/v3\/work_packages\/([^/]+)\/activities$/);
      if (method === "GET" && wpActivities) {
        const wpId = decodeURIComponent(wpActivities[1]);
        return json(200, { _embedded: { elements: activityStore.filter((a) => a.workPackageId === wpId) } });
      }

      const wpRelations = pathname.match(/^\/api\/v3\/work_packages\/([^/]+)\/relations$/);
      if (wpRelations) {
        const wpId = decodeURIComponent(wpRelations[1]);
        if (method === "GET") {
          return json(200, { _embedded: { elements: relationsFor(wpId).map((r) => ({ id: Number(r.id.replace(/\D/g, "")) || 0, type: r.type, _links: { from: { href: `/api/v3/work_packages/${r.fromId}` }, to: { href: `/api/v3/work_packages/${r.toId}` } } })) } });
        }
        if (method === "POST") {
          const id = `rel-${relationCounter++}`;
          relationStore.set(String(relationCounter), { id, fromId: wpId, toId: body.toId, type: body.type ?? "blocked_by" });
          return json(201, { id });
        }
      }

      const projectMembers = pathname.match(/^\/api\/v3\/projects\/([^/]+)\/memberships$/);
      if (method === "GET" && projectMembers) {
        const projectId = decodeURIComponent(projectMembers[1]);
        return json(200, { _embedded: { elements: [...memberStore.values()].filter((m) => m.projectId === projectId).map(memberHAL) } });
      }
      if (method === "POST" && pathname === "/api/v3/memberships") {
        const id = String(memberCounter++);
        const project = projectStore.get(String(body.projectId));
        if (!project) return json(404, { message: "project not found" });
        const m = { id, projectId: String(body.projectId), principal: body.principal ?? null, group: body.group ?? null, role: body.role, tenantId: project.tenantId };
        memberStore.set(id, m);
        return json(201, memberHAL(m));
      }
      const memberById = pathname.match(/^\/api\/v3\/memberships\/([^/]+)$/);
      if (method === "DELETE" && memberById) {
        const id = decodeURIComponent(memberById[1]);
        if (!memberStore.has(id)) return json(404, { message: "membership not found" });
        memberStore.delete(id);
        return json(204, null);
      }

      const projectAttachments = pathname.match(/^\/api\/v3\/projects\/([^/]+)\/attachments$/);
      if (method === "GET" && projectAttachments) {
        const projectId = decodeURIComponent(projectAttachments[1]);
        const wps = new Set([...wpStore.values()].filter((wp) => wp.projectId === projectId).map((wp) => wp.id));
        return json(200, { _embedded: { elements: [...attachmentStore.values()].filter((a) => wps.has(a.workPackageId)) } });
      }
      const wpAttachments = pathname.match(/^\/api\/v3\/work_packages\/([^/]+)\/attachments$/);
      if (method === "POST" && wpAttachments) {
        const wpId = decodeURIComponent(wpAttachments[1]);
        const id = randomUUID();
        const a = { id, workPackageId: wpId, filename: body.filename, sha256: body.sha256 ?? null, sizeBytes: body.sizeBytes ?? 0 };
        attachmentStore.set(id, a);
        return json(201, a);
      }

      return json(404, { message: "not found" });
    }
  });

  return {
    server,
    projects: projectStore,
    members: memberStore,
    workPackages: wpStore,
    relations: relationStore,
    attachments: attachmentStore,
    activities: activityStore,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
