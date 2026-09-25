/**
 * DKC-054 — konformanstest for installer og fælles konfiguration.
 *
 * Efterprøver acceptkriterierne på validatorniveau mod de rigtige eksempler og
 * de kanoniske kilder, plus negative varianter der skal afvises.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, buildAjv } from "../src/schemas.mjs";
import {
  validatePlatformConfiguration,
  validateHostScope,
  validateInstallerPlan,
  validateRetentionChangePreview,
  hostScopeProblems,
} from "../src/configuration.mjs";
import { verifyPlanSignature } from "../../installer/src/plan.mjs";
import { planDigest } from "../../installer/src/plan.mjs";

const read = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const { ajv } = buildAjv();
const keyring = read("configuration/dev-keyring.json");
const platforms = read("catalog/platforms.json").platforms;

test("platform-konfigurationseksemplet validerer (skema + semantik)", () => {
  const result = validatePlatformConfiguration(read("contracts/examples/platform-configuration.example.json"), ajv);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("host-scope-eksemplet validerer (skema + semantik)", () => {
  const result = validateHostScope(read("contracts/examples/host-scope.example.json"), ajv, { platforms });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("installationsplan-eksemplet validerer og er signeret", () => {
  const plan = read("contracts/examples/installer-plan.example.json");
  const result = validateInstallerPlan(plan, ajv);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(verifyPlanSignature(plan, keyring).ok, true);
});

test("retentionændrings-previewet validerer (skema + holds/WORM/ramme)", () => {
  const result = validateRetentionChangePreview(read("contracts/examples/retention-change-preview.example.json"), ajv);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("et aktivt debug uden TTL afvises", () => {
  const broken = read("contracts/examples/platform-configuration.example.json");
  broken.installation.debug = { enabled: true, expiresAt: null, reason: "fejlfinding uden frist", requestedBy: "oidc|anna.andersen" };
  const result = validatePlatformConfiguration(broken, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("/debug/expiresAt")));
});

test("en WORM-beskyttet klasse uden WORM afvises", () => {
  const broken = read("contracts/examples/platform-configuration.example.json");
  broken.installation.retention.find((r) => r.dataClass === "personal").worm = false;
  const result = validatePlatformConfiguration(broken, ajv);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("worm")));
});

test("en ukendt modelrute afvises (ingen skjult konfigurationskilde)", () => {
  const broken = read("contracts/examples/platform-configuration.example.json");
  broken.installation.modelRoutes = [{ dataClass: "internal", routeRef: "nope", provider: "anthropic", egressApproved: false }];
  const result = validatePlatformConfiguration(broken, ajv);
  assert.equal(result.ok, false);
});

test("host-scope med diskformatering eller root-adgang afvises", () => {
  const broken = read("contracts/examples/host-scope.example.json");
  broken.diskPolicy.formatAllowed = true;
  broken.privileges.noRootForAgents = false;
  const problems = hostScopeProblems(broken, { platforms });
  assert.ok(problems.some((p) => p.path.includes("formatAllowed")));
  assert.ok(problems.some((p) => p.path.includes("noRootForAgents")));
});

test("en installationsplan der ændrer host-OS afvises", () => {
  const broken = read("contracts/examples/installer-plan.example.json");
  broken.restrictions.changeHostOs = true;
  const result = validateInstallerPlan(broken, ajv);
  assert.equal(result.ok, false);
});

test("en retentionændring der forkorter WORM må ikke være tilladt", () => {
  const broken = read("contracts/examples/retention-change-preview.example.json");
  const security = broken.decisions.find((d) => d.dataClass === "security");
  const req = broken.requested.find((r) => r.dataClass === "security");
  security.allowed = true;
  security.reason = "forkorter WORM";
  req.toDays = 365;
  req.fromDays = 730;
  broken.holds.push({ dataClass: "security", legalHoldRef: "worm://platform", worm: true, until: null });
  const result = validateRetentionChangePreview(broken, ajv);
  assert.equal(result.ok, false);
});

test("planens digest ændres, når indholdet ændres", () => {
  const plan = read("contracts/examples/installer-plan.example.json");
  const modified = clone(plan);
  modified.restrictions.changeHostOs = true;
  assert.notEqual(planDigest(plan), planDigest(modified));
});
