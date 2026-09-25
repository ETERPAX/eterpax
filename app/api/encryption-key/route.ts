import { NextResponse } from "next/server";
import { generateDataKey } from "@/lib/kms";
import { importAesKey, encryptText, encryptBytes } from "@/lib/encryption";
export async function POST(request: Request) {
    try {
        const { plaintext } = await request.json();
        if (typeof plaintext !== "string") {
            return NextResponse.json(
              { error: "Invalid plaintext" },
              { status: 400 }
            );
          }
      const { plaintextKey, encryptedKey } = await generateDataKey();
      const aesKey = await importAesKey(plaintextKey);
      const encryptedBody = await encryptText(plaintext, aesKey);
      const encryptedKeyBase64 = Buffer.from(encryptedKey).toString("base64");
      return NextResponse.json({
        ciphertext: encryptedBody.ciphertext,
        iv: encryptedBody.iv,
        encryptedKey: encryptedKeyBase64,
      });
    } catch (error) {
      console.error("Encryption key generation failed:", error);
      return NextResponse.json(
        { error: "Unable to generate encryption key" },
        { status: 500 }
      );
    }
  }