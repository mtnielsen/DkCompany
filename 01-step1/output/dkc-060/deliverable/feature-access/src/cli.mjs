#!/usr/bin/env node
/**
 * DKC-060 — CLI for tværgående IAM og dataadgang.
 *
 *   node feature-access/src/cli.mjs check   # kør kontrollen
 *   node feature-access/src/cli.mjs demo    # kør et kontrolleret forløb
 */
import { loadProfiles, indexProfiles } from "./profiles.mjs";
import { decideAccess, evaluateAcrossSurfaces, surfaceConsistencyProblems, filterRows } from "./access.mjs";
import { planOffboarding, executeOffboarding, createMemoryOffboardingStore, seedRights } from "./offboarding.mjs";
import { authorizedReportRun, deliverReport } from "./reporting.mjs";
import { createGuardedConnector } from "./connector-guard.mjs";
import { collectProblems } from "./check.mjs";

const NOW = Date.parse("2025-09-01T08:00:00Z");
const PROFILES = indexProfiles(loadProfiles());

function line(title, value) {
  console.log(`  ${title.padEnd(46)} ${value}`);
}

async function demo() {
  console.log("DKC-060 demo — BI vs. HR, rapportering og offboarding\n");

  const biUser = { id: "oidc|bi.bruger", tenantId: "acme", roles: ["bi-user"], grants: [], claims: { department: "finance" }, verified: true };
  const hrUser = { id: "oidc|hr.bruger", tenantId: "acme", roles: ["hr-user"], grants: ["hr.salary.read", "hr.department.read"], claims: { department: "hr" }, verified: true };

  const biSalary = decideAccess({ principal: biUser, profile: PROFILES.bi, resource: { tenantId: "acme", type: "dataset", localId: "employees" }, fields: ["salary", "metric"] });
  line("BI-bruger mod feltet salary", `${biSalary.decision} (nægtet: ${biSalary.deniedFields.join(", ") || "—"})`);

  const hrSalary = decideAccess({ principal: hrUser, profile: PROFILES.hr, resource: { tenantId: "acme", type: "employee", localId: "e-1" }, fields: ["salary", "employee_name"] });
  line("HR-bruger (lønbevilling) mod salary", hrSalary.decision);

  const surfaces = evaluateAcrossSurfaces({ principal: biUser, profile: PROFILES.bi, resource: { tenantId: "acme", type: "dataset", localId: "employees" }, fields: ["salary"] });
  line("Flader med samme svar", `${surfaces.length} flader, afvigelser: ${surfaceConsistencyProblems({ principal: biUser, profile: PROFILES.bi, resource: { tenantId: "acme", type: "dataset", localId: "employees" }, fields: ["salary"] }).length}`);

  const rows = [
    { id: "r1", tenantId: "acme", attributes: { subject: "oidc|hr.bruger", department: "hr" } },
    { id: "r2", tenantId: "acme", attributes: { subject: "oidc|anden.bruger", department: "finance" } },
    { id: "r3", tenantId: "globex", attributes: { subject: "oidc|hr.bruger", department: "hr" } },
  ];
  const visible = filterRows({ principal: hrUser, profile: PROFILES.hr, rows });
  line("Rækker synlige for HR-bruger", visible.map((r) => r.id).join(", ") || "ingen");

  const definition = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ReportDefinition",
    id: "payroll",
    version: 1,
    dataSource: { id: "hr-src", systemOfRecord: "HR", classification: "personal", moduleRef: "reporting", fields: ["report_output"] },
    recipients: [{ id: "auditor", kind: "external", subject: "oidc|auditor", dataSharingRef: "docs/x" }],
    senderSubject: "oidc|hr.bruger",
    format: "pdf",
    audit: { required: true },
  };
  let rights = { "oidc|hr.bruger": { ...hrUser, grants: ["reporting.output.read", "hr.department.read"] }, "oidc|auditor": { id: "oidc|auditor", tenantId: "acme", roles: ["auditor"], grants: [] } };
  const run = authorizedReportRun({ definition, rights: (s) => rights[s] ?? null, profiles: PROFILES, now: () => NOW });
  line("Rapportkørsel med gyldige rettigheder", run.decision);
  const revoked = authorizedReportRun({ definition, rights: (s) => (s === "oidc|auditor" ? null : rights[s]), profiles: PROFILES, now: () => NOW });
  line("Rapportkørsel efter modtager-tab", revoked.decision);
  const delivered = deliverReport({ run, definition, rights: (s) => (s === "oidc|auditor" ? null : rights[s]), profiles: PROFILES, now: () => NOW });
  line("Afsendelse efter modtager-tab", `leveret: ${delivered.delivered.length}`);

  const store = createMemoryOffboardingStore();
  seedRights(store, "oidc|forlader", {
    sessions: [{ id: "s1" }],
    "api-tokens": [{ id: "t1" }],
    shares: [{ id: "sh1" }],
    "scheduled-workflows": [{ id: "w1" }],
    "ai-tool-grants": [{ id: "a1" }],
  });
  const plan = planOffboarding({ subject: "oidc|forlader", deadlineSeconds: 600, now: NOW });
  const result = executeOffboarding({ plan, store, now: () => NOW + 1000 });
  line("Offboarding", `${result.status}, udestående: ${result.outstanding.length}`);

  const calls = [];
  const guard = createGuardedConnector({
    connector: { query: async (principal, sql, params) => calls.push({ sql, params }) ?? { rowCount: 1, rows: [] } },
    templates: [{ id: "salary-by-period", sql: "select salary from hr.payroll where period = ?", parameters: [{ name: "period", required: true }] }],
  });
  const service = { id: "svc|reporting", tenantId: "acme", roles: ["service-account"], grants: ["read:hr"], verified: true };
  await guard.query(service, { templateId: "salary-by-period", params: { period: "2025-09" } });
  line("Beskyttet connector", `${calls.length} godkendt forespørgsel`);
  return { biSalary, hrSalary, run, revoked, result };
}

async function main() {
  const command = process.argv[2] ?? "check";
  if (command === "check") {
    const { problems, profiles } = collectProblems();
    if (problems.length) {
      console.error("✘ DKC-060-kontrol fejlede:\n");
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`✔ ${profiles.length} funktionsprofiler og alle kontrakteksempler valideret`);
    return;
  }
  if (command === "demo") {
    await demo();
    return;
  }
  console.error(`Ukendt kommando '${command}'. Brug 'check' eller 'demo'.`);
  process.exit(2);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
