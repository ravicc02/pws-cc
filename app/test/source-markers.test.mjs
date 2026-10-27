import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../server/workspace.mjs';

test('generated record stays tagged internally across editing while its content view is clean', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pws-source-'));
  try {
    const workspace = createWorkspace(root);
    const category = await workspace.ensureCategory('健康');
    const date = '2026-10-26';
    const original = '# 健康\n\n> 演示数据（虚构，不代表用户实际状态；请勿当成真实个人记录）\n\n- 静息心率: 67 bpm\n- 来源：模拟数值。\n';
    const initial = await workspace.get('record', category.slug, date);
    await workspace.save({ kind: 'record', category: category.slug, date, content: original, revision: initial.revision });
    const displayed = await workspace.get('record', category.slug, date);
    assert.equal(displayed.generated, true);
    assert.doesNotMatch(displayed.content, /演示|模拟|虚构/);
    assert.match(displayed.content, /静息心率: 67 bpm/);
    await workspace.save({ kind: 'record', category: category.slug, date, content: `${displayed.content}\n- 备注: 已更新\n`, revision: displayed.revision });
    const saved = await workspace.get('record', category.slug, date);
    assert.equal(saved.generated, true);
    assert.doesNotMatch(saved.content, /演示|模拟|虚构/);
    const raw = await readFile(path.join(root, 'record', category.slug, '2026', '10', `${date}.md`), 'utf8');
    assert.match(raw, /演示数据（虚构/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
