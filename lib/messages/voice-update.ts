type Replacement = {
  voice_path: string | null;
  voice_iv: string | null;
  voice_encrypted_key: string | null;
  voice_encryption_version: string | null;
};
// Omit untouched fields entirely: the original database values remain exact.
export function voiceUpdate(replacement: Replacement | null, removed: boolean) {
  if (replacement) {
    if (!replacement.voice_path?.trim() || !replacement.voice_iv?.trim() ||
        !replacement.voice_encrypted_key?.trim() || replacement.voice_encryption_version !== 'v1') {
      throw new Error('Unable to prepare the replacement voice recording.');
    }
    return replacement;
  }
  if (removed) return { voice_path: null, voice_iv: null, voice_encrypted_key: null, voice_encryption_version: null };
  return {};
}
export function editReady(messageId: string | null, loadedId: string | null, loading: boolean, error: string) {
  return !messageId || (loadedId === messageId && !loading && !error);
}
