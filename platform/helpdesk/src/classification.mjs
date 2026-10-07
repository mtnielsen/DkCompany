/**
 * DKC-029 — AI-klassifikation og svarudkast.
 *
 * AI'en må klassificere en sag og **udkaste** et svar. Den må ikke sende det:
 * afsendelse er en separat, godkendelsespligtig handling (`approval-gate.mjs`).
 *
 * Sagsindhold og modeloutput behandles som ubetroet data gennem runtimens
 * grænse (DKC-011): output parses med `parseModelOutput`, pakkes som
 * ubetroet indhold og scannes for injektion. Et forfalsket værktøjskald i en
 * sag eller i modeloutput bliver aldrig et kald — `toolProposals` er tom, og
 * `toolActivationDenied` er altid sand.
 *
 * Modellen injiceres. Den medfølgende `createDeterministicHelpdeskModel` er en
 * deterministisk, regelbaseret model til test og offline kørsel; en levende
 * modelgateway (DKC-012) er en separat integration.
 */
import { createUntrustedContent, parseModelOutput } from "../../runtime/src/untrusted.mjs";
import { scanUntrusted } from "../../runtime/src/injection.mjs";
import { digestOf, sha256Hex } from "../../runtime/src/digest.mjs";
import { TICKET_PRIORITIES, classificationRank } from "./model.mjs";

const PRIORITY_SIGNALS = [
  { re: /(sikkerhed|mistænkelig|brud|kompromitter|phishing|hærværk|security|breach)/i, priority: "urgent" },
  { re: /(faktura|moms|betaling|kreditnota|invoice|refund)/i, priority: "high" },
  { re: /(kan ikke logge ind|kan ikke få adgang|nedbrud|driftsstop|blokeret|outage|login)/i, priority: "high" },
  { re: /(spørgsmål|hvordan|vejledning|onsker|ønske|question|how to)/i, priority: "normal" },
];

const CATEGORY_SIGNALS = [
  { re: /(faktura|moms|betaling|kreditnota)/i, category: "billing" },
  { re: /(sikkerhed|mistænkelig|phishing|brud)/i, category: "security" },
  { re: /(login|adgang|password|konto)/i, category: "access" },
];

/**
 * Deterministsk, regelbaseret helpdeskmodel. Returnerer et JSON-lignende svar
 * som en rigtig model ville, så hele kæden (parse → ubetroet → scan → udkast)
 * efterprøves.
 */
export function createDeterministicHelpdeskModel() {
  return {
    name: "deterministic-helpdesk-model",
    version: "1.0.0",
    async respond({ task, ticket }) {
      const text = `${ticket?.subject ?? ""}\n${ticket?.messages?.map((m) => m.body).join("\n") ?? ""}`;
      if (task === "classify") {
        const priority = PRIORITY_SIGNALS.find((s) => s.re.test(text))?.priority ?? "normal";
        const category = CATEGORY_SIGNALS.find((s) => s.re.test(text))?.category ?? "general";
        return JSON.stringify({ priority, category });
      }
      if (task === "draft") {
        return JSON.stringify({
          body: `Hej ${ticket?.requester?.name ?? "kunde"},\n\nTak for din henvendelse om "${ticket?.subject ?? "din sag"}". Vi har modtaget sagen og vender tilbage med en løsning hurtigst muligt.\n\nMed venlig hilsen\nSupport`,
        });
      }
      return JSON.stringify({});
    },
  };
}

/** Klassificér en sag. Resultatet er et ubetroet forslag, ikke en befaling. */
export async function classifyTicket({ ticket, model } = {}) {
  if (!model?.respond) throw new Error("classifyTicket kræver en model");
  const untrustedTicket = createUntrustedContent({
    kind: "issue",
    source: ticket?.id ?? "ticket",
    text: `${ticket?.subject ?? ""}\n${(ticket?.messages ?? []).map((m) => m.body).join("\n")}`,
    tenantId: ticket?.tenantId ?? null,
  });
  const raw = await model.respond({ task: "classify", ticket, untrustedText: untrustedTicket.text });
  const parsed = parseModelOutput(raw);
  const priority = TICKET_PRIORITIES.includes(parsed.data?.priority) ? parsed.data.priority : "normal";
  const category = typeof parsed.data?.category === "string" ? parsed.data.category : "general";
  const scan = scanUntrusted(untrustedTicket.text);
  return { priority, category, untrusted: true, executable: false, injectionFindings: scan.findings };
}

/**
 * Byg et svarudkast. Udkastet er ubetroet og ikke-eksekverbart, bærer et
 * digest der binder en senere godkendelse til det præcise indhold, og kan
 * ikke sendes uden en gyldig godkendelse.
 */
export async function draftReply({ ticket, model, policy = {}, now = null } = {}) {
  if (!model?.respond) throw new Error("draftReply kræver en model");
  const untrustedTicket = createUntrustedContent({
    kind: "issue",
    source: ticket?.id ?? "ticket",
    text: `${ticket?.subject ?? ""}\n${(ticket?.messages ?? []).map((m) => m.body).join("\n")}`,
    tenantId: ticket?.tenantId ?? null,
  });
  const raw = await model.respond({ task: "draft", ticket, untrustedText: untrustedTicket.text });
  const parsed = parseModelOutput(raw);
  const body = typeof parsed.data?.body === "string" ? parsed.data.body : parsed.text;
  // Udkastets krop er ubetroet data; scan både sagsindhold, vedhæftninger og modeloutput.
  const scan = scanUntrusted(`${untrustedTicket.text}\n${body}`);
  const attachmentFindings = (ticket.attachments ?? []).flatMap((a) => a.injectionFindings ?? []);
  const injectionFindings = [...new Set([...scan.findings, ...attachmentFindings])];
  const draftDigest = digestOf({ ticketId: ticket.id, tenantId: ticket.tenantId, body: sha256Hex(body) });
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ReplyDraft",
    id: `draft:${draftDigest.slice(0, 16)}`,
    tenantId: ticket.tenantId,
    ticketId: ticket.id,
    body,
    draftDigest,
    model: { provider: model.name ?? "unknown", version: model.version ?? null },
    untrusted: true,
    executable: false,
    toolProposals: [],
    toolActivationDenied: true,
    injectionFindings,
    requiresApproval: policy.ai?.sendingRequiresApproval !== false,
    approvalId: null,
    createdAt: now ?? new Date().toISOString(),
    sentAt: null,
  };
}

/** Ord til indekset; aldrig autoritativt for adgang. */
export function ticketTerms(ticket) {
  const text = `${ticket.subject ?? ""} ${(ticket.messages ?? []).map((m) => m.body).join(" ")}`;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9æøåäöüß]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export { classificationRank };
