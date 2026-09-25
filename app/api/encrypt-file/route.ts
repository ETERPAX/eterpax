import { NextResponse } from "next/server";
import { generateDataKey } from "@/lib/kms";
import { importAesKey, encryptBytes } from "@/lib/encryption";

export async function POST(request: Request) {
  try {
    const fileData = await request.arrayBuffer();

    if (fileData.byteLength === 0) {
      return NextResponse.json(
        { error: "Empty file data" },
        { status: 400 }
      );
    }

    const { plaintextKey, encryptedKey } = await generateDataKey();

    const aesKey = await importAesKey(plaintextKey);

    const { encryptedData, iv } = await encryptBytes(
      fileData,
      aesKey
    );

    const encryptedKeyBase64 =
      Buffer.from(encryptedKey).toString("base64");

    return new Response(encryptedData, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Encryption-IV": iv,
        "X-Encrypted-Key": encryptedKeyBase64,
        "X-Encryption-Version": "v1",
      },
    });
  } catch (error) {
    console.error("File encryption failed:", error);

    return NextResponse.json(
      { error: "Unable to encrypt file" },
      { status: 500 }
    );
  }
}