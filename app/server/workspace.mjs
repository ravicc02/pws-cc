import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, lstat, unlink } from 'node:fs/promises';
import { dateInZone } from './review.mjs';
import { isGenerated, preserveSource, visibleContent } from './source-markers.mjs';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validDate(value) {
  if (!datePattern.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function slugFor(name) {
  const simple = name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return simple || `topic-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
}

const hash = (text) => createHash('sha256').update(text).digest('hex');
const safeText = (text, limit = 100000) => typeof text === 'string' && text.length <= limit;

export function createWorkspace(root) {
  function target(kind, category, date) {
    if (kind === 'profile') return path.join(root, 'info.md');
    if (!validDate(date)) throw new Error('Invalid date');
    if (kind === 'review') return path.join(root, 'review', 'daily', date.slice(0, 4), date.slice(5, 7), `${date}.md`);
    if (kind === 'record' && slugPattern.test(category || '')) {
      return path.join(root, 'record', category, date.slice(0, 4), date.slice(5, 7), `${date}.md`);
    }
    throw new Error('Invalid content selection');
  }

  async function guard(file) {
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid content selection');
    let current = root;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      const entry = await lstat(current).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (entry?.isSymbolicLink()) throw new Error('Symbolic links are not supported');
    }
  }

  async function read(file) {
    await guard(file);
    return readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  }

  async function write(file, content) {
    await guard(file);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  async function categories() {
    const folder = path.join(root, 'record');
    await guard(folder);
    const entries = await readdir(folder, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !slugPattern.test(entry.name)) continue;
      const rule = await read(path.join(folder, entry.name, 'rute.md'));
      const match = rule.match(/^#\s+(.+)$/m);
      result.push({ slug: entry.name, name: match?.[1]?.trim() || entry.name, initialized: /(?:^|\n)initialized:\s*true\s*(?:\n|$)/i.test(rule) });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async function resolveCategory(name) {
    const list = await categories();
    const value = String(name || '').trim();
    return list.find((category) => category.slug === value || category.name.toLowerCase() === value.toLowerCase()) || null;
  }

  async function ensureCategory(name) {
    const label = String(name || '').trim();
    if (!label || label.length > 60 || /[\r\n#]/.test(label)) throw new Error('Invalid category name');
    const existing = await resolveCategory(label);
    if (existing) return existing;
    const slug = slugFor(label);
    const collision = (await categories()).find((category) => category.slug === slug);
    if (collision) throw new Error('Category name conflicts with an existing category');
    const rule = path.join(root, 'record', slug, 'rute.md');
    await write(rule, `# ${label}\n\ninitialized: true\n\n## 当前记录范围\n- 只记录用户明确报告的本分区事实；计划、举例和已完成事项分开。\n\n## 可记录字段\n- 保留用户实际提供的内容、日期、数值与单位；缺失字段不推测。\n\n## 关联与确认\n- 按事实发生日期保存；改变追踪范围时再更新本规则。\n`);
    return { slug, name: label, initialized: true };
  }

  async function initializeCategory(category) {
    const rule = path.join(root, 'record', category.slug, 'rute.md');
    const existing = await read(rule);
    if (category.initialized) return;
    const next = existing
      ? `${existing.trimEnd().replace(/(?:^|\n)initialized:\s*false\s*(?=\n|$)/i, '')}\n\ninitialized: true\n`
      : `# ${category.name}\n\ninitialized: true\n\n## 当前记录范围\n- 只记录用户明确报告的本分区事实，按发生日期保存。\n`;
    await write(rule, next);
  }

  async function list() {
    const records = [];
    for (const category of await categories()) {
      const folder = path.join(root, 'record', category.slug);
      for (const year of await readdir(folder, { withFileTypes: true })) {
        if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
        for (const month of await readdir(path.join(folder, year.name), { withFileTypes: true })) {
          if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue;
          for (const file of await readdir(path.join(folder, year.name, month.name), { withFileTypes: true })) {
            const date = file.name.slice(0, 10);
            if (file.isFile() && file.name === `${date}.md` && validDate(date)) records.push({ kind: 'record', category: category.slug, name: category.name, date });
          }
        }
      }
    }
    const reviews = [];
    const folder = path.join(root, 'review', 'daily');
    for (const year of await readdir(folder, { withFileTypes: true }).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
      if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
      for (const month of await readdir(path.join(folder, year.name), { withFileTypes: true })) {
        if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue;
        for (const file of await readdir(path.join(folder, year.name, month.name), { withFileTypes: true })) {
          const date = file.name.slice(0, 10);
          if (file.isFile() && file.name === `${date}.md` && validDate(date)) reviews.push({ kind: 'review', date });
        }
      }
    }
    return { categories: await categories(), records: records.sort((a, b) => b.date.localeCompare(a.date)), reviews: reviews.sort((a, b) => b.date.localeCompare(a.date)) };
  }

  async function get(kind, category, date) {
    const file = target(kind, category, date);
    if (kind === 'record' && !(await categories()).some((item) => item.slug === category)) throw new Error('Category not found');
    const raw = await read(file);
    return { kind, category: kind === 'record' ? category : undefined, date: kind === 'profile' ? undefined : date,
      content: visibleContent(raw), revision: hash(raw), exists: Boolean(raw), generated: isGenerated(raw) };
  }

  async function save({ kind, category, date, content, revision, name }) {
    if (!safeText(content) || typeof revision !== 'string') throw new Error('Invalid content');
    if (kind === 'record' && !category && name) category = (await ensureCategory(name)).slug;
    const current = await get(kind, category, date);
    if (revision !== current.revision && !(revision === '' && !current.exists)) { const error = new Error('Content changed elsewhere. Reload before saving.'); error.status = 409; throw error; }
    const file = target(kind, category, date);
    await write(file, preserveSource(content, await read(file)));
    return get(kind, category, date);
  }

  async function appendRecord(category, date, quote) {
    if (!safeText(quote, 1000) || !quote.trim()) throw new Error('Invalid record');
    const file = target('record', category.slug, date);
    const existing = await read(file);
    await write(file, `${existing.trimEnd()}${existing.trim() ? '\n' : ''}- ${quote.trim().replace(/\n/g, ' ')}\n`);
    return { kind: 'record', category: category.slug, date };
  }

  async function appendGoal(quote, status, date = dateInZone()) {
    if (!safeText(quote, 300) || !quote.trim() || !validDate(date) || !['active', 'stopped'].includes(status)) throw new Error('Invalid goal');
    const file = target('profile');
    const existing = await read(file);
    const wording = quote.trim().replace(/\s+/g, ' ').replace(/\|/g, '｜');
    const label = status === 'active' ? '新增' : '停止';
    const entry = `| ${date} | ${label} | ${wording} |`;
    if (existing.split(/\r?\n/).some((line) => line.endsWith(`| ${label} | ${wording} |`))) return { kind: 'profile', goal: true, date, status, duplicate: true };
    const heading = /^## 长期目标\s*$/m.exec(existing);
    if (!heading) {
      await write(file, `${existing.trimEnd() || '# 基本资料'}\n\n## 长期目标\n\n| 日期 | 状态 | 用户原话 |\n| --- | --- | --- |\n${entry}\n`);
    } else {
      const afterHeading = heading.index + heading[0].length;
      const nextHeading = /^## (?!长期目标).+$/gm;
      nextHeading.lastIndex = afterHeading;
      const sectionEnd = nextHeading.exec(existing)?.index ?? existing.length;
      await write(file, `${existing.slice(0, sectionEnd).trimEnd()}\n${entry}\n\n${existing.slice(sectionEnd).replace(/^\n+/, '')}`);
    }
    return { kind: 'profile', goal: true, date, status, duplicate: false };
  }

  return { list, get, save, categories, resolveCategory, ensureCategory, initializeCategory, appendRecord, appendGoal, readInternal: read, today: dateInZone };
}
