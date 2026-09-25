/**
 * DKC-029 — sikker vedhæftningshåndtering.
 *
 * En vedhæftning er ubetroet data. Den pakkes gennem runtimens grænse
 * (DKC-011) med `executable: false`, scannes for injektionssignaler, og dens
 * indhold gemmes som en blob ved siden af sagen. To ting kan den aldrig:
 *
 *   1. blive eksekverbar (`executable` er altid `false`), og
 *   2. ændre rettigheder — ingest-funktionen kopierer **kun** datakategorier
 *      ind i sagen og rører aldrig `acl`, `queue` eller `classification`.
 *
 * Et injektionsforsøg markeres og giver en karantæne; det påvirker ikke
 * sagens kø, ACL eller klassifikation.
 */
import { createUntrustedContent } from "../../runtime/src/untrusted.mjs";
import { scanUntrusted } from "../../runtime/src/injection.mjs";
import { digestOf, sha256Hex } from "../../runtime/src/digest.mjs";

export const ATTACHMENT_UNTRUSTED_KIND = "document";

function asText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return String(content);
}

/**
 * Tag en vedhæftning ind.
 *
 * @returns en vedhæftningsrecord der er sikker at lægge på en sag.
 */
export function ingestAttachment({ id, filename, contentType = "application/octet-stream", content = "", tenantId = null, policy = {}, now = null } = {}) {
  const text = asText(content);
  const bytes = Buffer.byteLength(text, "utf8");
  const maxBytes = policy.maxBytes ?? policy.attachmentPolicy?.maxBytes ?? 10 * 1024 * 1024;
  if (bytes > maxBytes) {
    const err = new Error(`vedhæftningen '${filename}' overskrider grænsen på ${maxBytes} bytes`);
    err.code = "attachment_too_large";
    throw err;
  }
  const allowed = policy.allowedTypes ?? policy.attachmentPolicy?.allowedTypes ?? null;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(contentType)) {
    const err = new Error(`vedhæftningstypen '${contentType}' er ikke tilladt`);
    err.code = "attachment_type_rejected";
    throw err;
  }

  const untrusted = createUntrustedContent({ kind: ATTACHMENT_UNTRUSTED_KIND, source: filename, text, tenantId });
  const scan = scanUntrusted(untrusted.text);
  const quarantine = scan.flagged && (policy.quarantineSuspicious ?? policy.attachmentPolicy?.quarantineSuspicious ?? true);

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "TicketAttachment",
    id: id ?? `att:${sha256Hex(`${filename}:${text}`).slice(0, 16)}`,
    filename,
    contentType,
    size: bytes,
    sha256: sha256Hex(text),
    digest: digestOf({ filename, contentType, contentSha256: sha256Hex(text) }),
    untrusted: true,
    executable: false,
    mayChangePermissions: false,
    quarantined: quarantine,
    injectionFindings: scan.findings,
    // Selve teksten holdes separat (gemmes som blob), så den aldrig blandes
    // sammen med sagens eksekverbare felter.
    content: untrusted.text,
    capturedAt: now ?? null,
  };
}

/**
 * Læg en vedhæftning på en sag. Funktionen kopierer udelukkende de
 * datakategorier, en vedhæftning lovligt må bidrage med, og afviser enhver
 * patch der forsøger at ændre rettigheder, kø eller klassifikation.
 */
export function attachToTicket({ ticket, attachment } = {}) {
  if (!ticket || !attachment) throw new Error("attachToTicket kræver sag og vedhæftning");
  const forbidden = ["acl", "queue", "queueId", "classification", "readGroups", "readSubjects", "denyGroups", "denySubjects"];
  const attempted = forbidden.filter((key) => key in attachment && attachment[key] != null);
  if (attempted.length > 0) {
    const err = new Error(`en vedhæftning må ikke forsøge at ændre: ${attempted.join(", ")}`);
    err.code = "attachment_permission_change_denied";
    throw err;
  }
  const record = {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
    sha256: attachment.sha256,
    untrusted: true,
    executable: false,
    mayChangePermissions: false,
    quarantined: attachment.quarantined === true,
    injectionFindings: [...(attachment.injectionFindings ?? [])],
    capturedAt: attachment.capturedAt ?? null,
  };
  ticket.attachments = [...(ticket.attachments ?? []), record];
  return record;
}
