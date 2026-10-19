import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const digestToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newAccessToken = () => randomBytes(32).toString('base64url');
export function secretMatches(header: string | null, secret: string | undefined) {
  return !!secret && secret.length >= 32 && !!header && timingSafeEqual(
    createHash('sha256').update(header).digest(), createHash('sha256').update(`Bearer ${secret}`).digest());
}
export function siteOrigin() {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '');
  if (url.protocol !== 'https:' || url.origin !== process.env.NEXT_PUBLIC_SITE_URL || url.username || url.password) throw new Error('Invalid origin');
  return url.origin;
}
export type SendOutcome = 'accepted' | 'failed' | 'uncertain';
export function classifySend(value: unknown): { outcome: SendOutcome; providerId: string | null } {
  if (!value || typeof value !== 'object') return { outcome: 'uncertain', providerId: null };
  const row = value as { data?: { id?: unknown } | null; error?: { name?: unknown; statusCode?: unknown } | null };
  if (row.error === null && typeof row.data?.id === 'string' && uuidPattern.test(row.data.id)) return { outcome: 'accepted', providerId: row.data.id };
  // Only an explicit documented rejection is conclusive. HTTP 5xx/timeouts are unknown.
  const rejected: Record<string, number[]> = { validation_error: [400, 403, 422], missing_api_key: [401], invalid_api_key: [401, 403],
    restricted_api_key: [401, 403], invalid_from_address: [400, 422], rate_limit_exceeded: [429], daily_quota_exceeded: [429], monthly_quota_exceeded: [429] };
  if (row.data === null && typeof row.error?.name === 'string' && typeof row.error.statusCode === 'number'
    && Object.hasOwn(rejected, row.error.name) && rejected[row.error.name].includes(row.error.statusCode)) return { outcome: 'failed', providerId: null };
  return { outcome: 'uncertain', providerId: null };
}
export const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
