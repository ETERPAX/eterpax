
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const CONFIRMATION = "AUTHORIZE EARLY IRREVERSIBLE RELEASE";

export async function POST(request: Request) {
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/i);

  if (!bearer) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${bearer[1]}`,
        },
      },
    }
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(bearer[1]);

  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const payload: unknown = await request.json().catch(() => null);

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }

  const body = payload as Record<string, unknown>;
  const escalationId = body.escalationId;
  const reason = body.reason;
  const confirmation = body.confirmation;

  if (
    typeof escalationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(escalationId) ||
    typeof reason !== "string" ||
    reason.trim().length < 10 ||
    reason.trim().length > 500 ||
    confirmation !== CONFIRMATION
  ) {
    return NextResponse.json(
      { error: "Invalid authorization details" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc(
    "authorize_release_acceleration",
    {
      p_escalation_id: escalationId,
      p_reason: reason.trim(),
      p_confirmation: confirmation,
    }
  );

  if (error) {
    return NextResponse.json(
      { error: "Authorization could not be registered" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    authorized: true,
    authorization_id: data,
  });
}

