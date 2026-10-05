import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET() {
  try {
    const { data, error } = await resend.emails.send({
      from: "ETERPAX <hello@eterpax.com>",
      to: ["jjgranados54@gmail.com"],
      subject: "You've been chosen as an ETERPAX Guardian",
      html: `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 24px;">
    <p style="font-size: 12px; letter-spacing: 2px; color: #0A7BA8; font-weight: 600;">
      ETERPAX
    </p>

    <h1 style="font-size: 28px; color: #102A43; font-weight: 500;">
      Luis, you've been chosen as a Guardian.
    </h1>

    <p style="font-size: 16px; line-height: 1.7; color: #52606D;">
      You've been selected to help ETERPAX confirm when it's time to protect and deliver someone's messages.
    </p>

    <p style="font-size: 16px; line-height: 1.7; color: #52606D;">
      Please confirm whether you're willing to serve as a Guardian.
    </p>

    <div style="margin-top: 32px;">
      <a
        href="http://localhost:3000/api/guardian-confirm?guardian=23c9c180-99d2-4cde-8038-9a4acd7ad96e&response=yes"
        style="display:inline-block; background:#0A7BA8; color:white; text-decoration:none; padding:12px 24px; border-radius:999px; margin-right:12px; font-weight:600;"
      >
        Yes, I accept
      </a>

      <a
        href="http://localhost:3000/api/guardian-confirm?guardian=23c9c180-99d2-4cde-8038-9a4acd7ad96e&response=no"
        style="display:inline-block; border:1px solid #CBD5E1; color:#52606D; text-decoration:none; padding:12px 24px; border-radius:999px; font-weight:600;"
      >
        No, I decline
      </a>
    </div>

    <p style="margin-top: 36px; font-size: 14px; line-height: 1.7; color:#7B8794;">
      Confidence is designed. Trust is earned. Continuity is intentional.
    </p>
  </div>
`,
    });

    if (error) {
      console.error("RESEND ERROR:", error);
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("RESEND TEST ERROR:", error);

    return NextResponse.json(
      { error: "Unable to send test email." },
      { status: 500 }
    );
  }
}