import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliveryClient } from './client';
import { digestToken, privateHeaders, siteOrigin, tokenPattern, uuidPattern } from './core';
import { decryptStoredBytes, decryptStoredText } from '@/lib/messages/decrypt-content';
export const cookieName = '__Secure-eterpax_recipient';
export function accessToken(request: Request) {
  const raw = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return raw && tokenPattern.test(raw) ? raw : null;
}
async function recipient(client: SupabaseClient, token: string | null) {
  if (!token || !tokenPattern.test(token)) return null;
  const result = await client.rpc('recipient_access', { p_digest: digestToken(token) });
  return !result.error && typeof result.data === 'string' && uuidPattern.test(result.data) ? result.data : null;
}
const unavailable = () => Response.json({ error: 'This private access is unavailable or expired. Reopen your original email link.' }, { status: 404, headers: privateHeaders });
export async function openRecipientSession(request: Request) {
  try {
    if (request.headers.get('origin') !== siteOrigin() || request.headers.get('content-type')?.split(';')[0] !== 'application/json') return unavailable();
    const reader = request.body?.getReader();
    if (!reader) return unavailable();
    let raw = '';
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        raw += new TextDecoder().decode(part.value);
        if (raw.length > 256) { await reader.cancel(); return unavailable(); }
      }
    } finally { reader.releaseLock(); }
    const payload = JSON.parse(raw);
    const client = deliveryClient();
    if (!await recipient(client, typeof payload.token === 'string' ? payload.token : null)) return unavailable();
    return Response.json({ success: true }, { headers: { ...privateHeaders,
      'Set-Cookie': `${cookieName}=${payload.token}; HttpOnly; Secure; SameSite=Strict; Path=/api/recipient; Max-Age=2592000` } });
  } catch { return unavailable(); }
}
export async function listRecipientMessages(request: Request) {
  try {
    const client = deliveryClient();
    const id = await recipient(client, accessToken(request));
    if (!id) return unavailable();
    const result = await client.from('message_release_items').select('id, message_release_assets(id,kind)').eq('recipient_id', id).order('id');
    if (result.error) return unavailable();
    return Response.json({ messages: result.data.map(item => ({ id: item.id, assets: item.message_release_assets })) }, { headers: privateHeaders });
  } catch { return unavailable(); }
}
type Row = Record<string, unknown>;
function encrypted(row: Row, prefix: string) {
  if (row[`${prefix}_encryption_version`] == null && row[`${prefix}_iv`] == null && row[`${prefix}_encrypted_key`] == null) return false;
  if (row[`${prefix}_encryption_version`] !== 'v1' || typeof row[`${prefix}_iv`] !== 'string' || typeof row[`${prefix}_encrypted_key`] !== 'string') throw new Error('Invalid encryption metadata');
  return true;
}
// Stream decrypted bytes, never a permanent/signed Storage URL. Avoid buffered
// platform response limits; memory remains bounded by the 100 MiB input limit.
function streamBytes(bytes: ArrayBuffer, start = 0, end = bytes.byteLength - 1) {
  const data = new Uint8Array(bytes, start, end - start + 1); let offset = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= data.length) { controller.close(); return; }
    controller.enqueue(data.subarray(offset, offset + 64 * 1024)); offset += 64 * 1024;
  } });
}
export async function readRecipientContent(request: Request) {
  try {
    const url = new URL(request.url); const itemId = url.searchParams.get('item'); const assetId = url.searchParams.get('asset');
    if (!itemId || !uuidPattern.test(itemId) || (assetId && !uuidPattern.test(assetId))) return unavailable();
    const client = deliveryClient(); const token = accessToken(request);
    const id = await recipient(client, token);
    if (!id) return unavailable();
    const item = await client.from('message_release_items').select('id,snapshot').eq('id', itemId).eq('recipient_id', id).maybeSingle();
    if (item.error || !item.data) return unavailable();
    if (!assetId) {
      const row = item.data.snapshot as Row;
      const body = typeof row.body === 'string' ? row.body : '';
      const text = encrypted(row, 'body') ? await decryptStoredText(body, row.body_iv as string, row.body_encrypted_key as string) : body;
      if (await recipient(client, token) !== id) return unavailable();
      return Response.json({ text }, { headers: privateHeaders });
    }
    const asset = await client.from('message_release_assets').select('kind,bucket,path,metadata').eq('id', assetId).eq('item_id', itemId).maybeSingle();
    if (asset.error || !asset.data) return unavailable();
    const { kind, bucket, path, metadata } = asset.data;
    // Storage metadata is checked before downloading to bound process memory.
    const info = await client.storage.from(bucket).info(path);
    if (info.error || !info.data || typeof info.data.size !== 'number' || !Number.isFinite(info.data.size) || info.data.size <= 0 || info.data.size > 100 * 1024 * 1024) return unavailable();
    const file = await client.storage.from(bucket).download(path);
    if (file.error || !file.data || file.data.size > 100 * 1024 * 1024) return unavailable();
    const data = await file.data.arrayBuffer(); const row = metadata as Row;
    const bytes = encrypted(row, kind) ? await decryptStoredBytes(data, row[`${kind}_iv`] as string, row[`${kind}_encrypted_key`] as string) : data;
    if (await recipient(client, token) !== id) return unavailable();
    // Download documents; only allow non-active media formats to render inline.
    const declared = row[`${kind}_mime_type`] ?? (kind === 'voice' ? 'audio/webm' : file.data.type);
    const safe = typeof declared === 'string' && /^(image\/(jpeg|png|webp|gif)|audio\/(webm|mpeg|mp4|ogg|wav)|video\/(webm|mp4|ogg))$/.test(declared);
    const mime = safe ? declared as string : 'application/octet-stream';
    const extensions: Record<string, string> = { 'application/pdf': '.pdf', 'text/plain': '.txt',
      'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
      'audio/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
      'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv' };
    const extension = typeof declared === 'string' && Object.hasOwn(extensions, declared) ? extensions[declared] : '.bin';
    let start = 0; let end = bytes.byteLength - 1;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...privateHeaders, 'Content-Range': `bytes */${bytes.byteLength}` } });
      if (!match[1]) start = Math.max(0, bytes.byteLength - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.byteLength) return new Response(null, { status: 416, headers: { ...privateHeaders, 'Content-Range': `bytes */${bytes.byteLength}` } });
    }
    return new Response(streamBytes(bytes, start, end), { status: range ? 206 : 200, headers: { ...privateHeaders, 'Content-Type': mime, 'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` } : {}),
      'Content-Disposition': `${safe && kind !== 'document' ? 'inline' : 'attachment'}; filename="${kind}-${assetId}${extension}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox" } });
  } catch { return unavailable(); }
}
