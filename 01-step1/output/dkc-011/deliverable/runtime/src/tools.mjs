/**
 * DKC-011 — servervalideret, typet værktøjsgrænse.
 *
 * Agenten har ingen fri shell. Den kan kun kalde **erklærede, typede værktøjer**
 * fra en allowlist, og hvert kald valideres på serversiden før en executor ser
 * det:
 *
 *   - værktøjet skal stå på allowlisten (ukendte værktøjer afvises),
 *   - verbet skal være bundet til netop det værktøj,
 *   - parametrene skal matche værktøjets typeskema (type, enum, mønster,
 *     længde, interval, kendte/ukendte felter),
 *   - størrelsen på de serialiserede parametre skal være under grænsen,
 *   - farlige parameternavne (`shell`, `command`, `token`, …) afvises,
 *   - udgående netværk skal følge værktøjets egress-allowlist; metadata-IP'er,
 *     loopback, private net og uautoriserede værter afvises, og
 *   - data må ikke flyttes til en anden kunde.
 *
 * Tjekkerne er rene funktioner, så runtimen, CLI'en, conformance-suiten og
 * `tool-boundary-check` bruger præcis samme regel. Regex er ikke en del af
 * grænsen; den er kun et ekstra signal (se `injection.mjs`).
 */

export class ToolBoundaryError extends Error {
  constructor(message, violations = []) {
    super(message);
    this.name = "ToolBoundaryError";
    this.violations = violations;
  }
}

/** Verber der aldrig må være et agentværktøj: fri shell, eval og subprocess. */
export const FORBIDDEN_VERB_PATTERN =
  /(^|[.\-_])(shell|sh|bash|zsh|cmd|command|exec|execute|eval|spawn|subprocess|sudo|powershell|os[.\-_]?system|run[.\-_]?command)([.\-_]|$)/i;

/** Verber der henter eller afslører secret-materiale. `rotate-credential` er ikke omfattet. */
export const SECRET_FETCH_PATTERN =
  /(^|[.\-_])(fetch|get|read|reveal|dump|list|show|extract|export|leak)([.\-_])?(secret|secrets|credential|credentials|token|password|passwd|apikey|private[.\-_]?key|key)s?([.\-_]|$)/i;

/** Parameternavne der ikke må optræde i et værktøjskald, uanset værktøj. */
export const FORBIDDEN_PARAM_KEYS = new Set([
  "shell",
  "command",
  "cmd",
  "bash",
  "sh",
  "exec",
  "execute",
  "eval",
  "script",
  "spawn",
  "subprocess",
  "argv",
  "sudo",
  "chmod",
  "chown",
  "token",
  "accessToken",
  "access_token",
  "secret",
  "clientSecret",
  "client_secret",
  "password",
  "passwd",
  "apikey",
  "apiKey",
  "api_key",
  "privateKey",
  "private_key",
  "aws_access_key_id",
  "aws_secret_access_key",
  "authorization",
  "bearer",
]);

/**
 * Standardallowlisten. `network: false` betyder at værktøjet slet ikke må
 * kontakte nettet; et URL-parameter afvises derfor. Ellers gælder
 * `allowedSchemes`/`allowedHosts` (eksakt eller `*.suffix`).
 */
export const TOOL_REGISTRY = [
  {
    name: "observe.read",
    verbs: ["observe.read", "observe.correlate", "diagnose", "health", "slo", "subject.locate", "retention.policy"],
    description: "Læsende observation og diagnostik. Ingen mutation, intet udgående netværk.",
    params: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", maxLength: 2000 },
        windowMinutes: { type: "integer", minimum: 1, maximum: 1440 },
        format: { type: "string", enum: ["json", "text"] },
        resource: { type: "string", maxLength: 200 },
      },
    },
    maxInputBytes: 8192,
    egress: { network: false },
  },
  {
    name: "propose",
    verbs: ["propose"],
    description: "Fremlæg et forslag. Forslag er ikke en eksekvering og har ingen egress.",
    params: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string", maxLength: 4000 },
        diffUri: { type: "string", maxLength: 500 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    maxInputBytes: 8192,
    egress: { network: false },
  },
  {
    name: "upgrade.dry-run",
    verbs: ["upgrade.dry-run", "verify-restore"],
    description: "Tør-kør en ændring/et restore mod et godkendt modul-endpoint.",
    params: {
      type: "object",
      additionalProperties: true,
      maxProperties: 50,
      maxBytes: 8192,
      properties: {
        targetVersion: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+([-+][A-Za-z0-9.-]+)?$" },
        endpoint: { type: "string", format: "uri", maxLength: 500 },
        snapshotId: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,128}$" },
      },
    },
    maxInputBytes: 8192,
    egress: {
      network: true,
      allowedSchemes: ["https"],
      allowedHosts: ["module.dummy-ok.svc.platform.example.org", "gitops.platform.example.org"],
    },
  },
  {
    name: "upgrade.apply",
    verbs: ["upgrade", "upgrade.patch", "upgrade.minor", "upgrade.major", "restart", "scale", "drain", "config.apply", "migrate", "migrate.schema", "rollback"],
    description: "Muterende ops-handling mod et godkendt modul. Kun allowlistede værter.",
    params: {
      type: "object",
      additionalProperties: true,
      maxProperties: 50,
      maxBytes: 8192,
      properties: {
        targetVersion: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+([-+][A-Za-z0-9.-]+)?$" },
        replicas: { type: "integer", minimum: 0, maximum: 100 },
        strategy: { type: "string", enum: ["rolling", "blue-green", "canary", "recreate"] },
        endpoint: { type: "string", format: "uri", maxLength: 500 },
        parameters: {
          type: "object",
          additionalProperties: true,
          maxProperties: 50,
          maxBytes: 8192,
        },
      },
    },
    maxInputBytes: 16384,
    egress: {
      network: true,
      allowedSchemes: ["https"],
      allowedHosts: ["module.dummy-ok.svc.platform.example.org", "gitops.platform.example.org", "registry.platform.example.org"],
    },
  },
  {
    name: "credential.rotate",
    verbs: ["rotate-credential"],
    description: "Rotér en credential reference. Selve secret-materialet forlader aldrig KMS-brokeren.",
    params: {
      type: "object",
      additionalProperties: false,
      properties: {
        credentialRef: { type: "string", pattern: "^[A-Za-z0-9_.:/-]{1,200}$" },
        reason: { type: "string", maxLength: 500 },
      },
    },
    maxInputBytes: 4096,
    egress: { network: false },
  },
  {
    name: "backup.restore",
    verbs: ["backup", "restore"],
    description: "Tag/gendan en snapshot mod det godkendte backup-lager.",
    params: {
      type: "object",
      additionalProperties: false,
      properties: {
        snapshotId: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,128}$" },
        storageUri: { type: "string", format: "uri", maxLength: 500 },
        restorePoint: { type: "string", format: "date-time" },
      },
    },
    maxInputBytes: 8192,
    egress: { network: true, allowedSchemes: ["https"], allowedHosts: ["storage.platform.example.org"] },
  },
  {
    name: "subject.privacy",
    verbs: ["subject.export", "subject.erase", "subject.legal_hold"],
    description: "Privacy-verber. Kunden er implicit den aktive tenant; cross-tenant er forbudt.",
    params: {
      type: "object",
      additionalProperties: false,
      properties: {
        subjectRef: { type: "string", pattern: "^[A-Za-z0-9_.:@-]{1,200}$" },
        format: { type: "string", enum: ["json", "csv", "pdf"] },
        reason: { type: "string", maxLength: 500 },
      },
    },
    maxInputBytes: 4096,
    egress: { network: false },
  },
];

/** Byg et konservativt, typet værktøj for et deklareret, men ukendt ops-verbum. */
export function genericToolForVerb(verb) {
  return {
    name: `generic:${verb}`,
    verbs: [verb],
    generic: true,
    description: "Generisk, muterende ops-værktøj for et deklareret verbum uden eget typeskema. Ingen egress.",
    params: { type: "object", additionalProperties: true, maxProperties: 50, maxBytes: 8192 },
    maxInputBytes: 8192,
    egress: { network: false },
  };
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

/**
 * Validér én værdi mod et lille, deklarativt typeskema. Returnerer en liste af
 * `{ path, message }` — tom listen betyder gyldig.
 */
export function validateParams(schema, value, path = "/parameters") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push({ path, message: `forventede '${schema.type}', fik '${typeName(value)}'` });
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `skal være en af [${schema.enum.join(", ")}]` });
  }
  if (typeof value === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `matcher ikke mønsteret ${schema.pattern}` });
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: `kortere end ${schema.minLength}` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, message: `længere end ${schema.maxLength}` });
    if (schema.format === "uri" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) errors.push({ path, message: "skal være en absolut URI" });
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push({ path, message: "skal være en ISO-8601 dato-tid" });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `mindre end ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `større end ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `færre end ${schema.minItems} elementer` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: `flere end ${schema.maxItems} elementer` });
    if (schema.items) value.forEach((item, i) => errors.push(...validateParams(schema.items, item, `${path}/${i}`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push({ path, message: `flere end ${schema.maxProperties} felter` });
    if (schema.maxBytes !== undefined && serializedBytes(value) > schema.maxBytes) errors.push({ path, message: `større end ${schema.maxBytes} bytes` });
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push({ path: `${path}/${key}`, message: "påkrævet felt mangler" });
    }
    const props = schema.properties ?? {};
    for (const key of keys) {
      if (!(key in props)) {
        if (schema.additionalProperties === false) errors.push({ path: `${path}/${key}`, message: "ukendt felt" });
        continue;
      }
      errors.push(...validateParams(props[key], value[key], `${path}/${key}`));
    }
  }
  return errors;
}

/** Gå rekursivt gennem parametrene og find farlige nøgler og tenant-felter. */
function walkParams(value, visit, path = "/parameters") {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkParams(item, visit, `${path}/${i}`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(key, child, `${path}/${key}`);
    walkParams(child, visit, `${path}/${key}`);
  }
}

const TENANT_KEYS = new Set(["tenantId", "tenant_id", "tenant", "customerId", "customer_id", "destinationTenant", "destination_tenant", "targetTenant", "sourceTenant", "moveToTenant"]);

/** Afvis farlige parameternavne og URL'er i fri tekst. */
export function findForbiddenParams(params) {
  const errors = [];
  walkParams(params, (key, value, path) => {
    if (FORBIDDEN_PARAM_KEYS.has(key)) errors.push({ path, message: `parameternavnet '${key}' er forbudt (secret/shell)` });
    if (typeof value === "string" && /(^|\s)(curl|wget|nc|ncat|bash|sh)\s+-/i.test(value)) {
      errors.push({ path, message: "fri shell-kommando i parameter" });
    }
  });
  return errors;
}

function collectUrls(value, out = [], path = "/parameters") {
  if (typeof value === "string") {
    // Kun netværksskemaer er egress; `kms://`, `spiffe://` og `res://` er
    // interne referencer, ikke udgående trafik.
    if (/^(https?|ftps?|wss?|gopher|file):\/\//i.test(value)) out.push({ path, url: value });
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectUrls(item, out, `${path}/${i}`));
    return out;
  }
  for (const [key, child] of Object.entries(value)) collectUrls(child, out, `${path}/${key}`);
  return out;
}

function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal" || h === "169.254.169.254" || h === "fd00:ec2::254") return true;
  // IPv4 private/beskyttede områder.
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  // IPv6 loopback/unique-local/link-local.
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

function hostAllowed(host, allowedHosts = []) {
  const h = host.toLowerCase();
  return allowedHosts.some((allowed) => {
    const a = allowed.toLowerCase();
    if (a.startsWith("*.")) return h === a.slice(2) || h.endsWith(a.slice(1));
    return h === a;
  });
}

/**
 * Validér udgående netværk og tenant-adskillelse for et værktøjskald.
 */
export function validateEgress({ tool, params = {}, tenantId = null } = {}) {
  const errors = [];
  const network = tool?.egress?.network === true;
  const urls = collectUrls(params);
  if (urls.length > 0 && !network) {
    errors.push({ path: "/parameters", message: `værktøjet '${tool?.name ?? "?"}' har ingen udgående netværksadgang` });
  }
  const allowedSchemes = (tool?.egress?.allowedSchemes ?? ["https"]).map((s) => s.replace(":", ""));
  for (const { path, url } of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      errors.push({ path, message: `ugyldig URL '${url}'` });
      continue;
    }
    const scheme = parsed.protocol.replace(":", "");
    if (!["https", "http"].includes(scheme)) {
      errors.push({ path, message: `uunderstøttet URL-skema '${scheme}'` });
      continue;
    }
    if (!allowedSchemes.includes(scheme)) {
      errors.push({ path, message: `skemaet '${scheme}' er ikke tilladt for '${tool?.name}'` });
    }
    if (isPrivateHost(parsed.hostname)) {
      errors.push({ path, message: `værten '${parsed.hostname}' er en privat/metadata-adresse og afvises` });
      continue;
    }
    if (!hostAllowed(parsed.hostname, tool?.egress?.allowedHosts ?? [])) {
      errors.push({ path, message: `værten '${parsed.hostname}' er ikke på værktøjets egress-allowlist` });
    }
  }

  // Cross-tenant: et datamoverings-felt må ikke pege på en anden kunde end den
  // aktive tenant.
  walkParams(params, (key, value, path) => {
    if (TENANT_KEYS.has(key) && value != null && tenantId != null && String(value).toLowerCase() !== String(tenantId).toLowerCase()) {
      errors.push({ path, message: `må ikke flytte data til kunden '${value}' (aktiv tenant er '${tenantId}')` });
    }
  });
  if (params && typeof params === "object" && params.crossTenant === true) {
    errors.push({ path: "/parameters/crossTenant", message: "cross-tenant datamovering er forbudt" });
  }
  return { ok: errors.length === 0, errors, urls: urls.map((u) => u.url) };
}

/**
 * Slå det rette typede værktøj op for et verbum. `allowGeneric` tillader en
 * konservativ fallback for et deklareret, men ukendt ops-verbum.
 */
export function resolveTool({ verb, tool = null, registry = TOOL_REGISTRY, allowGeneric = true } = {}) {
  if (typeof verb !== "string" || verb.trim() === "") {
    return { ok: false, tool: null, errors: [{ path: "/verb", message: "verbet mangler" }] };
  }
  if (FORBIDDEN_VERB_PATTERN.test(verb)) {
    return { ok: false, tool: null, errors: [{ path: "/verb", message: `verbet '${verb}' er et shell-/eval-verbum og kan ikke kaldes` }] };
  }
  if (SECRET_FETCH_PATTERN.test(verb)) {
    return { ok: false, tool: null, errors: [{ path: "/verb", message: `verbet '${verb}' henter secret-materiale og er ikke et tilladt værktøj` }] };
  }
  if (tool) {
    const found = registry.find((t) => t.name === tool);
    if (!found) return { ok: false, tool: null, errors: [{ path: "/tool", message: `værktøjet '${tool}' er ikke på allowlisten` }] };
    if (!found.verbs.includes(verb)) return { ok: false, tool: found, errors: [{ path: "/tool", message: `værktøjet '${tool}' må ikke udføre '${verb}'` }] };
    return { ok: true, tool: found, errors: [] };
  }
  const byVerb = registry.find((t) => t.verbs.includes(verb));
  if (byVerb) return { ok: true, tool: byVerb, errors: [] };
  if (allowGeneric) return { ok: true, tool: genericToolForVerb(verb), errors: [] };
  return { ok: false, tool: null, errors: [{ path: "/verb", message: `intet typet værktøj er registreret for '${verb}'` }] };
}

/**
 * Fuld servervalidering af et værktøjskald. Kaldes før en executor.
 */
export function validateToolCall({ verb, tool = null, params = {}, target = null, tenantId = null, registry = TOOL_REGISTRY, allowGeneric = true } = {}) {
  const resolved = resolveTool({ verb, tool, registry, allowGeneric });
  if (!resolved.ok) return { ok: false, tool: resolved.tool, errors: resolved.errors, params: params ?? {}, egress: null };

  const typed = resolved.tool;
  const normalized = params ?? {};
  const errors = [];

  const paramErrors = validateParams(typed.params, normalized, "/parameters");
  errors.push(...paramErrors);
  errors.push(...findForbiddenParams(normalized));

  const bytes = serializedBytes(normalized);
  if (bytes > (typed.maxInputBytes ?? 8192)) {
    errors.push({ path: "/parameters", message: `parameterstørrelsen ${bytes} bytes overstiger grænsen ${typed.maxInputBytes} for '${typed.name}'` });
  }

  const egress = validateEgress({ tool: typed, params: normalized, tenantId });
  errors.push(...egress.errors);

  return { ok: errors.length === 0, tool: typed, errors, params: normalized, egress };
}

/**
 * Bekvemmelighedsgrænse. Runtimen og CLI'en bruger denne, så samme allowlist og
 * egress-regler gælder overalt.
 */
export function createToolBoundary({ registry = TOOL_REGISTRY, allowGeneric = true } = {}) {
  return {
    registry,
    allowGeneric,
    names: () => registry.map((t) => t.name),
    verbs: () => [...new Set(registry.flatMap((t) => t.verbs))],
    resolve: (args = {}) => resolveTool({ registry, allowGeneric, ...args }),
    validate: (args = {}) => validateToolCall({ registry, allowGeneric, ...args }),
    validateEgress: (args = {}) => validateEgress(args),
  };
}
