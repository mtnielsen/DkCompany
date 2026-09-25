#!/usr/bin/env node
/**
 * DKC-036 — scaffold for enterprise- og branchepakker.
 *
 *   node enterprise/src/scaffold.mjs new <pakke-id> [--out <mappe>] ...
 *
 * Skabelonen ligger i `enterprise/scaffold/package.template.json`. Scaffolden
 * fylder id, titel, segment, produktejer og testkunde ind, arver de fælles
 * sikkerhedskontrakter fra det kanoniske pakkekatalog og validerer resultatet
 * mod skemaet og den semantiske model, før noget skrives. Derved kan en ny
 * branchepakke oprettes uden at forke kontrolplanet.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAjv, validate, SCHEMA_IDS } from "../../conformance/src/schemas.mjs";
import { loadComponents, loadProfiles } from "../../distribution/src/catalog.mjs";
import { loadAll, packageCatalogProblems } from "./model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, "..", "..");
export const TEMPLATE_PATH = join(repoRoot, "enterprise", "scaffold", "package.template.json");

function titleCase(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fill(value, replacements) {
  if (typeof value === "string") {
    let out = value;
    for (const [key, replacement] of Object.entries(replacements)) out = out.split(key).join(replacement);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => fill(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, replacements)]));
  }
  return value;
}

export function scaffoldCatalog(id, options = {}) {
  const base = loadAll(repoRoot).packages;
  const template = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));
  const owner = options.owner ?? { subject: "oidc|ny.ejer", name: "Ny Ejer", role: "Product Owner" };
  const contact = options.contact ?? { subject: "oidc|ny.kunde", name: "Ny Kontakt", role: "Customer Contact" };
  const replacements = {
    "__ID__": id,
    "__TITLE__": options.title ?? titleCase(id),
    "__SEGMENT__": options.segment ?? "enterprise",
    "__OWNER__": owner.subject.replace(/^oidc\|/, ""),
    "__OWNER_NAME__": owner.name,
    "__CUSTOMER__": options.customer ?? "Ny Testkunde A/S",
    "__CONTACT__": contact.subject.replace(/^oidc\|/, ""),
    "__CONTACT_NAME__": contact.name,
  };
  const pkg = fill(template, replacements);
  if (options.baseProfileRef) pkg.baseProfileRef = options.baseProfileRef;
  if (Number.isInteger(options.order)) pkg.order = options.order;
  pkg.productOwner = { ...owner };

  return {
    apiVersion: base.apiVersion,
    kind: base.kind,
    metadata: {
      name: `${id}-packages`,
      version: "1.0.0",
      description: `Scaffoldet branchepakke '${pkg.title}' med arvede sikkerhedskontrakter. Udfyld faglige krav, dataejerskab og testkunde, og lad en fagperson bekræfte dem.`,
      accountableHuman: base.metadata.accountableHuman,
      labels: { ...(base.metadata.labels ?? {}), scaffold: "true" },
    },
    capabilitiesRef: base.capabilitiesRef,
    securityContracts: base.securityContracts,
    packages: [pkg],
  };
}

export function scaffoldProblems(catalog, root = repoRoot) {
  const problems = [];
  const ajv = buildAjv().ajv;
  const { ok, errors } = validate(ajv, SCHEMA_IDS.enterprisePackage, catalog);
  if (!ok) for (const e of errors) problems.push(`${e.path} ${e.message}`.trim());
  const all = loadAll(root);
  const context = {
    capabilities: all.capabilities,
    components: loadComponents(),
    profiles: loadProfiles(),
    gatePolicy: all.gatePolicy,
    tco: all.tco,
    companyProfiles: all.companyProfiles,
    pilotProfiles: all.pilotProfiles,
    exampleFiles: null,
  };
  for (const e of packageCatalogProblems(catalog, context)) problems.push(`${e.path} ${e.message}`.trim());
  return problems;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") options.out = argv[++i];
    else if (arg === "--title") options.title = argv[++i];
    else if (arg === "--segment") options.segment = argv[++i];
    else if (arg === "--base-profile") options.baseProfileRef = argv[++i];
    else if (arg === "--order") options.order = Number.parseInt(argv[++i], 10);
    else if (arg === "--owner-name") options.owner = { ...(options.owner ?? {}), name: argv[++i] };
    else if (arg === "--owner-subject") options.owner = { ...(options.owner ?? {}), subject: argv[++i] };
    else if (arg === "--customer") options.customer = argv[++i];
    else if (arg === "--contact-name") options.contact = { ...(options.contact ?? {}), name: argv[++i] };
    else if (arg === "--contact-subject") options.contact = { ...(options.contact ?? {}), subject: argv[++i] };
  }
  return options;
}

function main() {
  const [command, id] = process.argv.slice(2);
  if (command !== "new" || !id) {
    console.error("Brug: node enterprise/src/scaffold.mjs new <pakke-id> [--out <mappe>] [--title <titel>] [--segment <segment>] [--base-profile <profil>] [--order <n>]");
    process.exit(2);
  }
  const options = parseArgs(process.argv.slice(4));
  const catalog = scaffoldCatalog(id, options);
  const problems = scaffoldProblems(catalog);
  if (problems.length) {
    console.error("✘ Scaffolden kunne ikke validere den nye pakke:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const text = JSON.stringify(catalog, null, 2) + "\n";
  if (!options.out) {
    process.stdout.write(text);
    return;
  }
  mkdirSync(options.out, { recursive: true });
  writeFileSync(join(options.out, `${id}.package.json`), text);
  writeFileSync(join(options.out, `${id}.conformance.example.json`), text);
  console.log(`✔ Skrev ${id}.package.json og ${id}.conformance.example.json til ${options.out}`);
  if (!existsSync(join(options.out, `${id}.package.json`))) process.exit(1);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) main();
