import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const tool = resolve(process.argv[2]);
const resultPath = resolve(process.argv[3]);
const root = mkdtempSync(join(tmpdir(), 'dkc-s1-01-luna-linux-probes-'));
const records = [];

function fixture(name, { aliasedSource = false, linkedDeliverable = false } = {}) {
  const workspace = join(root, name, 'workspace');
  const outside = join(root, name, 'outside');
  const deliverable = join(workspace, '01-step1/output/dkc-001/deliverable');
  mkdirSync(join(workspace, '00-core'), { recursive: true });
  mkdirSync(join(workspace, '01-step1/output/dkc-001'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(workspace, '00-core/base.txt'), 'BASE\n');
  writeFileSync(join(outside, 'overlay.txt'), 'OVERLAY\n');
  if (linkedDeliverable) symlinkSync(outside, deliverable, 'dir');
  else {
    mkdirSync(deliverable, { recursive: true });
    writeFileSync(join(deliverable, 'overlay.txt'), 'OVERLAY\n');
  }
  if (aliasedSource) symlinkSync(join(workspace, '00-core'), join(workspace, 'alias-input'), 'dir');
  const stack = {
    schema: 'dkc-overlay-stack/v1',
    tip: 'dkc-001',
    base: { path: aliasedSource ? 'alias-input' : '00-core' },
    overlaysRoot: '01-step1/output',
    verifyApplyScripts: false,
    overlays: { 'dkc-001': { predecessor: null } },
  };
  const stackPath = join(workspace, 'stack.json');
  writeFileSync(stackPath, JSON.stringify(stack));
  return { workspace, outside, stackPath };
}

function run(name, fixtureData, target) {
  const child = spawnSync(process.execPath, [
    tool, '--workspace', fixtureData.workspace, '--stack', fixtureData.stackPath,
    '--target', target, '--json',
  ], { encoding: 'utf8', timeout: 60000 });
  const result = {
    name,
    exitCode: child.status,
    stdout: child.stdout,
    stderr: child.stderr,
    error: child.error?.message,
  };
  records.push(result);
  return result;
}

const outsideTarget = fixture('outside-target');
symlinkSync(outsideTarget.outside, join(outsideTarget.workspace, 'alias-outside'), 'dir');
const out = run('missing target below outside-workspace symlink ancestor', outsideTarget, 'alias-outside/new-platform');
out.outsideTargetCreated = existsSync(join(outsideTarget.outside, 'new-platform'));

const sourceAlias = fixture('source-alias', { aliasedSource: true });
const source = run('source root reached through symlink', sourceAlias, 'safe-platform');
source.safeTargetCreated = existsSync(join(sourceAlias.workspace, 'safe-platform'));

const linkedOverlay = fixture('linked-overlay', { linkedDeliverable: true });
const overlay = run('overlay deliverable is a symlink', linkedOverlay, 'safe-platform');
overlay.safeTargetCreated = existsSync(join(linkedOverlay.workspace, 'safe-platform'));

const nonempty = fixture('nonempty-target');
const target = join(nonempty.workspace, 'user-target');
mkdirSync(target);
writeFileSync(join(target, 'keep.txt'), 'USER DATA\n');
const existing = run('nonempty target refuses by default', nonempty, 'user-target');
existing.sentinelUnchanged = readFileSync(join(target, 'keep.txt'), 'utf8') === 'USER DATA\n';
existing.provenanceCreated = existsSync(join(target, 'PROVENANCE.json'));

const nested = fixture('valid-nested-target');
mkdirSync(join(nested.workspace, 'ordinary/parent'), { recursive: true });
const valid = run('valid nested target', nested, 'ordinary/parent/platform');
valid.baseFileCorrect = existsSync(join(nested.workspace, 'ordinary/parent/platform/base.txt'));
valid.overlayFileCorrect = existsSync(join(nested.workspace, 'ordinary/parent/platform/overlay.txt'));

const report = {
  sourceCommit: 'a0bcbf4e44ac3ae03cb1477933f772597020df89',
  platform: process.platform,
  node: process.version,
  scope: 'Disposable verifier-owned fixtures under the system temp directory; no source changes',
  fixtureRoot: root,
  records,
};
writeFileSync(resultPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const failures = records.filter((entry) => {
  if (entry.name === 'valid nested target') {
    return entry.exitCode !== 0 || !entry.baseFileCorrect || !entry.overlayFileCorrect;
  }
  if (entry.name === 'nonempty target refuses by default') {
    return entry.exitCode !== 2 || !entry.sentinelUnchanged || entry.provenanceCreated;
  }
  return entry.exitCode !== 2 || entry.safeTargetCreated || entry.outsideTargetCreated;
});
if (failures.length) process.exitCode = 1;
