/**
 * DKC-060 — rapportering med revalideret adgang.
 *
 * En rapportdefinition er versionsstyret og bærer kun afsenderens *subject* —
 * aldrig et creator-token. Ved hver kørsel og hver afsendelse genoprettes
 * afsenderens og alle modtageres rettigheder fra den autoritative kilde, og
 * beslutningen evalueres på ny gennem adgangsmotoren. Et bortfaldt afsender-,
 * modtager- eller kildegrundlag stopper rapporten; den genbruges ikke stiltiende.
 */
import { principalTenant } from "../../identity/src/tenant.mjs";
import { decideAccess } from "./access.mjs";
import { isNamedHuman } from "./profiles.mjs";

function err(path, message) {
  return { path, message };
}

const TOKEN_LIKE = /^eyJ|^Bearer\s|\.[A-Za-z0-9_-]{10,}\./;

export function reportDefinitionProblems(definition) {
  const problems = [];
  if (!definition || typeof definition !== "object") return [err("/", "rapportdefinitionen er ikke et objekt")];
  if (!isNamedHuman(definition.metadata?.accountableHuman)) {
    problems.push(err("/metadata/accountableHuman", "rapportdefinitionen skal have et navngivet menneske som ejer"));
  }
  if (typeof definition.senderSubject !== "string" || !definition.senderSubject.trim()) {
    problems.push(err("/senderSubject", "rapportdefinitionen mangler en afsender-identitet"));
  } else if (TOKEN_LIKE.test(definition.senderSubject)) {
    problems.push(err("/senderSubject", "afsenderen skal være en identitet, ikke et token"));
  }
  const ds = definition.dataSource ?? {};
  const auth = definition.authoritativeDefinition ?? {};
  if (ds.systemOfRecord && auth.systemOfRecord && ds.systemOfRecord !== auth.systemOfRecord) {
    problems.push(err("/authoritativeDefinition/systemOfRecord", "den autoritative definition skal pege på samme system of record som datakilden"));
  }
  if (!(auth.definitionRef ?? "").trim()) problems.push(err("/authoritativeDefinition/definitionRef", "den autoritative definition mangler en reference"));
  for (const [i, parameter] of (definition.parameters ?? []).entries()) {
    if (parameter.required && parameter.default !== undefined) {
      problems.push(err(`/parameters/${i}`, `den obligatoriske parameter '${parameter.name}' bør ikke have en default der skjuler et manglende input`));
    }
    if (parameter.sensitive && !(parameter.description ?? "").trim()) {
      problems.push(err(`/parameters/${i}/description`, `den følsomme parameter '${parameter.name}' skal beskrives eksplicit`));
    }
  }
  const schedule = definition.schedule ?? {};
  if (schedule.enabled === true && (schedule.cron ?? "").split(/\s+/).length < 5) {
    problems.push(err("/schedule/cron", "en aktiv planlægning kræver et fem-felts cron-udtryk"));
  }
  const seen = new Set();
  for (const [i, recipient] of (definition.recipients ?? []).entries()) {
    if (seen.has(recipient.id)) problems.push(err(`/recipients/${i}/id`, `modtageren '${recipient.id}' er angivet flere gange`));
    seen.add(recipient.id);
    if ((recipient.kind === "external" || recipient.kind === "service") && !(recipient.dataSharingRef ?? "").trim()) {
      problems.push(err(`/recipients/${i}/dataSharingRef`, `den eksterne/tjenestebaserede modtager '${recipient.id}' kræver en datadelingsreference`));
    }
  }
  return problems;
}

function resolvePrincipal(rights, subject) {
  if (!rights) return null;
  if (typeof rights === "function") return rights(subject) ?? null;
  if (typeof rights.principalFor === "function") return rights.principalFor(subject) ?? null;
  if (typeof rights.get === "function") return rights.get(subject) ?? null;
  return null;
}

/**
 * Kører rapporten med frisk revalidering.
 *
 * @returns en ReportRun-struktur. `decision`:
 *   - `run`         afsender og alle modtagere er autoriserede nu;
 *   - `reauthorize` afsenderens grundlag er bortfaldet (kræver ny ejer/definition);
 *   - `blocked`     mindst én modtager må ikke længere modtage rapporten.
 */
export function authorizedReportRun({ definition, rights, profiles = {}, now = () => Date.now(), environment = "staging" } = {}) {
  const at = new Date(now()).toISOString();
  const profile = profiles?.[definition?.dataSource?.moduleRef] ?? null;
  const senderPrincipal = resolvePrincipal(rights, definition?.senderSubject);
  const senderTenant = senderPrincipal ? principalTenant(senderPrincipal) : null;

  let sender = { subject: definition?.senderSubject ?? null, decision: "deny", resolvedAt: at };
  if (!senderPrincipal) {
    sender.reason = "afsenderens rettigheder kunne ikke genoprettes fra den autoritative kilde";
  } else {
    const access = decideAccess({
      principal: senderPrincipal,
      profile,
      resource: { tenantId: senderTenant, type: "report", localId: definition.id },
      fields: definition.dataSource?.fields ?? [],
      action: "export",
      surface: "export",
      now: now(),
    });
    sender.decision = access.decision === "allow" ? "allow" : "deny";
    if (access.decision !== "allow") sender.reason = access.reasons.join("; ") || "afsenderen er ikke længere autoriseret til rapportens felter";
  }

  let recipientsResolved = true;
  const recipients = (definition?.recipients ?? []).map((recipient) => {
    const principal = resolvePrincipal(rights, recipient.subject);
    if (!principal) {
      recipientsResolved = false;
      return { id: recipient.id, subject: recipient.subject, decision: "deny", reason: "modtagerens rettigheder kunne ikke genoprettes" };
    }
    const recipientTenant = principalTenant(principal);
    if (senderTenant && recipientTenant !== senderTenant) {
      return { id: recipient.id, subject: recipient.subject, decision: "deny", reason: "modtageren tilhører en anden tenant end rapportens afsender" };
    }
    const access = decideAccess({
      principal,
      profile,
      resource: { tenantId: recipientTenant, type: "report", localId: definition.id },
      fields: [],
      action: "read",
      surface: "delivery",
      now: now(),
    });
    return {
      id: recipient.id,
      subject: recipient.subject,
      decision: access.decision === "deny" ? "deny" : "allow",
      reason: access.decision === "deny" ? access.reasons.join("; ") : undefined,
    };
  });

  const sourceResolved = Boolean(profile);
  const anyRecipientDenied = recipients.some((r) => r.decision !== "allow");
  const decision = sender.decision !== "allow" ? "reauthorize" : anyRecipientDenied ? "blocked" : "run";

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ReportRun",
    id: `run-${definition.id}-${Date.parse(at)}`,
    reportId: definition.id,
    reportVersion: definition.version,
    startedAt: at,
    environment,
    format: definition.format,
    dataSource: { id: definition.dataSource.id, systemOfRecord: definition.dataSource.systemOfRecord, moduleRef: definition.dataSource.moduleRef },
    sender,
    recipients,
    authorization: {
      revalidatedAt: at,
      senderResolved: Boolean(senderPrincipal),
      recipientsResolved,
      sourceResolved,
      usedStoredCreatorToken: false,
    },
    decision,
    audit: { required: true, ref: `audit://reports/${definition.id}/${definition.version}` },
  };
}

/**
 * Afsender med endnu en revalidering. Returnerer en kopi hvor modtagerne først
 * får `deliveredAt` når den friske beslutning er `run`. Ellers leveres intet.
 */
export function deliverReport({ run, definition, rights, profiles = {}, now = () => Date.now() } = {}) {
  const fresh = authorizedReportRun({ definition, rights, profiles, now, environment: run?.environment ?? "staging" });
  if (fresh.decision !== "run") return { ...fresh, delivered: [] };
  const deliveredAt = new Date(now()).toISOString();
  const recipients = fresh.recipients.map((recipient) => ({ ...recipient, deliveredAt }));
  return { ...fresh, recipients, delivered: recipients.map((r) => r.id) };
}
