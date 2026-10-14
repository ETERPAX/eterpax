import 'server-only';
import { decryptDataKey } from '@/lib/kms';
import { importAesKey, decryptBytes, decryptText } from '@/lib/encryption';

class ContentError extends Error {
  constructor(public code: 'METADATA' | 'KMS' | 'AES', public reason = 'UNCLASSIFIED') { super(code); }
}
const reasons = new Set(['AccessDeniedException', 'IncorrectKeyException', 'InvalidCiphertextException',
  'NotFoundException', 'DisabledException', 'KMSInvalidStateException', 'CredentialsProviderError',
  'TimeoutError', 'OperationError', 'DataError']);
const reasonOf = (error: unknown) => error instanceof Error && reasons.has(error.name) ? error.name : 'UNCLASSIFIED';
function validateBase64(value: string, size?: number, key = false) {
  // Retain the existing decoders' whitespace/unpadded-base64 compatibility.
  const normalized = value.replace(/\s/g, '');
  const alphabet = key ? /^[A-Za-z0-9+/_-]+={0,2}$/ : /^[A-Za-z0-9+/]+={0,2}$/;
  if (!normalized || !alphabet.test(normalized) || normalized.replace(/=+$/, '').length % 4 === 1 ||
      (size !== undefined && Buffer.from(value, 'base64').length !== size)) {
    throw new ContentError('METADATA');
  }
}
async function keyFor(iv: string, encryptedKey: string) {
  validateBase64(iv, 12);
  validateBase64(encryptedKey, undefined, true);
  let key: Uint8Array;
  try { key = await decryptDataKey(Buffer.from(encryptedKey, 'base64')); }
  catch (error) { throw new ContentError('KMS', reasonOf(error)); }
  try { return await importAesKey(key); }
  catch (error) { throw new ContentError('AES', reasonOf(error)); }
}
export async function decryptStoredBytes(data: ArrayBuffer, iv: string, encryptedKey: string) {
  const key = await keyFor(iv, encryptedKey);
  try { return await decryptBytes(data, iv, key); }
  catch (error) { throw new ContentError('AES', reasonOf(error)); }
}
export async function decryptStoredText(data: string, iv: string, encryptedKey: string) {
  validateBase64(data);
  const key = await keyFor(iv, encryptedKey);
  try { return await decryptText(data, iv, key); }
  catch (error) { throw new ContentError('AES', reasonOf(error)); }
}
export function decryptionFailure(error: unknown) {
  const code = error instanceof ContentError ? error.code : 'DECRYPT';
  // Never log payloads, user IDs, object paths, keys, provider messages or stacks.
  console.error('Message decryption failed', { stage: code, reason: error instanceof ContentError ? error.reason : 'UNCLASSIFIED' });
  return { error: 'Unable to decrypt content', code };
}
