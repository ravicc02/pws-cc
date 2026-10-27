import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWeixinInbox } from '../server/inbound.mjs';
import { createWorkspace } from '../server/workspace.mjs';
import { dateInZone } from '../server/review.mjs';

function makeStore(overrides = {}) {
  let state = { account: { userId: 'owner', contextToken: null }, seenMessages: [], pendingReply: null, reviewPromptDelivery: null, ...overrides };
  return { get: () => state, update: (change) => { state = { ...state, ...change }; return state; } };
}

const message = (id, text, sender = 'owner') => ({
  from_user_id: sender, message_id: id, context_token: `context-${id}`,
  item_list: text ? [{ type: 1, text_item: { text } }] : [],
});

test('Weixin inbox replies to owner, ignores other senders and does not replay seen messages', async () => {
  const store = makeStore();
  const calls = [];
  const inbox = createWeixinInbox(store, { send: async (text, sourceId) => {
    calls.push({ text, sourceId }); return { answer: { text: '收到，已记录。' } };
  } }, {}, async (account, text, clientId) => { calls.push({ account, text, clientId }); });
  await inbox.handle(message('foreign', '别人的话', 'stranger'));
  await inbox.handle(message('m1', '今天卧推 100kg'));
  await inbox.handle(message('m1', '今天卧推 100kg'));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sourceId, 'weixin:m1');
  assert.equal(calls[1].text, '收到，已记录。');
  assert.equal(calls[1].account.contextToken, 'context-m1');
  assert.deepEqual(store.get().seenMessages, ['m1']);
});

test('Weixin inbox passes image and transcribed voice to Agent', async () => {
  const store = makeStore();
  const received = [];
  const inbox = createWeixinInbox(store, { send: async (input) => { received.push(input); return { answer: { text: '收到。' } }; } }, {}, async () => {}, {
    saveWeixinImage: async () => 'image-id', transcribe: async () => '今天吃了晚餐',
  });
  await inbox.handle({ ...message('photo', '这是我今天的晚餐'), item_list: [
    { type: 1, text_item: { text: '这是我今天的晚餐' } }, { type: 2, image_item: { media: {} } },
  ] });
  await inbox.handle({ ...message('voice', ''), item_list: [{ type: 3, voice_item: { media: {} } }] });
  assert.deepEqual(received[0], { text: '这是我今天的晚餐', imageId: 'image-id' });
  assert.equal(received[1], '今天吃了晚餐');
});

test('Weixin inbox explains text timeout and voice transcription failure separately', async () => {
  const store = makeStore();
  const sent = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const inbox = createWeixinInbox(store, { send: async () => { throw new Error('模型处理超过 90 秒，请稍后重试。'); } }, {}, async (_account, text) => sent.push(text), {
      transcribe: async () => { throw new Error('语音转写服务不可用或超时。'); },
    });
    await inbox.handle(message('timeout', '你好'));
    await inbox.handle({ ...message('voice-failure', ''), item_list: [{ type: 3, voice_item: { media: {} } }] });
    assert.match(sent[0], /模型处理超时（90 秒）/);
    assert.doesNotMatch(sent[0], /语音/);
    assert.match(sent[1], /语音转写失败/);
  } finally { console.error = originalError; }
});

test('failed send retains reply and client ID, then retries without rerunning Agent', async () => {
  const store = makeStore();
  let generations = 0;
  const attempts = [];
  const inbox = createWeixinInbox(store, { send: async () => { generations++; return { answer: { text: '你好。' } }; } }, {}, async (_account, text, clientId) => {
    attempts.push({ text, clientId });
    if (attempts.length === 1) throw new Error('network');
  });
  await assert.rejects(() => inbox.handle(message('m2', '你好')), /network/);
  assert.equal(store.get().seenMessages.length, 0);
  assert.equal(store.get().pendingReply.text, '你好。');
  await inbox.flushPending();
  await inbox.handle(message('m2', '你好'));
  assert.equal(generations, 1);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.deepEqual(store.get().seenMessages, ['m2']);
});

test('a reply to pending review is recorded once and acknowledged without calling Agent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pws-inbox-'));
  try {
    await writeFile(path.join(root, 'info.md'), '# Me\n');
    const workspace = createWorkspace(root);
    const today = dateInZone();
    const store = makeStore({ reviewPromptDelivery: { date: today, status: 'accepted', questions: ['今天如何？'] } });
    const sent = [];
    const inbox = createWeixinInbox(store, { send: () => { throw new Error('should not call Agent'); } }, workspace, async (_account, text) => { sent.push(text); });
    await inbox.handle(message('review1', '复盘：今天状态不错'));
    await inbox.handle(message('review1', '复盘：今天状态不错'));
    assert.deepEqual(sent, ['已记录你的每日复盘。']);
    assert.match((await workspace.get('review', null, today)).content, /今天状态不错/);
    assert.equal(store.get().reviewPromptDelivery.status, 'answered');
  } finally { await rm(root, { recursive: true, force: true }); }
});
