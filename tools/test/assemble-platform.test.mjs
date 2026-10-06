// Tests for tools/assemble-platform.mjs (S1-01).
//
// The tests exercise the CLI end to end in disposable sandbox workspaces and,
// when the canonical platform/ tree is present, verify that the committed tree
// is exactly the deterministic assembly of the historical inputs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const tool = join(repoRoot, 'tools', 'assemble-platform.mjs');

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'dkc-assembler-test-'));
  mkdirSync(join(root, '00-core'), { recursive: true });
  mkdirSync(join(root, '01-step1', 'output', 'dkc-001', 'deliverable'), { recursive: true });
  mkdirSync(join(root, '01-step1', 'output', 'dkc-002', 'deliverable'), { recursive: true });
  writeFileSync(join(root, '00-core', 'base.txt'), 'base\n');
  writeFileSync(join(root, '00-core', 'overwritten.txt'), 'base-version\n');
  writeFileSync(join(root, '01-step1', 'output', 'dkc-001', 'deliverable', 'a.txt'), 'one\n');
  writeFileSync(join(root, '01-step1', 'output', 'dkc-001', 'deliverable', 'overwritten.txt'), 'one-version\n');
  writeFileSync(join(root, '01-step1', 'output', 'dkc-002', 'deliverable', 'b.txt'), 'two\n');
  return root;
}

function writeStack(root, overrides = {}) {
  const stack = {
    schema: 'dkc-overlay-stack/v1',
    tip: 'dkc-002',
    base: { path: '00-core' },
    overlaysRoot: '01-step1/output',
    deliverableName: 'deliverable',
    verifyApplyScripts: false,
    overlays: {
      'dkc-001': { predecessor: null },
      'dkc-002': { predecessor: 'dkc-001' },
    },
    ...overrides,
  };
  const path = join(root, 'stack.json');
  writeFileSync(path, `${JSON.stringify(stack, null, 2)}\n`);
  return path;
}

function run(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [tool, ...args], { cwd, encoding: 'utf8' });
}

function tree(root, { skip = new Set() } = {}) {
  const map = {};
  const visit = (dir, relDir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        if (skip.has(relPath)) continue;
        map[relPath] = readFileSync(join(dir, entry.name)).toString('hex');
      }
    }
  };
  visit(root, '');
  return map;
}

test('assembles a sandbox twice with identical bytes and provenance', () => {
  const root = makeSandbox();
  const stack = writeStack(root);
  try {
    const first = run(['--workspace', root, '--stack', stack, '--target', 'platform-a', '--json']);
    assert.equal(first.status, 0, first.stderr);
    const second = run(['--workspace', root, '--stack', stack, '--target', 'platform-b', '--json']);
    assert.equal(second.status, 0, second.stderr);
    const summary = JSON.parse(first.stdout);
    assert.equal(summary.fileCount, 4);
    assert.equal(summary.overlayCount, 2);
    assert.deepEqual(tree(join(root, 'platform-a')), tree(join(root, 'platform-b')));
    assert.equal(
      readFileSync(join(root, 'platform-a', 'PROVENANCE.json'), 'utf8'),
      readFileSync(join(root, 'platform-b', 'PROVENANCE.json'), 'utf8'),
    );
    const provenance = JSON.parse(readFileSync(join(root, 'platform-a', 'PROVENANCE.json'), 'utf8'));
    assert.equal(provenance.overlayOrder.join(','), 'dkc-001,dkc-002');
    assert.equal(provenance.files['overwritten.txt'].source, 'dkc-001');
    assert.equal(provenance.files['b.txt'].source, 'dkc-002');
    assert.equal(provenance.files['base.txt'].source, '00-core');
    assert.equal(provenance.overlays['dkc-001'].fileCount, 2);
    assert.equal(provenance.overlays['dkc-002'].winningFileCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('leaves source inputs untouched', () => {
  const root = makeSandbox();
  const stack = writeStack(root);
  try {
    const before = tree(root, { skip: new Set(['stack.json']) });
    const result = run(['--workspace', root, '--stack', stack, '--target', 'platform']);
    assert.equal(result.status, 0, result.stderr);
    const after = tree(root, { skip: new Set(['stack.json', 'platform/PROVENANCE.json']) });
    for (const [file, data] of Object.entries(before)) {
      if (file.startsWith('platform/')) continue;
      assert.equal(after[file], data, `input mutated: ${file}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses a nonempty target without --force and preserves it', () => {
  const root = makeSandbox();
  const stack = writeStack(root);
  try {
    mkdirSync(join(root, 'platform'));
    writeFileSync(join(root, 'platform', 'user-file.txt'), 'keep me\n');
    const result = run(['--workspace', root, '--stack', stack, '--target', 'platform']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /refusing to assemble into nonempty target/);
    assert.equal(readFileSync(join(root, 'platform', 'user-file.txt'), 'utf8'), 'keep me\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--force replaces only a tree carrying this stack provenance', () => {
  const root = makeSandbox();
  const stack = writeStack(root);
  try {
    mkdirSync(join(root, 'user-dir'));
    writeFileSync(join(root, 'user-dir', 'keep.txt'), 'keep\n');
    const refused = run(['--workspace', root, '--stack', stack, '--target', 'user-dir', '--force']);
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /no PROVENANCE\.json marker/);
    assert.equal(readFileSync(join(root, 'user-dir', 'keep.txt'), 'utf8'), 'keep\n');

    const first = run(['--workspace', root, '--stack', stack, '--target', 'platform']);
    assert.equal(first.status, 0, first.stderr);
    const again = run(['--workspace', root, '--stack', stack, '--target', 'platform', '--force', '--json']);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).result, 'ok');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects out-of-workspace and traversing targets', () => {
  const root = makeSandbox();
  const stack = writeStack(root);
  try {
    const outside = run(['--workspace', root, '--stack', stack, '--target', '/tmp/dkc-outside']);
    assert.equal(outside.status, 2);
    assert.match(outside.stderr, /absolute path is not allowed/);

    const traversal = run(['--workspace', root, '--stack', stack, '--target', 'platform/../../outside']);
    assert.equal(traversal.status, 2);
    assert.match(traversal.stderr, /\.\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects targets inside preserved historical inputs', () => {
  const root = makeSandbox();
  const stack = writeStack(root);
  try {
    for (const target of ['00-core/platform', '01-step1/platform']) {
      const result = run(['--workspace', root, '--stack', stack, '--target', target]);
      assert.equal(result.status, 2, `${target} should be refused`);
      assert.match(result.stderr, /reserved input directory/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects dependency cycles', () => {
  const root = makeSandbox();
  const stack = writeStack(root, {
    tip: 'dkc-001',
    overlays: { 'dkc-001': { predecessor: 'dkc-002' }, 'dkc-002': { predecessor: 'dkc-001' } },
  });
  try {
    const result = run(['--workspace', root, '--stack', stack, '--target', 'platform']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /dependency cycle detected/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing predecessors and unreachable overlays', () => {
  const root = makeSandbox();
  const missing = writeStack(root, {
    tip: 'dkc-001',
    overlays: { 'dkc-001': { predecessor: 'dkc-009' } },
  });
  try {
    const result = run(['--workspace', root, '--stack', missing, '--target', 'platform']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /missing dependency/);

    const unreachable = writeStack(root, {
      overlays: { 'dkc-001': { predecessor: null }, 'dkc-002': { predecessor: 'dkc-001' } },
      allowUnreachable: false,
      tip: 'dkc-001',
    });
    const second = run(['--workspace', root, '--stack', unreachable, '--target', 'platform']);
    assert.equal(second.status, 2);
    assert.match(second.stderr, /not reachable from tip/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects deliverable path escapes and symlinks', () => {
  const root = makeSandbox();
  const escapingDeliverable = writeStack(root, { deliverableName: '../escape' });
  try {
    const result = run(['--workspace', root, '--stack', escapingDeliverable, '--target', 'platform']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /path traversal or empty segment/);

    symlinkSync('/etc/passwd', join(root, '01-step1', 'output', 'dkc-001', 'deliverable', 'link'));
    const symlinkStack = writeStack(root, {
      tip: 'dkc-001',
      overlays: { 'dkc-001': { predecessor: null } },
    });
    const second = run(['--workspace', root, '--stack', symlinkStack, '--target', 'platform']);
    assert.equal(second.status, 2);
    assert.match(second.stderr, /refusing symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--check detects missing, extra, changed and retagged files', () => {
  const root = makeSandbox();
  const stack = writeStack(root);
  try {
    assert.equal(run(['--workspace', root, '--stack', stack, '--target', 'platform']).status, 0);
    const good = run(['--workspace', root, '--stack', stack, '--target', 'platform', '--check', '--json']);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).result, 'ok');

    writeFileSync(join(root, 'platform', 'b.txt'), 'tampered\n');
    const changed = run(['--workspace', root, '--stack', stack, '--target', 'platform', '--check']);
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /content mismatch: b\.txt/);

    writeFileSync(join(root, 'platform', 'extra.txt'), 'extra\n');
    const extra = run(['--workspace', root, '--stack', stack, '--target', 'platform', '--check']);
    assert.notEqual(extra.status, 0);
    assert.match(extra.stderr, /unexpected file: extra\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses git index modes instead of DrvFs-style executable bits', (t) => {
  const root = makeSandbox();
  const stack = writeStack(root);
  const git = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  try {
    if (git(['init', '-q', '-b', 'main']).status !== 0) {
      t.skip('git is not available in this environment');
      return;
    }
    chmodSync(join(root, '01-step1', 'output', 'dkc-001', 'deliverable', 'a.txt'), 0o755);
    assert.equal(git(['add', '.']).status, 0);
    assert.equal(git(['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'fixture']).status, 0);
    // Simulate a DrvFs mount: git is told to ignore mode bits and every file
    // reports 0777. The git index must still win for tracked files.
    assert.equal(git(['config', 'core.filemode', 'false']).status, 0);
    for (const file of ['00-core/base.txt', '01-step1/output/dkc-001/deliverable/a.txt']) {
      chmodSync(join(root, file), 0o777);
    }
    const result = run(['--workspace', root, '--stack', stack, '--target', 'platform']);
    assert.equal(result.status, 0, result.stderr);
    const provenance = JSON.parse(readFileSync(join(root, 'platform', 'PROVENANCE.json'), 'utf8'));
    assert.equal(provenance.files['a.txt'].source, 'dkc-001');
    // a.txt is tracked executable -> 100755; base.txt is tracked plain -> 100644.
    // The assembler must not report 100755 for everything just because the
    // working tree is on a file system without real mode bits.
    assert.equal(provenance.files['base.txt'].mode, '100644');
    const tracked = git(['ls-files', '-s', '--', '00-core/base.txt', '01-step1/output/dkc-001/deliverable/a.txt']).stdout;
    assert.match(tracked, /^100644 .*\s00-core\/base\.txt$/m);
    assert.match(tracked, /^100755 .*\s01-step1\/output\/dkc-001\/deliverable\/a\.txt$/m);
    assert.equal(provenance.files['a.txt'].mode, '100755');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('canonical stack resolves every overlay and the committed platform matches', () => {
  const provenancePath = join(repoRoot, 'platform', 'PROVENANCE.json');
  let provenance;
  try {
    provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  } catch {
    return; // platform/ has not been assembled in this checkout
  }
  assert.equal(provenance.schema, 'dkc-platform-provenance/v1');
  assert.equal(provenance.tip, 'dkc-036');
  assert.equal(provenance.overlayOrder.length, 66);
  assert.equal(new Set(provenance.overlayOrder).size, 66);
  assert.equal(Object.keys(provenance.overlays).length, 66);
  assert.equal(provenance.fileCount, Object.keys(provenance.files).length);
  const result = run(['--target', 'platform', '--check', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).treeDigest, provenance.treeDigest);
});
