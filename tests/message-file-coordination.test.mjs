import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
function load(file) {
  const exports = {};
  vm.runInNewContext(require('typescript').transpileModule(readFileSync(file,'utf8'), {
    compilerOptions: { module: 1, target: 7 },
  }).outputText, { exports, crypto: globalThis.crypto, require: name => {
    if (name === 'server-only') return {}; throw new Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
test('registration commits before ciphertext upload; lost provider response reconciles without overwrite', async () => {
  const { uploadMessageFile } = load('lib/messages/uploads.ts');
  let stored=false, uploaded=false; const calls=[];
  const op={ id:'operation', message_id:'message', bucket:'message-audio',path:'owner/message/operation',state:'pending' };
  const client={rpc:async name=>{
    calls.push(name);
    if(name==='register_message_upload') return { data:{...op,state:uploaded?'uploaded':'pending'},error:null };
    if(!stored) return {error:{message:'not visible'}};
    uploaded=true;return {data:'uploaded',error:null};
  },storage:{from:()=>({upload:async (path,body,options)=>{
    assert.equal(calls[0],'register_message_upload'); assert.equal(options.upsert,false);
    assert.equal(path,op.path);assert.equal(body,'ciphertext');stored=true;calls.push('storage');
    return {error:{message:'response lost'}};
  }})}};
  await uploadMessageFile(client,'message','message-audio','ciphertext','operation');
  await uploadMessageFile(client,'message','message-audio','ciphertext','operation');
  assert.equal(calls.filter(x=>x==='storage').length,1);
});
test('registration failure prevents Storage access',async()=>{
  const {uploadMessageFile}=load('lib/messages/uploads.ts');
  await assert.rejects(uploadMessageFile({rpc:async()=>({error:{}})},'message','message-audio','ciphertext','operation'));
});
test('cleanup preserves retry on provider error and reports lost finalization',async()=>{
  const {recoverMessageFiles}=load('lib/messages/cleanup.ts');
  let removed=false;
  const client={rpc:async(name,args)=>{
    if(name==='claim_message_file_cleanup_scoped') return {data:[{message_id:'message',user_id:'owner',bucket:'message-audio',path:'owner/legacy.webm',claim_token:'lease'}],error:null};
    if(name==='verify_message_file_cleanup') return {data:args.p_phase==='before'?'ready':removed?'lost':'present',error:null};
    assert.equal(args.p_token,'lease');assert.equal(args.p_removed,false);
    return {data:!removed,error:null};
  },storage:{from:()=>({remove:async paths=>{assert.equal(paths.length,1);return {error:removed?null:{message:'failure'}};}})}};
  assert.equal((await recoverMessageFiles(client)).retry,1);
  removed=true;
  assert.equal((await recoverMessageFiles(client)).claimLost,1);
  await assert.rejects(recoverMessageFiles(client,11));
});
