/** Eligibility and deadlines originate in the authenticated SQL RPC, never the browser clock. */
export type ActivationEligibility = {
  status: "active" | "exempt_previous_subscriber" | "preparation" | "recovery" | "review_pending";
  evaluated_at: string;
  starts_at: string | null;
  preparation_ends_at: string | null;
  recovery_ends_at: string | null;
};

const isDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function parseActivationEligibility(value: unknown): ActivationEligibility {
  if (!value || typeof value !== "object") throw new Error("Invalid eligibility");
  const row = value as Record<string, unknown>;
  if (!["active", "exempt_previous_subscriber", "preparation", "recovery", "review_pending"].includes(String(row.status))
    || !isDate(row.evaluated_at)) throw new Error("Invalid eligibility");
  const exempt = row.status === "active" || row.status === "exempt_previous_subscriber";
  for (const key of ["starts_at", "preparation_ends_at", "recovery_ends_at"]) {
    if (exempt ? row[key] !== null : !isDate(row[key])) throw new Error("Invalid eligibility deadline");
  }
  return row as ActivationEligibility;
}

function formatDeadline(value: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }).format(new Date(value!)) + " UTC";
}

export function protectionPresentation(eligibility: ActivationEligibility) {
  switch (eligibility.status) {
    case "active":
      return { title: "Active", detail: "Your subscription is active.", deadline: "No preparation deadline applies." };
    case "exempt_previous_subscriber":
      return { title: "Not active", detail: "Your subscription history is outside this preparation policy.", deadline: "No preparation deadline applies." };
    case "preparation":
      return { title: "Preparation", detail: "Prepare your ETERPAX before activating protection.", deadline: `Preparation ends: ${formatDeadline(eligibility.preparation_ends_at)}` };
    case "recovery":
      return { title: "Recovery", detail: "Your preparation period has ended. You can still activate protection.", deadline: `Recovery ends: ${formatDeadline(eligibility.recovery_ends_at)}` };
    case "review_pending":
      return { title: "Review pending", detail: "Your recovery period has ended. No deletion is scheduled.", deadline: `Recovery ended: ${formatDeadline(eligibility.recovery_ends_at)}` };
  }
}
