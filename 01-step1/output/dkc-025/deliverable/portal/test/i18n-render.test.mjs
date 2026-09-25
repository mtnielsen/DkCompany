/**
 * DKC-025 — dansk/engelsk, tastaturbetjening og tydelige fejl.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES, messageKeys, normalizeLang, t } from "../src/i18n.mjs";
import { orderPreview } from "../src/packages.mjs";
import { renderOrderPreview, renderPortalPage } from "../src/render.mjs";
import { packages } from "./support/fixtures.mjs";

test("dansk og engelsk har samme nøgler", () => {
  const da = Object.keys(MESSAGES.da).sort();
  const en = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(da, en);
  for (const key of messageKeys()) assert.ok(da.includes(key), `mangler ${key}`);
});

test("ukendt sprog falder tilbage til dansk", () => {
  assert.equal(normalizeLang("en-GB"), "en");
  assert.equal(normalizeLang("de"), "da");
  assert.equal(normalizeLang(undefined), "da");
  assert.equal(t("en", "nav.apps"), "Apps");
  assert.equal(t("da", "nav.apps"), "Appe");
});

test("siden sætter sprog, spring-til-indhold og tastaturfokus", () => {
  const html = renderPortalPage({ lang: "en", customer: { name: "Acme" }, sections: [] });
  assert.match(html, /<html lang="en">/);
  assert.match(html, /class="skip"/);
  assert.match(html, /id="main" tabindex="-1"/);
  assert.match(html, /<nav aria-label=/);
});

test("en fejl vises i et tydeligt, lokaliseret alarmområde", () => {
  const da = renderPortalPage({ lang: "da", error: { code: "tenant_forbidden", message: "Handlingen hører til en anden kunde." } });
  assert.match(da, /role="alert"/);
  assert.match(da, /Handlingen hører til en anden kunde/);
  assert.match(da, /tenant_forbidden/);
});

test("bestillingsoversigten viser pris og konsekvenser før bestilling", () => {
  const pkg = packages().find((p) => p.metadata.name === "hr-suite");
  const preview = orderPreview(pkg);
  const html = renderOrderPreview({ lang: "da", pkg, preview });
  assert.match(html, /Første måned i alt/);
  assert.match(html, /3\.600,00 DKK/);
  assert.match(html, /Jeg har læst og forstået konsekvensen/);
  assert.match(html, /type="checkbox"/);
});
