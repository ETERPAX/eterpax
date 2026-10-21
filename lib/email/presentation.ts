/** Presentation only: never changes the plain-text payload or delivery metadata. */
export const emailTagline = "Confidence is designed. Trust is earned. Continuity is intentional.";

export function escapeEmailHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function emailFrame(content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><style>@media only screen and (max-width:620px){.email-outer{padding:16px 8px!important}.email-card{padding:24px 20px!important}}</style></head><body style="margin:0;padding:0;background:#f4f3ef;color:#071B2E;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f3ef"><tr><td class="email-outer" align="center" style="padding:32px 16px"><!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]--><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff"><tr><td class="email-card" style="padding:32px;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#071B2E;overflow-wrap:anywhere;word-wrap:break-word"><p style="margin:0 0 28px;letter-spacing:6px;font-size:24px;line-height:1.4;color:#071B2E">ETERPAX</p>${content}<p style="margin:32px 0 0;padding-top:24px;border-top:1px solid #e5e4e0;font-size:13px;line-height:1.7;color:#071B2E">${emailTagline}</p></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

function action(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;max-width:100%"><tr><td bgcolor="#071B2E" style="background:#071B2E;mso-padding-alt:16px"><a href="${escapeEmailHtml(url)}" style="display:inline-block;padding:16px;color:#ffffff;background:#071B2E;font-family:Arial,sans-serif;font-size:16px;line-height:1.5;text-decoration:none;word-break:break-word">${escapeEmailHtml(label)}</a></td></tr></table>`;
}

export function emailTextBody(text: string): string {
  return text.split(/\n\n/).map((paragraph, index) => {
    const lines = paragraph.split('\n').filter(line => line !== 'ETERPAX' && line !== emailTagline);
    if (!lines.length) return '';
    const value = lines.join('\n');
    // Only a complete action paragraph becomes a button. The URL is used verbatim.
    const link = /^([^\n]+?:)[ \n]+(https?:\/\/\S+)$/.exec(value);
    if (link) return action(link[1].replace(/:$/, ""), link[2]);
    const content = lines.map(line => escapeEmailHtml(line).replace(/https?:\/\/[^\s<]+/g,
      url => `<a href="${url}" style="color:#071B2E;text-decoration:underline;word-break:break-all">${url}</a>`)).join('<br>');
    const heading = (index === 0 && !value.startsWith('Hello ')) || value === 'A moment of trust. A request for your help.';
    return heading ? `<h1 style="margin:0 0 24px;color:#071B2E;font-size:22px;line-height:1.5">${content}</h1>`
      : `<p style="margin:0 0 20px">${content}</p>`;
  }).join('');
}

/** Format only existing deadline text nodes, never attributes, URLs or plain text. */
export function readableEmailDates(html: string): string {
  return html.split(/(<[^>]*>)/g).map(part => {
    if (part.startsWith("<")) return part;
    return part.replace(/(by |expires on |Deadline \(UTC\): )(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?))/g,
      (original: string, prefix: string, timestamp: string) => {
        const normalized = timestamp.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
        const date = new Date(normalized);
        if (!Number.isFinite(date.getTime())) return original;
        const readable = new Intl.DateTimeFormat("en-US", {
          timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
          hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
        }).format(date);
        return `${prefix}${readable} UTC`;
      });
  }).join("");
}

export function withEmailPresentation<T extends { text: string; html?: string }>(email: T): T & { html: string } {
  return { ...email, html: emailFrame(readableEmailDates(email.html ?? emailTextBody(email.text))) };
}
