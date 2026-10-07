import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const guardianColumns = "id, name, email, relationship";

export function guardianAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authenticateOwner(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i);
  if (!bearer) return null;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser(bearer[1]);
  return error ? null : user;
}

export function confirmationEmail(displayName: unknown) {
  // Plain text only; never insert names into HTML or headers.
  const name = typeof displayName === "string" && displayName.trim()
    ? displayName.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100)
    : "An ETERPAX member";
  return {
    subject: "You have been chosen as an ETERPAX Guardian",
    text: `${name} has chosen you as one of their ETERPAX Guardians.\n\nBeing chosen as a Guardian means that ${name} trusts you to help protect the continuity of their ETERPAX plan.\n\nAs a Guardian, you will never have access to their private messages, photos, documents, voice recordings, or videos.\n\nIf ETERPAX is ever unable to confirm their well-being through regular check-ins, you will be contacted with clear instructions on what to do next.\n\nFor now, there is nothing you need to do.\n\nThis message simply confirms the trust ${name} has placed in you.\n\nConfidence is designed. Trust is earned. Continuity is intentional.\n\nETERPAX`,
  };
}

// Provider text can echo recipients, names or credentials. Only known diagnostic
// literals are allowed; never log raw errors, stacks, causes or response objects.
function logGuardianSendFailure(notificationId: string, category: string, error?: unknown) {
  try {
    const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const allowedNames = new Set([
      "invalid_idempotency_key", "validation_error", "missing_api_key", "restricted_api_key",
      "invalid_api_key", "not_found", "method_not_allowed", "invalid_idempotent_request",
      "concurrent_idempotent_requests", "invalid_attachment", "invalid_from_address",
      "invalid_access", "invalid_parameter", "invalid_region", "missing_required_field",
      "monthly_quota_exceeded", "daily_quota_exceeded", "rate_limit_exceeded", "security_error",
      "application_error", "internal_server_error", "Error", "TypeError", "SyntaxError",
      "AbortError", "TimeoutError",
    ]);
    const allowedMessages = new Set([
      "fetch failed", "Invalid API key", "API key is invalid", "Missing API key",
      "The operation was aborted.", "The operation was aborted due to timeout",
    ]);
    console.error("Guardian notification send failure", {
      notificationId, category,
      name: typeof detail.name === "string" && allowedNames.has(detail.name) ? detail.name : "unrecognized_or_absent",
      ...(typeof detail.statusCode === "number" && Number.isInteger(detail.statusCode)
        && detail.statusCode >= 400 && detail.statusCode <= 599 ? { status: detail.statusCode } : {}),
      ...(typeof detail.message === "string" && allowedMessages.has(detail.message) ? { message: detail.message } : {}),
    });
  } catch { /* Diagnostics must never interrupt notification finalization. */ }
}

/** No automatic resend after a provider attempt: ambiguous outcomes need review.
 * Durable claims survive crashes/retries; idempotency is an additional safeguard.
 * Called only after an authenticated save or verified Stripe webhook.
 */
export async function sendGuardianConfirmations(admin: SupabaseClient, userId: string): Promise<boolean> {
  // Match the existing worker: the SDK can log raw provider errors in development.
  if (process.env.NODE_ENV !== "production" || !process.env.RESEND_API_KEY?.trim()) return false;
  const { data: { user }, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !user || user.id !== userId) return false;
  const email = confirmationEmail(user.user_metadata?.firstName ?? user.user_metadata?.display_name);
  const { data, error } = await admin.rpc("claim_guardian_notifications", { p_user_id: userId });
  if (error || !Array.isArray(data) || data.length > 6) return false;
  const resend = new Resend(process.env.RESEND_API_KEY, { baseUrl: "https://api.resend.com" });
  const results = await Promise.all(data.map(async (row: { id: string; email: string }) => {
    let status = "uncertain";
    let providerId: string | null = null;
    try {
      const options: Parameters<typeof resend.emails.send>[1] & { signal: AbortSignal } = {
        idempotencyKey: `guardian-confirmation:${row.id}`, signal: AbortSignal.timeout(10_000),
      };
      const result = await resend.emails.send({ from: "ETERPAX <hello@eterpax.com>", to: row.email, ...email }, options);
      if (!result.error && result.data?.id) { status = "sent"; providerId = result.data.id; }
      else if (result.error) logGuardianSendFailure(row.id, "provider_error", result.error);
      else logGuardianSendFailure(row.id, "missing_provider_id");
      // Even an error may be ambiguous; never automatically retry an attempted send.
    } catch (error) { logGuardianSendFailure(row.id, "send_exception", error); }
    const { data: finished, error: finishError } = await admin.from("guardian_notifications").update({
      status, provider_message_id: providerId, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
    }).eq("id", row.id).eq("user_id", userId).eq("status", "sending").select("id");
    return !finishError && finished?.length === 1 && status === "sent";
  }));
  return results.every(Boolean);
}
