const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export async function encryptText(
  plaintext: string,
  key: CryptoKey
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoder.encode(plaintext)
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptText(
  ciphertext: string,
  iv: string,
  key: CryptoKey
) {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(iv),
    },
    key,
    base64ToBytes(ciphertext)
  );

  return decoder.decode(decrypted);
}
export async function importAesKey(
    keyBytes: Uint8Array
  ): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      new Uint8Array(keyBytes).buffer,
      {
        name: "AES-GCM",
      },
      false,
      ["encrypt", "decrypt"]
    );
  }
  export async function encryptBytes(
    data: ArrayBuffer,
    key: CryptoKey
  ) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
  
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      data
    );
  
    return {
      encryptedData: encrypted,
      iv: bytesToBase64(iv),
    };
  }

  export async function decryptBytes(
    encryptedData: ArrayBuffer,
    iv: string,
    key: CryptoKey
  ) {
    return crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(iv),
      },
      key,
      encryptedData
    );
  }