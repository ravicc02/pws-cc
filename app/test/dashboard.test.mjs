import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../server/workspace.mjs';
import { extractObservations, buildDashboard, analyzeDashboard } from '../server/dashboard.mjs';
import { createDashboardHarness } from '../server/dashboard-harness.mjs';

const shift = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

test('Markdown extraction accepts explicit scalar list and table cells but not plans or ambiguous weights', () => {
  const record = { category: 'fitness', name: '健身', date: '2026-10-25' };
  const content = '# 训练\n\n- 卧推: 100 kg\n- 卧推片重: 60 kg\n- 计划卧推片重: 80 kg\n\n| 指标 | 数值 | 单位 |\n| --- | --- | --- |\n| 深蹲总重 | 90 | kg |\n\n## 训练计划\n\n- 卧推片重: 120 kg\n';
  const result = extractObservations(content, record);
  assert.deepEqual(result.map((item) => [item.label, item.value, item.unit]), [['卧推片重', 60, 'kg'], ['深蹲总重', 90, 'kg']]);
  assert.equal(extractObservations('- 睡眠质量: 9/5\n- 睡眠时长: 7 小时\n', { category: 'sleep', name: '睡眠', date: record.date }).length, 1);
  assert.deepEqual(extractObservations('- 昨晚睡了7小时\n', { category: 'sleep', name: '睡眠', date: record.date }).map((item) => item.value), [7]);
  assert.deepEqual(extractObservations('- 昨晚睡了7小时\n', { category: 'topic-abc', name: '睡眠', date: record.date }).map((item) => item.value), [7]);
  assert.equal(extractObservations('- 卧推: 100 kg\n', { category: 'topic-abc', name: '健身', date: record.date }).length, 0);
  assert.deepEqual(extractObservations('- 摄入热量: 1800 kcal\n', { category: 'diet', name: '饮食', date: record.date }).map((item) => item.unit), ['kcal']);
  assert.deepEqual(extractObservations('- 静息心率: 68 bpm\n', { category: 'health', name: '健康', date: record.date }).map((item) => item.value), [68]);
  assert.equal(extractObservations('- 计划睡7小时\n', { category: 'sleep', name: '睡眠', date: record.date }).length, 0);
});

test('dashboard compares complete days, preserves missing days and invalidates after source edits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pws-dashboard-'));
  try {
    await writeFile(path.join(root, 'info.md'), '# Profile\n');
    const workspace = createWorkspace(root);
    const category = await workspace.ensureCategory('Sleep');
    const today = '2026-10-26';
    for (let i = 0; i < 16; i++) {
      const date = shift(today, -8 - i);
      await workspace.save({ kind: 'record', category: category.slug, date, content: '- 睡眠时长: 8 小时\n', revision: '' });
    }
    for (let i = 1; i <= 4; i++) {
      const date = shift(today, -i);
      await workspace.save({ kind: 'record', category: category.slug, date, content: '- 睡眠时长: 7 小时\n', revision: '' });
    }
    const dashboard = await buildDashboard(workspace, 7, today);
    assert.equal(dashboard.recent.start, '2026-10-19');
    assert.equal(dashboard.baseline.end, '2026-10-18');
    assert.equal(dashboard.coverage.length, 7);
    const metric = dashboard.metrics[0];
    assert.equal(metric.comparable, true);
    assert.equal(metric.delta, -1);
    assert.equal(metric.direction, 'down');
    assert.equal(metric.recentDays, 4);
    assert.equal(metric.baselineDays, 16);
    assert.equal(dashboard.coverage.filter((day) => day.categories === 0).length, 3);
    assert.equal(dashboard.todayRecords, 0);
    await workspace.save({ kind: 'record', category: category.slug, date: today, content: '- 睡眠时长: 6 小时\n', revision: '' });
    const withToday = await buildDashboard(workspace, 7, today);
    assert.equal(withToday.todayRecords, 1);
    assert.equal(withToday.metrics[0].recentValue, 7);
    assert.equal(withToday.metrics[0].points.at(-1).date, today);
    assert.notEqual(withToday.revision, dashboard.revision);
    await workspace.save({ kind: 'review', date: shift(today, -1), content: '今天感觉专注。', revision: '' });
    const withReview = await buildDashboard(workspace, 7, today);
    assert.notEqual(withReview.revision, withToday.revision);
    assert.equal(withReview.evidence.some((item) => item.kind === 'review'), true);
    const source = dashboard.sources.find((item) => item.date === shift(today, -1));
    assert.equal(source.category, category.slug);
    const item = await workspace.get('record', category.slug, source.date);
    await workspace.save({ kind: 'record', category: category.slug, date: source.date, content: '- 睡眠时长: 6 小时\n', revision: item.revision });
    assert.notEqual((await buildDashboard(workspace, 7, today)).revision, dashboard.revision);
    assert.equal((await buildDashboard(workspace, 30, today)).metrics[0].comparable, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('AI trend analysis uses only computed comparisons and validates cited metrics', async () => {
  const metric = { id: 'sleep:duration:h', label: '睡眠时长', unit: 'h', recentValue: 7, baselineValue: 8, delta: -1, direction: 'down', recentDays: 4, baselineDays: 16, recentCoverage: 0.57, baselineCoverage: 0.57, evidenceIds: ['a', 'b'], comparable: true };
  const dashboard = { today: '2026-10-26', recent: { start: '2026-10-19', end: '2026-10-25', days: 7 }, baseline: { start: '2026-09-21', end: '2026-10-18' },
    metrics: [metric], coverage: [{ date: '2026-10-25', categories: 1 }], categoryActivity: [], evidence: [{ id: 'record:1', kind: 'record', category: 'sleep', date: '2026-10-25', excerpt: '睡眠时长: 7 小时' }] };
  const value = await analyzeDashboard(dashboard, {}, async (_config, messages) => {
    const sent = JSON.parse(messages[1].content);
    assert.equal(sent.comparison[0].delta, -1);
    assert.equal(sent.comparison[0].comparable, true);
    assert.equal(sent.evidence[0].id, 'record:1');
    return JSON.stringify({ kind: 'overview', summary: '睡眠时长有可比变化。', insights: [{ dimension: 'metric', statement: '近期有记录的睡眠时长数值方向偏低。', evidenceIds: ['a'] }], limitations: ['两期记录并非每天都有。'], nextStep: '接下来继续记录睡眠和白天感受。' });
  });
  assert.equal(value.kind, 'overview');
  assert.ok(value.facts.some((fact) => fact.text.includes('数值变化 -1 h')));
  const withFactReferences = await analyzeDashboard(dashboard, {}, async () => JSON.stringify({ kind: 'overview', summary: '按可比口径统计。',
    insights: [{ dimension: 'metric', statement: '近期睡眠数值下降。', evidenceIds: ['metric:sleep:duration:h'] },
      { dimension: 'coverage', statement: '近期留下记录。', evidenceIds: ['coverage:recent'] }], limitations: [], nextStep: '继续观察睡眠记录。' }));
  assert.equal(withFactReferences.insights.length, 2);
  const rejected = await analyzeDashboard(dashboard, {}, async () => JSON.stringify({ ...value, insights: [{ dimension: 'metric', statement: '伪造', evidenceIds: ['fake'] }] }));
  assert.equal(rejected.analysisMode, 'computed');
  assert.equal(rejected.insights[0].evidenceIds[0], 'metric:sleep:duration:h');
  const qualitative = await analyzeDashboard({ ...dashboard, metrics: [{ ...metric, comparable: false }] }, {}, async () => JSON.stringify({ kind: 'overview', summary: '有睡眠记录。',
    insights: [{ dimension: 'activity', statement: '近期留下了睡眠记录。', evidenceIds: ['record:1'] }], limitations: ['无法比较数值。'], nextStep: '再积累几天同口径记录。' }));
  assert.equal(qualitative.insights[0].dimension, 'activity');
  const empty = await analyzeDashboard({ ...dashboard, evidence: [], metrics: [] }, {}, () => { throw new Error('model must not run'); });
  assert.equal(empty.kind, 'empty');
});

test('daily analysis harness caches by data revision and deduplicates concurrent requests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pws-harness-'));
  try {
    let calls = 0;
    const make = () => createDashboardHarness(root, async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { kind: 'overview', summary: '有记录', generatedAt: new Date().toISOString() };
    });
    const dashboard = { recent: { days: 7 }, revision: 'first', evidence: [{ id: 'record:1' }] };
    const config = { baseUrl: 'https://model.test/v1', model: 'test', apiKey: 'secret' };
    const harness = make();
    const [a, b] = await Promise.all([harness.get(dashboard, config), harness.get(dashboard, config)]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    await make().get(dashboard, config);
    assert.equal(calls, 1);
    await harness.get({ ...dashboard, revision: 'second' }, config);
    assert.equal(calls, 2);
    assert.equal((await harness.get(dashboard, {})).kind, 'unconfigured');
    const empty = await createDashboardHarness(root, async () => ({ kind: 'empty', summary: '无记录' })).get({ ...dashboard, revision: 'empty', evidence: [] }, {});
    assert.equal(empty.kind, 'empty');
  } finally { await rm(root, { recursive: true, force: true }); }
});
