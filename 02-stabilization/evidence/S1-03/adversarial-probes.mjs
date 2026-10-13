import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const { createApprovalService } = await import(pathToFileURL(join(repoRoot, 'platform/approvals/src/approval-service.mjs')).href);
const example = JSON.parse(readFileSync(join(repoRoot, 'platform/contracts/examples/approval-request.example.json'), 'utf8'));
const humanA = (id, groups = ['platform-approvers'], extra = {}) => ({ kind: 'human', id, tenantId: 'acme', groups, ...extra });
const requester = humanA('oidc|requester', []);
const approverOne = humanA('oidc|approver-one');
const approverTwo = humanA('oidc|approver-two');
const ordinaryMember = humanA('oidc|ordinary-member', []);
const tenantB = { kind: 'human', id: 'oidc|tenant-b', tenantId: 'globex', groups: ['platform-approvers', 'security-officer'] };
const tenantlessPlatform = { kind: 'human', id: 'oidc|platform-acme', groups: ['platform-approvers'], roles: ['platform-admin:acme'] };
const tenantless = { kind: 'human', id: 'oidc|tenantless', groups: [] };
const wrongScopedPlatform = { kind: 'human', id: 'oidc|platform-globex', groups: ['platform-approvers'], roles: ['platform-admin:globex'] };
const securityOfficerA = humanA('oidc|security-officer', ['security-officer']);
const workload = { kind: 'workload', id: example.agent.spiffeId, tenantId: 'acme' };
const otherWorkload = { ...workload, id: 'spiffe://platform.example.org/agents/other' };
const principals = new Map([
  ['Bearer requester', requester], ['Bearer approver-one', approverOne], ['Bearer approver-two', approverTwo],
  ['Bearer member', ordinaryMember], ['Bearer tenant-b', tenantB], ['Bearer platform', tenantlessPlatform],
  ['Bearer tenantless', tenantless], ['Bearer wrong-platform', wrongScopedPlatform], ['Bearer security-officer', securityOfficerA],
  ['Bearer workload', workload], ['Bearer other-workload', otherWorkload],
]);

function payload(id) {
  const value = structuredClone(example);
  value.id = id;
  return value;
}

function fixture() {
  const audit = [];
  let internal;
  let now = Date.now();
  const service = createApprovalService({
    onTrustedCapability: (capability) => { internal = capability; },
    trainingRegistry: () => ['evidence-over-prose', 'when-to-reject'],
    clock: () => now,
    authenticator: { authenticate: async (authorization) => {
      const principal = principals.get(authorization);
      if (!principal) { const error = new Error('unauthenticated'); error.status = 401; throw error; }
      return principal;
    } },
    ledger: { append: (entry) => { audit.push(structuredClone(entry)); return entry; }, verifyChain: () => ({ ok: true }) },
  });
  return { service, internal, audit, setNow: (value) => { now = value; } };
}

async function withHttp(fn) {
  const f = fixture();
  const port = await f.service.listen(0);
  try { await fn({ ...f, base: `http://127.0.0.1:${port}/v1/approvals` }); }
  finally { await f.service.close(); }
}

async function post(url, token, body) {
  return fetch(url, { method: 'POST', headers: { authorization: token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('HTTP R4/R2: anonymous listing and tenant B cannot discover or mutate tenant A', async () => {
  await withHttp(async ({ service, internal, base, audit }) => {
    const created = await post(base, 'Bearer requester', payload('probe-r2-r4'));
    assert.equal(created.status, 201);
    assert.equal(internal.store.get('probe-r2-r4').decision.state, 'pending');

    const anonymous = await fetch(base);
    assert.equal(anonymous.status, 401);
    assert.doesNotMatch(await anonymous.text(), /probe-r2-r4/);

    const ownList = await fetch(base, { headers: { authorization: 'Bearer requester' } });
    assert.equal(ownList.status, 200);
    assert.deepEqual((await ownList.json()).requests.map((item) => item.id), ['probe-r2-r4']);
    const scopedList = await fetch(`${base}?tenantId=acme`, { headers: { authorization: 'Bearer platform' } });
    assert.equal(scopedList.status, 200);
    assert.deepEqual((await scopedList.json()).requests.map((item) => item.id), ['probe-r2-r4']);
    const tenantlessList = await fetch(`${base}?tenantId=acme`, { headers: { authorization: 'Bearer tenantless' } });
    assert.equal(tenantlessList.status, 403);
    const wrongScopeList = await fetch(`${base}?tenantId=acme`, { headers: { authorization: 'Bearer wrong-platform' } });
    assert.equal(wrongScopeList.status, 403);

    for (const path of ['/probe-r2-r4', '/probe-r2-r4/view', '/probe-r2-r4/merge-check']) {
      const response = await fetch(`${base}${path}`, { headers: { authorization: 'Bearer tenant-b' } });
      assert.equal(response.status, 403, path);
      assert.doesNotMatch(await response.text(), /probe-r2-r4/);
    }
    assert.equal((await post(`${base}/probe-r2-r4/decisions`, 'Bearer tenant-b', { verdict: 'approve', groups: ['platform-approvers'] })).status, 403);
    assert.equal((await post(`${base}/probe-r2-r4/revoke`, 'Bearer tenant-b', { reason: 'cross tenant' })).status, 403);
    assert.equal((await post(`${base}/probe-r2-r4/authorize`, 'Bearer tenant-b', { executionId: 'forged' })).status, 403);
    assert.equal(internal.store.get('probe-r2-r4').decision.state, 'pending');
    assert.ok(audit.some((entry) => entry.type === 'approval.access_denied' && entry.detail.operation === 'revoke'));
    assert.equal(service.get('probe-r2-r4', { principal: requester }).decision.state, 'pending');
  });
});

test('in-process service exposes snapshots and denies unauthenticated/cross-tenant public operations', () => {
  const { service, internal, audit } = fixture();
  const supplied = payload('probe-snapshot');
  const returned = service.create(supplied, { principal: requester });
  assert.equal(service.trusted, undefined);
  assert.equal(service.requests, undefined);
  assert.equal(service.store, undefined);
  supplied.decision.state = 'approved';
  returned.decision.state = 'revoked';
  const read = service.get('probe-snapshot', { principal: requester });
  read.decision.state = 'approved';
  assert.equal(internal.store.get('probe-snapshot').decision.state, 'pending');
  assert.throws(() => service.get('probe-snapshot'), (error) => error.status === 401);
  for (const operation of [
    () => service.get('probe-snapshot', { principal: tenantB }),
    () => service.decide('probe-snapshot', { principal: tenantB, verdict: 'approve' }),
    () => service.revoke('probe-snapshot', { principal: tenantB, reason: 'cross tenant' }),
    () => service.amend('probe-snapshot', { agentAssessment: { rationale: 'rewrite' } }, { principal: tenantB }),
    () => service.withdraw('probe-snapshot', { principal: tenantB }),
    () => service.mergeCheck('probe-snapshot', { principal: tenantB }),
    () => service.authorizeExecution('probe-snapshot', { executionId: 'wrong-tenant' }, { principal: tenantB }),
  ]) assert.throws(operation, (error) => error.status === 403);
  assert.equal(internal.store.get('probe-snapshot').decision.state, 'pending');
  assert.throws(() => service.create(payload('probe-snapshot'), { principal: requester }), (error) => error.status === 409);
  assert.equal(internal.store.ids().filter((id) => id === 'probe-snapshot').length, 1);
  assert.ok(audit.some((entry) => entry.type === 'approval.access_denied'));
});

test('only the matching executor can consume an internally created approval', () => {
  const { service, internal } = fixture();
  const request = internal.create(payload('probe-executor'));
  service.decide(request.id, { principal: approverOne, verdict: 'approve' });
  service.decide(request.id, { principal: approverTwo, verdict: 'approve' });
  for (const principal of [approverOne, tenantB, otherWorkload]) {
    assert.throws(() => service.authorizeExecution(request.id, { executionId: 'unauthorized' }, { principal }), (error) => error.status === 403);
  }
  const result = service.authorizeExecution(request.id, {
    executionId: 'probe-execution', tenantId: 'acme', verb: example.change.verb,
    environment: example.change.environment, target: example.change.targets[0],
    diffSha256: example.change.diff.sha256, parameters: example.change.parameters,
    policyBundleVersion: example.evidence.policyEvaluation.bundleVersion,
  }, { principal: workload });
  assert.equal(result.ok, true);
  assert.equal(internal.store.get(request.id).decision.consumed.executorId, workload.id);
});

test('unrelated same-tenant actor cannot withdraw a server-created request without a requester', () => {
  const { service, internal, audit } = fixture();
  const request = internal.create(payload('probe-internal-withdraw'));
  assert.equal(internal.store.get(request.id).decision.requestedBy, null);
  assert.equal(internal.store.get(request.id).decision.state, 'pending');
  assert.throws(() => service.withdraw(request.id, { principal: ordinaryMember, reason: 'unauthorized' }), (error) => error.status === 403);
  assert.equal(internal.store.get(request.id).decision.state, 'pending');
  assert.ok(audit.some((entry) => entry.type === 'approval.access_denied' && entry.detail.operation === 'withdraw'));
});

test('role denial happens before expiry side effects for same-tenant decisions', () => {
  const { service, internal, audit, setNow } = fixture();
  const request = service.create(payload('probe-role-before-expiry'), { principal: requester });
  setNow(Date.parse(request.decision.expiresAt) + 1);
  assert.throws(() => service.decide(request.id, { principal: ordinaryMember, verdict: 'approve' }), (error) => error.status === 403);
  assert.equal(internal.store.get(request.id).decision.state, 'pending');
  assert.ok(audit.some((entry) => entry.type === 'approval.access_denied' && entry.detail.operation === 'decide'));
  assert.throws(() => service.decide(request.id, { principal: approverOne, verdict: 'approve' }), (error) => error.status === 410);
  assert.equal(internal.store.get(request.id).decision.state, 'expired');
});

test('HTTP ignores spoofed principal, groups, training and actor kind', async () => {
  await withHttp(async ({ service, base }) => {
    const body = payload('probe-http-spoof');
    body.principal = approverOne;
    body.groups = ['platform-approvers'];
    body.completedTrainingModules = ['evidence-over-prose', 'when-to-reject'];
    const created = await post(base, 'Bearer requester', body);
    assert.equal(created.status, 201);
    assert.equal(service.get('probe-http-spoof', { principal: requester }).decision.requestedBy, requester.id);
    const spoofed = await post(`${base}/probe-http-spoof/decisions`, 'Bearer member', {
      verdict: 'approve', principal: approverOne, id: approverOne.id,
      groups: ['platform-approvers'], roles: ['platform-admin:*'],
      completedTrainingModules: ['evidence-over-prose', 'when-to-reject'],
    });
    assert.equal(spoofed.status, 403);
    const workloadAsHuman = await post(`${base}/probe-http-spoof/decisions`, 'Bearer workload', {
      verdict: 'approve', principal: approverOne, groups: ['platform-approvers'],
    });
    assert.equal(workloadAsHuman.status, 403);
    assert.equal(service.get('probe-http-spoof', { principal: requester }).decision.approvals.length, 0);
  });
});

test('nested amend input is copied and object-valued sensitive fields fail safely', () => {
  const { service, internal } = fixture();
  const request = service.create(payload('probe-amend-alias'), { principal: requester });
  const patch = {
    evidence: { extension: { marker: 'before' } },
    agentAssessment: { rationale: 'updated', extension: { marker: 'before' } },
  };
  service.amend(request.id, patch, { principal: requester });
  patch.evidence.extension.marker = 'after';
  patch.agentAssessment.extension.marker = 'after';
  assert.equal(service.get(request.id, { principal: requester }).evidence.extension.marker, 'before');
  assert.equal(service.get(request.id, { principal: requester }).agentAssessment.extension.marker, 'before');
  assert.throws(() => service.decide(request.id, { principal: approverOne, verdict: 'approve', comment: { forged: true } }), (error) => error.status === 400);
  assert.throws(() => service.revoke(request.id, { principal: securityOfficerA, reason: { forged: true } }), (error) => error.status === 400);
  assert.throws(() => service.authorizeExecution(request.id, { executionId: { forged: true } }, { principal: workload }), (error) => error.status === 400);
  assert.equal(internal.store.get(request.id).decision.state, 'pending');
  assert.equal(internal.store.get(request.id).decision.consumed, undefined);
});
