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
    if (payload && typeof payload === "object" && "type" in payload && payload.type === "photo") {
      return decryptPhoto(request);
    }
    if (payload && typeof payload === "object" && "type" in payload && payload.type === "video") {
      return decryptVideo(request);
    }
    return decryptVoice(request);
  }
  return NextResponse.json(
    { error: "Unsupported media type. Use application/json." },
    { status: 415 }
  );
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

async function decryptPhoto(request: Request) {
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
      !("type" in payload) || payload.type !== "photo" ||
      !("messageId" in payload) || typeof payload.messageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.messageId) ||
      !("photoPath" in payload) || typeof payload.photoPath !== "string" || !payload.photoPath.trim() ||
      Object.keys(payload).some((key) => !["type", "messageId", "photoPath"].includes(key)) ||
      request.headers.has("X-Encryption-IV") || request.headers.has("X-Encrypted-Key")
    ) {
      return NextResponse.json({ error: "Invalid photo request" }, { status: 400 });
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

    const { data: photo, error: photoError } = await supabase
      .from("message_photos")
      .select("message_id, user_id, storage_path, photo_iv, photo_encrypted_key, photo_encryption_version, photo_mime_type")
      .eq("message_id", message.id)
      .eq("storage_path", payload.photoPath)
      .eq("user_id", user.id)
      .maybeSingle();
    if (photoError) {
      return NextResponse.json({ error: "Unable to load photo" }, { status: 500 });
    }
    if (!photo || photo.user_id !== user.id || photo.message_id !== message.id || photo.storage_path !== payload.photoPath) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }
    if (
      photo.photo_encryption_version !== "v1" ||
      typeof photo.photo_iv !== "string" || !photo.photo_iv.trim() ||
      typeof photo.photo_encrypted_key !== "string" || !photo.photo_encrypted_key.trim()
    ) {
      return NextResponse.json({ error: "Invalid encrypted photo data" }, { status: 422 });
    }

    const { data: encryptedPhoto, error: downloadError } = await supabase.storage
      .from("message-photos")
      .download(photo.storage_path);
    if (downloadError || !encryptedPhoto || encryptedPhoto.size === 0) {
      return NextResponse.json({ error: "Unable to load photo file" }, { status: 500 });
    }

    const plaintextKey = await decryptDataKey(Buffer.from(photo.photo_encrypted_key, "base64"));
    const aesKey = await importAesKey(plaintextKey);
    const plaintext = await decryptBytes(await encryptedPhoto.arrayBuffer(), photo.photo_iv, aesKey);
    return new Response(plaintext, {
      headers: {
        "Content-Type": typeof photo.photo_mime_type === "string" &&
          /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(photo.photo_mime_type.trim())
          ? photo.photo_mime_type.trim() : "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to decrypt photo" }, { status: 500 });
  }
}

async function decryptVideo(request: Request) {
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
      !("type" in payload) || payload.type !== "video" ||
      !("messageId" in payload) || typeof payload.messageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.messageId) ||
      Object.keys(payload).some((key) => !["type", "messageId"].includes(key)) ||
      request.headers.has("X-Encryption-IV") || request.headers.has("X-Encrypted-Key")
    ) {
      return NextResponse.json({ error: "Invalid video request" }, { status: 400 });
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

    const { data: video, error: videoError } = await supabase
      .from("message_videos")
      .select("message_id, user_id, video_path, video_iv, video_encrypted_key, video_encryption_version, video_mime_type")
      .eq("message_id", message.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (videoError) {
      return NextResponse.json({ error: "Unable to load video" }, { status: 500 });
    }
    if (!video || video.user_id !== user.id || video.message_id !== message.id) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    if (
      typeof video.video_path !== "string" || !video.video_path.trim() ||
      video.video_encryption_version !== "v1" ||
      typeof video.video_iv !== "string" || !video.video_iv.trim() ||
      typeof video.video_encrypted_key !== "string" || !video.video_encrypted_key.trim()
    ) {
      return NextResponse.json({ error: "Invalid encrypted video data" }, { status: 422 });
    }

    const { data: encryptedVideo, error: downloadError } = await supabase.storage
      .from("message-videos")
      .download(video.video_path);
    if (downloadError || !encryptedVideo || encryptedVideo.size === 0) {
      return NextResponse.json({ error: "Unable to load video file" }, { status: 500 });
    }

    const plaintextKey = await decryptDataKey(Buffer.from(video.video_encrypted_key, "base64"));
    const aesKey = await importAesKey(plaintextKey);
    const plaintext = await decryptBytes(await encryptedVideo.arrayBuffer(), video.video_iv, aesKey);
    return new Response(plaintext, {
      headers: {
        "Content-Type": typeof video.video_mime_type === "string" &&
          /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(video.video_mime_type.trim())
          ? video.video_mime_type.trim() : "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to decrypt video" }, { status: 500 });
  }
}
