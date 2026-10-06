/**
 * DKC-025 — server-rendered, tilgængelig portal-UI.
 *
 * UI'en er bygget af semantisk HTML: ét `<h1>`, rigtige `<nav>`, `<table>` med
 * `<th scope>`, `<label>` til hvert felt og et `aria-live`-område til fejl.
 * Alle interaktive elementer er native links/knapper/inputs, så portalen kan
 * betjenes med tastaturet uden JavaScript. Der er en "spring til indhold"-linje
 * først i tabulatorrækkefølgen, og sproget sættes på `<html lang>`.
 */
import { t } from "./i18n.mjs";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(amount, currency = "DKK") {
  return `${Number(amount ?? 0).toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function statusLabel(lang, state) {
  return t(lang, `status.${state}`);
}

function panel(id, heading, bodyHtml, lang) {
  return `<section id="${escapeHtml(id)}" aria-labelledby="${escapeHtml(id)}-h">
  <h2 id="${escapeHtml(id)}-h">${escapeHtml(heading)}</h2>
  ${bodyHtml}
</section>`;
}

export function renderAppsSection({ lang, apps = [] } = {}) {
  const rows = apps.length
    ? apps
        .map(
          (app) => `<tr data-app="${escapeHtml(app.id)}">
      <td>${escapeHtml(t(lang, app.titleKey))}</td>
      <td>${escapeHtml(app.packageId)}</td>
      <td>${escapeHtml(app.packageVersion)}</td>
      <td>${escapeHtml(statusLabel(lang, app.state))}</td>
    </tr>`
        )
        .join("\n")
    : `<tr><td colspan="4">${escapeHtml(t(lang, "empty.apps"))}</td></tr>`;
  const table = `<table>
    <thead><tr>
      <th scope="col">${escapeHtml(t(lang, "nav.apps"))}</th>
      <th scope="col">${escapeHtml(t(lang, "field.package"))}</th>
      <th scope="col">${escapeHtml(t(lang, "field.version"))}</th>
      <th scope="col">${escapeHtml(t(lang, "field.state"))}</th>
    </tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
  return panel("apps", t(lang, "heading.apps"), table, lang);
}

export function renderInboxSection({ lang, inbox = [] } = {}) {
  const rows = inbox.length
    ? inbox
        .map(
          (item) => `<tr>
      <td>${escapeHtml(item.packageId)} ${escapeHtml(item.packageVersion)}</td>
      <td>${escapeHtml(item.requestedBy?.name ?? item.requestedBy?.subject ?? "?")}</td>
      <td>${escapeHtml(formatMoney(item.monthly, item.currency))}</td>
      <td>${escapeHtml(item.requestedAt)}</td>
      <td><button type="submit" name="approveOrder" value="${escapeHtml(item.orderId)}">${escapeHtml(t(lang, "action.approve"))}</button></td>
    </tr>`
        )
        .join("\n")
    : `<tr><td colspan="5">${escapeHtml(t(lang, "empty.inbox"))}</td></tr>`;
  const table = `<table>
    <thead><tr>
      <th scope="col">${escapeHtml(t(lang, "field.package"))}</th>
      <th scope="col">${escapeHtml(t(lang, "field.customer"))}</th>
      <th scope="col">${escapeHtml(t(lang, "field.monthly"))}</th>
      <th scope="col">${escapeHtml(t(lang, "field.state"))}</th>
      <th scope="col">${escapeHtml(t(lang, "action.approve"))}</th>
    </tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
  return panel("inbox", t(lang, "heading.inbox"), table, lang);
}

export function renderStatusSection({ lang, status } = {}) {
  const level = status?.level ?? "created";
  const issues = (status?.issues ?? []).length
    ? `<ul>${status.issues.map((i) => `<li>${escapeHtml(i.stepId)}: ${escapeHtml(i.error ?? i.state)}</li>`).join("")}</ul>`
    : "";
  const body = `<p aria-live="polite">${escapeHtml(t(lang, "field.state"))}: <strong>${escapeHtml(statusLabel(lang, level))}</strong></p>
  <p>${escapeHtml(status?.active ?? 0)} ${escapeHtml(t(lang, "status.succeeded"))}</p>
  ${issues}`;
  return panel("status", t(lang, "heading.status"), body, lang);
}

export function renderConsumptionSection({ lang, consumption } = {}) {
  const rows = (consumption?.lines ?? []).length
    ? consumption.lines
        .map(
          (line) => `<tr>
      <td>${escapeHtml(line.packageId)} ${escapeHtml(line.packageVersion)}</td>
      <td>${escapeHtml(statusLabel(lang, line.state))}</td>
      <td>${escapeHtml(formatMoney(line.monthly, line.currency))}</td>
    </tr>`
        )
        .join("\n")
    : `<tr><td colspan="3">${escapeHtml(t(lang, "empty.consumption"))}</td></tr>`;
  const body = `<table>
    <thead><tr>
      <th scope="col">${escapeHtml(t(lang, "field.package"))}</th>
      <th scope="col">${escapeHtml(t(lang, "field.state"))}</th>
      <th scope="col">${escapeHtml(t(lang, "field.monthly"))}</th>
    </tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p>${escapeHtml(t(lang, "field.monthlyTotal"))}: <strong>${escapeHtml(formatMoney(consumption?.monthly, consumption?.currency))}</strong></p>`;
  return panel("consumption", t(lang, "heading.consumption"), body, lang);
}

export function renderRolesSection({ lang, roles = [] } = {}) {
  const items = roles
    .map(
      (role) => `<li><strong>${escapeHtml(t(lang, role.titleKey))}</strong> ${role.held ? "✓" : ""}<br>${escapeHtml(t(lang, role.descriptionKey))}</li>`
    )
    .join("\n");
  return panel("roles", t(lang, "heading.roles"), `<ul>${items}</ul>`, lang);
}

/**
 * Bestillingsoversigt. Kunden ser pris, delpriser og hver konsekvens — og
 * hvilke der kræver et eksplicit acknowledgement — før ordren kan oprettes.
 */
export function renderOrderPreview({ lang, pkg, preview, acknowledgedConsequences = [] } = {}) {
  const acked = new Set(acknowledgedConsequences);
  const priceRows = (preview?.components ?? [])
    .map(
      (c) => `<tr><td>${escapeHtml(c.id)}</td><td>${escapeHtml(formatMoney(c.monthly, preview.currency))}</td></tr>`
    )
    .join("\n");
  const consequences = (preview?.consequences ?? [])
    .map(
      (c) => `<li>
      <span>${escapeHtml(c.description)}</span>
      ${c.requiresAcknowledgment ? `<label><input type="checkbox" name="acknowledge" value="${escapeHtml(c.id)}" ${acked.has(c.id) ? "checked" : ""}> ${escapeHtml(t(lang, "ack.label"))}</label>` : `<em>${escapeHtml(t(lang, "ack.required"))}: nej</em>`}
    </li>`
    )
    .join("\n");
  const body = `<p>${escapeHtml(t(lang, "field.package"))}: <strong>${escapeHtml(pkg?.metadata?.name)} ${escapeHtml(pkg?.metadata?.version)}</strong></p>
  <table>
    <thead><tr><th scope="col">${escapeHtml(t(lang, "field.price"))}</th><th scope="col">${escapeHtml(t(lang, "field.monthly"))}</th></tr></thead>
    <tbody>
${priceRows}
      <tr><td><strong>${escapeHtml(t(lang, "field.monthlyTotal"))}</strong></td><td><strong>${escapeHtml(formatMoney(preview?.monthly, preview?.currency))}</strong></td></tr>
      <tr><td>${escapeHtml(t(lang, "field.implementation"))}</td><td>${escapeHtml(formatMoney(preview?.implementation, preview?.currency))}</td></tr>
      <tr><td><strong>${escapeHtml(t(lang, "field.firstMonthTotal"))}</strong></td><td><strong>${escapeHtml(formatMoney(preview?.firstMonthTotal, preview?.currency))}</strong></td></tr>
    </tbody>
  </table>
  <h3>${escapeHtml(t(lang, "field.consequences"))}</h3>
  <ul>
${consequences}
  </ul>`;
  return panel("order-preview", t(lang, "heading.orderPreview"), body, lang);
}

/**
 * Den fulde side. Fejl vises i et `role="alert"`-område med en lokaliseret
 * besked og en stabil kode, så en bruger får en tydelig fejl i stedet for en
 * tavs afvisning.
 */
export function renderPortalPage({ lang, customer, sections = [], error = null } = {}) {
  const customerName = customer?.name ?? t(lang, "portal.customerUnknown");
  const navItems = [
    ["#apps", t(lang, "nav.apps")],
    ["#inbox", t(lang, "nav.inbox")],
    ["#status", t(lang, "nav.status")],
    ["#consumption", t(lang, "nav.consumption")],
    ["#roles", t(lang, "nav.roles")],
  ];
  const nav = `<nav aria-label="${escapeHtml(t(lang, "portal.title"))}">
    <ul>${navItems.map(([href, label]) => `<li><a href="${href}">${escapeHtml(label)}</a></li>`).join("")}</ul>
  </nav>`;
  const errorHtml = error
    ? `<div id="error" role="alert" tabindex="-1">
    <h2>${escapeHtml(t(lang, "heading.error"))}</h2>
    <p>${escapeHtml(error.message)}</p>
    <p><code>${escapeHtml(error.code)}</code></p>
  </div>`
    : "";
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(t(lang, "portal.title"))} — ${escapeHtml(customerName)}</title>
</head>
<body>
  <a class="skip" href="#main">${escapeHtml(t(lang, "portal.skip"))}</a>
  <header>
    <h1>${escapeHtml(t(lang, "portal.title"))}</h1>
    <p>${escapeHtml(t(lang, "field.customer"))}: ${escapeHtml(customerName)}</p>
    ${nav}
  </header>
  ${errorHtml}
  <main id="main" tabindex="-1">
${sections.join("\n")}
  </main>
</body>
</html>
`;
}
