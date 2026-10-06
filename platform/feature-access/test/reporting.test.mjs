import { test } from "node:test";
import assert from "node:assert/strict";
import { reportDefinitionProblems, authorizedReportRun, deliverReport } from "../src/index.mjs";
import { PROFILES } from "./support/fixtures.mjs";

const NOW = Date.parse("2025-09-01T08:00:00Z");

function definition(overrides = {}) {
  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "ReportDefinition",
    metadata: {
      name: "payroll",
      version: "1.0.0",
      description: "Månedlig lønrapport til revisor med revalideret adgang.",
      accountableHuman: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Service Owner" },
    },
    id: "payroll",
    version: 1,
    dataSource: { id: "hr-src", systemOfRecord: "HR", classification: "personal", moduleRef: "reporting", fields: ["report_output"] },
    authoritativeDefinition: { systemOfRecord: "HR", definitionRef: "reports/payroll/v1", version: "1", owner: { subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", role: "Service Owner" } },
    recipients: [{ id: "auditor", kind: "external", subject: "oidc|auditor", dataSharingRef: "docs/x" }],
    senderSubject: "oidc|hr.bruger",
    format: "pdf",
    audit: { required: true, retentionDays: 365 },
    parameters: [],
    schedule: { cron: "0 6 * * *", timezone: "Europe/Copenhagen", enabled: true },
    ...overrides,
  };
}

const sender = { id: "oidc|hr.bruger", tenantId: "acme", roles: ["hr-user"], grants: ["reporting.output.read"], claims: {}, verified: true };
const recipient = { id: "oidc|auditor", tenantId: "acme", roles: ["auditor"], grants: [], claims: {}, verified: true };

const rightsFrom = (map) => (subject) => map[subject] ?? null;

test("en kørsel med revaliderede rettigheder giver run og bruger intet creator-token", () => {
  const run = authorizedReportRun({ definition: definition(), rights: rightsFrom({ "oidc|hr.bruger": sender, "oidc|auditor": recipient }), profiles: PROFILES, now: () => NOW });
  assert.equal(run.decision, "run");
  assert.equal(run.sender.decision, "allow");
  assert.equal(run.recipients[0].decision, "allow");
  assert.equal(run.authorization.usedStoredCreatorToken, false);
});

test("et bortfaldet afsendergrundlag giver reauthorize, ikke run", () => {
  const run = authorizedReportRun({ definition: definition(), rights: rightsFrom({ "oidc|auditor": recipient }), profiles: PROFILES, now: () => NOW });
  assert.equal(run.decision, "reauthorize");
  assert.equal(run.authorization.senderResolved, false);
});

test("en afsender uden den nødvendige bevilling giver reauthorize", () => {
  const run = authorizedReportRun({ definition: definition(), rights: rightsFrom({ "oidc|hr.bruger": { ...sender, grants: [] }, "oidc|auditor": recipient }), profiles: PROFILES, now: () => NOW });
  assert.equal(run.decision, "reauthorize");
});

test("en modtager der har mistet rettigheden stopper rapporten", () => {
  const run = authorizedReportRun({ definition: definition(), rights: rightsFrom({ "oidc|hr.bruger": sender }), profiles: PROFILES, now: () => NOW });
  assert.equal(run.decision, "blocked");
  assert.equal(run.authorization.recipientsResolved, false);
});

test("en modtager i en anden tenant afvises", () => {
  const foreign = { ...recipient, tenantId: "globex" };
  const run = authorizedReportRun({ definition: definition(), rights: rightsFrom({ "oidc|hr.bruger": sender, "oidc|auditor": foreign }), profiles: PROFILES, now: () => NOW });
  assert.equal(run.decision, "blocked");
  assert.match(run.recipients[0].reason, /anden tenant/);
});

test("afsendelse gentager revalideringen og leverer intet ved tab", () => {
  const valid = authorizedReportRun({ definition: definition(), rights: rightsFrom({ "oidc|hr.bruger": sender, "oidc|auditor": recipient }), profiles: PROFILES, now: () => NOW });
  const delivered = deliverReport({ run: valid, definition: definition(), rights: rightsFrom({ "oidc|hr.bruger": sender }), profiles: PROFILES, now: () => NOW + 1000 });
  assert.equal(delivered.decision, "blocked");
  assert.deepEqual(delivered.delivered, []);
  const ok = deliverReport({ run: valid, definition: definition(), rights: rightsFrom({ "oidc|hr.bruger": sender, "oidc|auditor": recipient }), profiles: PROFILES, now: () => NOW + 1000 });
  assert.deepEqual(ok.delivered, ["auditor"]);
  assert.ok(ok.recipients[0].deliveredAt);
});

test("en rapportdefinition må ikke bære et token i stedet for en afsenderidentitet", () => {
  assert.ok(reportDefinitionProblems(definition({ senderSubject: "eyJhbGciOiJIUzI1NiJ9.abc.def" })).some((p) => /token/.test(p.message)));
  assert.equal(reportDefinitionProblems(definition()).length, 0);
});
