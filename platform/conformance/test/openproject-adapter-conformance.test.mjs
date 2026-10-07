import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/schemas.mjs";
import { projectBundleProblems, accessDecisionProblems, editionCombinationProblems, featureReportProblems, retrievalProblems } from "../src/projects.mjs";
import { EDITION_COMBINATIONS, ROLES } from "../../modules/openproject-adapter/service/src/constants.mjs";
import { decideProjectAccess, buildPermissionProjection, featureReport, exportBundle, projectRole } from "../../modules/openproject-adapter/service/src/projects.mjs";

const manifest = JSON.parse(readFileSync(join(repoRoot, "modules", "openproject-adapter", "module-manifest.json"), "utf8"));
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

test("Community frigiver projekt/opgave, men ikke central SSO", () => {
  const report = featureReport(EDITION_COMBINATIONS["openproject-community"]);
  assert.deepEqual(featureReportProblems(report), []);
  assert.ok(report.unsupported.includes("sso"));
  const enterprise = featureReport(EDITION_COMBINATIONS["openproject-enterprise"]);
  assert.equal(enterprise.unsupported.length, 0);
});

test("en uafklaret licens blokerer editionkombinationen", () => {
  const broken = JSON.parse(JSON.stringify(EDITION_COMBINATIONS["openproject-enterprise"]));
  broken.product.license.type = "unknown";
  assert.ok(editionCombinationProblems(broken).some((p) => /product\/license/.test(p.path)));
});

test("et projektbundt med cyklus eller fremmed tenant afvises", () => {
  const cycle = { kind: "ProjectBundle", project: { externalId: "P", tenantId: "acme" }, workPackages: [{ externalId: "A", dependsOn: ["B"] }, { externalId: "B", dependsOn: ["A"] }] };
  assert.ok(projectBundleProblems(cycle).some((p) => /cyklus/.test(p.message)));
  const foreign = { kind: "ProjectBundle", project: { externalId: "P", tenantId: "acme" }, workPackages: [{ externalId: "A", tenantId: "globex" }] };
  assert.ok(projectBundleProblems(foreign).some((p) => /tenantgrænsen/.test(p.message)));
});

test("en gyldig eksport validerer og bevarer ACL", () => {
  const bundle = exportBundle({
    project: { externalId: "PROJECT-10", tenantId: "acme" },
    members: [{ externalId: "anna", principal: "anna", role: ROLES.PROJECT_ADMIN, tenantId: "acme" }],
    workPackages: [{ externalId: "WP-1", subject: "A", tenantId: "acme" }],
  });
  assert.deepEqual(projectBundleProblems(bundle), []);
});

test("tilgangsbeslutningen giver ikke adgang uden et dækkende medlemskab", () => {
  const actor = { id: "bo", tenantId: "acme", groups: ["acme"] };
  const project = { id: "10", tenantId: "acme" };
  const memberships = [{ id: "1", projectId: "10", principal: "bo", role: ROLES.MEMBER }];
  const allowed = decideProjectAccess({ actor, project, memberships, requiredPermission: "project.read" });
  assert.equal(allowed.allowed, true);
  assert.deepEqual(accessDecisionProblems({ decision: allowed, memberships, actor, project, requiredPermission: "project.read" }), []);
  const unjustified = { allowed: true, reason: null };
  assert.ok(accessDecisionProblems({ decision: unjustified, memberships: [], actor, project, requiredPermission: "project.read" }).length > 0);
});

test("en projektgæst får kun adgang til sit eget projekt", () => {
  const actor = { id: "gus", tenantId: "acme" };
  const memberships = [{ id: "1", projectId: "10", principal: "gus", role: ROLES.GUEST }];
  assert.equal(decideProjectAccess({ actor, project: { id: "10", tenantId: "acme" }, memberships, policy: { guestAccess: "own-projects-only" }, requiredPermission: "project.read" }).allowed, true);
  assert.equal(decideProjectAccess({ actor, project: { id: "11", tenantId: "acme" }, memberships, policy: { guestAccess: "own-projects-only" }, requiredPermission: "project.read" }).allowed, false);
  assert.equal(projectRole(actor, memberships, "11"), null);
});

test("en forældet rettighedsprojektion må ikke svare", () => {
  const projection = buildPermissionProjection({ actor: { id: "bo", tenantId: "acme" }, projects: [{ id: "10", tenantId: "acme" }], memberships: [{ projectId: "10", principal: "bo", role: ROLES.MEMBER }], version: 1, now: () => 1000 });
  assert.deepEqual(retrievalProblems({ projection, currentVersion: 1, results: [{ projectId: "10" }] }), []);
  assert.ok(retrievalProblems({ projection, currentVersion: 2 }).some((p) => /rettighedsversion/.test(p.message)));
  assert.ok(retrievalProblems({ projection, currentVersion: 1, results: [{ projectId: "99" }] }).some((p) => /tilladte projektmængde/.test(p.message)));
});
