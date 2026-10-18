#!/usr/bin/env node
// Explicit operator-only command. No network calls on import or without --confirm-send.
// Run with --conditions=react-server; credentials must be supplied through the
// operator's secure environment, never flags/files/logs created by this script.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

async function main() {
  const [confirm, escalationId, guardianId] = process.argv.slice(2);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(confirm!=='--confirm-send'||!uuid.test(escalationId??'')||!uuid.test(guardianId??''))throw new Error('usage');
  if(process.env.CONTINUITY_SCHEDULER_ENABLED==='true')throw new Error('scheduler must remain disabled');
  if(process.env.GUARDIAN_VERIFICATION_AUTOMATIC_ENABLED==='true'
    ||process.env.GUARDIAN_VERIFICATION_PREPARATION_ENABLED==='true')throw new Error('automatic flags must remain disabled');
  const hosts={test:'xkojvvppactsabnewezb.supabase.co',production:'nfnkgvjehggrzlysvvhi.supabase.co'};
  const environment=process.env.CONTINUITY_ENVIRONMENT;
  // Explicit operator declaration of the test owner and recipient. Never infer
  // that an arbitrary registered Guardian is a test account.
  const testOwner=process.env.ETERPAX_TEST_OWNER_ID;
  const testEmail=process.env.ETERPAX_TEST_GUARDIAN_EMAIL?.trim().toLowerCase();
  if(!uuid.test(testOwner??'')||!testEmail||!/^\S+@\S+\.\S+$/.test(testEmail))throw new Error('test authorization missing');
  if(!Object.hasOwn(hosts,environment??'')||!process.env.SUPABASE_SECRET_KEY?.trim())throw new Error('configuration');
  const target=new URL(process.env.SUPABASE_URL??'');
  if(target.href!==`https://${hosts[environment]}/`)throw new Error('target');
  const require=createRequire(import.meta.url);
  const ts=require('typescript');
  const root=fileURLToPath(new URL('../lib/continuity/',import.meta.url));
  // Compile only this repository's server modules in memory. No generated files.
  require.extensions['.ts']=(module,filename)=>{
    if(!path.resolve(filename).startsWith(root))throw new Error('module outside allowlist');
    module._compile(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,
    }}).outputText,filename);
  };
  const {createClient}=require('@supabase/supabase-js');
  const {dispatchInitialGuardianVerification}=require(path.join(root,'guardian-verification-dispatch.ts'));
  const client=createClient(target.origin,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {guardianVerificationOrigin}=require(path.join(root,'guardian-verification-config.ts'));
  const origin=guardianVerificationOrigin();
  const {verifyGuardianVerificationContent}=require(path.join(root,'guardian-verification-content.ts'));
  // GET cannot vote. Refuse redirects, unavailable copy, or an unready deployment.
  const page=await fetch(origin+'/guardian-verification',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!page.ok||!page.headers.get('content-type')?.includes('text/html'))throw new Error('page unavailable');
  const html=await page.text();
  verifyGuardianVerificationContent(html);
  const endpoint=await fetch(origin+'/api/guardian-verification/respond',{
    method:'POST',redirect:'error',headers:{origin,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000),
  });
  // Empty input is rejected before token lookup; never submit a fabricated vote.
  if(endpoint.status!==400)throw new Error('response endpoint unavailable');
  const owner=await client.from('guardian_escalations').select('user_id')
    .eq('id',escalationId).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  const recipient=await client.from('guardian_escalation_participants').select('email')
    .eq('escalation_id',escalationId).eq('source_guardian_id',guardianId)
    .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if(owner.error||owner.data?.user_id!==testOwner||recipient.error
    ||recipient.data?.email!==testEmail)throw new Error('test identity mismatch');
  const result=await dispatchInitialGuardianVerification(client,{escalationId,guardianId,environment});
  // A sanitized outcome only; acceptance never means inbox delivery.
  console.log(JSON.stringify(result));
  if(!['accepted_window_started','accepted'].includes(result.outcome))process.exitCode=1;
}
main().catch(()=>{console.error('STOP: configuration or operation could not be confirmed. Do not retry blindly.');process.exitCode=1;});
