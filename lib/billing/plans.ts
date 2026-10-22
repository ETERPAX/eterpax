export const plans = {
  monthly: { name: "Monthly", amount: 499, price: "$4.99", period: "USD/month", description: "Renews monthly until canceled." },
  annual: { name: "Annual", amount: 4999, price: "$49.99", period: "USD/year", description: "Renews annually until canceled." },
  lifetime: { name: "Founder's Lifetime", amount: 9999, price: "$99.99", period: "USD one-time", description: "Permanent access. No renewal. Limited to 2,000 users." },
} as const;
export type Plan = keyof typeof plans;
export function parsePlan(value: unknown): Plan {
  if (value === undefined) return "monthly"; // Existing callers send no body.
  if (value === "monthly" || value === "annual" || value === "lifetime") return value;
  throw new Error("Invalid plan");
}
