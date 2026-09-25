import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  repoRoot,
  configurationDigest,
  configurationContentDigest,
  effectiveSettings,
  secureDefaults,
} from "../src/model.mjs";
import { validateConfigurationInput, validateSubmission } from "../src/validate-api.mjs";
import { planConfigurationChange, detectDrift, applyDesiredState } from "../src/desired-state.mjs";
import { debugState, assertAuditTrailActive, eventsRecordedAt, MANDATORY_AUDIT_EVENTS } from "../src/debug.mjs";
import { previewRetentionChange, retentionPreviewProblems } from "../src/retention-change.mjs";
import { renderConfigurationView, handleConfigurationSubmission } from "../src/ui.mjs";

const desired = JSON.parse(readFileSync(join(repoRoot, "configuration/desired-state.json"), "utf8"));
const clone = () => structuredClone(desired);

test("den kanoniske ønskede tilstand validerer og har en stabil digest", () => {
  const result = validateConfigurationInput(desired, { source: "file" });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.digest, configurationDigest(desired));
  assert.equal(result.digest.length, 64);
});

test("fil og portal med samme indhold giver samme digest og effekt", () => {
  const fromFile = validateSubmission({ source: "file", payload: clone() });
  const fromPortal = validateSubmission({ source: "portal", payload: clone() });
  assert.equal(fromFile.ok, true);
  assert.equal(fromPortal.ok, true);
  assert.equal(fromFile.digest, fromPortal.digest);
});

test("ukendt kontrolkilde afvises", () => {
  const result = validateSubmission({ source: "sneaky", payload: clone() });
  assert.equal(result.ok, false);
});

test("effektive indstillinger arver installation, tenant og modul", () => {
  const settings = effectiveSettings(desired, { tenantId: "acme", moduleId: "host-management" });
  // Tenantens debug arves; modulets logniveau tilsidesætter.
  assert.equal(settings.debug.enabled, true);
  assert.equal(settings.logLevel, "warn");
  const withoutModule = effectiveSettings(desired, { tenantId: "acme" });
  assert.equal(withoutModule.logLevel, "info");
});

test("sikre standarder: debug slukket, backup tændt og ingen modelrute", () => {
  const defaults = secureDefaults();
  assert.equal(defaults.debug.enabled, false);
  assert.equal(defaults.backups.enabled, true);
  assert.deepEqual(defaults.modelRoutes, []);
});

test("revisionssporet kan ikke deaktiveres", () => {
  assert.equal(assertAuditTrailActive(desired), true);
  const broken = clone();
  broken.enforcement.auditTrailImmutable = false;
  assert.throws(() => assertAuditTrailActive(broken));
  // Også ved det mest støjende logniveau registreres revisionen.
  const recorded = eventsRecordedAt("error");
  for (const event of MANDATORY_AUDIT_EVENTS) assert.ok(recorded.mandatory.includes(event));
});

test("debug udløber efter den valgte TTL", () => {
  const before = debugState(desired, Date.parse("2026-09-24T09:00:00Z"), { tenantId: "acme" });
  const after = debugState(desired, Date.parse("2026-09-24T15:00:00Z"), { tenantId: "acme" });
  assert.equal(before.active, true);
  assert.equal(after.active, false);
});

test("retentionændring respekterer WORM og den menneskelige ramme", () => {
  const allowed = previewRetentionChange({
    current: desired.installation.retention,
    requested: [{ dataClass: "personal", fromDays: 90, toDays: 120 }],
    holds: [{ dataClass: "personal", legalHoldRef: "hold://acme", worm: true, until: "2026-12-31T00:00:00Z" }],
    frame: { frameRef: "frame://platform/retention-2026", approvedBy: "oidc|anna.andersen", approvedAt: "2026-09-24T08:00:00Z", minRetentionDays: 30, maxRetentionDays: 400 },
    authorization: desired.authorization,
    now: Date.parse("2026-09-24T08:00:00Z"),
  });
  assert.equal(allowed.decisions.find((d) => d.dataClass === "personal").allowed, true);

  const wormShorten = previewRetentionChange({
    current: desired.installation.retention,
    requested: [{ dataClass: "security", fromDays: 730, toDays: 365 }],
    holds: [],
    frame: { frameRef: "frame://platform/retention-2026", approvedBy: "oidc|anna.andersen", approvedAt: "2026-09-24T08:00:00Z", minRetentionDays: 30, maxRetentionDays: 800 },
    authorization: desired.authorization,
  });
  assert.equal(wormShorten.decisions.find((d) => d.dataClass === "security").allowed, false);

  const outsideFrame = previewRetentionChange({
    current: desired.installation.retention,
    requested: [{ dataClass: "internal", fromDays: 365, toDays: 5000 }],
    holds: [],
    frame: { frameRef: "frame://platform/retention-2026", approvedBy: "oidc|anna.andersen", approvedAt: "2026-09-24T08:00:00Z", minRetentionDays: 30, maxRetentionDays: 400 },
    authorization: desired.authorization,
  });
  assert.equal(outsideFrame.decisions.find((d) => d.dataClass === "internal").allowed, false);
});

test("tavs drift mellem ønsket og faktisk tilstand opdages", () => {
  assert.equal(detectDrift({ desired, actual: clone() }).drift, false);
  const drifted = clone();
  drifted.installation.logLevel = "error";
  const result = detectDrift({ desired, actual: drifted });
  assert.equal(result.drift, true);
  assert.ok(result.changes.some((c) => c.path.endsWith("/logLevel")));
});

test("applyDesiredState kræver menneskelig autorisation med matchende digest", () => {
  const path = join(tmpdir(), `dkc054-config-${process.pid}.json`);
  try {
    const good = clone();
    good.authorization.decisionDigest = configurationContentDigest(good);
    assert.equal(applyDesiredState({ desired: good, path, now: Date.parse("2026-09-24T09:00:00Z") }).ok, true);

    const bad = clone();
    bad.authorization.decisionDigest = "f".repeat(64);
    const rejected = applyDesiredState({ desired: bad, now: Date.parse("2026-09-24T09:00:00Z") });
    assert.equal(rejected.ok, false);

    const agent = clone();
    agent.authorization = { ...agent.authorization, humanSubject: "agent|implementer", decisionDigest: configurationContentDigest(agent) };
    assert.equal(applyDesiredState({ desired: agent }).ok, false);
  } finally {
    rmSync(path, { force: true });
  }
});

test("UI og fil giver samme resultat og viser drift", () => {
  const fromUi = handleConfigurationSubmission({ source: "portal", payload: clone(), desired });
  assert.equal(fromUi.ok, true);
  assert.equal(fromUi.applied, false);
  const html = renderConfigurationView({ desired, actual: desired });
  assert.match(html, /Ønsket vs\. faktisk/);

  const change = planConfigurationChange({ current: desired, desired: (() => { const c = clone(); c.installation.logLevel = "warn"; return c; })() });
  assert.equal(change.requiresHumanApproval, true);
  assert.ok(change.changes.some((c) => c.to === "warn"));
});

test("retentionPreviewProblems accepterer det kanoniske eksempel", () => {
  const example = JSON.parse(readFileSync(join(repoRoot, "contracts/examples/retention-change-preview.example.json"), "utf8"));
  assert.deepEqual(retentionPreviewProblems(example, { now: Date.parse("2026-09-24T08:00:00Z") }), []);
});
