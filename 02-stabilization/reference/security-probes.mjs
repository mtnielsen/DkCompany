import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const root=resolve(process.argv[2]);
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const {createAgentRuntime}=await load('runtime/src/runtime.mjs');
const {createMemoryAuditLog,createApprovalClient}=await load('runtime/src/clients.mjs');
const {validDecision}=await load('runtime/test/pdp-fixtures.mjs');
const {evidenceFixture}=await load('runtime/test/evidence-fixtures.mjs');
const {createProtectedDataGuard,loadPolicy}=await load('data-protection/src/registry.mjs');
const {createApprovalService}=await load('approvals/src/approval-service.mjs');
const manifest=JSON.parse(readFileSync(resolve(root,'modules/dummy-ok/agents/backup-agent.json')));
const evidence=evidenceFixture(['tests-pass','dry-run-clean','rollback-tested']);
const record={id:'rec',dataClass:'retention-locked',noAiAccess:true,reclassifiers:[],consumerModules:['dummy-ok']};
const records=[];
for (const override of [false,true]) {
 let calls=0;
 const runtime=createAgentRuntime({manifest,pdp:{decide:async input=>validDecision(input,{requiredEvidence:['policy-allow']})},auditLog:createMemoryAuditLog(),protectedData:createProtectedDataGuard({register:{records:[record]},policy:loadPolicy()}),executors:{'observe.read':async()=>{calls++;return {summary:'isolated stub only'};}}});
 const action={verb:'observe.read',target:'dummy-ok',environment:'staging'};
 if(override) action.protectedData={...record,dataClass:'ordinary',noAiAccess:false};
 const result=await runtime.runTask({apiVersion:'contracts.platform/v1alpha1',kind:'AgentTask',taskId:randomUUID(),tenantId:'acme',agentRef:manifest.metadata.name,objective:'isolated security review',evidenceIndex:evidence.index,actions:[action]});
 records.push({probe:override?'caller_overrides_no_ai_access':'control_server_no_ai_access',status:result.status,reason:result.reason,stubExecutions:calls});
}
// Injected identities are test fixtures. No real IdP or external endpoint is used.
const outsider={id:'tenant-b-security',kind:'human',tenantId:'tenant-b',groups:['security-officer'],roles:['security-officer']};
const service=createApprovalService({authenticator:{authenticate:async authorization=>{if(authorization!=='Bearer fixture'){const e=new Error('unauthenticated');e.status=401;throw e;}return outsider;}}});
const request=JSON.parse(readFileSync(resolve(root,'contracts/examples/approval-request.example.json')));
request.id='tenant-a-sensitive-change';request.tenantId='acme';
service.create(request);
const port=await service.listen(0); const base=`http://127.0.0.1:${port}/v1/approvals`;
try {
 const single=await fetch(`${base}/${request.id}`,{headers:{authorization:'Bearer fixture'}});
 records.push({probe:'control_cross_tenant_get',httpStatus:single.status,body:await single.json()});
 const list=await fetch(base);
 records.push({probe:'anonymous_global_approval_list',httpStatus:list.status,body:await list.json()});
 const revoke=await fetch(`${base}/${request.id}/revoke`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({reason:'isolated cross-tenant probe'})});
 const body=await revoke.json();
 records.push({probe:'cross_tenant_revocation',httpStatus:revoke.status,requestTenant:body.tenantId,state:body.decision?.state,actorTenant:outsider.tenantId,error:body.error});
} finally {await service.close();}
const approvedService=createApprovalService({trainingRegistry:()=>['evidence-over-prose','when-to-reject']});
const approved=approvedService.create(JSON.parse(readFileSync(resolve(root,'contracts/examples/approval-request.example.json'))));
for(const id of ['fixture-one','fixture-two']) approvedService.decide(approved.id,{principal:{id,kind:'human',tenantId:'acme',groups:['platform-approvers']},verdict:'approve'});
let upgrades=0;
const runtime=createAgentRuntime({manifest,pdp:{decide:async input=>validDecision(input,{decision:'allow-with-approval',requiredApprovals:3,requiredEvidence:['policy-allow']})},auditLog:createMemoryAuditLog(),approvalVerifier:createApprovalClient({service:approvedService}),executors:{'upgrade.patch':async()=>{upgrades++;return {summary:'isolated stub only'};}}});
const thresholdResult=await runtime.runTask({apiVersion:'contracts.platform/v1alpha1',kind:'AgentTask',taskId:randomUUID(),tenantId:'acme',agentRef:manifest.metadata.name,objective:'isolated threshold review',evidenceIndex:evidence.index,actions:[{verb:approved.change.verb,target:approved.change.targets[0],environment:approved.change.environment,evidence:['tests-pass','dry-run-clean','rollback-tested'],approvalId:approved.id,executionId:randomUUID(),changeDigest:approved.change.diff.sha256,parameters:approved.change.parameters,policyBundleVersion:approved.evidence.policyEvaluation.bundleVersion}]});
records.push({probe:'runtime_pdp_requires_three_but_only_two_approved',pdpRequired:3,actualApprovers:approved.decision.approvals.length,status:thresholdResult.status,reason:thresholdResult.reason,stubExecutions:upgrades});
const report={reviewedCommit:'5e3706b5e7ad569c0ec68c4b63ceeaad15c237a3',scope:'Local assembled stack, stub executors and loopback HTTP only',records};
console.log(JSON.stringify(report,null,2));
if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(report,null,2));
