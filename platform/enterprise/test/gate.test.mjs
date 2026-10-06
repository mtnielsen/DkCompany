import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../../conformance/src/schemas.mjs";
import { loadComponents, loadProfiles } from "../../distribution/src/catalog.mjs";
import { loadAll } from "../src/model.mjs";
import { resolveEnterprisePackage } from "../src/resolver.mjs";
import { evaluatePackageGate, deriveBuildBacklog } from "../src/gate.mjs";

const components = loadComponents();
const profiles = loadProfiles();
const all = loadAll(repoRoot);

function gateFor(pkg) {
  const resolution = resolveEnterprisePackage(pkg, { components, profiles, capabilityCatalog: all.capabilities });
  return evaluatePackageGate(pkg, { resolution, components });
}

test("ingen kanonisk pakke er implementerbar uden en underskrevet testkunde", () => {
  for (const pkg of all.packages.packages) {
    const gate = gateFor(pkg);
    assert.equal(gate.implementable, false, pkg.id);
    assert.ok(gate.blockers.length > 0, pkg.id);
    assert.ok(gate.blockers.some((b) => /testkunde/.test(b)), `${pkg.id}: ${gate.blockers.join("; ")}`);
  }
});

test("en katalogpost bliver ikke automatisk til en byggeopgave", () => {
  for (const pkg of all.packages.packages) {
    const gate = gateFor(pkg);
    assert.deepEqual(gate.buildBacklog, [], pkg.id);
    assert.ok(gate.catalogOnlyNotBuildTasks.length > 0, pkg.id);
  }
  const fixture = JSON.parse(readFileSync(join(repoRoot, "enterprise", "fixtures", "auto-build.package.json"), "utf8"));
  assert.deepEqual(deriveBuildBacklog(fixture, components), [], "en ordre uden ordrereference og godkender må ikke give byggeopgaver");
});

test("højrisiko-AI kræver en særskilt, bekræftet vurdering", () => {
  const regulated = all.packages.packages.find((p) => p.id === "regulated-care");
  const gate = gateFor(regulated);
  assert.ok(gate.blockers.some((b) => /højrisiko-AI/.test(b)), gate.blockers.join("; "));

  const confirmed = JSON.parse(JSON.stringify(regulated));
  confirmed.highRiskAi.status = "confirmed";
  confirmed.highRiskAi.reviewer = { subject: "oidc|ai.ejer", name: "Ai Ejer", role: "AI Responsible" };
  confirmed.highRiskAi.reviewedAt = "2026-03-01T00:00:00Z";
  const confirmedGate = gateFor(confirmed);
  assert.ok(!confirmedGate.blockers.some((b) => /højrisiko-AI/.test(b)), confirmedGate.blockers.join("; "));
});

test("en underskrevet testkunde og bekræftede faglige krav fjerner ikke kapabilitetsblokeringen", () => {
  const field = all.packages.packages.find((p) => p.id === "field-service");
  const fixed = JSON.parse(JSON.stringify(field));
  fixed.testCustomer.status = "consented";
  fixed.testCustomer.synthetic = false;
  fixed.testCustomer.contractRef = "contract://field-service-testkunde";
  for (const req of fixed.professionalRequirements) {
    req.status = "confirmed";
    req.reviewer = { subject: "oidc|fag.ejer", name: "Fag Ejer", role: "Reviewer" };
    req.reviewedAt = "2026-03-01T00:00:00Z";
    req.evidence = ["evidence/records/assurance-ai-oversight.evidence.json"];
  }
  const gate = gateFor(fixed);
  assert.equal(gate.implementable, false, "en manglende kapabilitet skal fortsat blokere");
  assert.ok(gate.blockers.some((b) => /field-dispatch/.test(b)));
});
