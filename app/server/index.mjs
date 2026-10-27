import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createStore } from './store.mjs';
import { dateInZone, makeBrief, timeInZone, validTime, shouldDeliver, shouldRemind, getTemplate, saveTemplate, renderTemplate, sampleBrief } from './review.mjs';
import { beginBinding, checkBinding, getUpdates, sendText, sendImage } from './weixin.mjs';
import { activeModelConfig, defaultModelConfig, defaultModelState, publicModelState, modelProfile, saveModelProfile, activateModelProfile, deleteModelProfile, testModelConnection, updateModelConfig, transcribeAudio } from './model.mjs';
import { createWorkspace } from './workspace.mjs';
import { createChat } from './chat.mjs';
import { getQuestions, saveQuestions, formatQuestions } from './daily-review.mjs';
import { createWeixinInbox } from './inbound.mjs';
import { defaultAgentPreferences, publicAgentPreferences, updateAgentPreferences } from './agent-preferences.mjs';
import { defaultAgentRouting, publicAgentRouting, updateAgentRouting, reconcileAgentRouting } from './agent-routing.mjs';
import { buildDashboard } from './dashboard.mjs';
import { createDashboardHarness } from './dashboard-harness.mjs';
import { createMedia, imageFromDataUrl, downloadWeixinMedia, voiceToWav } from './media.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(appDir, '../..');
const dist = path.resolve(appDir, '../dist');
const store = createStore(path.resolve(appDir, '../runtime/state.json'));
const modelStore = createStore(path.resolve(appDir, '../runtime/model.json'), defaultModelState);
const agentStore = createStore(path.resolve(appDir, '../runtime/agent.json'), defaultAgentPreferences);
const routingStore = createStore(path.resolve(appDir, '../runtime/agent-routing.json'), defaultAgentRouting);
const workspace = createWorkspace(root);
const media = createMedia(root);
const chat = createChat(root, workspace, modelStore, undefined, () => agentStore.get(), () => routingStore.get());
const inbox = createWeixinInbox(store, chat, workspace, undefined, {
  saveWeixinImage: async (item) => (await media.saveImage(await downloadWeixinMedia(item))).id,
  transcribe: async (item) => {
    const bytes = await downloadWeixinMedia(item);
    const wav = item.voice_item.encode_type === 6 ? await voiceToWav(bytes) : bytes;
    const mime = item.voice_item.encode_type === 6 ? 'audio/wav' : item.voice_item.encode_type === 7 ? 'audio/mpeg' : null;
    if (!mime) throw new Error('微信语音格式暂不支持，请发文字。');
    return transcribeAudio(activeModelConfig(modelStore.get()), wav, mime);
  },
});
const dashboardHarness = createDashboardHarness(root);
const port = Number(process.env.PORT || 4318);
let pendingBinding = null;
let bindingPoll = null;
let monitorAccount = null;
let monitorRunning = false;
let lastChannelError = null;
let sending = false;
let reminding = false;
let askingReview = false;
const testedConfigs = new Map();
const configHash = (config) => createHash('sha256').update(JSON.stringify([config.baseUrl, config.model, config.apiKey])).digest('hex');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function monitor() {
  if (monitorRunning) return;
  monitorRunning = true;
  while (store.get().account) {
    try {
      await inbox.flushPending();
      const { account, syncBuffer } = store.get();
      if (monitorAccount !== account.botId) {
        monitorAccount = account.botId;
        lastChannelError = null;
      }
      const result = await getUpdates(account, syncBuffer);
      for (const message of result.msgs || []) {
        await inbox.handle(message);
      }
      store.update({
        syncBuffer: result.get_updates_buf || syncBuffer,
      });
      lastChannelError = null;
    } catch (error) {
      if (error.name !== 'TimeoutError') {
        lastChannelError = error.message;
        console.error('Weixin monitor:', error.message);
        await delay(5000);
      }
    }
  }
  monitorRunning = false;
}

async function deliver(date, manual = false) {
  if (sending) throw new Error('A delivery is already in progress');
  const state = store.get();
  if (!state.account?.contextToken) throw new Error('Weixin conversation is not ready');
  const brief = await makeBrief(root, date);
  if (!brief.text) throw new Error('No review or records for this date; no brief was sent');
  if (!manual && brief.demo) return;
  const previous = state.delivery;
  if (!manual && previous?.date === date && ['accepted', 'sending', 'uncertain'].includes(previous.status)) return;
  sending = true;
  const clientId = randomUUID();
  store.update({ delivery: { date, status: 'sending', clientId, manual, at: new Date().toISOString() } });
  try {
    const result = await sendText(state.account, brief.text, clientId);
    store.update({ delivery: { date, status: 'accepted', clientId, manual, at: result.acceptedAt } });
  } catch (error) {
    store.update({ delivery: { date, status: 'uncertain', clientId, manual, at: new Date().toISOString(), error: error.message } });
    throw error;
  } finally { sending = false; }
}

async function askReview(date) {
  if (askingReview) throw new Error('A review prompt is already in progress');
  const state = store.get();
  if (!state.account?.contextToken) throw new Error('Weixin conversation is not ready');
  const previous = state.reviewPromptDelivery;
  if (previous?.date === date && ['accepted', 'answered', 'sending', 'uncertain'].includes(previous.status)) {
    const error = new Error('今天的复盘问题已发送或状态待确认。'); error.status = 409; throw error;
  }
  if ((await workspace.get('review', null, date)).content.trim()) {
    const error = new Error('今天已有复盘内容，无需再次提问。'); error.status = 409; throw error;
  }
  const { questions } = await getQuestions(root);
  const clientId = randomUUID();
  askingReview = true;
  store.update({ reviewPromptDelivery: { date, status: 'sending', clientId, questions, at: new Date().toISOString() } });
  try {
    const sent = await sendText(state.account, formatQuestions(date, questions), clientId);
    store.update({ reviewPromptDelivery: { date, status: 'accepted', clientId, questions, at: sent.acceptedAt } });
  } catch (error) {
    store.update({ reviewPromptDelivery: { date, status: 'uncertain', clientId, questions, at: new Date().toISOString(), error: error.message } });
    throw error;
  } finally { askingReview = false; }
}

async function tick() {
  const state = store.get();
  const date = dateInZone();
  const currentBrief = state.reminder?.enabled ? await makeBrief(root, date) : null;
  if (state.reminder?.enabled && !reminding && shouldRemind(state.reminder, state.reminderDelivery, date, timeInZone(), state.account?.contextToken, currentBrief.content ? 1 : 0)) {
    reminding = true;
    const clientId = randomUUID();
    store.update({ reminderDelivery: { date, status: 'sending', clientId, at: new Date().toISOString() } });
    try {
      const sent = await sendText(state.account, '今天还没有记录。方便的话，和我说说今天的运动、饮食或心情吧。', clientId);
      store.update({ reminderDelivery: { date, status: 'accepted', clientId, at: sent.acceptedAt } });
    } catch (error) {
      store.update({ reminderDelivery: { date, status: 'uncertain', clientId, at: new Date().toISOString(), error: error.message } });
      throw error;
    } finally { reminding = false; }
  }
  const prompt = store.get().reviewPromptDelivery;
  if (state.reviewPrompt?.enabled && !askingReview && state.account?.contextToken && timeInZone() >= state.reviewPrompt.time &&
    !(prompt?.date === date && ['accepted', 'answered', 'sending', 'uncertain'].includes(prompt.status)) &&
    !(await workspace.get('review', null, date)).content.trim()) await askReview(date);
  if (!shouldDeliver(state.schedule, state.delivery, date, timeInZone(), state.account?.contextToken)) return;
  const brief = await makeBrief(root, date);
  if (brief.demo) return;
  if (!brief.text) {
    store.update({ delivery: { date, status: 'no_records', at: new Date().toISOString() } });
    return;
  }
  await deliver(date);
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function body(req, maxLength = 120000) {
  let content = '';
  for await (const chunk of req) {
    content += chunk;
    if (content.length > maxLength) throw new Error('Request too large');
  }
  return content ? JSON.parse(content) : {};
}

function publicState() {
  const state = store.get();
  return {
    schedule: state.schedule,
    reminder: state.reminder || { enabled: false, time: '20:00', timezone: 'Asia/Shanghai' },
    reminderDelivery: state.reminderDelivery || null,
    reviewPrompt: state.reviewPrompt || { enabled: false, time: '20:30', timezone: 'Asia/Shanghai' },
    reviewPromptDelivery: state.reviewPromptDelivery || null,
    connection: {
      bound: Boolean(state.account),
      conversationReady: Boolean(state.account?.contextToken),
      accountId: state.account?.botId || null,
      error: lastChannelError,
    },
    delivery: state.delivery,
    today: dateInZone(),
  };
}

async function serveStatic(req, res, pathname) {
  const target = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!target.startsWith(`${dist}${path.sep}`)) return json(res, 404, { error: 'Not found' });
  try {
    if (!(await stat(target)).isFile()) throw new Error('Not a file');
    const extension = path.extname(target);
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extension] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
    res.end(await readFile(target));
  } catch { json(res, 404, { error: 'Build the web app first with npm run build' }); }
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || '';
  const origin = req.headers.origin;
  if (!/^((127\.0\.0\.1)|(localhost))(:\d+)?$/.test(host) ||
    (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))) {
    return json(res, 403, { error: 'Local requests only' });
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const params = new URL(req.url, 'http://localhost').searchParams;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  try {
    if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, publicState());
    if (req.method === 'GET' && pathname === '/api/content') {
      const result = await workspace.list();
      return json(res, 200, { ...result, categories: result.categories.map(({ slug, name }) => ({ slug, name })) });
    }
    if (req.method === 'POST' && pathname === '/api/content/categories') {
      const category = await workspace.ensureCategory((await body(req)).name);
      return json(res, 200, { slug: category.slug, name: category.name });
    }
    if (req.method === 'GET' && pathname === '/api/content/item') {
      return json(res, 200, await workspace.get(params.get('kind'), params.get('category'), params.get('date')));
    }
    if (req.method === 'POST' && pathname === '/api/content/item') {
      const result = await workspace.save(await body(req));
      return json(res, 200, result);
    }
    if (req.method === 'GET' && pathname === '/api/chat') return json(res, 200, chat.state());
    if (req.method === 'GET' && pathname.startsWith('/api/media/')) {
      const image = await media.getImage(pathname.slice('/api/media/'.length));
      res.writeHead(200, { 'Content-Type': image.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(image.bytes);
    }
    if (req.method === 'POST' && pathname === '/api/weixin/send-image') {
      const { imageId } = await body(req);
      const account = store.get().account;
      if (!account?.contextToken) throw new Error('请先绑定微信并建立会话。');
      const picture = await media.getImage(imageId);
      return json(res, 200, await sendImage(account, picture.bytes));
    }
    if (req.method === 'POST' && pathname === '/api/chat') {
      const payload = await body(req, 26 * 1024 * 1024);
      let imageId;
      if (payload.image) imageId = (await media.saveImage(imageFromDataUrl(payload.image).bytes)).id;
      if (payload.audio) {
        const match = /^data:(audio\/(?:wav|webm|ogg|mp4|mpeg));base64,([A-Za-z0-9+/=]+)$/.exec(payload.audio);
        if (!match || match[2].length > 12 * 1024 * 1024 * 1.4) throw new Error('音频格式无效或过大。');
        const transcript = await transcribeAudio(activeModelConfig(modelStore.get()), Buffer.from(match[2], 'base64'), match[1]);
        payload.text = [payload.text, transcript].filter(Boolean).join('\n');
      }
      return json(res, 200, await chat.send({ text: payload.text || '', imageId }));
    }
    if (req.method === 'GET' && pathname === '/api/agent/preferences') return json(res, 200, publicAgentPreferences(agentStore.get()));
    if (req.method === 'POST' && pathname === '/api/agent/preferences') {
      const next = updateAgentPreferences(agentStore.get(), await body(req));
      return json(res, 200, publicAgentPreferences(agentStore.replace(next)));
    }
    if (req.method === 'GET' && pathname === '/api/dashboard') {
      const windowDays = Number(params.get('window') || 7);
      return json(res, 200, await buildDashboard(workspace, windowDays));
    }
    if (req.method === 'POST' && pathname === '/api/dashboard/analysis') {
      const input = await body(req);
      const dashboard = await buildDashboard(workspace, Number(input.window || 7));
      if (input.revision !== dashboard.revision) return json(res, 409, { error: '记录已变化，请刷新仪表盘后重试。' });
      const result = await dashboardHarness.get(dashboard, activeModelConfig(modelStore.get()));
      if ((await buildDashboard(workspace, Number(input.window || 7))).revision !== dashboard.revision) return json(res, 409, { error: '记录已变化，请刷新仪表盘后重试。' });
      return json(res, 200, result);
    }
    if (req.method === 'GET' && pathname === '/api/model') return json(res, 200, publicModelState(modelStore.get()));
    if (req.method === 'POST' && pathname === '/api/model') {
      const input = await body(req);
      const id = input.id || null;
      const prior = id ? modelProfile(modelStore.get(), id) : defaultModelConfig();
      const config = updateModelConfig(prior, input);
      const unchanged = Boolean(id && configHash(prior) === configHash(config));
      const tested = testedConfigs.get(input.testToken);
      if (!unchanged && (!tested || tested.id !== id || tested.previousHash !== (id ? configHash(prior) : null) || tested.hash !== configHash(config) || Date.now() > tested.expiresAt)) {
        return json(res, 409, { error: '请先测试当前配置，再保存。' });
      }
      if (!unchanged) testedConfigs.delete(input.testToken);
      const next = modelStore.replace(saveModelProfile(modelStore.get(), id, config, unchanged ? prior.lastTest : tested.result, randomUUID()));
      return json(res, 200, publicModelState(next));
    }
    if (req.method === 'POST' && pathname === '/api/model/test') {
      const input = await body(req);
      const id = input.id || null;
      const prior = id ? modelProfile(modelStore.get(), id) : defaultModelConfig();
      const config = updateModelConfig(prior, input);
      const result = await testModelConnection(config);
      const token = randomUUID();
      testedConfigs.set(token, { id, previousHash: id ? configHash(prior) : null, hash: configHash(config), expiresAt: Date.now() + 10 * 60_000, result });
      return json(res, 200, { ...result, testToken: token });
    }
    if (req.method === 'POST' && pathname === '/api/model/activate') {
      const next = modelStore.replace(activateModelProfile(modelStore.get(), (await body(req)).id));
      return json(res, 200, publicModelState(next));
    }
    if (req.method === 'POST' && pathname === '/api/model/delete') {
      const next = modelStore.replace(deleteModelProfile(modelStore.get(), (await body(req)).id));
      routingStore.replace(reconcileAgentRouting(routingStore.get(), next));
      return json(res, 200, publicModelState(next));
    }
    if (req.method === 'GET' && pathname === '/api/model/roles') {
      return json(res, 200, publicAgentRouting(routingStore.get(), modelStore.get()));
    }
    if (req.method === 'POST' && pathname === '/api/model/roles') {
      const next = routingStore.replace(updateAgentRouting(await body(req), modelStore.get()));
      return json(res, 200, publicAgentRouting(next, modelStore.get()));
    }
    if (req.method === 'GET' && pathname === '/api/review') {
      const result = await makeBrief(root, dateInZone());
      return json(res, 200, result);
    }
    if (req.method === 'GET' && pathname === '/api/review/template') {
      const template = await getTemplate(root);
      return json(res, 200, { ...template, sample: renderTemplate(template.content, sampleBrief) });
    }
    if (req.method === 'GET' && pathname === '/api/daily-review/questions') {
      const result = await getQuestions(root);
      return json(res, 200, { ...result, sample: formatQuestions(dateInZone(), result.questions) });
    }
    if (req.method === 'POST' && pathname === '/api/daily-review/questions') {
      const input = await body(req);
      const result = await saveQuestions(root, input.questions, input.revision);
      return json(res, 200, { ...result, sample: formatQuestions(dateInZone(), result.questions) });
    }
    if (req.method === 'POST' && pathname === '/api/daily-review/send') {
      await askReview(dateInZone());
      return json(res, 200, publicState());
    }
    if (req.method === 'POST' && pathname === '/api/review/template') {
      const input = await body(req);
      const template = await saveTemplate(root, input.content, input.revision);
      return json(res, 200, { ...template, sample: renderTemplate(template.content, sampleBrief) });
    }
    if (req.method === 'POST' && pathname === '/api/bind/start') {
      if (store.get().account) return json(res, 409, { error: 'An account is already bound' });
      pendingBinding = await beginBinding();
      return json(res, 200, { status: 'wait', qrText: pendingBinding.qrText });
    }
    if (req.method === 'POST' && pathname === '/api/bind/verify') {
      if (!pendingBinding) return json(res, 409, { error: 'Start binding first' });
      const input = await body(req);
      if (!/^\d{4,8}$/.test(String(input.code || ''))) return json(res, 400, { error: 'Invalid verification code' });
      pendingBinding.verifyCode = String(input.code);
      return json(res, 200, { status: 'verifying' });
    }
    if (req.method === 'GET' && pathname === '/api/bind/status') {
      if (!pendingBinding) return json(res, 200, { status: store.get().account ? 'confirmed' : 'idle' });
      if (Date.now() - pendingBinding.startedAt > 5 * 60_000) {
        pendingBinding = null;
        return json(res, 200, { status: 'expired' });
      }
      if (bindingPoll) return json(res, 200, { status: 'wait' });
      bindingPoll = checkBinding(pendingBinding, pendingBinding.verifyCode);
      try {
        const result = await bindingPoll;
        if (result.account) {
          store.update({ account: result.account, syncBuffer: '', seenMessages: [], pendingReply: null });
          pendingBinding = null;
          void monitor();
          return json(res, 200, { status: 'confirmed' });
        }
        pendingBinding = result.binding;
        if (['expired', 'verify_code_blocked', 'binded_redirect'].includes(result.status)) pendingBinding = null;
        return json(res, 200, { status: result.status });
      } finally { bindingPoll = null; }
    }
    if (req.method === 'POST' && pathname === '/api/schedule') {
      const input = await body(req);
      if (!validTime(input.time) || typeof input.enabled !== 'boolean' || !validTime(input.reminderTime) || typeof input.reminderEnabled !== 'boolean' || !validTime(input.reviewTime) || typeof input.reviewEnabled !== 'boolean') return json(res, 400, { error: 'Invalid schedule' });
      if (input.enabled && input.reminderEnabled && input.reminderTime >= input.time) return json(res, 400, { error: '提醒时间应早于简报时间。' });
      store.update({ schedule: { enabled: input.enabled, time: input.time, timezone: 'Asia/Shanghai' }, reminder: { enabled: input.reminderEnabled, time: input.reminderTime, timezone: 'Asia/Shanghai' }, reviewPrompt: { enabled: input.reviewEnabled, time: input.reviewTime, timezone: 'Asia/Shanghai' } });
      return json(res, 200, publicState());
    }
    if (req.method === 'POST' && pathname === '/api/test') {
      const account = store.get().account;
      if (!account?.contextToken) return json(res, 409, { error: 'Send a message to the bot from Weixin first' });
      const sent = await sendText(account, 'PWS CC 测试消息：微信接口已接受发送请求。');
      return json(res, 200, { status: 'accepted', at: sent.acceptedAt });
    }
    if (req.method === 'POST' && pathname === '/api/review/send') {
      await deliver(dateInZone(), true);
      return json(res, 200, publicState());
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('API:', error.message);
    return json(res, error.status || (error instanceof SyntaxError ? 400 : 400), { error: error.message });
  }
});

if (store.get().delivery?.status === 'sending') {
  store.update({ delivery: { ...store.get().delivery, status: 'uncertain', error: 'Server restarted during delivery' } });
}
if (store.get().reminderDelivery?.status === 'sending') {
  store.update({ reminderDelivery: { ...store.get().reminderDelivery, status: 'uncertain', error: 'Server restarted during delivery' } });
}
if (store.get().reviewPromptDelivery?.status === 'sending') {
  store.update({ reviewPromptDelivery: { ...store.get().reviewPromptDelivery, status: 'uncertain', error: 'Server restarted during delivery' } });
}
if (store.get().account) void monitor();
setInterval(() => tick().catch((error) => console.error('Scheduler:', error.message)), 30_000);
async function refreshDailyAnalysis() {
  const dashboard = await buildDashboard(workspace, 7);
  await dashboardHarness.get(dashboard, activeModelConfig(modelStore.get()));
}
void refreshDailyAnalysis().catch((error) => console.error('Dashboard analysis:', error.message));
setInterval(() => refreshDailyAnalysis().catch((error) => console.error('Dashboard analysis:', error.message)), 60_000);
server.listen(port, '127.0.0.1', () => console.log(`PWS CC API: http://127.0.0.1:${port}`));
