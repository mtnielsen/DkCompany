#!/usr/bin/env node
/**
 * DKC-029 — fokuseret kontrol af support og sagsbehandling.
 *
 * Kontrollerer offline at:
 *   - kilder og politik validerer mod skema og beslutningssemantik,
 *   - en sag går fra modtagelse til lukning med en append-only historik,
 *   - et AI-udkast ikke sendes uden en gyldig, ændringsbunden godkendelse,
 *   - en vedhæftning med et skadeligt injektionsforsøg ikke kan ændre
 *     rettigheder (og ikke bliver et værktøjskald),
 *   - en ekstern kunde kun ser egne sager, og tenants er isoleret,
 *   - eksport, sletning og legal hold virker for mails, bilag og indeks, og
 *   - en backup/gendannelse bevarer sager og historik.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import {
  loadAll,
  helpdeskSourceProblems,
  helpdeskPolicyProblems,
  supportTicketProblems,
  replyDraftProblems,
} from "./model.mjs";
import { FileHelpdeskStore } from "./store.mjs";
import { createZammadClient } from "./zammad.mjs";
import { createMockZammad } from "./mock-zammad.mjs";
import { receiveInbound } from "./intake.mjs";
import { createDeterministicHelpdeskModel, draftReply } from "./classification.mjs";
import { recordReplyApproval, sendReply, recordCloseApproval, closeTicket } from "./approval-gate.mjs";
import { decideTicketAccess, filterAuthorizedTickets } from "./permissions.mjs";
import { ingestAttachment, attachToTicket } from "./attachments.mjs";
import { exportSubject, deleteSubject, retentionStatus } from "./retention.mjs";
import { buildHold } from "../../retention/src/holds.mjs";
import { digestOf } from "../../runtime/src/digest.mjs";

export const REPORT_GENERATED_AT = "2026-03-01T00:00:00Z";

const PRINCIPALS = {
  ada: { kind: "customer", id: "oidc|ada.acme", tenantId: "acme", groups: ["acme"], roles: ["customer"], clearance: "internal", email: "ada@acme.example" },
  ben: { kind: "customer", id: "oidc|ben.acme", tenantId: "acme", groups: ["acme"], roles: ["customer"], clearance: "internal", email: "ben@acme.example" },
  gus: { kind: "customer", id: "oidc|gus.globex", tenantId: "globex", groups: ["globex"], roles: ["customer"], clearance: "internal", email: "gus@globex.example" },
  support: { kind: "human", id: "oidc|sara.support", tenantId: "acme", groups: ["acme", "support"], roles: ["support-agent"], clearance: "internal" },
  billing: { kind: "human", id: "oidc|bea.billing", tenantId: "acme", groups: ["acme", "billing"], roles: ["billing-agent"], clearance: "personal" },
  security: { kind: "human", id: "oidc|seb.security", tenantId: "acme", groups: ["acme", "security"], roles: ["security-agent"], clearance: "confidential" },
  approver: { kind: "human", id: "oidc|mia.manager", tenantId: "acme", groups: ["acme", "support"], roles: ["support-manager"], clearance: "confidential" },
};

/** Start mock-upstream, butik og gennemfør alle indgående beskeder. */
export async function setupHelpdesk({ at = REPORT_GENERATED_AT } = {}) {
  const all = loadAll(repoRoot);
  const mock = createMockZammad({ corpus: all.corpus });
  const port = await mock.listen(0);
  const store = FileHelpdeskStore.open(mkdtempSync(join(tmpdir(), "dkc029-store-")));
  const clients = {};
  for (const source of all.sources.sources) {
    const token = all.corpus.tenants[source.tenantId]?.token ?? "missing";
    clients[source.id] = createZammadClient({ baseUrl: `http://127.0.0.1:${port}`, token });
  }
  const received = [];
  for (const source of all.sources.sources) {
    const tenantBlock = all.corpus.tenants[source.tenantId];
    for (const inbound of tenantBlock.inbound ?? []) {
      received.push(await receiveInbound({ store, source, client: clients[source.id], payload: inbound, model: createDeterministicHelpdeskModel(), policy: all.policy, at }));
    }
  }
  return {
    all,
    mock,
    store,
    clients,
    received,
    close: async () => {
      await mock.close();
      rmSync(store.root, { recursive: true, force: true });
    },
  };
}

function scenario(id, fields) {
  return { id, problems: [], ...fields };
}

/** Kør hele den deterministiske kontrol. */
export async function runHelpdeskCheck(root = repoRoot) {
  const problems = [];
  const all = loadAll(root);
  for (const e of helpdeskSourceProblems(all.sources)) problems.push(`sources${e.path}: ${e.message}`);
  for (const e of helpdeskPolicyProblems(all.policy)) problems.push(`policy${e.path}: ${e.message}`);
  const report = await buildHelpdeskReport(root);
  if (report.draftSample) for (const e of replyDraftProblems(report.draftSample)) problems.push(`draft-sample${e.path}: ${e.message}`);
  for (const s of report.scenarios) for (const p of s.problems ?? []) problems.push(`scenario '${s.id}': ${p}`);
  return { ok: problems.length === 0, problems, report };
}

/** Byg den deterministiske rapport med alle scenarier. */
export async function buildHelpdeskReport(root = repoRoot) {
  const { all, store, clients, received, close } = await setupHelpdesk();
  const scenarios = [];
  let draftSample = null;
  let exportSample = null;
  let deletionSample = null;
  let backup = { ok: false };
  try {
    const acmeSource = all.sources.sources.find((s) => s.id === "zammad-acme");
    const globexSource = all.sources.sources.find((s) => s.id === "zammad-globex");
    const allTickets = store.listTickets();
    for (const ticket of allTickets) {
      for (const e of supportTicketProblems(ticket)) scenariosProblem(scenarios, "ticket-schema", `${ticket.id}${e.path}: ${e.message}`);
    }
    const adaTickets = store.listTickets({ tenantId: "acme" }).filter((t) => t.requester?.subject === PRINCIPALS.ada.id);
    const loginTicket = adaTickets.find((t) => t.subject.includes("logge ind"));
    const billingTicket = store.listTickets({ tenantId: "acme" }).find((t) => t.requester?.subject === PRINCIPALS.ben.id);
    const securityTicket = adaTickets.find((t) => t.queueId === "security");

    // 0) Indgående → spejling med historik.
    {
      const problems = [];
      if (received.length !== (all.corpus.tenants.acme.inbound.length + all.corpus.tenants.globex.inbound.length)) problems.push("ikke alle indgående beskeder blev til sager");
      if (received.some((r) => r.deduplicated)) problems.push("en indgående besked blev fejlagtigt dedupliceret");
      if (!loginTicket) problems.push("login-sagen blev ikke oprettet");
      if (loginTicket && !store.listHistory(loginTicket.id).some((e) => e.type === "ticket.received")) problems.push("historikken mangler modtagelse");
      scenarios.push(scenario("intake-mirrored", { principal: "oidc|ada.acme", tenant: "acme", visible: allTickets.map((t) => t.id), hidden: [], problems }));
    }

    // 1) En sag går fra modtagelse til lukning med historik.
    {
      const problems = [];
      const draft = await draftReply({ ticket: loginTicket, model: createDeterministicHelpdeskModel(), policy: all.policy, now: REPORT_GENERATED_AT });
      store.saveDraft(draft, { at: REPORT_GENERATED_AT });
      const approval = recordReplyApproval({ store, draft, approver: PRINCIPALS.approver, now: REPORT_GENERATED_AT, policy: all.policy });
      await sendReply({ store, client: clients[acmeSource.id], ticketId: loginTicket.id, draftId: draft.id, principal: PRINCIPALS.support, approvalId: approval.id, now: REPORT_GENERATED_AT, policy: all.policy });
      const closeApproval = recordCloseApproval({ store, ticket: store.getTicket(loginTicket.id), approver: PRINCIPALS.approver, now: REPORT_GENERATED_AT, policy: all.policy });
      const closed = await closeTicket({ store, client: clients[acmeSource.id], ticketId: loginTicket.id, principal: PRINCIPALS.support, approvalId: closeApproval.id, now: REPORT_GENERATED_AT, policy: all.policy });
      const history = store.listHistory(loginTicket.id).map((e) => e.type);
      for (const expected of ["ticket.received", "ticket.classified", "ticket.queued", "ticket.reply_sent", "ticket.closed"]) {
        if (!history.includes(expected)) problems.push(`historikken mangler '${expected}'`);
      }
      if (closed.status !== "closed" || !closed.closedAt) problems.push("sagen blev ikke lukket korrekt");
      if(history.indexOf("ticket.reply_sent") > history.lastIndexOf("ticket.closed")) problems.push("afsendelse blev registreret efter lukning");
      scenarios.push(scenario("intake-to-closure", { principal: "oidc|sara.support", tenant: "acme", visible: [closed.id], hidden: [], problems, history }));
    }

    // 2) AI-udkast sendes ikke uden den gældende godkendelse.
    {
      const problems = [];
      const draft = await draftReply({ ticket: billingTicket, model: createDeterministicHelpdeskModel(), policy: all.policy, now: REPORT_GENERATED_AT });
      store.saveDraft(draft, { at: REPORT_GENERATED_AT });
      draftSample = draft;
      let deniedWithoutApproval = false;
      try {
        await sendReply({ store, client: clients[acmeSource.id], ticketId: billingTicket.id, draftId: draft.id, principal: PRINCIPALS.billing, approvalId: null, now: REPORT_GENERATED_AT, policy: all.policy });
      } catch (err) {
        deniedWithoutApproval = err.code === "approval_required";
      }
      if (!deniedWithoutApproval) problems.push("et udkast blev sendt uden godkendelse");
      const approval = recordReplyApproval({ store, draft, approver: PRINCIPALS.approver, now: REPORT_GENERATED_AT, policy: all.policy });
      // Ændr udkastet: den gamle godkendelse må ikke længere gælde.
      const tampered = { ...draft, id: "draft:tampered", draftDigest: digestOf({ ticketId: billingTicket.id, tenantId: draft.tenantId, body: "ændret" }) };
      store.saveDraft(tampered, { at: REPORT_GENERATED_AT });
      let deniedAfterTamper = false;
      try {
        await sendReply({ store, client: clients[acmeSource.id], ticketId: billingTicket.id, draftId: tampered.id, principal: PRINCIPALS.billing, approvalId: approval.id, now: REPORT_GENERATED_AT, policy: all.policy });
      } catch (err) {
        deniedAfterTamper = err.code === "approval_required";
      }
      if (!deniedAfterTamper) problems.push("en godkendelse blev genbrugt på et ændret udkast");
      const sent = await sendReply({ store, client: clients[acmeSource.id], ticketId: billingTicket.id, draftId: draft.id, principal: PRINCIPALS.billing, approvalId: approval.id, now: REPORT_GENERATED_AT, policy: all.policy });
      if (!sent.sent || !sent.draft.sentAt) problems.push("et gyldigt godkendt udkast blev ikke sendt");
      scenarios.push(scenario("approval-required", { principal: "oidc|bea.billing", tenant: "acme", visible: [billingTicket.id], hidden: [], problems, deniedWithoutApproval, deniedAfterTamper }));
    }

    // 3) En vedhæftning med skadelig instruktion kan ikke ændre rettigheder.
    {
      const problems = [];
      const malicious = securityTicket.attachments.find((a) => a.filename === "invoice.txt");
      if (!malicious) problems.push("den skadelige vedhæftning blev ikke registreret");
      if (malicious && !malicious.quarantined) problems.push("den skadelige vedhæftning blev ikke sat i karantæne");
      if (malicious && malicious.injectionFindings.length === 0) problems.push("injektionsforsøget blev ikke markeret");
      if (malicious && (malicious.executable !== false || malicious.mayChangePermissions !== false)) problems.push("vedhæftningen fik eksekverings- eller rettighedsret");
      if (JSON.stringify(securityTicket.acl) !== JSON.stringify({ readGroups: ["security"], readSubjects: [], denyGroups: [], denySubjects: [] })) {
        problems.push("vedhæftningen ændrede sagens ACL");
      }
      // Et forsøg på at lade en vedhæftning ændre rettigheder afvises.
      let patchDenied = false;
      try {
        attachToTicket({ ticket: securityTicket, attachment: { id: "att:evil", filename: "evil.txt", contentType: "text/plain", acl: { readGroups: ["security"] } } });
      } catch (err) {
        patchDenied = err.code === "attachment_permission_change_denied";
      }
      // Ekstern kunde (ikke-rekvirent) må ikke se den fortrolige sag.
      const benDecision = decideTicketAccess({ principal: PRINCIPALS.ben, ticket: securityTicket, queue: securityTicket.queue });
      if (benDecision.allowed) problems.push("en ikke-rekvirent ekstern kunde fik adgang til den fortrolige sag");
      // Support-agenten (uden security-gruppe) må ikke se den.
      const supportDecision = decideTicketAccess({ principal: PRINCIPALS.support, ticket: securityTicket, queue: securityTicket.queue });
      if (supportDecision.allowed) problems.push("en agent uden security-gruppe fik adgang til den fortrolige sag");
      const secDecision = decideTicketAccess({ principal: PRINCIPALS.security, ticket: securityTicket, queue: securityTicket.queue });
      if (!secDecision.allowed) problems.push("security-agenten kunne ikke se den fortrolige sag");
      // Udkastet på den skadelige sag aktiverer intet værktøj.
      const draft = await draftReply({ ticket: securityTicket, model: createDeterministicHelpdeskModel(), policy: all.policy, now: REPORT_GENERATED_AT });
      if (draft.toolProposals.length > 0 || draft.toolActivationDenied !== true) problems.push("sagsindhold blev til et værktøjskald");
      if (draft.injectionFindings.length === 0) problems.push("injektionen blev ikke markeret i udkastet");
      if (!patchDenied) problems.push("et rettighedsændrende vedhæftnings-patch blev ikke afvist");
      scenarios.push(scenario("attachment-injection-neutralized", { principal: "oidc|ada.acme", tenant: "acme", visible: [securityTicket.id], hidden: [], problems, injectionFindings: malicious?.injectionFindings ?? [] }));
    }

    // 4) En ekstern kunde ser kun egne sager; tenants er isoleret.
    {
      const problems = [];
      const ada = filterAuthorizedTickets({ principal: PRINCIPALS.ada, tickets: allTickets });
      const gus = filterAuthorizedTickets({ principal: PRINCIPALS.gus, tickets: allTickets });
      const support = filterAuthorizedTickets({ principal: PRINCIPALS.support, tickets: allTickets });
      if (ada.authorized.some((t) => t.requester?.subject !== PRINCIPALS.ada.id)) problems.push("ada så en anden kundes sag");
      if (ada.authorized.some((t) => t.tenantId !== "acme")) problems.push("ada så en anden tenants sag");
      if (!ada.authorized.some((t) => t.id === loginTicket.id)) problems.push("ada kunne ikke se sin egen login-sag");
      if (gus.authorized.some((t) => t.tenantId !== "globex")) problems.push("gus så en anden tenants sag");
      if (gus.authorized.some((t) => t.requester?.subject !== PRINCIPALS.gus.id)) problems.push("gus så en anden kundes sag");
      if (support.authorized.some((t) => t.id === securityTicket.id)) problems.push("support-agenten så den fortrolige sag");
      if (!support.authorized.some((t) => t.id === loginTicket.id)) problems.push("support-agenten kunne ikke se support-sagen");
      scenarios.push(scenario("external-customer-isolation", { principal: "oidc|ada.acme + oidc|gus.globex", tenant: "acme/globex", visible: [...ada.authorized, ...gus.authorized].map((t) => t.id), hidden: [billingTicket?.id, securityTicket?.id].filter(Boolean), problems }));
    }

    // 5) Eksport, sletning, legal hold og backup/gendannelse.
    {
      const problems = [];
      const before = store.historyDigest();
      // Backup → gendannelse bevarer sager og historik.
      const backupDir = mkdtempSync(join(tmpdir(), "dkc029-backup-"));
      const restoredDir = mkdtempSync(join(tmpdir(), "dkc029-restore-"));
      try {
        store.snapshot(backupDir);
        const restored = FileHelpdeskStore.restore(backupDir, restoredDir);
        backup = {
          ok: restored.listTickets().length === store.listTickets().length && restored.historyDigest() === store.historyDigest(),
          ticketsBefore: store.listTickets().length,
          ticketsAfter: restored.listTickets().length,
          historyBefore: store.historyDigest(),
          historyAfter: restored.historyDigest(),
        };
        if (!backup.ok) problems.push("en gendannelse bevarede ikke sager og historik");
        const reopened = FileHelpdeskStore.open(store.root);
        if (reopened.historyDigest() !== before) problems.push("butikken kunne ikke genindlæses fra disk");
      } finally {
        rmSync(backupDir, { recursive: true, force: true });
        rmSync(restoredDir, { recursive: true, force: true });
      }
      // Eksport.
      exportSample = exportSubject({ store, tenantId: "acme", subjectKey: PRINCIPALS.ada.id, now: REPORT_GENERATED_AT });
      if (exportSample.ticketCount < 2) problems.push("eksporten manglede sager for subjektet");
      if (exportSample.attachmentCount < 2) problems.push("eksporten manglede vedhæftninger");
      if (exportSample.indexEntryCount < 2) problems.push("eksporten manglede indeksposter");
      // Legal hold blokerer sletning.
      const hold = buildHold({
        tenantId: "acme",
        subjectDigest: exportSample.subjectDigest,
        dataClasses: ["personal"],
        reason: "verserende sag",
        placedBy: { subject: "oidc|mia.manager", name: "Mia Manager", role: "Support Manager" },
        approvedBy: { subject: "oidc|leo.legal", name: "Leo Legal", role: "Legal Counsel" },
      });
      const blocked = deleteSubject({ store, tenantId: "acme", subjectKey: PRINCIPALS.ada.id, reason: "anmodning", holds: [hold], now: REPORT_GENERATED_AT });
      if (blocked.status !== "blocked") problems.push("et legal hold blokerede ikke sletningen");
      // Sletning uden hold.
      deletionSample = deleteSubject({ store, tenantId: "acme", subjectKey: PRINCIPALS.ada.id, reason: "anmodning", holds: [], now: REPORT_GENERATED_AT });
      if (deletionSample.status !== "full") problems.push("sletningen var ikke fuld");
      for (const surface of ["mail", "attachments", "index"]) {
        if (deletionSample.surfaces[surface].status !== "full") problems.push(`fladen '${surface}' blev ikke slettet`);
      }
      const remainingAda = store.listTickets({ tenantId: "acme", includeDeleted: false }).filter((t) => t.requester?.subject === PRINCIPALS.ada.id);
      if (remainingAda.length !== 0) problems.push("slettede sager stod stadig aktive");
      scenarios.push(scenario("retention-and-recovery", { principal: "platform:retention", tenant: "acme", visible: [], hidden: adaTickets.map((t) => t.id), problems, deletion: deletionSample, backup }));
    }

    // Robusthed: filbutikken kan genindlæses fra disk.
    const reloaded = FileHelpdeskStore.open(store.root);
    const persistedOk = reloaded.historyDigest() === store.historyDigest();
    const tenants = new Set(allTickets.map((t) => t.tenantId));
    const messages = allTickets.reduce((n, t) => n + (t.messages ?? []).length, 0);
    const attachments = allTickets.reduce((n, t) => n + (t.attachments ?? []).length, 0);
    return {
      apiVersion: "contracts.platform/v1alpha1",
      kind: "HelpdeskReport",
      metadata: {
        name: "platform-helpdesk-report",
        version: "1.0.0",
        description: "Deterministisk rapport for support og sagsbehandling: indgående mail/webformular, kø-routing, default-deny adgang, sikker vedhæftning, AI-klassifikation/udkast, godkendt afsendelse, lukning, eksport/sletning/retention og backup/gendannelse.",
        accountableHuman: all.sources.metadata.accountableHuman,
        labels: all.sources.metadata.labels ?? {},
      },
      generatedAt: REPORT_GENERATED_AT,
      measured: false,
      persistedStoreReloaded: persistedOk,
      historyDigest: store.historyDigest(),
      totals: {
        tickets: allTickets.length,
        tenants: tenants.size,
        queues: all.sources.sources.reduce((n, s) => n + (s.queues ?? []).length, 0),
        messages,
        attachments,
        quarantinedAttachments: allTickets.reduce((n, t) => n + (t.attachments ?? []).filter((a) => a.quarantined).length, 0),
      },
      scenarios,
      draftSample,
      exportSample,
      deletionSample,
      retention: retentionStatus({ store, policy: all.policy, now: Date.parse(REPORT_GENERATED_AT) }),
      backup,
      policyRef: "helpdesk/policy.json",
    };
  } finally {
    await close();
  }
}

function scenariosProblem(scenarios, id, message) {
  const existing = scenarios.find((s) => s.id === id);
  if (existing) existing.problems.push(message);
  else scenarios.push({ id, principal: null, tenant: null, visible: [], hidden: [], problems: [message] });
}

function main() {
  runHelpdeskCheck(repoRoot)
    .then((result) => {
      if (!result.ok) {
        console.error("✘ Sagsbehandlingskontrol fejlede:\n");
        for (const p of result.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
      console.log("✔ Kilder, politik, sager og historik er konsistente");
      console.log(`✔ ${result.report.scenarios.length} scenarier bestået; ${result.report.totals.tickets} sager, ${result.report.totals.attachments} vedhæftninger`);
    })
    .catch((err) => {
      console.error(`✘ Kontrollen kastede: ${err.stack ?? err.message}`);
      process.exit(1);
    });
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
