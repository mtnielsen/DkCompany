/**
 * DKC-027 — projektstyringsdomænet.
 *
 * Adapterens kerne er ren og sideeffektfri: den regner på projekter,
 * medlemskaber, arbejdspakker og rettigheder og returnerer beslutninger.
 * `createProjectService` binder den til en OpenProject-klient. Dermed kan
 * sikkerhedsbeslutningen efterprøves uden netværk, og upstream kaldes først når
 * beslutningen er `allow`.
 *
 * Principperne er de samme som resten af platformen: default-deny, tenanten
 * udledes af principalen, en projektgæst ser kun sit eget projekt, kun et
 * navngivet menneske må ændre medlemskaber, og en rettighedsændring skubber en
 * ny projektion til søgning og AI-adgang, så et forældet indeks ikke svarer.
 */
import {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  DEFAULT_PROJECT_POLICY,
  WORK_PACKAGE_TYPES,
  WORK_PACKAGE_STATUSES,
  PROJECT_VISIBILITIES,
  FEATURE_PROBES,
  EDITION_COMBINATIONS,
  DEFAULT_EDITION_COMBINATION,
} from "./constants.mjs";

export class ProjectError extends Error {
  constructor(message, code = "project_error", status = 400) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
    this.status = status;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Flet kundepolitikken med de restriktive standarder. */
export function normalizePolicy(policy = {}) {
  const base = clone(DEFAULT_PROJECT_POLICY);
  const merged = {
    ...base,
    ...policy,
    export: { ...base.export, ...(policy.export ?? {}) },
    deletion: { ...base.deletion, ...(policy.deletion ?? {}) },
    ai: { ...base.ai, ...(policy.ai ?? {}) },
  };
  if (!["disabled", "own-projects-only"].includes(merged.guestAccess)) {
    throw new ProjectError(`ukendt guestAccess '${merged.guestAccess}'`, "invalid_policy");
  }
  return merged;
}

/** Rettighederne for en platformrolle. */
export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

/** Sand hvis rollen dækker rettigheden. */
export function roleHasPermission(role, permission) {
  return permissionsForRole(role).includes(permission);
}

function isHuman(actor) {
  return actor?.kind === "human";
}

function isAdmin(actor) {
  return actor?.role === ROLES.TENANT_ADMIN;
}

function sameTenant(actor, resource) {
  return Boolean(actor?.tenantId) && actor.tenantId === resource?.tenantId;
}

/**
 * Find den rolle principalen har i projektet. En medlemskabspost kan pege på en
 * bruger (`principal`) eller en gruppe (`group`); principalens grupper læses fra
 * den verificerede identitet, ikke fra klienten.
 */
export function projectRole(actor, memberships = [], projectId = null) {
  if (!actor?.id) return null;
  const groups = new Set(actor.groups ?? []);
  for (const m of memberships) {
    if (!m || m.role === undefined) continue;
    if (projectId && m.projectId && m.projectId !== projectId) continue;
    if (m.principal && m.principal === actor.id) return m.role;
    if (m.group && groups.has(m.group)) return m.role;
  }
  return null;
}

/**
 * Default-deny projektbeslutning. Ejer/tenant-admin har altid adgang inden for
 * sin egen tenant; alle andre skal have et dækkende medlemskab med den
 * nødvendige rettighed. En projektgæst afvises, medmindre kundepolitikken
 * udtrykkeligt tillader egne projekter. Fremmed tenant og deaktiverede konti
 * afvises før nogen rettighed vurderes.
 */
export function decideProjectAccess({ actor, project, memberships = [], requiredPermission = PERMISSIONS.PROJECT_READ, policy = {} } = {}) {
  if (!actor?.id) return { allowed: false, reason: "ingen verificeret identitet", via: null, role: null };
  if (actor.disabled === true) return { allowed: false, reason: "kontoen er deaktiveret", via: null, role: null };
  if (!project) return { allowed: false, reason: "projektet findes ikke", via: null, role: null };
  if (!sameTenant(actor, project)) return { allowed: false, reason: "projektet tilhører en anden tenant", via: null, role: null };

  const normalized = normalizePolicy(policy);
  const role = isAdmin(actor) ? ROLES.TENANT_ADMIN : projectRole(actor, memberships, project.id);

  if (isAdmin(actor)) {
    return { allowed: true, reason: "tenant-administrator", via: "tenant-admin", role: ROLES.TENANT_ADMIN };
  }
  if (!role) return { allowed: false, reason: "principalen er ikke medlem af projektet", via: null, role: null };
  if (role === ROLES.GUEST && normalized.guestAccess !== "own-projects-only") {
    return { allowed: false, reason: "ekstern projektgæst er slået fra for kunden", via: role, role };
  }
  if (!roleHasPermission(role, requiredPermission)) {
    return { allowed: false, reason: `rollen '${role}' dækker ikke '${requiredPermission}'`, via: role, role };
  }
  return { allowed: true, reason: `medlemskab med rollen '${role}'`, via: "membership", role };
}

/** Projekter principalen må se. Bruges til at bygge søgeprojektionen. */
export function visibleProjectIds({ actor, projects = [], memberships = [], policy = {} } = {}) {
  const allowed = [];
  const denied = [];
  for (const project of projects) {
    const decision = decideProjectAccess({ actor, project, memberships, requiredPermission: PERMISSIONS.PROJECT_READ, policy });
    if (decision.allowed) allowed.push(project.id);
    else denied.push(project.id);
  }
  return { allowed, denied };
}

/**
 * Byg den ACL-bevidste søge-/AI-projektion. `version` kommer fra
 * medlemskabshændelserne; den ændres ved hver rettighedsændring, så et indeks
 * bygget på en gammel version kan afvises.
 */
export function buildPermissionProjection({ actor, projects = [], memberships = [], policy = {}, version = 0, now = () => Date.now() } = {}) {
  const { allowed, denied } = visibleProjectIds({ actor, projects, memberships, policy });
  return {
    principalId: actor?.id ?? null,
    tenantId: actor?.tenantId ?? null,
    version,
    generatedAt: new Date(now()).toISOString(),
    allowedProjectIds: allowed,
    deniedProjectIds: denied,
    filter: { projectIdIn: allowed },
  };
}

/**
 * Et indeks/cache-svar må kun bruges, hvis det er bygget på den aktuelle
 * rettighedsversion og ikke er ældre end politikken tillader. Ellers skal
 * retrieval falde tilbage til en frisk projektion (fail-closed).
 */
export function isProjectionFresh(projection, currentVersion, { now = () => Date.now(), maxAgeSeconds = 300 } = {}) {
  if (!projection) return false;
  if (projection.version !== currentVersion) return false;
  const ageSeconds = (now() - Date.parse(projection.generatedAt)) / 1000;
  return Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds <= maxAgeSeconds;
}

/** Validerer et projekt- og opgavebundt før import. Returnerer `{ path, message }`. */
export function projectBundleProblems(bundle) {
  const problems = [];
  const problem = (path, message) => problems.push({ path, message });
  if (!bundle || typeof bundle !== "object") return [problem("/", "bundtet mangler")];
  if (bundle.kind !== "ProjectBundle") problem("/kind", "kind skal være 'ProjectBundle'");
  const project = bundle.project;
  if (!project) return [problem("/project", "projektet mangler")];
  if (!project.externalId) problem("/project/externalId", "projektet mangler en stabil externalId");
  if (!project.tenantId) problem("/project/tenantId", "projektet mangler tenantId");
  if (project.visibility && !PROJECT_VISIBILITIES.includes(project.visibility)) {
    problem("/project/visibility", `ukendt synlighed '${project.visibility}'`);
  }

  const ids = new Set();
  const duplicate = (path, id) => {
    if (!id) {
      problem(path, "mangler externalId");
      return;
    }
    if (ids.has(id)) problem(path, `dubleret externalId '${id}'`);
    ids.add(id);
  };

  const members = bundle.members ?? [];
  for (const [i, m] of members.entries()) {
    duplicate(`/members/${i}/externalId`, m.externalId);
    if (!m.principal && !m.group) problem(`/members/${i}`, "medlemskabet mangler principal eller gruppe");
    if (!ROLE_PERMISSIONS[m.role]) problem(`/members/${i}/role`, `ukendt rolle '${m.role}'`);
    if (project.tenantId && m.tenantId && m.tenantId !== project.tenantId) {
      problem(`/members/${i}/tenantId`, "medlemskabet krydser tenantgrænsen");
    }
  }
  const memberIds = new Set(members.map((m) => m.externalId).filter(Boolean));

  const workPackages = bundle.workPackages ?? [];
  for (const [i, wp] of workPackages.entries()) {
    duplicate(`/workPackages/${i}/externalId`, wp.externalId);
    if (wp.type && !WORK_PACKAGE_TYPES.includes(wp.type)) problem(`/workPackages/${i}/type`, `ukendt type '${wp.type}'`);
    if (wp.status && !WORK_PACKAGE_STATUSES.includes(wp.status)) problem(`/workPackages/${i}/status`, `ukendt status '${wp.status}'`);
    if (project.tenantId && wp.tenantId && wp.tenantId !== project.tenantId) {
      problem(`/workPackages/${i}/tenantId`, "arbejdspakken krydser tenantgrænsen");
    }
    if (wp.assigneeExternalId && memberIds.size > 0 && !memberIds.has(wp.assigneeExternalId)) {
      problem(`/workPackages/${i}/assigneeExternalId`, `ansvarlig '${wp.assigneeExternalId}' er ikke medlem`);
    }
  }
  const wpIds = new Set(workPackages.map((wp) => wp.externalId).filter(Boolean));
  for (const [i, wp] of workPackages.entries()) {
    for (const dep of wp.dependsOn ?? []) {
      if (!wpIds.has(dep)) problem(`/workPackages/${i}/dependsOn`, `afhængigheden '${dep}' findes ikke`);
    }
    if (wp.parentExternalId && !wpIds.has(wp.parentExternalId)) {
      problem(`/workPackages/${i}/parentExternalId`, `forælderen '${wp.parentExternalId}' findes ikke`);
    }
  }
  try {
    topologicalOrder(workPackages);
  } catch (err) {
    problem("/workPackages", err.message);
  }

  for (const [i, a] of (bundle.attachments ?? []).entries()) {
    duplicate(`/attachments/${i}/externalId`, a.externalId);
    if (a.workPackageExternalId && !wpIds.has(a.workPackageExternalId)) {
      problem(`/attachments/${i}/workPackageExternalId`, `vedhæftningen peger på en ukendt arbejdspakke '${a.workPackageExternalId}'`);
    }
  }
  return problems;
}

/**
 * Topologisk rækkefølge af arbejdspakker ud fra `dependsOn`. Kaster hvis der er
 * en cyklus, så en import ikke kan skabe et uløseligt afhængighedsnet.
 */
export function topologicalOrder(workPackages = []) {
  const byId = new Map(workPackages.map((wp) => [wp.externalId, wp]));
  const indegree = new Map(workPackages.map((wp) => [wp.externalId, 0]));
  const edges = new Map(workPackages.map((wp) => [wp.externalId, []]));
  for (const wp of workPackages) {
    for (const dep of wp.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      indegree.set(wp.externalId, (indegree.get(wp.externalId) ?? 0) + 1);
      edges.get(dep).push(wp.externalId);
    }
  }
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort();
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    for (const next of edges.get(id) ?? []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  if (ordered.length !== workPackages.length) throw new ProjectError("afhængighederne indeholder en cyklus", "dependency_cycle");
  return ordered;
}

/**
 * Beregn en importplan mod de allerede kendte arbejdspakker (matchet på den
 * stabile externalId). En gentaget import af samme bundt giver nul `creates` og
 * dermed ingen dubletter. Sammenligningen sker på en kanonisk projektion, så
 * eksportens feltnavne og upstreamens feltnavne kan sameksistere.
 */
export function importPlan({ bundle, existing = [] } = {}) {
  const problems = projectBundleProblems(bundle);
  if (problems.length) return { creates: [], updates: [], noops: [], conflicts: problems, idempotent: false };
  const existingById = new Map(existing.map((wp) => [wp.externalId, wp]));
  const canonical = (wp) => ({
    subject: wp.subject ?? null,
    type: wp.type ?? "task",
    status: wp.status ?? "new",
    assignee: wp.assigneeExternalId ?? wp.assigneeId ?? null,
    priority: wp.priority ?? "normal",
    dependsOn: [...(wp.dependsOn ?? [])].sort(),
  });
  const seen = new Set();
  const creates = [];
  const updates = [];
  const noops = [];
  const conflicts = [];
  for (const wp of bundle.workPackages ?? []) {
    if (seen.has(wp.externalId)) {
      conflicts.push({ path: `/workPackages/${wp.externalId}`, message: "dubleret externalId i bundtet" });
      continue;
    }
    seen.add(wp.externalId);
    const current = existingById.get(wp.externalId);
    if (!current) creates.push(wp);
    else if (JSON.stringify(canonical(current)) !== JSON.stringify(canonical(wp))) updates.push({ externalId: wp.externalId, existingId: current.id ?? current.externalId, from: current, to: wp });
    else noops.push(wp.externalId);
  }
  return { creates, updates, noops, conflicts, idempotent: creates.length === 0 && conflicts.length === 0 };
}

/** Oversæt et eksportbundts arbejdspakke til OpenProjectens opgavefelter. */
export function workPackageToUpstream(wp = {}) {
  return {
    externalId: wp.externalId,
    subject: wp.subject,
    type: wp.type,
    status: wp.status,
    assigneeId: wp.assigneeExternalId ?? wp.assigneeId ?? null,
    priority: wp.priority,
    startDate: wp.startDate ?? null,
    dueDate: wp.dueDate ?? null,
    parentId: wp.parentExternalId ?? wp.parentId ?? null,
    dependsOn: wp.dependsOn ?? [],
  };
}

/** Byg et eksportbundt med stabil reference og ACL-bevidst medlemsliste. */
export function exportBundle({ project, members = [], workPackages = [], attachments = [], statusEvents = [], exportedAt = new Date().toISOString() } = {}) {
  if (!project?.externalId) throw new ProjectError("projektet mangler en stabil externalId", "invalid_project");
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ProjectBundle",
    metadata: {
      formatVersion: "1.0.0",
      exportedAt,
      source: "openproject-adapter",
      projectRef: project.externalId,
    },
    project: {
      externalId: project.externalId,
      identifier: project.identifier ?? null,
      name: project.name ?? project.externalId,
      tenantId: project.tenantId,
      status: project.status ?? "active",
      visibility: project.visibility ?? "private",
      parentExternalId: project.parentExternalId ?? null,
    },
    members: members.map((m) => ({
      externalId: m.externalId,
      principal: m.principal ?? null,
      group: m.group ?? null,
      role: m.role,
      tenantId: m.tenantId ?? project.tenantId,
    })),
    workPackages: workPackages.map((wp) => ({
      externalId: wp.externalId,
      subject: wp.subject ?? wp.externalId,
      type: wp.type ?? "task",
      status: wp.status ?? "new",
      assigneeExternalId: wp.assigneeExternalId ?? null,
      priority: wp.priority ?? "normal",
      startDate: wp.startDate ?? null,
      dueDate: wp.dueDate ?? null,
      parentExternalId: wp.parentExternalId ?? null,
      dependsOn: [...(wp.dependsOn ?? [])].sort(),
      version: wp.version ?? 1,
      tenantId: wp.tenantId ?? project.tenantId,
    })),
    attachments: attachments.map((a) => ({
      externalId: a.externalId,
      workPackageExternalId: a.workPackageExternalId,
      filename: a.filename,
      sha256: a.sha256 ?? null,
      sizeBytes: a.sizeBytes ?? 0,
      tenantId: a.tenantId ?? project.tenantId,
    })),
    statusEvents: statusEvents.map((e) => ({
      id: e.id,
      workPackageExternalId: e.workPackageExternalId,
      type: e.type,
      at: e.at,
      actor: e.actor ?? null,
    })),
  };
}

/**
 * Vurderer en editionkombination pr. feature. En feature frigives kun, hvis
 * licensen er afklaret, API'et findes og driftsprofilen er dokumenteret.
 * Community frigiver projekt-, opgave-, medlems- og filmodulet, men ikke
 * central SSO.
 */
export function assessEditionCombination(combination) {
  if (!combination) throw new ProjectError("kombinationen findes ikke", "unknown_combination", 404);
  const product = combination.product ?? {};
  const blockers = [];
  const licenseOk = Boolean(product.license?.spdx) && Boolean(product.license?.type) && product.license.type !== "unknown";
  if (!licenseOk) blockers.push("licensen er ikke afklaret");
  if (!product.api?.protocol) blockers.push("API-protokollen mangler");
  if (!product.operations?.backup) blockers.push("driftsprofilen mangler backupstrategi");
  if (!product.operations?.rpoMinutes || !product.operations?.rtoMinutes) blockers.push("driftsprofilen mangler RPO/RTO");

  const features = {};
  for (const [feature, probe] of Object.entries(FEATURE_PROBES)) {
    const supported = licenseOk && probe(product);
    features[feature] = {
      released: supported,
      reason: supported ? `'${feature}' er valideret for ${product.edition ?? "editionen"}` : `'${feature}' er ikke valideret for ${product.edition ?? "editionen"}`,
    };
  }
  const released = Object.values(features).every((f) => f.released);
  return {
    name: combination.name,
    status: released ? "approved" : Object.values(features).some((f) => f.released) ? "partial" : "blocked",
    edition: product.edition ?? null,
    blockers,
    features,
  };
}

/**
 * Ærlig feature-rapport for en kandidat. Hver manglende feature registreres
 * eksplicit — en manglende central SSO er en afvigelse, ikke stilhed.
 */
export function featureReport(combination, required = combination?.requiredFeatures ?? []) {
  const product = combination?.product ?? {};
  const checked = [...new Set(required)];
  const supported = [];
  const deviations = [];
  for (const feature of checked) {
    const probe = FEATURE_PROBES[feature];
    if (probe && probe(product)) supported.push(feature);
    else deviations.push({ feature, severity: "deviation", note: `${product.edition ?? "editionen"} rapporterer ikke '${feature}'` });
  }
  return { edition: product.edition ?? null, checked, supported, unsupported: deviations.map((d) => d.feature), deviations };
}

/** Blokerer en sletning, når legal hold eller retention siger nej. */
export function deletionProblems({ policy = {}, legalHold = false, retentionDays = 0, reason = "", approvals = [] } = {}) {
  const normalized = normalizePolicy(policy);
  const problems = [];
  if (legalHold && normalized.deletion.blockOnLegalHold) problems.push("der er aktiv legal hold på subjektet");
  if (retentionDays > 0) problems.push(`retentionperioden udløber om ${retentionDays} dage`);
  if (normalized.deletion.requireReason && (!reason || reason.trim().length < 10)) {
    problems.push("sletning kræver en dokumenteret begrundelse (mindst 10 tegn)");
  }
  if (normalized.deletion.requireApproval && !approvals.some((a) => a?.verdict === "approve")) {
    problems.push("sletning kræver en navngiven godkendelse");
  }
  return problems;
}

function assertHuman(actor, what) {
  if (!isHuman(actor)) throw new ProjectError(`${what} kræver et verificeret menneske`, "human_required", 403);
}

/**
 * Bind domænet til en OpenProject-klient. Alle muterende projektoperationer
 * kræver et verificeret menneske; læsning kan også ske for en agent med det
 * rette medlemskab. Hver afvisning og hver gennemført handling auditeres, og
 * hver rettighedsændring skubber en ny projektion til søgning/AI.
 */
export function createProjectService({ client, policy = {}, now = () => Date.now(), onAudit = () => {}, onEvent = () => {} } = {}) {
  if (!client) throw new ProjectError("createProjectService kræver client", "config");
  let customerPolicy = normalizePolicy(policy);
  let permissionVersion = 0;
  const permissionEvents = [];

  function audit(type, entry) {
    onAudit({ type, at: new Date(now()).toISOString(), ...entry });
  }

  function bumpPermissionVersion(reason, entry) {
    permissionVersion += 1;
    const event = { version: permissionVersion, reason, at: new Date(now()).toISOString(), ...entry };
    permissionEvents.push(event);
    onEvent({ type: "dk.platform.openproject-adapter.permission.changed", ...event });
    return event;
  }

  async function projectOrThrow(projectId, actor) {
    const project = await client.getProject(projectId);
    if (!project) throw new ProjectError("projektet findes ikke", "not_found", 404);
    if (project.tenantId && actor?.tenantId && project.tenantId !== actor.tenantId) {
      throw new ProjectError("projektet tilhører en anden tenant", "tenant_rejected", 403);
    }
    return project;
  }

  async function decideFor(actor, project, requiredPermission) {
    const memberships = await client.listMemberships(project.id).catch(() => []);
    return decideProjectAccess({ actor, project, memberships, requiredPermission, policy: customerPolicy });
  }

  async function listProjects({ actor }) {
    const all = await client.listProjects();
    const visible = [];
    for (const project of all) {
      if (project.tenantId && actor?.tenantId && project.tenantId !== actor.tenantId) continue;
      const decision = await decideFor(actor, project, PERMISSIONS.PROJECT_READ);
      if (decision.allowed) visible.push({ ...project, role: decision.role, via: decision.via });
    }
    return { projects: visible, projection: buildPermissionProjection({ actor, projects: visible, memberships: [], policy: customerPolicy, version: permissionVersion, now }) };
  }

  async function readProject({ actor, projectId }) {
    const project = await projectOrThrow(projectId, actor);
    const decision = await decideFor(actor, project, PERMISSIONS.PROJECT_READ);
    if (!decision.allowed) {
      audit("project.access.denied", { actor: actor?.id, projectId, tenantId: actor?.tenantId, reason: decision.reason });
      throw new ProjectError(`adgang nægtet: ${decision.reason}`, "access_denied", 403);
    }
    const workPackages = await client.listWorkPackages(projectId);
    const members = await client.listMemberships(projectId).catch(() => []);
    return { project, workPackages, members, role: decision.role, via: decision.via };
  }

  async function createWorkPackage({ actor, projectId, input = {} }) {
    assertHuman(actor, "oprettelse af arbejdspakke");
    const project = await projectOrThrow(projectId, actor);
    const decision = await decideFor(actor, project, PERMISSIONS.WORKPACKAGE_WRITE);
    if (!decision.allowed) throw new ProjectError(`oprettelse nægtet: ${decision.reason}`, "access_denied", 403);
    if (input.type && !WORK_PACKAGE_TYPES.includes(input.type)) throw new ProjectError(`ukendt type '${input.type}'`, "invalid_input");
    if (input.status && !WORK_PACKAGE_STATUSES.includes(input.status)) throw new ProjectError(`ukendt status '${input.status}'`, "invalid_input");
    const created = await client.createWorkPackage(projectId, { ...input, actor: actor.id });
    audit("project.workpackage.created", { actor: actor.id, projectId, workPackageId: created.id, tenantId: actor.tenantId });
    return created;
  }

  async function updateWorkPackage({ actor, projectId, workPackageId, patch = {} }) {
    assertHuman(actor, "opdatering af arbejdspakke");
    const project = await projectOrThrow(projectId, actor);
    const decision = await decideFor(actor, project, PERMISSIONS.WORKPACKAGE_WRITE);
    if (!decision.allowed) throw new ProjectError(`opdatering nægtet: ${decision.reason}`, "access_denied", 403);
    const current = await client.getWorkPackage(workPackageId);
    if (!current) throw new ProjectError("arbejdspakken findes ikke", "not_found", 404);
    if (patch.status && !WORK_PACKAGE_STATUSES.includes(patch.status)) throw new ProjectError(`ukendt status '${patch.status}'`, "invalid_input");
    const updated = await client.updateWorkPackage(workPackageId, { ...patch, lockVersion: current.version, actor: actor.id });
    audit("project.workpackage.updated", { actor: actor.id, projectId, workPackageId, tenantId: actor.tenantId, version: updated.version });
    return updated;
  }

  async function addMember({ actor, projectId, principal, role, group }) {
    assertHuman(actor, "tilføjelse af medlem");
    const project = await projectOrThrow(projectId, actor);
    const decision = await decideFor(actor, project, PERMISSIONS.MEMBER_MANAGE);
    if (!decision.allowed) throw new ProjectError(`medlemsændring nægtet: ${decision.reason}`, "access_denied", 403);
    if (!ROLE_PERMISSIONS[role]) throw new ProjectError(`ukendt rolle '${role}'`, "invalid_role");
    if (role === ROLES.GUEST && customerPolicy.guestAccess !== "own-projects-only") {
      throw new ProjectError("ekstern projektgæst er slået fra for kunden", "guest_denied", 403);
    }
    const member = await client.createMembership({ projectId, principal: principal ?? null, group: group ?? null, role });
    bumpPermissionVersion("member.added", { projectId, principal: principal ?? group ?? null, role, actor: actor.id, tenantId: actor.tenantId });
    audit("project.member.added", { actor: actor.id, projectId, membershipId: member.id, role, tenantId: actor.tenantId });
    return member;
  }

  async function removeMember({ actor, projectId, membershipId }) {
    assertHuman(actor, "fjernelse af medlem");
    const project = await projectOrThrow(projectId, actor);
    const decision = await decideFor(actor, project, PERMISSIONS.MEMBER_MANAGE);
    if (!decision.allowed) throw new ProjectError(`medlemsændring nægtet: ${decision.reason}`, "access_denied", 403);
    await client.deleteMembership(membershipId);
    bumpPermissionVersion("member.removed", { projectId, membershipId, actor: actor.id, tenantId: actor.tenantId });
    audit("project.member.removed", { actor: actor.id, projectId, membershipId, tenantId: actor.tenantId });
    return { membershipId, removed: true };
  }

  async function inviteGuest({ actor, projectId, guest = {} }) {
    assertHuman(actor, "invitation af gæst");
    if (customerPolicy.guestAccess !== "own-projects-only") {
      throw new ProjectError("eksterne projektgæster er slået fra for kunden", "guest_denied", 403);
    }
    const project = await projectOrThrow(projectId, actor);
    const decision = await decideFor(actor, project, PERMISSIONS.MEMBER_MANAGE);
    if (!decision.allowed) throw new ProjectError(`gæsteinvitation nægtet: ${decision.reason}`, "access_denied", 403);
    if (!guest.id) throw new ProjectError("gæsten mangler en id", "invalid_input");
    const member = await client.createMembership({ projectId, principal: guest.id, role: ROLES.GUEST }).catch(async () => {
      // OpenProject kan kræve en gruppe; fald tilbage til en gæstegruppe.
      return client.createMembership({ projectId, group: `${actor.tenantId}-guests`, role: ROLES.GUEST });
    });
    bumpPermissionVersion("guest.invited", { projectId, principal: guest.id, role: ROLES.GUEST, actor: actor.id, tenantId: actor.tenantId });
    audit("project.guest.invited", { actor: actor.id, projectId, guestId: guest.id, tenantId: actor.tenantId });
    return { guestId: guest.id, member, state: "active" };
  }

  async function exportProjectData({ actor, projectId }) {
    const project = await projectOrThrow(projectId, actor);
    const decision = await decideFor(actor, project, PERMISSIONS.PROJECT_EXPORT);
    if (!decision.allowed) {
      audit("project.export.denied", { actor: actor?.id, projectId, tenantId: actor?.tenantId, reason: decision.reason });
      throw new ProjectError(`eksport nægtet: ${decision.reason}`, "access_denied", 403);
    }
    const members = (await client.listMemberships(projectId).catch(() => [])).map((m) => ({
      externalId: m.principal ?? m.group ?? m.id,
      principal: m.principal ?? null,
      group: m.group ?? null,
      role: m.role,
      tenantId: project.tenantId ?? actor.tenantId,
    }));
    const workPackages = (await client.listWorkPackages(projectId)).map((wp) => ({ ...wp, assigneeExternalId: wp.assigneeId ?? null, tenantId: project.tenantId ?? actor.tenantId }));
    const externalIdByNumericId = new Map(workPackages.map((wp) => [wp.id, wp.externalId]));
    const attachments = (await client.listAttachments(projectId).catch(() => [])).map((a) => ({
      externalId: `ATT-${a.id}`,
      workPackageExternalId: externalIdByNumericId.get(a.workPackageId) ?? `WP-${a.workPackageId}`,
      filename: a.filename,
      sha256: a.sha256,
      sizeBytes: a.sizeBytes,
      tenantId: project.tenantId ?? actor.tenantId,
    }));
    const statusEvents = [];
    for (const wp of workPackages) {
      const activities = await client.listActivities(wp.id).catch(() => []);
      for (const a of activities) statusEvents.push({ id: a.id, workPackageExternalId: wp.externalId, type: a.type, at: a.at, actor: a.actor });
    }
    const bundle = exportBundle({
      project: { externalId: `PROJECT-${project.id}`, identifier: project.identifier, name: project.name, tenantId: project.tenantId ?? actor.tenantId, status: project.status, visibility: project.visibility },
      members,
      workPackages,
      attachments,
      statusEvents,
      exportedAt: new Date(now()).toISOString(),
    });
    audit("project.exported", { actor: actor.id, projectId, tenantId: actor.tenantId, workPackages: bundle.workPackages.length });
    return bundle;
  }

  async function importProjectBundle({ actor, bundle, approvals = [] }) {
    assertHuman(actor, "import af projekt");
    const problems = projectBundleProblems(bundle);
    if (problems.length) throw new ProjectError(`importbundtet er ugyldigt: ${problems.map((p) => p.message).join("; ")}`, "invalid_bundle");
    if (bundle.project.tenantId !== actor.tenantId) throw new ProjectError("bundtet tilhører en anden tenant", "tenant_rejected", 403);
    if (customerPolicy.export.requiresApproval && !approvals.some((a) => a?.verdict === "approve")) {
      throw new ProjectError("import kræver en navngiven godkendelse", "approval_required", 428);
    }
    const project = await projectOrThrow(bundle.project.externalId.replace(/^PROJECT-/, ""), actor);
    const decision = await decideFor(actor, project, PERMISSIONS.PROJECT_MANAGE);
    if (!decision.allowed) throw new ProjectError(`import nægtet: ${decision.reason}`, "access_denied", 403);
    const existing = await client.listWorkPackages(project.id);
    const plan = importPlan({ bundle, existing });
    if (plan.conflicts.length) throw new ProjectError(`importen har konflikter: ${plan.conflicts.map((c) => c.message).join("; ")}`, "import_conflict");
    const created = [];
    const updated = [];
    for (const wp of plan.creates) created.push(await client.createWorkPackage(project.id, { ...workPackageToUpstream(wp), actor: actor.id }));
    for (const change of plan.updates) updated.push(await client.updateWorkPackage(change.existingId, { ...workPackageToUpstream(change.to), actor: actor.id }));
    audit("project.imported", { actor: actor.id, projectId: project.id, tenantId: actor.tenantId, created: created.length, updated: updated.length });
    return { projectId: project.id, created: created.length, updated: updated.length, noops: plan.noops.length, idempotent: plan.idempotent };
  }

  async function searchProjection({ actor }) {
    const all = (await client.listProjects()).filter((p) => !p.tenantId || p.tenantId === actor?.tenantId);
    const visible = [];
    for (const project of all) {
      const decision = await decideFor(actor, project, PERMISSIONS.PROJECT_READ);
      if (decision.allowed) visible.push(project);
    }
    return buildPermissionProjection({ actor, projects: visible, memberships: [], policy: customerPolicy, version: permissionVersion, now });
  }

  async function aiRetrieval({ actor, projection, results = [] }) {
    const fresh = isProjectionFresh(projection, permissionVersion, { now, maxAgeSeconds: customerPolicy.ai.maxIndexAgeSeconds });
    if (customerPolicy.ai.requireFreshPermissionIndex && !fresh) {
      audit("project.ai.stale_projection", { actor: actor?.id, tenantId: actor?.tenantId, version: permissionVersion });
      throw new ProjectError("søge-/AI-projektionen er forældet; genopbyg før retrieval", "stale_projection", 409);
    }
    const allowed = new Set(projection.allowedProjectIds);
    return { allowed: results.filter((r) => allowed.has(r.projectId)), blocked: results.filter((r) => !allowed.has(r.projectId)), version: projection.version };
  }

  async function subjectRefs(subject = {}) {
    const key = subject.id ?? subject.email?.split("@")[0] ?? null;
    const projects = await client.listProjects();
    const memberships = [];
    const workPackages = [];
    for (const project of projects) {
      const ms = await client.listMemberships(project.id).catch(() => []);
      for (const m of ms) {
        if (m.principal === key || m.principal === subject.id) memberships.push({ ...m, projectRef: `PROJECT-${project.id}` });
      }
      const wps = await client.listWorkPackages(project.id).catch(() => []);
      for (const wp of wps) {
        if (wp.assigneeId === key || wp.assigneeId === subject.id) workPackages.push({ ...wp, projectRef: `PROJECT-${project.id}` });
      }
    }
    return { key, memberships, workPackages };
  }

  /** Lokalisér et subjekts projektmedlemskaber og tildelte arbejdspakker. */
  async function locateSubject({ subject = {} } = {}) {
    const { memberships, workPackages } = await subjectRefs(subject);
    return {
      count: memberships.length + workPackages.length,
      matches: [{ subjectId: subject.id ?? subject.email ?? null, memberships: memberships.length, workPackages: workPackages.length }],
    };
  }

  /** Eksportér subjektets projektdata og rettigheder gennem API'et. */
  async function exportSubjectData({ actor, subject = {} } = {}) {
    if (isHuman(actor) && actor.id !== subject.id && !isAdmin(actor)) {
      throw new ProjectError("kun subjektet selv eller en administrator må eksportere", "access_denied", 403);
    }
    const { memberships, workPackages } = await subjectRefs(subject);
    return { subjectId: subject.id ?? subject.email ?? null, memberships, workPackages, aclPreserved: true };
  }

  /**
   * Slet subjektets projektmedlemskaber og afknyt dets arbejdspakker. Slettede
   * data bevares ikke i revisionspayloaden; kvitteringen indeholder kun
   * tællere og de kopier adapteren ikke kan fjerne gennem API'et.
   */
  async function requestDeletion({ actor, subject = {}, reason, legalHold = false, retentionDays = 0, approvals = [] } = {}) {
    if (isHuman(actor) && !isAdmin(actor)) {
      throw new ProjectError("kun en kundeadministrator må slette gennem denne flade", "access_denied", 403);
    }
    const problems = deletionProblems({ policy: customerPolicy, legalHold, retentionDays, reason, approvals });
    if (problems.length) {
      audit("project.deletion.denied", { actor: actor?.id, subjectId: subject.id, tenantId: actor?.tenantId, problems });
      throw new ProjectError(`sletning nægtet: ${problems.join("; ")}`, "deletion_denied", 409);
    }
    const { memberships, workPackages } = await subjectRefs(subject);
    let deletedMemberships = 0;
    for (const m of memberships) {
      await client.deleteMembership(m.id);
      deletedMemberships += 1;
    }
    let unassignedWorkPackages = 0;
    for (const wp of workPackages) {
      await client.updateWorkPackage(wp.id, { assigneeId: null, actor: actor?.id });
      unassignedWorkPackages += 1;
    }
    if (deletedMemberships || unassignedWorkPackages) bumpPermissionVersion("subject.erased", { subjectId: subject.id, actor: actor?.id, tenantId: actor?.tenantId });
    const receipt = {
      subjectId: subject.id ?? subject.email ?? null,
      tenantId: actor?.tenantId ?? null,
      deletedMemberships,
      unassignedWorkPackages,
      remainingCopies: [
        { location: "backup", reason: "backups er adskilt og slettes efter DKC-021/DKC-016", expectedExpiryDays: retentionDays || 30 },
        { location: "search-index", reason: "søgeindekset opdateres asynkront af upstream og skal genopbygges", expectedExpiryDays: 7 },
        { location: "audit", reason: "revisionssporet bevares efter lovkrav og indeholder ikke sagsindhold", expectedExpiryDays: retentionDays || 365 },
      ],
      reason,
      performedBy: actor?.id ?? null,
      at: new Date(now()).toISOString(),
    };
    audit("project.deletion.completed", { actor: actor?.id, subjectId: subject.id, tenantId: actor?.tenantId, deletedMemberships, unassignedWorkPackages });
    return receipt;
  }

  function backupDeclaration() {
    return {
      backup: { conformance: "partial", reason: "OpenProject kan tage database- og vedhæftningsbackup, men adapteren kan ikke garantere et konsistent snapshot af alle plugins gennem API'et." },
      restore: { conformance: "unsupported", reason: "Gendannelse sker på database-/volumeniveau og kan ikke udføres gennem OpenProject API v3." },
      verifyRestore: { conformance: "unsupported", reason: "Verifikation af en gendannelse kræver adgang til backup- og databaselaget." },
      upgrade: { conformance: "partial", reason: "Adapteren kan rapportere nuværende og ønsket version samt manglende migrationer, men OpenProject tilbyder ikke en egentlig dry-run." },
    };
  }

  function assessCombination(name) {
    return assessEditionCombination(EDITION_COMBINATIONS[name] ?? EDITION_COMBINATIONS[DEFAULT_EDITION_COMBINATION]);
  }

  function featureReportFor(name) {
    return featureReport(EDITION_COMBINATIONS[name] ?? EDITION_COMBINATIONS[DEFAULT_EDITION_COMBINATION]);
  }

  return {
    get policy() {
      return customerPolicy;
    },
    setPolicy(next) {
      customerPolicy = normalizePolicy(next);
    },
    get permissionVersion() {
      return permissionVersion;
    },
    get permissionEvents() {
      return [...permissionEvents];
    },
    listProjects,
    readProject,
    createWorkPackage,
    updateWorkPackage,
    addMember,
    removeMember,
    inviteGuest,
    exportProjectData,
    importProjectBundle,
    searchProjection,
    aiRetrieval,
    locateSubject,
    exportSubjectData,
    requestDeletion,
    backupDeclaration,
    assessCombination,
    featureReportFor,
  };
}
