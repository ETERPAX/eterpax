import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET() {
  try {
    const { data, error } = await resend.emails.send({
      from: "ETERPAX <hello@eterpax.com>",
      to: ["jjgranados54@gmail.com"],
      subject: "Your first message from ETERPAX",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 24px;">
          <p style="font-size: 12px; letter-spacing: 2px; color: #0A7BA8; font-weight: 600;">
            ETERPAX
          </p>

          <h1 style="font-size: 28px; color: #102A43; font-weight: 500;">
            ETERPAX email delivery is live.
          </h1>

          <p style="font-size: 16px; line-height: 1.7; color: #52606D;">
            This is the first controlled email sent from the ETERPAX platform.
          </p>

          <p style="font-size: 16px; line-height: 1.7; color: #52606D;">
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