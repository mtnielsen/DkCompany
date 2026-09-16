import { test } from "node:test";
import assert from "node:assert/strict";
import { orchestrate, loadAllModules, buildRequest } from "../src/dsar.mjs";
import { buildAjv, validate, SCHEMA_IDS } from "../src/schemas.mjs";

test("DSAR fan-out mod to dummy-moduler giver per-modul status", async () => {
  const modules = loadAllModules();
  assert.ok(modules.length >= 2, "forventer mindst to dummy-moduler");

  const request = buildRequest({
    verb: "subject.erase",
    tenantId: "acme",
    identifiers: [{ type: "email", value: "kunde@example.org" }],
  });

  const response = await orchestrate(request, modules, { offline: true });

  // Hvert modul skal optræde med sin egen status — ikke skjules i et aggregat.
  assert.equal(response.summary.modulesQueried, modules.length);
  assert.equal(response.results.length, modules.length);
  const ok = response.results.find((r) => r.module === "dummy-ok");
  assert.equal(ok.status, "full");
  const broken = response.results.find((r) => r.module === "dummy-broken");
  assert.equal(broken.status, "partial");
  assert.equal(response.status, "partially-completed");

  const { ajv } = buildAjv();
  const { ok: valid, errors } = validate(ajv, SCHEMA_IDS.privacyResponse, response);
  assert.equal(valid, true, JSON.stringify(errors, null, 2));
});
