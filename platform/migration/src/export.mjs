/**
 * DKC-031 — exit-eksport i dokumenterede, selvbeskrivende formater.
 *
 * Eksporten skrives som JSON Lines, CSV og en manifest-JSON sammen med en
 * `README.md` og et **standalone** læse-script, der kun bruger Nodes indbyggede
 * moduler. Dermed kan kunden læse og verificere sin eksport uden en aktiv
 * DkCompany-installation. Eksporten indeholder alle seks dækningsfacetter
 * (ejerskab, timestamps, kommentarer, bilag, ACL og links) og en checksum, så
 * indholdet kan afstemmes efter levering.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf } from "../../runtime/src/digest.mjs";
import { projectionOf } from "./import.mjs";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const FACET_INCLUDES = {
  ownership: true,
  timestamps: true,
  comments: true,
  attachments: true,
  acl: true,
  links: true,
};

export function buildExport({ store, tenantId, appId, coverage = null, at = "2026-03-01T00:00:00Z" } = {}) {
  const records = store
    .listRecords({ tenantId, appId })
    .map((record) => ({ ...projectionOf(record), version: record.version, dedupKey: record.dedupKey }))
    .sort((a, b) => a.reference.localeCompare(b.reference));
  const manifest = {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "MigrationExport",
    tenantId,
    appId,
    format: "migration-export-bundle",
    version: "1",
    generatedAt: at,
    recordCount: records.length,
    checksum: digestOf(records.map(projectionOf)),
    readableWithoutPlatform: true,
    includes: { ...FACET_INCLUDES },
    files: [],
    coverage: coverage
      ? {
          matrix: coverage.matrix.filter((row) => row.appId === appId),
          lostFunctionality: coverage.lostFunctionality.filter((entry) => entry.appId === appId),
        }
      : null,
    schema: {
      records: "Én JSON-post pr. linje med reference, ejerskab, klassifikation, ACL, kommentarer, bilag, links og timestamps.",
      csv: "Flad CSV med de samme felter; lister er JSON-kodede strenge.",
    },
  };
  return { manifest, records };
}

function csvEscape(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function renderCsv(records) {
  const columns = ["reference", "appId", "tenantId", "entityType", "sourceObjectId", "owner", "name", "classification", "createdAt", "updatedAt", "acl", "comments", "attachments", "links"];
  const lines = [columns.join(",")];
  for (const record of records) {
    lines.push(columns.map((column) => csvEscape(record[column])).join(","));
  }
  return lines.join("\n") + "\n";
}

const README = `# Exit-eksport fra DkCompany

Denne eksport er selvbeskrivende og kan læses **uden** en aktiv
DkCompany-installation.

- \`manifest.json\` — antal, checksum, hvilke facetter der er inkluderet og hver fils SHA-256.
- \`records.jsonl\` — én post pr. linje.
- \`records.csv\` — samme poster som CSV.
- \`read-export.mjs\` — et standalone Node-script der verificerer checksum og antal.

Læs eksporten:

\`\`\`sh
node read-export.mjs .
\`\`\`

Hver post bærer ejerskab, timestamps, kommentarer, bilag, ACL og links.
`;

const READER = `#!/usr/bin/env node
// Standalone læser for en DkCompany-exit-eksport. Bruger kun Nodes indbyggede
// moduler — ingen DkCompany-installation er nødvendig.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}
function digestOf(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
function projectionOf(record) {
  const { reference, appId, tenantId, entityType, sourceObjectId, owner, name, classification, acl, comments, attachments, links, createdAt, updatedAt } = record;
  return { reference, appId, tenantId, entityType, sourceObjectId, owner, name, classification, acl, comments, attachments, links, createdAt, updatedAt };
}

const dir = process.argv[2] ?? ".";
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const records = readFileSync(join(dir, "records.jsonl"), "utf8")
  .split("\\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line));
const problems = [];
if (records.length !== manifest.recordCount) problems.push("antal stemmer ikke (" + records.length + " != " + manifest.recordCount + ")");
if (digestOf(records.map(projectionOf)) !== manifest.checksum) problems.push("checksum stemmer ikke");
for (const facet of ["ownership", "timestamps", "comments", "attachments", "acl", "links"]) {
  if (manifest.includes?.[facet] !== true) problems.push("faceten '" + facet + "' mangler");
}
if (problems.length) {
  console.error("✘ Eksporten er ikke konsistent:\\n  - " + problems.join("\\n  - "));
  process.exit(1);
}
console.log("✔ Eksporten kan læses uden DkCompany: " + records.length + " poster, checksum " + manifest.checksum.slice(0, 12) + "…");
`;

export function writeExport({ dir, exported } = {}) {
  mkdirSync(dir, { recursive: true });
  const recordsJsonl = exported.records.map((record) => JSON.stringify(record)).join("\n") + (exported.records.length ? "\n" : "");
  const recordsCsv = renderCsv(exported.records);
  const reader = READER;
  const readme = README;
  writeFileSync(join(dir, "records.jsonl"), recordsJsonl);
  writeFileSync(join(dir, "records.csv"), recordsCsv);
  writeFileSync(join(dir, "read-export.mjs"), reader);
  writeFileSync(join(dir, "README.md"), readme);
  const files = [
    { path: "records.jsonl", mediaType: "application/x-ndjson", records: exported.records.length, sha256: sha256(recordsJsonl) },
    { path: "records.csv", mediaType: "text/csv", records: exported.records.length, sha256: sha256(recordsCsv) },
    { path: "read-export.mjs", mediaType: "text/javascript", records: 0, sha256: sha256(reader) },
    { path: "README.md", mediaType: "text/markdown", records: 0, sha256: sha256(readme) },
  ];
  const manifest = { ...exported.manifest, files };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, dir };
}
