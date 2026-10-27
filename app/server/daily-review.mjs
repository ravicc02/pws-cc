import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { validDate } from './workspace.mjs';

export const DEFAULT_QUESTIONS = [
  '今天最重要的进展是什么？',
  '遇到了什么困难，原因是什么？',
  '明天准备调整或继续做什么？',
];

const digest = (value) => createHash('sha256').update(value).digest('hex');
const fileFor = (root) => path.join(root, 'config', 'daily-review-questions.json');

async function guard(root) {
  for (const target of [path.join(root, 'config'), fileFor(root)]) {
    const entry = await lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (entry?.isSymbolicLink()) throw new Error('Symbolic links are not supported');
  }
}

export async function getQuestions(root) {
  await guard(root);
  const content = await readFile(fileFor(root), 'utf8').catch((error) => error.code === 'ENOENT' ? JSON.stringify(DEFAULT_QUESTIONS) : Promise.reject(error));
  const questions = JSON.parse(content);
  if (!Array.isArray(questions) || !questions.every((question) => typeof question === 'string')) throw new Error('Invalid review questions file');
  return { questions, revision: digest(content) };
}

export async function saveQuestions(root, questions, revision) {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 8 ||
    questions.some((question) => typeof question !== 'string' || !question.trim() || question.trim().length > 200 || /[\r\n]/.test(question))) {
    throw new Error('请设置 1 到 8 个问题，每题不超过 200 字。');
  }
  if (revision !== (await getQuestions(root)).revision) { const error = new Error('复盘问题已更改，请刷新后重试。'); error.status = 409; throw error; }
  const target = fileFor(root);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(questions.map((question) => question.trim()), null, 2), { flag: 'wx' });
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(() => {}); }
  return getQuestions(root);
}

export function formatQuestions(date, questions) {
  if (!validDate(date)) throw new Error('Invalid review date');
  return `每日复盘 | ${date}\n\n${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}\n\n回复“复盘：你的回答”，或按序号逐条回答。`;
}

export function reviewAnswer(text) {
  if (typeof text !== 'string' || text.length > 4000) return null;
  const value = text.trim();
  if (/^复盘[：:]\s*\S/s.test(value)) return value.replace(/^复盘[：:]\s*/, '');
  if (/^[1-8][.、]\s*\S/.test(value)) return value;
  return null;
}

export async function appendReviewAnswer(workspace, date, questions, text, messageId) {
  if (!validDate(date) || !Array.isArray(questions) || !reviewAnswer(text) || !messageId) throw new Error('Invalid review answer');
  const current = await workspace.get('review', null, date);
  const marker = `<!-- review-message:${digest(String(messageId)).slice(0, 20)} -->`;
  if (current.content.includes(marker)) return current;
  const header = current.content.trim() ? `${current.content.trimEnd()}\n\n` :
    `# 每日复盘 | ${date}\n\n${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}\n\n`;
  return workspace.save({ kind: 'review', date, content: `${header}## ${current.content.trim() ? '补充回答' : '回答'}\n\n${reviewAnswer(text)}\n\n${marker}\n`, revision: current.revision });
}
