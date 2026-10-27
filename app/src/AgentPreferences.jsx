import React, { useEffect, useState } from 'react';
import { LoaderCircle, Save } from 'lucide-react';

export default function AgentPreferences({ request }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let mounted = true;
    request('/agent/preferences').then((value) => {
      if (mounted) { setSaved(value); setDraft(value.prompt); }
    }).catch((error) => mounted && setMessage({ error: error.message }));
    return () => { mounted = false; };
  }, [request]);

  const changed = saved && draft.trim() !== saved.prompt;
  async function save(event) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    try {
      const value = await request('/agent/preferences', { method: 'POST', body: JSON.stringify({ prompt: draft, revision: saved.revision }) });
      setSaved(value); setDraft(value.prompt);
      setMessage({ text: '全局提示词已保存。' });
    } catch (error) { setMessage({ error: error.message }); }
    finally { setBusy(false); }
  }

  return <section className="agent-preferences">
    <div className="section-head"><h2>全局提示词</h2><span>AGENT</span></div>
    <form className="agent-preferences-form" onSubmit={save}>
      <label htmlFor="global-prompt">全局提示词</label>
      <textarea id="global-prompt" rows={6} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="例如：回答时先给结论，再列出记录依据。" />
      <div className="agent-preferences-foot"><span>{draft.length}/4000 · 记录仍需原话校验</span><button className="primary-button" disabled={!changed || busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} 保存提示词</button></div>
    </form>
    {message && <p className={message.error ? 'inline-error' : 'workspace-feedback'} role="status">{message.error || message.text}</p>}
  </section>;
}
