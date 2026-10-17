import "server-only";

export function guardianVerificationOrigin(): string {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("GUARDIAN_VERIFICATION_ORIGIN_INVALID");
  }
  return url.origin;
}

// Text must be supplied from the approved voting contract; never infer what
// a positive vote means from an owner's missed check-ins.
export function guardianVerificationQuestion() {
  const question = process.env.GUARDIAN_VERIFICATION_QUESTION?.trim();
  const positive = process.env.GUARDIAN_VERIFICATION_POSITIVE_LABEL?.trim();
  const negative = process.env.GUARDIAN_VERIFICATION_NEGATIVE_LABEL?.trim();
  if (!question || !positive || !negative || positive === negative
    || question.length > 1000 || positive.length > 300 || negative.length > 300) {
    throw new Error("GUARDIAN_VERIFICATION_RESPONSE_COPY_REQUIRED");
  }
  return { question, positive, negative };
}

// Identity copy is deliberately separate from dispatch/voting configuration.
export function guardianVerificationIdentityQuestion(firstName: unknown): string {
  const { question } = guardianVerificationQuestion();
  if (typeof firstName !== "string" || !firstName.trim() || firstName.length > 200
    || /[\p{Cc}\p{Cf}]/u.test(firstName) || !/\p{L}/u.test(firstName)
    || !question.includes("[Owner's Name]")) {
    throw new Error("GUARDIAN_VERIFICATION_IDENTITY_UNAVAILABLE");
  }
  return question.replaceAll("[Owner's Name]", () => firstName);
}
