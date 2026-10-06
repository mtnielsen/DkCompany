/**
 * DKC-029 — konformanstest for support og sagsbehandling.
 *
 * Tester skema + semantik på de faktiske kilder, politikken, eksemplerne og den
 * genererede rapports udkast, og at et brud afvises. En målt integration mod en
 * levende Zammad er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { validateHelpdeskSource, validateSupportTicket, validateReplyDraft, validateHelpdeskPolicy } from "../src/helpdesk.mjs";
import { replyDraftProblems } from "../../helpdesk/src/model.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const sources = read("helpdesk/sources.json");
const policy = read("helpdesk/policy.json");
const report = read("helpdesk/report/helpdesk-report.json");

test("den faktiske helpdeskkilde validerer mod skema og semantik", () => {
  const tenantIds = new Set(sources.sources.map((s) => s.tenantId));
  assert.equal(validateHelpdeskSource(sources, undefined, { supportedTenants: tenantIds }).ok, true);
});

test("den faktiske helpdeskpolitik validerer", () => {
  assert.equal(validateHelpdeskPolicy(policy).ok, true);
});

test("eksemplerne validerer", () => {
  assert.equal(validateHelpdeskSource(read("contracts/examples/helpdesk-source.example.json")).ok, true);
  assert.equal(validateSupportTicket(read("contracts/examples/support-ticket.example.json")).ok, true);
  assert.equal(validateReplyDraft(read("contracts/examples/reply-draft.example.json")).ok, true);
});

test("den genererede rapports svarudkast validerer", () => {
  assert.ok(report.draftSample, "rapporten mangler et udkast");
  assert.equal(validateReplyDraft(report.draftSample).ok, true);
  assert.equal(report.draftSample.toolActivationDenied, true);
  assert.equal(report.draftSample.requiresApproval, true);
  assert.equal(report.backup.ok, true);
  assert.equal(report.deletionSample.status, "full");
});

test("en kilde der ikke er Zammad afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  broken.sources[0].type = "otrs";
  assert.ok(validateHelpdeskSource(broken).errors.length > 0);
});

test("en rå hemmelighed i stedet for en secretreference afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  broken.sources[0].secretRef = "super-hemmelig-token";
  assert.ok(validateHelpdeskSource(broken).errors.length > 0);
});

test("en politik uden godkendelseskrav ved afsendelse afvises", () => {
  const broken = JSON.parse(JSON.stringify(policy));
  broken.ai.sendingRequiresApproval = false;
  assert.ok(validateHelpdeskPolicy(broken).errors.length > 0);
});

test("et udkast der aktiverer et værktøj afvises", () => {
  const broken = { ...report.draftSample, toolProposals: [{ tool: "credentials.issue" }], toolActivationDenied: false };
  assert.ok(replyDraftProblems(broken).some((p) => p.path.includes("toolProposals")));
});
