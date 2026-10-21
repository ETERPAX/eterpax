import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { presentation } from './helpers/email-presentation.mjs';
import { emailFixtures, parse, ts } from './helpers/email-fixtures.mjs';

// Compare against the precise Production baseline, allowing only presentation changes.
function withoutPresentation(source) {
  const result = ts.transform(source, [context => {
    const visit = node => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === '../email/presentation') return undefined;
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'withEmailPresentation') return ts.visitNode(node.arguments[0], visit);
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'html') return ts.factory.updatePropertyAssignment(node, node.name, ts.factory.createStringLiteral('HTML_PRESENTATION'));
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
  const printed = ts.createPrinter({ removeComments: true }).printFile(result.transformed[0]);
  result.dispose();
  return printed;
}
test('unchanged continuity and recipient emitters preserve their Production contracts', () => {
  for (const file of ['lib/continuity/email.ts', 'lib/continuity/guardian-verification-resend.ts', 'lib/recipient-delivery/worker.ts']) {
    const baseline = execFileSync('git', ['show', `ab0a6b6589589c4ab13043e71239d1d45622f641:${file}`], { encoding: 'utf8' });
    assert.equal(withoutPresentation(parse(file)), withoutPresentation(parse(file, baseline)), file);
  }
});
for (const [name, email] of Object.entries(emailFixtures())) {
  test(`${name}: institutional frame, unchanged text, and exact action URL`, () => {
    const input = { ...email, to: 'fictional@example.invalid', from: 'ETERPAX <hello@eterpax.com>' };
    const output = input.html?.startsWith('<!doctype html>') ? input : presentation.withEmailPresentation(input);
    for (const key of ['subject', 'text', 'to', 'from']) assert.equal(output[key], input[key]);
    for (const style of ['#f4f3ef', '#071B2E', 'max-width:600px', 'Arial', 'if mso', 'max-width:620px']) assert(output.html.includes(style));
    assert.equal(output.html.split(presentation.emailTagline).length - 1, 1);
    for (const url of email.text.match(/https?:\/\/\S+/g) ?? []) assert(output.html.includes(`href="${presentation.escapeEmailHtml(url)}"`));
    assert(!output.html.includes('undefined'));
  });
}
test('untrusted names and URL attributes are escaped without changing plaintext', () => {
  const text = 'Hello <img src=x onerror=alert(1)> & "Morgan",\n\nReview:\nhttps://example.invalid/path?a=1&b=2#token=FAKE';
  const output = presentation.withEmailPresentation({ text });
  assert.equal(output.text, text);
  assert(!output.html.includes('<img'));
  assert(output.html.includes('&lt;img'));
  assert(output.html.includes('href="https://example.invalid/path?a=1&amp;b=2#token=FAKE"'));
});
test('Safety Window HTML retains every original word and interpolation', () => {
  const file = 'lib/continuity/email.ts';
  const baseline = execFileSync('git', ['show', `ab0a6b6589589c4ab13043e71239d1d45622f641:${file}`], { encoding: 'utf8' });
  const htmlCopy = source => {
    let html;
    const visit = node => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'html') html = node.initializer.getText(source);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return html.slice(1, -1).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  assert.equal('ETERPAX ' + htmlCopy(parse(file)), htmlCopy(parse(file, baseline)));
});
test('approved button labels omit only the trailing colon in HTML', () => {
  for (const label of ['Sign in', 'Review Guardian Verification', 'Open your private collection']) {
    const text = `${label}:\nhttps://example.invalid/action#FAKE`;
    const output = presentation.withEmailPresentation({ text });
    assert(output.html.includes(`>${label}</a>`));
    assert.equal(output.text, text);
  }
});
test('readable deadlines use UTC, preserve instants across offsets and leave links and plaintext intact', () => {
  const dates = [
    ['2030-01-02T12:00:00.000Z', 'January 2, 2030 at 12:00:00 PM UTC'],
    ['2030-01-02T23:30:00-08:00', 'January 3, 2030 at 7:30:00 AM UTC'],
    ['2030-01-02 12:00:00.123456+00', 'January 2, 2030 at 12:00:00 PM UTC'],
  ];
  for (const [timestamp, readable] of dates) {
    for (const prefix of ['by ', 'expires on ', 'Deadline (UTC): ']) {
      const text = `${prefix}${timestamp}.`;
      const output = presentation.withEmailPresentation({ text });
      assert(output.html.includes(readable), output.html);
      assert.equal(output.text, text);
    }
    const html = `<a href="https://example.invalid/?deadline=${timestamp}">Deadline (UTC): ${timestamp}</a>`;
    const rendered = presentation.readableEmailDates(html);
    assert(rendered.includes(`href="https://example.invalid/?deadline=${timestamp}"`));
    assert(rendered.includes(readable));
  }
  assert.equal(presentation.readableEmailDates('<p>by 2030-99-99T12:00:00Z</p>'), '<p>by 2030-99-99T12:00:00Z</p>');
});
test('all three dated previews show readable UTC deadlines', () => {
  for (const name of ['check-in', 'safety-window', 'recipient-delivery']) {
    const email = emailFixtures()[name];
    const result = presentation.withEmailPresentation(email);
    assert.match(result.html, /January \d+, 2030 at 12:00:00 PM UTC/);
    assert.equal(result.text, email.text);
  }
});
