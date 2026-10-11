import "server-only";

type DeliveryOutcome = "accepted" | "rejected" | "uncertain";

type FinalizeInput = {
  attemptId: string;
  claimId: string;
  outcome: DeliveryOutcome;
  providerMessageId?: string;
};

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, string | null>
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export async function finalizeGuardianVerificationAttempt(
  supabase: RpcClient,
  input: FinalizeInput
) {
  if (!input.attemptId || !input.claimId) {
    throw new Error("GUARDIAN_VERIFICATION_FINALIZE_INVALID");
  }

  if (
    input.outcome === "accepted"
      ? !input.providerMessageId?.trim()
      : Boolean(input.providerMessageId)
  ) {
    throw new Error("GUARDIAN_VERIFICATION_PROVIDER_EVIDENCE_INVALID");
  }

  const { data, error } = await supabase.rpc(
    "finalize_guardian_verification_attempt",
    {
      p_attempt_id: input.attemptId,
      p_claim_id: input.claimId,
      p_outcome: input.outcome,
      p_provider_message_id:
        input.outcome === "accepted"
          ? input.providerMessageId!.trim()
          : null,
    }
  );

  if (error) {
    throw new Error("GUARDIAN_VERIFICATION_FINALIZE_RPC_FAILED");
  }

  if (typeof data !== "string" || !["already_finalized", "uncertain", "reconciliation_required", "rejected", "accepted_window_started", "accepted", "accepted_history_only"].includes(data)) {
    throw new Error("GUARDIAN_VERIFICATION_FINALIZE_INVALID_RESPONSE");
  }

  return { outcome: data };
}
