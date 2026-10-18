import "server-only";
import { guardianVerificationQuestion } from "./guardian-verification-config";

export function escapeVerificationHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}

export function guardianVerificationContent() {
  const copy = guardianVerificationQuestion();
  if (copy.negative !== "No, the owner is okay" || !copy.question.includes("[Owner's Name]")) {
    throw new Error("GUARDIAN_VERIFICATION_CONTENT_NOT_APPROVED");
  }
  return { version: 1, ...copy };
}

export function guardianVerificationContractHtml(): string {
  return `<meta name="guardian-verification-content" content="${escapeVerificationHtml(JSON.stringify(guardianVerificationContent()))}">`;
}

export function guardianVerificationChoiceHtml(decision: "positive" | "negative"): string {
  const copy = guardianVerificationContent();
  return `<label><input type="radio" name="decision" value="${decision}" required> ${escapeVerificationHtml(copy[decision])}</label>`;
}

// Deliberately strict serialization: missing, duplicate or changed contracts fail closed.
export function verifyGuardianVerificationContent(html: string): void {
  if ((html.match(/name="guardian-verification-content"/g) ?? []).length !== 1
    || !html.includes(guardianVerificationContractHtml())
    || (html.match(/type="radio"/g) ?? []).length !== 2
    || !html.includes(guardianVerificationChoiceHtml("positive"))
    || !html.includes(guardianVerificationChoiceHtml("negative"))) {
    throw new Error("deployed copy mismatch");
  }
}
