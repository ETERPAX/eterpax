import { randomBytes } from "node:crypto";
import { guardianVerificationQuestion } from "@/lib/continuity/guardian-verification-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export async function GET() {
  const nonce = randomBytes(18).toString("base64");
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` };
  if (process.env.GUARDIAN_VERIFICATION_RESPONSE_ENABLED !== "true") return new Response("Verification unavailable", { status: 503, headers });
  try {
    const copy = guardianVerificationQuestion();
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ETERPAX — Guardian Verification</title>
<style nonce="${nonce}">body{font:18px system-ui;background:#f7f8fa;color:#18232f;margin:2rem auto;padding:1rem;max-width:640px}label{display:block;margin:1.5rem 0}button{padding:1rem;font:inherit}#status{margin-top:1rem}</style>
<h1>Guardian Verification</h1><p>${escape(copy.question)}</p>
<p>Please respond only if you have reliable information. Opening this page does not record a response. Your choice cannot be changed after submission.</p>
<form id="form"><label><input type="radio" name="decision" value="positive" required> ${escape(copy.positive)}</label>
<label><input type="radio" name="decision" value="negative" required> ${escape(copy.negative)}</label>
<label><input type="checkbox" id="confirm" required> I confirm this is my intended response.</label>
<button id="submit" type="submit" disabled>Submit response</button></form><p id="status" role="status"></p>
<script nonce="${nonce}">
(() => {
 let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
 history.replaceState(null, '', location.pathname);
 const form = document.getElementById('form'), button = document.getElementById('submit'), status = document.getElementById('status');
 button.disabled = !/^[A-Za-z0-9_-]{43}$/.test(token);
 if (button.disabled) status.textContent = 'This link is unavailable. Please use the original email link.';
 form.addEventListener('submit', async event => {
  event.preventDefault(); if (button.disabled || !form.reportValidity()) return;
  button.disabled = true;
  const decision = new FormData(form).get('decision');
  try {
   const response = await fetch('/api/guardian-verification/respond', {method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({token,decision})});
   status.textContent = response.ok ? 'Your response has been recorded.' : 'The response could not be confirmed. This link may be expired, cancelled or already used.';
  } catch { status.textContent = 'The result could not be confirmed. Do not assume the response failed.'; }
  token = ''; form.hidden = true;
 });
})();
</script></html>`, { headers });
  } catch { return new Response("Verification unavailable", { status: 503, headers }); }
}
