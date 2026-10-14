import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = require('typescript').transpileModule(readFileSync('app/api/checkout/route.ts', 'utf8'), {
  compilerOptions: { module: 1, target: 7, esModuleInterop: true },
}).outputText;

// Opaque configuration doubles are passed only to the isolated SDK stub.
// They are not credentials and never enter process.env or a real SDK client.
const configured = { trim: () => 'configured' };
const supabaseConfig = {
  NEXT_PUBLIC_SUPABASE_URL: configured,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: configured,
};

function load(env = {}, authenticated = true, realSupabase = false) {
  const exports = {};
  const errors = [];
  const tokens = [];
  const clients = [];
  // Use the real Stripe SDK, without credentials; only Supabase is isolated.
  vm.runInNewContext(source, {
    exports, process: { env }, Response,
    console: { error: (...args) => errors.push(args) },
    require(name) {
      if (name === 'stripe') return require('stripe');
      if (name === '@supabase/supabase-js' && realSupabase) return require(name);
      if (name === '@supabase/supabase-js') return {
        createClient: (...args) => { clients.push(args); return ({ auth: { getUser: async token => {
          tokens.push(token);
          return { data: { user: authenticated ? { id: 'user-id' } : null }, error: null };
        } } }); },
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { exports, errors, tokens, clients };
}

function request(authorization) {
  return new Request('https://example.com/api/checkout', {
    method: 'POST', headers: authorization ? { authorization } : {},
  });
}

test('checkout route imports without a Stripe key in Preview and Production', () => {
  for (const VERCEL_ENV of ['preview', 'production']) {
    const result = load({ VERCEL_ENV, NODE_ENV: 'production' });
    assert.equal(typeof result.exports.POST, 'function');
    assert.equal(result.errors.length, 0);
    assert.equal(result.tokens.length, 0);
  }
});

test('authenticated checkout rejects missing, empty and whitespace Stripe keys', async () => {
  for (const VERCEL_ENV of ['preview', 'production']) {
    for (const key of [undefined, '', '   ']) {
      const env = { ...supabaseConfig, VERCEL_ENV, NODE_ENV: 'production', STRIPE_PRICE_ID: 'price-selection', NEXT_PUBLIC_SITE_URL: 'https://example.com' };
      if (key !== undefined) env.STRIPE_SECRET_KEY = key;
      const result = load(env);
      const response = await result.exports.POST(request('Bearer test-token'));
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Unable to create checkout session' });
      assert.deepEqual(result.tokens, ['test-token']);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0][1].message, 'Missing STRIPE_SECRET_KEY');
    }
  }
});

test('authentication still rejects missing or invalid tokens before Stripe initialization', async () => {
  for (const authorization of [undefined, 'Basic invalid', 'Bearer invalid']) {
    const result = load(supabaseConfig, false);
    const response = await result.exports.POST(request(authorization));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    assert.equal(result.errors.length, 0);
    assert.equal(result.tokens.length, authorization?.startsWith('Bearer ') ? 1 : 0);
  }
});


test('route imports without Supabase or Stripe configuration using both real SDKs', () => {
  for (const VERCEL_ENV of ['preview', 'production']) {
    const result = load({ VERCEL_ENV, NODE_ENV: 'production' }, true, true);
    assert.equal(typeof result.exports.POST, 'function');
    assert.equal(result.errors.length, 0);
  }
});

test('missing or blank Supabase configuration rejects before authentication or Stripe', async () => {
  for (const VERCEL_ENV of ['preview', 'production']) {
    for (const name of Object.keys(supabaseConfig)) {
      for (const value of [undefined, '', '   ']) {
        const env = { ...supabaseConfig, VERCEL_ENV, [name]: value };
        const result = load(env);
        const response = await result.exports.POST(request('Bearer test-token'));
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: 'Unable to create checkout session' });
        assert.equal(result.errors[0][1].message, 'Missing Supabase configuration');
        assert.equal(result.clients.length, 0);
        assert.equal(result.tokens.length, 0);
      }
    }
  }
});

test('missing Bearer header rejects before checking Supabase configuration', async () => {
  const result = load();
  assert.equal((await result.exports.POST(request())).status, 401);
  assert.equal(result.clients.length, 0);
  assert.equal(result.errors.length, 0);
});

test('authenticated requests reuse Supabase and reach the unchanged Stripe configuration gate', async () => {
  const env = { ...supabaseConfig };
  const result = load(env);
  for (let i = 0; i < 2; i++) {
    const response = await result.exports.POST(request('Bearer test-token'));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Missing Stripe configuration' });
  }
  assert.equal(result.clients.length, 1);
  assert.deepEqual(result.clients[0], [configured, configured]);
  assert.deepEqual(result.tokens, ['test-token', 'test-token']);
  delete env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.equal((await result.exports.POST(request('Bearer test-token'))).status, 500);
  assert.equal(result.tokens.length, 2);
  assert.equal(result.errors[0][1].message, 'Missing Supabase configuration');
});
