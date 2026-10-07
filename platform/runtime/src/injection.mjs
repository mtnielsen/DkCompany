/**
 * DKC-011 — prompt-injection-signaler (flersproget, med decoding).
 *
 * VIGTIGT: dette er **kun et ekstra signal**. Sikkerheden hviler på den
 * arkitektoniske grænse — ubetroet indhold er data (`untrusted.mjs`) og kan
 * kun blive et eksekverbart kald gennem den servervaliderede værktøjsgrænse
 * (`tools.mjs`). Et injektionsforsøg der formuleres så det undgår regex, kan
 * derfor stadig ikke udvide rettigheder. Scanneren her eskalerer til et
 * menneske, når den ser et kendt mønster, men et negativt svar er ikke en
 * tilladelse.
 *
 * Scanneren dækker dansk, engelsk, kodede (base64, hex, rot13, unicode-escape,
 * HTML-entities, procent-encoding) og indirekte instruktioner fra logs,
 * dokumenter, mails, tool-output og model-output.
 */

export const INJECTION_CATEGORIES = [
  "ignore-instructions",
  "role-override",
  "autonomy-change",
  "self-approve",
  "secret-exfiltration",
  "shell-execution",
  "destructive",
  "unauthorized-egress",
  "cross-tenant",
  "indirect",
  "tool-call-forgery",
];

/**
 * Mønstre pr. kategori. `lang` er dokumentation af dækningen. Rækkefølgen er
 * uden betydning; alle matches rapporteres.
 */
export const PATTERNS = [
  // --- Ignorér tidligere instruktioner (dansk + engelsk + indirekte) ----------
  { id: "ignore-previous-en", category: "ignore-instructions", lang: "en", re: /\b(ignore|forget|disregard|override)\b[^.\n]{0,40}\b(previous|above|prior|earlier|all)\b[^.\n]{0,30}\b(instruction|prompt|rule|context|message)/i },
  { id: "ignore-previous-da", category: "ignore-instructions", lang: "da", re: /\b(ignor[ée]r|glem|tilsides[æa]t|overskriv)\b[^.\n]{0,40}\b(tidligere|ovenst[åa]ende|forrige|alle)\b[^.\n]{0,30}\b(instruktion|prompt|regel|kontekst|besked)/i },
  { id: "indirect-en", category: "indirect", lang: "en", re: /\b(if you are|if you're|when you read|note to (the )?(ai|assistant|agent)|attention (ai|assistant|agent))\b[^.\n]{0,60}\b(ignore|disregard|do|execute|run|send|fetch|delete)/i },
  { id: "indirect-da", category: "indirect", lang: "da", re: /\b(hvis du er|når du l[æa]ser|bem[æa]rk til (ai|assistenten|agenten)|opm[æa]rksomhed (ai|assistent|agent))\b[^.\n]{0,60}\b(ignor[ée]r|udf[øo]r|k[øo]r|send|hent|slet)/i },

  // --- Rolleskift / falske systembeskeder -------------------------------------
  { id: "role-override-en", category: "role-override", lang: "en", re: /\b(you are now|act as|new instructions?\s*:|system\s*:|developer\s*:|assistant\s*:)/i },
  { id: "role-override-da", category: "role-override", lang: "da", re: /\b(du er nu|optr[æa]d som|funger som|nye instruktioner\s*:|system\s*:)/i },
  { id: "chat-template", category: "role-override", lang: "mixed", re: /(\[\/?INST\]|<<SYS>>|<\/?system>|<\|im_start\|>|<\|im_end\|>|###\s*(system|instruction))/i },

  // --- Autonomi-ændring --------------------------------------------------------
  { id: "autonomy-change-en", category: "autonomy-change", lang: "en", re: /\b(raise|increase|set|bump|elevate|grant)\b[^.\n]{0,30}\b(autonomy|autonomyclass|privilege|permission|scope)\b/i },
  { id: "autonomy-change-da", category: "autonomy-change", lang: "da", re: /\b(h[æa]v|[øo]g|s[æa]t|forh[øo]j|giv)\b[^.\n]{0,30}\b(autonomi|autonomiklasse|rettighed|bef[øo]jelse|adgang)\b/i },

  // --- Selvgodkendelse ---------------------------------------------------------
  { id: "self-approve-en", category: "self-approve", lang: "en", re: /\b(approve (this|the) (change|request|plan)|mark .{0,20}approved|auto-?approve|pre-?approved)\b/i },
  { id: "self-approve-da", category: "self-approve", lang: "da", re: /\b(godkend|approb[ée]r)\b[^.\n]{0,20}\b(denne|ændringen|anmodningen|forslaget|planen)\b/i },

  // --- Secret-eksfiltrering / -hentning ---------------------------------------
  { id: "exfiltration-en", category: "secret-exfiltration", lang: "en", re: /\b(exfiltrate|leak|upload|send|post|curl|wget)\b[^.\n]{0,40}\b(secrets?|tokens?|keys?|credentials?|passwords?|\.env|api[_-]?keys?)\b/i },
  { id: "exfiltration-da", category: "secret-exfiltration", lang: "da", re: /\b(eksfiltr[ée]r|l[æa]k|upload|send|hent|udlev[ée]r)\b[^.\n]{0,40}\b(hemmelighed(er|en)?|n[øo]gler?|n[øo]glen?|adgangskode[rn]?|tokens?|credentials?|\.env)\b/i },

  // --- Fri shell ----------------------------------------------------------------
  { id: "shell-en", category: "shell-execution", lang: "en", re: /\b(run|execute|invoke|spawn)\b[^.\n]{0,25}\b(shell|bash|cmd|command|script|subprocess|powershell)\b/i },
  { id: "shell-da", category: "shell-execution", lang: "da", re: /\b(k[øo]r|udf[øo]r|start)\b[^.\n]{0,25}\b(kommando|shell|bash|script|terminal)\b/i },

  // --- Destruktivt ---------------------------------------------------------------
  { id: "destructive-en", category: "destructive", lang: "en", re: /\b(rm\s+-rf|drop\s+table|delete\s+all|truncate\s+table|wipe|format\s+disk)\b/i },
  { id: "destructive-da", category: "destructive", lang: "da", re: /\b(slet|fjern|nulstil|slet alt)\b[^.\n]{0,20}\b(alt|alle data|databasen|tabellerne|backup)\b/i },

  // --- Uautoriserede URL'er / cross-tenant ---------------------------------------
  { id: "unauthorized-egress", category: "unauthorized-egress", lang: "mixed", re: /\b(curl|wget|fetch|http\.get|requests\.get)\s+https?:\/\//i },
  { id: "metadata-endpoint", category: "unauthorized-egress", lang: "mixed", re: /(169\.254\.169\.254|metadata\.google\.internal|fd00:ec2::254)/i },
  { id: "cross-tenant", category: "cross-tenant", lang: "mixed", re: /\b(copy|move|transfer|sync|flyt|kopi[ée]r|overf[øo]r)\b[^.\n]{0,40}\b(customer|tenant|kunde)\b[^.\n]{0,20}\b(to|til|into)\b[^.\n]{0,25}\b(customer|tenant|kunde)\b/i },

  // --- Forfalsket værktøjskald i teksten -----------------------------------------
  { id: "tool-call-forgery", category: "tool-call-forgery", lang: "mixed", re: /("?(tool_call|function_call|tool_calls|"tool"\s*:)"?|<\s*tool[_-]?call|BEGIN\s+TOOL)/i },
];

/** Dekodningsvarianter. `plain` er altid med. */
export const ENCODINGS = ["plain", "url", "base64", "hex", "rot13", "unicode", "html"];

function decodeUrl(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

function decodeBase64(text) {
  const out = [];
  for (const token of text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      if (/[\x20-\x7e\u00a0-\uffff]{6,}/.test(decoded)) out.push(decoded);
    } catch {
      /* ignorér ugyldig base64 */
    }
  }
  return out.join("\n");
}

function decodeHex(text) {
  const out = [];
  for (const token of text.match(/(?:[0-9a-fA-F]{2}){8,}/g) ?? []) {
    try {
      const decoded = Buffer.from(token, "hex").toString("utf8");
      if (/[\x20-\x7e\u00a0-\uffff]{6,}/.test(decoded)) out.push(decoded);
    } catch {
      /* ignorér ugyldig hex */
    }
  }
  return out.join("\n");
}

function decodeRot13(text) {
  return text.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function decodeUnicode(text) {
  try {
    return text.replace(/\\u\{?([0-9a-fA-F]{2,6})\}?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  } catch {
    return text;
  }
}

function decodeHtml(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Returnér `{ encoding, text }` for hver dekodningsvariant (inkl. plain). */
export function decodeVariants(text) {
  if (typeof text !== "string") return [];
  const variants = [{ encoding: "plain", text }];
  const url = decodeUrl(text);
  if (url !== text) variants.push({ encoding: "url", text: url });
  const base64 = decodeBase64(text);
  if (base64) variants.push({ encoding: "base64", text: base64 });
  const hex = decodeHex(text);
  if (hex) variants.push({ encoding: "hex", text: hex });
  const rot13 = decodeRot13(text);
  if (rot13 !== text) variants.push({ encoding: "rot13", text: rot13 });
  const unicode = decodeUnicode(text);
  if (unicode !== text) variants.push({ encoding: "unicode", text: unicode });
  const html = decodeHtml(text);
  if (html !== text) variants.push({ encoding: "html", text: html });
  return variants;
}

/**
 * Scan ubetroet tekst. Returnerer `{ flagged, findings, categories, signals,
 * decoded }`. `findings` er stabile id'er, så eksisterende kaldere kan bruge
 * dem direkte. Regex/décoding er et *signal* — ikke en adgangskontrol.
 */
export function scanUntrusted(text, { decode = true } = {}) {
  const findings = [];
  const categories = new Set();
  const signals = [];
  if (typeof text !== "string" || text.length === 0) return { flagged: false, findings, categories: [], signals, decoded: [] };

  const variants = decode ? decodeVariants(text) : [{ encoding: "plain", text }];
  const decoded = [];
  for (const variant of variants) {
    if (variant.encoding !== "plain") decoded.push(variant.encoding);
    for (const pattern of PATTERNS) {
      if (pattern.re.test(variant.text)) {
        if (!findings.includes(pattern.id)) findings.push(pattern.id);
        categories.add(pattern.category);
        signals.push({ id: pattern.id, category: pattern.category, lang: pattern.lang, encoding: variant.encoding });
      }
    }
  }
  return { flagged: findings.length > 0, findings, categories: [...categories], signals, decoded: [...new Set(decoded)] };
}

/** Scan en liste af ubetroede konvolutter (eller strenge) samlet. */
export function scanAll(inputs) {
  const findings = new Set();
  const categories = new Set();
  const signals = [];
  for (const input of inputs ?? []) {
    const text = typeof input === "string" ? input : input?.text;
    const result = scanUntrusted(text);
    result.findings.forEach((f) => findings.add(f));
    result.categories.forEach((c) => categories.add(c));
    signals.push(...result.signals);
  }
  return { flagged: findings.size > 0, findings: [...findings], categories: [...categories], signals };
}
