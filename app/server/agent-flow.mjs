const questionLead = /^(?:请问|怎么|如何|为什么|什么|能否|可不可以|是否)/;
const goalLead = /(?:我|本人|自己).{0,12}(?:想|希望|打算|准备|计划|决定|要|目标是)|(?:我的目标是|目标是)/;
const stopLead = /(?:我|本人|自己).{0,12}(?:不再|不想|放弃|取消|停止)/;
const hypothetical = /^(?:如果|假设|假如|比如|举例|例如)|(?:我想知道|我想问|我想了解|我想看看)/;

export function shouldExtract(message, imageId) {
  if (imageId) return true;
  if (/[?？]/.test(message) && !/(?:今天|昨天|刚才).{0,20}(?:做了|吃了|睡了|训练了|完成了)/.test(message)) return false;
  if (questionLead.test(message) || hypothetical.test(message)) return false;
  return /(?:我|今天|昨天|前天|昨晚|刚才|本周|上周|记录|完成|吃了|睡了|训练了)/.test(message);
}

export function validGoalAction(message, action) {
  if (typeof action?.quote !== 'string' || !action.quote.trim() || action.quote.length > 300 || !message.includes(action.quote) ||
      !['active', 'stopped'].includes(action.status) || hypothetical.test(message) || /[?？]/.test(action.quote)) return false;
  if (!/长期|以后|每周|每月|坚持|养成/.test(action.quote) && /(?:现在|马上|一会儿|今晚|今天).{0,12}(?:吃饭|睡觉|喝水|休息)/.test(action.quote)) return false;
  return action.status === 'active' ? goalLead.test(action.quote) && !stopLead.test(action.quote)
    : stopLead.test(action.quote);
}

export function isPlanOnly(quote) {
  return /(?:我(?:想|希望|打算|计划|准备|要)|我的目标)/.test(quote) &&
    !/(?:今天|昨天|刚才).{0,20}(?:完成|做了|走了|吃了|训练了|学习了)/.test(quote);
}

const topicCategories = [
  [/减肥|减脂|体重|饮食|热量|吃|餐/, ['diet', 'fitness', 'movement', 'sleep', 'health']],
  [/训练|健身|卧推|深蹲|运动|步行|跑步/, ['fitness', 'movement', 'sleep']],
  [/睡眠|熬夜|休息/, ['sleep', 'health']],
  [/学习|读书|阅读/, ['study']],
  [/心情|情绪|压力/, ['mood', 'sleep']],
];

export async function relevantMemory(workspace, message, categories, { advice = false } = {}) {
  if (!advice && !/最近|之前|过去|记录|总结|复盘|趋势|变化|目标|计划|建议|优化|怎么|如何/.test(message)) {
    return { records: [] };
  }
  const profile = (await workspace.get('profile')).content.slice(0, 2400);
  const matched = new Set(topicCategories.filter(([pattern]) => pattern.test(message)).flatMap(([, slugs]) => slugs));
  for (const item of categories) if (message.includes(item.name) || message.toLowerCase().includes(item.slug)) matched.add(item.slug);
  const today = workspace.today();
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 21);
  const records = (await workspace.list()).records.filter((item) => item.date >= cutoff.toISOString().slice(0, 10) && (!matched.size || matched.has(item.category)));
  const selected = [];
  const counts = new Map();
  const content = await Promise.all(records.slice(0, 80).map((item) => workspace.get('record', item.category, item.date)));
  for (const [index, item] of records.slice(0, 80).entries()) {
    if (selected.length >= 12) break;
    if ((counts.get(item.category) || 0) >= 3) continue;
    if (content[index].generated) continue;
    selected.push({ category: item.name, date: item.date, content: content[index].content.slice(0, 500) });
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
  }
  return { profile, records: selected, noConfirmedRecords: selected.length === 0 && records.length > 0 };
}
