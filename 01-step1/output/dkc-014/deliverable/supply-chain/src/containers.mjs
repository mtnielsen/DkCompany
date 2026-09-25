/**
 * DKC-014 — containerbuilds: statisk kontrol, byggeplan og ærlig build-status.
 *
 * Modulet bygger ikke containere i dette miljø (Docker er ikke tilgængeligt i
 * WSL-distroen). Det gør tre ting rigtigt:
 *
 *   1. kontrollerer hvert Dockerfile mod `containers/base-images.lock.json`:
 *      pinnet digest, non-root, ingen hemmeligheder i build-args,
 *   2. udleder den præcise `docker buildx`-kommando pr. tjeneste,
 *   3. rapporterer buildet som NOT RUN med en begrundelse, når Docker mangler,
 *      i stedet for at påstå et byggeri der ikke skete.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isPlaceholderSha256, parseImageRef } from "./digest.mjs";

export const BASE_LOCK_PATH = "containers/base-images.lock.json";
export const CATALOG_PATH = "containers/containers.json";

const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|APIKEY|API_KEY|CREDENTIAL)/i;
const ROOT_USERS = new Set(["root", "0", ""]);

export function loadBaseImageLock(root) {
  const path = join(root, BASE_LOCK_PATH);
  if (!existsSync(path)) return { images: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadContainerCatalog(root) {
  const path = join(root, CATALOG_PATH);
  if (!existsSync(path)) return { images: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

function logicalLines(text) {
  const lines = [];
  let buffer = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (buffer === "" && (trimmed === "" || trimmed.startsWith("#"))) continue;
    if (line.endsWith("\\")) {
      buffer += line.slice(0, -1) + " ";
      continue;
    }
    lines.push((buffer + line).trim());
    buffer = "";
  }
  if (buffer.trim()) lines.push(buffer.trim());
  return lines;
}

export function parseDockerfile(text) {
  const stages = [];
  const args = [];
  const envs = [];
  let user = null;
  const aliases = new Set();
  for (const line of logicalLines(text)) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(line);
    if (from) {
      const image = from[1];
      const alias = from[2] ?? null;
      const isStageRef = aliases.has(image.toLowerCase());
      stages.push({ image, alias, isStageRef });
      if (alias) aliases.add(alias.toLowerCase());
      user = null; // hver stage har sin egen bruger
      continue;
    }
    const userMatch = /^USER\s+(.+)$/i.exec(line);
    if (userMatch) {
      user = userMatch[1].trim();
      continue;
    }
    const argMatch = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
    if (argMatch) args.push(argMatch[1]);
    const envMatch = /^ENV\s+([A-Za-z_][A-Za-z0-9_]*)[=\s]/i.exec(line);
    if (envMatch) envs.push(envMatch[1]);
  }
  return { stages, args, envs, user };
}

export function checkDockerfile(name, text, baseLock) {
  const problems = [];
  const parsed = parseDockerfile(text);
  const lockByRepo = new Map((baseLock.images ?? []).map((i) => [i.repository, i]));
  if (parsed.stages.length === 0) problems.push(`${name}: Dockerfile har ingen FROM-linje`);

  for (const [i, stage] of parsed.stages.entries()) {
    if (stage.isStageRef || stage.image === "scratch") continue;
    const parsedRef = parseImageRef(stage.image);
    if (!parsedRef.pinned) {
      problems.push(`${name}: FROM[${i}] '${stage.image}' er ikke pinnet på @sha256:<64 hex>`);
      continue;
    }
    if (isPlaceholderSha256(parsedRef.digest)) {
      problems.push(`${name}: FROM[${i}] '${stage.image}' bærer en pladsholder-digest`);
      continue;
    }
    const locked = lockByRepo.get(parsedRef.repository);
    if (!locked) problems.push(`${name}: FROM[${i}] '${parsedRef.repository}' findes ikke i ${BASE_LOCK_PATH}`);
    else if (locked.digest !== parsedRef.digest) problems.push(`${name}: FROM[${i}] '${parsedRef.repository}' digest matcher ikke ${BASE_LOCK_PATH}`);
  }

  const final = parsed.stages.at(-1);
  if (final && !final.isStageRef && final.image !== "scratch" && ROOT_USERS.has((parsed.user ?? "").toLowerCase())) {
    problems.push(`${name}: den sidste stage kører som root; sæt en non-root USER`);
  }

  for (const arg of parsed.args) if (SECRET_NAME.test(arg)) problems.push(`${name}: ARG '${arg}' må ikke bære en hemmelighed`);
  for (const env of parsed.envs) if (SECRET_NAME.test(env)) problems.push(`${name}: ENV '${env}' må ikke bære en hemmelighed`);
  return problems;
}

export function checkContainers(root) {
  const baseLock = loadBaseImageLock(root);
  const catalog = loadContainerCatalog(root);
  const problems = [];
  const repositories = new Set();
  if ((catalog.images ?? []).length === 0) problems.push(`${CATALOG_PATH}: ingen containere i kataloget`);
  for (const [i, entry] of (catalog.images ?? []).entries()) {
    const at = `${CATALOG_PATH}[${i}]`;
    if (repositories.has(entry.repository)) problems.push(`${at}: dubleret repository '${entry.repository}'`);
    repositories.add(entry.repository);
    const dockerfile = join(root, entry.dockerfile);
    if (!existsSync(dockerfile)) {
      problems.push(`${at}: Dockerfile '${entry.dockerfile}' findes ikke`);
      continue;
    }
    if (!existsSync(join(root, entry.context))) problems.push(`${at}: build-kontekst '${entry.context}' findes ikke`);
    problems.push(...checkDockerfile(entry.dockerfile, readFileSync(dockerfile, "utf8"), baseLock));
  }
  return { ok: problems.length === 0, problems, baseLock, catalog };
}

export function buildPlan(root) {
  const catalog = loadContainerCatalog(root);
  return (catalog.images ?? []).map((entry) => ({
    component: entry.component,
    repository: entry.repository,
    dockerfile: entry.dockerfile,
    command: [
      "docker",
      "buildx",
      "build",
      "--file",
      entry.dockerfile,
      "--tag",
      `${entry.repository}:candidate`,
      "--provenance=true",
      "--sbom=true",
      "--push",
      ".",
    ],
  }));
}

export function dockerAvailable() {
  try {
    const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 15_000 });
    return { available: result.status === 0, detail: (result.stderr || result.stdout || "").trim().slice(0, 200) };
  } catch (err) {
    return { available: false, detail: err.message };
  }
}

/**
 * Forsøg at bygge alle containere. Uden Docker returneres NOT RUN med en
 * begrundelse — aldrig et falsk «bygget».
 */
export function runContainerBuilds(root) {
  const plan = buildPlan(root);
  const docker = dockerAvailable();
  if (!docker.available) {
    return {
      status: "not-run",
      reason: `Docker er ikke tilgængeligt (${docker.detail || "docker version fejlede"}); containerne kan ikke bygges her.`,
      results: plan.map((p) => ({ ...p, status: "not-run" })),
    };
  }
  const results = plan.map((p) => {
    const result = spawnSync(p.command[0], p.command.slice(1), { cwd: root, encoding: "utf8", timeout: 30 * 60_000 });
    return { ...p, status: result.status === 0 ? "pass" : "fail", exitCode: result.status, stderr: (result.stderr ?? "").slice(-2000) };
  });
  return { status: results.every((r) => r.status === "pass") ? "pass" : "fail", results };
}
