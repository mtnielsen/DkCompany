import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, PRINCIPALS } from "./helpers.mjs";
import { decideMigrationAccess, assertMigrationAccess, MigrationAccessError } from "../src/permissions.mjs";

test("adgang er default-deny uden en verificeret principal", () => {
  const { sourceById, cleanup } = fixture();
  const source = sourceById("files-acme");
  assert.equal(decideMigrationAccess({ principal: null, source, action: "read" }).allowed, false);
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.ada, source, action: "unknown" }).allowed, false);
  cleanup();
});

test("en læserolle må læse og eksportere, men ikke importere", () => {
  const { sourceById, cleanup } = fixture();
  const source = sourceById("files-acme");
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.ben, source, action: "read" }).allowed, true);
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.ben, source, action: "export" }).allowed, true);
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.ben, source, action: "import" }).allowed, false);
  cleanup();
});

test("en skriverolle må importere og cutover", () => {
  const { sourceById, cleanup } = fixture();
  const source = sourceById("files-acme");
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.ada, source, action: "import" }).allowed, true);
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.ada, source, action: "cutover" }).allowed, true);
  cleanup();
});

test("en principal kan ikke handle på en anden tenants data", () => {
  const { sourceById, cleanup } = fixture();
  const files = sourceById("files-acme");
  const crmGlobex = sourceById("crm-globex");
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.gus, source: files, action: "read" }).allowed, false);
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.gus, source: crmGlobex, action: "read" }).allowed, true);
  assert.equal(decideMigrationAccess({ principal: PRINCIPALS.ada, source: crmGlobex, action: "read" }).allowed, false);
  cleanup();
});

test("assertMigrationAccess kaster på en afvisning", () => {
  const { sourceById, cleanup } = fixture();
  const source = sourceById("files-acme");
  assert.throws(() => assertMigrationAccess({ principal: PRINCIPALS.gus, source, action: "read" }), MigrationAccessError);
  cleanup();
});
