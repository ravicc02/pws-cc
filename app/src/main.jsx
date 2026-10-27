import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { Activity, ArrowRight, Bell, CalendarClock, ChartNoAxesCombined, Check, CircleHelp, Clock3, FileText, Link2, LoaderCircle, MessageCircle, RefreshCw, Send, Settings2, ShieldCheck, Sparkles, FolderOpen, X } from 'lucide-react';
import ModelSettings from './ModelSettings.jsx';
import ContentWorkspace from './ContentWorkspace.jsx';
import ChatWorkspace from './ChatWorkspace.jsx';
import ReviewWorkspace from './ReviewWorkspace.jsx';
import DailyReviewWorkspace from './DailyReviewWorkspace.jsx';
import './style.css';

const Dashboard = lazy(() => import('./Dashboard.jsx'));

async function api(path, options) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function App() {
  const [state, setState] = useState(null);
  const [brief, setBrief] = useState(null);
  const [time, setTime] = useState('21:30');
  const [enabled, setEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState('20:00');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reviewTime, setReviewTime] = useState('20:30');
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [qr, setQr] = useState(null);
  const [qrStatus, setQrStatus] = useState('idle');
  const [verifyCode, setVerifyCode] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [section, setSection] = useState('overview');
  const [contentSelection, setContentSelection] = useState(null);

  const refresh = useCallback(async (preserveForm = false) => {
    const [next, review] = await Promise.all([api('/state'), api('/review')]);
    setState(next);
    setBrief(review);
    if (!preserveForm) {
      setTime(next.schedule.time);
      setEnabled(next.schedule.enabled);
      setReminderTime(next.reminder.time);
      setReminderEnabled(next.reminder.enabled);
      setReviewTime(next.reviewPrompt.time);
      setReviewEnabled(next.reviewPrompt.enabled);
    }
  }, []);

  useEffect(() => {
    refresh().catch((error) => setNotice({ error: error.message }));
    const timer = setInterval(() => refresh(true).catch(() => {}), 20000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!notice?.text) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!qr || ['confirmed', 'expired', 'verify_code_blocked', 'binded_redirect'].includes(qrStatus)) return;
    let stopped = false;
    async function poll() {
      try {
        const result = await api('/bind/status');
        if (stopped) return;
        setQrStatus(result.status);
        if (result.status === 'confirmed') {
          setQr(null);
          setNotice({ text: '微信已绑定。请从该账号向机器人发一条消息，以启用主动发送。' });
          await refresh(true);
        } else if (['expired', 'verify_code_blocked', 'binded_redirect'].includes(result.status)) {
          setQr(null);
        } else {
          setTimeout(poll, 1000);
        }
      } catch (error) {
        if (!stopped) {
          setNotice({ error: error.message });
          setTimeout(poll, 4000);
        }
      }
    }
    poll();
    return () => { stopped = true; };
  }, [qr, refresh]);

  async function run(key, work, success) {
    setBusy(key);
    setNotice(null);
    try {
      await work();
      if (success) setNotice({ text: success });
    } catch (error) {
      setNotice({ error: error.message });
    } finally { setBusy(''); }
  }

  const connection = state?.connection || {};
  const ready = connection.conversationReady;
  const bound = connection.bound;
  const delivery = state?.delivery;
  const connectionLabel = ready ? '可以发送' : bound ? '等待会话消息' : '尚未绑定';

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Activity size={19} strokeWidth={2.4} /></span><div><strong>PWS CC</strong><small>Personal Workspace<br />Control Center</small></div></div>
      <nav aria-label="工作区导航">
        <button title="概览" className={section === 'overview' ? 'nav active' : 'nav'} onClick={() => setSection('overview')}><Activity size={18} /> 概览</button>
        <button title="仪表盘" className={section === 'dashboard' ? 'nav active' : 'nav'} onClick={() => setSection('dashboard')}><ChartNoAxesCombined size={18} /> 仪表盘</button>
        <button title="资料" className={section === 'content' ? 'nav active' : 'nav'} onClick={() => { setContentSelection(null); setSection('content'); }}><FolderOpen size={18} /> 资料</button>
        <button title="对话" className={section === 'chat' ? 'nav active' : 'nav'} onClick={() => setSection('chat')}><MessageCircle size={18} /> 对话</button>
        <button title="每日简报" className={section === 'review' ? 'nav active' : 'nav'} onClick={() => setSection('review')}><FileText size={18} /> 每日简报</button>
        <button title="每日复盘" className={section === 'daily-review' ? 'nav active' : 'nav'} onClick={() => setSection('daily-review')}><CalendarClock size={18} /> 每日复盘</button>
        <button title="发送设置" className={section === 'settings' ? 'nav active' : 'nav'} onClick={() => setSection('settings')}><Settings2 size={18} /> 发送设置</button>
        <button title="模型配置" className={section === 'model' ? 'nav active' : 'nav'} onClick={() => setSection('model')}><Sparkles size={18} /> 模型配置</button>
      </nav>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">WORKSPACE <span>/</span> {({ overview: '概览', dashboard: '仪表盘', content: '资料', chat: '对话', review: '每日简报', 'daily-review': '每日复盘', settings: '发送设置', model: '模型配置' })[section]}</div><div className="top-date">{state?.today || '—'} · Asia/Shanghai</div></header>
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">PERSONAL SYSTEM / 01</p><h1>{({ overview: '你的工作区', dashboard: '仪表盘', content: '资料', chat: '对话记录', review: '每日简报', 'daily-review': '每日复盘', settings: '发送设置', model: '模型配置' })[section]}</h1><p className="subtitle">{({ overview: '连接微信，安排简报与复盘，保持每天的记录有据可查。', dashboard: '查看记录覆盖、同口径趋势和有依据的 AI 分析。', content: '查看和更新基本信息、每日记录与复盘回复。', chat: '说出事实或询问过往内容，记录结果可随时修改。', review: '根据今日记录生成事实摘要。', 'daily-review': '提出几个问题，记录回答，回看每天的思考。', settings: '分别设置汇报提醒、复盘提问和简报发送时间。', model: '配置 Agent 将使用的模型服务与访问凭证。' })[section]}</p></div>{!['model', 'content', 'chat', 'dashboard'].includes(section) && <button className="icon-button refresh" title="刷新状态" aria-label="刷新状态" onClick={() => refresh(true).catch((error) => setNotice({ error: error.message }))}><RefreshCw size={18} /></button>}</div>

        {notice && <div className={notice.error ? 'notice error' : 'notice'} role="status"><span>{notice.error || notice.text}</span><button className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={17} /></button></div>}

        {section === 'overview' && <>
          <div className="status-strip">
            <div><span className="status-icon teal"><Link2 size={19} /></span><div><small>微信连接</small><strong>{connectionLabel}</strong></div></div>
            <div><span className="status-icon amber"><Clock3 size={19} /></span><div><small>每日发送</small><strong>{state?.schedule.enabled ? state.schedule.time : '未启用'}</strong></div></div>
            <div><span className="status-icon coral"><FileText size={19} /></span><div><small>今日记录分区</small><strong>{brief?.count ?? '—'} 个</strong></div></div>
          </div>
          <div className="section-head"><h2>开始使用</h2><span>连接与发送</span></div>
          <div className="workflow">
            <div className="workflow-step"><span className={bound ? 'step-number done' : 'step-number'}>{bound ? <Check size={17} /> : '01'}</span><div><strong>绑定个人微信</strong><p>扫码授权此工作区的微信机器人。</p></div><button className="text-action" onClick={() => setSection('settings')}>查看 <ArrowRight size={16} /></button></div>
            <div className="workflow-step"><span className={ready ? 'step-number done' : 'step-number'}>{ready ? <Check size={17} /> : '02'}</span><div><strong>建立会话</strong><p>绑定后从微信向机器人发送一条消息，才可主动推送。</p></div><span className="step-state">{ready ? '已就绪' : '待完成'}</span></div>
            <div className="workflow-step"><span className={state?.schedule.enabled ? 'step-number done' : 'step-number'}>{state?.schedule.enabled ? <Check size={17} /> : '03'}</span><div><strong>设定简报时间</strong><p>每天按上海时间发送当天记录的摘要。</p></div><button className="text-action" onClick={() => setSection('settings')}>设置 <ArrowRight size={16} /></button></div>
          </div>
          <ReviewPreview brief={brief} onView={() => setSection('review')} />
        </>}
        {section === 'dashboard' && <Suspense fallback={<p className="dashboard-loading">仪表盘加载中…</p>}><Dashboard request={api} onOpen={(item) => { setContentSelection(item); setSection('content'); }} onRecords={() => { setContentSelection(null); setSection('content'); }} onModel={() => setSection('model')} /></Suspense>}

        {section === 'settings' && <>
          <div className="section-head"><h2>微信连接</h2><span>PERSONAL WEIXIN</span></div>
          <div className="setting-row connection-row"><div className="setting-copy"><div className="row-icon"><MessageCircle size={21} /></div><div><strong>个人微信</strong><p>{bound ? ready ? '绑定完成，会话已就绪。' : '已绑定。请在微信中向机器人发一条消息。' : '扫描二维码并在手机上确认授权。'}</p>{bound && <small className="account-id">Bot ID: {connection.accountId}</small>}</div></div><div className="row-control">{bound ? <span className={ready ? 'state-badge good' : 'state-badge'}>{connectionLabel}</span> : <button className="primary-button" disabled={Boolean(busy)} onClick={() => run('bind', async () => { const result = await api('/bind/start', { method: 'POST' }); setQr(await QRCode.toDataURL(result.qrText, { margin: 2, width: 280, color: { dark: '#172622', light: '#ffffff' } })); setQrStatus('wait'); })}><Link2 size={16} /> {busy === 'bind' ? '正在获取…' : '绑定微信'}</button>}</div></div>
          {connection.error && <p className="inline-error">通道暂时异常：{connection.error}</p>}
          {ready && <div className="secondary-action"><span>向微信发送一条测试消息，确认手机端是否收到。</span><button className="outline-button" disabled={Boolean(busy)} onClick={() => run('test', () => api('/test', { method: 'POST' }), '接口已接受测试消息，请在手机微信中确认是否收到。')}><Send size={16} /> {busy === 'test' ? '发送中…' : '发送测试'}</button></div>}

          <div className="section-head spaced"><h2>定时发送</h2><span>DAILY DELIVERY</span></div>
          <div className="setting-row"><div className="setting-copy"><div className="row-icon warm"><CalendarClock size={21} /></div><div><strong>每日简报发送时间</strong><p>有当天记录时发送事实摘要，使用 Asia/Shanghai 时区。</p></div></div><div className="row-control"><label className="time-label" htmlFor="send-time">发送时间</label><input id="send-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} /><label className="switch" title="启用每日简报"><input type="checkbox" aria-label="启用每日简报" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span className="switch-track" /></label></div></div>
          <div className="setting-row"><div className="setting-copy"><div className="row-icon cool"><Bell size={21} /></div><div><strong>每日提醒时间</strong><p>当天没有记录时提醒汇报，每天最多发送一次。</p></div></div><div className="row-control"><label className="time-label" htmlFor="reminder-time">提醒时间</label><input id="reminder-time" type="time" value={reminderTime} onChange={(event) => setReminderTime(event.target.value)} /><label className="switch" title="启用每日提醒"><input type="checkbox" aria-label="启用每日提醒" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)} /><span className="switch-track" /></label></div></div>
          <div className="setting-row"><div className="setting-copy"><div className="row-icon teal"><CalendarClock size={21} /></div><div><strong>每日复盘提问时间</strong><p>发送问题模板，等待微信回复写入每日复盘。</p></div></div><div className="row-control"><label className="time-label" htmlFor="review-time">提问时间</label><input id="review-time" type="time" value={reviewTime} onChange={(event) => setReviewTime(event.target.value)} /><label className="switch" title="启用每日复盘提问"><input type="checkbox" aria-label="启用每日复盘提问" checked={reviewEnabled} onChange={(event) => setReviewEnabled(event.target.checked)} /><span className="switch-track" /></label></div></div>
          <div className="settings-footer"><p><ShieldCheck size={17} /> 提醒时间应早于简报时间；服务运行期间到点处理。</p><button className="primary-button" disabled={Boolean(busy)} onClick={() => run('save', async () => { const next = await api('/schedule', { method: 'POST', body: JSON.stringify({ enabled, time, reminderEnabled, reminderTime, reviewEnabled, reviewTime }) }); setState(next); }, '发送设置已保存。')}><Check size={16} /> {busy === 'save' ? '保存中…' : '保存设置'}</button></div>
        </>}

        {section === 'model' && <ModelSettings request={api} />}
        {section === 'content' && <ContentWorkspace request={api} today={state?.today} initialSelection={contentSelection} onChanged={() => refresh(true).catch(() => {})} />}
        {section === 'chat' && <ChatWorkspace request={api} onModel={() => setSection('model')} onOpen={(item) => { setContentSelection(item); setSection('content'); }} />}

        {section === 'review' && <ReviewWorkspace request={api} brief={brief} today={state?.today} ready={ready} busy={busy} onChanged={() => refresh(true).catch((error) => setNotice({ error: error.message }))} onSend={() => run('send', async () => { const next = await api('/review/send', { method: 'POST' }); setState(next); }, '微信接口已接受简报，请在手机端确认。')} />}
        {section === 'daily-review' && <DailyReviewWorkspace request={api} today={state?.today} ready={ready} delivery={state?.reviewPromptDelivery} onChanged={() => refresh(true).catch((error) => setNotice({ error: error.message }))} />}

        {delivery && section !== 'model' && <div className="delivery-note"><span>最近投递</span><strong>{delivery.date} · {({ accepted: '接口已接受', sending: '发送中', uncertain: '状态待确认', no_records: '当日无记录' })[delivery.status] || delivery.status}</strong>{delivery.error && <small>{delivery.error}</small>}</div>}
      </div>
    </main>

    {qr && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQr(null); }}><div className="modal" role="dialog" aria-modal="true" aria-label="绑定微信"><div className="modal-head"><div><p className="eyebrow">WEIXIN CONNECTION</p><h2>扫描二维码</h2></div><button className="icon-button" title="关闭" aria-label="关闭" onClick={() => setQr(null)}><X size={20} /></button></div><div className="qr-box"><img src={qr} alt="微信绑定二维码" /></div><p className="qr-instruction">使用个人微信扫描，并在手机端确认授权。</p><p className="qr-status"><LoaderCircle size={16} className="spin" /> {qrStatus === 'scaned' ? '已扫码，等待手机确认' : qrStatus === 'need_verifycode' ? '请输入手机显示的验证码' : '等待扫码'}</p>{qrStatus === 'need_verifycode' && <div className="verify-row"><input inputMode="numeric" aria-label="验证码" placeholder="手机验证码" value={verifyCode} onChange={(event) => setVerifyCode(event.target.value)} /><button className="primary-button" onClick={() => run('verify', () => api('/bind/verify', { method: 'POST', body: JSON.stringify({ code: verifyCode }) }), '验证码已提交。')}>提交</button></div>}</div></div>}
  </div>;
}

function ReviewPreview({ brief, onView }) {
  return <><div className="section-head spaced"><h2>今日简报</h2><button className="text-action" onClick={onView}>查看完整简报 <ArrowRight size={16} /></button></div><div className="preview"><div className="preview-head"><span>{brief?.date || '—'}</span><span>{brief?.count || 0} 个记录分区</span></div>{brief?.text ? <pre>{brief.text}</pre> : <p className="preview-empty">今天尚无记录，简报将在有内容后生成。</p>}</div></>;
}

createRoot(document.getElementById('root')).render(<App />);
