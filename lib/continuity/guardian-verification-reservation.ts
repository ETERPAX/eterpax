import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { GUARDIAN_VERIFICATION_FROM } from "./guardian-verification-email";

type ReserveInput = {
  escalationId: string;
  guardianId: string;
  tokenDigest: Buffer;
  recipientEmail: string;
  subject: string;
  emailText: string;
};

export function createGuardianVerificationReservation(input: ReserveInput) {
  if (
    !input.escalationId ||
    !input.guardianId ||
    input.tokenDigest.length !== 32 ||
    !input.recipientEmail.trim() ||
    !input.subject.trim() ||
    !input.emailText.trim()
  ) {
    throw new Error("GUARDIAN_VERIFICATION_RESERVATION_INVALID");
  }

  const emissionId = randomUUID();
  const attemptId = randomUUID();
  const claimId = randomUUID();

  const payload = JSON.stringify([
    GUARDIAN_VERIFICATION_FROM,
    input.recipientEmail.trim().toLowerCase(),
    input.subject,
    input.emailText,
  ]);

  const payloadDigest = createHash("sha256")
    .update(payload, "utf8")
    .digest("hex");

  return {
    emissionId,
    attemptId,
    claimId,
    rpcName: "reserve_guardian_verification_initial" as const,
    rpcArguments: {
      p_escalation_id: input.escalationId,
      p_source_guardian_id: input.guardianId,
      p_emission_id: emissionId,
      p_attempt_id: attemptId,
      p_claim_id: claimId,
      p_token_digest: "\\x" + input.tokenDigest.toString("hex"),
      p_payload_digest: "\\x" + payloadDigest,
    },
  };
}
