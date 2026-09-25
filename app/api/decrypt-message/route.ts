import { NextResponse } from "next/server";
import { decryptDataKey } from "@/lib/kms";
import { importAesKey, decryptText } from "@/lib/encryption";
export async function POST(request: Request) {
    try {
      const { ciphertext, iv, encryptedKey } = await request.json();
      if (
        typeof ciphertext !== "string" ||
        typeof iv !== "string" ||
        typeof encryptedKey !== "string"
      ) {
        return NextResponse.json(
          { error: "Invalid encrypted message data" },
          { status: 400 }
        );
      }
      const encryptedKeyBytes = Buffer.from(encryptedKey, "base64");
      const plaintextKey = await decryptDataKey(encryptedKeyBytes);
      const aesKey = await importAesKey(plaintextKey);
      const plaintext = await decryptText(ciphertext, iv, aesKey);
      return NextResponse.json({
        plaintext,
      });
    } catch (error) {
      console.error("Message decryption failed:", error);
  
      return NextResponse.json(
        { error: "Unable to decrypt message" },
        { status: 500 }
      );
    }
  }