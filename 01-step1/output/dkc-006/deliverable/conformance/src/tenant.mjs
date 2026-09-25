/**
 * DKC-006 — semantiske validatorer for tenant-konteksten.
 *
 * JSON Schema håndhæver formen. Denne modul håndhæver de beslutninger, skemaet
 * ikke kan udtrykke:
 *
 *   - tenant-id skal være kanonisk
 *   - hver ressource-ID skal bære samme tenant som konteksten
 *   - alle tenant-påstande (claims) skal stemme med den udledte tenant
 *   - krydskunde-adgang kræver en særskilt rolle og en eksplicit scope der
 *     dækker kunden; egen kunde må ikke have en fremmed scope
 *
 * Validatorerne er rene funktioner og kaldes fra CI, tests og installeren.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildAjv, validate, SCHEMA_IDS } from "./schemas.mjs";
import { normalizeTenantId, parseResourceId } from "../../identity/src/tenant.mjs";

function err(path, message) {
  return { path, message };
}

function schemaErrors(ajv, schemaId, data) {
  const { ok, errors } = validate(ajv, schemaId, data);
  return ok ? [] : errors.map((e) => err(e.path || "/", e.message));
}

export function tenantContextProblems(data) {
  const problems = [];
  let tenant;
  try {
    tenant = normalizeTenantId(data?.tenantId);
  } catch (e) {
    problems.push(err("/tenantId", e.message));
    return problems;
  }

  for (const [i, id] of (data.resources ?? []).entries()) {
    let parsed;
    try {
      parsed = parseResourceId(id);
    } catch (e) {
      problems.push(err(`/resources/${i}`, e.message));
      continue;
    }
    if (parsed.tenantId !== tenant) {
      problems.push(err(`/resources/${i}`, `ressourcen tilhører '${parsed.tenantId}', ikke '${tenant}'`));
    }
  }

  for (const [i, claim] of (data.claims ?? []).entries()) {
    let claimed;
    try {
      claimed = normalizeTenantId(claim);
    } catch (e) {
      problems.push(err(`/claims/${i}`, e.message));
      continue;
    }
    if (claimed !== tenant) {
      problems.push(err(`/claims/${i}`, `tenant-påstanden '${claimed}' matcher ikke den udledte tenant '${tenant}'`));
    }
  }

  const scope = (data.scope ?? []).map((s) => (s === "*" ? "*" : normalizeTenantId(s)));
  if (data.crossTenant === true) {
    if (!data.platformRole) {
      problems.push(err("/platformRole", "krydskunde-adgang kræver en særskilt platformrolle"));
    }
    if (!scope.includes("*") && !scope.includes(tenant)) {
      problems.push(err("/scope", `den eksplicitte scope dækker ikke kunden '${tenant}'`));
    }
  } else {
    if (!scope.includes(tenant)) {
      problems.push(err("/scope", `scope skal indeholde kontekstens egen tenant '${tenant}'`));
    }
    const foreign = scope.filter((s) => s !== tenant);
    if (foreign.length) {
      problems.push(err("/scope", `uden krydskunde-adgang må scope ikke indeholde fremmede kunder: ${foreign.join(", ")}`));
    }
  }

  if (data.source === "demo-shim") {
    problems.push(err("/source", "demo-shim er kun gyldig i testprofil og må ikke optræde som produktionskontekst"));
  }

  return problems;
}

export function validateTenantContext(data, ajv) {
  const instance = ajv ?? buildAjv().ajv;
  const errors = [...schemaErrors(instance, SCHEMA_IDS.tenantContext, data)];
  if (errors.length === 0) errors.push(...tenantContextProblems(data));
  return { ok: errors.length === 0, errors };
}

export function validateTenantDir(dir) {
  const ajv = buildAjv().ajv;
  const results = [];
  if (!dir) return results;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    if (!file.startsWith("tenant-context")) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      results.push({ file, ok: false, errors: [err("/", `ugyldig JSON: ${e.message}`)] });
      continue;
    }
    const { ok, errors } = validateTenantContext(data, ajv);
    results.push({ file, ok, errors });
  }
  return results;
}
