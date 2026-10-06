#!/usr/bin/env node
/**
 * DKC-029 — CLI for support og sagsbehandling.
 *
 *   node helpdesk/src/cli.mjs intake     # tag imod korpus og spejl sager
 *   node helpdesk/src/cli.mjs show       # vis spejlede sager
 *   node helpdesk/src/cli.mjs draft      # lav et AI-svarudkast
 *   node helpdesk/src/cli.mjs send       # send et godkendt udkast
 *   node helpdesk/src/cli.mjs close      # luk en sag (godkendelsespligtigt)
 *   node helpdesk/src/cli.mjs export     # eksportér et subjekt
 *   node helpdesk/src/cli.mjs check      # validér kilder, politik og scenarier
 *   node helpdesk/src/cli.mjs render     # skriv rapporten
 *   node helpdesk/src/cli.mjs report     # skriv rapporten til stdout
 *   node helpdesk/src/cli.mjs drill      # kør den deterministiske kontrol
 *
 * En `check` og `drill` er deterministiske (`measured: false`); en målt
 * integration mod en levende Zammad er `make helpdesk-live` og er NOT RUN.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { setupHelpdesk, runHelpdeskCheck, buildHelpdeskReport, REPORT_GENERATED_AT } from "./check.mjs";
import { createDeterministicHelpdeskModel, draftReply } from "./classification.mjs";
import { recordReplyApproval, sendReply, recordCloseApproval, closeTicket } from "./approval-gate.mjs";
import { exportSubject } from "./retention.mjs";
import { renderHelpdeskReport } from "./report.mjs";

function writeFile(root, rel, contents) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

const APPROVER = { kind: "human", id: "oidc|mia.manager", tenantId: "acme", groups: ["acme", "support"], roles: ["support-manager"], clearance: "confidential" };
const AGENT = { kind: "human", id: "oidc|sara.support", tenantId: "acme", groups: ["acme", "support"], roles: ["support-agent"], clearance: "internal" };

async function main() {
  const command = process.argv[2];
  if (command === "intake" || command === "show") {
    const { received, store, close, all } = await setupHelpdesk();
    try {
      if (command === "intake") {
        console.log(received.map((r) => `${r.deduplicated ? "DEDUP" : "NEW"} ${r.ticket.id} (${r.ticket.queueId})`).join("\n"));
      } else {
        console.log(JSON.stringify(store.listTickets().map((t) => ({ id: t.id, queueId: t.queueId, status: t.status, subject: t.subject })), null, 2));
      }
      void all;
    } finally {
      await close();
    }
    return;
  }
  if (command === "draft" || command === "send" || command === "close" || command === "export") {
    const { store, clients, all, close } = await setupHelpdesk();
    try {
      const acme = all.sources.sources.find((s) => s.id === "zammad-acme");
      const ticket = store.listTickets({ tenantId: "acme" }).find((t) => t.queueId === "support");
      if (command === "draft") {
        const draft = await draftReply({ ticket, model: createDeterministicHelpdeskModel(), policy: all.policy, now: REPORT_GENERATED_AT });
        store.saveDraft(draft, { at: REPORT_GENERATED_AT });
        console.log(JSON.stringify({ id: draft.id, ticketId: draft.ticketId, draftDigest: draft.draftDigest, requiresApproval: draft.requiresApproval, toolProposals: draft.toolProposals }, null, 2));
      } else if (command === "send") {
        const draft = await draftReply({ ticket, model: createDeterministicHelpdeskModel(), policy: all.policy, now: REPORT_GENERATED_AT });
        store.saveDraft(draft, { at: REPORT_GENERATED_AT });
        const approval = recordReplyApproval({ store, draft, approver: APPROVER, now: REPORT_GENERATED_AT, policy: all.policy });
        const sent = await sendReply({ store, client: clients[acme.id], ticketId: ticket.id, draftId: draft.id, principal: AGENT, approvalId: approval.id, now: REPORT_GENERATED_AT, policy: all.policy });
        console.log(JSON.stringify({ sent: sent.sent, approvalId: approval.id, sentAt: sent.draft.sentAt }, null, 2));
      } else if (command === "close") {
        const approval = recordCloseApproval({ store, ticket, approver: APPROVER, now: REPORT_GENERATED_AT, policy: all.policy });
        const closed = await closeTicket({ store, client: clients[acme.id], ticketId: ticket.id, principal: AGENT, approvalId: approval.id, now: REPORT_GENERATED_AT, policy: all.policy });
        console.log(JSON.stringify({ id: closed.id, status: closed.status, closedAt: closed.closedAt }, null, 2));
      } else {
        const ada = store.listTickets({ tenantId: "acme" }).find((t) => t.requester?.subject === "oidc|ada.acme");
        console.log(JSON.stringify(exportSubject({ store, tenantId: "acme", subjectKey: ada.requester.subject, now: REPORT_GENERATED_AT }), null, 2));
      }
    } finally {
      await close();
    }
    return;
  }
  if (command === "check") {
    const result = await runHelpdeskCheck(repoRoot);
    if (!result.ok) {
      console.error("✘ Sagsbehandlingskontrol fejlede:\n");
      for (const p of result.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("✔ Support og sagsbehandling er konsistent");
    return;
  }
  if (command === "render") {
    const report = await buildHelpdeskReport(repoRoot);
    const rendered = renderHelpdeskReport(report);
    for (const [rel, value] of rendered) writeFile(repoRoot, rel, value);
    console.log(`✔ Skrev ${rendered.size} sagsbehandlingsartefakter`);
    return;
  }
  if (command === "report") {
    const report = await buildHelpdeskReport(repoRoot);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  if (command === "drill") {
    const result = await runHelpdeskCheck(repoRoot);
    for (const s of result.report.scenarios) console.log(`${(s.problems ?? []).length === 0 ? "PASS" : "FAIL"} ${s.id}`);
    console.log(`${result.ok ? "PASS" : "FAIL"} helpdesk (${result.report.totals.tickets} sager, historik ${result.report.historyDigest.slice(0, 12)}…)`);
    if (!result.ok) process.exit(1);
    return;
  }
  console.error("Brug: node helpdesk/src/cli.mjs <intake|show|draft|send|close|export|check|render|report|drill>");
  process.exit(2);
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
