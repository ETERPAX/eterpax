import { createHash } from "node:crypto";

/** 192 random bits; only the digest crosses the database boundary. */
export function promotionDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!/^EPX-[0-9A-F]{48}$/.test(normalized)) return null;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
