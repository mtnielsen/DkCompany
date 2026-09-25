/**
 * DKC-029 — semantik for support og sagsbehandling.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver beslutningerne:
 *
 *   - en helpdeskkilde bruger Zammad som system-of-record, en secretreference,
 *     mindst én kø og en vedhæftningspolitik der behandler bilag som ubetroet,
 *   - køer bærer klassifikation og en default-deny ACL,
 *   - politikken kræver tenantadskillelse, at eksterne kunder kun ser egne
 *     sager, at AI kun udkaster (en afsendelse er en separat godkendt handling),
 *     og at en vedhæftning aldrig må ændre rettigheder,
 *   - en sag har en append-only historik, og
 *   - et svarudkast er ubetroet, ikke-eksekverbart og bærer et digest der
 *     binder en godkendelse til det præcise indhold.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNamedHuman } from "../../conformance/src/architecture.mjs";

export const SOURCES_PATH = "helpdesk/sources.json";
export const POLICY_PATH = "helpdesk/policy.json";
export const CORPUS_PATH = "helpdesk/corpus/tickets.json";
export const REPORT_PATH = "helpdesk/report/helpdesk-report.json";
export const REPORT_DOC_PATH = "docs/helpdesk/helpdesk-report.md";

export const CLASSIFICATIONS = ["public", "internal", "personal", "special-category", "confidential"];
export const CLASSIFICATION_RANK = { public: 0, internal: 1, personal: 2, "special-category": 3, confidential: 4 };
export const TICKET_STATUSES = ["new", "open", "pending", "closed"];
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"];
export const CHANNELS = ["email", "web"];

function err(path, message) {
  return { path, message };
}

function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}

export function loadSources(root) {
  return readJson(root, SOURCES_PATH);
}
export function loadPolicy(root) {
  return readJson(root, POLICY_PATH);
}
export function loadCorpus(root) {
  return readJson(root, CORPUS_PATH);
}
export function loadAll(root) {
  return { sources: loadSources(root), policy: loadPolicy(root), corpus: loadCorpus(root) };
}

export function classificationRank(classification) {
  return CLASSIFICATION_RANK[classification] ?? 99;
}

/** Klarering for en principal; aldrig højere end principalens eksplicitte klarering. */
export function principalClearance(principal) {
  return principal?.clearance ?? "internal";
}

/** En ekstern kunde er en principal der kun må se sine egne sager. */
export function isExternalCustomer(principal) {
  if (!principal) return false;
  if (principal.kind === "customer" || principal.kind === "external") return true;
  const roles = new Set([...(principal.roles ?? []), ...(principal.groups ?? [])]);
  return roles.has("customer") || roles.has("external");
}

/* -------------------------------------------------------------------------- */
/* Helpdeskkilde                                                              */
/* -------------------------------------------------------------------------- */

export function helpdeskSourceProblems(data, { supportedTenants = null } = {}) {
  const problems = [];
  if (!data || typeof data !== "object") return [err("/", "helpdeskkildekontrakten er ikke et objekt")];
  if (!isNamedHuman(data.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "helpdeskkilden skal have et navngivet menneske som ejer"));
  }
  const ids = new Set();
  for (const [i, source] of (data.sources ?? []).entries()) {
    const at = `/sources/${i}`;
    if (ids.has(source.id)) problems.push(err(`${at}/id`, `kilden '${source.id}' er erklæret flere gange`));
    ids.add(source.id);
    if (source.type !== "zammad") problems.push(err(`${at}/type`, `kilden '${source.id}' skal være Zammad`));
    if (source.systemOfRecord !== "upstream") problems.push(err(`${at}/systemOfRecord`, `Zammad skal forblive system-of-record`));
    if (source.writeMode !== "adapter-mediated") problems.push(err(`${at}/writeMode`, `skrivning skal gå gennem adapteren`));
    if (!/^(vault|k8s|env|file|kms):/.test(source.secretRef ?? "")) {
      problems.push(err(`${at}/secretRef`, `kilden '${source.id}' skal bruge en secretreference, ikke en rå hemmelighed`));
    }
    if (supportedTenants && !supportedTenants.has(source.tenantId)) {
      problems.push(err(`${at}/tenantId`, `kilden '${source.id}' peger på den ukendte tenant '${source.tenantId}'`));
    }
    const queueIds = new Set();
    if (!(source.queues ?? []).length) problems.push(err(`${at}/queues`, `kilden '${source.id}' skal have mindst én kø`));
    for (const [j, queue] of (source.queues ?? []).entries()) {
      const qat = `${at}/queues/${j}`;
      if (queueIds.has(queue.id)) problems.push(err(`${qat}/id`, `køen '${queue.id}' er erklæret flere gange`));
      queueIds.add(queue.id);
      if (!CLASSIFICATIONS.includes(queue.classification)) problems.push(err(`${qat}/classification`, `køen '${queue.id}' mangler en gyldig klassifikation`));
      if (!(queue.sla?.firstResponseMinutes >= 1)) problems.push(err(`${qat}/sla/firstResponseMinutes`, `køen '${queue.id}' mangler en positiv første-svar-frist`));
      if (!(queue.sla?.resolutionMinutes >= queue.sla?.firstResponseMinutes)) {
        problems.push(err(`${qat}/sla/resolutionMinutes`, `køen '${queue.id}' skal have en løsningsfrist der er mindst første-svar-fristen`));
      }
      const acl = queue.acl ?? {};
      for (const key of ["readGroups", "readSubjects", "denyGroups", "denySubjects"]) {
        if (!Array.isArray(acl[key])) problems.push(err(`${qat}/acl/${key}`, `køen '${queue.id}' mangler listerne i sin ACL`));
      }
    }
    const attachment = source.attachmentPolicy ?? {};
    if (attachment.scanUntrusted !== true) problems.push(err(`${at}/attachmentPolicy/scanUntrusted`, `vedhæftninger skal scannes som ubetroet indhold`));
    if (attachment.executable !== false) problems.push(err(`${at}/attachmentPolicy/executable`, `en vedhæftning må ikke være eksekverbar`));
    if (!(attachment.maxBytes >= 1)) problems.push(err(`${at}/attachmentPolicy/maxBytes`, `vedhæftningsgrænsen skal være positiv`));
    const retention = source.retention ?? {};
    for (const key of ["mailDays", "attachmentDays", "indexDays"]) {
      if (!(retention[key] >= 1)) problems.push(err(`${at}/retention/${key}`, `retentionen '${key}' skal være positiv`));
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Helpdeskpolitik                                                            */
/* -------------------------------------------------------------------------- */

export function helpdeskPolicyProblems(policy) {
  const problems = [];
  if (!policy || typeof policy !== "object") return [err("/", "helpdeskpolitikken er ikke et objekt")];
  if (!isNamedHuman(policy.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "helpdeskpolitikken skal have et navngivet menneske som ejer"));
  }
  const auth = policy.authorization ?? {};
  if (auth.defaultDeny !== true) problems.push(err("/authorization/defaultDeny", "adgang skal være default-deny"));
  if (auth.tenantIsolation !== true) problems.push(err("/authorization/tenantIsolation", "tenants skal være isoleret"));
  if (auth.externalCustomerSeesOwnOnly !== true) problems.push(err("/authorization/externalCustomerSeesOwnOnly", "en ekstern kunde må kun se egne sager"));
  if (auth.queueAclBeforeContent !== true) problems.push(err("/authorization/queueAclBeforeContent", "kø-ACL skal afgøres før indhold"));
  if (auth.revalidateAtRead !== true) problems.push(err("/authorization/revalidateAtRead", "adgang skal revalideres ved læsning"));

  const ai = policy.ai ?? {};
  if (ai.classification !== true) problems.push(err("/ai/classification", "AI skal kunne klassificere"));
  if (ai.draftReplies !== true) problems.push(err("/ai/draftReplies", "AI skal kunne udkaste svar"));
  if (ai.sendingRequiresApproval !== true) problems.push(err("/ai/sendingRequiresApproval", "afsendelse skal kræve en godkendelse"));
  if (ai.sendingRequiresHumanApproval !== true) problems.push(err("/ai/sendingRequiresHumanApproval", "afsendelse skal kræve et menneskes godkendelse"));
  if (ai.approvalBinding !== "draft-digest") problems.push(err("/ai/approvalBinding", "godkendelsen skal bindes til udkastets digest"));
  if (ai.treatTicketContentAsUntrusted !== true) problems.push(err("/ai/treatTicketContentAsUntrusted", "sagsindhold skal behandles som ubetroet"));
  if (ai.toolActivationFromContent !== "denied") problems.push(err("/ai/toolActivationFromContent", "indhold må ikke kunne aktivere et værktøj"));
  if (ai.maxDraftAutonomy !== "draft-only") problems.push(err("/ai/maxDraftAutonomy", "AI'ens autonomi må højst være udkast"));

  const attachments = policy.attachments ?? {};
  if (attachments.treatAsUntrusted !== true) problems.push(err("/attachments/treatAsUntrusted", "vedhæftninger skal behandles som ubetroet"));
  if (attachments.scanForInjection !== true) problems.push(err("/attachments/scanForInjection", "vedhæftninger skal scannes for injektion"));
  if (attachments.executable !== false) problems.push(err("/attachments/executable", "en vedhæftning må ikke være eksekverbar"));
  if (attachments.mayChangePermissions !== false) problems.push(err("/attachments/mayChangePermissions", "en vedhæftning må aldrig ændre rettigheder"));
  if (attachments.quarantineSuspicious !== true) problems.push(err("/attachments/quarantineSuspicious", "mistænkelige vedhæftninger skal sættes i karantæne"));

  const approvals = policy.approvals ?? {};
  if (!Array.isArray(approvals.requiredFor) || !approvals.requiredFor.includes("ticket.reply.send")) {
    problems.push(err("/approvals/requiredFor", "afsendelse af et svar skal stå på listen over godkendelsespligtige handlinger"));
  }
  if (!(approvals.expiresInMinutes >= 1)) problems.push(err("/approvals/expiresInMinutes", "godkendelsens levetid skal være positiv"));
  if (approvals.selfApprovalForbidden !== true) problems.push(err("/approvals/selfApprovalForbidden", "selvgodkendelse skal forbydes"));

  const retention = policy.retention ?? {};
  for (const key of ["mailDays", "attachmentDays", "indexDays"]) {
    if (!(retention[key] >= 1)) problems.push(err(`/retention/${key}`, `retentionen '${key}' skal være positiv`));
  }
  if (retention.legalHoldBlocksDeletion !== true) problems.push(err("/retention/legalHoldBlocksDeletion", "et legal hold skal blokere sletning"));
  if (retention.deletionIsTombstone !== true) problems.push(err("/retention/deletionIsTombstone", "sletning skal efterlade en tombstone"));

  const history = policy.history ?? {};
  if (history.appendOnly !== true) problems.push(err("/history/appendOnly", "historikken skal være append-only"));
  if (history.immutable !== true) problems.push(err("/history/immutable", "historikken skal være uforanderlig"));
  if (history.recordsEveryTransition !== true) problems.push(err("/history/recordsEveryTransition", "hver tilstandsovergang skal registreres"));
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Sag                                                                        */
/* -------------------------------------------------------------------------- */

export function supportTicketProblems(ticket) {
  const problems = [];
  if (!ticket || typeof ticket !== "object") return [err("/", "sagen er ikke et objekt")];
  if (!ticket.id?.startsWith(`${ticket.sourceId}:`)) problems.push(err("/id", `sagens id '${ticket.id}' skal starte med kilde-id'et`));
  if (!TICKET_STATUSES.includes(ticket.status)) problems.push(err("/status", `sagen '${ticket.id}' har en ukendt status`));
  if (!TICKET_PRIORITIES.includes(ticket.priority)) problems.push(err("/priority", `sagen '${ticket.id}' har en ukendt prioritet`));
  if (!CHANNELS.includes(ticket.channel)) problems.push(err("/channel", `sagen '${ticket.id}' har en ukendt kanal`));
  if (!CLASSIFICATIONS.includes(ticket.classification)) problems.push(err("/classification", `sagen '${ticket.id}' mangler en gyldig klassifikation`));
  if (!ticket.requester?.subject) problems.push(err("/requester/subject", `sagen '${ticket.id}' mangler en rekvirent`));
  if (ticket.status === "closed" && !ticket.closedAt) problems.push(err("/closedAt", `en lukket sag skal have et lukketidspunkt`));
  if (ticket.status !== "closed" && ticket.closedAt) problems.push(err("/closedAt", `en åben sag må ikke have et lukketidspunkt`));
  const history = ticket.history ?? [];
  for (let i = 1; i < history.length; i += 1) {
    if (Date.parse(history[i].at) < Date.parse(history[i - 1].at)) {
      problems.push(err(`/history/${i}`, `historikken for '${ticket.id}' er ikke tidsordnet`));
    }
  }
  for (const [i, attachment] of (ticket.attachments ?? []).entries()) {
    if (attachment.executable !== false) problems.push(err(`/attachments/${i}/executable`, `vedhæftningen '${attachment.filename}' må ikke være eksekverbar`));
    if (attachment.mayChangePermissions !== false) problems.push(err(`/attachments/${i}/mayChangePermissions`, `vedhæftningen '${attachment.filename}' må ikke kunne ændre rettigheder`));
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Svarudkast                                                                 */
/* -------------------------------------------------------------------------- */

export function replyDraftProblems(draft) {
  const problems = [];
  if (!draft || typeof draft !== "object") return [err("/", "svarudkastet er ikke et objekt")];
  if (!/^[a-f0-9]{64}$/.test(draft.draftDigest ?? "")) problems.push(err("/draftDigest", "udkastet mangler et gyldigt digest"));
  if (draft.untrusted !== true || draft.executable !== false) problems.push(err("/untrusted", "udkastet skal være ubetroet og ikke-eksekverbart"));
  if (draft.toolActivationDenied !== true || (draft.toolProposals ?? []).length > 0) {
    problems.push(err("/toolProposals", "sagsindhold må aldrig aktivere et værktøj"));
  }
  if (draft.requiresApproval !== true) problems.push(err("/requiresApproval", "et svarudkast skal kræve godkendelse før afsendelse"));
  if (!draft.ticketId) problems.push(err("/ticketId", "udkastet mangler en sag"));
  if (!draft.tenantId) problems.push(err("/tenantId", "udkastet mangler en tenant"));
  if (draft.approvalId && !/^appr:[A-Za-z0-9._-]+$/.test(draft.approvalId)) problems.push(err("/approvalId", "godkendelses-id'et har en ugyldig form"));
  return problems;
}
