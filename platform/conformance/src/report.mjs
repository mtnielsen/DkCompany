/**
 * Rapportmodel for conformance-suiten.
 *
 * Statusser:
 *   pass  — kravet er opfyldt
 *   fail  — kravet er brudt; suiten fejler
 *   skip  — kravet kunne ikke afgøres (fx probe uden netværk); tæller ikke som pass
 */

const STATUS_ORDER = ["fail", "skip", "pass"];

export function createReport({ module, version, suiteVersion = "0.1.0", startedAt = new Date().toISOString() }) {
  return { module, version, suiteVersion, startedAt, finishedAt: null, checks: [] };
}

export function addCheck(report, { id, title, status, detail = "", messages = [] }) {
  if (!["pass", "fail", "skip"].includes(status)) throw new Error(`Ugyldig status: ${status}`);
  report.checks.push({ id, title, status, detail, messages });
}

export function finalize(report) {
  report.finishedAt = new Date().toISOString();
  report.summary = summarize(report.checks);
  report.status = report.summary.fail > 0 ? "fail" : "pass";
  return report;
}

export function summarize(checks) {
  const s = { pass: 0, fail: 0, skip: 0, total: checks.length };
  for (const c of checks) s[c.status] += 1;
  return s;
}

export function exitCode(report) {
  return report.status === "pass" ? 0 : 1;
}

const ICONS = { pass: "✔", fail: "✘", skip: "•" };
const COLORS = { pass: "\x1b[32m", fail: "\x1b[31m", skip: "\x1b[33m", reset: "\x1b[0m" };

export function formatText(report, { color = process.stdout.isTTY } = {}) {
  const c = (s, code) => (color ? `${COLORS[code]}${s}${COLORS.reset}` : s);
  const lines = [];
  lines.push(`Konformansrapport — ${report.module}@${report.version}`);
  lines.push(`suite ${report.suiteVersion} · startet ${report.startedAt}`);
  lines.push("");
  for (const chk of report.checks.slice().sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))) {
    lines.push(`  ${c(ICONS[chk.status], chk.status)} ${chk.id}  ${chk.title}`);
    if (chk.detail) lines.push(`      ${chk.detail}`);
    for (const m of chk.messages) lines.push(`      - ${m}`);
  }
  lines.push("");
  const s = report.summary;
  lines.push(s.fail === 0
    ? c(`RESULTAT: PASS  (${s.pass} pass, ${s.skip} skip, ${s.fail} fail)`, "pass")
    : c(`RESULTAT: FAIL  (${s.pass} pass, ${s.skip} skip, ${s.fail} fail)`, "fail"));
  return lines.join("\n");
}

/** Shields.io endpoint-format, så badge kan committes/udstilles. */
export function toBadge(report) {
  const s = report.summary;
  return {
    schemaVersion: 1,
    label: "conformance",
    message: s.fail === 0 ? `${s.pass}/${s.total} pass` : `${s.fail} fail`,
    color: s.fail === 0 ? "brightgreen" : "red",
  };
}
