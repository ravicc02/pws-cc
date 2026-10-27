export const defaultModelConfig = () => ({
  baseUrl: '',
  model: '',
  apiKey: '',
  lastTest: null,
});

export const defaultModelState = () => ({ activeId: null, profiles: [] });

export function normalizeModelState(state) {
  if (state.baseUrl && state.model && (!Array.isArray(state.profiles) || state.profiles.length === 0)) {
    const profile = { id: 'legacy-default', baseUrl: state.baseUrl, model: state.model, apiKey: state.apiKey || '', lastTest: state.lastTest || null };
    return { activeId: profile.id, profiles: [profile] };
  }
  if (Array.isArray(state.profiles)) {
    const profiles = state.profiles;
    return { activeId: profiles.some((profile) => profile.id === state.activeId) ? state.activeId : profiles[0]?.id || null, profiles };
  }
  return defaultModelState();
}

export function publicModelState(state) {
  const { activeId, profiles } = normalizeModelState(state);
  return { activeId, profiles: profiles.map((profile) => ({ id: profile.id, ...publicModelConfig(profile) })) };
}

export function activeModelConfig(state) {
  const { activeId, profiles } = normalizeModelState(state);
  return profiles.find((profile) => profile.id === activeId) || defaultModelConfig();
}

export function modelProfile(state, id) {
  const profile = normalizeModelState(state).profiles.find((item) => item.id === id);
  if (!profile) throw new Error('模型配置不存在，请刷新后重试。');
  return profile;
}

export function saveModelProfile(state, id, config, lastTest, newId) {
  const current = normalizeModelState(state);
  if (!id) {
    const profile = { id: newId, ...config, lastTest };
    return { activeId: current.activeId || profile.id, profiles: [...current.profiles, profile] };
  }
  modelProfile(current, id);
  return { ...current, profiles: current.profiles.map((profile) => profile.id === id ? { ...profile, ...config, lastTest } : profile) };
}

export function activateModelProfile(state, id) {
  const current = normalizeModelState(state);
  modelProfile(current, id);
  return { ...current, activeId: id };
}

export function deleteModelProfile(state, id) {
  const current = normalizeModelState(state);
  modelProfile(current, id);
  const profiles = current.profiles.filter((profile) => profile.id !== id);
  return { profiles, activeId: current.activeId === id ? profiles[0]?.id || null : current.activeId };
}

export function publicModelConfig(config) {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasKey: Boolean(config.apiKey),
    lastTest: config.lastTest,
  };
}

export function updateModelConfig(current, input) {
  if (typeof input.baseUrl !== 'string' || typeof input.model !== 'string') {
    throw new Error('Enter a service URL and model name');
  }
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  const model = input.model.trim();
  if (!baseUrl || !model || baseUrl.length > 300 || model.length > 120) {
    throw new Error('Enter a valid service URL and model name');
  }
  let url;
  try { url = new URL(baseUrl); }
  catch { throw new Error('Invalid service URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('Use HTTPS, or HTTP on localhost only, without URL credentials or query parameters');
  }
  if (/\/chat\/completions\/?$/.test(url.pathname)) {
    throw new Error('Enter the API base URL, without /chat/completions');
  }
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 1024)) {
    throw new Error('Invalid API key');
  }
  if (input.clearKey !== undefined && typeof input.clearKey !== 'boolean') {
    throw new Error('Invalid key option');
  }
  return {
    baseUrl,
    model,
    apiKey: input.clearKey ? '' : (input.apiKey?.trim() || current.apiKey || ''),
    lastTest: null,
  };
}

export async function testModelConnection(config, fetchImpl = fetch) {
  if (!config.baseUrl || !config.model) throw new Error('Save a model configuration first');
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        stream: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Could not reach the model service within 20 seconds');
  }
  if (!response.ok) throw new Error(`Model request rejected (HTTP ${response.status})`);
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Model service did not return JSON'); }
  if (!Array.isArray(result.choices) || result.choices.length === 0) {
    throw new Error('Model service did not return a chat completion');
  }
  return { status: 'ok', at: new Date().toISOString(), latencyMs: Date.now() - startedAt };
}

export async function completeChat(config, messages, fetchImpl = fetch, timeoutMs = 90000) {
  if (!config.baseUrl || !config.model) { const error = new Error('请先在模型配置中保存服务地址和模型。'); error.status = 409; throw error; }
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.model, messages, stream: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? '模型处理超过 90 秒，请稍后重试。'
      : '模型服务不可用，请稍后重试。');
  }
  if (!response.ok) throw new Error(`模型请求失败 (HTTP ${response.status})`);
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('模型未返回有效内容。');
  return content;
}

export async function transcribeAudio(config, bytes, mime, fetchImpl = fetch) {
  if (!config.baseUrl) throw new Error('请先配置模型服务。');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error('音频不能超过 12 MB。');
  const types = { 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3' };
  if (!types[mime]) throw new Error('不支持这种音频格式。');
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: mime }), `voice.${types[mime]}`);
  form.set('model', process.env.PWS_TRANSCRIPTION_MODEL || 'whisper-1');
  form.set('language', 'zh');
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/audio/transcriptions`, {
      method: 'POST', headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body: form, signal: AbortSignal.timeout(45000),
    });
  } catch { throw new Error('语音转写服务不可用或超时。'); }
  if (!response.ok) throw new Error(`语音转写失败 (HTTP ${response.status})，请确认服务支持 /audio/transcriptions。`);
  const result = await response.json();
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('语音未识别出文字，请改用文字发送。');
  return result.text.trim().slice(0, 2000);
}
