import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('typescript');
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: 1, target: 7, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => name === 'server-only' ? {} : mocks[name] ?? require(name),
    console, Response, Request, Blob, URL, AbortController, AbortSignal, setTimeout, clearTimeout,
    TextEncoder, TextDecoder, Buffer, crypto: webcrypto, atob, btoa, ...globals });
  return exports;
}
const ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';
const metadata = prefix => ({ [`${prefix}_iv`]: 'iv', [`${prefix}_encrypted_key`]: 'wrapped', [`${prefix}_encryption_version`]: 'v1' });
function fixture() {
  return {
    messages: [{ id: ID, user_id: OWNER, recipient_name: 'Recipient', recipient_email: 'r@example.com', status: 'draft',
      body: 'ciphertext', ...metadata('body'), voice_path: `${OWNER}/voice`, ...metadata('voice') }],
    message_videos: [{ message_id: ID, user_id: OWNER, video_path: `${OWNER}/video`, ...metadata('video') }],
    message_photos: Array.from({ length: 4 }, (_, i) => ({ message_id: ID, user_id: OWNER, storage_path: `${OWNER}/photo${i}`, ...metadata('photo') })),
    message_documents: Array.from({ length: 4 }, (_, i) => ({ message_id: ID, user_id: OWNER, document_path: `${OWNER}/doc${i}`, ...metadata('document') })),
  };
}
function clientFor(tables, owner = OWNER, storageError = false) {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: owner } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'isolated-session' } }, error: null }) },
    from(table) {
      const filters = []; let single = false;
      const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; },
        order() { return q; }, abortSignal() { return q; }, maybeSingle() { single = true; return q; },
        then(resolve, reject) {
          calls.push({ table, filters });
          const rows = (tables[table] ?? []).filter(row => filters.every(([k, v]) => row[k] === v));
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: single && rows.length > 1 ? {} : null }).then(resolve, reject);
        } };
      return q;
    },
    storage: { from(bucket) { return {
      async createSignedUrl(path) { calls.push({ signed: path, bucket }); return storageError ? { error: {} } : { data: { signedUrl: `https://example.com/${path}` } }; },
      async download(path) { calls.push({ downloaded: path, bucket }); return storageError ? { error: {} } : { data: new Blob(['encrypted']) }; },
    }; } },
  };
  return { client, calls };
}
function loader({ failure, pending = false } = {}) {
  const requests = [];
  const api = load('lib/messages/load-message.ts', {}, { fetch: async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (pending) return new Promise(() => {});
    if (failure && (failure === body.type || (failure === 'letter' && url.endsWith('decrypt-message')))) return Response.json({ code: 'KMS' }, { status: 500 });
    return url.endsWith('decrypt-message') ? Response.json({ plaintext: '<p>Letter</p>' }) : new Response('decrypted fixture', { headers: { 'Content-Type': body.type === 'voice' ? 'audio/webm' : 'application/octet-stream' } });
  }, URL: { createObjectURL: () => 'blob:isolated' } });
  return { ...api, requests };
}

test('FULL TEST 08 shaped fixture loads Letter, Video, Voice, four Photos and four Documents without writes', async () => {
  const tables = fixture(); const before = JSON.stringify(tables); const { client, calls } = clientFor(tables);
  const api = loader(); const result = await api.loadMessage(client, ID, new AbortController().signal);
  assert.equal(result.issues.length, 0); assert.equal(result.body, '<p>Letter</p>'); assert(result.voice_url);
  assert.equal(result.video_urls.length, 1); assert.equal(result.photo_urls.length, 4); assert.equal(result.documents.length, 4);
  assert.equal(api.requests.length, 11); assert.equal(calls.filter(c => c.signed).length, 0);
  assert.equal(JSON.stringify(tables), before);
});

test('Voice failure remains an explicit issue and preserves every other component', async () => {
  const api = loader({ failure: 'voice' }); const { client } = clientFor(fixture());
  const result = await api.loadMessage(client, ID, new AbortController().signal);
  assert.equal(result.voice_url, null); assert.equal(result.issues[0].asset, 'Voice'); assert.equal(result.issues[0].code, 'KMS');
  assert(result.body); assert.equal(result.documents.length, 4); assert.equal(result.photo_urls.length, 4); assert.equal(result.video_urls.length, 1);
});

test('Letter failure settles with an explicit issue rather than rejecting all attachments', async () => {
  const api = loader({ failure: 'letter' }); const { client } = clientFor(fixture());
  const result = await api.loadMessage(client, ID, new AbortController().signal);
  assert.equal(result.body, null); assert.equal(result.issues[0].asset, 'Letter'); assert(result.voice_url); assert.equal(result.documents.length, 4);
});

test('timeouts and navigation cancellation settle even when the transport never responds', async () => {
  const api = loader({ pending: true }); const { client } = clientFor(fixture()); const controller = new AbortController();
  const work = api.loadMessage(client, ID, controller.signal);
  setTimeout(() => controller.abort(), 20);
  const result = await work;
  assert(result.issues.length > 0); assert(result.issues.every(i => i.code === 'TIMEOUT'));
  await assert.rejects(api.boundedLoad(new Promise(() => {}), new AbortController().signal, 5), /TIMEOUT/);
});

test('legacy parent video/document references are recovered, deduplicated and remain owner scoped', async () => {
  const tables = fixture();
  Object.assign(tables.messages[0], { video_path: `${OWNER}/old-video`, document_path: `${OWNER}/old-doc` });
  tables.message_videos = []; tables.message_documents = [{ message_id: ID, user_id: OWNER, document_path: `${OWNER}/old-doc` }];
  const api = loader(); const { client, calls } = clientFor(tables);
  const result = await api.loadMessage(client, ID, new AbortController().signal);
  assert.equal(result.video_urls.length, 1); assert.equal(result.documents.length, 1);
  assert.equal(calls.filter(c => c.signed === `${OWNER}/old-doc`).length, 1);
  assert.equal(calls.filter(c => c.signed === `${OWNER}/old-video`).length, 1);
});

test('partial/unsupported encryption metadata never falls back to signed ciphertext', async () => {
  for (const prefix of ['voice', 'body', 'video', 'document', 'photo']) {
    const tables = fixture();
    const row = prefix === 'voice' || prefix === 'body' ? tables.messages[0] : tables[`message_${prefix === 'photo' ? 'photos' : prefix + 's'}`][0];
    row[`${prefix}_encrypted_key`] = null;
    const { client, calls } = clientFor(tables); const api = loader();
    const result = await api.loadMessage(client, ID, new AbortController().signal);
    assert(result.issues.some(i => i.code === 'METADATA')); assert.equal(calls.filter(c => c.signed).length, 0);
  }
});

test('different owners cannot load the message or reach Storage/decryption', async () => {
  const api = loader(); const { client, calls } = clientFor(fixture(), OTHER);
  await assert.rejects(api.loadMessage(client, ID, new AbortController().signal), /RECORD/);
  assert.equal(api.requests.length, 0); assert.equal(calls.filter(c => c.signed || c.downloaded).length, 0);
});

test('Edit guard blocks incomplete, failed, and previous-message loads; untouched Voice omits all persisted fields', () => {
  const { editReady, voiceUpdate } = load('lib/messages/voice-update.ts');
  assert.equal(editReady(ID, null, true, ''), false); assert.equal(editReady(ID, ID, false, 'Voice failed'), false);
  assert.equal(editReady(ID, OTHER, false, ''), false); assert.equal(editReady(ID, ID, false, ''), true);
  const original = { voice_path: 'existing/path', ...metadata('voice') };
  const updated = { ...original, ...voiceUpdate(null, false) };
  assert.deepEqual(updated, original); assert.equal(Object.keys(voiceUpdate(null, false)).length, 0);
  assert.throws(() => voiceUpdate({ voice_path: 'new' }, false));
});

function routeHarness(tables, owner = OWNER, storageError = false) {
  const { client, calls } = clientFor(tables, owner, storageError); let decrypted = 0;
  const route = load('app/api/decrypt-file/route.ts', {
    'next/server': { NextResponse: Response }, '@supabase/supabase-js': { createClient: (_url, _key, options) => {
      assert.equal(options.global.headers.Authorization, 'Bearer isolated-session'); return client;
    } }, '@/lib/messages/decrypt-content': { decryptStoredBytes: async () => { decrypted++; return new Uint8Array([1, 2]).buffer; }, decryptionFailure: () => ({ code: 'DECRYPT' }) },
  }, { process: { env: {} } });
  return { calls, decrypted: () => decrypted, run: body => route.POST(new Request('https://example.com/api/decrypt-file', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer isolated-session' }, body: JSON.stringify(body),
  })) };
}

test('encrypted parent-column video/document fallback verifies ownership and exact stored path', async () => {
  for (const kind of ['video', 'document']) {
    const tables = fixture(); tables[`message_${kind}s`] = [];
    Object.assign(tables.messages[0], { [`${kind}_path`]: `${OWNER}/old`, ...metadata(kind) });
    const h = routeHarness(tables);
    assert.equal((await h.run({ type: kind, messageId: ID, [`${kind}Path`]: `${OWNER}/old` })).status, 200);
    assert.equal(h.decrypted(), 1);
    assert.equal((await h.run({ type: kind, messageId: ID, [`${kind}Path`]: `${OTHER}/other` })).status, 404);
    assert.equal(h.decrypted(), 1);
    const foreign = routeHarness(tables, OTHER);
    assert.equal((await foreign.run({ type: kind, messageId: ID, [`${kind}Path`]: `${OWNER}/old` })).status, 404);
    assert.equal(foreign.decrypted(), 0);
  }
});

test('file endpoint distinguishes Storage failure and invalid metadata before cryptography', async () => {
  let h = routeHarness(fixture(), OWNER, true);
  let response = await h.run({ type: 'voice', messageId: ID });
  assert.equal(response.status, 500); assert.equal((await response.json()).code, 'STORAGE'); assert.equal(h.decrypted(), 0);
  const tables = fixture(); tables.messages[0].voice_iv = null; h = routeHarness(tables);
  response = await h.run({ type: 'voice', messageId: ID });
  assert.equal(response.status, 422); assert.equal((await response.json()).code, 'METADATA'); assert.equal(h.decrypted(), 0);
});

test('real AES-GCM round trips remain unchanged; KMS/AES/metadata diagnostics never expose provider messages', async () => {
  const encryption = load('lib/encryption.ts');
  const keyBytes = webcrypto.getRandomValues(new Uint8Array(32)); const key = await encryption.importAesKey(keyBytes);
  const encrypted = await encryption.encryptBytes(new TextEncoder().encode('private fixture').buffer, key);
  const logs = []; let failKms = false;
  const api = load('lib/messages/decrypt-content.ts', {
    '@/lib/encryption': encryption, '@/lib/kms': { decryptDataKey: async () => {
      if (failKms) { const error = new Error('DO_NOT_LOG_key_path_content'); error.name = 'AccessDeniedException'; throw error; }
      return keyBytes;
    } },
  }, { console: { error: (...args) => logs.push(args) } });
  const wrapped = Buffer.from('isolated wrapped key').toString('base64');
  const result = await api.decryptStoredBytes(encrypted.encryptedData, encrypted.iv, wrapped);
  assert.equal(new TextDecoder().decode(result), 'private fixture');
  const text = await encryption.encryptText('letter fixture', key);
  assert.equal(await api.decryptStoredText(text.ciphertext, text.iv, wrapped), 'letter fixture');
  assert.equal(await api.decryptStoredText(text.ciphertext.replace(/=+$/, ''), text.iv, wrapped.replace(/=+$/, '')), 'letter fixture');
  const damaged = new Uint8Array(encrypted.encryptedData.slice(0)); damaged[0] ^= 1;
  for (const [stage, work] of [
    ['AES', () => api.decryptStoredBytes(damaged.buffer, encrypted.iv, wrapped)],
    ['METADATA', () => api.decryptStoredBytes(encrypted.encryptedData, 'invalid', wrapped)],
    ['KMS', () => { failKms = true; return api.decryptStoredBytes(encrypted.encryptedData, encrypted.iv, wrapped); }],
  ]) {
    try { await work(); assert.fail('must reject'); } catch (error) { assert.equal(api.decryptionFailure(error).code, stage); }
  }
  assert(!JSON.stringify(logs).includes('DO_NOT_LOG')); assert(!JSON.stringify(logs).includes('private fixture'));
});

// Render the actual pages with isolated hooks; all data/provider work is mocked.
function pageHarness(file, loaded, overrides = {}) {
  let index = 0; const slots = [], effects = [], cleanups = [];
  const react = {
    Suspense: 'suspense',
    useState(initial) {
      const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) {
      const i = index++; const old = slots[i];
      if (!old || deps.some((d, n) => d !== old[n])) { slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = effect(); }); }
    },
  };
  const api = loader();
  const mocks = {
    react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'next/navigation': { useSearchParams: () => new URLSearchParams({ message: ID }), useRouter: () => ({ push() {} }) },
    'next/link': { __esModule: true, default: 'link' },
    'lucide-react': new Proxy({}, { get: (_, key) => String(key) }),
    '@/lib/supabase': { supabase: {} },
    '@/lib/messages/load-message': { ...api, loadMessage: async () => {
      if (loaded instanceof Error) throw loaded; return loaded;
    } },
    '@/lib/messages/voice-update': load('lib/messages/voice-update.ts'),
    '@/components/messages/useMessageDeletion': { useMessageDeletion: () => ({ enabled: false, pending: [] }) },
    '@/lib/messages/capabilities': {}, '@/lib/messages/uploads': {},
    '@/components/auth/OnboardingFormLayout': { OnboardingFormLayout: 'layout' },
    '@/components/EterpaxLetterEditor.tsx/EterpaxLetterEditor': { __esModule: true, default: 'editor' },
  };
  const page = load(file, { ...mocks, ...overrides.mocks }, { window: { setTimeout, clearTimeout, location: {} }, alert() {}, ...overrides.globals });
  const component = page.default().props.children.type;
  return {
    render() { index = 0; const tree = component(); while (effects.length) effects.shift()(); return tree; },
    close() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}
function nodes(tree) {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
const pageText = tree => nodes(tree).filter(node => typeof node === 'string').join(' ');

test('Review renders visible Voice/Letter failures while keeping available components', async () => {
  for (const failure of ['voice', 'letter']) {
    const api = loader({ failure }); const { client } = clientFor(fixture());
    const loaded = await api.loadMessage(client, ID, new AbortController().signal);
    const page = pageHarness('app/(auth)/review/page.tsx', loaded);
    try {
      assert.match(pageText(page.render()), /Loading your message/);
      await new Promise(resolve => setTimeout(resolve, 0));
      const tree = page.render(); const text = pageText(tree);
      assert(!text.includes('Loading your message'));
      assert(text.includes(failure === 'voice' ? 'Voice' : 'Letter'));
      assert(nodes(tree).some(node => node?.props?.role === 'alert'));
      assert.match(text, /encryption key could not be unlocked/);
      assert.match(text, /Photos/); assert.match(text, /Documents/);
    } finally { page.close(); }
  }
});

test('Edit renders no input or save controls while pending or partially loaded', async () => {
  const api = loader({ failure: 'voice' }); const { client } = clientFor(fixture());
  const loaded = await api.loadMessage(client, ID, new AbortController().signal);
  const page = pageHarness('app/(auth)/your-messages/page.tsx', loaded);
  try {
    let tree = page.render(); assert.match(pageText(tree), /Loading your saved message/);
    assert(!nodes(tree).some(node => node?.type === 'input'));
    await new Promise(resolve => setTimeout(resolve, 0)); tree = page.render();
    assert.match(pageText(tree), /Voice/); assert.match(pageText(tree), /Retry loading message/);
    assert(!nodes(tree).some(node => node?.type === 'input'));
    assert(!pageText(tree).includes('Save Recipient'));
  } finally { page.close(); }
});

test('actual Edit save preserves original Voice and never uploads/re-encrypts an unchanged recording', async () => {
  const tables = fixture(); const api = loader(); const { client } = clientFor(tables);
  const loaded = await api.loadMessage(client, ID, new AbortController().signal);
  const writes = [], requests = [];
  const original = { ...tables.messages[0] };
  const saveClient = {
    auth: client.auth,
    from(table) {
      assert.equal(table, 'messages');
      return { update(patch) {
        writes.push(patch); const filters = [];
        const query = { eq(k, v) { filters.push([k, v]); return query; }, then(resolve) {
          assert.deepEqual(filters, [['id', ID], ['user_id', OWNER]]);
          return Promise.resolve({ error: null }).then(resolve);
        } };
        return query;
      } };
    },
    storage: { from() { assert.fail('unchanged Voice must not access upload/remove'); } },
  };
  const page = pageHarness('app/(auth)/your-messages/page.tsx', loaded, {
    mocks: { '@/lib/supabase': { supabase: saveClient }, '@/lib/messages/capabilities': { messageCoordinationEnabled: async () => false } },
    globals: { fetch: async (url) => { requests.push(url); assert.equal(url, '/api/encryption-key'); return Response.json({ ciphertext: 'new-letter', iv: 'iv', encryptedKey: 'wrapped' }); } },
  });
  try {
    page.render(); await new Promise(resolve => setTimeout(resolve, 0));
    let tree = page.render();
    const next = nodes(tree).find(node => node?.type === 'button' && pageText(node).trim() === 'Continue →');
    assert(next); next.props.onClick(); tree = page.render();
    const save = nodes(tree).find(node => node?.type === 'button' && pageText(node).includes('Save Recipient'));
    assert(save); await save.props.onClick();
    assert.equal(writes.length, 1); assert.equal(requests.length, 1);
    const after = { ...original, ...writes[0] };
    for (const key of ['voice_path', 'voice_iv', 'voice_encrypted_key', 'voice_encryption_version']) {
      assert.equal(after[key], original[key]); assert(!Object.hasOwn(writes[0], key));
    }
  } finally { page.close(); }
});

for (const reason of ['UnrecognizedClientException', 'InvalidSignatureException', 'ExpiredTokenException', 'ValidationException', 'AccessDeniedException', 'IncorrectKeyException', 'InvalidCiphertextException', 'NotFoundException', 'PRIVATE_UNKNOWN_NAME']) {
  test(`KMS diagnostic classifies ${reason} without exposing provider details`, async () => {
    const logs = [];
    const api = load('lib/messages/decrypt-content.ts', {
      '@/lib/kms': { decryptDataKey: async () => {
        throw { name: reason, message: 'PRIVATE_PROVIDER_MESSAGE', stack: 'PRIVATE_STACK', ciphertext: 'PRIVATE_CIPHERTEXT' };
      } },
      '@/lib/encryption': {},
    }, { console: { error: (...args) => logs.push(args) } });
    let caught;
    try { await api.decryptStoredText('YQ==', Buffer.alloc(12).toString('base64'), 'YQ=='); }
    catch (error) { caught = error; }
    assert(caught);
    const response = api.decryptionFailure(caught);
    assert.equal(response.code, 'KMS');
    assert.equal(logs[0][1].reason, reason === 'PRIVATE_UNKNOWN_NAME' ? 'UNCLASSIFIED' : reason);
    assert(!JSON.stringify(logs).includes('PRIVATE'));
    assert(!JSON.stringify(response).includes(reason));
  });
}
