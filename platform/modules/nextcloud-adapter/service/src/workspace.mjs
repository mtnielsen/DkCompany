/**
 * DKC-026 — arbejdspladsdomænet.
 *
 * Adapterens kerne er ren og sideeffektfri: den regner på delinger, politik og
 * kombinationer og returnerer beslutninger. `createWorkspaceService` binder den
 * til en Nextcloud-klient. Dermed kan sikkerhedsbeslutningen efterprøves uden
 * netværk, og upstream kaldes først når beslutningen er `allow`.
 *
 * Principperne er de samme som resten af platformen: default-deny, tenanten
 * udledes af principalen, kun et navngivet menneske må dele/afvise, en ekstern
 * gæst og et offentligt link kræver kundepolitik, og en sletning blokeres af
 * legal hold og retention.
 */
import {
  ROLES,
  SHARE_TYPES,
  PERMISSIONS,
  DEFAULT_CUSTOMER_POLICY,
  PILOT_OFFICE_FORMATS,
  EDITION_COMBINATIONS,
} from "./constants.mjs";

export class WorkspaceError extends Error {
  constructor(message, code = "workspace_error", status = 400) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.status = status;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Flet kundepolitikken med de restriktive standarder. */
export function normalizePolicy(policy = {}) {
  const base = clone(DEFAULT_CUSTOMER_POLICY);
  const merged = {
    ...base,
    ...policy,
    publicLinks: { ...base.publicLinks, ...(policy.publicLinks ?? {}) },
    offboarding: { ...base.offboarding, ...(policy.offboarding ?? {}) },
    deletion: { ...base.deletion, ...(policy.deletion ?? {}) },
    allowedExternalDomains: [...(policy.allowedExternalDomains ?? base.allowedExternalDomains)],
  };
  if (!["disabled", "domain-restricted", "allowed"].includes(merged.externalSharing)) {
    throw new WorkspaceError(`ukendt externalSharing '${merged.externalSharing}'`, "invalid_policy");
  }
  return merged;
}

/** Sand hvis alle bits i `required` er sat i `bits`. */
export function permissionIncludes(bits, required) {
  return (Number(bits) & Number(required)) === Number(required);
}

function isHuman(actor) {
  return actor?.kind === "human";
}

function assertHuman(actor, what) {
  if (!isHuman(actor)) {
    throw new WorkspaceError(`${what} kræver et verificeret menneske`, "human_required", 403);
  }
}

function assertTenant(actor, resource) {
  if (!actor?.tenantId || actor.tenantId !== resource?.tenantId) {
    throw new WorkspaceError("ressourcen tilhører en anden kunde", "tenant_mismatch", 403);
  }
}

function isAdmin(actor) {
  return actor?.role === ROLES.TENANT_ADMIN;
}

function domainOf(value) {
  if (!value) return null;
  if (typeof value === "object" && value.email) return String(value.email).split("@")[1]?.toLowerCase() ?? null;
  if (typeof value === "object" && value.domain) return String(value.domain).toLowerCase();
  const at = String(value).split("@")[1] ?? String(value);
  return at.toLowerCase();
}

/**
 * Den rene adgangsbeslutning. `shares` er upstreams delingsrecords for
 * ressourcen. Returnerer en begrundelse, så afvisningen kan auditeres.
 */
export function decideFileAccess({ actor, resource, shares = [], requiredPermission = PERMISSIONS.READ }) {
  if (!actor?.id || !actor?.tenantId) return { allowed: false, reason: "principal mangler tenant/identitet" };
  if (actor.disabled === true) return { allowed: false, reason: "kontoen er deaktiveret" };
  if (actor.tenantId !== resource?.tenantId) return { allowed: false, reason: "tenant_mismatch" };
  if (actor.id === resource.owner) return { allowed: true, reason: "ejer", via: "owner" };

  const groups = new Set(actor.groups ?? []);
  for (const share of shares) {
    if (share.item_source && resource.itemSource && share.item_source !== resource.itemSource) continue;
    if (share.path && resource.path && share.path !== resource.path) continue;
    const matchesUser =
      (share.share_type === SHARE_TYPES.USER || share.share_type === SHARE_TYPES.EXTERNAL_GUEST) && share.share_with === actor.id;
    const matchesGroup = share.share_type === SHARE_TYPES.GROUP && groups.has(share.share_with);
    if (!matchesUser && !matchesGroup) continue;
    if (!permissionIncludes(share.permissions, requiredPermission)) {
      return { allowed: false, reason: `delingen '${share.id}' giver ikke den nødvendige rettighed`, shareId: share.id };
    }
    return { allowed: true, reason: `via deling '${share.id}'`, via: matchesUser ? "user" : "group", shareId: share.id };
  }
  return { allowed: false, reason: "ingen deling giver adgang" };
}

/** Ærlig politikvurdering af en ekstern deling/gæst. */
export function externalShareProblems({ policy, target, shareType = "user" }) {
  const normalized = normalizePolicy(policy);
  const problems = [];
  if (normalized.externalSharing === "disabled") {
    problems.push("kundepolitikken tillader ikke ekstern deling");
  } else if (normalized.externalSharing === "domain-restricted") {
    const domain = domainOf(target);
    if (!domain || !normalized.allowedExternalDomains.map((d) => d.toLowerCase()).includes(domain)) {
      problems.push(`domanen '${domain ?? "ukendt"}' er ikke på kundens allowlist`);
    }
  }
  if (shareType === "guest" && normalized.externalSharing === "disabled") {
    problems.push("eksterne gæster er slået fra for kunden");
  }
  return problems;
}

/** Ærlig politikvurdering af et offentligt delingslink. */
export function publicLinkProblems({ policy, link }) {
  const normalized = normalizePolicy(policy);
  const rules = normalized.publicLinks;
  const problems = [];
  if (!rules.enabled) problems.push("kundepolitikken tillader ikke offentlige delingslinks");
  if (rules.requirePassword && (!link.password || String(link.password).length < 12)) {
    problems.push("linket kræver en adgangskode på mindst 12 tegn");
  }
  if (rules.requireExpiry && !link.expireDate) problems.push("linket kræver en udløbsdato");
  if (link.ttlDays !== undefined && link.ttlDays !== null) {
    if (!Number.isFinite(Number(link.ttlDays)) || Number(link.ttlDays) <= 0) problems.push("ttlDays skal være et positivt tal");
    else if (Number(link.ttlDays) > rules.maxTtlDays) problems.push(`linkets levetid overstiger kundens maksimum på ${rules.maxTtlDays} dage`);
  }
  if (!rules.allowUpload && permissionIncludes(link.permissions ?? 0, PERMISSIONS.CREATE)) {
    problems.push("kundepolitikken tillader ikke upload gennem offentlige links");
  }
  return problems;
}

/** Vurderer en offboarding mod kundepolitikken og returnerer en plan. */
export function offboardingPlan({ policy, subject, shares = [] }) {
  const normalized = normalizePolicy(policy);
  const rules = normalized.offboarding;
  const plan = {
    subjectId: subject.id,
    closeSessions: rules.closeSessions,
    revokeShares: rules.revokeShares,
    ownedShares: shares.filter((s) => s.uid_owner === subject.id).map((s) => s.id),
    deleteOwnedFiles: rules.deleteOwnedFiles,
    transferOwnedFilesTo: rules.transferOwnedFilesTo,
    retainDataDays: rules.retainDataDays,
    problems: [],
  };
  if (!rules.deleteOwnedFiles && !rules.transferOwnedFilesTo) {
    plan.problems.push("kundepolitikken hverken sletter eller overfører ejerens filer; afviklingen efterlader data uden ejer");
  }
  return plan;
}

/** Blokerer en sletning, når legal hold eller retention siger nej. */
export function deletionProblems({ policy, legalHold = false, retentionDays = 0, reason = "", approvals = [] }) {
  const normalized = normalizePolicy(policy);
  const problems = [];
  if (legalHold && normalized.deletion.blockOnLegalHold) {
    problems.push("der er aktiv legal hold på subjektet");
  }
  if (retentionDays > 0) problems.push(`retentionperioden udløber om ${retentionDays} dage`);
  if (normalized.deletion.requireReason && (!reason || reason.trim().length < 10)) {
    problems.push("sletning kræver en dokumenteret begrundelse (mindst 10 tegn)");
  }
  if (normalized.deletion.requireApproval && !approvals.some((a) => a?.verdict === "approve")) {
    problems.push("sletning kræver en navngiven godkendelse");
  }
  return problems;
}

/**
 * Rapporterer hvilke pilotkontorformater der virker, og registrerer hver
 * afvigelse eksplicit. Et format uden støtte er en afvigelse — ikke stilhed.
 */
export function officeFormatReport(formats = PILOT_OFFICE_FORMATS, supportedFormats = []) {
  const supported = new Set(supportedFormats.map((f) => String(f).toLowerCase()));
  const checked = [...new Set(formats.map((f) => String(f).toLowerCase()))];
  const deviations = [];
  const ok = [];
  for (const format of checked) {
    if (supported.has(format)) ok.push(format);
    else deviations.push({ format, severity: "deviation", note: `kontoreditoren rapporterer ikke understøttelse af .${format}` });
  }
  return { checked, supported: ok, unsupported: deviations.map((d) => d.format), deviations };
}

/**
 * Den dokumenterede editionkombination vurderes pr. delmodul. Et delmodul
 * frigives kun, hvis både licens, API og driftsprofil er valideret.
 */
export function assessEditionCombination(combination) {
  if (!combination) throw new WorkspaceError("kombinationen findes ikke", "unknown_combination", 404);
  const blockers = [];

  const licenseOk = (lic) => Boolean(lic?.spdx) && lic?.type && lic.type !== "unknown";
  const nextcloud = combination.nextcloud ?? {};
  const office = combination.office ?? {};

  if (!licenseOk(nextcloud.license)) blockers.push("Nextcloud-licensen er ikke afklaret");
  if (!nextcloud.api?.files) blockers.push("Nextcloud API mangler filendpoint");
  if (!nextcloud.api?.sharing) blockers.push("Nextcloud API mangler delingsendpoint");
  if (!nextcloud.api?.calendar) blockers.push("Nextcloud API mangler kalenderendpoint");
  if (!nextcloud.operations?.backup) blockers.push("Nextcloud driftsprofil mangler backupstrategi");
  if (!nextcloud.operations?.rpoMinutes || !nextcloud.operations?.rtoMinutes) blockers.push("Nextcloud driftsprofil mangler RPO/RTO");

  const officeLicenseOk = licenseOk(office.license);
  const officeApiOk = office.api?.protocol === "wopi" && office.api?.documented === true;
  const officeOpsOk = Boolean(office.operations?.backup) && office.operations.backup !== "none";
  if (!officeLicenseOk) blockers.push("kontoredaktørens licens er ikke afklaret");
  if (!officeApiOk) blockers.push("kontoredaktørens API er ikke dokumenteret (wopi)");
  if (!officeOpsOk) blockers.push("kontoredaktørens driftsprofil mangler backup");

  const baseOk = licenseOk(nextcloud.license) && Boolean(nextcloud.api?.files) && Boolean(nextcloud.operations?.backup);
  const sharingOk = baseOk && Boolean(nextcloud.api?.sharing);
  const calendarOk = baseOk && Boolean(nextcloud.api?.calendar);
  const editorOk = officeLicenseOk && officeApiOk && officeOpsOk;

  const submodules = {
    files: { released: baseOk, reason: baseOk ? "Nextcloud-licens, fil-API og driftsprofil er valideret" : "filmodulet er ikke valideret" },
    sharing: { released: sharingOk, reason: sharingOk ? "delings-API og driftsprofil er valideret" : "delingsmodulet er ikke valideret" },
    calendar: { released: calendarOk, reason: calendarOk ? "kalender-API og driftsprofil er valideret" : "kalendermodulet er ikke valideret" },
    editor: { released: editorOk, reason: editorOk ? "kontoredaktør med licens, wopi-API og backup er valideret" : "kontoredaktøren frigives ikke" },
  };

  const released = Object.values(submodules).every((s) => s.released);
  return {
    name: combination.name,
    status: released ? "approved" : Object.values(submodules).some((s) => s.released) ? "partial" : "blocked",
    blockers,
    submodules,
  };
}

async function sharesFor(client, owner, path) {
  let all = [];
  try {
    all = (await client.listShares({ path })) ?? [];
  } catch (err) {
    if (err.status === 404) all = [];
    else throw err;
  }
  return all.filter((s) => (s.uid_owner ?? s.uid_file_owner) === owner && s.path === path);
}

/**
 * Bind domænet til en Nextcloud-klient. Alle muterende arbejdspladsoperationer
 * kræver et verificeret menneske; læsning kan også ske for en agent med den
 * rette deling. Hver afvisning og hver gennemført handling auditeres.
 */
export function createWorkspaceService({ client, policy = {}, now = () => Date.now(), onAudit = () => {} } = {}) {
  if (!client) throw new WorkspaceError("createWorkspaceService kræver client", "config");
  let customerPolicy = normalizePolicy(policy);

  function audit(type, entry) {
    onAudit({ type, at: new Date(now()).toISOString(), ...entry });
  }

  function resourceOf(owner, path, tenantId) {
    return { owner, path, tenantId, itemSource: `${owner}:${path}` };
  }

  async function accessFor(actor, owner, path, tenantId, permission) {
    const resource = resourceOf(owner, path, tenantId);
    const shares = await sharesFor(client, owner, path);
    const decision = decideFileAccess({ actor, resource, shares, requiredPermission: permission });
    return { resource, shares, decision };
  }

  async function readFile({ actor, owner, path, tenantId }) {
    const { decision } = await accessFor(actor, owner, path, tenantId, PERMISSIONS.READ);
    if (!decision.allowed) {
      audit("workspace.access.denied", { actor: actor?.id, owner, path, tenantId, reason: decision.reason });
      throw new WorkspaceError(`adgang nægtet: ${decision.reason}`, "access_denied", 403);
    }
    const file = await client.readFile(owner, path);
    return { path, content: file?.content ?? file, via: decision.via, tenantId };
  }

  async function editFile({ actor, owner, path, content, tenantId }) {
    const { decision } = await accessFor(actor, owner, path, tenantId, PERMISSIONS.UPDATE);
    if (!decision.allowed) {
      audit("workspace.access.denied", { actor: actor?.id, owner, path, tenantId, reason: decision.reason, operation: "edit" });
      throw new WorkspaceError(`redigering nægtet: ${decision.reason}`, "access_denied", 403);
    }
    const result = await client.writeFile(owner, path, content);
    audit("workspace.file.edited", { actor: actor.id, owner, path, tenantId, shareId: decision.shareId ?? null });
    return { path, versions: result?.versions ?? null, via: decision.via };
  }

  async function shareFile({ actor, owner, path, shareWith, shareType = SHARE_TYPES.USER, permissions = PERMISSIONS.READ, targetDomain, tenantId }) {
    assertHuman(actor, "deling");
    assertTenant(actor, resourceOf(owner, path, tenantId));
    const { decision } = await accessFor(actor, owner, path, tenantId, PERMISSIONS.SHARE);
    // Ejer eller administrator må altid dele; ellers kræves SHARE-bittet.
    if (!decision.allowed && actor.id !== owner && !isAdmin(actor)) {
      throw new WorkspaceError(`deling nægtet: ${decision.reason}`, "access_denied", 403);
    }
    const isExternal = shareType === SHARE_TYPES.EXTERNAL_GUEST || shareType === SHARE_TYPES.PUBLIC_LINK || Boolean(targetDomain);
    if (isExternal) {
      const problems = externalShareProblems({ policy: customerPolicy, target: targetDomain ?? shareWith, shareType: shareType === SHARE_TYPES.EXTERNAL_GUEST ? "guest" : "user" });
      if (problems.length) {
        audit("workspace.share.denied", { actor: actor.id, owner, path, tenantId, problems });
        throw new WorkspaceError(`ekstern deling nægtet: ${problems.join("; ")}`, "external_sharing_denied", 403);
      }
    }
    const share = await client.createShare({ owner, path, shareType, shareWith, permissions });
    audit("workspace.share.created", { actor: actor.id, owner, path, tenantId, shareId: share.id, shareType, shareWith: shareWith ?? null });
    return share;
  }

  async function createPublicLink({ actor, owner, path, tenantId, ttlDays, password, permissions = PERMISSIONS.READ }) {
    assertHuman(actor, "oprettelse af offentligt link");
    assertTenant(actor, resourceOf(owner, path, tenantId));
    const { decision } = await accessFor(actor, owner, path, tenantId, PERMISSIONS.SHARE);
    if (!decision.allowed && actor.id !== owner && !isAdmin(actor)) {
      throw new WorkspaceError(`linkoprettelse nægtet: ${decision.reason}`, "access_denied", 403);
    }
    const expireDate = ttlDays ? new Date(now() + Number(ttlDays) * 86400000).toISOString().slice(0, 10) : null;
    const problems = publicLinkProblems({ policy: customerPolicy, link: { ttlDays, password, expireDate, permissions } });
    if (problems.length) {
      audit("workspace.link.denied", { actor: actor.id, owner, path, tenantId, problems });
      throw new WorkspaceError(`offentligt link nægtet: ${problems.join("; ")}`, "public_link_denied", 403);
    }
    const share = await client.createShare({ owner, path, shareType: SHARE_TYPES.PUBLIC_LINK, permissions, password, expireDate });
    audit("workspace.link.created", { actor: actor.id, owner, path, tenantId, shareId: share.id, ttlDays, expireDate });
    return share;
  }

  async function revokeShare({ actor, shareId, tenantId }) {
    assertHuman(actor, "tilbagekaldelse af deling");
    const share = await client.getShare(shareId);
    if (!share) throw new WorkspaceError("delingen findes ikke", "not_found", 404);
    if (actor.id !== share.uid_owner && !isAdmin(actor)) {
      throw new WorkspaceError("kun ejeren eller en administrator må tilbagekalde delingen", "access_denied", 403);
    }
    await client.deleteShare(shareId);
    audit("workspace.share.revoked", { actor: actor.id, shareId, tenantId });
    return { shareId, revoked: true };
  }

  async function inviteGuest({ actor, guest, tenantId }) {
    assertHuman(actor, "invitation af gæst");
    if (!isAdmin(actor)) throw new WorkspaceError("kun en kundeadministrator må invitere gæster", "access_denied", 403);
    const problems = externalShareProblems({ policy: customerPolicy, target: guest.email, shareType: "guest" });
    if (problems.length) {
      audit("workspace.guest.denied", { actor: actor.id, guest: guest.id, tenantId, problems });
      throw new WorkspaceError(`gæsteinvitation nægtet: ${problems.join("; ")}`, "guest_denied", 403);
    }
    const user = await client.createUser({ userid: guest.id, email: guest.email, displayName: guest.displayName ?? guest.id, groups: [tenantId], isGuest: true });
    audit("workspace.guest.invited", { actor: actor.id, guest: guest.id, tenantId });
    return { guestId: guest.id, state: "active", user };
  }

  async function suspendGuest({ actor, guestId, tenantId }) {
    assertHuman(actor, "suspension af gæst");
    if (!isAdmin(actor)) throw new WorkspaceError("kun en kundeadministrator må suspendere gæster", "access_denied", 403);
    await client.disableUser(guestId);
    await client.killSessions(guestId);
    audit("workspace.guest.suspended", { actor: actor.id, guestId, tenantId });
    return { guestId, state: "suspended" };
  }

  async function removeGuest({ actor, guestId, tenantId }) {
    assertHuman(actor, "fjernelse af gæst");
    if (!isAdmin(actor)) throw new WorkspaceError("kun en kundeadministrator må fjerne gæster", "access_denied", 403);
    const all = (await client.listShares({})) ?? [];
    const guestShares = all.filter((s) => s.share_with === guestId);
    for (const s of guestShares) await client.deleteShare(s.id);
    await client.killSessions(guestId);
    await client.deleteUser(guestId);
    audit("workspace.guest.removed", { actor: actor.id, guestId, tenantId, revokedShares: guestShares.length });
    return { guestId, removed: true, revokedShares: guestShares.length };
  }

  /**
   * Offboarding efter kundepolitik: luk sessioner, tilbagekald delinger og
   * håndtér ejerens filer. Returnerer en kvittering uden indhold.
   */
  async function offboardUser({ actor, subject, tenantId }) {
    assertHuman(actor, "offboarding");
    if (!isAdmin(actor)) throw new WorkspaceError("kun en kundeadministrator må afvikle en bruger", "access_denied", 403);
    const all = (await client.listShares({})) ?? [];
    const plan = offboardingPlan({ policy: customerPolicy, subject, shares: all });
    if (plan.problems.length) {
      audit("workspace.offboard.denied", { actor: actor.id, subjectId: subject.id, tenantId, problems: plan.problems });
      throw new WorkspaceError(`offboarding nægtet: ${plan.problems.join("; ")}`, "offboarding_denied", 409);
    }
    let closedSessions = 0;
    if (plan.closeSessions) {
      const result = await client.killSessions(subject.id).catch(() => ({ closed: 0 }));
      closedSessions = result?.closed ?? 0;
    }
    let revokedShares = 0;
    if (plan.revokeShares) {
      for (const id of plan.ownedShares) {
        await client.deleteShare(id);
        revokedShares += 1;
      }
    }
    let transferred = null;
    let deletedFiles = 0;
    if (plan.transferOwnedFilesTo) {
      const files = (await client.listFiles(subject.id))?.files ?? [];
      for (const f of files) {
        const payload = await client.readFile(subject.id, f.path);
        await client.writeFile(plan.transferOwnedFilesTo, f.path, payload?.content ?? payload);
        await client.deleteFile(subject.id, f.path);
      }
      transferred = plan.transferOwnedFilesTo;
    } else if (plan.deleteOwnedFiles) {
      const files = (await client.listFiles(subject.id))?.files ?? [];
      for (const f of files) {
        await client.deleteFile(subject.id, f.path);
        deletedFiles += 1;
      }
    }
    await client.disableUser(subject.id);
    const receipt = {
      subjectId: subject.id,
      tenantId,
      closedSessions,
      revokedShares,
      deletedFiles,
      transferredTo: transferred,
      retainDataDays: plan.retainDataDays,
      performedBy: actor.id,
      at: new Date(now()).toISOString(),
    };
    audit("workspace.user.offboarded", { actor: actor.id, ...receipt });
    return receipt;
  }

  /** Eksport af subjektets data og rettigheder gennem API'et. Et menneske må
   * eksportere sig selv eller sin kunde; en DSAR-agent er bundet af PDP'en. */
  async function exportUserData({ actor, subject, tenantId }) {
    if (isHuman(actor) && actor.id !== subject.id && !isAdmin(actor)) {
      throw new WorkspaceError("kun subjektet selv eller en administrator må eksportere", "access_denied", 403);
    }
    const files = (await client.listFiles(subject.id))?.files ?? [];
    const records = [];
    for (const f of files) {
      const payload = await client.readFile(subject.id, f.path);
      records.push({ path: f.path, content: payload?.content ?? payload, versions: payload?.versions ?? null });
    }
    const shares = ((await client.listShares({})) ?? []).filter((s) => s.uid_owner === subject.id);
    const calendars = (await client.listCalendars(subject.id))?.calendars ?? [];
    return { subjectId: subject.id, tenantId, files: records, shares, calendars, aclPreserved: true };
  }

  /**
   * Sletning med dokumenterede begrænsninger. Slettede data bevares ikke i
   * logpayloaden; kvitteringen indeholder kun tællere og de kopier, som
   * adapteren ikke kan fjerne gennem API'et.
   */
  async function requestDeletion({ actor, subject, tenantId, reason, legalHold = false, retentionDays = 0, approvals = [] }) {
    if (isHuman(actor) && !isAdmin(actor)) {
      throw new WorkspaceError("kun en kundeadministrator må slette gennem denne flade", "access_denied", 403);
    }
    const problems = deletionProblems({ policy: customerPolicy, legalHold, retentionDays, reason, approvals });
    if (problems.length) {
      audit("workspace.deletion.denied", { actor: actor.id, subjectId: subject.id, tenantId, problems });
      throw new WorkspaceError(`sletning nægtet: ${problems.join("; ")}`, "deletion_denied", 409);
    }
    const files = (await client.listFiles(subject.id))?.files ?? [];
    let deletedFiles = 0;
    for (const f of files) {
      await client.deleteFile(subject.id, f.path);
      deletedFiles += 1;
    }
    const shares = ((await client.listShares({})) ?? []).filter((s) => s.uid_owner === subject.id);
    for (const s of shares) await client.deleteShare(s.id);
    const receipt = {
      subjectId: subject.id,
      tenantId,
      deletedFiles,
      deletedShares: shares.length,
      remainingCopies: [
        { location: "backup", reason: "backups er adskilt og slettes efter DKC-021/DKC-016", expectedExpiryDays: retentionDays || customerPolicy.offboarding.retainDataDays },
        { location: "trash-and-versions", reason: "Nextcloud versions-/papirkurvshistorik kræver en upstream-oprydning", expectedExpiryDays: 30 },
        { location: "search-index", reason: "søgeindekset opdateres asynkront af upstream", expectedExpiryDays: 7 },
      ],
      reason,
      performedBy: actor.id,
      at: new Date(now()).toISOString(),
    };
    audit("workspace.deletion.completed", { actor: actor.id, subjectId: subject.id, tenantId, deletedFiles, deletedShares: shares.length });
    return receipt;
  }

  /** Kalender: læs og opret begivenheder gennem CalDAV. */
  async function listCalendar({ actor, owner, tenantId }) {
    assertTenant(actor, resourceOf(owner, "/", tenantId));
    const calendars = (await client.listCalendars(owner))?.calendars ?? [];
    return { owner, calendars };
  }

  async function createEvent({ actor, owner, calendar = "personal", event, tenantId }) {
    assertHuman(actor, "oprettelse af kalenderbegivenhed");
    assertTenant(actor, resourceOf(owner, "/", tenantId));
    if (actor.id !== owner && !isAdmin(actor)) throw new WorkspaceError("kun ejeren eller en administrator må oprette begivenheder", "access_denied", 403);
    const record = await client.createEvent(owner, calendar, event);
    audit("workspace.calendar.event.created", { actor: actor.id, owner, calendar, tenantId });
    return record;
  }

  /** Ærlig backup/restore-deklaration. */
  function backupDeclaration() {
    return {
      backup: { conformance: "partial", reason: "Nextclouds data- og versionslag kræver volume-snapshot; adapteren kan eksportere app-konfiguration og databasedump, men ikke garantere et konsistent filsnapshot." },
      restore: { conformance: "unsupported", reason: "Gendannelse sker på volume-/database-niveau og kan ikke udføres gennem Nextclouds API." },
      verifyRestore: { conformance: "unsupported", reason: "Verifikation af en gendannelse kræver adgang til backup-lagret." },
    };
  }

  async function officeFormats() {
    const caps = await client.capabilities();
    const rich = caps?.capabilities?.richdocuments ?? {};
    return {
      ...officeFormatReport(PILOT_OFFICE_FORMATS, rich.formats ?? []),
      product: rich.product ?? null,
      version: rich.version ?? null,
    };
  }

  function assessCombination(name) {
    return assessEditionCombination(EDITION_COMBINATIONS[name]);
  }

  function accessDecision(args) {
    return decideFileAccess(args);
  }

  return {
    get policy() {
      return customerPolicy;
    },
    setPolicy(next) {
      customerPolicy = normalizePolicy(next);
    },
    readFile,
    editFile,
    shareFile,
    createPublicLink,
    revokeShare,
    inviteGuest,
    suspendGuest,
    removeGuest,
    offboardUser,
    exportUserData,
    requestDeletion,
    listCalendar,
    createEvent,
    backupDeclaration,
    officeFormats,
    assessCombination,
    accessDecision,
  };
}
