import React, { useEffect, useState } from 'react';
import { GitBranch, Save } from 'lucide-react';

export default function AgentBindings({ request, profiles, activeId }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ids = profiles.map((item) => item.id).join(',');

  useEffect(() => {
    let current = true;
    request('/model/roles').then((value) => { if (current) { setSaved(value); setDraft(value); } })
      .catch((cause) => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [request, ids, activeId]);

  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const value = await request('/model/roles', { method: 'POST', body: JSON.stringify(draft) });
      setSaved(value); setDraft(value);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  if (!profiles.length) return null;
  return <section className="agent-bindings">
    <div className="section-head"><h2>Agent 分工</h2><span>MODEL ROUTING</span></div>
    <form onSubmit={save}>
      <div className="agent-binding-row"><GitBranch size={19} /><div><strong>处理 Agent</strong><p>提取并校验事实与长期目标，不负责回复口吻。</p></div><select aria-label="处理 Agent 模型" value={draft?.processingId || ''} onChange={(event) => setDraft((value) => ({ ...value, processingId: event.target.value }))}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.model}{profile.id === activeId ? ' · 默认' : ''}</option>)}</select></div>
      <div className="agent-binding-row"><GitBranch size={19} /><div><strong>对话 Agent</strong><p>读取已确认的资料与相关记录，生成简短建议。</p></div><select aria-label="对话 Agent 模型" value={draft?.conversationId || ''} onChange={(event) => setDraft((value) => ({ ...value, conversationId: event.target.value }))}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.model}{profile.id === activeId ? ' · 默认' : ''}</option>)}</select></div>
      <div className="agent-binding-footer"><span>{saved?.explicit && draft && saved.processingId === draft.processingId && saved.conversationId === draft.conversationId ? '当前绑定已保存' : saved?.explicit ? '修改后保存绑定' : '当前沿用默认模型，保存后固定分工'}</span><button type="submit" className="primary-button" disabled={busy || !draft?.processingId || !draft?.conversationId || saved?.explicit && saved.processingId === draft.processingId && saved.conversationId === draft.conversationId}><Save size={15} /> 保存绑定</button></div>
      {error && <p className="inline-error" role="status">{error}</p>}
    </form>
  </section>;
}
