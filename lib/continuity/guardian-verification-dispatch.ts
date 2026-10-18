import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGuardianVerificationToken, createGuardianVerificationEmail } from "./guardian-verification-email";
import { reserveGuardianVerification } from "./guardian-verification-reserve-rpc";
import { finalizeGuardianVerificationAttempt } from "./guardian-verification-finalize-rpc";
import { sendGuardianVerificationEmail } from "./guardian-verification-resend";

import { guardianVerificationOrigin, guardianVerificationQuestion } from "./guardian-verification-config";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-only, one initial emission. Never returned: token, URL, recipient or body.
 * The caller supplies the already authenticated, pinned service client.
 * No automatic requeue/replacement, including after lost reservation/finalization.
 */
export async function dispatchInitialGuardianVerification(
  supabase: SupabaseClient,
  input: { escalationId: string; guardianId: string; environment: "test" | "production" },
  stopAt = Date.now() + 30_000,
): Promise<{ outcome: string }> {
  if (process.env.GUARDIAN_VERIFICATION_EMAIL_ENABLED !== "true") return { outcome: "disabled" };
  if (process.env.GUARDIAN_VERIFICATION_RESPONSE_ENABLED !== "true"
    || process.env.NODE_ENV !== "production" || !process.env.RESEND_API_KEY?.trim()) return { outcome: "configuration_error" };
  if (!uuid.test(input.escalationId) || !uuid.test(input.guardianId)
    || !["test", "production"].includes(input.environment)) return { outcome: "invalid_input" };
  let origin: string;
  try { origin = guardianVerificationOrigin(); guardianVerificationQuestion(); }
  catch { return { outcome: "configuration_error" }; }
  let reservation: Awaited<ReturnType<typeof reserveGuardianVerification>> | undefined;
  // Bound all database requests; abort does NOT imply remote rollback.
  const rpcClient = { rpc: (name: string, args: Record<string, string | null>) =>
    supabase.rpc(name, args).abortSignal(AbortSignal.timeout(Math.max(1, Math.min(5_000, stopAt - Date.now())))) };
  try {
    if (stopAt - Date.now() < 20_000) return { outcome: "budget_exhausted" };
    const { data: participant, error } = await supabase.from("guardian_escalation_participants")
      .select("name,email").eq("escalation_id", input.escalationId)
      .eq("source_guardian_id", input.guardianId).abortSignal(AbortSignal.timeout(5_000)).maybeSingle();
    if (error || !participant || typeof participant.name !== "string" || typeof participant.email !== "string") {
      return { outcome: "snapshot_unavailable" };
    }
    // Resolve identity from the escalation, never from caller-supplied names or IDs.
    const { data: escalation, error: escalationError } = await supabase.from("guardian_escalations")
      .select("user_id").eq("id", input.escalationId)
      .abortSignal(AbortSignal.timeout(5_000)).maybeSingle();
    if (escalationError || !escalation || typeof escalation.user_id !== "string"
      || !uuid.test(escalation.user_id)) return { outcome: "owner_unavailable" };
    const { data: { user: owner }, error: ownerError } = await supabase.auth.admin.getUserById(escalation.user_id);
    if (ownerError || !owner || owner.id !== escalation.user_id) return { outcome: "owner_unavailable" };
    const ownerName = owner.user_metadata?.firstName ?? owner.user_metadata?.display_name;
    if (typeof ownerName !== "string" || !ownerName.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim()) {
      return { outcome: "owner_name_unavailable" };
    }
    const { token, digest } = createGuardianVerificationToken();
    // Fragment never reaches HTTP/access logs. The page removes it immediately.
    const verificationUrl = `${origin}/guardian-verification#token=${token}`;
    const email = createGuardianVerificationEmail({ recipientName: participant.name,
      ownerName, verificationUrl });
    reservation = await reserveGuardianVerification(rpcClient, {
      escalationId: input.escalationId, guardianId: input.guardianId, tokenDigest: digest,
      recipientEmail: participant.email, subject: email.subject, emailText: email.text,
    });
    if (!reservation.authorized) return { outcome: reservation.outcome };
    // Check DB clock, generation, cancellation, token and claim under parent locks.
    const checked = await rpcClient.rpc("check_guardian_verification_dispatch", {
      p_attempt_id: reservation.attemptId, p_claim_id: reservation.claimId,
    });
    if (checked.error || checked.data !== true || stopAt - Date.now() < 15_000
      || Date.parse(reservation.leaseExpiresAt) <= Date.now() + 15_000) {
      await finalizeGuardianVerificationAttempt(rpcClient, { attemptId: reservation.attemptId,
        claimId: reservation.claimId, outcome: "uncertain" });
      return { outcome: "not_sent_blocked" };
    }
    const result = await sendGuardianVerificationEmail({ apiKey: process.env.RESEND_API_KEY!,
      environment: input.environment, emissionId: reservation.emissionId,
      recipientEmail: reservation.recipientEmail, ...email });
    // Never send again because finalization failed. A future operator may reconcile.
    const final = await finalizeGuardianVerificationAttempt(rpcClient, {
      attemptId: reservation.attemptId, claimId: reservation.claimId, outcome: result.outcome,
      providerMessageId: result.providerMessageId ?? undefined,
    });
    return { outcome: final.outcome };
  } catch {
    // Leases survive crashes; no raw provider text/credentials/URL is logged.
    return { outcome: reservation?.authorized ? "finalization_uncertain" : "reservation_uncertain" };
  }
}

/** Separate opt-in; manual sending never requires enabling this automatic path. */
export async function deliverPendingGuardianVerifications(
  supabase: SupabaseClient, environment: "test" | "production", stopAt: number,
) {
  if (process.env.GUARDIAN_VERIFICATION_AUTOMATIC_ENABLED !== "true"
    || process.env.GUARDIAN_VERIFICATION_EMAIL_ENABLED !== "true") return { outcome: "disabled" };
  if (stopAt - Date.now() < 25_000) return { outcome: "budget_exhausted" };
  try {
    const { data, error } = await supabase.rpc("list_guardian_verification_initial_candidates", {})
      .abortSignal(AbortSignal.timeout(5_000));
    if (error || !Array.isArray(data) || data.length > 1) return { outcome: "selection_failed" };
    if (!data.length) return { outcome: "idle" };
    return await dispatchInitialGuardianVerification(supabase, {
      escalationId: data[0].escalation_id, guardianId: data[0].source_guardian_id, environment,
    }, stopAt);
  } catch { return { outcome: "selection_failed" }; }
}
