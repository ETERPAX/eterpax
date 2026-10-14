import type { SupabaseClient } from '@supabase/supabase-js';

export type LoadIssue = { asset: string; code: string };
type Row = Record<string, unknown>;
export type LoadedMessage = {
  id: string; recipient_name: string; recipient_email: string; body: string | null;
  status: string; created_at: string; document_path: string | null;
  document_url: null; voice_path: string | null; voice_url: string | null;
  video_urls: string[]; video_paths: string[]; photo_urls: string[]; photo_paths: string[];
  documents: { path: string; url: string }[]; issues: LoadIssue[];
};
const codes = new Set(['AUTH', 'RECORD', 'STORAGE', 'METADATA', 'KMS', 'AES', 'TIMEOUT', 'NETWORK', 'DECRYPT']);
export class MessageLoadError extends Error {
  constructor(public code: string) { super(code); }
}
export function loadErrorCode(error: unknown) {
  return error instanceof MessageLoadError && codes.has(error.code) ? error.code : 'NETWORK';
}
export function loadErrorText(code: string) {
  const messages: Record<string, string> = {
    AUTH: 'Please sign in again.', RECORD: 'The saved record could not be loaded.',
    STORAGE: 'The saved file could not be accessed.', METADATA: 'Encryption information is missing or unsupported.',
    KMS: 'The encryption key could not be unlocked.', AES: 'The encrypted content could not be verified.',
    TIMEOUT: 'Loading timed out. Please retry.', NETWORK: 'The request failed. Please retry.',
    DECRYPT: 'The content could not be decrypted.',
  };
  return messages[code] ?? messages.NETWORK;
}
// Bounds SDK operations as well as fetch/body reads; abort never becomes success.
export async function boundedLoad<T>(work: PromiseLike<T>, signal: AbortSignal, milliseconds = 20_000): Promise<T> {
  if (signal.aborted) throw new MessageLoadError('TIMEOUT');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      abort = () => reject(new MessageLoadError('TIMEOUT'));
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
export function encryptionState(row: Row, prefix: string): 'legacy' | 'encrypted' {
  const version = row[`${prefix}_encryption_version`];
  const iv = row[`${prefix}_iv`];
  const key = row[`${prefix}_encrypted_key`];
  if (version == null && iv == null && key == null) return 'legacy';
  if (version !== 'v1' || typeof iv !== 'string' || !iv.trim() || typeof key !== 'string' || !key.trim()) {
    throw new MessageLoadError('METADATA');
  }
  return 'encrypted';
}
const text = (value: unknown) => typeof value === 'string' ? value : '';

export async function loadMessage(client: SupabaseClient, id: string, signal: AbortSignal): Promise<LoadedMessage> {
  const auth = await boundedLoad(client.auth.getUser(), signal);
  if (auth.error || !auth.data.user) throw new MessageLoadError('AUTH');
  const owner = auth.data.user.id;
  const result = await boundedLoad(client.from('messages').select('*').eq('id', id).eq('user_id', owner).abortSignal(signal).maybeSingle(), signal);
  if (result.error || !result.data || result.data.user_id !== owner) throw new MessageLoadError('RECORD');
  const row: Row = result.data;
  const issues: LoadIssue[] = [];
  const capture = async <T>(asset: string, work: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await work(); }
    catch (error) { issues.push({ asset, code: loadErrorCode(error) }); return fallback; }
  };
  const request = async (payload: object, letter = false) => {
    const session = await boundedLoad(client.auth.getSession(), signal);
    if (session.error || !session.data.session) throw new MessageLoadError('AUTH');
    const response = await boundedLoad(fetch(letter ? '/api/decrypt-message' : '/api/decrypt-file', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${session.data.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), signal);
    if (!response.ok) {
      const detail = await boundedLoad(response.json().catch(() => ({})), signal);
      throw new MessageLoadError(response.status === 401 ? 'AUTH' : codes.has(detail.code) ? detail.code : response.status === 422 ? 'METADATA' : 'DECRYPT');
    }
    return response;
  };
  const assetUrl = async (asset: Row, prefix: string, bucket: string, pathField: string) => {
    const path = text(asset[pathField]);
    if (!path.trim()) throw new MessageLoadError('METADATA');
    if (encryptionState(asset, prefix) === 'legacy') {
      const signed = await boundedLoad(client.storage.from(bucket).createSignedUrl(path, 3600), signal);
      if (signed.error || !signed.data?.signedUrl) throw new MessageLoadError('STORAGE');
      return signed.data.signedUrl;
    }
    const pathArg = prefix === 'voice' ? {} : { [`${prefix}Path`]: path };
    const response = await request({ type: prefix, messageId: id, ...pathArg });
    const blob = await boundedLoad(response.blob(), signal);
    if (!blob.size) throw new MessageLoadError('DECRYPT');
    if (signal.aborted) throw new MessageLoadError('TIMEOUT');
    return URL.createObjectURL(blob);
  };
  const children = async (table: string, order: string) => {
    const res = await boundedLoad(client.from(table).select('*').eq('message_id', id).eq('user_id', owner).order(order, { ascending: true }).abortSignal(signal), signal);
    if (res.error || !Array.isArray(res.data)) throw new MessageLoadError('RECORD');
    return res.data as Row[];
  };
  const collection = async (label: string, table: string, prefix: string, bucket: string, field: string, order: string, legacy = false) => {
    return capture<{ path: string; url: string }[]>(label, async () => {
      const rows = await children(table, order);
      // A parent-column reference is independent of child rows. Never duplicate it.
      if (legacy && text(row[field]) && !rows.some(child => child[field] === row[field])) rows.push(row);
      const assets = await Promise.all(rows.map((asset, index) => capture<{ path: string; url: string } | null>(`${label} ${index + 1}`, async () => ({
        path: text(asset[field]), url: await assetUrl(asset, prefix, bucket, field),
      }), null)));
      return assets.filter((asset): asset is { path: string; url: string } => asset !== null);
    }, []);
  };
  const [body, voice, videos, photos, documents] = await Promise.all([
    capture<string | null>('Letter', async () => {
      if (encryptionState(row, 'body') === 'legacy') return text(row.body);
      const response = await request({ messageId: id }, true);
      const data = await boundedLoad(response.json(), signal);
      if (typeof data.plaintext !== 'string') throw new MessageLoadError('DECRYPT');
      return data.plaintext;
    }, null),
    capture<string | null>('Voice', async () => {
      // Even a missing path with encryption metadata is an error, not "no voice".
      const encrypted = encryptionState(row, 'voice') === 'encrypted';
      if (!text(row.voice_path) && !encrypted) return null;
      return assetUrl(row, 'voice', 'message-audio', 'voice_path');
    }, null),
    collection('Video', 'message_videos', 'video', 'message-videos', 'video_path', 'created_at', true),
    collection('Photo', 'message_photos', 'photo', 'message-photos', 'storage_path', 'sort_order'),
    collection('Document', 'message_documents', 'document', 'message-documents', 'document_path', 'created_at', true),
  ]);
  return {
    id, recipient_name: text(row.recipient_name), recipient_email: text(row.recipient_email), body,
    status: text(row.status), created_at: text(row.created_at), document_path: text(row.document_path) || null,
    document_url: null, voice_path: text(row.voice_path) || null, voice_url: voice,
    video_urls: videos.map(asset => asset.url), video_paths: videos.map(asset => asset.path),
    photo_urls: photos.map(asset => asset.url), photo_paths: photos.map(asset => asset.path), documents, issues,
  };
}
