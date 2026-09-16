/**
 * Prompt-injection-værn.
 *
 * Utroværdigt input (logs, issues, changelogs) må ikke kunne ændre agentens
 * plan, autonomiklasse eller godkendelseskrav. Vi scanner indholdet for typiske
 * instruktionsmønstre; findes de, eskalerer runtimes til et menneske i stedet
 * for at handle på det.
 */
const PATTERNS = [
  { id: "ignore-previous", re: /\b(ignore|forget|disregard)\b[^.\n]{0,40}\b(previous|above|prior|all)\b[^.\n]{0,30}\b(instruction|prompt|rule|context)/i },
  { id: "role-override", re: /\b(you are now|act as|new instructions?\s*:|system\s*:)/i },
  { id: "autonomy-change", re: /\b(raise|increase|set|bump)\b[^.\n]{0,30}\b(autonomy|autonomiklasse|autonomyclass)\b/i },
  { id: "self-approve", re: /\b(approve (this|the) (change|request)|mark .{0,20}approved|auto-?approve)\b/i },
  { id: "exfiltration", re: /\b(exfiltrate|leak|upload .{0,20}(secret|token|key)|curl\s+http|wget\s+http)\b/i },
  { id: "destructive", re: /\b(rm\s+-rf|drop\s+table|delete\s+all|truncate\s+table)\b/i },
];

export function scanUntrusted(text) {
  const findings = [];
  if (typeof text !== "string") return { flagged: false, findings };
  for (const pattern of PATTERNS) {
    if (pattern.re.test(text)) findings.push(pattern.id);
  }
  return { flagged: findings.length > 0, findings };
}
