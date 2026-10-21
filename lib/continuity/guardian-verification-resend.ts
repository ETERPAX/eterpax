import { withEmailPresentation } from "../email/presentation";
import "server-only";

import { Resend } from "resend";
import { GUARDIAN_VERIFICATION_FROM } from "./guardian-verification-email";

type SendInput = {
  apiKey: string;
  environment: "test" | "production";
  emissionId: string;
  recipientEmail: string;
  subject: string;
  text: string;
};

export async function sendGuardianVerificationEmail(input: SendInput) {
  if (process.env.GUARDIAN_VERIFICATION_EMAIL_ENABLED !== "true") {
    throw new Error("GUARDIAN_VERIFICATION_SEND_DISABLED");
  }
  // The installed SDK may log provider payloads in a development runtime.
  if (process.env.NODE_ENV !== "production") {
    throw new Error("GUARDIAN_VERIFICATION_RUNTIME_DISABLED");
  }
  if (
    !input.apiKey.trim() ||
    !input.emissionId.trim() ||
    !input.recipientEmail.trim() ||
    !input.subject.trim() ||
    !input.text.trim()
  ) {
    throw new Error("GUARDIAN_VERIFICATION_SEND_INVALID");
  }

  const resend = new Resend(input.apiKey, {
    baseUrl: "https://api.resend.com",
  });

  const options: Parameters<typeof resend.emails.send>[1] & {
    signal: AbortSignal;
  } = {
    idempotencyKey:
      `eterpax:${input.environment}:guardian_verification_initial:${input.emissionId}`,
    signal: AbortSignal.timeout(10_000),
  };

  try {
    const result = await resend.emails.send(
      withEmailPresentation({
        from: GUARDIAN_VERIFICATION_FROM,
        to: input.recipientEmail,
        subject: input.subject,
        text: input.text,
      }),
      options
    );

    if (result.error) {
      return {
        outcome: "uncertain" as const,
        providerMessageId: null,
      };
    }

    if (!result.data?.id) {
      return {
        outcome: "uncertain" as const,
        providerMessageId: null,
      };
    }

    return {
      outcome: "accepted" as const,
      providerMessageId: result.data.id,
    };
  } catch {
    return {
      outcome: "uncertain" as const,
      providerMessageId: null,
    };
  }
}
