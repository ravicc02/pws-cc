import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { ArrowRight, ChartNoAxesCombined, ChevronDown, FileText, RefreshCw, Sparkles } from 'lucide-react';

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

const datesBetween = (start, end) => {
  const result = [];
  for (let at = new Date(`${start}T00:00:00Z`); at <= new Date(`${end}T00:00:00Z`); at.setUTCDate(at.getUTCDate() + 1)) result.push(at.toISOString().slice(0, 10));
  return result;
};

function TrendChart({ metric, baseline, recent, today }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !metric) return undefined;
    const chart = echarts.init(ref.current);
    const hasBaselinePoints = metric.points.some((point) => point.date < recent.start);
    const dates = datesBetween(hasBaselinePoints ? baseline.start : recent.start, today);
    const values = new Map(metric.points.map((point) => [point.date, point.value]));
    chart.setOption({
      animation: false,
      grid: { left: 48, right: 20, top: 26, bottom: 48 },
      tooltip: { trigger: 'axis', formatter: (items) => {
        const item = items[0];
        return item?.value == null ? `${item?.axisValue || ''} · 未记录` : `${item.axisValue}${item.axisValue === today ? ' · 今日进行中' : ''} · ${item.value} ${metric.unit}`;
      } },
      xAxis: { type: 'category', data: dates, axisLabel: { color: '#71847a', hideOverlap: true, formatter: (value) => value.slice(5) }, axisLine: { lineStyle: { color: '#dce6de' } }, axisTick: { show: false } },
      yAxis: { type: 'value', scale: true, axisLabel: { color: '#71847a' }, splitLine: { lineStyle: { color: '#eaf0eb' } } },
      series: [{ type: 'line', data: dates.map((date) => values.get(date) ?? null), connectNulls: false, showSymbol: true,
        symbolSize: 6, lineStyle: { color: '#287455', width: 2 }, itemStyle: { color: '#287455' },
        markLine: metric.baselineValue == null ? undefined : { silent: true, symbol: 'none', label: { formatter: '过去均值', position: 'insideEndTop', color: '#956d32' }, lineStyle: { color: '#c5944a', type: 'dashed' }, data: [{ yAxis: metric.baselineValue }] },
      }],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [metric, baseline, recent, today]);
  return <div className="dashboard-chart" ref={ref} role="img" aria-label={`${metric.label}按日期的记录趋势；缺失日期保持空白`} />;
}

function AnalysisChanges({ metrics }) {
  const comparable = metrics.filter((metric) => metric.comparable && metric.baselineValue != null && metric.recentValue != null);
  if (!comparable.length) return null;
  return <div className="dashboard-analysis-chart" aria-label="各指标近期与过去均值对比">
    <h3>同口径均值对比</h3>
    <div className="dashboard-analysis-legend"><span>过去</span><span>近期</span></div>
    <div className="dashboard-analysis-chart-grid">{comparable.map((metric) => {
      const maximum = Math.max(metric.baselineValue, metric.recentValue, 0.01);
      return <div className="dashboard-analysis-metric" key={metric.id}>
        <strong>{metric.categoryName} · {metric.label}</strong>
        <div className="dashboard-analysis-bar"><span style={{ width: `${100 * metric.baselineValue / maximum}%` }} /><small>{metric.baselineValue} {metric.unit}</small></div>
        <div className="dashboard-analysis-bar recent"><span style={{ width: `${100 * metric.recentValue / maximum}%` }} /><small>{metric.recentValue} {metric.unit}</small></div>
        <p>过去 {metric.baselineDays} 天有值 · 近期 {metric.recentDays} 天有值</p>
      </div>;
    })}</div>
  </div>;
}

export default function Dashboard({ request, onOpen, onRecords, onModel }) {
  const [windowDays, setWindowDays] = useState(7);
  const [dashboard, setDashboard] = useState(null);
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const sequence = useRef(0);

  async function reload(days = windowDays) {
    const current = ++sequence.current;
    setBusy('refresh'); setError('');
    try {
      const data = await request(`/dashboard?window=${days}`);
      if (current !== sequence.current) return;
      setDashboard(data);
      setSelectedId((current) => data.metrics.some((metric) => metric.id === current) ? current : data.metrics[0]?.id || null);
      setAnalysis((previous) => previous?.revision === data.revision ? previous : null);
      const result = await request('/dashboard/analysis', { method: 'POST', body: JSON.stringify({ window: days, revision: data.revision }) });
      if (current === sequence.current) setAnalysis(result);
    } catch (cause) { if (current === sequence.current) setError(cause.message); }
    finally { if (current === sequence.current) setBusy(''); }
  }

  useEffect(() => {
    reload(windowDays);
    const timer = setInterval(() => { if (!document.hidden) reload(windowDays); }, 60_000);
    const visible = () => { if (!document.hidden) reload(windowDays); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); sequence.current++; };
  }, [windowDays]);

  const metrics = dashboard?.metrics.filter((metric) => category === 'all' || metric.category === category) || [];
  const selected = metrics.find((metric) => metric.id === selectedId) || metrics[0];
  const sources = dashboard?.sources.filter((source) => selected?.evidenceIds.includes(source.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12) || [];
  const recordedDays = dashboard?.coverage.filter((day) => day.categories > 0).length || 0;
  const comparableCount = dashboard?.metrics.filter((metric) => metric.comparable).length || 0;
  const evidence = (id) => dashboard?.evidence?.find((item) => item.id === id) || dashboard?.sources?.find((item) => item.id === id);

  return <div className="dashboard-view">
    <div className="dashboard-controls">
      <div className="period-switch" aria-label="对比周期">{[7, 30].map((days) => <button key={days} className={windowDays === days ? 'selected' : ''} onClick={() => setWindowDays(days)}>{days} 天</button>)}</div>
      <span className="dashboard-period" title={`${dashboard?.baseline.start} 至 ${dashboard?.baseline.end} vs ${dashboard?.recent.start} 至 ${dashboard?.recent.end}`}>
        {dashboard?.baseline.start.slice(5)}–{dashboard?.baseline.end.slice(5)} <span>vs</span> {dashboard?.recent.start.slice(5)}–{dashboard?.recent.end.slice(5)} · 今日 {dashboard?.todayRecords ?? 0} 条
      </span>
      <button className="icon-button" title="刷新仪表盘" aria-label="刷新仪表盘" disabled={Boolean(busy)} onClick={() => reload()}><RefreshCw size={18} /></button>
    </div>
    {error && <div className="notice error" role="status">{error}</div>}
    <div className="dashboard-summary">
      <div><small>近期记录天数</small><strong>{recordedDays}<span> / {windowDays}</span></strong></div>
      <div><small>明确数值指标</small><strong>{dashboard?.metrics.length ?? '—'}</strong></div>
      <div><small>可对比趋势</small><strong>{comparableCount}</strong></div>
    </div>
    <section className="dashboard-coverage"><div className="section-head"><h2>记录覆盖</h2><span>未记录不等于没有活动</span></div>
      <div className="coverage-days" aria-label="近期每日记录覆盖">{dashboard?.coverage.map((day) => <div key={day.date} className="coverage-day" title={`${day.date} · ${day.categories} 个分区`}><span className={`coverage-block ${day.categories ? 'has-record' : 'missing'}`} aria-label={`${day.date}：${day.categories ? `${day.categories} 个分区` : '未记录'}`} /><time dateTime={day.date}>{day.date.slice(5)}</time></div>)}</div>
    </section>
    <section className="dashboard-trends"><div className="section-head"><h2>指标趋势</h2><select aria-label="筛选分类" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">全部分类</option>{dashboard?.categories.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></div>
      {metrics.length ? <div className="dashboard-trend-grid"><div className="dashboard-metric-list">{metrics.map((metric) => <button key={metric.id} className={selected?.id === metric.id ? 'selected' : ''} onClick={() => setSelectedId(metric.id)}><span>{metric.categoryName} · {metric.label}</span><strong>{metric.recentValue ?? '—'} <small>{metric.unit}</small></strong><em>{metric.comparable ? `${metric.delta > 0 ? '+' : ''}${metric.delta} ${metric.unit}` : '数据不足'}</em></button>)}</div><div className="dashboard-detail">
        <div className="dashboard-detail-head"><div><small>{selected.categoryName} / 每日记录</small><h3>{selected.label}</h3></div><span>{selected.recentDays}/{dashboard.recent.days} 天 · 过去 {selected.baselineDays}/{dashboard.baseline.days} 天</span></div>
        <TrendChart metric={selected} baseline={dashboard.baseline} recent={dashboard.recent} today={dashboard.today} />
        <div className="dashboard-comparison"><div><small>过去均值</small><strong>{selected.baselineValue ?? '—'} {selected.unit}</strong></div><div><small>近期均值</small><strong>{selected.recentValue ?? '—'} {selected.unit}</strong></div><div><small>数值变化</small><strong>{selected.comparable ? `${selected.delta > 0 ? '+' : ''}${selected.delta} ${selected.unit}` : '暂不能判断'}</strong></div></div>
        <details className="dashboard-sources" key={selected.id}><summary>记录依据 <span>{sources.length} 条 <ChevronDown size={15} /></span></summary>{sources.map((source) => <button key={source.id} onClick={() => onOpen({ kind: 'record', category: source.category, date: source.date })}><span>{source.date} · {source.sourceQuote}</span><ArrowRight size={15} /></button>)}</details>
      </div></div> : <div className="dashboard-empty"><ChartNoAxesCombined size={27} /><h3>暂无可绘制的数值记录</h3><p>明确填写的数值和单位会出现在这里；原始内容仍可在资料中查看。</p><button className="outline-button" onClick={onRecords}><FileText size={16} /> 查看每日记录</button></div>}
    </section>
    <section className="dashboard-analysis"><div className="section-head"><h2>{analysis?.analysisMode === 'computed' ? '状态趋势分析' : 'AI 状态趋势分析'}</h2><span>自动更新 · {analysis?.generatedAt ? new Date(analysis.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '等待数据'}</span></div>
      <div className="dashboard-analysis-body"><Sparkles size={21} /><div className="dashboard-analysis-content">
        <strong>{analysis?.summary || (busy ? '正在读取最近的记录…' : '尚无可用分析')}</strong>
        {dashboard && <AnalysisChanges metrics={dashboard.metrics} />}
        {analysis?.facts?.length > 0 && <div className="dashboard-analysis-facts">{analysis.facts.map((fact) => <p key={fact.id}>{fact.text}</p>)}</div>}
        {analysis?.insights?.length > 0 && <div className="dashboard-insights">{analysis.insights.map((item, i) => <div key={i} className="dashboard-insight"><small>{{ coverage: '记录覆盖', metric: '数值变化', activity: '分类记录', reflection: '复盘观察' }[item.dimension]}</small><p>{item.statement}</p><div>{item.evidenceIds.map((id) => { const source = evidence(id); const fact = analysis.facts?.find((entry) => entry.id === id); return source ? <button key={id} onClick={() => onOpen({ kind: source.kind || 'record', category: source.category, date: source.date })}>{source.date} · {source.categoryName || source.category || '复盘'} <ArrowRight size={12} /></button> : fact ? <span key={id} className="dashboard-fact-source" title={fact.text}>{fact.text}</span> : null; })}</div></div>)}</div>}
        {analysis?.limitations?.map((item, i) => <p className="dashboard-limitation" key={i}>{item}</p>)}
        {analysis?.nextStep && <div className="dashboard-next-step"><strong>下一步</strong><p>{analysis.nextStep}</p></div>}
        {analysis?.kind === 'unconfigured' && <button className="text-action" onClick={onModel}>配置模型 <ArrowRight size={15} /></button>}
      </div></div>
    </section>
  </div>;
}
