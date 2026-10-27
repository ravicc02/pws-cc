import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { dateInZone } from './review.mjs';
import { activeModelConfig, completeChat } from './model.mjs';
import { DASHBOARD_TREND_PROMPT } from './dashboard-prompt.mjs';

const parser = unified().use(remarkParse).use(remarkGfm);
const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);
const shift = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const plain = (node) => node.value || (node.children || []).map(plain).join('');
const round = (value) => Math.round(value * 100) / 100;

function explicitValue(line) {
  const match = line.trim().match(/^([^:：|]{1,32})\s*[:：]\s*(\d+(?:\.\d+)?)\s*(小时|h|分钟|kcal|bpm|kg|公斤|km|公里|步|次|分|%|\/\s*5|分\s*\/\s*5)\s*$/i);
  if (!match || /计划|目标|预计|建议|上限|下限/.test(match[1])) return null;
  const label = match[1].trim();
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  let unit = match[3].replace(/\s/g, '').toLowerCase();
  unit = ({ '小时': 'h', '公斤': 'kg', '公里': 'km', '分钟': 'min', '分/5': '/5' })[unit] || unit;
  if (unit === '/5' && (value < 1 || value > 5)) return null;
  return { label, value, unit };
}

export function extractObservations(content, record) {
  const lines = [];
  const visit = (node) => {
    if (node.type === 'paragraph') lines.push(plain(node));
    else if (node.type === 'table') {
      const rows = node.children.map((row) => row.children.map(plain));
      const headers = rows[0] || [];
      const label = headers.findIndex((item) => /^(指标|项目|名称)$/.test(item.trim()));
      const value = headers.findIndex((item) => /^(数值|数据|值)$/.test(item.trim()));
      const unit = headers.findIndex((item) => /^(单位)$/.test(item.trim()));
      if (label >= 0 && value >= 0) for (const row of rows.slice(1)) lines.push(`${row[label]}: ${row[value]} ${unit >= 0 ? row[unit] : ''}`);
    } else if (node.type !== 'code' && node.type !== 'heading') (node.children || []).forEach(visit);
  };
  let excludedDepth = null;
  for (const node of parser.parse(content).children) {
    if (node.type === 'heading') {
      if (excludedDepth !== null && node.depth <= excludedDepth) excludedDepth = null;
      if (/计划|目标|模板|建议/.test(plain(node))) excludedDepth = node.depth;
    } else if (excludedDepth === null) visit(node);
  }
  const isSleep = record.category === 'sleep' || /睡眠/.test(record.name);
  const isMood = /^(mood|emotion)$/.test(record.category) || /心情|情绪/.test(record.name);
  const isFitness = record.category === 'fitness' || /健身|训练/.test(record.name);
  return lines.flatMap((line, index) => {
    let parsed = explicitValue(line);
    if (!parsed && isSleep) {
      const natural = line.trim().match(/^(?:今天|昨晚|昨天|前天)?\s*睡了\s*(\d+(?:\.\d+)?)\s*(小时|h)\s*[。.!！]?$/i);
      if (natural) parsed = { label: '睡眠时长', value: Number(natural[1]), unit: 'h' };
    }
    if (!parsed && isMood) {
      const natural = line.trim().match(/^(?:今天)?\s*心情\s*(\d(?:\.\d+)?)\s*\/\s*5\s*[。.!！]?$/);
      if (natural) parsed = { label: '心情评分', value: Number(natural[1]), unit: '/5' };
    }
    if (!parsed) return [];
    if (parsed.unit === '/5' && (parsed.value < 1 || parsed.value > 5)) return [];
    if (isFitness && parsed.unit === 'kg' && !/片重|总重|单只|配重/.test(parsed.label)) return [];
    const label = isSleep && /^(睡眠时长|睡了多久)$/.test(parsed.label) ? '睡眠时长' : parsed.label;
    return [{ id: digest(`${record.category}:${record.date}:${index}:${line}`), category: record.category, categoryName: record.name,
      date: record.date, metric: `${record.category}:${label}:${parsed.unit}`, label, value: parsed.value, unit: parsed.unit,
      sourceQuote: line.trim().slice(0, 160), origin: 'manual' }];
  });
}

function perDay(points) {
  const grouped = new Map();
  for (const point of points) grouped.set(point.date, [...(grouped.get(point.date) || []), point]);
  return [...grouped].map(([date, items]) => ({ date, value: round(items.reduce((sum, item) => sum + item.value, 0) / items.length), sourceIds: items.map((item) => item.id) })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function buildDashboard(workspace, windowDays = 7, today = dateInZone()) {
  if (![7, 30].includes(windowDays)) throw new Error('仅支持 7 天或 30 天趋势。');
  const baselineDays = windowDays === 7 ? 28 : 90;
  const recent = { start: shift(today, -windowDays), end: shift(today, -1), days: windowDays };
  const baseline = { start: shift(today, -windowDays - baselineDays), end: shift(today, -windowDays - 1), days: baselineDays };
  const index = await workspace.list();
  const profile = await workspace.get('profile');
  const profileTitle = profile.content.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
  const files = index.records.filter((item) => item.date >= baseline.start && item.date <= today);
  const content = await Promise.all(files.map((item) => workspace.get('record', item.category, item.date)));
  const reviews = index.reviews.filter((item) => item.date >= baseline.start && item.date <= today);
  const reviewContent = await Promise.all(reviews.map((item) => workspace.get('review', null, item.date)));
  const observations = files.flatMap((item, i) => extractObservations(content[i].content, item));
  const grouped = new Map();
  for (const point of observations) grouped.set(point.metric, [...(grouped.get(point.metric) || []), point]);
  const metrics = [...grouped].map(([id, points]) => {
    const days = perDay(points);
    const current = days.filter((point) => point.date >= recent.start && point.date <= recent.end);
    const previous = days.filter((point) => point.date < recent.start);
    const recentCoverage = current.length / windowDays;
    const baselineCoverage = previous.length / baselineDays;
    const comparable = current.length >= 4 && previous.length >= 4 && Math.abs(recentCoverage - baselineCoverage) <= 0.2;
    const recentValue = current.length ? round(current.reduce((sum, point) => sum + point.value, 0) / current.length) : null;
    const baselineValue = previous.length ? round(previous.reduce((sum, point) => sum + point.value, 0) / previous.length) : null;
    const delta = comparable ? round(recentValue - baselineValue) : null;
    return { id, label: points[0].label, category: points[0].category, categoryName: points[0].categoryName,
      unit: points[0].unit, origin: 'manual', recentValue, baselineValue, delta, direction: delta === null ? 'unknown' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      recentDays: current.length, baselineDays: previous.length, recentCoverage: round(recentCoverage), baselineCoverage: round(baselineCoverage), comparable,
      points: days, evidenceIds: points.filter((point) => point.date <= recent.end).map((point) => point.id) };
  }).sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'zh-CN') || a.label.localeCompare(b.label, 'zh-CN'));
  const coverage = Array.from({ length: windowDays }, (_, index) => {
    const date = shift(recent.start, index);
    return { date, categories: [...new Set(files.filter((file) => file.date === date).map((file) => file.category))].length };
  });
  const sources = observations.map(({ id, category, date, sourceQuote }) => ({ id, category, date, sourceQuote }));
  const evidence = [
    ...files.map((file, i) => ({ id: `record:${digest(`${file.category}:${file.date}:${content[i].revision}`)}`, kind: 'record', category: file.category,
      categoryName: file.name, date: file.date, excerpt: content[i].content.trim().slice(0, 240) })),
    ...reviews.map((file, i) => ({ id: `review:${digest(`${file.date}:${reviewContent[i].revision}`)}`, kind: 'review', date: file.date,
      excerpt: reviewContent[i].content.trim().slice(0, 240) })),
  ];
  const categoryActivity = index.categories.map(({ slug, name }) => ({ slug, name,
    recentDays: new Set(files.filter((file) => file.category === slug && file.date >= recent.start && file.date <= recent.end).map((file) => file.date)).size,
    baselineDays: new Set(files.filter((file) => file.category === slug && file.date >= baseline.start && file.date <= baseline.end).map((file) => file.date)).size,
    today: files.some((file) => file.category === slug && file.date === today),
  })).filter((item) => item.recentDays || item.baselineDays || item.today);
  const revision = digest(JSON.stringify({ files: files.map((file, i) => [file.category, file.date, content[i].revision]),
    reviews: reviews.map((file, i) => [file.date, reviewContent[i].revision]), today, windowDays }));
  const demoCount = [...content, ...reviewContent].filter((item) => item.generated).length;
  const demo = demoCount > 0 && demoCount === content.length + reviewContent.length;
  return { today, recent, baseline, demo, demoCount, profileTitle, categories: index.categories.map(({ slug, name }) => ({ slug, name })), coverage, metrics, sources, evidence,
    categoryActivity, todayRecords: files.filter((file) => file.date === today).length, revision };
}

export async function analyzeDashboard(dashboard, config, complete = completeChat) {
  const comparable = dashboard.metrics.filter((metric) => metric.comparable);
  const evidence = dashboard.evidence || [];
  const recentEvidence = evidence.filter((item) => item.date >= dashboard.recent.start && item.date <= dashboard.recent.end);
  const baselineEvidence = evidence.filter((item) => item.date >= dashboard.baseline.start && item.date <= dashboard.baseline.end);
  const todayEvidence = evidence.filter((item) => item.date === dashboard.today);
  const coverage = dashboard.coverage || [];
  const recordedDays = coverage.filter((day) => day.categories > 0).length;
  const facts = [
    { id: 'coverage:recent', text: `最近 ${dashboard.recent.days} 个完整自然日有 ${recordedDays} 天留下记录；未记录的日期不能视作没有活动。` },
    ...(dashboard.categoryActivity || []).filter((item) => item.recentDays || item.today).map((item) => ({ id: `activity:${item.slug}`,
      text: `${item.name}：近期 ${item.recentDays}/${dashboard.recent.days} 天有记录${item.today ? '，今天另有进行中记录' : ''}。` })),
    ...comparable.map((metric) => ({ id: `metric:${metric.id}`, text: `${metric.categoryName || ''}${metric.label}：近期 ${metric.recentValue} ${metric.unit}（${metric.recentDays} 天），过去 ${metric.baselineValue} ${metric.unit}（${metric.baselineDays} 天），数值变化 ${metric.delta > 0 ? '+' : ''}${metric.delta} ${metric.unit}。` })),
  ];
  if (!recentEvidence.length && !baselineEvidence.length && !todayEvidence.length) {
    return { kind: 'empty', summary: '尚无每日记录或复盘，无法判断个人状态趋势。', insights: [], facts: [], limitations: ['记录空白不代表没有活动。'], nextStep: '今天可以先留下一个简短记录，之后再看变化。', generatedAt: new Date().toISOString() };
  }
  const input = comparable.map(({ id, label, unit, recentValue, baselineValue, delta, direction, recentDays, baselineDays, recentCoverage, baselineCoverage, evidenceIds }) =>
    ({ id, comparable: true, label, unit, recentValue, baselineValue, delta, direction, recentDays, baselineDays, recentCoverage, baselineCoverage, evidenceIds }));
  const selected = [...recentEvidence.slice(-8), ...baselineEvidence.slice(-4), ...todayEvidence.slice(-2)];
  const allowed = new Map([
    ['coverage', new Set(facts.filter((fact) => fact.id === 'coverage:recent' || fact.id.startsWith('activity:')).map((fact) => fact.id))],
    ['metric', new Set([...comparable.flatMap((metric) => metric.evidenceIds), ...facts.filter((fact) => fact.id.startsWith('metric:')).map((fact) => fact.id)])],
    ['activity', new Set([...selected.filter((item) => item.kind === 'record').map((item) => item.id), ...facts.filter((fact) => fact.id.startsWith('activity:')).map((fact) => fact.id)])],
    ['reflection', new Set(selected.filter((item) => item.kind === 'review').map((item) => item.id))],
  ]);
  const computed = () => {
    const changes = comparable.slice(0, 4);
    return { kind: 'overview', analysisMode: 'computed',
      summary: `最近 ${dashboard.recent.days} 天有 ${recordedDays} 天留下记录，${comparable.length} 项指标具有同口径可比数值。`,
      insights: changes.length ? changes.map((metric) => ({ dimension: 'metric',
        statement: `${metric.categoryName || ''}${metric.label}近期均值 ${metric.recentValue} ${metric.unit}，过去均值 ${metric.baselineValue} ${metric.unit}，数值变化 ${metric.delta > 0 ? '+' : ''}${metric.delta} ${metric.unit}。`,
        evidenceIds: [`metric:${metric.id}`] })) : [{ dimension: 'coverage', statement: `最近 ${dashboard.recent.days} 天有 ${recordedDays} 天留下记录。`, evidenceIds: ['coverage:recent'] }],
      facts, limitations: ['仅描述记录数值与覆盖情况；不能据此推断原因或健康改善。'],
      nextStep: changes.length ? `下一步可以继续记录${changes[0].categoryName || ''}${changes[0].label}，同时留意当天的实际感受。` : '下一步先保持简短的每日记录，积累可比较的日期。',
      generatedAt: new Date().toISOString() };
  };
  const raw = await complete(config, [
    { role: 'system', content: DASHBOARD_TREND_PROMPT },
    { role: 'user', content: JSON.stringify({ datasetMode: dashboard.demo ? 'fictional-demo' : dashboard.demoCount ? 'mixed-demo-and-personal' : 'personal-records', today: dashboard.today, recent: dashboard.recent, baseline: dashboard.baseline,
      coverage, categoryActivity: dashboard.categoryActivity || [], comparison: input, facts,
      evidence: selected.map(({ id, kind, categoryName, date, excerpt }) => ({ id, kind, categoryName, date, excerpt: excerpt.slice(0, 140) })) }) },
  ], undefined, 90000);
  let result;
  try { result = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); }
  catch { throw new Error('模型未返回有效的趋势分析。'); }
  const validInsight = (item) => allowed.has(item?.dimension) && typeof item.statement === 'string' && Boolean(item.statement.trim()) && item.statement.length <= 140 &&
    Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0 && item.evidenceIds.length <= 6 && item.evidenceIds.every((id) => allowed.get(item.dimension).has(id));
  if (result?.kind !== 'overview' || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 120 ||
    !Array.isArray(result.insights) || !result.insights.length || result.insights.length > 5 ||
    !Array.isArray(result.limitations) || result.limitations.length > 3 || result.limitations.some((item) => typeof item !== 'string' || item.length > 120) ||
    typeof result.nextStep !== 'string' || !result.nextStep.trim() || result.nextStep.length > 100 ||
    result.insights.some((item) => !validInsight(item)) ||
    [result.summary, ...result.insights.map((item) => item.statement), ...result.limitations, result.nextStep].some((text) => /演示|模拟|虚构|样例/.test(text))) {
    return computed();
  }
  return { kind: 'overview', summary: result.summary.trim(), insights: result.insights, facts, limitations: result.limitations,
    nextStep: result.nextStep.trim(), generatedAt: new Date().toISOString() };
}
