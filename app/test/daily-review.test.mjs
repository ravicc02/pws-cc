import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../server/workspace.mjs';
import { getQuestions, saveQuestions, formatQuestions, reviewAnswer, appendReviewAnswer } from '../server/daily-review.mjs';
import { textFromMessage } from '../server/weixin.mjs';
import { makeBrief } from '../server/review.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'daily-review-'));
  try { return await run(root, createWorkspace(root)); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('review questions are versioned independently from brief template', async () => fixture(async (root) => {
  const original = await getQuestions(root);
  assert.equal(original.questions.length, 3);
  const saved = await saveQuestions(root, ['今天做成了什么？', '明天怎么改？'], original.revision);
  assert.match(formatQuestions('2026-10-26', saved.questions), /回复“复盘：你的回答”/);
  assert.equal((await getQuestions(root)).questions.length, 2);
  await assert.rejects(() => saveQuestions(root, ['覆盖'], original.revision), /已更改/);
  await assert.rejects(() => saveQuestions(root, ['']), /1 到 8 个问题/);
}));

test('only explicit Weixin review replies are preserved, deduplicated and excluded from brief', async () => fixture(async (root, workspace) => {
  assert.equal(reviewAnswer('今天卧推 100kg'), null);
  assert.equal(reviewAnswer('复盘：完成训练'), '完成训练');
  assert.equal(reviewAnswer('2. 明天继续'), '2. 明天继续');
  assert.equal(textFromMessage({ item_list: [{ type: 1, text_item: { text: '复盘：完成训练' } }, { type: 2 }] }), '复盘：完成训练');
  const date = '2026-10-26';
  const questions = ['今天做成了什么？'];
  const first = await appendReviewAnswer(workspace, date, questions, '复盘：完成训练', 'message-1');
  assert.match(first.content, /今天做成了什么/);
  assert.match(first.content, /完成训练/);
  const again = await appendReviewAnswer(workspace, date, questions, '复盘：完成训练', 'message-1');
  assert.equal(again.content, first.content);
  const more = await appendReviewAnswer(workspace, date, questions, '2. 明天继续', 'message-2');
  assert.match(more.content, /补充回答[\s\S]*2\. 明天继续/);
  assert.equal((await makeBrief(root, date)).text, '');
  const saved = await workspace.save({ kind: 'review', date, content: `${more.content}\n补充思考。\n`, revision: more.revision });
  assert.match(saved.content, /补充思考/);
}));

test('review history lists every saved date and preserves successive replies', async () => fixture(async (_root, workspace) => {
  const questions = ['今天做成了什么？'];
  await appendReviewAnswer(workspace, '2026-10-24', questions, '复盘：完成了阅读', 'history-1');
  await appendReviewAnswer(workspace, '2026-10-26', questions, '复盘：完成了训练', 'history-2');
  await appendReviewAnswer(workspace, '2026-10-26', questions, '2. 明天继续', 'history-3');
  assert.deepEqual((await workspace.list()).reviews.map(({ date }) => date), ['2026-10-26', '2026-10-24']);
  const latest = await workspace.get('review', null, '2026-10-26');
  assert.match(latest.content, /完成了训练/);
  assert.match(latest.content, /明天继续/);
  assert.match((await workspace.get('review', null, '2026-10-24')).content, /完成了阅读/);
}));
