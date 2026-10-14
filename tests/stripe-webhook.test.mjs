import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const Stripe = require('stripe');
const source = require('typescript').transpileModule(readFileSync('app/api/stripe-webhook/route.ts', 'utf8'), {
  compilerOptions: { module: 1, target: 7, esModuleInterop: true },
}).outputText;

// Opaque configuration doubles for isolated boundary tests, never credentials
// or values installed in process.env. The real SDK is used for import tests.
const configured = { trim: () => 'configured' };
const config = { STRIPE_SECRET_KEY: configured, STRIPE_WEBHOOK_SECRET: configured };

function load(env = {}, realStripe = false) {
  const exports = {};
  const calls = [];
  class StripeBoundary {
    constructor(key) { calls.push(['initialize', key]); }
    webhooks = { constructEvent: (...args) => {
      calls.push(['verify', ...args]);
      // Real SDK rejects malformed signatures before any secret is used.
      return Stripe.webhooks.constructEvent(...args);
    } };
    subscriptions = { retrieve: () => { calls.push(['retrieve']); throw new Error('Unexpected retrieval'); } };
  }
  vm.runInNewContext(source, {
    exports, process: { env }, Response,
    require(name) {
      if (name === 'stripe') return realStripe ? Stripe : StripeBoundary;
      if (name === '@/lib/guardians/server') return {
        guardianAdmin: () => { calls.push(['admin']); throw new Error('Unexpected persistence'); },
        sendGuardianConfirmations: () => { calls.push(['notify']); throw new Error('Unexpected notification'); },
        uuidPattern: /^[0-9a-f-]+$/i,
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { POST: exports.POST, calls };
}

function request(signature) {
  return new Request('https://example.com/api/stripe-webhook', {
    method: 'POST', body: '{"type":"customer.subscription.updated","data":{"object":{"id":"sub_untrusted"}}}',
    headers: signature === undefined ? {} : { 'stripe-signature': signature },
  });
}

test('webhook imports with real Stripe and no credentials in Preview and Production', () => {
  for (const VERCEL_ENV of ['preview', 'production']) {
    assert.equal(typeof load({ VERCEL_ENV, NODE_ENV: 'production' }, true).POST, 'function');
  }
});

test('missing, empty or whitespace secrets reject before client creation or event processing', async () => {
  for (const VERCEL_ENV of ['preview', 'production']) {
    for (const name of Object.keys(config)) {
      for (const value of [undefined, '', '   ']) {
        const result = load({ ...config, VERCEL_ENV, [name]: value });
        const response = await result.POST(request('invalid'));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'Missing webhook configuration' });
        assert.deepEqual(result.calls, []);
      }
    }
  }
});

test('missing or empty signatures reject without initializing Stripe', async () => {
  for (const signature of [undefined, '', '   ']) {
    const result = load(config);
    assert.equal((await result.POST(request(signature))).status, 400);
    assert.deepEqual(result.calls, []);
  }
});

test('invalid signatures reach real signature verification and cannot process events', async () => {
  for (const VERCEL_ENV of ['preview', 'production']) {
    for (const signature of ['invalid', 't=1,v0=invalid']) {
      const result = load({ ...config, VERCEL_ENV });
      const req = request(signature);
      const body = await req.clone().text();
      const response = await result.POST(req);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Invalid webhook signature' });
      assert.deepEqual(result.calls, [
        ['initialize', configured], ['verify', body, signature, configured],
      ]);
    }
  }
});
