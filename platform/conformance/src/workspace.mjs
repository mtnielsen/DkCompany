/**
 * DKC-026 — semantiske validatorer for arbejdspladsmodulet.
 *
 * De er rene og uafhængige af modulkildekoden, så de kan fange en
 * editionkombination der frigiver et delmodul uden valideret licens, API eller
 * driftsprofil, og en formatrapport der skjuler en afvigelse.
 */

function problem(path, message) {
  return { path, message };
}

function licenseOk(license) {
  return Boolean(license?.spdx) && Boolean(license?.type) && license.type !== "unknown";
}

/**
 * Et delmodul frigives kun, hvis licens, API og driftsprofil er valideret.
 * Returnerer en liste af `{ path, message }` — tom betyder godkendt.
 */
export function editionCombinationProblems(combination) {
  const problems = [];
  if (!combination || typeof combination !== "object") return [problem("/", "kombinationen mangler")];
  const nextcloud = combination.nextcloud ?? {};
  const office = combination.office ?? {};
  const released = combination.releasedSubmodules;

  if (!Array.isArray(released) || released.length === 0) {
    return [problem("/releasedSubmodules", "kombinationen skal angive hvilke delmoduler den frigiver")];
  }
  const known = new Set(["files", "sharing", "calendar", "editor"]);
  for (const submodule of released) if (!known.has(submodule)) problems.push(problem(`/releasedSubmodules/${submodule}`, `ukendt delmodul '${submodule}'`));

  // Et delmodul frigives kun, hvis licens, API og driftsprofil er valideret.
  if (released.includes("files") && (!licenseOk(nextcloud.license) || !nextcloud.api?.files)) {
    problems.push(problem("/nextcloud/files", "filmodulet frigives uden valideret licens/API"));
  }
  if (released.includes("sharing") && (!licenseOk(nextcloud.license) || !nextcloud.api?.sharing)) {
    problems.push(problem("/nextcloud/sharing", "delingsmodulet frigives uden valideret licens/API"));
  }
  if (released.includes("calendar") && (!licenseOk(nextcloud.license) || !nextcloud.api?.calendar)) {
    problems.push(problem("/nextcloud/calendar", "kalendermodulet frigives uden valideret licens/API"));
  }
  if (released.length > 0 && (!nextcloud.operations?.backup || !nextcloud.operations?.rpoMinutes || !nextcloud.operations?.rtoMinutes)) {
    problems.push(problem("/nextcloud/operations", "kerne-driftsprofilen mangler backup eller RPO/RTO"));
  }
  if (released.includes("editor")) {
    if (!licenseOk(office.license)) problems.push(problem("/office/license", "editoren frigives uden afklaret licens"));
    if (office.api?.protocol !== "wopi" || office.api?.documented !== true) {
      problems.push(problem("/office/api", "editoren frigives uden et dokumenteret WOPI-API"));
    }
    if (!office.operations?.backup || office.operations.backup === "none") {
      problems.push(problem("/office/operations/backup", "editoren frigives uden en backupstrategi"));
    }
  }

  if (!Array.isArray(combination.formats) || combination.formats.length === 0) {
    problems.push(problem("/formats", "kombinationen skal angive hvilke kontorformater den understøtter"));
  }
  return problems;
}

/** Enhver afvigelse skal optræde i både `unsupported` og `deviations`. */
export function officeFormatProblems(report) {
  const problems = [];
  if (!report || typeof report !== "object") return [problem("/", "rapporten mangler")];
  const unsupported = new Set(report.unsupported ?? []);
  const deviations = report.deviations ?? [];
  for (const format of unsupported) {
    if (!deviations.some((d) => d.format === format)) problems.push(problem(`/deviations/${format}`, `afvigelsen for '${format}' er ikke registreret`));
  }
  for (const deviation of deviations) {
    if (!deviation.note || deviation.note.trim().length < 5) problems.push(problem(`/deviations/${deviation.format}`, "afvigelsen mangler en forklaring"));
  }
  for (const format of report.supported ?? []) {
    if (unsupported.has(format)) problems.push(problem(`/supported/${format}`, `'${format}' står både som understøttet og ikke-understøttet`));
  }
  return problems;
}

/** Den rene delingsbeslutning må ikke give adgang uden en dækkende deling. */
export function accessDecisionProblems({ decision, shares = [], actor = {}, requiredPermission = 1 } = {}) {
  const problems = [];
  if (!decision || typeof decision.allowed !== "boolean") return [problem("/decision", "beslutningen mangler")];
  if (decision.allowed && actor.id !== decision.owner) {
    const covering = shares.some((s) => {
      const matches = s.share_with === actor.id || (actor.groups ?? []).includes(s.share_with);
      return matches && (Number(s.permissions) & Number(requiredPermission)) === Number(requiredPermission);
    });
    if (!covering) problems.push(problem("/decision", "adgang givet uden en dækkende deling"));
  }
  if (decision.allowed && !decision.reason) problems.push(problem("/decision/reason", "en tilladelse skal begrundes"));
  if (!decision.allowed && !decision.reason) problems.push(problem("/decision/reason", "en afvisning skal begrundes"));
  return problems;
}
