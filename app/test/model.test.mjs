import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.mjs';
import { defaultModelConfig, defaultModelState, normalizeModelState, publicModelConfig, publicModelState, activeModelConfig, saveModelProfile, activateModelProfile, deleteModelProfile, updateModelConfig, testModelConnection, completeChat } from '../server/model.mjs';

test('model configuration retains, replaces, or clears a key without returning it', () => {
  const first = updateModelConfig(defaultModelConfig(), {
    baseUrl: 'https://api.example.com/v1/', model: 'example-chat', apiKey: 'secret-one',
  });
  assert.equal(first.baseUrl, 'https://api.example.com/v1');
  assert.equal(first.apiKey, 'secret-one');
  assert.deepEqual(publicModelConfig(first), {
    baseUrl: first.baseUrl, model: first.model, hasKey: true, lastTest: null,
  });
  assert.equal(updateModelConfig(first, { baseUrl: first.baseUrl, model: 'other', apiKey: '' }).apiKey, 'secret-one');
  assert.equal(updateModelConfig(first, { baseUrl: first.baseUrl, model: 'other', clearKey: true }).apiKey, '');
});

test('model configuration rejects insecure or malformed external URLs', () => {
  for (const baseUrl of ['http://api.example.com/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1/chat/completions']) {
    assert.throws(() => updateModelConfig(defaultModelConfig(), { baseUrl, model: 'model' }));
  }
  assert.equal(updateModelConfig(defaultModelConfig(), { baseUrl: 'http://127.0.0.1:11434/v1', model: 'local' }).model, 'local');
});

test('connection test calls the configured chat completion without exposing response content', async () => {
  const config = { baseUrl: 'https://api.example.com/v1', model: 'example-chat', apiKey: 'secret' };
  const result = await testModelConnection(config, async (url, options) => {
    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer secret');
    assert.deepEqual(JSON.parse(options.body).messages, [{ role: 'user', content: 'Reply with OK.' }]);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
  });
  assert.equal(result.status, 'ok');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  await assert.rejects(() => testModelConnection(config, async () => new Response('{}', { status: 401 })), /HTTP 401/);
});

test('chat completions use a 90 second deadline by default', async () => {
  const original = AbortSignal.timeout;
  let deadline;
  AbortSignal.timeout = (milliseconds) => { deadline = milliseconds; return new AbortController().signal; };
  try {
    const response = await completeChat({ baseUrl: 'https://example.com/v1', model: 'test' }, [{ role: 'user', content: 'hello' }], async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    assert.equal(response, 'ok');
    assert.equal(deadline, 90000);
  } finally { AbortSignal.timeout = original; }
});

test('legacy model storage preserves key and verification until first mutation', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pws-model-'));
  const file = path.join(dir, 'model.json');
  const legacy = { baseUrl: 'https://example.com/v1', model: 'old', apiKey: 'keep-secret', lastTest: { status: 'ok' } };
  try {
    writeFileSync(file, JSON.stringify(legacy));
    const store = createStore(file, defaultModelState);
    const state = normalizeModelState(store.get());
    assert.equal(state.profiles[0].apiKey, 'keep-secret');
    assert.equal(state.profiles[0].lastTest.status, 'ok');
    assert.equal(readFileSync(file, 'utf8'), JSON.stringify(legacy));
    const next = store.replace(saveModelProfile(state, state.activeId, updateModelConfig(state.profiles[0], legacy), state.profiles[0].lastTest));
    assert.deepEqual(Object.keys(next).sort(), ['activeId', 'profiles']);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).profiles[0].apiKey, 'keep-secret');
    assert.equal(JSON.stringify(publicModelState(next)).includes('keep-secret'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('profiles can be added, switched, updated, and deleted with active fallback', () => {
  const testResult = { status: 'ok', at: '2026-10-26T00:00:00Z' };
  const first = updateModelConfig(defaultModelConfig(), { baseUrl: 'https://one.example/v1', model: 'one', apiKey: 'first-key' });
  let state = saveModelProfile(defaultModelState(), null, first, testResult, 'first');
  const second = updateModelConfig(defaultModelConfig(), { baseUrl: 'https://two.example/v1', model: 'two', apiKey: 'second-key' });
  state = saveModelProfile(state, null, second, testResult, 'second');
  assert.equal(state.activeId, 'first');
  state = activateModelProfile(state, 'second');
  assert.equal(activeModelConfig(state).apiKey, 'second-key');
  const edited = updateModelConfig(activeModelConfig(state), { baseUrl: second.baseUrl, model: 'two-new', apiKey: '' });
  state = saveModelProfile(state, 'second', edited, testResult);
  assert.equal(activeModelConfig(state).apiKey, 'second-key');
  assert.equal(activeModelConfig(state).model, 'two-new');
  assert.equal(publicModelState(state).profiles[1].hasKey, true);
  assert.equal(JSON.stringify(publicModelState(state)).includes('second-key'), false);
  state = deleteModelProfile(state, 'second');
  assert.equal(state.activeId, 'first');
  assert.equal(activeModelConfig(state).model, 'one');
  state = deleteModelProfile(state, 'first');
  assert.deepEqual(state, defaultModelState());
  assert.equal(activeModelConfig(state).baseUrl, '');
  assert.throws(() => activateModelProfile(state, 'missing'), /不存在/);
});
