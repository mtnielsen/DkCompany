/**
 * DKC-023 — harness for adaptergodkendelse.
 *
 * Et adapterbevis mod en mock er ikke nok. Nye adaptere skal kunne gennemgå de
 * samme seks prøver, før de godkendes:
 *
 *   1. API-fejl        — upstream 5xx må ikke blive et falsk 200
 *   2. Rate limits     — upstream 429 skal give 429 + Retry-After, ikke 502
 *   3. Versionsskift   — en ikke-understøttet version/edition skal afvises
 *   4. Backup          — backup/restore skal erklæres ærligt, aldrig fingeres
 *   5. Negativ adgang  — manglende identitet/tenant/fremmed kunde/PDP-nedbrud
 *   6. Idempotens      — samme nøgle udfører handlingen højst én gang
 *
 * `createFaultPlan` injicerer fejl i en upstream-klient uden at ændre adapteren.
 * `runAdapterHarness` kalder adapterens HTTP-flade og rapporterer hver prøve
 * som `pass`, `fail` eller `not-run` med en begrundelse.
 */

export const HARNESS_CATEGORIES = ["api-error", "rate-limit", "version-change", "backup", "negative-access", "idempotency"];

/**
 * @param {object} config
 * @param {Array<{operation: string, fault: object, times?: number}>} [config.rules]
 */
export function createFaultPlan({ rules = [] } = {}) {
  const pending = rules.map((r) => ({ ...r, times: r.times ?? 1 }));
  const calls = [];
  /** Find og forbrug den næste regel for operationen. */
  const consume = (operation) => {
    const index = pending.findIndex((r) => r.operation === operation && r.times > 0);
    if (index === -1) return null;
    const rule = pending[index];
    rule.times -= 1;
    if (rule.times <= 0) pending.splice(index, 1);
    return rule.fault;
  };
  return {
    calls,
    /** Antal kald pr. upstream-operation. */
    countFor(operation) {
      return calls.filter((c) => c.operation === operation).length;
    },
    /** Tilføj en fejlregel, evt. midlertidigt for én kørsel. */
    arm(rule) {
      pending.push({ times: 1, ...rule });
    },
    reset() {
      pending.length = 0;
      calls.length = 0;
    },
    /** Find og forbrug den næste regel for operationen. */
    consume(operation) {
      return consume(operation);
    },
    /** Wrap en upstream-klient, så fejl injiceres før det rigtige kald. */
    wrap(client) {
      const proxy = {};
      for (const [name, fn] of Object.entries(client)) {
        if (typeof fn !== "function") {
          proxy[name] = fn;
          continue;
        }
        proxy[name] = async (...args) => {
          calls.push({ operation: name, args });
          const fault = consume(name);
          if (fault) {
            if (fault instanceof Error) throw fault;
            if (fault.error) throw fault.error;
            if (typeof fault.throw === "string") throw new Error(fault.throw);
            const error = new Error(fault.message ?? `injiceret fejl i ${name}`);
            error.status = fault.status ?? 500;
            if (fault.retryAfterSeconds !== undefined) error.retryAfterSeconds = fault.retryAfterSeconds;
            throw error;
          }
          return fn.apply(client, args);
        };
      }
      return proxy;
    },
  };
}

function check(id, category, status, detail, extra = {}) {
  return { id, category, status, detail, ...extra };
}

/**
 * Kør godkendelsesprøverne mod en adapter.
 *
 * @param {object} config
 * @param {string} config.name
 * @param {Function} config.call           `({path,method,headers,body}) -> {status,headers,body}`
 * @param {object} config.plan             Fra `createFaultPlan`.
 * @param {object} config.profile          `{ healthPath, locatePath, erasePath, backupPath, versionProbe, adminBypassPaths }`
 * @param {object} config.sample           `{ tenant, foreignTenant, identifier, identities }`
 * @param {Function} [config.expectBaseline] Kaldes for at bekræfte at et verbum virker uden injiceret fejl.
 */
export async function runAdapterHarness({ name, call, plan, profile = {}, sample = {}, expectBaseline = null, log = () => {} } = {}) {
  if (!call) throw new Error("runAdapterHarness kræver en call-funktion");
  const results = [];
  const { tenant = "acme", foreignTenant = "globex", identifier = { type: "email", value: "kunde@example.org" }, identities = {} } = sample;

  const erase = profile.erasePath ?? "/v1/privacy/erase";
  const locate = profile.locatePath ?? "/v1/privacy/locate";
  const health = profile.healthPath ?? "/healthz";

  const withIdentity = (kind = "agent", extra = {}) => ({ ...(identities[kind] ?? {}), ...extra });
  const verbBody = (extra = {}) => ({ identifiers: [identifier], evidence: ["policy-allow"], ...extra });

  // Baseline: adapteren virker uden injiceret fejl.
  if (expectBaseline) {
    try {
      const ok = await expectBaseline();
      results.push(check("baseline", "baseline", ok ? "pass" : "fail", ok ? "adapteren svarer på sit sunde verbum" : "baseline-verbum fejlede"));
    } catch (err) {
      results.push(check("baseline", "baseline", "fail", `baseline fejlede: ${err.message}`));
    }
  }

  // 1) API-fejl: upstream 5xx må ikke blive 200.
  if (profile.mutatingOperation) {
    try {
      plan.arm({ operation: profile.mutatingOperation, fault: { status: 500, message: "upstream eksploderede" } });
      const res = await call({ path: erase, method: "POST", headers: withIdentity("agent"), body: verbBody() });
      const ok = res.status === 502 && res.body?.result === undefined;
      results.push(check("api-error", "api-error", ok ? "pass" : "fail", `upstream 500 gav adapter HTTP ${res.status}`, { observed: res.status }));
    } catch (err) {
      results.push(check("api-error", "api-error", "fail", `kastede: ${err.message}`));
    }
  } else {
    results.push(check("api-error", "api-error", "not-run", "profile.mutatingOperation mangler — kan ikke injicere API-fejl"));
  }

  // 2) Rate limit: 429 + Retry-After bevares.
  if (profile.mutatingOperation) {
    try {
      plan.arm({ operation: profile.mutatingOperation, fault: { status: 429, retryAfterSeconds: 37, message: "for mange kald" } });
      const res = await call({ path: erase, method: "POST", headers: withIdentity("agent"), body: verbBody({ idempotencyKey: `rate-${Math.random().toString(36).slice(2)}` }) });
      const retry = res.headers?.["retry-after"] ?? res.headers?.["Retry-After"];
      const ok = res.status === 429 && String(retry) === "37";
      results.push(check("rate-limit", "rate-limit", ok ? "pass" : "fail", `upstream 429 gav adapter HTTP ${res.status}, Retry-After=${retry ?? "mangler"}`, { observed: res.status, retryAfter: retry ?? null }));
    } catch (err) {
      results.push(check("rate-limit", "rate-limit", "fail", `kastede: ${err.message}`));
    }
  } else {
    results.push(check("rate-limit", "rate-limit", "not-run", "profile.mutatingOperation mangler — kan ikke injicere rate limit"));
  }

  // 3) Versionsskift.
  if (typeof profile.versionProbe === "function") {
    try {
      const supported = await profile.versionProbe(profile.supportedVersion);
      const unsupported = await profile.versionProbe(profile.unsupportedVersion);
      const ok = supported?.status === "supported" && unsupported?.status !== "supported";
      results.push(check("version-change", "version-change", ok ? "pass" : "fail", `supported=${supported?.status}, unsupported=${unsupported?.status}`, { supported, unsupported }));
    } catch (err) {
      results.push(check("version-change", "version-change", "fail", `kastede: ${err.message}`));
    }
  } else {
    results.push(check("version-change", "version-change", "not-run", "profile.versionProbe mangler — kan ikke efterprøve versionsforhandling"));
  }

  // 4) Backup/restore: ærlig erklæring.
  if (profile.backupPath) {
    try {
      const res = await call({ path: profile.backupPath, method: "POST", headers: withIdentity("agent"), body: verbBody({ verb: "backup" }) });
      const declared = profile.backupConformance ?? "unsupported";
      const ok = declared === "full" ? res.status === 200 : res.status >= 200 && res.status < 500 && typeof res.body?.result?.partial === "boolean";
      results.push(check("backup", "backup", ok ? "pass" : "fail", `erklæret '${declared}', adapter HTTP ${res.status}`, { observed: res.status, declared }));
    } catch (err) {
      results.push(check("backup", "backup", "fail", `kastede: ${err.message}`));
    }
  } else {
    results.push(check("backup", "backup", "not-run", "adapteren erklærer backup unsupported/ikke-eksponeret — ingen API-flade at prøve"));
  }

  // 5) Negativ adgang.
  try {
    const noIdentity = await call({ path: locate, method: "POST", headers: {}, body: verbBody() });
    const foreign = await call({ path: locate, method: "POST", headers: withIdentity("agent", { "x-tenant-id": foreignTenant }), body: verbBody({ tenantId: foreignTenant }) });
    const unauthorized = noIdentity.status === 401;
    const tenantMismatch = foreign.status === 403;
    results.push(check("negative-identity", "negative-access", unauthorized ? "pass" : "fail", `uden identitet gav HTTP ${noIdentity.status}`, { observed: noIdentity.status }));
    results.push(check("negative-tenant", "negative-access", tenantMismatch ? "pass" : "fail", `fremmed tenant gav HTTP ${foreign.status}`, { observed: foreign.status }));
  } catch (err) {
    results.push(check("negative-access", "negative-access", "fail", `kastede: ${err.message}`));
  }

  // 6) Idempotens: samme nøgle udfører handlingen højst én gang.
  if (profile.mutatingOperation) {
    try {
      const key = `idem-${name}-${Date.now()}`;
      const before = plan.countFor(profile.mutatingOperation);
      const first = await call({ path: erase, method: "POST", headers: withIdentity("agent"), body: verbBody({ idempotencyKey: key }) });
      const afterFirst = plan.countFor(profile.mutatingOperation);
      const second = await call({ path: erase, method: "POST", headers: withIdentity("agent"), body: verbBody({ idempotencyKey: key }) });
      const afterSecond = plan.countFor(profile.mutatingOperation);
      const conflict = await call({ path: erase, method: "POST", headers: withIdentity("agent"), body: verbBody({ idempotencyKey: key, target: "et-andet-target" }) });
      const ranOnce = afterFirst - before === 1 && afterSecond - before === 1;
      const replayed = second.status === 200 && second.body?.replayed === true;
      const conflicted = conflict.status === 409;
      const ok = first.status === 200 && ranOnce && replayed && conflicted;
      results.push(check("idempotency", "idempotency", ok ? "pass" : "fail", `første=${first.status}, replay=${second.status}, konflikt=${conflict.status}, upstream-kald=${afterSecond - before}`, { observed: { first: first.status, second: second.status, conflict: conflict.status, upstreamCalls: afterSecond - before } }));
    } catch (err) {
      results.push(check("idempotency", "idempotency", "fail", `kastede: ${err.message}`));
    }
  } else {
    results.push(check("idempotency", "idempotency", "not-run", "profile.mutatingOperation mangler — kan ikke efterprøve idempotens"));
  }

  // 7) Native admin-bypass: direkte upstream-adminveje må ikke eksponeres.
  if (Array.isArray(profile.adminBypassPaths) && profile.adminBypassPaths.length) {
    try {
      const probes = [];
      for (const path of profile.adminBypassPaths) {
        const res = await call({ path, method: "GET", headers: withIdentity("agent") });
        probes.push({ path, status: res.status });
      }
      const ok = probes.every((p) => p.status === 404 || p.status === 403 || p.status === 401);
      results.push(check("admin-bypass", "admin-bypass", ok ? "pass" : "fail", `direkte adminveje: ${probes.map((p) => `${p.path}=${p.status}`).join(", ")}`, { probes }));
    } catch (err) {
      results.push(check("admin-bypass", "admin-bypass", "fail", `kastede: ${err.message}`));
    }
  } else {
    results.push(check("admin-bypass", "admin-bypass", "not-run", "profile.adminBypassPaths mangler — ingen kendte native adminveje at efterprøve"));
  }

  const failures = results.filter((r) => r.status === "fail");
  const report = {
    harness: name,
    generatedAt: new Date().toISOString(),
    categories: HARNESS_CATEGORIES,
    checks: results,
    passed: results.filter((r) => r.status === "pass").length,
    failed: failures.length,
    notRun: results.filter((r) => r.status === "not-run").length,
    ok: failures.length === 0,
  };
  log(report);
  return report;
}
