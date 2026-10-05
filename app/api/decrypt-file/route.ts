import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptDataKey } from "@/lib/kms";
import { importAesKey, decryptBytes } from "@/lib/encryption";

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json") {
    const payload: unknown = await request.clone().json().catch(() => null);
    if (payload && typeof payload === "object" && "type" in payload && payload.type === "document") {
      return decryptDocument(request);
    }
    return decryptVoice(request);
  }
  // Temporary compatibility for legacy photo/video callers.
  // This binary branch cannot distinguish attachment types and remains unauthenticated.
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

async function decryptVoice(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i);
  if (!bearer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${bearer[1]}` } },
      }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(bearer[1]);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload: unknown = await request.json().catch(() => null);
    if (
      !payload || typeof payload !== "object" || Array.isArray(payload) ||
      !("type" in payload) || payload.type !== "voice" ||
      !("messageId" in payload) || typeof payload.messageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.messageId) ||
      Object.keys(payload).some((key) => key !== "type" && key !== "messageId") ||
      request.headers.has("X-Encryption-IV") || request.headers.has("X-Encrypted-Key")
    ) {
      return NextResponse.json({ error: "Invalid voice request" }, { status: 400 });
    }

    const { data: message, error } = await supabase
      .from("messages")
      .select("user_id, voice_path, voice_iv, voice_encrypted_key, voice_encryption_version")
      .eq("id", payload.messageId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: "Unable to load message" }, { status: 500 });
    }
    if (!message || message.user_id !== user.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (
      message.voice_encryption_version !== "v1" ||
      typeof message.voice_path !== "string" || !message.voice_path ||
      typeof message.voice_iv !== "string" || !message.voice_iv ||
      typeof message.voice_encrypted_key !== "string" || !message.voice_encrypted_key
    ) {
      return NextResponse.json({ error: "Invalid encrypted voice data" }, { status: 422 });
    }

    // Storage uses the same verified user's bearer token and existing policies.
    const { data: encryptedVoice, error: downloadError } = await supabase.storage
      .from("message-audio")
      .download(message.voice_path);
    if (downloadError || !encryptedVoice || encryptedVoice.size === 0) {
      return NextResponse.json({ error: "Unable to load voice file" }, { status: 500 });
    }

    const plaintextKey = await decryptDataKey(Buffer.from(message.voice_encrypted_key, "base64"));
    const aesKey = await importAesKey(plaintextKey);
    const plaintext = await decryptBytes(await encryptedVoice.arrayBuffer(), message.voice_iv, aesKey);
    return new Response(plaintext, {
      headers: { "Content-Type": "audio/webm", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Unable to decrypt voice" }, { status: 500 });
  }
}

async function decryptDocument(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i);
  if (!bearer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${bearer[1]}` } },
      }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(bearer[1]);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload: unknown = await request.json().catch(() => null);
    if (
      !payload || typeof payload !== "object" || Array.isArray(payload) ||
      !("type" in payload) || payload.type !== "document" ||
      !("messageId" in payload) || typeof payload.messageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.messageId) ||
      !("documentPath" in payload) || typeof payload.documentPath !== "string" || !payload.documentPath.trim() ||
      Object.keys(payload).some((key) => !["type", "messageId", "documentPath"].includes(key)) ||
      request.headers.has("X-Encryption-IV") || request.headers.has("X-Encrypted-Key")
    ) {
      return NextResponse.json({ error: "Invalid document request" }, { status: 400 });
    }

    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id, user_id")
      .eq("id", payload.messageId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (messageError) {
      return NextResponse.json({ error: "Unable to load message" }, { status: 500 });
    }
    if (!message || message.id !== payload.messageId || message.user_id !== user.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const { data: document, error: documentError } = await supabase
      .from("message_documents")
      .select("message_id, user_id, document_path, document_iv, document_encrypted_key, document_encryption_version, document_mime_type")
      .eq("message_id", message.id)
      .eq("document_path", payload.documentPath)
      .eq("user_id", user.id)
      .maybeSingle();
    if (documentError) {
      return NextResponse.json({ error: "Unable to load document" }, { status: 500 });
    }
    if (!document || document.user_id !== user.id || document.message_id !== message.id || document.document_path !== payload.documentPath) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (
      document.document_encryption_version !== "v1" ||
      typeof document.document_iv !== "string" || !document.document_iv ||
      typeof document.document_encrypted_key !== "string" || !document.document_encrypted_key
    ) {
      return NextResponse.json({ error: "Invalid encrypted document data" }, { status: 422 });
    }

    const { data: encryptedDocument, error: downloadError } = await supabase.storage
      .from("message-documents")
      .download(document.document_path);
    if (downloadError || !encryptedDocument || encryptedDocument.size === 0) {
      return NextResponse.json({ error: "Unable to load document file" }, { status: 500 });
    }

    const plaintextKey = await decryptDataKey(Buffer.from(document.document_encrypted_key, "base64"));
    const aesKey = await importAesKey(plaintextKey);
    const plaintext = await decryptBytes(await encryptedDocument.arrayBuffer(), document.document_iv, aesKey);
    return new Response(plaintext, {
      headers: {
        "Content-Type": typeof document.document_mime_type === "string" && document.document_mime_type.trim()
          ? document.document_mime_type : "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to decrypt document" }, { status: 500 });
  }
}