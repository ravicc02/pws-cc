import React, { useEffect, useState } from 'react';
import MarkdownContent from './MarkdownContent.jsx';
import { CalendarClock, FileQuestion, Pencil, Plus, RefreshCw, Save, Send, Trash2 } from 'lucide-react';

const promptPreview = (date, questions) => `每日复盘 | ${date}\n\n${questions.map((question, index) => `${index + 1}. ${question || '…'}`).join('\n')}\n\n回复“复盘：你的回答”，或按序号逐条回答。`;

export default function DailyReviewWorkspace({ request, today, ready, delivery, onChanged }) {
  const [tab, setTab] = useState('questions');
  const [template, setTemplate] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [document, setDocument] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const [nextTemplate, nextDocument] = await Promise.all([
      request('/daily-review/questions'), request(`/content/item?kind=review&date=${encodeURIComponent(today)}`),
    ]);
    setTemplate(nextTemplate); setQuestions(nextTemplate.questions);
    setDocument(nextDocument); setDraft(nextDocument.content);
  }
  useEffect(() => { if (today) load().catch((error) => setMessage(error.message)); }, [today]);

  async function act(key, action, success) {
    setBusy(key); setMessage('');
    try { await action(); setMessage(success); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(''); }
  }

  async function saveQuestions() {
    await act('questions', async () => {
      const result = await request('/daily-review/questions', { method: 'POST', body: JSON.stringify({ questions, revision: template.revision }) });
      setTemplate(result); setQuestions(result.questions);
    }, '复盘问题已保存。');
  }

  async function saveAnswer() {
    await act('answer', async () => {
      const result = await request('/content/item', { method: 'POST', body: JSON.stringify({ kind: 'review', date: today, content: draft, revision: document.revision }) });
      setDocument(result); setEditing(false); onChanged?.();
    }, '今日复盘已保存。');
  }

  async function sendQuestions() {
    await act('send', async () => {
      await request('/daily-review/send', { method: 'POST' });
      onChanged?.();
    }, '微信接口已接受复盘问题，请在手机端确认。');
  }

  const asked = delivery?.date === today && ['accepted', 'answered', 'sending', 'uncertain'].includes(delivery.status);
  return <div className="review-workspace">
    <div className="workspace-tabs" role="tablist" aria-label="复盘视图">
      <button role="tab" aria-selected={tab === 'questions'} className={tab === 'questions' ? 'selected' : ''} onClick={() => setTab('questions')}>问题模板</button>
      <button role="tab" aria-selected={tab === 'current'} className={tab === 'current' ? 'selected' : ''} onClick={() => setTab('current')}>今日复盘</button>
    </div>
    {tab === 'questions' ? <><div className="template-grid"><section><div className="template-head"><h2>复盘问题</h2><span>按顺序发送给用户</span></div><div className="question-list">{questions.map((question, index) => <div className="question-row" key={index}><span>{index + 1}.</span><input aria-label={`问题 ${index + 1}`} value={question} maxLength={200} onChange={(event) => setQuestions((value) => value.map((item, i) => i === index ? event.target.value : item))} /><button className="icon-button" title="移除问题" aria-label={`移除问题 ${index + 1}`} disabled={questions.length <= 1} onClick={() => setQuestions((value) => value.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>)}</div><button className="outline-button add-question" disabled={questions.length >= 8} onClick={() => setQuestions((value) => [...value, ''])}><Plus size={16} /> 添加问题</button><button className="primary-button" disabled={Boolean(busy) || !template || JSON.stringify(questions) === JSON.stringify(template.questions)} onClick={saveQuestions}><Save size={16} /> 保存问题</button></section><section className="wechat-preview"><div className="template-head"><h2>微信预览</h2><span>实际发送内容格式</span></div><div className="wechat-screen"><div className="wechat-title">每日复盘</div><div className="wechat-message">{promptPreview(today, questions)}</div></div></section></div><div className="review-footer"><p>{asked ? delivery.status === 'answered' ? '今日复盘已收到。' : '今日问题已发送或状态待确认。' : '发送后等待以“复盘：”或编号开头的微信回复。'}</p><button className="primary-button" disabled={!ready || asked || Boolean(document?.content.trim()) || Boolean(busy) || JSON.stringify(questions) !== JSON.stringify(template?.questions)} onClick={sendQuestions}><Send size={16} /> {busy === 'send' ? '发送中…' : '发送今日问题'}</button></div></> : <><div className="review-toolbar"><div><span className="date-chip"><CalendarClock size={15} /> {today}</span><span className="review-count">{document?.content ? '已记录' : '待回答'}</span></div><button className="outline-button" onClick={() => load().catch((error) => setMessage(error.message))}><RefreshCw size={16} /> 更新</button></div><div className="review-document"><div className="document-top"><span>DAILY REVIEW</span><button className="outline-button" onClick={() => { setDraft(document?.content || ''); setEditing((value) => !value); }}><Pencil size={15} /> {editing ? '取消编辑' : '编辑复盘'}</button></div>{editing ? <><textarea aria-label="今日复盘" className="review-answer-editor" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="写下今天的复盘…" /><button className="primary-button" disabled={!document || draft === document.content || Boolean(busy)} onClick={saveAnswer}><Save size={16} /> 保存复盘</button></> : document?.content ? <div className="markdown-body review-markdown"><MarkdownContent>{document.content}</MarkdownContent></div> : <div className="review-no-answer"><FileQuestion size={28} /><p>今天还没有复盘回答。</p></div>}</div><div className="review-footer"><p>复盘回答独立保存，不参与每日简报的事实摘要。</p></div></>}
    {message && <p className="workspace-feedback" role="status">{message}</p>}
  </div>;
}
