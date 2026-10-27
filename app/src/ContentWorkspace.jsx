import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, FilePlus2, FolderOpen, Pencil, Plus, RefreshCw, Save, X } from 'lucide-react';
import MarkdownContent from './MarkdownContent.jsx';

const keyFor = (item) => `${item.kind}:${item.category || ''}:${item.date || ''}`;
const labelFor = (item, categories) => item.kind === 'profile' ? '基本信息' : item.kind === 'review' ? `${item.date} 复盘` : `${item.date} · ${categories.find((category) => category.slug === item.category)?.name || item.name || item.category}`;

export default function ContentWorkspace({ request, today, initialSelection, onChanged }) {
  const [index, setIndex] = useState({ categories: [], records: [], reviews: [] });
  const [tab, setTab] = useState(initialSelection?.kind || 'record');
  const [activeDate, setActiveDate] = useState(initialSelection?.date || today || '');
  const [selected, setSelected] = useState(null);
  const [document, setDocument] = useState(null);
  const [draft, setDraft] = useState('');
  const [dialog, setDialog] = useState(null);
  const [categoryName, setCategoryName] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState('preview');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const openSequence = useRef(0);

  async function reload() { setIndex(await request('/content')); }
  useEffect(() => { reload().catch((error) => setFeedback(error.message)); }, []);
  useEffect(() => { if (!activeDate && today) setActiveDate(today); }, [today, activeDate]);
  useEffect(() => { if (initialSelection) { setTab(initialSelection.kind); if (initialSelection.kind === 'record' && initialSelection.date) setActiveDate(initialSelection.date); void open(initialSelection); } }, [initialSelection]);
  useEffect(() => {
    if (tab === 'review' && index.reviews.length && !selected && !busy && !feedback) void open(index.reviews[0], false, true);
  }, [tab, index.reviews, selected, busy, feedback]);

  function canLeave() {
    return !document || draft === document.content || window.confirm('当前修改尚未保存，确定切换吗？');
  }

  async function open(item, edit = false, skipConfirm = false) {
    if (!skipConfirm && !canLeave()) return false;
    const sequence = ++openSequence.current;
    setFeedback('');
    setBusy(true);
    try {
      const params = new URLSearchParams({ kind: item.kind, ...(item.category ? { category: item.category } : {}), ...(item.date ? { date: item.date } : {}) });
      const next = await request(`/content/item?${params}`);
      if (sequence !== openSequence.current) return false;
      if (item.kind === 'record' && item.date) setActiveDate(item.date);
      setSelected(item);
      setDocument(next);
      setDraft(next.content);
      setMode(edit ? 'edit' : 'preview');
      return true;
    } catch (error) { if (sequence === openSequence.current) setFeedback(error.message); return false; }
    finally { if (sequence === openSequence.current) setBusy(false); }
  }

  function changeDate(date) {
    if (!date || !canLeave()) return;
    openSequence.current += 1;
    setBusy(false);
    setActiveDate(date);
    setSelected(null);
    setDocument(null);
    setDraft('');
    setFeedback('');
  }

  function changeTab(value) {
    if (value === tab || !canLeave()) return;
    openSequence.current += 1;
    setBusy(false);
    setTab(value);
    setSelected(null);
    setDocument(null);
    setDraft('');
    setFeedback('');
    if (value === 'profile') void open({ kind: 'profile' }, false, true);
    if (value === 'review' && index.reviews.length) void open(index.reviews[0], false, true);
  }

  async function startRecord(category) {
    if (await open({ kind: 'record', category: category.slug, name: category.name, date: activeDate }, true)) setDialog(null);
  }

  async function createCategory(event) {
    event.preventDefault();
    if (!canLeave()) return;
    setCreating(true);
    setDialogError('');
    try {
      const created = await request('/content/categories', { method: 'POST', body: JSON.stringify({ name: categoryName.trim() }) });
      await reload();
      if (await open({ kind: 'record', category: created.slug, name: created.name, date: activeDate }, true, true)) setDialog(null);
    } catch (error) { setDialogError(error.message); }
    finally { setCreating(false); }
  }

  async function save() {
    if (!document) return;
    setBusy(true);
    setFeedback('');
    try {
      const result = await request('/content/item', { method: 'POST', body: JSON.stringify({
        kind: selected.kind, category: selected.category, name: selected.name, date: selected.date,
        content: draft, revision: document.revision,
      }) });
      setDocument(result);
      setSelected(result);
      await reload();
      onChanged?.();
      setFeedback('已保存。');
    } catch (error) { setFeedback(error.message); }
    finally { setBusy(false); }
  }

  const dayRecords = index.records.filter((item) => item.date === activeDate);

  return <div className="workspace-view">
    <div className="workspace-tabs" role="tablist" aria-label="资料类型">
      {[['profile', '基本信息'], ['record', '每日记录'], ['review', '复盘记录']].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => changeTab(value)}>{label}</button>)}
      {tab === 'record' && <label className="workspace-active-date"><CalendarDays size={15} /><input type="date" aria-label="记录日期" value={activeDate} onChange={(event) => changeDate(event.target.value)} /></label>}
    </div>
    <div className={`workspace-grid ${tab === 'profile' ? 'profile' : ''}`}>
      {tab !== 'profile' && <section className="workspace-list" aria-label={tab === 'review' ? '复盘日期列表' : '内容列表'}>
        <div className="workspace-list-head"><strong>{tab === 'review' ? '全部复盘' : '分类记录'}</strong><button className="icon-button" title="刷新列表" aria-label="刷新列表" onClick={() => reload().catch((error) => setFeedback(error.message))}><RefreshCw size={16} /></button></div>
        {tab === 'review' ? <div className="workspace-categories workspace-review-list">
          {index.reviews.map((item) => <button key={keyFor(item)} className={`workspace-day-record ${selected && keyFor(selected) === keyFor(item) ? 'active' : ''}`} onClick={() => open(item)}><CalendarDays size={16} /><span>{item.date}</span></button>)}
          {!index.reviews.length && <p className="workspace-empty">还没有复盘回复。</p>}
        </div> : <>
          <div className="workspace-categories">
            {dayRecords.map((item) => <button key={keyFor(item)} className={`workspace-day-record ${selected && keyFor(selected) === keyFor(item) ? 'active' : ''}`} onClick={() => open(item)}><FolderOpen size={16} /><span>{index.categories.find((category) => category.slug === item.category)?.name || item.name || item.category}</span></button>)}
            {dayRecords.length === 0 && <p className="workspace-empty">该日期暂无分类记录。</p>}
          </div>
          <div className="workspace-add-record"><button className="outline-button" disabled={busy || !activeDate} onClick={() => { setDialog('select'); setCategoryName(''); setDialogError(''); }}><Plus size={16} /> 新增记录</button></div>
        </>}
      </section>}
      <section className="workspace-editor" aria-label="内容编辑">
        {document ? <>
          <div className="workspace-editor-head"><div><span>{selected.kind === 'profile' ? '个人资料' : selected.kind === 'review' ? '复盘回复' : '每日记录'}</span><h2>{labelFor(selected, index.categories)}</h2></div><div className="workspace-modes"><button title="编辑" aria-label="编辑" className={mode === 'edit' ? 'selected' : ''} onClick={() => setMode('edit')}><Pencil size={16} /></button><button title="阅读" aria-label="阅读" className={mode === 'preview' ? 'selected' : ''} onClick={() => setMode('preview')}><Check size={16} /></button></div></div>
          {mode === 'edit' ? <textarea aria-label="内容" className="workspace-textarea" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="写下今天发生的事…" spellCheck="false" /> : <div className="workspace-preview markdown-body"><MarkdownContent>{draft || '暂无内容'}</MarkdownContent></div>}
          <div className="workspace-editor-foot"><span>{draft !== document.content ? '有未保存的修改' : '已同步'}</span><button className="primary-button" disabled={busy || draft === document.content} onClick={save}><Save size={16} /> {busy ? '保存中…' : '保存'}</button></div>
        </> : <div className="workspace-placeholder"><FilePlus2 size={28} /><h2>{tab === 'profile' ? '正在加载基本信息' : tab === 'review' ? '选择复盘日期' : '选择记录'}</h2><p>{tab === 'review' ? '从左侧选择日期，查看该日的全部回复。' : tab === 'profile' ? '' : '选择左侧分类，或为当前日期新增记录。'}</p></div>}
        {feedback && <p className="workspace-feedback" role="status">{feedback}</p>}
      </section>
    </div>
    {dialog && <div className="workspace-dialog-backdrop"><div className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="record-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape' && !creating) setDialog(null); }}>
      <div className="workspace-dialog-head"><div><span>记录日期 · {activeDate}</span><h2 id="record-dialog-title">{dialog === 'select' ? '选择分类' : '新增分类'}</h2></div><button className="icon-button" title="关闭" aria-label="关闭" disabled={creating} onClick={() => setDialog(null)}><X size={18} /></button></div>
      {dialog === 'select' ? <div className="workspace-dialog-body"><div className="workspace-dialog-options">{index.categories.map((category, position) => <button key={category.slug} autoFocus={position === 0} onClick={() => startRecord(category)}><FolderOpen size={17} /><span>{category.name}</span></button>)}</div><button className="workspace-new-category" autoFocus={index.categories.length === 0} onClick={() => { setDialog('name'); setDialogError(''); }}><Plus size={17} /> 新增分类</button></div> : <form className="workspace-dialog-body" onSubmit={createCategory}><label htmlFor="new-category-name">分类名称</label><input id="new-category-name" autoFocus maxLength={60} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="例如：阅读" /><div className="workspace-dialog-actions"><button type="button" className="outline-button" disabled={creating} onClick={() => { setDialog('select'); setDialogError(''); }}><ArrowLeft size={15} /> 返回</button><button type="submit" className="primary-button" disabled={creating || !categoryName.trim()}><Check size={16} /> {creating ? '创建中…' : '创建并记录该日期'}</button></div></form>}
      {dialogError && <p className="workspace-dialog-error" role="alert">{dialogError}</p>}
    </div></div>}
  </div>;
}
