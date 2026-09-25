/**
 * DKC-011 — adskillelse af ubetroet indhold og eksekverbare værktøjskald.
 *
 * Alt hvad agenten ikke selv har produceret gennem en betroet kanal — logs,
 * dokumenter, mails, tool-output og **model-output** — er ubetroet *data*. Det
 * kan beskrive en verden, men det kan ikke udføre noget. Den eneste eksekverbare
 * enhed er et servervalideret værktøjskald, og et sådant opstår kun ved at
 * runtimens grænse erklærer verbum, mål og parametre.
 *
 * Modellen kan derfor returnere perfekt, gyldig JSON med et felt der ligner et
 * værktøjskald. Det behandles stadig som ubetroet: `parseModelOutput` markerer
 * det som `executable: false`, og `buildTaskFromProposal` kopierer kun
 * handlingsfelter ind i et forslag, som derefter møder den fulde runtimegrænse.
 * Det er grænsen — ikke et regex — der afgør om noget må køre.
 */
import { sha256Hex } from "./digest.mjs";

export const UNTRUSTED_KINDS = ["log", "document", "email", "issue", "changelog", "tool-output", "model-output", "web", "chat", "unknown"];

const MAX_UNTRUSTED_BYTES = 256 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Er værdien en ubetroet indholds-konvolut? */
export function isUntrustedContent(value) {
  return isPlainObject(value) && value.__untrusted === true && value.executable === false;
}

/**
 * Pak ubetroet indhold i en fryset konvolut. Konvolutten kan læses, men aldrig
 * fortolkes som et kald; `executable` er altid `false`.
 */
export function createUntrustedContent({ kind = "unknown", source = "unknown", text = "", encoding = "plain", tenantId = null, modelRef = null, fetchedAt = null } = {}) {
  if (!UNTRUSTED_KINDS.includes(kind)) throw new Error(`ukendt ubetroet-kilde '${kind}' (tilladte: ${UNTRUSTED_KINDS.join(", ")})`);
  const body = typeof text === "string" ? text : String(text ?? "");
  if (Buffer.byteLength(body, "utf8") > MAX_UNTRUSTED_BYTES) throw new Error(`ubetroet indhold overstiger ${MAX_UNTRUSTED_BYTES} bytes`);
  return Object.freeze({
    __untrusted: true,
    executable: false,
    kind,
    source,
    encoding,
    tenantId,
    modelRef,
    fetchedAt,
    sha256: sha256Hex(body),
    bytes: Buffer.byteLength(body, "utf8"),
    text: body,
  });
}

/** Normalisér en streng eller konvolut til en konvolut. */
export function normalizeUntrusted(input, defaults = {}) {
  if (isUntrustedContent(input)) return input;
  if (isPlainObject(input)) {
    return createUntrustedContent({
      kind: UNTRUSTED_KINDS.includes(input.kind) ? input.kind : defaults.kind ?? "unknown",
      source: input.source ?? defaults.source ?? "unknown",
      text: input.text ?? input.content ?? "",
      encoding: input.encoding ?? "plain",
      tenantId: input.tenantId ?? defaults.tenantId ?? null,
      modelRef: input.modelRef ?? defaults.modelRef ?? null,
    });
  }
  return createUntrustedContent({ kind: defaults.kind ?? "unknown", source: defaults.source ?? "unknown", text: input, ...defaults });
}

/**
 * Adskil en handlings ubetroede indhold fra dens eksekverbare felter. Returnerer
 * den eksekverbare kerne (verbum, mål, miljø, parametre, …) og de ubetroede
 * konvolutter. Indholdet kan ikke overskrive den eksekverbare kerne, fordi
 * funktionen læser dem fra hver sit sted og returnerer dem separat.
 */
export function separateUntrusted(action = {}) {
  const content = [];
  if (action.untrustedContext !== undefined) {
    const list = Array.isArray(action.untrustedContext) ? action.untrustedContext : [action.untrustedContext];
    for (const item of list) content.push(normalizeUntrusted(item));
  }
  if (action.untrustedContent !== undefined) {
    content.push(normalizeUntrusted(action.untrustedContent, { kind: action.untrustedKind ?? "unknown", source: action.untrustedSource ?? "untrusted" }));
  }
  const executable = {
    verb: action.verb,
    target: action.target,
    environment: action.environment,
    parameters: action.parameters ?? null,
    tool: action.tool ?? null,
    evidence: action.evidence ?? [],
    dataCategories: action.dataCategories ?? [],
  };
  return { content, executable };
}

/** Læs den samlede ubetroede tekst fra en liste af konvolutter. */
export function untrustedText(content = []) {
  return content.map((c) => (isUntrustedContent(c) ? c.text : String(c ?? ""))).join("\n\n");
}

/**
 * Parse model-output. Resultatet er altid ubetroet — også når JSON er gyldig.
 * Runtimen bruger `data` som et *forslag*, aldrig som en befaling.
 */
export function parseModelOutput(raw) {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  let data = null;
  let format = "text";
  try {
    const parsed = JSON.parse(text);
    if (isPlainObject(parsed) || Array.isArray(parsed)) {
      data = parsed;
      format = "json";
    }
  } catch {
    format = "text";
  }
  return { untrusted: true, executable: false, format, text, data };
}

/**
 * Byg et task-forslag fra model-output. Kun `actions` kan komme fra modellen;
 * identitet, kunde, agentRef og opgavens id kommer fra serveren. Forslaget er
 * endnu ikke autoriseret — `runTask` validerer hvert kald.
 */
export function buildTaskFromProposal(proposal, base = {}) {
  const parsed = isUntrustedContent(proposal) ? parseModelOutput(proposal.text) : proposal;
  const rawActions = isPlainObject(parsed?.data) && Array.isArray(parsed.data.actions) ? parsed.data.actions : [];
  const actions = rawActions
    .filter((a) => isPlainObject(a))
    .map((a) => ({
      verb: a.verb,
      target: a.target,
      environment: a.environment,
      ...(a.parameters !== undefined ? { parameters: a.parameters } : {}),
      ...(a.tool !== undefined ? { tool: a.tool } : {}),
      ...(a.evidence !== undefined ? { evidence: a.evidence } : {}),
      ...(a.dataCategories !== undefined ? { dataCategories: a.dataCategories } : {}),
      ...(a.untrustedContext !== undefined ? { untrustedContext: a.untrustedContext } : {}),
      ...(a.untrustedContent !== undefined ? { untrustedContent: a.untrustedContent } : {}),
      ...(a.approvalId !== undefined ? { approvalId: a.approvalId } : {}),
      ...(a.changeDigest !== undefined ? { changeDigest: a.changeDigest } : {}),
    }));
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "AgentTask",
    taskId: base.taskId ?? null,
    tenantId: base.tenantId ?? null,
    agentRef: base.agentRef ?? null,
    objective: base.objective ?? "model proposal",
    ...(base.evidenceIndex ? { evidenceIndex: base.evidenceIndex } : {}),
    ...(base.budget ? { budget: base.budget } : {}),
    requestedBy: { kind: "agent", id: base.agentRef ?? null },
    actions,
  };
}
