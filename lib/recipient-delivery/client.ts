import 'server-only';
import { createClient } from '@supabase/supabase-js';
export function deliveryClient() {
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const url = new URL(origin ?? '');
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || !key?.trim()) throw new Error('Invalid delivery configuration');
  return createClient(origin!, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error',
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) }) } });
}
