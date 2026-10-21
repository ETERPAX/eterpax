import { presentation } from './helpers/email-presentation.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const deadline=new Date(Date.now()+3600_000).toISOString();
const majority=new Date(Date.parse(deadline)-48*3600_000).toISOString();
async function scenario(mode='valid') {
 const events=[1,2].map(n=>({id:id(n),user_id:id(n+10),check_in_id:id(n+20),escalation_id:id(n+30),event_type:'owner_safety_window',response_deadline_at:deadline,claim_token:id(n+40),delivery_status:'processing',lease_expires_at:new Date(Date.now()+600_000).toISOString()}));
 if(mode==='expired') events.forEach(e=>e.response_deadline_at=new Date(Date.now()-1).toISOString());
 const sends=[],updates=[]; let reads=0;
 const source=require('typescript').transpileModule(readFileSync('lib/continuity/email.ts','utf8'),{compilerOptions:{module:1,target:7}}).outputText;
 const exports={};
 const client={rpc:async()=>({data:events,error:null}),auth:{admin:{getUserById:async user=>({data:{user:{id:mode==='wrong-recipient'?id(99):user,email:`${user}@example.test`}},error:null})}},from(table){let filters={},patch;const q={select(){return q},eq(k,v){filters[k]=v;return q},update(p){patch=p;return q},async abortSignal(){updates.push(patch);return {data:[{id:filters.id}],error:null}},async maybeSingle(){const event=events.find(e=>(table==='guardian_escalations'?e.escalation_id:e.id)===filters.id);if(table==='continuity_email_outbox')return {data:{...event},error:null};reads++;return {data:{id:event.escalation_id,user_id:mode==='wrong-owner'?id(99):event.user_id,check_in_id:event.check_in_id,generation:1,status:mode==='cancelled'||(mode==='cancel-during-auth'&&reads>1)?'cancelled_owner_check_in':'safety_window',closed_at:null,owner_checked_in_at:null,guardian_verification_rounds:{majority_reached_at:majority,safety_deadline_at:mode==='changed-deadline'?new Date(Date.parse(deadline)+1).toISOString():deadline},check_ins:{user_id:event.user_id,enabled:true,status:'escalation_pending',escalation_generation:1}},error:null}}};return q}};
 vm.runInNewContext(source,{exports,process:{env:{NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:'https://www.eterpax.com',RESEND_API_KEY:'mock'}},URL,Date,setTimeout,clearTimeout,AbortSignal,console:{info(){}},require(n){if(n==='../email/presentation')return presentation;if(n==='server-only')return {};if(n==='resend')return {Resend:class{emails={send:async(payload,options)=>{sends.push({payload,options});if(mode==='uncertain')throw Error('timeout');return {data:{id:id(90)},error:null}}}}};throw Error(n)}});
 const result=await exports.deliverContinuityEmails(client,'production');return {result,sends,updates};
}
test('two owners receive only their own safety mail, stable idempotency and approved copy',async()=>{
 const {sends,result}=await scenario();assert.equal(result.counts.sent,2);
 sends.forEach(({payload,options},i)=>{assert.equal(payload.to,`${id(i+11)}@example.test`);assert.equal(payload.subject,'ETERPAX — Important: Your 48-Hour Safety Window Has Started');assert.match(payload.html,/I’M OKAY — STOP THE PROTOCOL/);assert.match(payload.html,/href="https:\/\/www.eterpax.com\/login"/);assert.match(payload.text,/does not restart/);assert.equal(options.idempotencyKey,`eterpax:production:owner_safety_window:${id(i+1)}`)});
});
test('cancelled, mismatched owner/recipient/deadline and cancellation before send fail closed',async()=>{
 for(const mode of ['expired','cancelled','wrong-owner','wrong-recipient','changed-deadline','cancel-during-auth']){const {sends}=await scenario(mode);assert.equal(sends.length,0,mode)}
});
test('provider ambiguity stays uncertain and never requeues',async()=>{const {updates}=await scenario('uncertain');assert.equal(updates.length,2);assert(updates.every(p=>p.delivery_status==='uncertain'))});
test('existing authenticated cancellation remains connected and scoped by auth.uid',()=>{
 assert.match(readFileSync('app/(auth)/login/page.tsx','utf8'),/window.location.href = "\/dashboard"/);
 assert.match(readFileSync('app/dashboard/page.tsx','utf8'),/supabase.rpc\("confirm_check_in"\)/);
 const sql=readFileSync('supabase/migrations/202610090002_guardian_verification_emissions_owner_compatibility.sql','utf8');assert.match(sql,/auth.uid\(\)/);assert.match(sql,/cancelled_owner_check_in/);
});
