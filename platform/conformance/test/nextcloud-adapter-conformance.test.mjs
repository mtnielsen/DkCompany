import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { editionCombinationProblems, officeFormatProblems, accessDecisionProblems } from "../src/workspace.mjs";
import { EDITION_COMBINATIONS, SHARE_TYPES, PERMISSIONS } from "../../modules/nextcloud-adapter/service/src/constants.mjs";
import { decideFileAccess, officeFormatReport, assessEditionCombination } from "../../modules/nextcloud-adapter/service/src/workspace.mjs";

const manifest = JSON.parse(readFileSync(join(repoRoot, "modules", "nextcloud-adapter", "module-manifest.json"), "utf8"));
const OPS_VERBS = ["backup", "restore", "verify-restore", "drain", "upgrade.dry-run", "upgrade", "migrate", "rollback", "health", "slo"];
const PRIVACY_VERBS = ["subject.locate", "subject.export", "subject.erase", "subject.legal_hold", "retention.policy"];

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

test("alle dokumenterede editionkombinationer validerer", () => {
  for (const combination of Object.values(EDITION_COMBINATIONS)) {
    assert.deepEqual(editionCombinationProblems(combination), [], combination.name);
  }
});

test("en uafklaret licens blokerer editionkombinationen", () => {
  const broken = JSON.parse(JSON.stringify(EDITION_COMBINATIONS["nextcloud-hub-onlyoffice"]));
  broken.office.license.type = "unknown";
  const problems = editionCombinationProblems(broken);
  assert.ok(problems.some((p) => /office\/license/.test(p.path)));
});

test("Collabora frigiver filer, men ikke editoren", () => {
  const assessment = assessEditionCombination(EDITION_COMBINATIONS["nextcloud-hub-collabora"]);
  assert.equal(assessment.submodules.files.released, true);
  assert.equal(assessment.submodules.sharing.released, true);
  assert.equal(assessment.submodules.calendar.released, true);
  assert.equal(assessment.submodules.editor.released, false);
  assert.equal(assessment.status, "partial");
});

test("officeformat-afvigelser skal registreres eksplicit", () => {
  const report = officeFormatReport(["docx", "xlsx", "odt"], ["docx", "xlsx"]);
  assert.deepEqual(officeFormatProblems(report), []);
  const hidden = { ...report, deviations: [] };
  assert.ok(officeFormatProblems(hidden).some((p) => /odt/.test(p.path)));
});

test("delingsbeslutningen giver ikke adgang uden en dækkende deling", () => {
  const actor = { id: "carla", tenantId: "acme", groups: ["acme"] };
  const resource = { tenantId: "acme", owner: "anna", path: "/plan.docx" };
  const shares = [{ id: "1", share_type: SHARE_TYPES.USER, share_with: "bo", permissions: PERMISSIONS.READ | PERMISSIONS.UPDATE, path: "/plan.docx", uid_owner: "anna" }];
  const denied = decideFileAccess({ actor, resource, shares, requiredPermission: PERMISSIONS.READ });
  assert.equal(denied.allowed, false);
  assert.deepEqual(accessDecisionProblems({ decision: denied, shares, actor, requiredPermission: PERMISSIONS.READ }), []);
  const unjustified = { allowed: true, reason: null };
  assert.ok(accessDecisionProblems({ decision: unjustified, shares, actor, requiredPermission: PERMISSIONS.READ }).length > 0);
});

test("en deling med for få rettigheder giver ikke skriveadgang", () => {
  const actor = { id: "bo", tenantId: "acme", groups: ["acme"] };
  const resource = { tenantId: "acme", owner: "anna", path: "/plan.docx" };
  const shares = [{ id: "1", share_type: SHARE_TYPES.USER, share_with: "bo", permissions: PERMISSIONS.READ, path: "/plan.docx", uid_owner: "anna" }];
  const decision = decideFileAccess({ actor, resource, shares, requiredPermission: PERMISSIONS.UPDATE });
  assert.equal(decision.allowed, false);
});
