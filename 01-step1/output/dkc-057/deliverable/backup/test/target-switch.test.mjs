import { test } from "node:test";
import assert from "node:assert/strict";
import { canPurgePreviousTarget, planTargetSwitch } from "../src/targets.mjs";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const now = () => NOW;

function target(name, overrides = {}) {
  return {
    metadata: { name },
    environment: "production",
    targetType: "object-store",
    status: "approved",
    support: { status: "supported" },
    retention: { days: 365 },
    failureDomain: { id: "offsite-zone-b", accessDomain: "backup-account", region: "eu-west-1" },
    ...overrides,
  };
}

const currentSet = {
  tenantId: "acme",
  activeTargetRef: "legacy-nas",
  previousTargets: [],
  primaryFailureDomain: { id: "primary-zone-a", accessDomain: "platform-account", region: "eu-west-1" },
};

test("et godkendt mål i et andet domæne kan blive aktivt, og det gamle bevares", () => {
  const next = target("offsite-object-store");
  const plan = planTargetSwitch({ currentSet, newTarget: next, currentTarget: { retention: { days: 365 } }, lastBackupAt: "2026-09-23T00:00:00Z", now });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.nextSet.activeTargetRef, "offsite-object-store");
  assert.equal(plan.nextSet.previousTargets.length, 1);
  assert.equal(plan.nextSet.previousTargets[0].targetRef, "legacy-nas");
  assert.ok(Date.parse(plan.nextSet.previousTargets[0].retainedUntil) > NOW);
  assert.deepEqual(plan.purgeable, []);
});

test("et ikke-godkendt mål blokerer skiftet", () => {
  const plan = planTargetSwitch({ currentSet, newTarget: target("offsite", { status: "proposed" }), now });
  assert.equal(plan.ok, false);
  assert.ok(plan.blockers.some((b) => /ikke godkendt/.test(b)));
});

test("et mål i samme eneste fejl-/adgangsdomæne blokerer i produktion", () => {
  const same = target("same-domain", { failureDomain: { id: "primary-zone-a", accessDomain: "platform-account", region: "eu-west-1" } });
  const plan = planTargetSwitch({ currentSet, newTarget: same, now });
  assert.equal(plan.ok, false);
  assert.ok(plan.blockers.some((b) => /samme eneste fejl/.test(b)));
});

test("et andet fejldomæne alene er nok til at passere domænekravet", () => {
  const otherDomain = target("other-zone", { failureDomain: { id: "offsite-zone-c", accessDomain: "platform-account", region: "eu-west-1" } });
  assert.equal(planTargetSwitch({ currentSet, newTarget: otherDomain, now }).ok, true);
});

test("gammel recoveryhistorik bevares til retentionen er opfyldt", () => {
  const next = target("offsite-object-store");
  const recent = planTargetSwitch({ currentSet, newTarget: next, currentTarget: { retention: { days: 365 } }, lastBackupAt: "2026-09-01T00:00:00Z", now });
  assert.equal(recent.nextSet.previousTargets.length, 1);
  assert.equal(canPurgePreviousTarget(recent.nextSet.previousTargets[0], NOW), false);

  const expired = planTargetSwitch({ currentSet, newTarget: next, currentTarget: { retention: { days: 30 } }, lastBackupAt: "2020-01-01T00:00:00Z", now });
  assert.equal(expired.nextSet.previousTargets.length, 0);
  assert.equal(expired.purgeable.length, 1);
  assert.equal(canPurgePreviousTarget(expired.purgeable[0], NOW), true);
});

test("en eksplicit purge-godkendelse tillader fjernelse uanset frist", () => {
  const entry = { targetRef: "legacy-nas", retainedUntil: new Date(NOW + 86_400_000).toISOString(), retentionDays: 365, purgeApprovedBy: { subject: "oidc|anna.andersen", name: "Anna Andersen", role: "Platform Owner" } };
  assert.equal(canPurgePreviousTarget(entry, NOW), true);
});
