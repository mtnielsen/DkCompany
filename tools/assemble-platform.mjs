#!/usr/bin/env node
// Deterministic assembler for the canonical `platform/` source tree.
//
// S1-01: the historical cumulative implementation lives in `00-core/` plus 66
// overlay packages under `01-step1/output/`. This tool materializes exactly
// those inputs, in the dependency order recorded by the historical apply.sh
// chain (tip: dkc-036), and writes a provenance manifest. It never modifies
// the inputs and it never follows symlinks.
//
// Usage:
//   node tools/assemble-platform.mjs [--target platform] [--check] [--force]
//                                    [--stack tools/overlay-stack.json]
//                                    [--workspace <dir>] [--json]
//
// Exit codes: 0 success, 1 validation/mismatch, 2 refusal/usage error.

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const TOOL_VERSION = '1.0.0';
export const PROVENANCE_SCHEMA = 'dkc-platform-provenance/v1';
export const PROVENANCE_FILE = 'PROVENANCE.json';
export const STACK_SCHEMA = 'dkc-overlay-stack/v1';

const TOOL_PATH = fileURLToPath(import.meta.url);

class AssemblerError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'AssemblerError';
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new AssemblerError(message, exitCode);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

// Canonical mode: 100755 when any execute bit is set, else 100644. This is
// independent of umask and of file-system peculiarities (e.g. DrvFs).
function fileMode(path) {
  const mode = lstatSync(path).mode & 0o777;
  return mode & 0o111 ? '100755' : '100644';
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// Digest of a file manifest. The manifest is the sorted concatenation of
// "<mode> <sha256> <relative-path>\n" lines, hashed as UTF-8. The caller
// decides which files to include (the platform tree digest excludes
// PROVENANCE.json because that file would otherwise describe itself).
function manifestDigest(files) {
  const lines = [...files.entries()]
    .map(([path, entry]) => `${entry.mode} ${entry.sha256} ${path}\n`)
    .sort();
  return sha256(lines.join(''));
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function assertSafeRelative(relPath, context) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    fail(`${context}: empty or non-string path`);
  }
  if (relPath.includes('\0')) fail(`${context}: NUL byte in path`);
  if (relPath.includes('\\')) fail(`${context}: backslash is not allowed in a portable tree path`);
  if (isAbsolute(relPath)) fail(`${context}: absolute path is not allowed: ${relPath}`);
  for (const segment of relPath.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      fail(`${context}: path traversal or empty segment is not allowed: ${relPath}`);
    }
  }
  return relPath;
}

// Resolve a path beneath `root`, rejecting absolute inputs, `..` segments and
// symlink escapes. Returns the I/O path (not necessarily realpath'd).
function resolveBeneath(root, candidate, context, { allowMissing = true } = {}) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    fail(`${context}: path must be a non-empty string`);
  }
  if (isAbsolute(candidate)) {
    fail(`${context}: absolute path is not allowed: ${candidate}`);
  }
  for (const segment of candidate.split(/[\\/]/)) {
    if (segment === '..') fail(`${context}: '..' segments are not allowed: ${candidate}`);
  }
  const resolved = resolve(root, candidate);
  const rel = relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    fail(`${context}: path escapes the workspace: ${candidate}`);
  }
  // mkdir/reads follow a linked parent even when the final path does not yet
  // exist. Inspect each existing component before returning the lexical path;
  // this also rejects aliases into preserved inputs and linked source roots.
  let current = root;
  for (const segment of candidate.split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') break;
      fail(`${context}: cannot inspect path component ${current}: ${error.message}`);
    }
    if (stat.isSymbolicLink()) {
      fail(`${context}: refusing symlink or junction in path: ${current}`);
    }
    let real;
    try {
      real = realpathSync(current);
    } catch (error) {
      fail(`${context}: cannot resolve path component ${current}: ${error.message}`);
    }
    const realRel = relative(root, real);
    if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
      fail(`${context}: path component resolves outside its root: ${candidate}`);
    }
  }
  if (!allowMissing && !existsSync(resolved)) {
    fail(`${context}: path does not exist: ${candidate}`);
  }
  return resolved;
}

function isExcluded(relPath, exclude) {
  if (!exclude) return false;
  const segments = relPath.split('/');
  if (exclude.names && segments.some((segment) => exclude.names.includes(segment))) return true;
  if (exclude.suffixes && exclude.suffixes.some((suffix) => relPath.endsWith(suffix))) return true;
  if (exclude.paths && exclude.paths.includes(relPath)) return true;
  return false;
}

// Collect every regular file under `root`. Symlinks and special files are
// rejected, never followed. Returns a Map of posix relative path -> absolute path.
function collectFiles(root, exclude, context) {
  const files = new Map();
  const visit = (absoluteDir, relDir) => {
    const entries = readdirSync(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      assertSafeRelative(relPath, context);
      if (isExcluded(relPath, exclude)) continue;
      const absolute = join(absoluteDir, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        fail(`${context}: refusing symlink: ${relPath}`);
      }
      if (stat.isDirectory()) {
        visit(absolute, relPath);
      } else if (stat.isFile()) {
        files.set(relPath, absolute);
      } else {
        fail(`${context}: refusing special file: ${relPath}`);
      }
    }
  };
  visit(root, '');
  return files;
}

function hashTree(root, exclude, context, gitModes = new Map(), prefix = '') {
  const entries = new Map();
  for (const [relPath, absolute] of collectFiles(root, exclude, context)) {
    const gitPath = prefix ? `${prefix}/${relPath}` : relPath;
    const mode = modeFor(absolute, gitPath, gitModes);
    entries.set(relPath, { sha256: sha256File(absolute), mode, absolute });
  }
  return entries;
}

// Canonical mode across file systems. Git tracks 100644/100755; a git checkout
// on Linux uses exactly those modes. Windows/DrvFs checkouts can report every
// file as executable, so the git index wins whenever the path is tracked.
// Untracked files (sandbox tests) fall back to "executable bit set?".
function modeFor(absolute, gitPath, gitModes) {
  const tracked = gitModes.get(gitPath);
  if (tracked === '100755') return '100755';
  if (tracked === '100644') return '100644';
  return fileMode(absolute);
}

// Map of workspace-relative posix path -> git index mode for every tracked
// file. Returns an empty map outside a git work tree (sandbox tests) or when
// the index cannot be read.
function loadGitModes(workspace) {
  try {
    const result = spawnSync('git', ['-C', workspace, 'ls-files', '-s', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0 || !result.stdout) return new Map();
    const modes = new Map();
    for (const record of result.stdout.split('\0')) {
      if (!record) continue;
      const tab = record.indexOf('\t');
      if (tab < 0) continue;
      const mode = record.slice(0, tab).split(' ')[0];
      if (mode !== '100644' && mode !== '100755') continue;
      modes.set(record.slice(tab + 1), mode);
    }
    return modes;
  } catch {
    return new Map();
  }
}

// On file systems without real POSIX mode bits (e.g. DrvFs on /mnt/c),
// `core.filemode=false` makes git record 100644 for every new file. Compare
// target modes the way git would store them, so the check result does not
// depend on the host file system.
function gitFilemodeEnabled(workspace) {
  try {
    const result = spawnSync('git', ['-C', workspace, 'config', '--bool', 'core.filemode'], {
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    const value = result.stdout.trim();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function canonicalTargetMode(workspace, absolute, gitModes, filemodeEnabled) {
  const relPath = toPosix(relative(workspace, absolute));
  const tracked = gitModes.get(relPath);
  if (tracked) return tracked;
  if (filemodeEnabled === false) return '100644';
  return fileMode(absolute);
}

export function loadStack(stackPath) {
  let raw;
  try {
    raw = readFileSync(stackPath, 'utf8');
  } catch (error) {
    fail(`cannot read stack manifest ${stackPath}: ${error.message}`);
  }
  let stack;
  try {
    stack = JSON.parse(raw);
  } catch (error) {
    fail(`stack manifest ${stackPath} is not valid JSON: ${error.message}`);
  }
  if (stack.schema !== STACK_SCHEMA) {
    fail(`stack manifest ${stackPath} has unsupported schema: ${stack.schema}`);
  }
  if (typeof stack.tip !== 'string' || !/^dkc-\d{3}$/.test(stack.tip)) {
    fail(`stack manifest tip must look like dkc-NNN: ${stack.tip}`);
  }
  if (!stack.overlays || typeof stack.overlays !== 'object' || Array.isArray(stack.overlays)) {
    fail('stack manifest must contain an overlays object');
  }
  for (const id of Object.keys(stack.overlays)) {
    if (!/^dkc-\d{3}$/.test(id)) fail(`invalid overlay id in stack: ${id}`);
  }
  if (!Object.prototype.hasOwnProperty.call(stack.overlays, stack.tip)) {
    fail(`tip ${stack.tip} is missing from the overlays map`);
  }
  for (const [id, overlay] of Object.entries(stack.overlays)) {
    if (!overlay || typeof overlay !== 'object') fail(`overlay ${id} must be an object`);
    if (overlay.predecessor !== null && typeof overlay.predecessor !== 'string') {
      fail(`overlay ${id} must declare a predecessor (string) or null`);
    }
  }
  return { raw, stack };
}

// Walk tip -> predecessor. The resulting array is the materialization order:
// predecessors are applied before the overlay that depends on them.
export function resolveOrder(stack) {
  const order = [];
  const seen = new Set();
  let current = stack.tip;
  while (current !== null) {
    if (!Object.prototype.hasOwnProperty.call(stack.overlays, current)) {
      fail(`missing dependency: ${current} is not declared in the overlays map`);
    }
    if (seen.has(current)) {
      const cycle = [...order.slice(order.indexOf(current)), current].join(' -> ');
      fail(`dependency cycle detected: ${cycle}`);
    }
    seen.add(current);
    order.push(current);
    current = stack.overlays[current].predecessor;
  }
  const unreachable = Object.keys(stack.overlays).filter((id) => !seen.has(id));
  if (unreachable.length > 0 && !stack.allowUnreachable) {
    fail(`overlays not reachable from tip ${stack.tip}: ${sortedUnique(unreachable).join(', ')}`);
  }
  return order.reverse();
}

// Derive the predecessor from the historical apply.sh. This keeps the stack
// manifest honest: if a script and the manifest disagree, assembly stops.
export function predecessorFromApplyScript(scriptSource, id) {
  const lines = scriptSource
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => !line.trimStart().startsWith('#'));
  if (id === 'dkc-001') {
    const invokes = lines.filter((line) => /dkc-\d{3}\/apply\.sh/.test(line));
    if (invokes.length > 0) fail(`dkc-001/apply.sh unexpectedly invokes another overlay: ${invokes[0].trim()}`);
    return null;
  }
  // DKC-002 is the historical special case: the script does not invoke a
  // sibling dir directly but tries $ROOT/apply.sh, then $ROOT/dkc-001/apply.sh.
  if (id === 'dkc-002') {
    const fallback = lines.find((line) => /\$ROOT\/dkc-001\/apply\.sh/.test(line));
    const direct = lines.find((line) => /DKC001_APPLY="\$ROOT\/apply\.sh"/.test(line));
    if (!direct || !fallback) fail('dkc-002/apply.sh no longer contains the documented dkc-001 fallback');
    return 'dkc-001';
  }
  const invocations = lines.filter((line) => /^\s*"\$OUTPUT\/dkc-\d{3}\/apply\.sh"/.test(line));
  if (invocations.length !== 1) {
    fail(`${id}/apply.sh must invoke exactly one predecessor script, found ${invocations.length}`);
  }
  const match = invocations[0].match(/dkc-(\d{3})\/apply\.sh/);
  return `dkc-${match[1]}`;
}

export function verifyApplyScripts(stack, workspace) {
  if (!stack.verifyApplyScripts) return { checked: 0, skipped: true };
  const root = stack.overlaysRoot || '01-step1/output';
  const rootPath = resolveBeneath(workspace, root, 'overlaysRoot', { allowMissing: false });
  let checked = 0;
  for (const [id, overlay] of Object.entries(stack.overlays)) {
    const scriptPath = resolveBeneath(rootPath, `${id}/apply.sh`, `${id} apply script`, { allowMissing: false });
    let source;
    try {
      source = readFileSync(scriptPath, 'utf8');
    } catch (error) {
      fail(`cannot read ${id}/apply.sh: ${error.message}`);
    }
    const derived = predecessorFromApplyScript(source, id);
    const declared = overlay.predecessor;
    if (derived !== declared) {
      fail(`stack mismatch for ${id}: apply.sh says ${derived ?? 'none'}, manifest says ${declared ?? 'none'}`);
    }
    checked += 1;
  }
  return { checked, skipped: false };
}

function gitHeadCommit(workspace, paths) {
  try {
    const result = spawnSync('git', ['-C', workspace, 'log', '-1', '--format=%H', '--', ...paths], {
      encoding: 'utf8',
    });
    if (result.status !== 0) return null;
    const sha = result.stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export function verifyGitPins(stack, workspace) {
  if (!stack.git) return { checked: false, reason: 'no git pins in stack manifest' };
  if (!existsSync(join(workspace, '.git'))) {
    return { checked: false, reason: 'workspace is not a git work tree' };
  }
  const shallow = spawnSync('git', ['-C', workspace, 'rev-parse', '--is-shallow-repository'], {
    encoding: 'utf8',
  });
  if (shallow.status === 0 && shallow.stdout.trim() === 'true') {
    return { checked: false, reason: 'shallow clone cannot resolve the pinned input commits' };
  }
  const basePath = stack.base?.path ?? '00-core';
  const overlaysPath = stack.overlaysRoot ?? '01-step1/output';
  const baseHead = gitHeadCommit(workspace, [basePath]);
  const inputsHead = gitHeadCommit(workspace, [basePath, overlaysPath]);
  if (baseHead === null || inputsHead === null) {
    return { checked: false, reason: 'git log produced no commit for the input paths' };
  }
  if (stack.git.baseCommit && baseHead !== stack.git.baseCommit) {
    fail(
      `base commit mismatch: git reports ${baseHead} for ${basePath}, stack manifest pins ${stack.git.baseCommit}`,
    );
  }
  if (stack.git.inputsCommit && inputsHead !== stack.git.inputsCommit) {
    fail(
      `inputs commit mismatch: git reports ${inputsHead} for ${basePath} + ${overlaysPath}, ` +
        `stack manifest pins ${stack.git.inputsCommit}`,
    );
  }
  return { checked: true, baseHead, inputsHead };
}

// Build the expected tree in memory: path -> { sha256, mode, source }. Inputs
// are read-only; nothing is written here.
export function computeExpectedTree(stack, workspace) {
  const exclude = stack.exclude ?? undefined;
  const gitModes = loadGitModes(workspace);
  const files = new Map();
  const basePath = resolveBeneath(workspace, stack.base?.path ?? '00-core', 'base path', {
    allowMissing: false,
  });
  const basePrefix = stack.base?.path ?? '00-core';
  const baseFiles = hashTree(basePath, exclude, 'base tree', gitModes, basePrefix);
  const baseSource = stack.base?.path ?? '00-core';
  for (const [relPath, entry] of baseFiles) {
    files.set(relPath, { sha256: entry.sha256, mode: entry.mode, source: baseSource, absolute: entry.absolute });
  }
  if (files.has(PROVENANCE_FILE)) {
    fail(`base tree contains reserved file ${PROVENANCE_FILE}; provenance cannot be generated safely`);
  }
  const overlaysRoot = resolveBeneath(workspace, stack.overlaysRoot ?? '01-step1/output', 'overlaysRoot', {
    allowMissing: false,
  });
  const deliverableName = stack.deliverableName ?? 'deliverable';
  assertSafeRelative(deliverableName, 'deliverableName');
  const perOverlay = new Map();
  for (const id of resolveOrder(stack)) {
    const deliverable = resolveBeneath(overlaysRoot, `${id}/${deliverableName}`, `${id} deliverable`, {
      allowMissing: false,
    });
    const stat = lstatSync(deliverable);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail(`${id}: deliverable is not a regular directory: ${toPosix(relative(workspace, deliverable))}`);
    }
    const deliverablePrefix = toPosix(relative(workspace, deliverable));
    const entries = hashTree(deliverable, exclude, `${id} deliverable`, gitModes, deliverablePrefix);
    const overlayFiles = new Map();
    for (const [relPath, entry] of entries) {
      if (relPath === PROVENANCE_FILE) fail(`${id}: deliverable contains reserved file ${PROVENANCE_FILE}`);
      files.set(relPath, { sha256: entry.sha256, mode: entry.mode, source: id, absolute: entry.absolute });
      overlayFiles.set(relPath, entry);
    }
    perOverlay.set(id, {
      deliverable: toPosix(relative(workspace, deliverable)),
      fileCount: overlayFiles.size,
      treeDigest: manifestDigest(overlayFiles),
      files: new Set(overlayFiles.keys()),
    });
  }
  return { files, baseFiles, perOverlay };
}

export function computeProvenance(stack, stackRaw, stackPath, workspace, expected, gitVerification) {
  const files = expected.files;
  const treeDigest = manifestDigest(files);
  const baseFileEntries = new Map();
  for (const [relPath, entry] of expected.baseFiles) {
    baseFileEntries.set(relPath, { sha256: entry.sha256, mode: entry.mode });
  }
  const winning = new Map();
  for (const entry of files.values()) {
    winning.set(entry.source, (winning.get(entry.source) ?? 0) + 1);
  }
  const overlays = {};
  for (const id of resolveOrder(stack)) {
    const data = expected.perOverlay.get(id);
    overlays[id] = {
      predecessor: stack.overlays[id].predecessor,
      deliverable: data.deliverable,
      fileCount: data.fileCount,
      treeDigest: data.treeDigest,
      winningFileCount: winning.get(id) ?? 0,
    };
    if (stack.overlays[id].note) overlays[id].note = stack.overlays[id].note;
  }
  return {
    schema: PROVENANCE_SCHEMA,
    tool: {
      path: 'tools/assemble-platform.mjs',
      version: TOOL_VERSION,
      sha256: sha256File(TOOL_PATH),
    },
    stack: {
      path: toPosix(relative(workspace, stackPath)),
      sha256: sha256(stackRaw),
      schema: stack.schema,
    },
    tip: stack.tip,
    decisionRecord: stack.decisionRecord ?? null,
    base: {
      path: stack.base?.path ?? '00-core',
      fileCount: expected.baseFiles.size,
      treeDigest: manifestDigest(baseFileEntries),
      commit: stack.git?.baseCommit ?? null,
    },
    inputs: {
      commit: stack.git?.inputsCommit ?? null,
      reviewedBaseline: stack.git?.reviewedBaseline ?? null,
      gitVerification: gitVerification.checked
        ? `verified (base ${gitVerification.baseHead}, inputs ${gitVerification.inputsHead})`
        : `not verified: ${gitVerification.reason}`,
    },
    overlayOrder: resolveOrder(stack),
    overlays,
    fileCount: files.size,
    files: Object.fromEntries(
      [...files.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([relPath, entry]) => [
          relPath,
          { sha256: entry.sha256, mode: entry.mode, source: entry.source },
        ]),
    ),
    treeDigest,
    treeDigestAlgorithm:
      'sha256(utf8(concat(sorted("<mode> <sha256> <path>\\n")))); excludes PROVENANCE.json itself',
    excluded: stack.exclude ?? {},
  };
}

export function runCli(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (!existsSync(options.workspace)) {
    fail(`workspace does not exist: ${options.workspace}`);
  }
  const workspace = realpathSync(options.workspace);
  const stackPath = resolve(options.stack);
  const { raw, stack } = loadStack(stackPath);
  verifyApplyScripts(stack, workspace);
  const gitVerification = verifyGitPins(stack, workspace);
  const targetArg = options.target;
  if (targetArg.split(/[\\/]/).some((segment) => segment === '..')) {
    fail(`refusing target with '..' segments: ${targetArg}`);
  }
  const target = resolveBeneath(workspace, targetArg, 'target', { allowMissing: true });
  const relTarget = relative(workspace, target);
  const reserved = new Set(['.git', '00-core', '01-step1', '02-stabilization', 'node_modules', 'tools']);
  const firstSegment = relTarget.split(sep)[0];
  if (reserved.has(firstSegment)) {
    fail(`refusing to assemble into reserved input directory: ${toPosix(relTarget)}`);
  }
  if (existsSync(target)) {
    let real;
    try {
      real = realpathSync(target);
    } catch (error) {
      fail(`cannot resolve target ${targetArg}: ${error.message}`);
    }
    const realRel = relative(workspace, real);
    if (realRel === '' || realRel.startsWith('..') || isAbsolute(realRel)) {
      fail(`target resolves outside the workspace: ${targetArg}`);
    }
  }

  const expected = computeExpectedTree(stack, workspace);
  const provenance = computeProvenance(stack, raw, stackPath, workspace, expected, gitVerification);

  if (options.check) {
    const problems = checkTarget(target, expected, provenance, stack, workspace);
    if (problems.length > 0) {
      for (const problem of problems) process.stderr.write(`MISMATCH: ${problem}\n`);
      fail(`platform tree check failed with ${problems.length} mismatch(es)`, 1);
    }
    output(options, {
      mode: 'check',
      target: toPosix(relative(workspace, target)),
      fileCount: expected.files.size,
      treeDigest: provenance.treeDigest,
      overlayCount: provenance.overlayOrder.length,
      result: 'ok',
    });
    return 0;
  }

  // Refuse an existing nonempty target by default. `--force` may only replace
  // a tree that carries our provenance marker produced from this same stack.
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail(`refusing to replace non-directory target: ${targetArg}`);
    }
    const entries = readdirSync(target);
    if (entries.length > 0) {
      if (!options.force) {
        fail(`refusing to assemble into nonempty target ${targetArg}; use --force to replace a platform tree`);
      }
      requirePlatformMarker(target, provenance);
      rmSync(target, { recursive: true, force: true });
    } else {
      rmSync(target, { recursive: true, force: true });
    }
  }

  mkdirSync(target, { recursive: true });
  copyExpectedTree(expected, target);
  writeFileSync(join(target, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  output(options, {
    mode: 'assemble',
    target: toPosix(relative(workspace, target)),
    fileCount: expected.files.size,
    treeDigest: provenance.treeDigest,
    overlayCount: provenance.overlayOrder.length,
    result: 'ok',
  });
  return 0;
}

function requirePlatformMarker(target, provenance) {
  const markerPath = join(target, PROVENANCE_FILE);
  if (!existsSync(markerPath)) {
    fail(`refusing to replace ${target}: no ${PROVENANCE_FILE} marker; use an empty target instead`);
  }
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch (error) {
    fail(`refusing to replace ${target}: ${PROVENANCE_FILE} is not valid JSON (${error.message})`);
  }
  if (marker.schema !== PROVENANCE_SCHEMA) {
    fail(`refusing to replace ${target}: unrecognized provenance schema ${marker.schema}`);
  }
  if (marker.stack?.sha256 !== provenance.stack.sha256) {
    fail(`refusing to replace ${target}: provenance was produced from a different stack manifest`);
  }
}

function copyExpectedTree(expected, target) {
  for (const [relPath, entry] of expected.files) {
    const destination = join(target, ...relPath.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(entry.absolute));
    chmodSync(destination, entry.mode === '100755' ? 0o755 : 0o644);
  }
}

function checkTarget(target, expected, provenance, stack, workspace) {
  const problems = [];
  if (!existsSync(target)) return [`target does not exist: ${target}`];
  const gitModes = loadGitModes(workspace);
  const filemodeEnabled = gitFilemodeEnabled(workspace);
  const actual = new Map();
  const visit = (absoluteDir, relDir) => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (relDir === '' && entry.name === PROVENANCE_FILE) continue;
      if (isExcluded(relPath, stack.exclude)) continue;
      const absolute = join(absoluteDir, entry.name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        problems.push(`unexpected symlink: ${relPath}`);
      } else if (stat.isDirectory()) {
        visit(absolute, relPath);
      } else if (stat.isFile()) {
        actual.set(relPath, {
          sha256: sha256File(absolute),
          mode: canonicalTargetMode(workspace, absolute, gitModes, filemodeEnabled),
        });
      } else {
        problems.push(`unexpected special file: ${relPath}`);
      }
    }
  };
  visit(target, '');
  for (const [relPath, entry] of expected.files) {
    const found = actual.get(relPath);
    if (!found) {
      problems.push(`missing file: ${relPath}`);
    } else if (found.sha256 !== entry.sha256) {
      problems.push(`content mismatch: ${relPath}`);
    } else if (found.mode !== entry.mode) {
      problems.push(`mode mismatch: ${relPath} (expected ${entry.mode}, found ${found.mode})`);
    }
    actual.delete(relPath);
  }
  for (const relPath of actual.keys()) problems.push(`unexpected file: ${relPath}`);

  const markerPath = join(target, PROVENANCE_FILE);
  if (!existsSync(markerPath)) {
    problems.push(`missing ${PROVENANCE_FILE}`);
  } else {
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
      if (stableStringify(marker) !== stableStringify(provenance)) {
        problems.push(`${PROVENANCE_FILE} does not match the deterministic provenance for this stack`);
      }
    } catch (error) {
      problems.push(`${PROVENANCE_FILE} is not valid JSON: ${error.message}`);
    }
  }
  return problems;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function output(options, summary) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const verb = summary.mode === 'check' ? 'verified' : 'assembled';
    process.stdout.write(
      `${verb} ${summary.target}: ${summary.fileCount} files, ${summary.overlayCount} overlays, ` +
        `tree ${summary.treeDigest}\n`,
    );
  }
}

function parseArgs(argv) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaults = {
    workspace: resolve(scriptDir, '..'),
    target: 'platform',
    stack: resolve(scriptDir, 'overlay-stack.json'),
    force: false,
    check: false,
    json: false,
    help: false,
  };
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) fail(`missing value for ${arg}`);
      return argv[index];
    };
    switch (arg) {
      case '--target':
        options.target = next();
        break;
      case '--stack':
        options.stack = resolve(next());
        break;
      case '--workspace':
        options.workspace = resolve(next());
        break;
      case '--force':
        options.force = true;
        break;
      case '--check':
        options.check = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function helpText() {
  return `Deterministic assembler for the canonical platform/ source tree.

Usage:
  node tools/assemble-platform.mjs [options]

Options:
  --target <path>     Target directory inside the workspace (default: platform).
  --stack <path>      Stack manifest (default: tools/overlay-stack.json).
  --workspace <path>  Workspace root (default: repository root).
  --check             Verify an existing target instead of writing.
  --force             Replace an existing platform tree carrying this stack's provenance.
  --json              Print a machine-readable summary.
  -h, --help          Show this help.

The assembler copies 00-core/ and all 66 historical DKC overlays in
dependency order (tip dkc-036), refuses symlinks and path escapes, and writes
platform/${PROVENANCE_FILE}. It never modifies the inputs.
`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(TOOL_PATH);
if (isMain) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    if (error instanceof AssemblerError) {
      process.stderr.write(`assemble-platform: ${error.message}\n`);
      process.exitCode = error.exitCode;
    } else {
      process.stderr.write(`assemble-platform: unexpected error: ${error.stack ?? error.message}\n`);
      process.exitCode = 2;
    }
  }
}
