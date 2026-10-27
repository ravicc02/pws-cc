import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dateInZone, makeBrief, timeInZone, validTime, shouldDeliver, shouldRemind, getTemplate, saveTemplate, renderTemplate, sampleBrief } from '../server/review.mjs';

test('calendar uses Asia/Shanghai rather than server local time', () => {
  const instant = new Date('2026-10-24T16:30:00Z');
  assert.equal(dateInZone(instant), '2026-10-25');
  assert.equal(timeInZone(instant), '00:30');
});

test('schedule time validation rejects malformed and impossible times', () => {
  assert.equal(validTime('21:30'), true);
  for (const value of ['24:00', '9:30', '23:61', 'foo', null]) assert.equal(validTime(value), false);
});

test('scheduler runs once at or after the configured local time', () => {
  const schedule = { enabled: true, time: '21:30' };
  assert.equal(shouldDeliver(schedule, null, '2026-10-25', '21:29', true), false);
  assert.equal(shouldDeliver(schedule, null, '2026-10-25', '21:30', true), true);
  assert.equal(shouldDeliver(schedule, { date: '2026-10-25', status: 'accepted' }, '2026-10-25', '21:31', true), false);
  assert.equal(shouldDeliver(schedule, null, '2026-10-25', '22:00', false), false);
});

test('reminder only runs when no records exist and has not been accepted already', () => {
  const reminder = { enabled: true, time: '20:00' };
  assert.equal(shouldRemind(reminder, null, '2026-10-26', '19:59', true, 0), false);
  assert.equal(shouldRemind(reminder, null, '2026-10-26', '20:00', true, 0), true);
  assert.equal(shouldRemind(reminder, null, '2026-10-26', '20:00', true, 1), false);
  assert.equal(shouldRemind(reminder, { date: '2026-10-26', status: 'accepted' }, '2026-10-26', '20:01', true, 0), false);
});

test('template validates placeholders and renders the same saved format for brief and sample', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-template-'));
  try {
    const current = await getTemplate(root);
    const content = '日期 {{date}} · {{count}} 类\n{{content}}';
    const saved = await saveTemplate(root, content, current.revision);
    assert.equal(renderTemplate(saved.content, sampleBrief), '日期 2026-10-26 · 2 类\n' + sampleBrief.content);
    await assert.rejects(() => saveTemplate(root, 'No body', saved.revision), /内容占位符/);
    await assert.rejects(() => saveTemplate(root, content, current.revision), /模板已被更新/);
    const folder = path.join(root, 'record', 'fitness', '2026', '10');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, '2026-10-26.md'), '卧推 100kg');
    const brief = await makeBrief(root, '2026-10-26');
    assert.match(brief.text, /^日期 2026-10-26 · 1 类/);
    assert.match(brief.text, /卧推 100kg/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('brief uses dated records from all categories, not rules or other days', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-workspace-'));
  try {
    const folder = path.join(root, 'record', 'fitness', '2026', '10');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, '2026-10-25.md'), '# Training\nBench press 100 kg\n');
    await writeFile(path.join(folder, '2026-10-24.md'), 'Yesterday\n');
    await writeFile(path.join(root, 'record', 'fitness', 'rute.md'), 'Rule only\n');
    const brief = await makeBrief(root, '2026-10-25');
    assert.equal(brief.count, 1);
    assert.match(brief.text, /Bench press 100 kg/);
    assert.doesNotMatch(brief.text, /Yesterday|Rule only/);
    assert.equal((await makeBrief(root, '2026-10-26')).text, '');
    const reviewDir = path.join(root, 'review', 'daily', '2026', '10');
    await mkdir(reviewDir, { recursive: true });
    await writeFile(path.join(reviewDir, '2026-10-25.md'), '# My review\nKeep training.\n');
    const independent = await makeBrief(root, '2026-10-25');
    assert.equal(independent.source, 'records');
    assert.equal(independent.demo, false);
    assert.doesNotMatch(independent.text, /Keep training/);
    assert.match(independent.text, /Bench press/);
    await writeFile(path.join(folder, '2026-10-25.md'), '# Training\n\n> 演示数据（虚构，不代表用户实际状态；请勿当成真实个人记录）\n\n卧推 100kg\n- 来源：模拟数值。\n');
    const generated = await makeBrief(root, '2026-10-25');
    assert.equal(generated.demo, true);
    assert.match(generated.text, /卧推 100kg/);
    assert.doesNotMatch(generated.text, /演示|模拟|虚构/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
