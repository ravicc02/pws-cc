import React, { useEffect, useState } from 'react';
import { CircleHelp, Eye, EyeOff, KeyRound, LoaderCircle, Pencil, Plus, Save, ShieldCheck, Sparkles, TestTube2, Trash2, X } from 'lucide-react';
import AgentPreferences from './AgentPreferences.jsx';
import AgentBindings from './AgentBindings.jsx';

const emptyDraft = () => ({ id: null, baseUrl: '', model: '', apiKey: '', clearKey: false });

export default function ModelSettings({ request }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [tested, setTested] = useState(null);

  useEffect(() => {
    let active = true;
    request('/model').then((value) => {
      if (!active) return;
      setSaved(value);
      if (!value.profiles.length) setDraft(emptyDraft());
    }).catch((error) => active && setMessage({ error: error.message }));
    return () => { active = false; };
  }, [request]);

  const existing = saved?.profiles.find((profile) => profile.id === draft?.id);
  const formKey = draft && JSON.stringify([draft.id, draft.baseUrl.trim().replace(/\/+$/, ''), draft.model.trim(), draft.apiKey.trim(), draft.clearKey]);
  const unchanged = Boolean(existing && draft.baseUrl.trim().replace(/\/+$/, '') === existing.baseUrl && draft.model.trim() === existing.model && !draft.apiKey.trim() && !draft.clearKey);
  const verified = Boolean(tested && tested.formKey === formKey);

  function start(profile = null) {
    setDraft(profile ? { id: profile.id, baseUrl: profile.baseUrl, model: profile.model, apiKey: '', clearKey: false } : emptyDraft());
    setShowKey(false); setTested(null); setMessage(null);
  }

  function change(patch) { setDraft((value) => ({ ...value, ...patch })); setTested(null); setMessage(null); }

  function closeEditor() { if (busy) return; setDraft(null); setTested(null); setMessage(null); }

  async function save(event) {
    event.preventDefault();
    if (!unchanged && !verified) return;
    setBusy('save'); setMessage(null);
    try {
      const value = await request('/model', { method: 'POST', body: JSON.stringify({ ...draft, testToken: verified ? tested.token : undefined }) });
      setSaved(value); setDraft(null); setTested(null); setShowKey(false);
    } catch (error) { setMessage({ error: error.message }); }
    finally { setBusy(''); }
  }

  async function test() {
    setBusy('test'); setMessage(null);
    try {
      const result = await request('/model/test', { method: 'POST', body: JSON.stringify(draft) });
      setTested({ formKey, token: result.testToken });
      setMessage({ text: `连接成功，响应耗时 ${result.latencyMs} ms。` });
    } catch (error) { setMessage({ error: error.message }); }
    finally { setBusy(''); }
  }

  async function activate(id) {
    setBusy(id); setMessage(null);
    try {
      setSaved(await request('/model/activate', { method: 'POST', body: JSON.stringify({ id }) }));
      setDraft(null); setTested(null);
    } catch (error) { setMessage({ error: error.message }); }
    finally { setBusy(''); }
  }

  async function remove(profile) {
    if (!window.confirm(`确定删除“${profile.model}”的配置吗？此操作会移除保存在本机的密钥。`)) return;
    setBusy(profile.id); setMessage(null);
    try {
      const value = await request('/model/delete', { method: 'POST', body: JSON.stringify({ id: profile.id }) });
      setSaved(value);
      if (draft?.id === profile.id) setDraft(null);
      if (!value.profiles.length) setDraft(emptyDraft());
      setTested(null);
    } catch (error) { setMessage({ error: error.message }); }
    finally { setBusy(''); }
  }

  return <div className="model-page">
    <div className="section-head"><h2>服务配置</h2><span>OPENAI-COMPATIBLE API</span></div>
    {saved?.profiles.length > 0 && <div className="model-list">
      {saved.profiles.map((profile) => <div className="model-compact" key={profile.id}>
        <span className="row-icon"><Sparkles size={20} /></span>
        <div className="model-compact-info"><strong>{profile.model}</strong><span>{profile.baseUrl}</span></div>
        {saved.activeId === profile.id ? <span className="state-badge good">使用中</span> : <button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => activate(profile.id)}>切换使用</button>}
        <button type="button" className="icon-button model-tool" aria-label={`编辑 ${profile.model}`} title="编辑配置" disabled={Boolean(busy)} onClick={() => start(profile)}><Pencil size={17} /></button>
        <button type="button" className="icon-button model-tool danger" aria-label={`删除 ${profile.model}`} title="删除配置" disabled={Boolean(busy)} onClick={() => remove(profile)}><Trash2 size={17} /></button>
      </div>)}
    </div>}
    {saved && !draft && <button className="outline-button model-add" type="button" onClick={() => start()} disabled={Boolean(busy)}><Plus size={16} /> 新增模型</button>}
    {draft && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><form className="modal model-dialog" role="dialog" aria-modal="true" aria-label={existing ? '编辑模型' : '新增模型'} onSubmit={save} onKeyDown={(event) => { if (event.key === 'Escape') closeEditor(); }}>
      <div className="model-panel">
        <div className="model-panel-head"><span className="row-icon"><Sparkles size={20} /></span><div><strong>{existing ? '编辑模型' : '新增模型'}</strong><p>填写服务地址与模型，测试通过后保存配置。</p></div><span className={(verified || unchanged && existing?.lastTest?.status === 'ok') ? 'state-badge good' : 'state-badge'}>{verified ? '测试通过' : unchanged && existing?.lastTest?.status === 'ok' ? '已验证' : '未验证'}</span><button className="icon-button" type="button" aria-label="关闭模型编辑" title="关闭" onClick={closeEditor}><X size={17} /></button></div>
        <div className="model-fields">
          <label htmlFor="model-url">API 地址 <span>服务根路径，例如 https://api.openai.com/v1</span></label>
          <input id="model-url" type="url" placeholder="https://api.example.com/v1" value={draft.baseUrl} onChange={(event) => change({ baseUrl: event.target.value })} required autoComplete="url" />
          <label htmlFor="model-name">模型名称 <span>使用服务商提供的准确模型 ID</span></label>
          <input id="model-name" type="text" placeholder="填写模型 ID" value={draft.model} onChange={(event) => change({ model: event.target.value })} required maxLength={120} autoComplete="off" />
          <label htmlFor="model-key">API Key <span>{existing?.hasKey ? '已保存；留空则保持不变' : '本地服务如无需密钥，可留空'}</span></label>
          <div className="key-input"><KeyRound size={17} /><input id="model-key" type={showKey ? 'text' : 'password'} placeholder={existing?.hasKey ? '已配置密钥' : '填写访问密钥'} value={draft.apiKey} onChange={(event) => change({ apiKey: event.target.value, clearKey: false })} autoComplete="new-password" /><button type="button" className="icon-button" aria-label={showKey ? '隐藏密钥' : '显示密钥'} title={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          {existing?.hasKey && <label className="clear-key"><input type="checkbox" checked={draft.clearKey} onChange={(event) => change({ clearKey: event.target.checked, apiKey: event.target.checked ? '' : draft.apiKey })} /> 移除已保存的密钥</label>}
        </div>
      </div>
      <div className="model-actions"><p><ShieldCheck size={17} /> 密钥只保存在本机，不会返回给浏览器。</p><div><button className="outline-button" type="button" disabled={Boolean(busy)} onClick={closeEditor}><X size={16} /> 取消</button><button className="outline-button" type="button" disabled={!draft.baseUrl.trim() || !draft.model.trim() || Boolean(busy)} onClick={test}>{busy === 'test' ? <LoaderCircle className="spin" size={16} /> : <TestTube2 size={16} />} 测试连接</button><button className="primary-button" type="submit" disabled={Boolean(busy) || !(unchanged || verified)}>{busy === 'save' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} 保存配置</button></div></div>
      {message && <div className={message.error ? 'notice error model-notice' : 'notice model-notice'} role="status">{message.error || message.text}</div>}
    </form></div>}
    {saved && <AgentBindings request={request} profiles={saved.profiles} activeId={saved.activeId} />}
    <AgentPreferences request={request} />
  </div>;
}
