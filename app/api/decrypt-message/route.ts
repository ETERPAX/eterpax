import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decryptStoredText, decryptionFailure } from "@/lib/messages/decrypt-content";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer (\S+)$/i);
  if (!bearer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Keep the database read subject to this caller's RLS policies.
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
      !payload || typeof payload !== "object" || !("messageId" in payload) ||
      typeof payload.messageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.messageId)
    ) {
      return NextResponse.json({ error: "Invalid message ID" }, { status: 400 });
    }

    const { data: message, error } = await supabase
      .from("messages")
      .select("user_id, body, body_iv, body_encrypted_key, body_encryption_version")
      .eq("id", payload.messageId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Unable to load message", code: "RECORD" }, { status: 500 });
    }
    if (!message || message.user_id !== user.id) {
      return NextResponse.json({ error: "Message not found", code: "RECORD" }, { status: 404 });
    }
    if (
      message.body_encryption_version !== "v1" ||
      typeof message.body !== "string" || !message.body ||
      typeof message.body_iv !== "string" || !message.body_iv ||
      typeof message.body_encrypted_key !== "string" || !message.body_encrypted_key
    ) {
      return NextResponse.json({ error: "Invalid encrypted message data", code: "METADATA" }, { status: 422 });
    }

    const plaintext = await decryptStoredText(message.body, message.body_iv, message.body_encrypted_key);
    return NextResponse.json({ plaintext }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(decryptionFailure(error), { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
