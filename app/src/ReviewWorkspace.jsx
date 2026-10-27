import React, { useEffect, useState } from 'react';
import { CalendarClock, CircleHelp, RefreshCw, Save, Send } from 'lucide-react';

const sample = { count: 2, content: '【健身】\n卧推 100kg，训练 45 分钟。\n\n【心情】\n今天状态不错。' };
const preview = (template, date) => template.replace(/{{\s*(date|count|content)\s*}}/g, (_, key) => String({ ...sample, date }[key])).trim().slice(0, 3500);

export default function ReviewWorkspace({ request, brief, today, ready, busy, onSend, onChanged }) {
  const [tab, setTab] = useState('current');
  const [template, setTemplate] = useState(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const next = await request('/review/template');
    setTemplate(next); setDraft(next.content);
  }
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);

  async function saveTemplate() {
    setLoading(true); setMessage('');
    try {
      const next = await request('/review/template', { method: 'POST', body: JSON.stringify({ content: draft, revision: template.revision }) });
      setTemplate(next); setMessage('简报模板已保存。'); onChanged?.();
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  return <div className="review-workspace">
    <div className="workspace-tabs" role="tablist" aria-label="简报视图">
      <button role="tab" aria-selected={tab === 'template'} className={tab === 'template' ? 'selected' : ''} onClick={() => setTab('template')}>模板编辑</button>
      <button role="tab" aria-selected={tab === 'current'} className={tab === 'current' ? 'selected' : ''} onClick={() => setTab('current')}>当前内容</button>
    </div>
    {tab === 'template' ? <div className="template-grid"><section><div className="template-head"><h2>简报模板</h2><span>可使用 {'{{date}}'}、{'{{count}}'}、{'{{content}}'}</span></div><textarea aria-label="简报模板" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck="false" /><button className="primary-button" disabled={loading || !template || draft === template.content} onClick={saveTemplate}><Save size={16} /> 保存模板</button></section><section className="wechat-preview"><div className="template-head"><h2>微信预览</h2><span>示例数据</span></div><div className="wechat-screen"><div className="wechat-title">每日简报</div><div className="wechat-message">{preview(draft, today)}</div></div></section></div> : <>
      <div className="review-toolbar"><div><span className="date-chip"><CalendarClock size={15} /> {brief?.date || today || '—'}</span><span className="review-count">{brief?.count || 0} 个记录分区</span></div><button className="outline-button" onClick={() => onChanged?.()}><RefreshCw size={16} /> 更新预览</button></div>
      <div className="review-document"><div className="document-top"><span>DAILY BRIEF</span></div>{brief?.text ? <pre>{brief.text}</pre> : <p className="preview-empty">今天还没有记录。记录后会在这里形成事实摘要。</p>}</div>
      <div className="review-footer"><p><CircleHelp size={17} /> 简报仅摘录每日记录，不会代替复盘。接口接受不等于微信已展示。</p><button className="primary-button" disabled={!ready || !brief?.text || Boolean(busy)} title={!ready ? '先完成微信绑定并建立会话' : !brief?.text ? '今天没有简报内容' : '立即发送今日简报'} onClick={onSend}><Send size={16} /> {busy === 'send' ? '发送中…' : '立即发送简报'}</button></div>
    </>}
    {message && <p className="workspace-feedback" role="status">{message}</p>}
  </div>;
}
