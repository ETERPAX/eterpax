import { emailFrame, emailTagline, escapeEmailHtml } from "../email/presentation";

export const WELCOME_DASHBOARD_URL = "https://www.eterpax.com/dashboard";
export function welcomeEmail(firstName: string) {
  const name = firstName.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim().slice(0, 254);
  if (!name) throw new Error("WELCOME_NAME_REQUIRED");
  const paragraphs = [
    `Dear ${name},`,
    "Welcome to ETERPAX.",
    "You've taken the first step toward preserving what matters most.",
    "ETERPAX gives you a private space to create meaningful messages, choose the people who matter to you, and establish a continuity plan for the future.",
    "Your account is ready.",
  ];
  const closing = "Take your time. Your story is yours to tell.";
  const text = [...paragraphs, `GO TO MY DASHBOARD\n${WELCOME_DASHBOARD_URL}`, closing, emailTagline, "The ETERPAX Team"].join("\n\n");
  const body = paragraphs.map((paragraph, index) => index === 1
    ? `<h1 style="margin:0 0 24px;color:#071B2E;font-size:22px;line-height:1.5">${escapeEmailHtml(paragraph)}</h1>`
    : `<p style="margin:0 0 20px">${escapeEmailHtml(paragraph)}</p>`).join("")
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px"><tr><td bgcolor="#071B2E" style="background:#071B2E;mso-padding-alt:16px"><a href="${WELCOME_DASHBOARD_URL}" style="display:inline-block;padding:16px;background:#071B2E;color:#ffffff;font-family:Arial,sans-serif;font-size:16px;line-height:1.5;text-decoration:none">GO TO MY DASHBOARD</a></td></tr></table><p style="margin:0 0 20px">${closing}</p>`;
  const html = emailFrame(body).replace(`${emailTagline}</p>`, `${emailTagline}<br><br>The ETERPAX Team</p>`);
  return { subject: "Welcome to ETERPAX", text, html };
}
