import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const source = require('typescript').transpileModule(readFileSync('lib/kms.ts', 'utf8'), {
  compilerOptions: { module: 1, target: 7 },
}).outputText;

function load(env = {}, response = { Plaintext: new Uint8Array([1]), CiphertextBlob: new Uint8Array([2]) }) {
  const exports = {};
  const clients = [];
  const commands = [];
  let serverOnly = false;
  class GenerateDataKeyCommand { constructor(input) { this.input = input; this.kind = 'generate'; } }
  class DecryptCommand { constructor(input) { this.input = input; this.kind = 'decrypt'; } }
  class KMSClient {
    constructor(options) { clients.push(options); }
    async send(command) { commands.push(command); if (response instanceof Error) throw response; return response; }
  }
  vm.runInNewContext(source, {
    exports, process: { env }, require(name) {
      if (name === 'server-only') { serverOnly = true; return {}; }
      if (name === '@aws-sdk/client-kms') return { KMSClient, GenerateDataKeyCommand, DecryptCommand };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { exports, clients, commands, serverOnly };
}

test('import without AWS configuration preserves server-only and creates no client', () => {
  const result = load();
  assert.equal(result.serverOnly, true);
  assert.equal(typeof result.exports.generateDataKey, 'function');
  assert.equal(typeof result.exports.decryptDataKey, 'function');
  assert.equal(result.clients.length, 0);
  assert.equal(result.commands.length, 0);
});

test('both operations reject missing or blank configuration before any AWS access in Preview and Production', async () => {
  for (const VERCEL_ENV of ['preview', 'production']) {
    for (const config of [{}, { AWS_REGION: 'us-east-1' }, { AWS_KMS_KEY_ID: 'test-key' },
      { AWS_REGION: ' ', AWS_KMS_KEY_ID: 'test-key' }, { AWS_REGION: 'us-east-1', AWS_KMS_KEY_ID: '' }]) {
      const result = load({ ...config, VERCEL_ENV, NODE_ENV: 'production' });
      await assert.rejects(result.exports.generateDataKey(), /Missing AWS KMS environment variables/);
      await assert.rejects(result.exports.decryptDataKey(new Uint8Array([2])), /Missing AWS KMS environment variables/);
      assert.equal(result.clients.length, 0);
      assert.equal(result.commands.length, 0);
    }
  }
});

test('configured operations initialize lazily, reuse the client and preserve KMS command parameters', async () => {
  const env = { AWS_REGION: 'us-east-1', AWS_KMS_KEY_ID: 'test-key' };
  const response = { Plaintext: new Uint8Array([1]), CiphertextBlob: new Uint8Array([2]) };
  const result = load(env, response);
  assert.equal(result.clients.length, 0);
  const generated = await result.exports.generateDataKey();
  assert.equal(generated.plaintextKey, response.Plaintext);
  assert.equal(generated.encryptedKey, response.CiphertextBlob);
  assert.equal(await result.exports.decryptDataKey(response.CiphertextBlob), response.Plaintext);
  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].region, env.AWS_REGION);
  assert.equal(result.commands[0].kind, 'generate');
  assert.equal(result.commands[0].input.KeyId, env.AWS_KMS_KEY_ID);
  assert.equal(result.commands[0].input.KeySpec, 'AES_256');
  assert.equal(result.commands[1].kind, 'decrypt');
  assert.equal(result.commands[1].input.KeyId, env.AWS_KMS_KEY_ID);
  assert.equal(result.commands[1].input.CiphertextBlob, response.CiphertextBlob);
  delete env.AWS_KMS_KEY_ID;
  await assert.rejects(result.exports.generateDataKey(), /Missing AWS KMS environment variables/);
  await assert.rejects(result.exports.decryptDataKey(response.CiphertextBlob), /Missing AWS KMS environment variables/);
  assert.equal(result.commands.length, 2);
});

test('provider failures and incomplete responses still fail without fallback', async () => {
  const env = { AWS_REGION: 'us-east-1', AWS_KMS_KEY_ID: 'test-key' };
  for (const response of [{}, new Error('AccessDenied')]) {
    const { exports } = load(env, response);
    await assert.rejects(exports.generateDataKey(), /complete data key|AccessDenied/);
    await assert.rejects(exports.decryptDataKey(new Uint8Array([2])), /decrypted data key|AccessDenied/);
  }
});
