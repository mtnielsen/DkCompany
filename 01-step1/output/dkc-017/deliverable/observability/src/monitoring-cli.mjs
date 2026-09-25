#!/usr/bin/env node
/**
 * DKC-017 — CLI for overvågning: status og alarmøvelse.
 *
 *   node observability/src/monitoring-cli.mjs posture [--out <mappe>] [--now <ISO>]
 *   node observability/src/monitoring-cli.mjs drill   [--out <mappe>] [--now <ISO>]
 *
 * `posture` bygger sikkerhedsstatussen fra sensorkataloget og de committede
 * scannerfund. `drill` fremkalder en tjenestefejl og en backupfejl (og en
 * forældet sensor), evaluerer alarmreglerne, leverer til en lokal testmodtager,
 * eskalerer, kvitterer og løser — og skriver notifikationer og hændelsesforløb
 * til `.conformance-out/monitoring/`. Rå persondata indgår ikke i notifikationen.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSensorRegistry, securityPosture } from "./sensors.mjs";
import { createLocalMailbox, createWebhookTransport, dispatchAlerts, escalateIncident, acknowledgeIncident, resolveIncident } from "./alerts.mjs";
import { alertRuleSetProblems } from "../../conformance/src/monitoring.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");
const DEFAULT_OUT = join(repoRoot, ".conformance-out", "monitoring");

function loadFindings(root) {
  const path = join(root, "security", "generated", "security-findings.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { reports: [] };
}

/**
 * Udled scanner-/runtime-sensorenes målinger fra de normaliserede fund. Hver
 * rapport bærer sin egen `capturedAt` og `status`, så sensorens friskhed og
 * fundstatus kommer fra den faktiske kørsel — ikke fra en pladsholder.
 */
const SCANNER_SENSOR = { trivy: "trivy-fs", falco: "falco-runtime", wazuh: "wazuh-siem" };

export function sourcesFromFindings(findings) {
  const sources = {};
  for (const report of findings?.reports ?? []) {
    const id = SCANNER_SENSOR[report.scanner];
    if (id) sources[id] = { capturedAt: report.capturedAt, status: report.status };
  }
  return sources;
}

function parseArgs(argv) {
  const args = { command: argv[0] ?? "posture", out: DEFAULT_OUT, now: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = resolve(argv[++i]);
    else if (a === "--now") args.now = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`ukendt argument: ${a}`);
  }
  return args;
}

function nowMs(args) {
  return args.now ? Date.parse(args.now) : Date.now();
}

/** Kilder til en normal, frisk situation — bruges som udgangspunkt. */
function freshSources(now, overrides = {}) {
  const at = new Date(now).toISOString();
  const base = {
    "trivy-fs": { capturedAt: at, status: "pass" },
    "falco-runtime": { capturedAt: at, status: "pass" },
    "wazuh-siem": { capturedAt: at, status: "pass" },
    "service-availability": { capturedAt: at, status: "pass", value: 1 },
    "backup-drill": { capturedAt: at, status: "pass" },
    "audit-journal": { capturedAt: at, status: "pass" },
    "credential-revocation": { capturedAt: at, status: "pass" },
  };
  return { ...base, ...overrides };
}

export function runPosture({ root = repoRoot, now = Date.now(), outDir = null } = {}) {
  const registry = loadSensorRegistry(root);
  const findings = loadFindings(root);
  // Scanner-/runtime-sensorerne tager deres tid og status fra de normaliserede
  // fund; de øvrige starter fra en frisk, fejlfri situation. Er samplet gammelt,
  // bliver status ærligt `stale` — ikke grøn.
  const sources = { ...freshSources(now), ...sourcesFromFindings(findings) };
  const posture = securityPosture({ registry, sources, reports: findings.reports, now });
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "posture.json"), JSON.stringify(posture, null, 2) + "\n");
  }
  return posture;
}

/**
 * Kør alarmøvelsen. Returnerer `{ scenarios, notifications, incidents, alerts }`.
 * Kaster hvis en forventet alarm ikke udløses eller ikke leveres.
 */
export async function runDrill({ root = repoRoot, outDir = DEFAULT_OUT, now = Date.now() } = {}) {
  const registry = loadSensorRegistry(root);
  const rules = JSON.parse(readFileSync(join(root, "observability", "alert-rules.json"), "utf8"));
  const findings = loadFindings(root);
  const at = new Date(now).toISOString();
  const halfHour = 30 * 60 * 1000;

  // Scenario 1: tjenestefejl + backupfejl (acceptkriterie 1).
  const failureSources = freshSources(now, {
    "service-availability": { capturedAt: at, status: "fail", value: 0.0 },
    "backup-drill": { capturedAt: at, status: "fail" },
  });
  // Scenario 2: forældet sikkerhedssensor (acceptkriterie 3).
  const staleSources = freshSources(now, {
    "trivy-fs": { capturedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(), status: "pass" },
  });

  const scenarios = [
    { id: "service-and-backup-failure", expect: ["service-unavailable", "backup-failed"], sources: failureSources },
    { id: "stale-security-sensor", expect: ["security-data-stale"], sources: staleSources },
  ];

  if (outDir) rmSync(outDir, { recursive: true, force: true });
  const mailboxDir = outDir ? join(outDir, "mailbox") : null;
  const mailbox = mailboxDir ? createLocalMailbox({ dir: mailboxDir }) : createLocalMailbox({ dir: join(repoRoot, ".conformance-out", "monitoring", "mailbox") });
  const webhook = createWebhookTransport({ url: process.env.DKC_ALERT_WEBHOOK_URL ?? null });
  const transports = (recipient) => (recipient?.type === "webhook" ? webhook : mailbox);

  const { evaluateAlerts } = await import("./alerts.mjs");
  const allResults = [];
  for (const scenario of scenarios) {
    const posture = securityPosture({ registry, sources: scenario.sources, reports: findings.reports, now });
    const alerts = evaluateAlerts({ rules, posture, now, tenantId: "acme" });
    const triggeredRuleIds = alerts.map((a) => a.ruleId);
    for (const expected of scenario.expect) {
      if (!triggeredRuleIds.includes(expected)) throw new Error(`scenarie '${scenario.id}': forventede alarmen '${expected}', men den udløstes ikke`);
    }
    const { notifications, incidents } = await dispatchAlerts({ alerts, transports, now, outDir: outDir ? join(outDir, "scenarios", scenario.id) : null });
    const delivered = notifications.filter((n) => n.delivery.status === "delivered");
    if (delivered.length === 0) throw new Error(`scenarie '${scenario.id}': ingen alarm blev leveret til testmodtageren`);
    allResults.push({ scenario: scenario.id, postureOverall: posture.overall, alerts, notifications, incidents });

    if (outDir) {
      mkdirSync(join(outDir, "scenarios", scenario.id), { recursive: true });
      writeFileSync(join(outDir, "scenarios", scenario.id, "posture.json"), JSON.stringify(posture, null, 2) + "\n");
    }
  }

  // Hændelsesforløb: eskalér, kvitter og løs den første tjenestefejl.
  const primary = allResults[0].incidents[0];
  let incident = escalateIncident(primary, { now: now + 15 * 60 * 1000 });
  incident = acknowledgeIncident(incident, { by: incident.escalation?.[0]?.to ?? incident.owner, now: now + 16 * 60 * 1000, note: "Undersøger tjenesten og backupmål" });
  incident = resolveIncident(incident, { by: incident.owner, now: now + halfHour, note: "Tjeneste genstartet, backupmål rettet" });
  if (outDir) {
    mkdirSync(join(outDir, "incidents"), { recursive: true });
    writeFileSync(join(outDir, "incidents", `${incident.incidentId}.json`), JSON.stringify(incident, null, 2) + "\n");
  }

  const summary = {
    kind: "MonitoringDrill",
    generatedAt: at,
    scenarios: allResults.map((r) => ({
      id: r.scenario,
      postureOverall: r.postureOverall,
      alerts: r.alerts.map((a) => ({ ruleId: a.ruleId, severity: a.severity, owner: a.owner.subject, runbook: a.runbook })),
      delivered: r.notifications.filter((n) => n.delivery.status === "delivered").map((n) => ({ id: n.id, ruleId: n.ruleId, recipient: n.delivery.recipientId, receipt: n.delivery.receipt })),
      notRun: r.notifications.filter((n) => n.delivery.status === "not-run").map((n) => ({ id: n.id, ruleId: n.ruleId, reason: n.delivery.reason })),
    })),
    incidentTimeline: incident.timeline,
  };
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "drill-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  }
  return { ...summary, incident };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) {
    console.log("Brug: node observability/src/monitoring-cli.mjs <posture|drill> [--out <mappe>] [--now <ISO>]");
    return;
  }
  const now = nowMs(args);
  if (args.command === "posture") {
    const posture = runPosture({ now, outDir: args.out });
    console.log(`Sikkerhedsstatus: ${posture.overall}`);
    for (const s of posture.sensors) console.log(`  ${s.status === "pass" ? "✔" : s.status === "fail" ? "✘" : "•"} ${s.id}: ${s.status} (${s.freshness}${s.ageSeconds === null ? "" : `, ${s.ageSeconds}s`})`);
    return;
  }
  if (args.command === "drill") {
    const result = await runDrill({ outDir: args.out, now });
    console.log("Alarmøvelse gennemført:");
    for (const s of result.scenarios) {
      console.log(`  ${s.id}: overall=${s.postureOverall}`);
      for (const a of s.alerts) console.log(`    ⚠ ${a.ruleId} [${a.severity}] → ${a.owner} (${a.runbook})`);
      for (const d of s.delivered) console.log(`      ✔ leveret til ${d.recipient}: ${d.receipt}`);
      for (const n of s.notRun) console.log(`      • ikke kørt (${n.ruleId}): ${n.reason}`);
    }
    console.log(`  Hændelsesforløb: ${result.incident.timeline.map((e) => e.type).join(" → ")}`);
    return;
  }
  console.error(`Ukendt kommando: ${args.command}`);
  process.exit(2);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  });
}
