import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideProjectAccess,
  visibleProjectIds,
  buildPermissionProjection,
  isProjectionFresh,
  projectBundleProblems,
  importPlan,
  topologicalOrder,
  exportBundle,
  assessEditionCombination,
  featureReport,
  deletionProblems,
  permissionsForRole,
  projectRole,
} from "../src/projects.mjs";
import { ROLES, PERMISSIONS, EDITION_COMBINATIONS, WORK_PACKAGE_TYPES } from "../src/constants.mjs";

const project = { id: "10", externalId: "PROJECT-10", tenantId: "acme", visibility: "private" };
const member = { id: "1", projectId: "10", principal: "bo", role: ROLES.MEMBER };
const reader = { id: "2", projectId: "10", principal: "lise", role: ROLES.READER };
const guest = { id: "3", projectId: "10", principal: "gus", role: ROLES.GUEST };

test("default-deny: uden medlemskab nægtes adgang", () => {
  const decision = decideProjectAccess({ actor: { id: "x", tenantId: "acme" }, project, memberships: [] });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /ikke medlem/);
});

test("tenant-admin og projekt-admin har adgang; fremmed tenant afvises", () => {
  const admin = decideProjectAccess({ actor: { id: "anna", tenantId: "acme", role: ROLES.TENANT_ADMIN }, project, memberships: [] });
  assert.equal(admin.allowed, true);
  const foreign = decideProjectAccess({ actor: { id: "carla", tenantId: "globex" }, project, memberships: [{ principal: "carla", role: ROLES.MEMBER }] });
  assert.equal(foreign.allowed, false);
  assert.match(foreign.reason, /anden tenant/);
});

test("en læser må læse, men ikke skrive", () => {
  const read = decideProjectAccess({ actor: { id: "lise", tenantId: "acme" }, project, memberships: [reader], requiredPermission: PERMISSIONS.WORKPACKAGE_READ });
  assert.equal(read.allowed, true);
  const write = decideProjectAccess({ actor: { id: "lise", tenantId: "acme" }, project, memberships: [reader], requiredPermission: PERMISSIONS.WORKPACKAGE_WRITE });
  assert.equal(write.allowed, false);
  assert.match(write.reason, /dækker ikke/);
});

test("en projektgæst nægtes, medmindre kunden tillader egne projekter", () => {
  const denied = decideProjectAccess({ actor: { id: "gus", tenantId: "acme" }, project, memberships: [guest], policy: {} });
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /projektgæst/);
  const allowed = decideProjectAccess({ actor: { id: "gus", tenantId: "acme" }, project, memberships: [guest], policy: { guestAccess: "own-projects-only" }, requiredPermission: PERMISSIONS.PROJECT_READ });
  assert.equal(allowed.allowed, true);
});

test("en deaktiveret konto afvises", () => {
  const decision = decideProjectAccess({ actor: { id: "bo", tenantId: "acme", disabled: true }, project, memberships: [member] });
  assert.equal(decision.allowed, false);
});

test("gruppemedlemskab giver adgang via principalens verificerede grupper", () => {
  const decision = decideProjectAccess({
    actor: { id: "bo", tenantId: "acme", groups: ["team-alpha"] },
    project,
    memberships: [{ id: "9", group: "team-alpha", role: ROLES.MEMBER }],
    requiredPermission: PERMISSIONS.WORKPACKAGE_READ,
  });
  assert.equal(decision.allowed, true);
  assert.equal(projectRole({ id: "bo", groups: ["team-alpha"] }, [{ group: "team-alpha", role: ROLES.MEMBER }]), ROLES.MEMBER);
});

test("en projektgæst ser kun sit eget projekt", () => {
  const projects = [
    { id: "10", tenantId: "acme" },
    { id: "11", tenantId: "acme" },
  ];
  const { allowed, denied } = visibleProjectIds({ actor: { id: "gus", tenantId: "acme" }, projects, memberships: [guest], policy: { guestAccess: "own-projects-only" } });
  assert.deepEqual(allowed, ["10"]);
  assert.deepEqual(denied, ["11"]);
});

test("en rettighedsændring skubber en ny projektion og forældede indeks afvises", () => {
  const actor = { id: "bo", tenantId: "acme" };
  const projects = [{ id: "10", tenantId: "acme" }];
  const v1 = buildPermissionProjection({ actor, projects, memberships: [member], version: 1, now: () => 1000 });
  assert.equal(isProjectionFresh(v1, 1, { now: () => 1000 }), true);
  assert.equal(isProjectionFresh(v1, 2, { now: () => 1000 }), false, "version mismatch");
  assert.equal(isProjectionFresh(v1, 1, { now: () => 1000 + 400 * 1000, maxAgeSeconds: 300 }), false, "for gammel");
});

test("et gyldigt projektbundt validerer", () => {
  const bundle = exportBundle({
    project: { externalId: "PROJECT-10", tenantId: "acme" },
    members: [{ externalId: "M-1", principal: "bo", role: ROLES.MEMBER, tenantId: "acme" }],
    workPackages: [
      { externalId: "WP-1", subject: "A", type: "task", status: "new", tenantId: "acme" },
      { externalId: "WP-2", subject: "B", type: "bug", status: "new", assigneeExternalId: "M-1", dependsOn: ["WP-1"], tenantId: "acme" },
    ],
  });
  assert.deepEqual(projectBundleProblems(bundle), []);
});

test("et bundt med dubleret id, ukendt afhængighed eller cyklus afvises", () => {
  const dup = { kind: "ProjectBundle", project: { externalId: "P", tenantId: "acme" }, workPackages: [{ externalId: "WP-1" }, { externalId: "WP-1" }] };
  assert.ok(projectBundleProblems(dup).some((p) => /dubleret/.test(p.message)));
  const missing = { kind: "ProjectBundle", project: { externalId: "P", tenantId: "acme" }, workPackages: [{ externalId: "WP-1", dependsOn: ["WP-X"] }] };
  assert.ok(projectBundleProblems(missing).some((p) => /findes ikke/.test(p.message)));
  const cycle = { kind: "ProjectBundle", project: { externalId: "P", tenantId: "acme" }, workPackages: [{ externalId: "WP-1", dependsOn: ["WP-2"] }, { externalId: "WP-2", dependsOn: ["WP-1"] }] };
  assert.ok(projectBundleProblems(cycle).some((p) => /cyklus/.test(p.message)));
});

test("en arbejdspakke der krydser tenantgrænsen afvises", () => {
  const bundle = { kind: "ProjectBundle", project: { externalId: "P", tenantId: "acme" }, workPackages: [{ externalId: "WP-1", tenantId: "globex" }] };
  assert.ok(projectBundleProblems(bundle).some((p) => /krydser tenantgrænsen/.test(p.message)));
});

test("importplanen er idempotent ved retry og opdager opdateringer", () => {
  const bundle = exportBundle({ project: { externalId: "PROJECT-10", tenantId: "acme" }, workPackages: [{ externalId: "WP-1", subject: "A", tenantId: "acme" }] });
  const empty = importPlan({ bundle, existing: [] });
  assert.equal(empty.creates.length, 1);
  assert.equal(empty.idempotent, false);
  const stored = bundle.workPackages.map((wp) => ({ id: "500", externalId: wp.externalId, subject: wp.subject, type: wp.type, status: wp.status, assigneeId: wp.assigneeExternalId, priority: wp.priority, dependsOn: wp.dependsOn }));
  const retry = importPlan({ bundle, existing: stored });
  assert.equal(retry.creates.length, 0);
  assert.equal(retry.idempotent, true);
  const changed = { ...bundle, workPackages: [{ ...bundle.workPackages[0], subject: "B" }] };
  const update = importPlan({ bundle: changed, existing: stored });
  assert.equal(update.updates.length, 1);
  assert.equal(update.updates[0].existingId, "500");
});

test("topologisk rækkefølge respekterer afhængigheder", () => {
  const order = topologicalOrder([
    { externalId: "WP-2", dependsOn: ["WP-1"] },
    { externalId: "WP-1", dependsOn: [] },
  ]);
  assert.deepEqual(order, ["WP-1", "WP-2"]);
  assert.throws(() => topologicalOrder([{ externalId: "A", dependsOn: ["B"] }, { externalId: "B", dependsOn: ["A"] }]));
});

test("Community frigiver projekt/opgave, men ikke central SSO", () => {
  const report = assessEditionCombination(EDITION_COMBINATIONS["openproject-community"]);
  assert.equal(report.features.projects.released, true);
  assert.equal(report.features.sso.released, false);
  assert.equal(report.status, "partial");
  const features = featureReport(EDITION_COMBINATIONS["openproject-community"]);
  assert.ok(features.unsupported.includes("sso"));
});

test("Enterprise frigiver alle krævede features", () => {
  const report = assessEditionCombination(EDITION_COMBINATIONS["openproject-enterprise"]);
  assert.equal(report.status, "approved");
  assert.deepEqual(Object.values(report.features).filter((f) => !f.released), []);
});

test("sletning kræver begrundelse og godkendelse og blokeres af legal hold", () => {
  const problems = deletionProblems({ legalHold: true, reason: "kort", approvals: [] });
  assert.ok(problems.some((p) => /legal hold/.test(p)));
  assert.ok(problems.some((p) => /begrundelse/.test(p)));
  assert.ok(problems.some((p) => /godkendelse/.test(p)));
  assert.deepEqual(deletionProblems({ reason: "en tilstrækkelig begrundelse", approvals: [{ verdict: "approve" }] }), []);
});

test("rollemappen dækker de forventede rettigheder", () => {
  assert.ok(permissionsForRole(ROLES.GUEST).includes(PERMISSIONS.FILE_READ));
  assert.ok(!permissionsForRole(ROLES.GUEST).includes(PERMISSIONS.PROJECT_EXPORT));
  assert.deepEqual(WORK_PACKAGE_TYPES.filter((t) => !["task", "bug", "feature", "epic"].includes(t)), []);
});
