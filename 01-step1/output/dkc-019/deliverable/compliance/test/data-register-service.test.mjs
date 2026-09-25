/**
 * DKC-019 — registertjenestens tenantautorisation og validering.
 *
 * Beviser at en tenant-bundet principal kun kan læse/skrive sin egen kundes
 * register, at krydskunde-adgang kræver platformrollen plus en eksplicit scope,
 * at et ugyldigt register afvises før lageret, og at holds kræver en kendt post.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../../persistence/src/db.mjs";
import { createMigrator } from "../../persistence/src/migrations.mjs";
import { createSqliteDataRegisterStore } from "../../persistence/src/adapters/data-register.mjs";
import { createDataRegisterService } from "../src/register-service.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = join(here, "..", "..", "contracts", "examples", "data-register.example.json");
const example = () => JSON.parse(readFileSync(examplePath, "utf8"));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "dkc-register-service-"));
  const db = openDatabase({ path: join(dir, "register.db") });
  createMigrator({ db }).apply();
  const store = createSqliteDataRegisterStore({ db });
  return {
    service: createDataRegisterService({ store }),
    store,
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const acmeUser = { id: "oidc|acme.user", tenantId: "acme", roles: [] };
const opsAdmin = { id: "oidc|ops.admin", tenantId: "ops", roles: ["platform-admin:acme"] };
const opsNoScope = { id: "oidc|ops.noscope", tenantId: "ops", roles: [] };

test("en tenant-bundet principal kan skrive og læse sin egen kundes register", () => {
  const { service, cleanup } = fixture();
  try {
    const result = service.putVersion(acmeUser, { tenantId: "acme", register: example(), approvedBy: "oidc|anna" });
    assert.equal(result.tenantId, "acme");
    const entry = service.getEntry(acmeUser, { tenantId: "acme", entryId: "example-assistant" });
    assert.equal(entry.entryId, "example-assistant");
    assert.equal(service.listEntries(acmeUser, { tenantId: "acme" }).length, example().entries.length);
  } finally {
    cleanup();
  }
});

test("en principal kan ikke læse eller skrive en fremmed kundes register", () => {
  const { service, cleanup } = fixture();
  try {
    service.putVersion(acmeUser, { tenantId: "acme", register: example() });
    assert.throws(() => service.getEntry(acmeUser, { tenantId: "globex", entryId: "example-assistant" }), (err) => err.code === "tenant_forbidden");
    assert.throws(() => service.putVersion(acmeUser, { tenantId: "globex", register: example() }), (err) => err.code === "tenant_forbidden");
    assert.throws(() => service.getEntry(opsNoScope, { tenantId: "acme", entryId: "example-assistant" }), (err) => err.code === "tenant_forbidden");
  } finally {
    cleanup();
  }
});

test("platformrollen med eksplicit scope kan læse en anden kundes register", () => {
  const { service, cleanup } = fixture();
  try {
    service.putVersion(acmeUser, { tenantId: "acme", register: example() });
    const entry = service.getEntry(opsAdmin, { tenantId: "acme", entryId: "example-assistant" });
    assert.equal(entry.tenantId, "acme");
    assert.equal(service.listBlockers(opsAdmin, { tenantId: "acme" }).length, 0);
  } finally {
    cleanup();
  }
});

test("et register med en uafklaret persondatapost kan ikke gemmes som godkendt", () => {
  const { service, cleanup } = fixture();
  try {
    const register = example();
    const entry = register.entries.find((e) => e.id === "example-assistant");
    entry.legalBasis = { status: "pending-owner-decision", ground: null, decidedBy: null, decidedAt: null, note: "Afventer ejer" };
    entry.roles.processor = null;
    assert.throws(
      () => service.putVersion(acmeUser, { tenantId: "acme", register }),
      (err) => ["data_register_invalid", "data_register_inconsistent", "data_register_blocked"].includes(err.code)
    );
  } finally {
    cleanup();
  }
});

test("ukendt post giver 404, og holds kræver en kendt post", () => {
  const { service, cleanup } = fixture();
  try {
    assert.throws(() => service.getEntry(acmeUser, { tenantId: "acme", entryId: "findes-ikke" }), (err) => err.status === 404);
    assert.throws(() => service.placeHold(acmeUser, { tenantId: "acme", entryId: "findes-ikke", reason: "x" }), (err) => err.status === 404);
  } finally {
    cleanup();
  }
});

test("ressource-ID'en bærer tenanten", () => {
  const { service, cleanup } = fixture();
  try {
    assert.equal(service.resourceIdFor("acme", "example-assistant"), "res://acme/data-register-entry/example-assistant");
  } finally {
    cleanup();
  }
});
