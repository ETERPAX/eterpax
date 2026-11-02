import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const owner = n => `${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
function load(file, env = {}, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file,root),'utf8'),{compilerOptions:{module:1,target:7}}).outputText;
  vm.runInNewContext(source,{exports,process:{env},Date,Intl,URL,Response,AbortSignal,
    console:{log(){assert.fail('No sensitive logs');},error(){assert.fail('No sensitive logs');}},
    require(name){
      if(name==='server-only')return {};
      if(name in dependencies)return dependencies[name];
      if(name.startsWith('node:'))return require(name);
      if(name.startsWith('.'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts',env,dependencies);
      if(name==='resend'||name==='@supabase/supabase-js')return {};
      throw Error('Unexpected module');
    },
  });return exports;
}
const {promotionExpiryEmail}=load('lib/promotions/expiry-email.ts');
test('both reminders carry bilingual exact date and approved process/permission policy',()=>{
  for(const days of [30,7]){
    const email=promotionExpiryEmail('2027-11-02T12:00:00Z',days);
    assert.match(email.subject,new RegExp(String(days)));
    assert.match(email.text,/November 2, 2027/);
    assert.match(email.text,/2 de noviembre de 2027/);
    assert.match(email.text,/No habrá cargos/);
    assert.match(email.text,/already started will follow their original rules/);
    assert.match(email.html,/https:\/\/www.eterpax.com\/dashboard/);
    assert(!email.text.includes('EPX-'));
  }
  assert.throws(()=>promotionExpiryEmail('not-a-date',7));
});
function harness(mode='success'){
  const queue=[30,7].map(days=>({user_id:owner(1),claim_token:owner(days),days_before:days,email:'fixture@example.invalid',expires_at:'2027-11-02T12:00:00Z'}));
  const sends=[],finishes=[],calls=[];
  const client={rpc(name,args){calls.push(name);return {async abortSignal(){
    if(name==='claim_promotion_expiry_notice')return {data:queue.length?[queue.shift()]:[],error:null};
    assert.equal(name,'finish_promotion_expiry_notice');finishes.push(args);
    return {data:mode!=='finish-error',error:null};
  }}}};
  const resend={emails:{async send(payload,options){
    sends.push({payload,options});
    if(mode==='throw')throw Error('PRIVATE PROVIDER ERROR');
    if(mode==='reject')return {data:null,error:{message:'PRIVATE PROVIDER ERROR'}};
    return {data:{id:'provider_fixture'},error:null};
  }}};
  const run=()=>load('lib/promotions/expiry-server.ts').sendPromotionExpiryNotices(client,resend,Date.now()+55_000);
  return {run,sends,finishes,calls,client,resend};
}
test('30 and 7 day notices use distinct stable idempotency keys, consumed reservations',async()=>{
  const h=harness();await Promise.all([h.run(),h.run()]);await h.run();
  assert.equal(h.sends.length,2);assert.equal(new Set(h.sends.map(s=>s.options.idempotencyKey)).size,2);
  assert(h.finishes.every(f=>f.p_status==='accepted'&&f.p_provider_id==='provider_fixture'));
});
test('uncertain provider and failed finish never resubmit or log provider text',async()=>{
  for(const mode of ['throw','reject','finish-error']){
    const h=harness(mode);await h.run();await h.run();assert.equal(h.sends.length,2);
    if(mode!=='finish-error')assert(h.finishes.every(f=>f.p_status==='uncertain'));
  }
});
test('cron authenticates, requires gate, never calls release or continuity',async()=>{
  const env={NODE_ENV:'production',CRON_SECRET:'fixture-cron',PROMOTION_EXPIRY_NOTICES_ENABLED:'true',RESEND_API_KEY:'fixture',SUPABASE_SECRET_KEY:'fixture',NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid'};
  const h=harness();
  const deps={'@supabase/supabase-js':{createClient:()=>h.client},resend:{Resend:class {constructor(){return h.resend;}}}};
  const run=load('lib/promotions/expiry-server.ts',env,deps).runPromotionExpiryNotices;
  const request=()=>new Request('https://example.invalid/api/cron/promotion-expiry',{headers:{authorization:'Bearer fixture-cron'}});
  assert.equal((await run(new Request('https://example.invalid'))).status,401);
  assert.equal((await load('lib/promotions/expiry-server.ts',{...env,PROMOTION_EXPIRY_NOTICES_ENABLED:'false'},deps).runPromotionExpiryNotices(request())).status,503);
  assert.equal((await run(request())).status,200);
  assert(h.calls.every(n=>['claim_promotion_expiry_notice','finish_promotion_expiry_notice'].includes(n)));
});
