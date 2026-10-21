import { withEmailPresentation } from "../email/presentation";
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { classifySend, digestToken, newAccessToken, privateHeaders, secretMatches, siteOrigin } from './core';
import { deliveryClient } from './client';

// No raw provider errors, tokens, names, addresses or message contents enter logs.
export async function deliverRecipients(client: SupabaseClient, resend: Resend, origin: string, stopAt: number) {
  const counts = { accepted: 0, failed: 0, uncertain: 0, pending: 0, claimLost: 0 };
  for (let index = 0; index < 3 && Date.now() + 25_000 < stopAt; index++) {
    const claim = await client.rpc('claim_recipient_delivery').abortSignal(AbortSignal.timeout(5000));
    if (claim.error || !Array.isArray(claim.data)) throw new Error('Claim unavailable');
    if (!claim.data.length) break;
    const job = claim.data[0];
    const token = newAccessToken();
    // Once reserved, a lost response is uncertain: never obtain another send authorization.
    const reserve = await client.rpc('reserve_recipient_send', { p_id: job.id, p_claim: job.claim_token, p_digest: digestToken(token) })
      .abortSignal(AbortSignal.timeout(5000));
    if (reserve.error || !Array.isArray(reserve.data) || reserve.data.length !== 1) { counts.pending++; continue; }
    let result: ReturnType<typeof classifySend> = { outcome: 'uncertain', providerId: null };
    try {
      const options: Parameters<typeof resend.emails.send>[1] & { signal: AbortSignal } = {
        idempotencyKey: `eterpax:recipient-delivery:${job.id}`, signal: AbortSignal.timeout(10_000),
      };
      result = classifySend(await resend.emails.send(withEmailPresentation({ from: 'ETERPAX <hello@eterpax.com>', to: reserve.data[0].email,
        subject: 'Your private messages are ready — ETERPAX',
        text: `Messages have been entrusted to you through ETERPAX.\n\nOpen your private collection:\n${origin}/recipient#${token}\n\nThis personal link expires on ${reserve.data[0].expires_at}. Keep it private: anyone with this link can access your collection.\n\nNo private message content is included in this email.`,
      }), options));
    } catch { /* Submission may have happened. No retry. */ }
    const finish = await client.rpc('finish_recipient_send', { p_id: job.id, p_claim: job.claim_token,
      p_outcome: result.outcome, p_provider_id: result.providerId }).abortSignal(AbortSignal.timeout(5000));
    if (finish.error || finish.data !== true) counts.claimLost++;
    else counts[result.outcome]++;
  }
  return counts;
}
export async function runRecipientDelivery(request: Request) {
  const reply = (status: number, body: object) => Response.json(body, { status, headers: privateHeaders });
  if (process.env.PRIVATE_DELIVERY_ENABLED !== 'true') return reply(503, { error: 'Private delivery disabled' });
  if (!secretMatches(request.headers.get('authorization'), process.env.CRON_SECRET)) return reply(401, { error: 'Unauthorized' });
  if (request.method !== 'GET' || new URL(request.url).search || request.body) return reply(400, { error: 'Invalid request' });
  try {
    const origin = siteOrigin();
    if (!process.env.RESEND_API_KEY?.trim()) return reply(503, { error: 'Delivery not configured' });
    const stopAt = Date.now() + 55_000;
    const client = deliveryClient();
    const releases = await client.rpc('process_private_message_releases').abortSignal(AbortSignal.timeout(15_000));
    if (releases.error || !Array.isArray(releases.data)) return reply(502, { error: 'Release outcome unknown' });
    const releaseCounts: Record<string, number> = {};
    for (const row of releases.data) releaseCounts[row.outcome] = (releaseCounts[row.outcome] ?? 0) + 1;
    const delivery = await deliverRecipients(client, new Resend(process.env.RESEND_API_KEY), origin, stopAt);
    const summary = { releases: releaseCounts, delivery };
    console.info(JSON.stringify({ event: 'private_recipient_delivery', ...summary }));
    return reply(delivery.uncertain || delivery.claimLost || delivery.failed || releaseCounts.blocked ? 502 : 200, summary);
  } catch { return reply(502, { error: 'Delivery outcome unknown; inspect persistent state' }); }
}
