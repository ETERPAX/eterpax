import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { Resend } from "resend";

type Row = Record<string, unknown>;
type State = "sent" | "pending" | "failed" | "cancelled" | "uncertain";
type Outcome = State | "claimLost" | "invalid" | "error";
type Event = Row & { id: string; claim_token: string };
export type DeliverySummary = { success: boolean; counts: Record<Outcome, number>; code?: string };
const SEND_MS = 10_000;
const READ_MS = 5_000;
const RESERVE_MS = 5_000;

// Bound reads and the single claim request without retrying them. A late claim
// is left for lease recovery; provider sends and finalizations use abort signals.
async function readWithin<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("READ_TIMEOUT")), READ_MS); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const isRow = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);

// Preserve PostgreSQL microseconds when comparing window identities.
// Date.parse alone would incorrectly equate deadlines within one millisecond.
function timestamp(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(6, "0");
  let zone = match[4];
  if (/^[+-]\d{2}$/.test(zone)) zone += ":00";
  const milliseconds = Date.parse(`${match[1]}T${match[2]}.${fraction.slice(0, 3)}${zone}`);
  return Number.isFinite(milliseconds)
    ? BigInt(milliseconds) * BigInt(1000) + BigInt(fraction.slice(3))
    : null;
}

function cancellationCode(event: Row, checkIn: Row | null): string | null {
  const now = BigInt(Date.now()) * BigInt(1000);
  const lease = timestamp(event.lease_expires_at);
  const deadline = timestamp(event.response_deadline_at);
  if (event.event_type !== "check_in_request") return "INVALID_EVENT_TYPE";
  if (lease === null || lease <= now) return "CLAIM_EXPIRED_OR_INVALID";
  if (!isUuid(event.check_in_id) || !isUuid(event.user_id) || deadline === null) return "INVALID_EVENT";
  if (!checkIn) return "CHECK_IN_MISSING";
  if (checkIn.user_id !== event.user_id) return "OWNER_MISMATCH";
  if (checkIn.enabled !== true) return "CHECK_IN_DISABLED";
  if (checkIn.status !== "awaiting_response") return "WINDOW_INACTIVE";
  if (timestamp(checkIn.response_deadline_at) !== deadline) return "WINDOW_MISMATCH";
  if (deadline <= now) return "WINDOW_EXPIRED";
  if (checkIn.next_check_in_at !== null) return "INVALID_WINDOW";
  if (![0, 1, 2].includes(checkIn.missed_count as number)) return "INVALID_MISSED_COUNT";
  return null;
}

function loginUrl(environment: "test" | "production"): string {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  const local = environment === "test" && process.env.NODE_ENV === "development"
    && !process.env.VERCEL && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("INVALID_SITE_ORIGIN");
  }
  return `${url.origin}/login`;
}

function providerOutcome(value: unknown): { state: State; code: string | null; messageId?: string } {
  if (!isRow(value)) return { state: "uncertain", code: "PROVIDER_UNKNOWN" };
  if (value.error === null && isRow(value.data) && isUuid(value.data.id)) {
    return { state: "sent", code: null, messageId: value.data.id };
  }
  if (value.data !== null || !isRow(value.error)) return { state: "uncertain", code: "PROVIDER_UNKNOWN" };
  const { name, statusCode } = value.error;
  if (statusCode === 429 && ["rate_limit_exceeded", "daily_quota_exceeded", "monthly_quota_exceeded"].includes(name as string)) {
    return { state: "pending", code: "PROVIDER_LIMIT_REJECTED" };
  }
  const permanent: Record<string, number[]> = {
    validation_error: [400, 403, 422], invalid_idempotency_key: [400],
    missing_api_key: [401], invalid_api_key: [401, 403], restricted_api_key: [401, 403],
    invalid_permission: [403], suspended_api_key: [403], invalid_access: [403],
    invalid_from_address: [400, 422], invalid_parameter: [400, 422],
    missing_required_field: [400, 422], invalid_attachment: [422],
  };
  if (typeof name === "string" && typeof statusCode === "number" && (Object.hasOwn(permanent, name) && permanent[name].includes(statusCode))) {
    return { state: "failed", code: "PROVIDER_PERMANENT_REJECTION" };
  }
  return { state: "uncertain", code: "PROVIDER_OUTCOME_UNKNOWN" };
}

/** Only call with the trusted client and environment after scheduler preflight.
 * No check_ins writes. `sent` means provider accepted, not inbox delivery.
 */
export async function deliverContinuityEmails(
  supabase: SupabaseClient,
  environment: "test" | "production",
  stopAt = Date.now() + 45_000,
): Promise<DeliverySummary> {
  const counts: Record<Outcome, number> = { sent: 0, pending: 0, failed: 0, cancelled: 0, uncertain: 0, claimLost: 0, invalid: 0, error: 0 };
  // Resend may log raw provider errors outside production. Stop before claiming work.
  if (process.env.NODE_ENV !== "production") {
    return { success: false, counts, code: "DELIVERY_REQUIRES_PRODUCTION_RUNTIME" };
  }
  let link: string;
  let resend: Resend;
  try {
    if (environment !== "production" && environment !== "test") throw new Error("ENVIRONMENT_INVALID");
    link = loginUrl(environment);
    if (!process.env.RESEND_API_KEY?.trim()) throw new Error("MISSING_PROVIDER_KEY");
    // Pin the provider origin; do not permit the SDK's optional environment override.
    resend = new Resend(process.env.RESEND_API_KEY, { baseUrl: "https://api.resend.com" });
  } catch { return { success: false, counts, code: "DELIVERY_CONFIGURATION_INVALID" }; }
  if (stopAt - Date.now() < READ_MS + SEND_MS + RESERVE_MS) {
    return { success: false, counts, code: "DELIVERY_BUDGET_EXHAUSTED" };
  }

  let claimed: unknown;
  try {
    const { data, error } = await readWithin(supabase.rpc("claim_continuity_email_events"));
    if (error) throw new Error("CLAIM_FAILED");
    claimed = data;
  } catch { return { success: false, counts, code: "CLAIM_FAILED" }; }
  if (!Array.isArray(claimed) || claimed.length > 25) return { success: false, counts, code: "INVALID_CLAIM_RESPONSE" };

  async function finish(event: Event, state: State, code: string | null, messageId?: string) {
    const attempts = typeof event.attempt_count === "number" && Number.isFinite(event.attempt_count)
      ? Math.max(1, Math.min(6, event.attempt_count)) : 1;
    const now = new Date().toISOString();
    try {
      const { data, error } = await supabase.from("continuity_email_outbox").update({
        delivery_status: state, claim_token: null, claimed_at: null, lease_expires_at: null,
        last_error: code, updated_at: now,
        ...(state === "sent" ? { provider_message_id: messageId, sent_at: now } : {}),
        ...(state === "pending" ? { available_at: new Date(Date.now() + Math.min(6 * 3600_000, 300_000 * 2 ** (attempts - 1))).toISOString() } : {}),
      }).eq("id", event.id).eq("delivery_status", "processing").eq("claim_token", event.claim_token).select("id").abortSignal(AbortSignal.timeout(2_000));
      if (error || !Array.isArray(data) || data.length > 1 || (data.length === 1 && data[0]?.id !== event.id)) counts.error++;
      else if (data.length === 0) counts.claimLost++;
      else counts[state]++;
    } catch { counts.error++; } // Unknown write result: never resend or requeue blindly.
  }

  async function check(event: Event): Promise<string | null> {
    const preliminary = cancellationCode(event, null);
    if (preliminary !== "CHECK_IN_MISSING") return preliminary;
    const { data, error } = await readWithin(supabase.from("check_ins")
      .select("user_id, enabled, status, response_deadline_at, next_check_in_at, missed_count")
      .eq("id", event.check_in_id).maybeSingle());
    if (error || (data !== null && !isRow(data))) throw new Error("CHECK_IN_READ_FAILED");
    return cancellationCode(event, data);
  }

  const seen = new Set<string>();
  for (const value of claimed) {
    if (stopAt - Date.now() < 2_000) {
      // Unprocessed leases recover to uncertain through the deployed claim RPC.
      counts.error++;
      break;
    }
    if (!isRow(value) || !isUuid(value.id) || !isUuid(value.claim_token)
      || value.delivery_status !== "processing" || seen.has(value.id)) { counts.invalid++; continue; }
    const event = value as Event;
    seen.add(event.id);
    let submitted = false;
    try {
      const lease = timestamp(event.lease_expires_at);
      if (lease === null || lease <= BigInt(Date.now()) * BigInt(1000)) {
        await finish(event, "uncertain", "CLAIM_EXPIRED_OR_INVALID"); continue;
      }
      if (stopAt - Date.now() < 4 * READ_MS + SEND_MS + RESERVE_MS) {
        await finish(event, "pending", "PRE_SEND_BUDGET_EXHAUSTED"); continue;
      }
      let stale = await check(event);
      if (stale) { await finish(event, stale === "CLAIM_EXPIRED_OR_INVALID" ? "uncertain" : "cancelled", stale); continue; }
      const { data, error } = await readWithin(supabase.auth.admin.getUserById(event.user_id as string));
      if (error) {
        await finish(event, error.code === "user_not_found" ? "failed" : "pending",
          error.code === "user_not_found" ? "AUTH_USER_MISSING" : "AUTH_LOOKUP_FAILED"); continue;
      }
      const user = data?.user;
      if (!user || user.id !== event.user_id || typeof user.email !== "string"
        || user.email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(user.email)) {
        await finish(event, "failed", "AUTH_RECIPIENT_INVALID"); continue;
      }
      const text = `Your ETERPAX Check-in\n\nPlease sign in to ETERPAX and select “I'm OK” on your Dashboard by ${event.response_deadline_at}.\n\nSign in: ${link}\n\nOpening this email or link does not confirm your Check-in.`;
      const { data: current, error: ownershipError } = await readWithin(supabase.from("continuity_email_outbox")
        .select("id, user_id, check_in_id, event_type, response_deadline_at, delivery_status, claim_token, lease_expires_at")
        .eq("id", event.id).eq("delivery_status", "processing").eq("claim_token", event.claim_token).maybeSingle());
      if (ownershipError) throw new Error("OWNERSHIP_READ_FAILED");
      if (!current) { counts.claimLost++; continue; }
      if (!isRow(current) || current.id !== event.id || current.claim_token !== event.claim_token || current.delivery_status !== "processing") {
        counts.claimLost++; continue;
      }
      if (current.user_id !== event.user_id || current.check_in_id !== event.check_in_id
        || current.event_type !== event.event_type || timestamp(current.response_deadline_at) !== timestamp(event.response_deadline_at)) {
        await finish(event, "cancelled", "EVENT_IDENTITY_CHANGED"); continue;
      }
      stale = await check(current as Event);
      if (stale) { await finish(event, stale === "CLAIM_EXPIRED_OR_INVALID" ? "uncertain" : "cancelled", stale); continue; }
      const remainingLease = timestamp(current.lease_expires_at)! - BigInt(Date.now()) * BigInt(1000);
      if (remainingLease < BigInt((SEND_MS + RESERVE_MS) * 1000) || stopAt - Date.now() < SEND_MS + RESERVE_MS) {
        await finish(event, "pending", "PRE_SEND_BUDGET_EXHAUSTED"); continue;
      }
      // 6.28.1 forwards request options to fetch, including signal. Its public
      // options type omits signal; use a structural extension, not a global patch.
      const options: Parameters<typeof resend.emails.send>[1] & { signal: AbortSignal } = {
        idempotencyKey: `eterpax:${environment}:check_in_request:${event.id}`,
        signal: AbortSignal.timeout(SEND_MS),
      };
      submitted = true;
      const result: unknown = await resend.emails.send({
        from: "ETERPAX <hello@eterpax.com>", to: user.email,
        subject: "Your ETERPAX Check-in", text,
      }, options);
      const outcome = providerOutcome(result);
      await finish(event, outcome.state, outcome.code, outcome.messageId);
    } catch {
      await finish(event, submitted ? "uncertain" : "pending", submitted ? "SEND_OUTCOME_UNKNOWN" : "PRE_SEND_READ_FAILED");
    }
  }
  return { success: counts.error + counts.invalid + counts.claimLost + counts.failed + counts.uncertain + counts.pending === 0, counts };
}
