/**
 * DKC-025 — semantisk kontrol af portalen og servicepakkerne.
 *
 * Kontrollen er deterministisk og offline. Den fejler lukket: en pakke uden
 * pris, en manglende begrundelse, et modul der ikke findes i kataloget, en
 * handling uden rolle i autorisationspolitikken eller et statusdokument der er
 * ude af trit giver alle en fejl.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadComponents, indexById } from "../../distribution/src/catalog.mjs";
import { loadServicePackages, packagesDir, repoRoot, servicePackageProblems } from "./packages.mjs";
import { renderPortalDoc } from "./docs.mjs";
import { ACTIONS, CUSTOMER_STATES, CUSTOMER_TRANSITIONS } from "./constants.mjs";
import { PORTAL_POLICY } from "./authorization.mjs";

export const outputPath = join(repoRoot, "docs", "status", "portal.md");
export { packagesDir };

function err(path, message) {
  return { path, message };
}

/** Kontrollér at autorisationspolitikken dækker alle handlinger konsistent. */
export function authorizationProblems(policy = PORTAL_POLICY, actions = Object.values(ACTIONS)) {
  const problems = [];
  for (const action of actions) {
    const entry = policy[action];
    if (!entry) {
      problems.push(err(`/authorization/${action}`, `handlingen '${action}' mangler i autorisationspolitikken`));
      continue;
    }
    if (!Array.isArray(entry.roles) || entry.roles.length === 0) problems.push(err(`/authorization/${action}/roles`, "handlingen skal have mindst én rolle"));
    if (!["any", "platform", "own-or-platform"].includes(entry.scope)) problems.push(err(`/authorization/${action}/scope`, "ukendt scope"));
  }
  for (const action of Object.keys(policy)) {
    if (!actions.includes(action)) problems.push(err(`/authorization/${action}`, `politikken indeholder den ukendte handling '${action}'`));
  }
  return problems;
}

/** Kontrollér at livscyklusdiagrammet er konsistent. */
export function lifecycleProblems(states = CUSTOMER_STATES, transitions = CUSTOMER_TRANSITIONS) {
  const problems = [];
  for (const state of states) {
    if (!transitions[state]) problems.push(err(`/lifecycle/${state}`, `tilstanden '${state}' mangler i overgangstabellen`));
  }
  for (const [from, tos] of Object.entries(transitions)) {
    if (!states.includes(from)) problems.push(err(`/lifecycle/${from}`, `ukendt tilstand '${from}'`));
    for (const to of tos) if (!states.includes(to)) problems.push(err(`/lifecycle/${from}`, `ukendt måltilstand '${to}'`));
    if (tos.includes(from)) problems.push(err(`/lifecycle/${from}`, "en tilstand må ikke pege på sig selv"));
  }
  return problems;
}

export function checkPortal(root = repoRoot) {
  const problems = [];
  const packages = loadServicePackages(join(root, "portal", "service-packages")).map((entry) => entry.package);
  const components = loadComponents(join(root, "catalog", "components"));
  const componentIds = new Set(indexById(components).keys());

  if (packages.length === 0) problems.push(err("/packages", "der findes ingen servicepakker"));
  const seen = new Set();
  for (const pkg of packages) {
    const key = `${pkg.metadata?.name}@${pkg.metadata?.version}`;
    if (seen.has(key)) problems.push(err("/packages", `servicepakken '${key}' er angivet mere end én gang`));
    seen.add(key);
    for (const problem of servicePackageProblems(pkg, { componentIds })) {
      problems.push(err(`/packages/${key}${problem.path}`, problem.message));
    }
  }

  for (const problem of authorizationProblems()) problems.push(problem);
  for (const problem of lifecycleProblems()) problems.push(problem);

  const expected = renderPortalDoc(packages);
  const path = join(root, "docs", "status", "portal.md");
  if (!existsSync(path)) problems.push(err("/docs/status/portal.md", "statusdokumentet mangler. Kør 'make portal-write'."));
  else if (readFileSync(path, "utf8") !== expected) problems.push(err("/docs/status/portal.md", "statusdokumentet er ude af trit. Kør 'make portal-write'."));

  return { problems, packages, componentIds: [...componentIds] };
}

export function writePortalDoc(root = repoRoot) {
  const { packages } = checkPortal(root);
  const path = join(root, "docs", "status", "portal.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderPortalDoc(packages));
  return path;
}

export function formatProblems(problems) {
  return problems.map((p) => `${p.path}: ${p.message}`).join("\n");
}

export { relative };
