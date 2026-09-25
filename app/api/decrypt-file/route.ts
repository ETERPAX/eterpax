import { NextResponse } from "next/server";
import { decryptDataKey } from "@/lib/kms";
import { importAesKey, decryptBytes } from "@/lib/encryption";

export async function POST(request: Request) {
  try {
    const encryptedData = await request.arrayBuffer();

    const iv = request.headers.get("X-Encryption-IV");
    const encryptedKey = request.headers.get("X-Encrypted-Key");
    console.log("DECRYPT FILE METADATA:", {
      hasIv: Boolean(iv),
      hasEncryptedKey: Boolean(encryptedKey),
      encryptedBytes: encryptedData.byteLength,
    });

    if (!iv || !encryptedKey) {
      return NextResponse.json(
        { error: "Missing encryption metadata" },
        { status: 400 }
      );
    }

    if (encryptedData.byteLength === 0) {
      return NextResponse.json(
        { error: "Empty encrypted file data" },
        { status: 400 }
      );
    }

    const encryptedKeyBytes = Buffer.from(
      encryptedKey,
      "base64"
    );

    const plaintextKey = await decryptDataKey(
      encryptedKeyBytes
    );

    const aesKey = await importAesKey(plaintextKey);

    const decryptedData = await decryptBytes(
      encryptedData,
      iv,
      aesKey
    );

    return new Response(decryptedData, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });
  } catch (error) {
    console.error("File decryption failed:", error);

    return NextResponse.json(
      { error: "Unable to decrypt file" },
      { status: 500 }
    );
  }
}