import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const env={PRIVATE_DELIVERY_ENABLED:'true',CRON_SECRET:'x'.repeat(32),NEXT_PUBLIC_SITE_URL:'https://example.test',RESEND_API_KEY:'synthetic'};
function load(file,deps={},config=env){
 const exports={};
 const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:1,target:9}}).outputText;
 vm.runInNewContext(source,{exports,process:{env:config},Buffer,URL,Response,Request,ReadableStream,Uint8Array,TextDecoder,AbortSignal,setTimeout,clearTimeout,Date,console:{info(){}},
 require(name){if(name==='server-only')return {};if(name in deps)return deps[name];if(name==='node:crypto')return require(name);throw Error(name);}});
 return exports;
}
const core=load('lib/recipient-delivery/core.ts');
const id='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const provider='00000000-0000-4000-8000-000000000003';
test('256-bit capabilities, safe digest, and constant-time cron authentication',()=>{
 const a=core.newAccessToken(),b=core.newAccessToken();assert(core.tokenPattern.test(a));assert.notEqual(a,b);assert.equal(core.digestToken(a).length,64);assert.notEqual(core.digestToken(a),a);
 assert(core.secretMatches('Bearer '+env.CRON_SECRET,env.CRON_SECRET));assert(!core.secretMatches('bad',env.CRON_SECRET));assert(!core.secretMatches('Bearer short','short'));
});
test('provider accepted, definitive rejection and unknown outcomes stay distinct',()=>{
 assert.equal(core.classifySend({data:{id:provider},error:null}).outcome,'accepted');
 assert.equal(core.classifySend({data:null,error:{name:'validation_error',statusCode:422}}).outcome,'failed');
 for(const value of [null,{}, {data:null,error:{name:'internal_server_error',statusCode:500}}, {data:{id:provider},error:{name:'validation_error',statusCode:422}}]) assert.equal(core.classifySend(value).outcome,'uncertain');
});
function result(data,error=null){return {abortSignal:async()=>({data,error})};}
test('worker sends once with stable idempotency, no private contents, digest only persisted',async()=>{
 const calls=[];let claims=0;let email;
 const client={rpc(name,args){calls.push([name,args]);if(name==='claim_recipient_delivery')return result(claims++?[]:[{id,claim_token:other}]);
 if(name==='reserve_recipient_send')return result([{email:'recipient@example.invalid',expires_at:'2026-12-01'}]);
 if(name==='finish_recipient_send')return result(true);throw Error(name);}};
 const resend={emails:{send:async(payload,options)=>{email=payload;assert.equal(options.idempotencyKey,`eterpax:recipient-delivery:${id}`);return {data:{id:provider},error:null};}}};
 const mod=load('lib/recipient-delivery/worker.ts',{'./core':core,'./client':{},resend:{}});
 const counts=await mod.deliverRecipients(client,resend,env.NEXT_PUBLIC_SITE_URL,Date.now()+55000);
 assert.equal(counts.accepted,1);assert.equal(email.to,'recipient@example.invalid');assert(!email.text.includes('Private letter'));assert(!email.text.includes('?token='));
 const token=email.text.match(/recipient#([\w-]+)/)[1];assert.equal(calls.find(c=>c[0]==='reserve_recipient_send')[1].p_digest,core.digestToken(token));
 const finish=calls.find(c=>c[0]==='finish_recipient_send')[1];assert.equal(finish.p_provider_id,provider);assert.equal(finish.p_outcome,'accepted');
 assert(!JSON.stringify(calls).includes(token));
});
test('provider timeout is finalized uncertain without resubmission',async()=>{
 let sent=0,claims=0,finished;
 const client={rpc(name,args){if(name==='claim_recipient_delivery')return result(claims++?[]:[{id,claim_token:other}]);if(name==='reserve_recipient_send')return result([{email:'x@example.invalid'}]);finished=args;return result(true);}};
 const mod=load('lib/recipient-delivery/worker.ts',{'./core':core,'./client':{},resend:{}});
 const counts=await mod.deliverRecipients(client,{emails:{send:async()=>{sent++;throw Error('contains private provider echo');}}},env.NEXT_PUBLIC_SITE_URL,Date.now()+55000);
 assert.equal(sent,1);assert.equal(counts.uncertain,1);assert.equal(finished.p_outcome,'uncertain');
});
test('reservation unknown or denied never authorizes provider send',async()=>{
 for(const response of [result(null,{message:'unknown'}),result([])]){
 let claims=0,sent=0;
 const client={rpc(name){return name==='claim_recipient_delivery'?result(claims++?[]:[{id,claim_token:other}]):response;}};
 const mod=load('lib/recipient-delivery/worker.ts',{'./core':core,'./client':{},resend:{}});
 await mod.deliverRecipients(client,{emails:{send:async()=>{sent++;}}},env.NEXT_PUBLIC_SITE_URL,Date.now()+55000);assert.equal(sent,0);
 }
});
test('disabled or unauthenticated cron cannot create clients or releases',async()=>{
 for(const config of [{...env,PRIVATE_DELIVERY_ENABLED:'false'},env]){
 let clients=0;const mod=load('lib/recipient-delivery/worker.ts',{'./core':core,'./client':{deliveryClient(){clients++;throw Error();}},resend:{}},config);
 const res=await mod.runRecipientDelivery(new Request('https://example.test/api/cron/recipient-delivery'));assert([401,503].includes(res.status));assert.equal(clients,0);
 }
});
function accessMock({valid=true,items=[{id,recipient_id:other,snapshot:{body:'letter'}}],assets=[],download=null}={}){
 let downloads=0;const filters=[];
 const client={rpc:async()=>({data:valid?other:null,error:null}),from(table){let conditions=[];let single=false;
 const q={select(){return q;},eq(k,v){conditions.push([k,v]);filters.push([table,k,v]);return q;},order(){return q;},maybeSingle(){single=true;return q;},then(resolve){
 const rows=(table==='message_release_items'?items:assets).filter(row=>conditions.every(([k,v])=>row[k]===v));resolve({data:single?(rows[0]??null):rows,error:null});}};return q;},
 storage:{from(){return {info:async()=>({data:{size:128},error:null}),download:async()=>{downloads++;return {data:download,error:null};}};}}};
 const mod=load('lib/recipient-delivery/access.ts',{'./client':{deliveryClient:()=>client},'./core':core,'@/lib/messages/decrypt-content':{decryptStoredText:async()=> 'decrypted',decryptStoredBytes:async data=>data}});
 const token=core.newAccessToken();const request=(query='')=>new Request('https://example.test/api/recipient/content'+query,{headers:{cookie:`${mod.cookieName}=${token}`}});
 return {mod,request,filters,get downloads(){return downloads;},token};
}
test('expired and invalid capabilities return same unavailable response',async()=>{
 const m=accessMock({valid:false});assert.equal((await m.mod.readRecipientContent(m.request('?item='+id))).status,404);
 assert.equal((await m.mod.readRecipientContent(new Request('https://example.test/api/recipient/content?item='+id))).status,404);assert.equal(m.downloads,0);
});
test('item and asset IDs cannot cross recipient boundaries',async()=>{
 const m=accessMock({items:[{id,recipient_id:id,snapshot:{body:'someone else'}}]});assert.equal((await m.mod.readRecipientContent(m.request('?item='+id))).status,404);assert.equal(m.downloads,0);
 const n=accessMock({assets:[{id:provider,item_id:other,bucket:'message-photos',path:'private'}]});assert.equal((await n.mod.readRecipientContent(n.request(`?item=${id}&asset=${provider}`))).status,404);assert.equal(n.downloads,0);
});
test('authorized text is returned without metadata or Storage paths',async()=>{
 const m=accessMock();const res=await m.mod.readRecipientContent(m.request('?item='+id));assert.equal(res.status,200);assert.deepEqual(await res.json(),{text:'letter'});assert(res.headers.get('cache-control').includes('no-store'));
});
test('attachments are proxied as private streams and active formats forced to downloads',async()=>{
 const m=accessMock({assets:[{id:provider,item_id:id,kind:'document',bucket:'message-documents',path:'secret/permanent/path',metadata:{document_mime_type:'text/html'}}],download:new Blob(['<script>bad</script>'],{type:'text/html'})});
 const res=await m.mod.readRecipientContent(m.request(`?item=${id}&asset=${provider}`));assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'application/octet-stream');assert(res.headers.get('content-disposition').startsWith('attachment'));assert(res.headers.get('content-security-policy').includes('sandbox'));assert(!JSON.stringify([...res.headers]).includes('secret/permanent/path'));assert.equal(m.downloads,1);
});
test('session requires same-origin JSON and uses secure HttpOnly scoped cookie',async()=>{
 const m=accessMock();const base={method:'POST',headers:{origin:env.NEXT_PUBLIC_SITE_URL,'content-type':'application/json'},body:JSON.stringify({token:m.token})};
 const response=await m.mod.openRecipientSession(new Request('https://example.test/api/recipient/session',base));assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');for(const part of ['HttpOnly','Secure','SameSite=Strict','Path=/api/recipient']) assert(cookie.includes(part));
 assert.equal((await m.mod.openRecipientSession(new Request('https://example.test/api/recipient/session',{...base,headers:{...base.headers,origin:'https://attacker.invalid'}}))).status,404);
});
test('media supports byte ranges without authorizing cross-recipient requests',async()=>{
 const m=accessMock({assets:[{id:provider,item_id:id,kind:'video',bucket:'message-videos',path:'private',metadata:{video_mime_type:'video/mp4'}}],download:new Blob(['0123456789'],{type:'video/mp4'})});
 const req=m.request(`?item=${id}&asset=${provider}`);req.headers.set('range','bytes=2-5');
 const res=await m.mod.readRecipientContent(req);assert.equal(res.status,206);assert.equal(res.headers.get('content-range'),'bytes 2-5/10');assert.equal(await res.text(),'2345');
 const bad=m.request(`?item=${id}&asset=${provider}`);bad.headers.set('range','bytes=20-25');assert.equal((await m.mod.readRecipientContent(bad)).status,416);
});
test('oversized session input fails before capability lookup',async()=>{
 const m=accessMock();const res=await m.mod.openRecipientSession(new Request('https://example.test/api/recipient/session',{method:'POST',headers:{origin:env.NEXT_PUBLIC_SITE_URL,'content-type':'application/json'},body:'x'.repeat(257)}));assert.equal(res.status,404);
});
test('encrypted letters decrypt only after collection authorization and never return key metadata',async()=>{
 const m=accessMock({items:[{id,recipient_id:other,snapshot:{body:'ciphertext',body_encryption_version:'v1',body_iv:'iv',body_encrypted_key:'secret-key'}}]});
 const response=await m.mod.readRecipientContent(m.request('?item='+id));assert.equal(response.status,200);assert.deepEqual(await response.json(),{text:'decrypted'});
 const invalid=accessMock({items:[{id,recipient_id:other,snapshot:{body:'ciphertext',body_encryption_version:'v2',body_iv:'iv',body_encrypted_key:'secret-key'}}]});
 assert.equal((await invalid.mod.readRecipientContent(invalid.request('?item='+id))).status,404);
});
test('collection listing reveals only opaque IDs and media kinds',async()=>{
 const m=accessMock({items:[{id,recipient_id:other,snapshot:{body:'PRIVATE'},message_release_assets:[{id:provider,kind:'photo'}]}]});
 const response=await m.mod.listRecipientMessages(m.request());assert.equal(response.status,200);const body=await response.text();assert(!body.includes('PRIVATE'));assert(!body.includes('snapshot'));assert(!body.includes('recipient_id'));
});
