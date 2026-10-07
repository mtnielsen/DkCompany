/**
 * Tynd klient mod OpenProject API v3. Adapteren ændrer intet ved upstream; den
 * oversætter platformens projekt-, opgave- og medlemskabsoperationer til de
 * kald, OpenProject faktisk tilbyder, og normaliserer HAL-svarene til de
 * platformsting domænet regner på.
 *
 * Klienten bevarer upstream-status og Retry-After, så adapter-SDK'en kan mappe
 * 429/5xx/409 korrekt i stedet for at svare et generisk 502.
 */
const excerpt = (s) => (typeof s === "string" ? s.slice(0, 200) : "");

export function createOpenProjectClient({ baseUrl, token, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new Error("createOpenProjectClient kræver baseUrl");

  async function raw(path, { method = "GET", body, headers = {} } = {}) {
    const init = {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`OpenProject ${method} ${path} -> HTTP ${res.status}${detail ? `: ${excerpt(detail)}` : ""}`);
      err.status = res.status;
      const retry = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
      if (retry) err.retryAfterSeconds = Number(retry) || retry;
      throw err;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  const elements = (payload) => payload?._embedded?.elements ?? [];
  const linkTitle = (link) => link?.title ?? null;
  const idFromHref = (href) => (typeof href === "string" ? href.split("/").filter(Boolean).pop() : null);

  function normalizeProject(p) {
    if (!p) return null;
    return {
      id: String(p.id),
      identifier: p.identifier ?? null,
      name: p.name ?? String(p.id),
      status: p.active === false ? "closed" : "active",
      visibility: p.public ? "public" : "private",
      tenantId: p.tenantId ?? null,
      parentId: idFromHref(p._links?.parent?.href),
    };
  }

  function normalizeWorkPackage(wp) {
    if (!wp) return null;
    return {
      id: String(wp.id),
      externalId: wp.externalId ?? `WP-${wp.id}`,
      projectId: idFromHref(wp._links?.project?.href),
      subject: wp.subject ?? null,
      type: linkTitle(wp._links?.type) ?? "task",
      status: linkTitle(wp._links?.status) ?? "new",
      assigneeId: idFromHref(wp._links?.assignee?.href),
      priority: wp.priority ?? "normal",
      startDate: wp.startDate ?? null,
      dueDate: wp.dueDate ?? null,
      parentId: idFromHref(wp._links?.parent?.href),
      dependsOn: (wp._links?.dependsOn ?? []).map((l) => l.title ?? (idFromHref(l.href) ? `WP-${idFromHref(l.href)}` : null)).filter(Boolean),
      version: wp.version ?? 1,
    };
  }

  function normalizeMembership(m) {
    if (!m) return null;
    return {
      id: String(m.id),
      projectId: idFromHref(m._links?.project?.href),
      principal: idFromHref(m._links?.principal?.href),
      group: idFromHref(m._links?.group?.href),
      role: linkTitle(m._links?.roles?.[0]) ?? "member",
    };
  }

  return {
    // Sundhed og version
    configuration: () => raw("/api/v3/configuration"),
    ping: () => raw("/api/v3/configuration"),

    listProjects: async () => elements(await raw("/api/v3/projects")).map(normalizeProject),
    getProject: async (id) => normalizeProject(await raw(`/api/v3/projects/${encodeURIComponent(id)}`)),

    listWorkPackages: async (projectId) => elements(await raw(`/api/v3/projects/${encodeURIComponent(projectId)}/work_packages`)).map(normalizeWorkPackage),
    getWorkPackage: async (id) => normalizeWorkPackage(await raw(`/api/v3/work_packages/${encodeURIComponent(id)}`)),
    createWorkPackage: async (projectId, body) => normalizeWorkPackage(await raw(`/api/v3/projects/${encodeURIComponent(projectId)}/work_packages`, { method: "POST", body })),
    updateWorkPackage: async (id, body) => normalizeWorkPackage(await raw(`/api/v3/work_packages/${encodeURIComponent(id)}`, { method: "PATCH", body })),

    listActivities: async (workPackageId) => elements(await raw(`/api/v3/work_packages/${encodeURIComponent(workPackageId)}/activities`)),
    listRelations: async (workPackageId) => elements(await raw(`/api/v3/work_packages/${encodeURIComponent(workPackageId)}/relations`)),
    createRelation: async (workPackageId, body) => raw(`/api/v3/work_packages/${encodeURIComponent(workPackageId)}/relations`, { method: "POST", body }),

    listMemberships: async (projectId) => elements(await raw(`/api/v3/projects/${encodeURIComponent(projectId)}/memberships`)).map(normalizeMembership),
    createMembership: async (body) => normalizeMembership(await raw("/api/v3/memberships", { method: "POST", body })),
    deleteMembership: (id) => raw(`/api/v3/memberships/${encodeURIComponent(id)}`, { method: "DELETE" }),

    listAttachments: async (projectId) => elements(await raw(`/api/v3/projects/${encodeURIComponent(projectId)}/attachments`)),
    createAttachment: async (workPackageId, body) => raw(`/api/v3/work_packages/${encodeURIComponent(workPackageId)}/attachments`, { method: "POST", body }),
  };
}
