import "server-only";

import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from "@aws-sdk/client-kms";

let cachedClient: { region: string; client: KMSClient } | undefined;

function getKms() {
  const region = process.env.AWS_REGION;
  const keyId = process.env.AWS_KMS_KEY_ID;

  // Validate on every operation, including after the client has been cached.
  if (!region?.trim() || !keyId?.trim()) {
    throw new Error("Missing AWS KMS environment variables");
  }

  if (!cachedClient || cachedClient.region !== region) {
    cachedClient = { region, client: new KMSClient({ region }) };
  }
  return { client: cachedClient.client, keyId };
}

export async function generateDataKey() {
  const { client, keyId } = getKms();
  const command = new GenerateDataKeyCommand({
    KeyId: keyId,
    KeySpec: "AES_256",
  });
  const response = await client.send(command);

  if (!response.Plaintext || !response.CiphertextBlob) {
    throw new Error("AWS KMS did not return a complete data key");
  }
  return {
    plaintextKey: response.Plaintext,
    encryptedKey: response.CiphertextBlob,
  };
}

export async function decryptDataKey(encryptedKey: Uint8Array) {
  const { client, keyId } = getKms();
  const command = new DecryptCommand({
    CiphertextBlob: encryptedKey,
    KeyId: keyId,
  });
  const response = await client.send(command);

  if (!response.Plaintext) {
    throw new Error("AWS KMS did not return the decrypted data key");
  }
  return response.Plaintext;
}
