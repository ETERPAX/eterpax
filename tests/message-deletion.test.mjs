import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const OWNER='50cc8dbe-be5a-460b-9e00-429acdcf9563';
const ID='00000000-0000-4000-8000-000000000041';
function setup({enabled=true,user=OWNER,finals=['pending','deleted'],startError=null}={}) {
 const calls=[];const exports={};
 const chain={select(){return this},eq(){return this},is(){return this},limit:async()=>({data:[{message_id:ID}]}),maybeSingle:async()=>({data:{coordination_enabled:true,delete_enabled:true,private_delivery_reviewed_disabled:true}})};
 const client={auth:{getUser:async token=>{calls.push(['auth',token]);return {data:{user:{id:user}}}}},from:()=>chain,
 rpc:async(name,args)=>{calls.push([name,args]);return name==='request_message_deletion'?{data:'pending',error:startError}:{data:finals.shift()}}};
 const mocks={'server-only':{},'@supabase/supabase-js':{createClient:()=>client},'./cleanup':{recoverMessageFiles:async(...args)=>{calls.push(['cleanup',args.slice(1)]);return {removed:1}}}};
 vm.runInNewContext(require('typescript').transpileModule(readFileSync('lib/messages/deletion-server.ts','utf8'),{compilerOptions:{module:1,target:7}}).outputText,{exports,process:{env:{MESSAGE_DELETE_ENABLED:String(enabled),SUPABASE_URL:'https://nfnkgvjehggrzlysvvhi.supabase.co',SUPABASE_SECRET_KEY:'fixture-only'}},Response,URL,AbortSignal,Date,require:name=>mocks[name]});
 return {calls,run:(body,token='fixture-jwt')=>exports.handleMessageDeletion(new Request('http://localhost/api/messages/delete',{method:body?'POST':'GET',headers:token?{authorization:`Bearer ${token}`}:{},...(body?{body:JSON.stringify(body)}:{})}))};
}
test('disabled by default, verified owner and explicit confirmation required',async()=>{
 for(const options of [{enabled:false}]){const {run,calls}=setup(options);assert.equal((await run()).status,403);assert(!calls.some(([n])=>n==='cleanup'));}
 let s=setup();assert.equal((await s.run(null,'')).status,401);
 for(const body of [{messageId:ID,action:'delete'},{messageId:ID,action:'delete',confirmed:true,userId:'other'},{messageId:'invalid',action:'delete',confirmed:true}]){s=setup();assert.equal((await s.run(body)).status,400);assert(!s.calls.some(([n])=>n==='cleanup'));}
});
test('selected message only, bounded cleanup, real finalization and pending result',async()=>{
 for(const [user,result] of [[OWNER,'deleted'],['00000000-0000-4000-8000-000000000002','pending']]){
 const {run,calls}=setup({user,finals:['pending',result]});const response=await run({messageId:ID,action:'delete',confirmed:true});assert.equal(response.status,200);assert.equal((await response.json()).outcome,result);
 const sql=calls.filter(([n])=>n.endsWith('message_deletion'));assert.equal(sql.length,3);for(const [,args] of sql){assert.equal(args.p_user_id,user);assert.equal(args.p_message_id,ID)}
 const [,args]=calls.find(([n])=>n==='cleanup');assert.equal(args[0],2);assert.equal(args[2].userId,user);assert.equal(args[2].messageId,ID);
 }
});
test('blocked or unknown request does not delete files; check never starts a new deletion',async()=>{
 for(const error of [{code:'P0001'},{code:'NETWORK'}]){const s=setup({startError:error});const r=await s.run({messageId:ID,action:'delete',confirmed:true});assert.equal(r.status,error.code==='P0001'?409:503);assert(!s.calls.some(([n])=>n==='cleanup'));}
 const s=setup({finals:['blocked']});assert.equal((await s.run({messageId:ID,action:'check'})).status,409);assert(!s.calls.some(([n])=>n==='cleanup'||n==='request_message_deletion'));
});
