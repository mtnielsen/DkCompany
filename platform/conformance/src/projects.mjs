/**
 * DKC-027 — semantiske validatorer for projektstyringsmodulet.
 *
 * De er rene og uafhængige af modulkildekoden, så de kan fange et
 * projektbundt der krydser tenantgrænsen eller har en cyklus, en
 * tilgangsbeslutning der giver adgang uden et dækkende medlemskab, og en
 * editionkombination der frigiver en feature uden valideret licens/API.
 */

function problem(path, message) {
  return { path, message };
}

function licenseOk(license) {
  return Boolean(license?.spdx) && Boolean(license?.type) && license.type !== "unknown";
}

/** Et projektbundt må ikke krydse tenantgrænsen eller indeholde en cyklus. */
export function projectBundleProblems(bundle) {
  const problems = [];
  if (!bundle || typeof bundle !== "object") return [problem("/", "bundtet mangler")];
  if (bundle.kind !== "ProjectBundle") problems.push(problem("/kind", "kind skal være 'ProjectBundle'"));
  const project = bundle.project ?? {};
  if (!project.externalId) problems.push(problem("/project/externalId", "projektet mangler en stabil externalId"));
  if (!project.tenantId) problems.push(problem("/project/tenantId", "projektet mangler tenantId"));

  const seen = new Set();
  for (const [i, wp] of (bundle.workPackages ?? []).entries()) {
    if (!wp.externalId) problems.push(problem(`/workPackages/${i}/externalId`, "arbejdspakken mangler externalId"));
    else if (seen.has(wp.externalId)) problems.push(problem(`/workPackages/${i}/externalId`, `dubleret externalId '${wp.externalId}'`));
    else seen.add(wp.externalId);
    if (project.tenantId && wp.tenantId && wp.tenantId !== project.tenantId) {
      problems.push(problem(`/workPackages/${i}/tenantId`, "arbejdspakken krydser tenantgrænsen"));
    }
  }
  const ids = new Set((bundle.workPackages ?? []).map((wp) => wp.externalId).filter(Boolean));
  for (const [i, wp] of (bundle.workPackages ?? []).entries()) {
    for (const dep of wp.dependsOn ?? []) {
      if (!ids.has(dep)) problems.push(problem(`/workPackages/${i}/dependsOn`, `afhængigheden '${dep}' findes ikke`));
    }
  }
  // Cyklusdetektion.
  const indegree = new Map([...ids].map((id) => [id, 0]));
  const edges = new Map([...ids].map((id) => [id, []]));
  for (const wp of bundle.workPackages ?? []) {
    for (const dep of wp.dependsOn ?? []) {
      if (!ids.has(dep)) continue;
      indegree.set(wp.externalId, (indegree.get(wp.externalId) ?? 0) + 1);
      edges.get(dep).push(wp.externalId);
    }
  }
  let queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let ordered = 0;
  while (queue.length) {
    const id = queue.shift();
    ordered += 1;
    for (const next of edges.get(id) ?? []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (ids.size > 0 && ordered !== ids.size) problems.push(problem("/workPackages", "afhængighederne indeholder en cyklus"));
  return problems;
}

/** En tilladelse må kræve et dækkende medlemskab i samme tenant. */
export function accessDecisionProblems({ decision, memberships = [], actor = {}, project = {}, requiredPermission = "project.read" } = {}) {
  const problems = [];
  if (!decision || typeof decision.allowed !== "boolean") return [problem("/decision", "beslutningen mangler")];
  if (decision.allowed && actor.id !== "admin") {
    const covering = memberships.some((m) => {
      const sameProject = !m.projectId || m.projectId === project.id;
      const matches = (m.principal && m.principal === actor.id) || (m.group && (actor.groups ?? []).includes(m.group));
      return sameProject && matches;
    });
    if (!covering && decision.via !== "tenant-admin") problems.push(problem("/decision", "adgang givet uden et dækkende medlemskab"));
  }
  if (decision.allowed && !decision.reason) problems.push(problem("/decision/reason", "en tilladelse skal begrundes"));
  if (!decision.allowed && !decision.reason) problems.push(problem("/decision/reason", "en afvisning skal begrundes"));
  return problems;
}

/**
 * En kombination validerer, når licensen er afklaret, driftsprofilen har
 * backup/RPO/RTO, og alle angivne features er kendte. En dokumenteret
 * kombination må gerne mangle en feature (fx central SSO i Community), men
 * manglen skal fremgå af feature-rapporten som en afvigelse.
 */
export function editionCombinationProblems(combination) {
  const problems = [];
  if (!combination || typeof combination !== "object") return [problem("/", "kombinationen mangler")];
  const product = combination.product ?? {};
  const features = combination.requiredFeatures;
  if (!Array.isArray(features) || features.length === 0) return [problem("/requiredFeatures", "kombinationen skal angive sine krævede features")];
  if (!licenseOk(product.license)) problems.push(problem("/product/license", "licensen er ikke afklaret"));
  const known = new Set(["projects", "workPackages", "memberships", "files", "statusEvents", "sso"]);
  for (const feature of features) {
    if (!known.has(feature)) problems.push(problem(`/requiredFeatures/${feature}`, `ukendt feature '${feature}'`));
  }
  if (!product.operations?.backup || !product.operations?.rpoMinutes || !product.operations?.rtoMinutes) {
    problems.push(problem("/product/operations", "driftsprofilen mangler backup eller RPO/RTO"));
  }
  return problems;
}

/** Enhver ikke-understøttet feature skal optræde i både listen og afvigelserne. */
export function featureReportProblems(report) {
  const problems = [];
  if (!report || typeof report !== "object") return [problem("/", "rapporten mangler")];
  const unsupported = new Set(report.unsupported ?? []);
  const deviations = report.deviations ?? [];
  for (const feature of unsupported) {
    if (!deviations.some((d) => d.feature === feature)) problems.push(problem(`/deviations/${feature}`, `afvigelsen for '${feature}' er ikke registreret`));
  }
  for (const deviation of deviations) {
    if (!deviation.note || deviation.note.trim().length < 5) problems.push(problem(`/deviations/${deviation.feature}`, "afvigelsen mangler en forklaring"));
  }
  for (const feature of report.supported ?? []) {
    if (unsupported.has(feature)) problems.push(problem(`/supported/${feature}`, `'${feature}' står både som understøttet og ikke-understøttet`));
  }
  return problems;
}

/** En retrieval må ikke svare ud fra en forældet eller fremmed rettighedsversion. */
export function retrievalProblems({ projection, currentVersion, allowedProjectIds = [], results = [] } = {}) {
  const problems = [];
  if (!projection || typeof projection !== "object") return [problem("/projection", "projektionen mangler")];
  if (projection.version !== currentVersion) problems.push(problem("/projection/version", "projektionen er ikke på den aktuelle rettighedsversion"));
  const allowed = new Set(projection.allowedProjectIds ?? []);
  for (const extra of allowedProjectIds) if (!allowed.has(extra)) problems.push(problem(`/allowedProjectIds/${extra}`, "en projektion må ikke udvide adgangen ud over medlemskaberne"));
  for (const [i, r] of results.entries()) {
    if (!allowed.has(r.projectId)) problems.push(problem(`/results/${i}`, `resultatet '${r.projectId}' er ikke i den tilladte projektmængde`));
  }
  return problems;
}
