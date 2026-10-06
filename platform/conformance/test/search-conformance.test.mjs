/**
 * DKC-028 — konformanstest for rettighedsbevidst videnssøgning.
 *
 * Tester skema + semantik på de faktiske kilder, politikken, eksemplerne og den
 * genererede rapports svar, og at et brud afvises. En målt slettefrist på en
 * levende BookStack er og forbliver NOT RUN.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import {
  validateKnowledgeSource,
  validateKnowledgeDocument,
  validateSearchIndexPolicy,
  validateRetrievalAnswer,
} from "../src/search.mjs";
import { retrievalAnswerProblems } from "../../search/src/model.mjs";

function read(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

const sources = read("search/sources.json");
const policy = read("search/index-policy.json");
const report = read("search/report/knowledge-search-report.json");

test("den faktiske videnskilde validerer mod skema og semantik", () => {
  const tenantIds = new Set(sources.sources.map((s) => s.tenantId));
  assert.equal(validateKnowledgeSource(sources, undefined, { supportedTenants: tenantIds }).ok, true);
});

test("den faktiske indekspolitik validerer", () => {
  assert.equal(validateSearchIndexPolicy(policy).ok, true);
});

test("eksemplerne validerer", () => {
  assert.equal(validateKnowledgeSource(read("contracts/examples/knowledge-source.example.json")).ok, true);
  assert.equal(validateKnowledgeDocument(read("contracts/examples/knowledge-document.example.json")).ok, true);
  assert.equal(validateRetrievalAnswer(read("contracts/examples/retrieval-answer.example.json")).ok, true);
});

test("den genererede rapports svar validerer", () => {
  assert.equal(validateRetrievalAnswer(report.answerSample).ok, true);
  assert.equal(report.answerSample.toolActivationDenied, true);
  assert.equal(report.deletion.withinDeadline, true);
});

test("en kilde der ikke er read-only afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  broken.sources[0].readOnly = false;
  assert.ok(validateKnowledgeSource(broken).errors.length > 0);
});

test("en rå hemmelighed i stedet for en secretreference afvises", () => {
  const broken = JSON.parse(JSON.stringify(sources));
  broken.sources[0].secretRef = "super-hemmelig-token";
  assert.ok(validateKnowledgeSource(broken).errors.length > 0);
});

test("en politik uden ACL-før-scoring afvises", () => {
  const broken = JSON.parse(JSON.stringify(policy));
  broken.acl.aclBeforeScoring = false;
  assert.ok(validateSearchIndexPolicy(broken).errors.length > 0);
});

test("et svar der aktiverer et værktøj afvises", () => {
  const broken = { ...report.answerSample, toolProposals: [{ tool: "credentials.issue" }], toolActivationDenied: false };
  assert.ok(retrievalAnswerProblems(broken).some((p) => p.path.includes("toolProposals")));
});
