import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
function load(file, env = {}, mocks = {}) {
  const exports = {};
  vm.runInNewContext(require('typescript').transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, target: 7 },
  }).outputText, { exports, process: { env }, URL, Response, AbortSignal, Date,
    console: { info() {} }, require: name => name === 'server-only' ? {} : mocks[name] ?? require(name) });
  return exports;
}
const job = { message_id: 'message', user_id: 'owner', bucket: 'message-audio', path: 'owner/test', claim_token: 'claim' };
test('ambiguous Storage outcomes, references, lost leases and verification failures fail safely', async () => {
  for (const scenario of ['shared','lost','timeout_absent','error_present','post_unknown','pre_unknown','duplicate']) {
    const calls=[];
    const {recoverMessageFiles:run}=load('lib/messages/cleanup.ts');
    const client={rpc:async(name,args)=>{
      calls.push(name);
      if(name==='claim_message_file_cleanup_scoped') return {data:scenario==='duplicate'?[job,job]:[job],error:null};
      if(name==='finish_message_file_cleanup') {assert.equal(args.p_removed,false);return {data:true,error:null};}
      if(args.p_phase==='before') return scenario==='pre_unknown'?{error:{}}:{data:scenario==='shared'?'blocked':scenario==='lost'?'lost':'ready',error:null};
      if(scenario==='post_unknown') throw new Error('connection lost');
      return {data:scenario==='error_present'?'present':'absent',error:null};
    },storage:{from:()=>({remove:async()=>{calls.push('remove');throw new Error('ambiguous provider response');}})}};
    const result=await run(client);
    if(['shared','lost','pre_unknown'].includes(scenario)) assert(!calls.includes('remove'));
    else assert.equal(calls.filter(x=>x==='remove').length,1);
    if(scenario==='timeout_absent') assert.equal(result.removed,1);
    if(scenario==='error_present') assert.equal(result.retry,1);
    if(scenario==='post_unknown') { assert.equal(result.uncertain,1);assert(!calls.includes('finish_message_file_cleanup')); }
  }
});
test('concurrent executors only process the lease claimed by one worker',async()=>{
  const {recoverMessageFiles:run}=load('lib/messages/cleanup.ts');let claimed=false,sends=0;
  const client={rpc:async(name,args)=>{
    if(name==='claim_message_file_cleanup_scoped') {if(claimed)return {data:[],error:null};claimed=true;return {data:[job],error:null};}
    return {data:args.p_phase==='before'?'ready':'absent',error:null};
  },storage:{from:()=>({remove:async()=>{sends++;return {data:[],error:null};}})}};
  const results=await Promise.all([run(client),run(client)]);
  assert.equal(sends,1);assert.equal(results.reduce((n,r)=>n+r.removed,0),1);
});
test('server-only auth, no client parameters and local-only destination',async()=>{
  const env={MESSAGE_RECOVERY_ENABLED:'true',MESSAGE_RECOVERY_SECRET:'x'.repeat(32),SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SECRET_KEY:'test-only'};
  let calls=0;
  const mocks={'@supabase/supabase-js':{createClient:()=>({rpc:async()=>({data:[],error:null})})},'./cleanup':{recoverMessageFiles:async(_,limit)=>{calls++;assert.equal(limit,2);return {removed:0,retry:0,claimLost:0,uncertain:0,budgetExhausted:false};}}};
  const run=(config,method='POST',secret=env.MESSAGE_RECOVERY_SECRET,query='',body)=>load('lib/messages/recovery-executor.ts',config,mocks).executeMessageRecovery(new Request('http://localhost/api/admin/messages/recover'+query,{method,headers:{authorization:`Bearer ${secret}`},...(body?{body}: {})}));
  assert.equal((await run({...env,MESSAGE_RECOVERY_ENABLED:'false'})).status,503);
  assert.equal((await run(env,'GET')).status,405);
  assert.equal((await run(env,'POST','wrong')).status,401);
  assert.equal((await run(env,'POST',env.MESSAGE_RECOVERY_SECRET,'?path=other')).status,400);
  assert.equal((await run(env,'POST',env.MESSAGE_RECOVERY_SECRET,'','{}')).status,400);
  assert.equal((await run({...env,SUPABASE_URL:'[https://invalid](https://invalid)'})).status,503);
  assert.equal(calls,0);
  assert.equal((await run(env)).status,200);assert.equal(calls,1);
});
test('scoped recovery exclusively claims the authenticated owner and selected message',async()=>{
 const owner='50cc8dbe-be5a-460b-9e00-429acdcf9563';const calls=[];
 const {recoverMessageFiles:run}=load('lib/messages/cleanup.ts');
 const client={rpc:async(name,args)=>{calls.push(name);
  if(name==='claim_message_file_cleanup_scoped'){assert.equal(args.p_limit,2);assert.equal(args.p_message_id,'selected');return {data:[{...job,user_id:owner,message_id:'selected',path:`${owner}/test`}],error:null}}
  assert.equal(name,'verify_message_file_cleanup');return {data:args.p_phase==='before'?'ready':'absent',error:null};
 },storage:{from:()=>({remove:async()=>({error:null})})}};
 assert.equal((await run(client,2,Date.now()+45000,{userId:owner,messageId:'selected'})).removed,1);
 assert.equal(calls.filter(name=>name==='claim_message_file_cleanup_scoped').length,1);
 await assert.rejects(()=>run(client,11,Date.now()+45000,{userId:owner,messageId:'selected'}),/Invalid cleanup limit/);
 const unsafe={...client,rpc:async()=>({data:[job],error:null})};
 await assert.rejects(()=>run(unsafe,2,Date.now()+45000,{userId:owner,messageId:'selected'}),/scope mismatch/);
});
test('scheduled recovery authenticates CRON_SECRET, stays off by default and finalizes without browser',async()=>{
 const env={MESSAGE_RECOVERY_ENABLED:'true',CRON_SECRET:'c'.repeat(32),SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'test-only'};
 let recovered=0,finalized=0;
 const mocks={'@supabase/supabase-js':{createClient:()=>({rpc:async(name,args)=>{assert.equal(name,'finalize_message_deletion_batch');assert.equal(args.p_limit,10);finalized++;return {data:[{outcome:'deleted'},{outcome:'blocked'}],error:null}}})},'./cleanup':{recoverMessageFiles:async()=>{recovered++;return {removed:2,retry:0,claimLost:0,uncertain:0,budgetExhausted:false}}}};
 const run=(config,token=env.CRON_SECRET)=>load('lib/messages/recovery-executor.ts',config,mocks).executeMessageRecovery(new Request('https://fixture/api/cron/message-recovery',{headers:{authorization:`Bearer ${token}`}}),true);
 assert.equal((await run(env)).status,503);
 const on={...env,MESSAGE_RECOVERY_AUTOMATIC_ENABLED:'true'};
 assert.equal((await run(on,'wrong')).status,401);assert.equal(recovered,0);
 const response=await run(on);assert.equal(response.status,200);const summary=await response.json();assert.equal(summary.finalized,1);assert.equal(summary.finalizationBlocked,1);assert.equal(finalized,1);
});
