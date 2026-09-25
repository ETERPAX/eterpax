import "server-only";

import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from "@aws-sdk/client-kms";

const region = process.env.AWS_REGION;
const keyId = process.env.AWS_KMS_KEY_ID;

if (!region || !keyId) {
  throw new Error("Missing AWS KMS environment variables");
}

export const kmsClient = new KMSClient({
  region,
});

export { GenerateDataKeyCommand, DecryptCommand };

export const KMS_KEY_ID = keyId;
export async function generateDataKey() {
    
    const command = new GenerateDataKeyCommand({
      KeyId: KMS_KEY_ID,
      KeySpec: "AES_256",
    });
    
  
    const response = await kmsClient.send(command);
  
    if (!response.Plaintext || !response.CiphertextBlob) {
      throw new Error("AWS KMS did not return a complete data key");
    }
    return {
        plaintextKey: response.Plaintext,
        encryptedKey: response.CiphertextBlob,
      };
    }
    export async function decryptDataKey(encryptedKey: Uint8Array) {
        const command = new DecryptCommand({
          CiphertextBlob: encryptedKey,
          KeyId: KMS_KEY_ID,
        });
      
        const response = await kmsClient.send(command);
      
        if (!response.Plaintext) {
          throw new Error("AWS KMS did not return the decrypted data key");
        }
      
        return response.Plaintext;
      }
    
  
    