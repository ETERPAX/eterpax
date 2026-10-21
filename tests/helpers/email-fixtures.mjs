import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { presentation } from './email-presentation.mjs';
const require = createRequire(import.meta.url);
export const ts = require('typescript');
export const root = new URL('../../', import.meta.url);
export function parse(file, source = readFileSync(new URL(file, root), 'utf8')) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
function evaluate(node, context) {
  return vm.runInNewContext(`(${node.getText()})`, context);
}
function variable(source, name, context) {
  return evaluate(find(source, node => ts.isVariableDeclaration(node) && node.name.getText() === name).initializer, context);
}
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { module: 1, target: 7 } }).outputText,
    { exports, URL, require(name) { if (name === '../email/presentation') return presentation; return name.startsWith('node:') ? require(name) : {}; } });
  return exports;
}
export function emailFixtures() {
  const source = parse('lib/continuity/email.ts');
  const context = { event: { response_deadline_at: '2030-01-02T12:00:00.000Z' }, link: 'https://example.invalid/login', escape: presentation.escapeEmailHtml };
  for (const name of ['heading', 'button', 'safetyText']) context[name] = variable(source, name, context);
  const html = find(source, node => ts.isPropertyAssignment(node) && node.name.getText() === 'html').initializer;
  const subject = find(source, node => ts.isPropertyAssignment(node) && node.name.getText() === 'subject').initializer;
  const continuity = safety => {
    const scope = { ...context, safety };
    return { subject: evaluate(subject, scope), text: variable(source, 'text', scope), ...(safety ? { html: evaluate(html, scope) } : {}) };
  };
  const recipient = parse('lib/recipient-delivery/worker.ts');
  const recipientScope = { origin: 'https://example.invalid', token: 'PREVIEW_ONLY_NOT_A_REAL_TOKEN', reserve: { data: [{ expires_at: '2030-01-09T12:00:00.000Z' }] } };
  const recipientPayload = Object.fromEntries(['subject', 'text'].map(name => [name, evaluate(find(recipient,
    node => ts.isPropertyAssignment(node) && node.name.getText() === name).initializer, recipientScope)]));
  return {
    'check-in': continuity(false),
    'guardian-invitation': load('lib/guardians/server.ts').confirmationEmail('Alex Example'),
    'guardian-verification': load('lib/continuity/guardian-verification-email.ts').createGuardianVerificationEmail({
      recipientName: 'Morgan Example', ownerName: 'Alex Example', verificationUrl: 'https://example.invalid/guardian-verification#token=PREVIEW_ONLY_NOT_A_REAL_TOKEN',
    }),
    'safety-window': continuity(true),
    'recipient-delivery': recipientPayload,
  };
}
