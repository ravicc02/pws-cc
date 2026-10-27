import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace, slugFor, validDate } from '../server/workspace.mjs';
import { createChat } from '../server/chat.mjs';
import { createMedia } from '../server/media.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-workspace-'));
  try {
    await writeFile(path.join(root, 'info.md'), '# Me\n');
    await writeFile(path.join(root, 'AGENTS.md'), 'Only record user-provided facts.\n');
    return await run(root, createWorkspace(root));
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('content API allowlist rejects traversal and keeps internal rules out of listings', async () => fixture(async (root, workspace) => {
  assert.equal(validDate('2026-02-30'), false);
  assert.match(slugFor('睡眠'), /^topic-[a-f0-9]{12}$/);
  const profile = await workspace.get('profile');
  assert.equal(profile.content, '# Me\n');
  await assert.rejects(() => workspace.get('record', '..', '2026-10-26'), /Invalid content selection/);
  await assert.rejects(() => workspace.get('review', null, '../secrets'), /Invalid date/);
  const saved = await workspace.save({ kind: 'record', name: '睡眠', date: '2026-10-26', content: '- 睡了 8 小时\n', revision: '' });
  assert.equal(saved.content, '- 睡了 8 小时\n');
  const index = await workspace.list();
  assert.equal(index.records.length, 1);
  assert.equal(index.categories[0].name, '睡眠');
  assert.ok(!JSON.stringify(index).includes('Record only facts'));
  await assert.rejects(() => workspace.save({ kind: 'record', category: saved.category, date: saved.date, content: 'overwrite', revision: 'stale' }), /Content changed/);
  assert.equal((await workspace.get('record', saved.category, saved.date)).content, saved.content);
  assert.match(await readFile(path.join(root, 'record', saved.category, 'rute.md'), 'utf8'), /initialized: true/);
}));

test('a new category is available before its first dated record', async () => fixture(async (root, workspace) => {
  const category = await workspace.ensureCategory('阅读');
  assert.equal((await workspace.ensureCategory('阅读')).slug, category.slug);
  assert.equal((await workspace.list()).records.length, 0);
  assert.equal((await workspace.list()).categories[0].name, '阅读');
  const today = await workspace.get('record', category.slug, '2026-10-26');
  assert.equal(today.content, '');
  await workspace.save({ kind: 'record', category: category.slug, date: '2026-10-26', content: '- 读了 20 页\n', revision: today.revision });
  assert.equal((await workspace.list()).records.length, 1);
}));

test('empty clone does not prefill personal data and initializes on first explicit input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-workspace-empty-'));
  try {
    await writeFile(path.join(root, 'AGENTS.md'), 'Only quote the latest message.\n<!-- END_PROCESSING_GUIDANCE -->\n<!-- BEGIN_FIRST_USE_GUIDANCE -->\n先介绍个人记录与复盘工作区；基本资料到 Web 填写，聊天可说明目标或报告事实，也可以跳过。\n<!-- END_FIRST_USE_GUIDANCE -->\n');
    const workspace = createWorkspace(root);
    assert.equal((await workspace.get('profile')).exists, false);
    assert.deepEqual((await workspace.list()).categories, []);
    const processingPrompts = [];
    const conversationPrompts = [];
    const chat = createChat(root, workspace, { get: () => ({ baseUrl: 'https://example.test/v1', model: 'test' }) }, async (_config, messages) => {
      if (messages[0].content.includes('You extract actions')) {
        processingPrompts.push(messages[0].content);
        const text = JSON.parse(messages[1].content).message;
        if (text === '我想每周读书') return JSON.stringify({ actions: [{ type: 'goal', status: 'active', quote: text }] });
        return JSON.stringify({ actions: [{ type: 'record', category: '阅读', quote: text }] });
      }
      conversationPrompts.push(messages[0].content);
      return JSON.stringify({ reply: '收到。' });
    });
    await chat.send('你好');
    assert.equal((await workspace.get('profile')).exists, false);
    assert.deepEqual((await workspace.list()).categories, []);
    assert.match(conversationPrompts[0], /首次使用引导：先介绍个人记录与复盘工作区/);
    await chat.send('我想每周读书');
    assert.doesNotMatch(conversationPrompts[1], /首次使用引导/);
    assert.match((await workspace.get('profile')).content, /^# 基本资料\n\n## 长期目标/m);
    assert.equal((await workspace.list()).records.length, 0);
    await chat.send('今天读了 20 页');
    const { categories, records } = await workspace.list();
    assert.equal(categories.length, 1);
    assert.equal(records.length, 1);
    assert.equal(categories[0].name, '阅读');
    assert.match(await readFile(path.join(root, 'record', categories[0].slug, 'rute.md'), 'utf8'), /## 当前记录范围/);
    assert.match((await workspace.get('record', categories[0].slug, records[0].date)).content, /今天读了 20 页/);
    assert.equal(processingPrompts.length, 2);
    assert.ok(processingPrompts.every((prompt) => !prompt.includes('Private setup details')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('relative dates follow each quoted fact and vague past dates are not silently assigned to today', async () => fixture(async (_root, workspace) => {
  const chat = createChat(_root, workspace, { get: () => ({ baseUrl: 'https://example.test/v1', model: 'test' }) }, async (_config, messages) => {
    if (!messages[0].content.includes('You extract actions')) return JSON.stringify({ reply: '收到。' });
    const text = JSON.parse(messages[1].content).message;
    return JSON.stringify({ actions: [{ type: 'record', category: '阅读', quote: text }] });
  });
  const earlier = new Date(`${workspace.today()}T00:00:00Z`);
  earlier.setUTCDate(earlier.getUTCDate() - 2);
  const saved = await chat.send('前天读了 20 页');
  assert.equal(saved.answer.written[0].date, earlier.toISOString().slice(0, 10));
  await assert.rejects(() => chat.send('上周读了 20 页'), /具体日期/);
  assert.equal((await workspace.list()).records.length, 1);
}));

test('chat records quoted facts into new categories and rejects invented values', async () => fixture(async (root, workspace) => {
  const model = { get: () => ({ baseUrl: 'https://example.com/v1', model: 'test' }) };
  let result = { reply: '收到。', actions: [{ type: 'record', category: '健身', quote: '今天卧推 100kg' }] };
  const chat = createChat(root, workspace, model, async () => JSON.stringify(result));
  const first = await chat.send('今天卧推 100kg');
  assert.equal(first.answer.written.length, 1);
  const item = first.answer.written[0];
  assert.match((await workspace.get('record', item.category, item.date)).content, /今天卧推 100kg/);
  result = { reply: '记录了。', actions: [{ type: 'record', category: '健身', quote: '卧推 200kg' }] };
  await assert.rejects(() => chat.send('今天练了'), /原话校验/);
  assert.equal((await workspace.get('record', item.category, item.date)).content, '- 今天卧推 100kg\n');
}));

test('existing uninitialized category waits for confirmation and cancellation never writes', async () => fixture(async (root, workspace) => {
  const folder = path.join(root, 'record', 'fitness');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'rute.md'), '# 健身\n\ninitialized: false\n');
  const chat = createChat(root, workspace, { get: () => ({ baseUrl: 'https://example.com/v1', model: 'test' }) }, async () => JSON.stringify({ reply: '', actions: [{ type: 'record', category: 'fitness', quote: '今天卧推 100kg' }] }));
  const first = await chat.send('今天卧推 100kg');
  assert.equal(first.answer.written.length, 0);
  assert.equal(first.pending, true);
  const second = await chat.send('取消');
  assert.equal(second.pending, false);
  assert.equal((await workspace.list()).records.length, 0);
  await chat.send('今天卧推 100kg');
  const confirmed = await chat.send('确认');
  assert.equal(confirmed.answer.written.length, 1);
  assert.match(await readFile(path.join(folder, 'rute.md'), 'utf8'), /initialized: true/);
}));

test('replayed Weixin message returns the earlier answer without writing a second record', async () => fixture(async (root, workspace) => {
  let completions = 0;
  const chat = createChat(root, workspace, { get: () => ({ baseUrl: 'https://example.com/v1', model: 'test' }) }, async () => {
    completions++;
    return JSON.stringify({ reply: '已收到。', actions: [{ type: 'record', category: '阅读', quote: '今天读了 20 页' }] });
  });
  const first = await chat.send('今天读了 20 页', 'weixin:message-1');
  const second = await chat.send('今天读了 20 页', 'weixin:message-1');
  assert.equal(second.answer.text, first.answer.text);
  assert.equal(completions, 2);
  const saved = await workspace.get('record', first.answer.written[0].category, first.answer.written[0].date);
  assert.equal(saved.content.match(/今天读了 20 页/g).length, 1);
}));

test('chat includes latest global reply preferences without weakening quote validation', async () => fixture(async (root, workspace) => {
  let prompt = '先说结论';
  const chat = createChat(root, workspace, { get: () => ({ baseUrl: 'https://example.com/v1', model: 'test' }) }, async (_config, messages) => {
    if (messages[0].content.startsWith('You extract')) return JSON.stringify({ actions: [{ type: 'record', category: '阅读', quote: '未说过的事实' }] });
    assert.match(messages[0].content, new RegExp(prompt));
    return JSON.stringify({ reply: '收到。' });
  }, () => ({ prompt, style: 'concise' }));
  await chat.send('你好');
  await assert.rejects(() => chat.send('今天读书了'), /原话校验/);
  prompt = '详细解释';
  await chat.send('你好呀');
  assert.equal((await workspace.list()).records.length, 0);
}));

test('chat loads profile, history and category rules only when relevant', async () => fixture(async (root, workspace) => {
  await workspace.ensureCategory('健身');
  const reads = { profile: 0, list: 0, rules: 0 };
  const observed = {
    ...workspace,
    get: async (...args) => { if (args[0] === 'profile') reads.profile++; return workspace.get(...args); },
    list: async () => { reads.list++; return workspace.list(); },
    readInternal: async (file) => { if (file.endsWith('rute.md')) reads.rules++; return workspace.readInternal(file); },
  };
  const contexts = [];
  const chat = createChat(root, observed, { get: () => ({ baseUrl: 'https://example.test/v1', model: 'test' }) }, async (_config, messages) => {
    contexts.push(JSON.parse(messages[1].content));
    return JSON.stringify({ reply: '收到。', actions: [] });
  });
  await chat.send('你好');
  assert.deepEqual(reads, { profile: 0, list: 0, rules: 0 });
  assert.equal(contexts[0].memory.profile, undefined);
  assert.deepEqual(contexts[0].memory.records, []);
  await chat.send('健身今天卧推 100kg');
  assert.deepEqual(reads, { profile: 0, list: 0, rules: 1 });
  assert.equal(contexts[1].rules[0].category, (await workspace.resolveCategory('健身')).slug);
  await chat.send('最近的记录和我的目标是什么？');
  assert.deepEqual(reads, { profile: 1, list: 1, rules: 1 });
  assert.ok(Array.isArray(contexts[3].memory.records));
  assert.equal(typeof contexts[3].memory.profile, 'string');
}));

test('photo without context waits, then saves only a broad meal estimate and replies before record summary', async () => fixture(async (root, workspace) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  const imageId = (await createMedia(root).saveImage(png)).id;
  let calls = 0;
  const chat = createChat(root, workspace, { get: () => ({ baseUrl: 'https://example.test/v1', model: 'vision' }) }, async (_config, messages) => {
    calls++;
    if (messages[0].content.startsWith('You extract')) assert.equal(messages[1].content[1].type, 'image_url');
    return JSON.stringify({ reply: '这餐看起来有米饭与蔬菜；只能粗估。', actions: [{ type: 'meal_estimate', quote: '这是我今天的晚餐', foods: '米饭与蔬菜', kcalMin: 350, kcalMax: 650 }] });
  });
  const bare = await chat.send({ text: '', imageId });
  assert.match(bare.answer.text, /这是什么/);
  assert.equal(calls, 0);
  const result = await chat.send('这是我今天的晚餐', 'followup');
  assert.equal(calls, 2);
  assert.match(result.answer.text, /^这餐看起来/);
  assert.match(result.answer.text, /\n记录：/);
  const item = result.answer.written[0];
  assert.match((await workspace.get('record', item.category, item.date)).content, /350–650 千卡（仅根据图片估算/);
  assert.equal((await chat.send('这是我今天的晚餐', 'followup')).answer.text, result.answer.text);
  assert.equal(calls, 2);
}));

test('meal estimate without picture or with invented context cannot be written', async () => fixture(async (root, workspace) => {
  const chat = createChat(root, workspace, { get: () => ({ baseUrl: 'https://example.test/v1', model: 'vision' }) }, async () => JSON.stringify({
    reply: '收到', actions: [{ type: 'meal_estimate', quote: '今天的晚餐', foods: '米饭', kcalMin: 400, kcalMax: 600 }],
  }));
  await assert.rejects(() => chat.send('今天的晚餐'), /无法校验/);
  assert.equal((await workspace.list()).records.length, 0);
}));

test('processing Agent persists an explicit goal before the conversation Agent reads memory', async () => fixture(async (root, workspace) => {
  const calls = [];
  const models = { get: () => ({ activeId: 'processor', profiles: [
    { id: 'processor', baseUrl: 'https://example.test/v1', model: 'extractor' },
    { id: 'conversation', baseUrl: 'https://example.test/v1', model: 'assistant' },
  ] }) };
  const chat = createChat(root, workspace, models, async (config, messages) => {
    calls.push(config.model);
    if (config.model === 'extractor') return JSON.stringify({ actions: [{ type: 'goal', status: 'active', quote: '我想减肥' }] });
    const context = JSON.parse(messages[1].content);
    assert.match(context.memory.profile, /我想减肥/);
    assert.deepEqual(context.memory.records, []);
    return JSON.stringify({ reply: '可以先稳定记录实际饮食和活动，再一起找调整方向。' });
  }, undefined, () => ({ processingId: 'processor', conversationId: 'conversation' }));
  const result = await chat.send('我想减肥');
  assert.deepEqual(calls, ['extractor', 'assistant']);
  assert.equal(result.answer.written[0].kind, 'profile');
  assert.match(result.answer.text, /^可以先稳定记录/);
  assert.match(result.answer.text, /记录：长期目标已添加/);
  assert.match((await workspace.get('profile')).content, /\| 新增 \| 我想减肥 \|/);
  await chat.send('怎么做？');
  assert.deepEqual(calls, ['extractor', 'assistant', 'assistant']);
}));

test('a conversation failure after writing retains the record and returns a reliable acknowledgement', async () => fixture(async (root, workspace) => {
  let calls = 0;
  const originalError = console.error;
  console.error = () => {};
  try {
    const chat = createChat(root, workspace, { get: () => ({ baseUrl: 'https://example.test/v1', model: 'test' }) }, async () => {
      calls++;
      if (calls === 1) return JSON.stringify({ actions: [{ type: 'record', category: '阅读', quote: '今天读了 20 页' }] });
      throw new Error('network');
    });
    const result = await chat.send('今天读了 20 页', 'weixin:one');
    assert.match(result.answer.text, /已保存的内容不受影响/);
    assert.equal(result.answer.written.length, 1);
    await chat.send('今天读了 20 页', 'weixin:one');
    assert.equal(calls, 2);
    assert.match((await workspace.get('record', result.answer.written[0].category, result.answer.written[0].date)).content, /今天读了 20 页/);
  } finally { console.error = originalError; }
}));

test('goal memory preserves original wording, deduplicates, and records a later stop', async () => fixture(async (root, workspace) => {
  await workspace.appendGoal('我想持续学习英语', 'active', '2026-10-26');
  const duplicate = await workspace.appendGoal('我想持续学习英语', 'active', '2026-10-27');
  assert.equal(duplicate.duplicate, true);
  await workspace.appendGoal('我不想继续学英语了', 'stopped', '2026-10-27');
  const profile = (await workspace.get('profile')).content;
  assert.equal(profile.match(/我想持续学习英语/g).length, 1);
  assert.match(profile, /\| 2026-10-27 \| 停止 \| 我不想继续学英语了 \|/);
}));

test('both Agent calls share one 90 second reply deadline', async () => fixture(async (root, workspace) => {
  const timeouts = [];
  const chat = createChat(root, workspace, { get: () => ({ baseUrl: 'https://example.test/v1', model: 'test' }) }, async (_config, _messages, _fetch, timeout) => {
    timeouts.push(timeout);
    if (timeouts.length === 1) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return JSON.stringify({ actions: [] });
    }
    return JSON.stringify({ reply: '收到。' });
  });
  await chat.send('今天有点忙');
  assert.equal(timeouts.length, 2);
  assert.ok(timeouts[0] <= 90_000 && timeouts[0] > 89_000);
  assert.ok(timeouts[1] < timeouts[0]);
}));
