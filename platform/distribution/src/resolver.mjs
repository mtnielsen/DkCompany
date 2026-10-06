/**
 * DKC-053 — dependency-resolver for installationsprofiler.
 *
 * Resolveren er en ren funktion over kataloget. Den muterer intet og rører ikke
 * filsystemet: den beregner den valgte closure og rapporterer ALLE problemer
 * (cyklus, inkompatibel version, konflikt, fjernet delt afhængighed,
 * utilstrækkelige ressourcer, manglende datatjenesteprovider) FØR nogen
 * installation kan begynde. Fejl lukker lukket.
 *
 * Den samler transitive afhængigheder med en begrundelse pr. kant, så
 * previewet kan vise hvorfor hver komponent er nødvendig, ikke bare at den er
 * valgt.
 */
import { compareVersions, satisfies } from "./semver.mjs";

const PHASE_ORDER = { pre: 0, schema: 1, data: 2, post: 3 };

function asData(entry) {
  return entry?.data ?? entry;
}

function componentId(entry) {
  return asData(entry)?.metadata?.name;
}

function componentVersion(entry) {
  return asData(entry)?.metadata?.version;
}

/** Normalisér til en Map: id → komponentversioner sorteret faldende. */
export function buildIndex(components) {
  const index = new Map();
  for (const entry of components) {
    const data = asData(entry);
    const id = componentId(entry);
    if (!id) continue;
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(data);
  }
  for (const list of index.values()) {
    list.sort((a, b) => compareVersions(b.metadata.version, a.metadata.version));
  }
  return index;
}

function bestVersion(index, id, ranges) {
  const candidates = (index.get(id) ?? []).filter((data) => ranges.every((r) => satisfies(data.metadata.version, r)));
  return candidates[0] ?? null;
}

function normalizeSelection(selection) {
  return selection.map((s) => (typeof s === "string" ? { id: s, range: "*" } : { id: s.id, range: s.range ?? "*" }));
}

/**
 * @returns {{
 *   ok: boolean,
 *   errors: Array<{code: string, message: string, path?: string}>,
 *   warnings: Array<string>,
 *   requested: string[],
 *   entries: Array<object>,
 *   closure: string[],
 *   order: string[],
 *   resources: object,
 *   downloads: Array<object>,
 *   downloadTotalMiB: number,
 *   operations: string[],
 *   dataServices: Array<object>,
 *   migrations: Array<object>,
 *   cycles: string[][],
 *   safety: object
 * }}
 */
export function resolveDependencies(options = {}) {
  const {
    components = [],
    profile = {},
    selection = [],
    deploymentProfile = null,
    serviceClasses = [],
    lock = {},
    removed = [],
    includeDefaults = true,
  } = options;

  const index = buildIndex(components);
  const errors = [];
  const warnings = [];
  const fail = (code, message, path) => errors.push({ code, message, path });

  // --- 0) Profilens sikkerhedskerne skal være et supersæt af katalogets ----
  const mandatoryCore = [...index.entries()]
    .flatMap(([id, versions]) => versions.filter((v) => v.securityCore === true).map(() => id))
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .sort();
  const declaredCore = new Set(profile.securityCore ?? []);
  for (const id of mandatoryCore) {
    if (!declaredCore.has(id)) {
      fail("SECURITY_CORE_MISSING", `profilen '${profile.metadata?.name ?? "?"}' mangler den obligatoriske sikkerhedskerne-komponent '${id}'`, "/securityCore");
    }
  }
  for (const id of declaredCore) {
    if (!index.has(id)) fail("UNKNOWN_COMPONENT", `profilen peger på en ukendt sikkerhedskerne-komponent '${id}'`, "/securityCore");
  }

  // --- 1) Seed og constraint-indsamling med fixpunkt ----------------------
  const requested = new Set();
  /** @type {Map<string, Array<{range:string, by:string, reason:string, origin:string}>>} */
  const constraints = new Map();
  const addConstraint = (id, range, by, reason, origin) => {
    if (!index.has(id)) {
      fail("UNKNOWN_COMPONENT", `afhængigheden '${id}' (krævet af '${by}') findes ikke i kataloget`);
      return false;
    }
    const list = constraints.get(id) ?? [];
    if (list.some((c) => c.range === range && c.by === by)) return false;
    list.push({ range: range ?? "*", by, reason: reason ?? "", origin });
    constraints.set(id, list);
    return true;
  };

  const explicit = new Map();
  for (const sel of normalizeSelection(selection)) {
    requested.add(sel.id);
    explicit.set(sel.id, sel.range);
    addConstraint(sel.id, sel.range, "operator", "Valgt direkte af operatøren.", "selected");
  }
  for (const id of declaredCore) {
    addConstraint(id, "*", "profil", `Obligatorisk sikkerhedskerne i profilen '${profile.metadata?.name ?? "?"}'.`, "security-core");
  }
  for (const id of Object.keys(lock)) {
    addConstraint(id, `=${lock[id]}`, "lock", "Låst version for reproducerbar installation.", "lock");
  }
  if (includeDefaults) {
    for (const id of profile.defaultApplications ?? []) {
      addConstraint(id, "*", "profil", "Standardapplikation i profilen.", "default");
    }
  }

  const chosen = new Map();
  const includedOptional = new Set();
  const optionalInclude = (id, dep) => {
    if (dep.default === true) return true;
    if (requested.has(id)) return true;
    if (constraints.has(id)) return true;
    return false;
  };

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    iterations += 1;
    changed = false;

    for (const [id, list] of constraints) {
      if (chosen.has(id)) {
        const current = chosen.get(id);
        if (list.every((c) => satisfies(current.metadata.version, c.range))) continue;
      }
      const next = bestVersion(index, id, list.map((c) => c.range));
      if (!next) {
        const ranges = list.map((c) => `'${c.range}' (fra ${c.by})`).join(", ");
        fail("INCOMPATIBLE_VERSION", `ingen version af '${id}' opfylder alle krav: ${ranges}`, `/components/${id}`);
        chosen.delete(id);
        continue;
      }
      if (chosen.get(id)?.metadata.version !== next.metadata.version) {
        chosen.set(id, next);
        changed = true;
      }
    }

    for (const data of [...chosen.values()]) {
      const id = data.metadata.name;
      for (const dep of data.requires ?? []) {
        if (addConstraint(dep.ref, dep.range, id, dep.reason, "required")) changed = true;
      }
      for (const dep of data.optionalRequires ?? []) {
        if (!optionalInclude(dep.ref, dep)) continue;
        includedOptional.add(`${id}->${dep.ref}`);
        if (addConstraint(dep.ref, dep.range, id, dep.reason, "optional")) changed = true;
      }
    }
  }

  // --- 2) Fjernede delte afhængigheder ------------------------------------
  for (const gone of removed) {
    const dependents = [...chosen.values()]
      .filter((c) => (c.requires ?? []).some((d) => d.ref === gone) || (c.optionalRequires ?? []).some((d) => d.ref === gone && includedOptional.has(`${c.metadata.name}->${gone}`)))
      .map((c) => c.metadata.name)
      .sort();
    if (dependents.length) {
      fail("REMOVED_SHARED_DEPENDENCY", `'${gone}' kan ikke fjernes: den er stadig en delt afhængighed for ${dependents.join(", ")}`, `/components/${gone}`);
    }
  }

  // --- 3) Konflikter ------------------------------------------------------
  for (const data of chosen.values()) {
    for (const conflict of data.conflicts ?? []) {
      const other = chosen.get(conflict.ref);
      if (!other) continue;
      if (conflict.range && !satisfies(other.metadata.version, conflict.range)) continue;
      fail("CONFLICT", `'${data.metadata.name}' er i konflikt med '${conflict.ref}': ${conflict.reason}`, `/components/${data.metadata.name}`);
    }
  }

  // --- 4) Cyklusdetektion (før mutation) ----------------------------------
  const cycles = detectCycles(chosen, index);
  for (const cycle of cycles) {
    fail("CYCLE", `cyklisk afhængighed opdaget: ${cycle.join(" → ")} → ${cycle[0]}`, "/components");
  }

  // --- 5) Datatjenester ---------------------------------------------------
  const dataServices = collectDataServices(chosen);
  for (const ds of dataServices) {
    if (ds.required && !ds.providedBy.length) {
      fail("MISSING_DATA_SERVICE_PROVIDER", `den påkrævede datatjeneste '${ds.id}' (${ds.kind}) har ingen provider i den valgte closure`, `/dataServices/${ds.id}`);
    }
  }

  // --- 6) Ressourcer (før mutation) ---------------------------------------
  const resources = { cpuMillicores: 0, memoryMiB: 0, storageGiB: 0, nodes: 0 };
  for (const data of chosen.values()) {
    resources.cpuMillicores += data.resources?.cpuMillicores ?? 0;
    resources.memoryMiB += data.resources?.memoryMiB ?? 0;
    resources.storageGiB += data.resources?.storageGiB ?? 0;
    resources.nodes += data.resources?.nodes ?? 0;
  }
  if (profile.capacity) {
    for (const key of ["cpuMillicores", "memoryMiB", "storageGiB", "nodes"]) {
      if (resources[key] > (profile.capacity[key] ?? 0)) {
        fail("INSUFFICIENT_RESOURCES", `den valgte closure kræver ${resources[key]} ${key}, men profilen '${profile.metadata?.name ?? "?"}' har kun ${profile.capacity[key]}`, `/capacity/${key}`);
      }
    }
  }

  // --- 7) Ordenssætning ---------------------------------------------------
  const order = topologicalOrder(chosen);
  if (order.length !== chosen.size && cycles.length === 0) {
    warnings.push("installationsrækkefølgen kunne ikke fastlægges fuldt ud; resterende komponenter er sorteret alfabetisk");
  }

  // --- 8) Rækkefølge, downloads, drift og migrationer ---------------------
  const entries = [...chosen.values()]
    .map((data) => entryFor(data, constraints, order, chosen, includedOptional))
    .sort((a, b) => a.id.localeCompare(b.id));
  const downloads = [...chosen.values()].flatMap((data) => (data.download ?? []).map((dl) => ({ component: data.metadata.name, ...dl }))).sort((a, b) => a.component.localeCompare(b.component) || a.artifact.localeCompare(b.artifact));
  const downloadTotalMiB = downloads.reduce((sum, dl) => sum + (dl.sizeMiB ?? 0), 0);
  const operations = [...new Set([...chosen.values()].flatMap((data) => data.operations ?? []))].sort();
  const migrations = [...chosen.values()]
    .flatMap((data) => (data.migrations ?? []).map((m) => ({ component: data.metadata.name, ...m })))
    .sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9) || order.indexOf(a.component) - order.indexOf(b.component) || a.id.localeCompare(b.id));

  const safety = profileSafety({ profile, deploymentProfile, serviceClasses, chosen });

  return {
    ok: errors.length === 0 && safety.ok,
    errors,
    warnings,
    requested: [...requested].sort(),
    entries,
    closure: [...chosen.keys()].sort(),
    order,
    resources,
    downloads,
    downloadTotalMiB,
    operations,
    dataServices,
    migrations,
    cycles,
    safety,
  };
}

function entryFor(data, constraints, order, chosen, includedOptional) {
  const id = data.metadata.name;
  const reasons = (constraints.get(id) ?? []).map((c) => ({ by: c.by, reason: c.reason, origin: c.origin }));
  const dependsOn = [
    ...(data.requires ?? []).filter((d) => chosen.has(d.ref)).map((d) => ({ ref: d.ref, range: d.range, reason: d.reason, optional: false })),
    ...(data.optionalRequires ?? []).filter((d) => chosen.has(d.ref) && includedOptional.has(`${id}->${d.ref}`)).map((d) => ({ ref: d.ref, range: d.range, reason: d.reason, optional: true })),
  ].sort((a, b) => a.ref.localeCompare(b.ref));
  return {
    id,
    version: data.metadata.version,
    componentType: data.componentType,
    category: data.category,
    securityCore: data.securityCore === true,
    origin: reasons.some((r) => r.origin === "security-core") ? "security-core" : reasons.some((r) => r.origin === "selected") ? "selected" : reasons.some((r) => r.origin === "default") ? "default" : "dependency",
    reasons: reasons.sort((a, b) => a.by.localeCompare(b.by) || a.reason.localeCompare(b.reason)),
    dependsOn,
    resources: data.resources,
    order: order.indexOf(id),
  };
}

function collectDataServices(chosen) {
  const needed = new Map();
  for (const data of chosen.values()) {
    for (const ds of data.dataServices ?? []) {
      const key = `${ds.id}|${ds.kind}`;
      const current = needed.get(key) ?? { id: ds.id, kind: ds.kind, required: false, requiredBy: [], providedBy: [] };
      current.required = current.required || ds.required === true;
      current.requiredBy.push({ component: data.metadata.name, required: ds.required === true, reason: ds.reason });
      needed.set(key, current);
    }
  }
  for (const data of chosen.values()) {
    for (const p of data.provides?.dataServices ?? []) {
      const key = `${p.id}|${p.kind}`;
      const current = needed.get(key) ?? { id: p.id, kind: p.kind, required: false, requiredBy: [], providedBy: [] };
      current.providedBy.push(data.metadata.name);
      needed.set(key, current);
    }
  }
  return [...needed.values()]
    .map((ds) => ({ ...ds, requiredBy: ds.requiredBy.sort((a, b) => a.component.localeCompare(b.component)), providedBy: ds.providedBy.sort() }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
}

/** Retur: liste af cyklusser, hver en liste af komponent-id'er. */
export function detectCycles(chosen, index) {
  const edges = new Map();
  for (const data of chosen.values()) {
    const deps = [...(data.requires ?? []).map((d) => d.ref), ...(data.optionalRequires ?? []).map((d) => d.ref)].filter((ref) => chosen.has(ref));
    edges.set(data.metadata.name, deps);
  }
  const colors = new Map();
  const stack = [];
  const cycles = [];
  const seen = new Set();
  const visit = (id) => {
    colors.set(id, "gray");
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      const color = colors.get(next);
      if (color === "gray") {
        const cycle = stack.slice(stack.indexOf(next));
        const key = [...cycle].sort().join(",");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!color) {
        visit(next);
      }
    }
    stack.pop();
    colors.set(id, "black");
  };
  for (const id of [...edges.keys()].sort()) if (!colors.get(id)) visit(id);
  return cycles;
}

/** Kahn-topologisk rækkefølge over krævede kanter. */
export function topologicalOrder(chosen) {
  const indegree = new Map();
  const adj = new Map();
  for (const id of chosen.keys()) {
    indegree.set(id, 0);
    adj.set(id, []);
  }
  for (const data of chosen.values()) {
    const id = data.metadata.name;
    for (const dep of data.requires ?? []) {
      if (!chosen.has(dep.ref)) continue;
      adj.get(dep.ref).push(id);
      indegree.set(id, indegree.get(id) + 1);
    }
  }
  const ready = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id).sort();
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const next of adj.get(id).sort()) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }
  for (const id of [...chosen.keys()].sort()) if (!order.includes(id)) order.push(id);
  return order;
}

/**
 * Sikkerheds-/profilkontrol. Binder installationsprofilen til den DKC-002
 * deployment-profil og til de DKC-037 serviceklasser der hører til de valgte
 * applikationer. Sikkerhedskernen holdes uden for serviceklassekoblingen, da
 * den er obligatorisk på tværs af profiler.
 */
export function profileSafety({ profile, deploymentProfile, serviceClasses = [], chosen = new Map() }) {
  const errors = [];
  const notes = [];
  if (deploymentProfile) {
    if (deploymentProfile.profileType !== profile.profileType) {
      errors.push({ code: "PROFILE_TYPE_MISMATCH", message: `profilen '${profile.metadata?.name}' er '${profile.profileType}', men deployment-profilen er '${deploymentProfile.profileType}'` });
    }
    if (profile.profileType === "single-server") {
      if (deploymentProfile.highAvailability?.enabled === true) {
        errors.push({ code: "SINGLE_SERVER_HA", message: "single-server-profilen må ikke bruge en HA-deployment-profil" });
      }
      const backup = (deploymentProfile.dataServices ?? []).find((d) => d.kind === "backup-destination");
      if (!backup) {
        errors.push({ code: "EXTERNAL_BACKUP_MISSING", message: "single-server kræver en ekstern backupdestination i deployment-profilen" });
      } else {
        if (!(backup.responsibilityAgreement ?? "").trim()) errors.push({ code: "EXTERNAL_BACKUP_AGREEMENT", message: "den eksterne backupdestination kræver en ansvarsaftale" });
        if (backup.tenantBound !== true) errors.push({ code: "EXTERNAL_BACKUP_TENANT", message: "backupdestinationen skal være tenantbundet" });
      }
      if (profile.highAvailability?.acceptedNonHaServiceClass !== true) {
        errors.push({ code: "NON_HA_NOT_ACCEPTED", message: "single-server kræver eksplicit accepteret non-HA-serviceklasse" });
      }
    }
  } else {
    notes.push("ingen deployment-profil blev givet; den dybe profil-/serviceklassekontrol er sprunget over");
  }

  const byModule = new Map();
  for (const sc of serviceClasses) {
    const data = sc.data ?? sc;
    if (data.moduleRef) byModule.set(data.moduleRef, data);
  }
  const moduleName = (data) => {
    const ref = data.implementation?.moduleRef ?? "";
    return ref.replace(/^modules\//, "").replace(/\/.*$/, "").replace(/\/$/, "");
  };
  for (const data of chosen.values()) {
    if (data.securityCore === true) continue;
    const sc = byModule.get(moduleName(data)) ?? byModule.get(data.metadata.name);
    if (!sc) continue;
    const profiles = sc.deploymentProfileCompatibility?.profiles ?? [];
    if (deploymentProfile && profiles.length && !profiles.includes(profile.profileType)) {
      errors.push({ code: "SERVICE_CLASS_PROFILE_MISMATCH", message: `serviceklassen '${sc.metadata?.name}' understøtter ikke profiletypen '${profile.profileType}'` });
    }
    if (profile.profileType === "single-server") {
      if (sc.deploymentProfileCompatibility?.haEligible === true) {
        errors.push({ code: "SINGLE_SERVER_HA_CLASS", message: `'${data.metadata.name}' peger på en HA-egnet serviceklasse og kan ikke køre på single-server` });
      }
      if (sc.availability?.acceptedDowntime !== true) {
        errors.push({ code: "SINGLE_SERVER_DOWNTIME_NOT_ACCEPTED", message: `serviceklassen '${sc.metadata?.name}' mangler eksplicit accepteret nedetid` });
      }
      if (!(sc.backup?.required === true && sc.backup?.mode === "external" && sc.backup?.offsite === true)) {
        errors.push({ code: "SINGLE_SERVER_BACKUP", message: `serviceklassen '${sc.metadata?.name}' kræver ekstern, offsite backup` });
      }
    } else if (deploymentProfile?.highAvailability?.enabled === true && sc.deploymentProfileCompatibility?.haEligible !== true) {
      errors.push({ code: "HA_CLASS_NOT_ELIGIBLE", message: `serviceklassen '${sc.metadata?.name}' er ikke HA-egnet og kan ikke køre på HA-profilen` });
    }
  }
  return { ok: errors.length === 0, errors, notes };
}

/**
 * Hvilke komponenter ville bryde hvis `removeId` fjernes fra en valgt closure?
 * Bruges til at forhindre fjernelse af en delt afhængighed.
 */
export function analyzeRemoval(entries, removeId) {
  return entries
    .filter((e) => e.id !== removeId)
    .map((e) => {
      const dep = (e.dependsOn ?? []).find((d) => d.ref === removeId);
      if (!dep) return null;
      return { id: e.id, reason: dep.reason, optional: dep.optional };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Komponenter der ikke optræder i nogen profil (kandidater til udfasning). */
export function unreferencedComponents(components, profiles) {
  const referenced = new Set();
  for (const p of profiles) {
    for (const id of [...(p.data.securityCore ?? []), ...(p.data.defaultApplications ?? []), ...(p.data.optionalApplications ?? [])]) referenced.add(id);
  }
  // Transitivt: medtag også det refererede lukkes afhængigheder.
  const index = buildIndex(components);
  const queue = [...referenced];
  while (queue.length) {
    const id = queue.pop();
    for (const data of index.get(id) ?? []) {
      for (const dep of [...(data.requires ?? []), ...(data.optionalRequires ?? [])]) {
        if (!referenced.has(dep.ref)) {
          referenced.add(dep.ref);
          queue.push(dep.ref);
        }
      }
    }
  }
  return [...index.keys()].filter((id) => !referenced.has(id)).sort();
}
