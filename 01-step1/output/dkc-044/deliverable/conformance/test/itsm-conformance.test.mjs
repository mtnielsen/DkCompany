import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, validate, buildAjv, SCHEMA_IDS } from "../src/schemas.mjs";
import { serviceCatalogProblems, onCallRotationProblems, itsmRecordProblems, validateServiceCatalog, validateOnCallRotationSet, validateItsmRecord } from "../src/itsm.mjs";
import {
  correlateAlarm,
  riskyActionAllowed,
  problemCandidate,
  customerCases,
  majorIncidentCloseProblems,
  serviceProcessProblems,
  assessEditionCombination,
} from "../../modules/itsm-adapter/service/src/serviceregistry.mjs";
import { ITSM_EDITIONS } from "../../modules/itsm-adapter/service/src/constants.mjs";

const read = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const catalog = read("service-registry/services.json");
const rotations = read("service-registry/oncall.json");
const manifest = read("modules/itsm-adapter/module-manifest.json");
const example = read("contracts/examples/itsm-record.example.json");

const OPS_VERBS = ["backup", "restore", "verify-restore", "drain", "upgrade.dry-run", "upgrade", "migrate", "rollback", "health", "slo"];
const PRIVACY_VERBS = ["subject.locate", "subject.export", "subject.erase", "subject.legal_hold", "retention.policy"];

test("servicekataloget validerer (skema + semantik)", () => {
  const { ajv } = buildAjv();
  assert.equal(validateServiceCatalog(catalog, ajv, { root: repoRoot }).ok, true);
  assert.deepEqual(serviceCatalogProblems(catalog, { root: repoRoot }), []);
});

test("on-call-rotationen validerer (skema + semantik)", () => {
  const { ajv } = buildAjv();
  const serviceIds = new Set(catalog.services.map((s) => s.id));
  assert.equal(validateOnCallRotationSet(rotations, ajv, { serviceIds }).ok, true);
  assert.deepEqual(onCallRotationProblems(rotations, { serviceIds }), []);
});

test("eksemplet på en ITSM-record validerer (skema + semantik)", () => {
  const { ajv } = buildAjv();
  const serviceIds = new Set(catalog.services.map((s) => s.id));
  assert.equal(validateItsmRecord(example, ajv, { serviceIds }).ok, true);
  assert.deepEqual(itsmRecordProblems(example, { serviceIds }), []);
});

test("en tjeneste uden menneskelig ejer eller runbook afvises", () => {
  const broken = JSON.parse(JSON.stringify(catalog));
  broken.services[0].owner = { subject: "team:platform" };
  broken.services[0].runbook = "findes/ikke.md";
  const problems = serviceCatalogProblems(broken, { root: repoRoot });
  assert.ok(problems.some((p) => /owner/.test(p.path)));
  assert.ok(problems.some((p) => /runbook/.test(p.path)));
});

test("en rotation uden stigende eskalation afvises", () => {
  const broken = JSON.parse(JSON.stringify(rotations));
  broken.rotations[0].escalation[1].afterMinutes = 1;
  const problems = onCallRotationProblems(broken, { serviceIds: new Set(catalog.services.map((s) => s.id)) });
  assert.ok(problems.some((p) => /stigende/.test(p.message)));
});

test("en major incident lukket af en AI afvises", () => {
  const broken = { ...example, state: "closed", closedBy: { subject: "spiffe://platform.example.org/agents/x", name: "agent", kind: "agent" } };
  const problems = itsmRecordProblems(broken);
  assert.ok(problems.some((p) => /AI må ikke lukke/.test(p.message)));
});

test("module-manifest deklarerer alle verber ærligt", () => {
  for (const verb of OPS_VERBS) {
    const block = manifest.verbs[verb];
    assert.ok(block, `verbs.${verb} mangler`);
    if (block.conformance !== "full") assert.ok((block.reason ?? "").length >= 20, `${verb} mangler en begrundelse`);
    else assert.ok(block.endpoint && block.evidence, `${verb} full uden endpoint/bevis`);
  }
  for (const verb of PRIVACY_VERBS) {
    const block = manifest.privacy[verb];
    assert.ok(block, `privacy.${verb} mangler`);
    if (block.conformance !== "full") assert.ok((block.reason ?? "").length >= 20, `${verb} mangler en begrundelse`);
    else assert.ok(block.endpoint && block.evidence, `${verb} full uden endpoint/bevis`);
  }
  assert.equal(manifest.privacy["subject.erase"].conformance, "partial");
});

test("acceptkriterium: én alarm bliver én incident med ejer og berørte tjenester", () => {
  const alert = { id: "a1", alertId: "a1", ruleId: "r", signal: "s", severity: "critical", summary: "x", emittedAt: "2026-09-01T08:00:00Z" };
  const result = correlateAlarm({ alert, serviceId: "checkout", catalog, rotations, incidents: [], tenantId: "acme", now: () => Date.parse("2026-09-01T08:00:00Z") });
  assert.equal(result.created, true);
  assert.ok(result.incident.owner.subject.startsWith("oidc|"));
  assert.ok(result.incident.affectedServices.includes("checkout"));
});

test("acceptkriterium: manglende kvittering eskalerer og stopper risikofyldt handling", () => {
  const alert = { id: "a1", alertId: "a1", ruleId: "r", signal: "s", severity: "critical", summary: "x", emittedAt: "2026-09-01T08:00:00Z" };
  const { incident } = correlateAlarm({ alert, serviceId: "checkout", catalog, rotations, incidents: [], tenantId: "acme", now: () => Date.parse("2026-09-01T08:00:00Z") });
  const late = () => Date.parse("2026-09-01T08:30:00Z");
  const risky = riskyActionAllowed({ record: incident, catalog, rotations, now: late });
  assert.equal(risky.allowed, false);
  assert.ok(risky.escalationTarget);
});

test("acceptkriterium: gentagne incidents giver problem og kendt fejl efter menneskelig validering", () => {
  const alert = { id: "a1", alertId: "a1", ruleId: "r", signal: "s", severity: "critical", summary: "x", emittedAt: "2026-09-01T08:00:00Z" };
  const incidents = [];
  for (let i = 0; i < 3; i++) {
    const { incident } = correlateAlarm({ alert: { ...alert, id: `a${i}`, alertId: `a${i}` }, serviceId: "checkout", catalog, rotations, incidents: [], tenantId: "acme", now: () => Date.parse("2026-09-01T08:00:00Z") });
    incidents.push({ ...incident, id: `INC-${i}`, state: "closed" });
  }
  const proposals = problemCandidate({ incidents, threshold: 3, now: () => Date.parse("2026-09-02T08:00:00Z") });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].requiresHumanValidation, true);
});

test("acceptkriterium: kunden ser kun egne sager", () => {
  const record = { ...example, tenantId: "acme" };
  assert.equal(customerCases({ actor: { tenantId: "acme" }, records: [record] }).length, 1);
  assert.deepEqual(customerCases({ actor: { tenantId: "globex" }, records: [record] }), []);
});

test("acceptkriterium: en AI må ikke lukke en major incident på grønt healthcheck", () => {
  const problems = majorIncidentCloseProblems({ record: { ...example, humanAck: null, recordKind: "major_incident" }, actor: { kind: "agent", id: "spiffe://x" }, healthcheck: "green", approvals: [], policy: {} });
  assert.ok(problems.some((p) => /menneske|grønt healthcheck|kvittering/.test(p)));
});

test("acceptkriterium: en agent må ikke kombinere roller i en proces", () => {
  const agents = [{ id: "a", role: "observer" }, { id: "b", role: "executor" }];
  const good = serviceProcessProblems({ process: { id: "p", serviceId: "checkout", steps: [{ name: "x", role: "observer", agentId: "a" }, { name: "y", role: "executor", agentId: "b" }] }, agents });
  assert.deepEqual(good, []);
  const bad = serviceProcessProblems({ process: { id: "p", serviceId: "checkout", steps: [{ name: "x", role: "observer", agentId: "a" }, { name: "y", role: "planner", agentId: "a" }] }, agents });
  assert.ok(bad.length > 0);
});

test("editionkombinationerne vurderes pr. delmodul", () => {
  assert.equal(assessEditionCombination(ITSM_EDITIONS["glpi-network"]).status, "approved");
  assert.equal(assessEditionCombination(ITSM_EDITIONS["glpi-community"]).submodules.sla.released, false);
});
