/**
 * DKC-025 — semantiske validatorer for servicepakker, kundelivscyklus og
 * kundeordrer.
 *
 * Skemaet håndhæver formen. Denne modul håndhæver de beslutninger, et skema
 * ikke kan udtrykke:
 *
 *   - en servicepakke har en samlet pris der svarer til delpriserne, en
 *     ansvarlig person og mindst én væsentlig konsekvens,
 *   - et modul i en servicepakke findes i komponentkataloget,
 *   - revisionskæden i en kundelivscyklus er intakt, og en lukket kunde har
 *     gennemført både eksport og sletning,
 *   - en ordre har unikke idempotency-keys og -ressourcer, og en aktiv ordre
 *     har ingen åbne trin.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { loadComponents, indexById } from "../../distribution/src/catalog.mjs";
import { servicePackageProblems } from "../../portal/src/packages.mjs";
import { auditEventDigest } from "../../portal/src/lifecycle.mjs";

function err(path, message) {
  return { path, message };
}

function readDir(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

function withSchema(schemaId, data, ajv, semantic) {
  const instance = ajv ?? buildAjv().ajv;
  const { ok, errors } = validate(instance, schemaId, data);
  const problems = ok ? [] : errors.map((e) => err(e.path || "/", e.message));
  if (problems.length === 0) problems.push(...semantic(data));
  return { ok: problems.length === 0, errors: problems };
}

/** Semantik for kundelivscyklussen, inkl. revisionskæden. */
export function tenantLifecycleProblems(record) {
  const problems = [];
  if (!record) return [err("/", "livscyklusposten mangler")];

  const trail = record.auditTrail ?? [];
  if (trail.length === 0) problems.push(err("/auditTrail", "en kunde skal have mindst én revisionshændelse"));
  let prev = null;
  for (const [i, event] of trail.entries()) {
    const path = `/auditTrail/${i}`;
    if (event.seq !== i + 1) problems.push(err(`${path}/seq`, `hændelsen har forkert sekvensnummer (${event.seq})`));
    if ((event.prevHash ?? null) !== prev) problems.push(err(`${path}/prevHash`, "hændelsen peger ikke på den foregående hash"));
    if (event.hash !== auditEventDigest(event)) problems.push(err(`${path}/hash`, "hændelsens hash matcher ikke indholdet"));
    if (event.tenantId !== undefined && event.tenantId !== record.tenantId) problems.push(err(`${path}/tenantId`, "hændelsen tilhører en anden tenant"));
    prev = event.hash;
  }

  if (record.state === "closed") {
    if (record.windingDown?.exportCompleted !== true || record.windingDown?.deletionCompleted !== true) {
      problems.push(err("/windingDown", "en lukket kunde skal have gennemført både eksport og sletning"));
    }
  }
  return problems;
}

/** Semantik for en kundeordre, inkl. idempotency og resource-dedup. */
export function customerOrderProblems(order) {
  const problems = [];
  if (!order) return [err("/", "ordren mangler")];

  const p = order.preview ?? {};
  if (Math.abs((p.firstMonthTotal ?? 0) - ((p.monthly ?? 0) + (p.implementation ?? 0))) > 0.001) {
    problems.push(err("/preview/firstMonthTotal", "første måned skal være lig månedspris plus implementering"));
  }

  const keys = new Set();
  const resources = new Map();
  for (const [i, step] of (order.steps ?? []).entries()) {
    const path = `/steps/${i}`;
    if (keys.has(step.idempotencyKey)) problems.push(err(`${path}/idempotencyKey`, `idempotency-key'en '${step.idempotencyKey.slice(0, 12)}…' bruges mere end én gang`));
    else keys.add(step.idempotencyKey);
    if (step.state === "succeeded" || step.state === "reused") {
      const ref = step.resource?.ref ?? step.resourceRef;
      if (resources.has(ref) && step.state === "succeeded") problems.push(err(`${path}/resourceRef`, `ressourcen '${ref}' er oprettet mere end én gang`));
      resources.set(ref, step.stepId);
    }
  }

  const preview = order.preview?.consequences ?? [];
  const required = preview.filter((c) => c.severity === "material" || c.requiresAcknowledgment === true).map((c) => c.id);
  const acked = new Set(order.acknowledgedConsequences ?? []);
  for (const id of required) {
    if (!acked.has(id)) problems.push(err("/acknowledgedConsequences", `den væsentlige konsekvens '${id}' er ikke kvitteret`));
  }

  if (order.state === "active" && (order.steps ?? []).some((s) => s.state !== "succeeded" && s.state !== "reused" && s.state !== "skipped")) {
    problems.push(err("/state", "en aktiv ordre må ikke have åbne provisioneringstrin"));
  }
  if (order.state === "partial" && !(order.steps ?? []).some((s) => s.state === "failed")) {
    problems.push(err("/state", "en delvist fejlet ordre skal have mindst ét fejlet trin"));
  }
  return problems;
}

/** Kanoniske servicepakker skal også være semantisk gyldige. */
export function canonicalServicePackageProblems(root) {
  const problems = [];
  const dir = join(root, "portal", "service-packages");
  const componentIds = new Set(indexById(loadComponents(join(root, "catalog", "components"))).keys());
  const files = readDir(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) problems.push(err("/portal/service-packages", "der findes ingen servicepakker"));
  for (const file of files) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, file), "utf8"));
      for (const problem of servicePackageProblems(pkg, { componentIds })) {
        problems.push(err(`/portal/service-packages/${file}${problem.path}`, problem.message));
      }
    } catch (e) {
      problems.push(err(`/portal/service-packages/${file}`, `ugyldig JSON: ${e.message}`));
    }
  }
  return problems;
}

export function validateServicePackage(data, ajv) {
  return withSchema(SCHEMA_IDS.servicePackage, data, ajv, (d) => servicePackageProblems(d));
}
export function validateTenantLifecycle(data, ajv) {
  return withSchema(SCHEMA_IDS.tenantLifecycle, data, ajv, tenantLifecycleProblems);
}
export function validateCustomerOrder(data, ajv) {
  return withSchema(SCHEMA_IDS.customerOrder, data, ajv, customerOrderProblems);
}

function validateDir(dir, prefix, validator, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const results = [];
  for (const file of readDir(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".example.json"))) {
    try {
      results.push({ file, ...validator(JSON.parse(readFileSync(join(dir, file), "utf8")), instance) });
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
    }
  }
  return results;
}

export function validateServicePackageDir(dir, ajv) {
  return validateDir(dir, "service-package", validateServicePackage, ajv);
}
export function validateTenantLifecycleDir(dir, ajv) {
  return validateDir(dir, "tenant-lifecycle", validateTenantLifecycle, ajv);
}
export function validateCustomerOrderDir(dir, ajv) {
  return validateDir(dir, "customer-order", validateCustomerOrder, ajv);
}

export { servicePackageProblems };
