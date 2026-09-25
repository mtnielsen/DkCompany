import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssuranceRegister, loadEvidenceRecordMap, assembleEvidencePackage } from "../src/assurance.mjs";
import { createAssuranceService, AssuranceError } from "../src/assurance-service.mjs";
import { createFileAcceptanceLedger } from "../src/assurance-ledger.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function workDir() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-assurance-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function service(dir) {
  const register = loadAssuranceRegister(repoRoot);
  const ledger = createFileAcceptanceLedger({ path: join(dir, "acceptance.ndjson") });
  return { svc: createAssuranceService({ register, ledger }), ledger, register };
}

const owner = { id: "oidc|anna.andersen", kind: "human", subject: "oidc|anna.andersen", name: "Anna Andersen", roles: ["platform-owner"] };
const security = { id: "oidc|cecilia.christensen", kind: "human", subject: "oidc|cecilia.christensen", name: "Cecilia Christensen", roles: ["security-owner"] };
const ops = { id: "oidc|bo.bertelsen", kind: "human", subject: "oidc|bo.bertelsen", name: "Bo Bertelsen", roles: ["operations-lead"] };
const serviceAccount = { id: "spiffe|compliance", kind: "workload", subject: "spiffe|compliance", roles: ["platform-admin"] };
const outsider = { id: "oidc|eve", kind: "human", subject: "oidc|eve", name: "Eve", roles: ["viewer"] };
const demo = { id: "demo|agent", kind: "human", subject: "demo|agent", name: "Demo", roles: ["platform-owner"], demo: true };

test("læsning af registeret er default-deny", () => {
  const { dir, cleanup } = workDir();
  try {
    const { svc } = service(dir);
    assert.throws(() => svc.readRegister(null), (e) => e instanceof AssuranceError && e.status === 401);
    assert.throws(() => svc.readRegister(outsider), (e) => e.status === 403);
    assert.equal(svc.readRegister(security).metadata.name, "platform-assurance-register");
  } finally {
    cleanup();
  }
});

test("kun et verificeret menneske med accept-rolle kan acceptere", () => {
  const { dir, cleanup } = workDir();
  try {
    const { svc } = service(dir);
    assert.throws(() => svc.acceptRequirement(serviceAccount, { requirementId: "REQ-AIACT-001", rationale: "x".repeat(30) }), (e) => e.code === "human_required");
    assert.throws(() => svc.acceptRequirement(demo, { requirementId: "REQ-AIACT-001", rationale: "x".repeat(30) }), (e) => e.code === "demo_identity");
    assert.throws(() => svc.acceptRequirement(outsider, { requirementId: "REQ-AIACT-001", rationale: "x".repeat(30) }), (e) => e.code === "forbidden");
  } finally {
    cleanup();
  }
});

test("kravets ejer kan ikke acceptere sit eget krav", () => {
  const { dir, cleanup } = workDir();
  try {
    const { svc } = service(dir);
    assert.throws(
      () => svc.acceptRequirement(ops, { requirementId: "REQ-AIACT-001", rationale: "En lang nok begrundelse for accept." }),
      (e) => e.code === "self_accept"
    );
  } finally {
    cleanup();
  }
});

test("en accept kræver en begrundelse og et kendt krav", () => {
  const { dir, cleanup } = workDir();
  try {
    const { svc } = service(dir);
    assert.throws(() => svc.acceptRequirement(owner, { requirementId: "REQ-NIS2-001", rationale: "kort" }), (e) => e.status === 422);
    assert.throws(() => svc.acceptRequirement(owner, { requirementId: "REQ-FINDES-IKKE", rationale: "x".repeat(30) }), (e) => e.status === 404);
  } finally {
    cleanup();
  }
});

test("en gyldig accept bevares i en hash-kædet journal", () => {
  const { dir, cleanup } = workDir();
  try {
    const { svc, ledger } = service(dir);
    const result = svc.acceptRequirement(owner, { requirementId: "REQ-NIS2-001", rationale: "Kravet er efterprøvet og accepteres af platformejeren." });
    assert.equal(result.accepted, true);
    assert.equal(result.complianceStatus, "not-certified");
    assert.equal(ledger.verify().ok, true);
    const history = svc.acceptanceHistory(owner);
    assert.equal(history.entries.length, 1);
    assert.equal(history.entries[0].requirementId, "REQ-NIS2-001");
    assert.equal(history.verification.ok, true);
  } finally {
    cleanup();
  }
});

test("en ændret acceptjournal opdages", () => {
  const { dir, cleanup } = workDir();
  try {
    const { svc, ledger } = service(dir);
    svc.acceptRequirement(owner, { requirementId: "REQ-NIS2-001", rationale: "Kravet er efterprøvet og accepteres af platformejeren." });
    const path = ledger.path;
    const lines = readFileSync(path, "utf8").trim().split("\n");
    const tampered = JSON.parse(lines[0]);
    tampered.rationale = "ændret";
    lines[0] = JSON.stringify(tampered);
    writeFileSync(path, lines.join("\n") + "\n");
    assert.equal(ledger.verify().ok, false);
  } finally {
    cleanup();
  }
});

test("en eksport efter en accept erklærer stadig ikke compliance eller produktion", () => {
  const { dir, cleanup } = workDir();
  try {
    const { svc } = service(dir);
    svc.acceptRequirement(owner, { requirementId: "REQ-NIS2-001", rationale: "Kravet er efterprøvet og accepteres af platformejeren." });
    const register = loadAssuranceRegister(repoRoot);
    const records = loadEvidenceRecordMap(join(repoRoot, "evidence", "records"));
    const pkg = svc.exportPackage(owner, { evidenceRecords: records, now: Date.parse("2026-09-24T10:05:00Z") });
    assert.equal(pkg.acceptedBy, null);
    assert.equal(pkg.acceptedAt, null);
    assert.equal(pkg.complianceStatus, "not-certified");
    assert.equal(pkg.notACertification, true);
    assert.equal(pkg.productionReady, false);
    // Sammenlign med assembleren direkte, så vi ved at tjenesten ikke ændrer pakken.
    const direct = assembleEvidencePackage({ register, evidenceRecords: records, now: Date.parse("2026-09-24T10:05:00Z") });
    assert.equal(pkg.badge, direct.badge);
  } finally {
    cleanup();
  }
});
