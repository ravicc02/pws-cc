import path from 'node:path';
import { createHash } from 'node:crypto';
import { createStore } from './store.mjs';
import { analyzeDashboard } from './dashboard.mjs';
import { DASHBOARD_TREND_PROMPT } from './dashboard-prompt.mjs';

const fingerprint = (config) => createHash('sha256').update(JSON.stringify([config.baseUrl, config.model, config.apiKey])).digest('hex').slice(0, 16);

export function createDashboardHarness(root, analyze = analyzeDashboard) {
  const cache = createStore(path.join(root, 'app', 'runtime', 'dashboard-analysis.json'), () => ({ entries: {} }));
  const pending = new Map();
  const failures = new Map();

  async function get(dashboard, config) {
    if (!dashboard.evidence?.length) return { ...(await analyze(dashboard, config)), revision: dashboard.revision };
    if (!config?.baseUrl || !config?.model) return { kind: 'unconfigured', summary: '配置模型后将自动生成有依据的趋势解读。', insights: [], limitations: [], facts: [], generatedAt: null, revision: dashboard.revision };
    const key = `${dashboard.recent.days}:${dashboard.revision}:${fingerprint(config)}:${createHash('sha256').update(DASHBOARD_TREND_PROMPT).digest('hex').slice(0, 8)}`;
    const saved = cache.get().entries[key];
    if (saved) return saved;
    if (pending.has(key)) return pending.get(key);
    const failure = failures.get(key);
    if (failure && Date.now() - failure.at < 5 * 60_000) throw new Error(failure.message);
    const task = (async () => {
      const result = { ...(await analyze(dashboard, config)), revision: dashboard.revision };
      const entries = { ...cache.get().entries, [key]: result };
      const keys = Object.keys(entries);
      for (const old of keys.slice(0, Math.max(0, keys.length - 12))) delete entries[old];
      cache.replace({ entries });
      return result;
    })();
    pending.set(key, task);
    try { const result = await task; failures.delete(key); return result; }
    catch (error) { failures.set(key, { message: error.message, at: Date.now() }); throw error; }
    finally { pending.delete(key); }
  }
  return { get };
}
