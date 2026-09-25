import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideFileAccess,
  externalShareProblems,
  publicLinkProblems,
  officeFormatReport,
  assessEditionCombination,
  deletionProblems,
  offboardingPlan,
  normalizePolicy,
  createWorkspaceService,
  WorkspaceError,
} from "../src/workspace.mjs";
import { PERMISSIONS, SHARE_TYPES, ROLES, EDITION_COMBINATIONS, PILOT_OFFICE_FORMATS } from "../src/constants.mjs";
import { createNextcloudClient } from "../src/nextcloud.mjs";
import { createMockNextcloud } from "../src/mock-nextcloud.mjs";

const TENANT = "acme";
const anna = { id: "anna", kind: "human", tenantId: TENANT, role: ROLES.TENANT_ADMIN, groups: ["acme"] };
const bo = { id: "bo", kind: "human", tenantId: TENANT, role: ROLES.MEMBER, groups: ["acme"] };
const carla = { id: "carla", kind: "human", tenantId: TENANT, role: ROLES.MEMBER, groups: ["acme"] };

function share(overrides = {}) {
  return { id: "1", share_type: SHARE_TYPES.USER, share_with: "bo", uid_owner: "anna", path: "/projekt/plan.docx", permissions: PERMISSIONS.READ | PERMISSIONS.UPDATE, ...overrides };
}

test("decideFileAccess: ejer, brugerdeling, gruppedeling og afvisning", () => {
  const resource = { tenantId: TENANT, owner: "anna", path: "/projekt/plan.docx" };
  assert.equal(decideFileAccess({ actor: anna, resource, shares: [] }).allowed, true);
  assert.equal(decideFileAccess({ actor: bo, resource, shares: [share()] }).allowed, true);
  assert.equal(decideFileAccess({ actor: carla, resource, shares: [share()] }).allowed, false);
  assert.equal(decideFileAccess({ actor: bo, resource, shares: [share({ share_type: SHARE_TYPES.GROUP, share_with: "acme" })] }).allowed, true);
  assert.equal(decideFileAccess({ actor: bo, resource, shares: [share({ share_type: SHARE_TYPES.GROUP, share_with: "andre" })] }).allowed, false);
});

test("decideFileAccess: tenantgrænse og utilstrækkelig rettighed", () => {
  const resource = { tenantId: TENANT, owner: "anna", path: "/projekt/plan.docx" };
  const foreign = { ...bo, tenantId: "globex" };
  assert.equal(decideFileAccess({ actor: foreign, resource, shares: [share()] }).allowed, false);
  assert.equal(decideFileAccess({ actor: foreign, resource, shares: [share()] }).reason, "tenant_mismatch");
  const readOnly = share({ permissions: PERMISSIONS.READ });
  assert.equal(decideFileAccess({ actor: bo, resource, shares: [readOnly], requiredPermission: PERMISSIONS.UPDATE }).allowed, false);
  assert.equal(decideFileAccess({ actor: bo, resource, shares: [readOnly], requiredPermission: PERMISSIONS.READ }).allowed, true);
});

test("decideFileAccess: deaktiveret konto afvises", () => {
  const resource = { tenantId: TENANT, owner: "anna", path: "/projekt/plan.docx" };
  assert.equal(decideFileAccess({ actor: { ...bo, disabled: true }, resource, shares: [share()] }).allowed, false);
});

test("publicLinkProblems: politik, adgangskode, levetid og upload", () => {
  const policy = { publicLinks: { enabled: true, requirePassword: true, requireExpiry: true, maxTtlDays: 7, allowUpload: false } };
  assert.deepEqual(publicLinkProblems({ policy, link: { password: "langnokadgangskode", expireDate: "2026-10-01", ttlDays: 5, permissions: PERMISSIONS.READ } }), []);
  assert.ok(publicLinkProblems({ policy, link: { password: "kort", expireDate: "2026-10-01", ttlDays: 5 } }).some((p) => /adgangskode/.test(p)));
  assert.ok(publicLinkProblems({ policy, link: { password: "langnokadgangskode", expireDate: "2026-10-01", ttlDays: 30 } }).some((p) => /levetid/.test(p)));
  assert.ok(publicLinkProblems({ policy, link: { password: "langnokadgangskode", expireDate: "2026-10-01", ttlDays: 5, permissions: PERMISSIONS.READ | PERMISSIONS.CREATE } }).some((p) => /upload/.test(p)));
  assert.ok(publicLinkProblems({ policy: { publicLinks: { enabled: false } }, link: { password: "langnokadgangskode" } }).some((p) => /tillader ikke/.test(p)));
});

test("externalShareProblems: disabled, domain-restricted og allowed", () => {
  assert.ok(externalShareProblems({ policy: { externalSharing: "disabled" }, target: "gus@partner.example" }).length > 0);
  const restricted = { externalSharing: "domain-restricted", allowedExternalDomains: ["partner.example"] };
  assert.deepEqual(externalShareProblems({ policy: restricted, target: "gus@partner.example" }), []);
  assert.ok(externalShareProblems({ policy: restricted, target: "gus@ond.example" }).some((p) => /allowlist/.test(p)));
  assert.deepEqual(externalShareProblems({ policy: { externalSharing: "allowed" }, target: "gus@wherever.example" }), []);
});

test("officeFormatReport registrerer afvigelser eksplicit", () => {
  const report = officeFormatReport(["docx", "xlsx", "odt"], ["docx", "xlsx"]);
  assert.deepEqual(report.unsupported, ["odt"]);
  assert.equal(report.deviations.length, 1);
  assert.equal(report.deviations[0].format, "odt");
  assert.equal(PILOT_OFFICE_FORMATS.includes("docx"), true);
});

test("assessEditionCombination frigiver kun validerede delmoduler", () => {
  const onlyoffice = assessEditionCombination(EDITION_COMBINATIONS["nextcloud-hub-onlyoffice"]);
  assert.equal(onlyoffice.status, "approved");
  assert.equal(onlyoffice.submodules.editor.released, true);
  const collabora = assessEditionCombination(EDITION_COMBINATIONS["nextcloud-hub-collabora"]);
  assert.equal(collabora.submodules.editor.released, false);
  assert.equal(collabora.submodules.files.released, true);
  assert.equal(collabora.status, "partial");
});

test("deletionProblems blokerer ved legal hold, retention og manglende godkendelse", () => {
  const policy = {};
  assert.ok(deletionProblems({ policy, legalHold: true, reason: "lang nok begrundelse", approvals: [{ verdict: "approve" }] }).some((p) => /legal hold/.test(p)));
  assert.ok(deletionProblems({ policy, legalHold: false, retentionDays: 10, reason: "lang nok begrundelse", approvals: [{ verdict: "approve" }] }).some((p) => /retention/.test(p)));
  assert.ok(deletionProblems({ policy, reason: "", approvals: [] }).length >= 2);
  assert.deepEqual(deletionProblems({ policy, reason: "en tilstrækkelig begrundelse", approvals: [{ verdict: "approve" }] }), []);
});

test("offboardingPlan kræver en beslutning om ejerens filer", () => {
  const plan = offboardingPlan({ policy: { offboarding: { deleteOwnedFiles: false, transferOwnedFilesTo: null } }, subject: { id: "bo" }, shares: [] });
  assert.ok(plan.problems.length > 0);
  const ok = offboardingPlan({ policy: {}, subject: { id: "bo" }, shares: [] });
  assert.deepEqual(ok.problems, []);
});

test("normalizePolicy arver restriktive standarder", () => {
  const policy = normalizePolicy({ publicLinks: { enabled: true } });
  assert.equal(policy.externalSharing, "disabled");
  assert.equal(policy.publicLinks.requirePassword, true);
  assert.equal(policy.publicLinks.maxTtlDays, 7);
});

async function serviceWith(clientPolicy = {}) {
  const mock = createMockNextcloud();
  const port = await mock.listen(0);
  const client = createNextcloudClient({ baseUrl: `http://127.0.0.1:${port}`, token: "test-token" });
  const audits = [];
  const service = createWorkspaceService({ client, policy: clientPolicy, onAudit: (e) => audits.push(e) });
  return { mock, service, audits, close: () => mock.close() };
}

test("to brugere deler og redigerer; en tredje uden adgang afvises", async () => {
  const { service, close } = await serviceWith();
  try {
    const created = await service.shareFile({ actor: anna, owner: "anna", path: "/projekt/plan.docx", shareWith: "bo", permissions: PERMISSIONS.READ | PERMISSIONS.UPDATE, tenantId: TENANT });
    assert.equal(created.share_type, SHARE_TYPES.USER);
    const edit = await service.editFile({ actor: bo, owner: "anna", path: "/projekt/plan.docx", content: "version-2", tenantId: TENANT });
    assert.equal(edit.via, "user");
    const read = await service.readFile({ actor: bo, owner: "anna", path: "/projekt/plan.docx", tenantId: TENANT });
    assert.equal(read.content, "version-2");
    await assert.rejects(() => service.readFile({ actor: carla, owner: "anna", path: "/projekt/plan.docx", tenantId: TENANT }), (err) => {
      assert.equal(err.code, "access_denied");
      assert.equal(err.status, 403);
      return true;
    });
  } finally {
    await close();
  }
});

test("offentligt link afvises af standardpolitikken og tillades af kundepolitikken", async () => {
  const { service, close } = await serviceWith();
  try {
    await assert.rejects(
      () => service.createPublicLink({ actor: anna, owner: "anna", path: "/projekt/plan.docx", tenantId: TENANT, ttlDays: 3, password: "langnokadgangskode" }),
      (err) => err.code === "public_link_denied"
    );
    service.setPolicy({ publicLinks: { enabled: true, requirePassword: true, requireExpiry: true, maxTtlDays: 7, allowUpload: false } });
    const link = await service.createPublicLink({ actor: anna, owner: "anna", path: "/projekt/plan.docx", tenantId: TENANT, ttlDays: 3, password: "langnokadgangskode" });
    assert.ok(link.token);
    assert.ok(link.expiration);
  } finally {
    await close();
  }
});

test("gæsteinvitation følger kundepolitikken", async () => {
  const { service, close } = await serviceWith();
  try {
    await assert.rejects(
      () => service.inviteGuest({ actor: anna, guest: { id: "gus", email: "gus@partner.example" }, tenantId: TENANT }),
      (err) => err.code === "guest_denied"
    );
    service.setPolicy({ externalSharing: "domain-restricted", allowedExternalDomains: ["partner.example"] });
    const guest = await service.inviteGuest({ actor: anna, guest: { id: "guest1", email: "ny@partner.example" }, tenantId: TENANT });
    assert.equal(guest.state, "active");
  } finally {
    await close();
  }
});

test("offboarding lukker sessioner, tilbagekalder delinger og flytter filer", async () => {
  const { mock, service, close } = await serviceWith();
  try {
    await service.shareFile({ actor: anna, owner: "anna", path: "/projekt/plan.docx", shareWith: "bo", permissions: PERMISSIONS.READ, tenantId: TENANT });
    const receipt = await service.offboardUser({ actor: anna, subject: { id: "bo" }, tenantId: TENANT });
    assert.equal(receipt.revokedShares, 0, "bo ejer ingen delinger");
    assert.equal(receipt.closedSessions, 1);
    assert.equal(receipt.transferredTo, "tenant-archive");
    assert.equal(mock.sessions.get("bo").length, 0);
    assert.equal(mock.users.get("bo").enabled, false);
  } finally {
    await close();
  }
});

test("sletning blokeres af legal hold og gennemføres ellers med resterende kopier", async () => {
  const { service, close } = await serviceWith();
  try {
    await assert.rejects(
      () => service.requestDeletion({ actor: anna, subject: { id: "bo" }, tenantId: TENANT, reason: "lang nok begrundelse", legalHold: true, approvals: [{ verdict: "approve" }] }),
      (err) => err.code === "deletion_denied"
    );
    const receipt = await service.requestDeletion({ actor: anna, subject: { id: "bo" }, tenantId: TENANT, reason: "lang nok begrundelse", approvals: [{ verdict: "approve" }] });
    assert.equal(receipt.deletedFiles, 1);
    assert.ok(receipt.remainingCopies.some((c) => c.location === "backup"));
    assert.equal(receipt.reason, "lang nok begrundelse");
  } finally {
    await close();
  }
});

test("kun en kundeadministrator må afvikle eller slette", async () => {
  const { service, close } = await serviceWith();
  try {
    await assert.rejects(() => service.offboardUser({ actor: bo, subject: { id: "carla" }, tenantId: TENANT }), (err) => err.code === "access_denied");
    await assert.rejects(() => service.requestDeletion({ actor: bo, subject: { id: "carla" }, tenantId: TENANT, reason: "lang nok begrundelse", approvals: [{ verdict: "approve" }] }), WorkspaceError);
  } finally {
    await close();
  }
});
