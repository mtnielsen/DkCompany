#!/usr/bin/env node
/**
 * Reproducerbar baselinekontrol.
 *
 *   node tools/baseline/baseline.mjs run     # kør alle checks, skriv evidens + matrix
 *   node tools/baseline/baseline.mjs render  # genskab matrix fra seneste evidens
 *   node tools/baseline/baseline.mjs list    # vis checks uden at køre dem
 *
 * Formålet er at gøre forskellen mellem dokumentation, mock-tests, fixtures og
 * dokumenteret drift eksplicit. Hver check får en struktureret resultatlinje med
 * exitstatus, commit, miljø og evidensplacering. Eksterne integrationer forsøges
 * ikke kørt; de registreres som NOT RUN med en begrundelse.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKS } from "./registry.mjs";
import { captureEnvironment } from "./environment.mjs";
import { renderMatrix } from "./matrix.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepo = resolve(here, "..", "..");

const HELP = `Brug: node tools/baseline/baseline.mjs <kommando> [flag]

Kommandøer:
  run        Kør alle checks og skriv evidens + docs/status/implementation-matrix.md
  render     Genskab matrix fra seneste evidens (kører ingen checks)
  list       Vis registrerede checks og niveauer

Flag:
  --repo <sti>          Repo-rod (default: ${defaultRepo})
  --matrix <sti>        Matrix-fil (default: <repo>/docs/status/implementation-matrix.md)
  --evidence-dir <sti>  Evidensmappe (default: <repo>/.conformance-out/baseline)
  --only <id,id>        Kør kun disse check-id'er
  --skip <id,id>        Spring disse check-id'er over
  --timeout <sek>       Timeout pr. check (default: 300)
  --no-fail             Returnér 0 selv hvis en check fejler
  --json                Udskriv den strukturerede kørsel til stdout
  -h, --help            Vis denne hjælp
`;

export function parseArgs(argv) {
  const args = {
    command: argv[0] && !argv[0].startsWith("-") ? argv[0] : "run",
    repo: defaultRepo,
    matrix: null,
    evidenceDir: null,
    only: null,
    skip: [],
    timeout: 300_000,
    noFail: false,
    json: false,
  };
  const start = args.command === argv[0] && !argv[0].startsWith("-") ? 1 : 0;
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === "run" || a === "render" || a === "list") args.command = a;
    else if (a === "--repo") args.repo = argv[++i];
    else if (a === "--matrix") args.matrix = argv[++i];
    else if (a === "--evidence-dir") args.evidenceDir = argv[++i];
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--skip") args.skip.push(...argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--timeout") args.timeout = Number(argv[++i]) * 1000;
    else if (a === "--no-fail") args.noFail = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Ukendt argument: ${a}`);
  }
  return args;
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function resolvePath(p) {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export function selectChecks({ only, skip }) {
  return CHECKS.filter((c) => !skip.includes(c.id) && (!only || only.includes(c.id)));
}

export function runCheck(check, { repo, timeout, commit }) {
  const startedAt = new Date();
  if (check.external || check.server) {
    return {
      ...shape(check),
      status: "not-run",
      reason: check.reason,
      exitCode: null,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      durationMs: 0,
      stdout: "",
      stderr: "",
    };
  }

  const started = Date.now();
  const proc = spawnSync(check.command[0], check.command.slice(1), {
    cwd: repo,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BASELINE_COMMIT: commit ?? "" },
  });
  const durationMs = Date.now() - started;
  const finishedAt = new Date().toISOString();
  const timedOut = proc.error?.code === "ETIMEDOUT" || proc.signal === "SIGTERM";
  const spawnFailed = Boolean(proc.error) && !timedOut;

  let status = "pass";
  if (spawnFailed || timedOut) status = "error";
  else if (proc.status !== 0) status = "fail";

  return {
    ...shape(check),
    status,
    exitCode: proc.status ?? null,
    signal: proc.signal ?? null,
    error: proc.error ? String(proc.error.message ?? proc.error) : null,
    timedOut,
    startedAt: startedAt.toISOString(),
    finishedAt,
    durationMs,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

function shape(check) {
  return {
    id: check.id,
    title: check.title,
    component: check.component,
    level: check.level,
    external: Boolean(check.external),
    server: Boolean(check.server),
    critical: check.critical !== false,
    command: check.command,
    evidence: check.evidence ?? [],
    gap: check.gap ?? null,
  };
}

function writeLogs(results, logDir) {
  mkdirSync(logDir, { recursive: true });
  for (const r of results) {
    const parts = [];
    parts.push(`# check: ${r.id}`);
    parts.push(`# title: ${r.title}`);
    parts.push(`# command: ${r.command.join(" ")}`);
    parts.push(`# status: ${r.status}`);
    parts.push(`# exitCode: ${r.exitCode ?? "—"}`);
    parts.push(`# startedAt: ${r.startedAt}`);
    parts.push(`# finishedAt: ${r.finishedAt}`);
    parts.push("");
    if (r.reason) parts.push(`# reason: ${r.reason}`);
    if (r.stdout) {
      parts.push("## stdout");
      parts.push(r.stdout.replace(/\s+$/, ""));
    }
    if (r.stderr) {
      parts.push("## stderr");
      parts.push(r.stderr.replace(/\s+$/, ""));
    }
    writeFileSync(join(logDir, `${r.id}.log`), parts.join("\n") + "\n");
  }
}

/** Sporede ændringer i det undersøgte repo, begrænset til repo-mappen. */
function worktreeStatus(repo) {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", "."], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function summarize(results) {
  const s = { total: results.length, pass: 0, fail: 0, error: 0, notRun: 0 };
  for (const r of results) {
    if (r.status === "pass") s.pass += 1;
    else if (r.status === "fail") s.fail += 1;
    else if (r.status === "error") s.error += 1;
    else if (r.status === "not-run") s.notRun += 1;
  }
  return s;
}

function publicResult(result) {
  return {
    ...result,
    stdoutTail: result.stdout ? result.stdout.split("\n").slice(-8).join("\n") : "",
    stderrTail: result.stderr ? result.stderr.split("\n").slice(-8).join("\n") : "",
    stdout: undefined,
    stderr: undefined,
  };
}

function buildResult({ results, environment, evidencePath, repo, matrixPath, worktree }) {
  const summary = summarize(results);
  return {
    schemaVersion: 1,
    kind: "BaselineResult",
    generatedAt: new Date().toISOString(),
    status: summary.fail > 0 || summary.error > 0 ? "fail" : "pass",
    summary,
    environment,
    repo,
    evidencePath,
    matrix: matrixPath,
    prerequisites: ["make install (npm ci i conformance/)"],
    worktree: worktree ?? { before: [], after: [], mutatedFiles: [], reproducible: true },
    checks: results.map(publicResult),
  };
}

function evidencePaths(result, evidenceDir) {
  const short = result.environment.git.shortCommit ?? "unknown";
  const name = `${timestampSlug(new Date(result.generatedAt))}-${short}.json`;
  return {
    runPath: join(evidenceDir, "runs", name),
    latestPath: join(evidenceDir, "latest.json"),
  };
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/** Bevar de artefakter, som checkene har genereret, sammen med evidensen. */
function copyArtifacts(repo, evidenceDir) {
  const source = join(repo, ".conformance-out");
  if (!existsSync(source)) return [];
  const dest = join(evidenceDir, "artifacts");
  mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const file of readdirSync(source)) {
    if (!/\.(json|jsonl)$/.test(file)) continue;
    copyFileSync(join(source, file), join(dest, file));
    copied.push(join(dest, file));
  }
  return copied;
}

function printSummary(result) {
  const { summary } = result;
  console.log(`Baseline — commit ${result.environment.git.shortCommit ?? "?"} (${result.environment.git.branch ?? "?"})`);
  console.log(`  ${summary.pass} pass, ${summary.fail} fail, ${summary.error} error, ${summary.notRun} not run af ${summary.total}`);
  for (const c of result.checks) {
    if (c.status === "pass") continue;
    const icon = c.status === "fail" || c.status === "error" ? "✘" : "•";
    console.log(`  ${icon} ${c.id} (${c.level}) — ${c.reason ?? `exit ${c.exitCode ?? "?"}`}`);
  }
  console.log(result.status === "pass" ? "RESULTAT: PASS" : "RESULTAT: FAIL");
}

function loadLatest(evidenceDir) {
  const p = join(evidenceDir, "latest.json");
  if (!existsSync(p)) throw new Error(`Ingen evidens fundet i ${p}. Kør 'run' først.`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }

  const repo = resolvePath(args.repo);
  if (!existsSync(repo)) {
    console.error(`Repo-rod findes ikke: ${repo}`);
    return 2;
  }
  const matrixPath = args.matrix ? resolvePath(args.matrix) : join(repo, "docs", "status", "implementation-matrix.md");
  const evidenceDir = args.evidenceDir ? resolvePath(args.evidenceDir) : join(repo, ".conformance-out", "baseline");

  if (args.command === "list") {
    for (const c of CHECKS) {
      console.log(`${c.id.padEnd(24)} ${c.level.padEnd(12)} ${c.external ? "EXTERNAL" : "run"}  ${c.command.join(" ")}`);
    }
    return 0;
  }

  if (args.command === "render") {
    const result = loadLatest(evidenceDir);
    mkdirSync(dirname(matrixPath), { recursive: true });
    writeFileSync(matrixPath, renderMatrix(result));
    console.log(`✔ Matrix skrevet: ${matrixPath}`);
    return 0;
  }

  const checks = selectChecks(args);
  if (checks.length === 0) {
    console.error("Ingen checks valgt.");
    return 2;
  }

  const environment = captureEnvironment({ repo });
  const beforeStatus = worktreeStatus(repo);
  const results = [];
  for (const check of checks) {
    process.stdout.write(`→ ${check.id} … `);
    const r = runCheck(check, { repo, timeout: args.timeout, commit: environment.git.commit });
    results.push(r);
    console.log(r.status.toUpperCase());
  }

  const logDir = join(evidenceDir, "logs");
  writeLogs(results, logDir);
  for (const r of results) r.log = join(logDir, `${r.id}.log`);

  const afterStatus = worktreeStatus(repo);
  const mutationSet = new Set(afterStatus.filter((l) => !beforeStatus.includes(l)));
  const worktree = {
    before: beforeStatus,
    after: afterStatus,
    mutatedFiles: [...mutationSet],
    reproducible: mutationSet.size === 0,
  };

  const result = buildResult({ results, environment, evidencePath: null, repo, matrixPath, worktree });
  const { runPath, latestPath } = evidencePaths(result, evidenceDir);
  result.evidencePath = runPath;
  result.evidenceLatest = latestPath;

  const artifacts = copyArtifacts(repo, evidenceDir);
  result.artifacts = artifacts;

  mkdirSync(dirname(matrixPath), { recursive: true });
  writeFileSync(matrixPath, renderMatrix(result));
  writeJson(runPath, result);
  writeJson(latestPath, result);

  if (args.json) console.log(JSON.stringify(result, null, 2));
  else {
    printSummary(result);
    if (!worktree.reproducible) {
      console.log(
        `  ⚠ Kørslen ændrede ${worktree.mutatedFiles.length} sporede fil(er): en ren checkout forbliver ikke ren. Se matrixafsnittet om reproducerbarhed.`
      );
    }
    console.log(`  Evidens: ${runPath}`);
    console.log(`  Matrix:  ${matrixPath}`);
  }

  if (result.status === "fail" && !args.noFail) return 1;
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  const code = main(process.argv.slice(2));
  if (typeof code === "number") process.exit(code);
}
