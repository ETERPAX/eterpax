import "server-only";
import { createHash, randomBytes } from "node:crypto";

export const GUARDIAN_VERIFICATION_FROM =
  "ETERPAX <hello@eterpax.com>";

export const GUARDIAN_VERIFICATION_SUBJECT =
  "ETERPAX — Guardian Verification Request";

export function createGuardianVerificationToken(): {
  token: string;
  digest: Buffer;
} {
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token, "utf8").digest();

  return { token, digest };
}

export function createGuardianVerificationEmail(input: {
  recipientName: string;
  ownerName: string;
  verificationUrl: string;
}): {
  subject: string;
  text: string;
} {
  const clean = (name: string) => name.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim().slice(0, 254);
  const recipientName = clean(input.recipientName);
  const ownerName = clean(input.ownerName);
  const { verificationUrl } = input;

  if (!recipientName.trim() || !ownerName.trim()) {
    throw new Error("GUARDIAN_VERIFICATION_NAME_REQUIRED");
  }

  const url = new URL(verificationUrl);
  if (url.protocol !== "https:" || !url.hostname) {
    throw new Error("GUARDIAN_VERIFICATION_HTTPS_REQUIRED");
  }

  return {
    subject: GUARDIAN_VERIFICATION_SUBJECT,
    text: [
      `Hello ${recipientName},`,
      "",
      "A moment of trust. A request for your help.",
      "",
      `${ownerName} selected you as an ETERPAX Guardian.`,
      "We are asking you to review an important continuity verification request.",
      "",
      "Please respond only if you have reliable information.",
      "",
      "Review Guardian Verification:",
      verificationUrl,
      "",
      "If you are unable to confirm the situation, please do not guess.",
      "",
      "ETERPAX",
      "Confidence is designed. Trust is earned. Continuity is intentional.",
    ].join("\n"),
  };
}
