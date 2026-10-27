import { readdir, readFile, mkdir, writeFile, rename, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isGenerated, visibleContent } from './source-markers.mjs';

export const TIMEZONE = 'Asia/Shanghai';

export function dateInZone(now = new Date(), timezone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function timeInZone(now = new Date(), timezone = TIMEZONE) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);
}

export function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function shouldDeliver(schedule, delivery, date, time, ready) {
  return Boolean(schedule.enabled && ready && time >= schedule.time &&
    !(delivery?.date === date && ['accepted', 'sending', 'uncertain', 'no_records'].includes(delivery.status)));
}

export function shouldRemind(reminder, delivery, date, time, ready, recordCount) {
  return Boolean(reminder?.enabled && ready && recordCount === 0 && time >= reminder.time &&
    !(delivery?.date === date && ['accepted', 'sending', 'uncertain'].includes(delivery.status)));
}

export const DEFAULT_TEMPLATE = '每日简报 | {{date}}\n\n{{content}}';
const templateFile = (root) => path.join(root, 'config', 'brief-template.md');
const digest = (value) => createHash('sha256').update(value).digest('hex');
async function guardTemplate(root) {
  for (const target of [path.join(root, 'config'), templateFile(root)]) {
    const entry = await lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (entry?.isSymbolicLink()) throw new Error('Symbolic links are not supported');
  }
}

export async function getTemplate(root) {
  await guardTemplate(root);
  const content = await readFile(templateFile(root), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return DEFAULT_TEMPLATE;
    throw error;
  });
  return { content, revision: digest(content) };
}

export async function saveTemplate(root, content, revision) {
  if (typeof content !== 'string' || content.length > 4000 || !content.includes('{{content}}') ||
    /{{\s*(?!date\s*}}|count\s*}}|content\s*}})[^}]*}}/.test(content)) throw new Error('模板只支持 {{date}}、{{count}} 和 {{content}}，且须包含内容占位符。');
  if (revision !== (await getTemplate(root)).revision) { const error = new Error('模板已被更新，请刷新后重试。'); error.status = 409; throw error; }
  const target = templateFile(root);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temp, content, { flag: 'wx' });
    await rename(temp, target);
  } finally { await unlink(temp).catch(() => {}); }
  return getTemplate(root);
}

export function renderTemplate(template, { date, count, content }) {
  return template.replace(/{{\s*(date|count|content)\s*}}/g, (_, key) => String({ date, count, content }[key])).trim().slice(0, 3500);
}

export const sampleBrief = { date: '2026-10-26', count: 2, content: '【健身】\n卧推 100kg，训练 45 分钟。\n\n【心情】\n今天状态不错。' };

export async function makeBrief(root, date) {
  const recordRoot = path.join(root, 'record');
  let dirs = [];
  try { dirs = await readdir(recordRoot, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const entries = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(recordRoot, dir.name, date.slice(0, 4), date.slice(5, 7), `${date}.md`);
    try {
      const text = (await readFile(file, 'utf8')).trim();
      if (text) entries.push({ category: dir.name, text });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const lines = [];
  for (const entry of entries) {
    lines.push(`【${entry.category}】`);
    lines.push(visibleContent(entry.text).replace(/^# .*\r?\n?/, '').trim().slice(0, 700));
    lines.push('');
  }
  const content = lines.join('\n').trim();
  const template = await getTemplate(root);
  return { date, count: entries.length, source: 'records', demo: entries.some((entry) => isGenerated(entry.text)),
    content, text: content ? renderTemplate(template.content, { date, count: entries.length, content }) : '' };
}
