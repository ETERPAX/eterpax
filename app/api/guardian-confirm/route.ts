import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

export async function GET(request: NextRequest) {
  const guardianId = request.nextUrl.searchParams.get("guardian");
  const response = request.nextUrl.searchParams.get("response");

  if (!guardianId) {
    return NextResponse.json(
      { error: "Guardian ID is required." },
      { status: 400 }
    );
  }

  const { data: guardian, error } = await supabaseAdmin
    .from("guardians")
    .select("id, name, email, relationship, status")
    .eq("id", guardianId)
    .maybeSingle();

  if (error) {
    console.error("GUARDIAN LOOKUP ERROR:", error);

    return NextResponse.json(
      { error: "Could not load Guardian." },
      { status: 500 }
    );
  }

  if (!guardian) {
    return NextResponse.json(
      { error: "Guardian not found." },
      { status: 404 }
    );
  }
  if (response && !["yes", "no"].includes(response)) {
    return NextResponse.json(
      { error: "Invalid Guardian response." },
      { status: 400 }
    );
  }
  if (response === "yes") {
    const { error: updateError } = await supabaseAdmin
      .from("guardians")
      .update({ status: "confirmed" })
      .eq("id", guardianId);
  
    if (updateError) {
      console.error("GUARDIAN UPDATE ERROR:", updateError);
  
      return NextResponse.json(
        { error: "Could not confirm Guardian." },
        { status: 500 }
      );
    }
  }
  if (response === "no") {
    const { error: updateError } = await supabaseAdmin
      .from("guardians")
      .update({ status: "declined" })
      .eq("id", guardianId);
  
    if (updateError) {
      console.error("GUARDIAN UPDATE ERROR:", updateError);
  
      return NextResponse.json(
        { error: "Could not decline Guardian." },
        { status: 500 }
      );
    }
  }
  const title =
  response === "yes"
    ? `Thank you, ${guardian.name}.`
    : response === "no"
      ? `Thank you, ${guardian.name}.`
      : `Hello, ${guardian.name}.`;

const message =
  response === "yes"
    ? "Your Guardian response has been confirmed."
    : response === "no"
      ? "Your Guardian response has been recorded."
      : "Your Guardian invitation is ready.";

return new NextResponse(
  `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>ETERPAX Guardian</title>
    </head>

    <body style="margin:0; background:#F7F5F0; font-family:Arial,sans-serif;">
      <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;">
        <div style="width:100%; max-width:560px; background:white; border-radius:24px; padding:48px; text-align:center; box-shadow:0 10px 30px rgba(15,44,67,0.08);">

          <p style="margin:0 0 24px; font-size:12px; letter-spacing:2px; color:#0A7BA8; font-weight:600;">
            ETERPAX
          </p>

          <h1 style="margin:0 0 18px; font-size:30px; color:#102A43; font-weight:500;">
            ${title}
          </h1>

          <p style="margin:0; font-size:17px; line-height:1.7; color:#52606D;">
            ${message}
          </p>

          <p style="margin:36px 0 0; font-size:14px; line-height:1.7; color:#7B8794;">
            Confidence is designed. Trust is earned. Continuity is intentional.
          </p>

        </div>
      </div>
    </body>
  </html>`,
  {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  }
);
}