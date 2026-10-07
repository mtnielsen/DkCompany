/**
 * DKC-025 — servicepakker, pris og konsekvenser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { acknowledgmentProblems, loadServicePackages, orderPreview, selectPackage, servicePackageProblems } from "../src/packages.mjs";

const packages = loadServicePackages().map((entry) => entry.package);

test("de kanoniske servicepakker er semantisk gyldige", () => {
  const componentIds = new Set(["platform-core", "identity-broker", "audit-service", "communications", "hr", "bi", "reporting"]);
  for (const pkg of packages) {
    assert.deepEqual(servicePackageProblems(pkg, { componentIds }), [], pkg.metadata.name);
  }
});

test("vælg nyeste version og fejl på ukendt pakke", () => {
  assert.equal(selectPackage(packages, { packageId: "starter" }).metadata.version, "1.0.0");
  assert.equal(selectPackage(packages, { packageId: "findes-ikke" }), null);
});

test("previewet summerer delpriser og medregner implementering", () => {
  const pkg = selectPackage(packages, { packageId: "starter" });
  const preview = orderPreview(pkg);
  assert.equal(preview.currency, "DKK");
  assert.equal(preview.monthly, 1500);
  assert.equal(preview.implementation, 5000);
  assert.equal(preview.firstMonthTotal, 6500);
  assert.equal(preview.components.length, 3);
});

test("en pakke med persondata kræver kvittering for væsentlige konsekvenser", () => {
  const pkg = selectPackage(packages, { packageId: "hr-suite" });
  const preview = orderPreview(pkg);
  assert.ok(preview.requiresAcknowledgment.includes("personal-data"));
  assert.equal(acknowledgmentProblems(pkg, []).length, preview.requiresAcknowledgment.length);
  assert.deepEqual(acknowledgmentProblems(pkg, preview.requiresAcknowledgment), []);
});

test("semantikken afviser en pakke uden pris og uden ansvarlig person", () => {
  const broken = structuredClone(selectPackage(packages, { packageId: "starter" }));
  broken.metadata.accountableHuman = { subject: "team@example.org", name: "Team", role: "Team" };
  broken.price.monthly = 9999;
  const problems = servicePackageProblems(broken, { componentIds: new Set(["platform-core", "identity-broker", "audit-service"]) });
  assert.ok(problems.some((p) => p.path.includes("accountableHuman")));
  assert.ok(problems.some((p) => p.path.includes("monthly")));
});

test("semantikken afviser en pakke uden væsentlig konsekvens", () => {
  const broken = structuredClone(selectPackage(packages, { packageId: "starter" }));
  broken.consequences = broken.consequences.filter((c) => c.severity !== "material");
  assert.ok(servicePackageProblems(broken).some((p) => p.path === "/consequences"));
});

test("semantikken afviser et ukendt modul", () => {
  const broken = structuredClone(selectPackage(packages, { packageId: "starter" }));
  broken.modules[0].id = "spooky-module";
  assert.ok(servicePackageProblems(broken, { componentIds: new Set(["identity-broker", "audit-service"]) }).some((p) => p.path.includes("/modules/0/id")));
});
