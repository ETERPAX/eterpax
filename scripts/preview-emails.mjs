// Offline only. Reads actual templates; does not contact a provider or database.
import { mkdirSync, writeFileSync } from 'node:fs';
import { emailFixtures } from '../tests/helpers/email-fixtures.mjs';
import { presentation } from '../tests/helpers/email-presentation.mjs';
const directory = new URL('../previews/emails/', import.meta.url);
mkdirSync(directory, { recursive: true });
const links = [];
for (const [name, email] of Object.entries(emailFixtures())) {
  const rendered = email.html?.startsWith('<!doctype html>') ? email : presentation.withEmailPresentation(email);
  writeFileSync(new URL(`${name}.html`, directory), rendered.html);
  writeFileSync(new URL(`${name}.txt`, directory), `Subject: ${email.subject}\n\n${email.text}`);
  links.push(`<li><a href="${name}.html">${presentation.escapeEmailHtml(email.subject)}</a> · <a href="${name}.txt">Plain text</a></li>`);
}
writeFileSync(new URL('index.html', directory), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ETERPAX email previews</title><body style="font:16px/1.6 Arial;padding:32px;background:#f4f3ef;color:#071B2E"><h1>ETERPAX email previews</h1><p>Fictional data only. Links use example.invalid and cannot access ETERPAX.</p><ul>${links.join('')}</ul></body></html>`);
console.log('Generated six HTML and plain-text previews in previews/emails/');
