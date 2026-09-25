import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadAll, offlinePackageProblems } from "../src/lifecycle-model.mjs";
import { offlineReadiness, offlineDependencyStatuses, coreFlowPreserved } from "../src/lifecycle-offline.mjs";
import { decideLifecycleAccess } from "../src/lifecycle-permissions.mjs";

const all = loadAll(repoRoot);

test("offlinepakken dækker hele gateway-rutekataloget", () => {
  const covered = new Set(all.offline.externalDependencies.flatMap((d) => d.routeRefs ?? []));
  for (const route of all.routes) assert.ok(covered.has(route.id), `ruten '${route.id}' er ikke markeret`);
  assert.equal(offlinePackageProblems(all.offline, { components: all.components, routes: all.routes }).length, 0);
});

test("lokale kerneflows består ved et internetudfald", () => {
  const readiness = offlineReadiness(all.offline, { online: false });
  assert.equal(readiness.coreFlowsRemainLocal, true);
  assert.equal(readiness.noSilentFallback, true);
  assert.equal(readiness.problems.length, 0);
  for (const flow of all.offline.coreFlows) {
    const result = coreFlowPreserved(all.offline, flow.id, { online: false });
    assert.equal(result.preserved, true);
  }
});

test("eksterne afhængigheder vises med en eksplicit status ved udfald", () => {
  const statuses = offlineDependencyStatuses(all.offline, { online: false });
  assert.ok(statuses.length >= 2);
  assert.ok(statuses.every((s) => s.available === false));
  assert.ok(statuses.every((s) => s.message && s.message.trim().length > 0));
  assert.ok(statuses.some((s) => s.status === "unavailable-visible"));
});

test("en manglende lokal fallback for en local-fallback-afhængighed afvises", () => {
  const broken = structuredClone(all.offline);
  const dep = broken.externalDependencies[0];
  dep.offlineBehavior = "local-fallback";
  dep.localFallbackRef = null;
  const problems = offlinePackageProblems(broken, { components: all.components, routes: [] });
  assert.ok(problems.some((p) => /lokal fallback/.test(p.message)));
});

test("en gateway-rute uden markering afvises", () => {
  const fakeRoutes = [{ id: "a-brand-new-model-route" }];
  const problems = offlinePackageProblems(all.offline, { components: all.components, routes: fakeRoutes });
  assert.ok(problems.some((p) => /ikke markeret/.test(p.message)));
});

test("adgang er default-deny og tenantadskilt", () => {
  const ada = { id: "oidc|ada.acme", tenantId: "acme", roles: ["lifecycle-admin"] };
  const gus = { id: "oidc|gus.globex", tenantId: "globex", roles: ["lifecycle-admin"] };
  const auditor = { id: "oidc|ida.auditor", tenantId: "acme", roles: ["lifecycle-auditor"] };
  assert.equal(decideLifecycleAccess({ principal: gus, tenantId: "acme", action: "read" }).allowed, false);
  assert.equal(decideLifecycleAccess({ principal: null, tenantId: "acme", action: "read" }).allowed, false);
  assert.equal(decideLifecycleAccess({ principal: auditor, tenantId: "acme", action: "rollback" }).allowed, false);
  assert.equal(decideLifecycleAccess({ principal: ada, tenantId: "acme", action: "rollback" }).allowed, true);
});
