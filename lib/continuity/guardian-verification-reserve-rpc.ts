import "server-only";

import {
  createGuardianVerificationReservation,
} from "./guardian-verification-reservation";

type ReservationInput = Parameters<
  typeof createGuardianVerificationReservation
>[0];

type ReservationRow = {
  outcome: string;
  emission_id: string;
  attempt_id: string;
  claim_id: string;
  lease_expires_at: string | null;
  token_expires_at: string | null;
  recipient_email: string | null;
};

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, string>
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export async function reserveGuardianVerification(
  supabase: RpcClient,
  input: ReservationInput
) {
  const reservation =
    createGuardianVerificationReservation(input);

  const { data, error } = await supabase.rpc(
    reservation.rpcName,
    reservation.rpcArguments
  );

  if (error) {
    throw new Error("GUARDIAN_VERIFICATION_RESERVATION_RPC_FAILED");
  }

  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error("GUARDIAN_VERIFICATION_RESERVATION_INVALID_RESPONSE");
  }

  const row = data[0] as ReservationRow;
  if (!row || typeof row !== "object" || typeof row.outcome !== "string"
    || !["reserved", "already_reserved", "ineligible", "emission_exists", "dispatch_expired"].includes(row.outcome)) {
    throw new Error("GUARDIAN_VERIFICATION_RESERVATION_INVALID_RESPONSE");
  }

  if (
    row.outcome !== "reserved" ||
    row.emission_id !== reservation.emissionId ||
    row.attempt_id !== reservation.attemptId ||
    row.claim_id !== reservation.claimId ||
    !row.lease_expires_at || !Number.isFinite(Date.parse(row.lease_expires_at)) ||
    !row.token_expires_at || !Number.isFinite(Date.parse(row.token_expires_at)) ||
    !row.recipient_email ||
    row.recipient_email.trim().toLowerCase() !==
      input.recipientEmail.trim().toLowerCase()
  ) {
    return {
      authorized: false as const,
      outcome: row.outcome,
    };
  }

  return {
    authorized: true as const,
    emissionId: reservation.emissionId,
    attemptId: reservation.attemptId,
    claimId: reservation.claimId,
    leaseExpiresAt: row.lease_expires_at,
    tokenExpiresAt: row.token_expires_at,
    recipientEmail: row.recipient_email,
  };
}
