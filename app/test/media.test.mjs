import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv } from 'node:crypto';
import { createMedia, imageFromDataUrl, downloadWeixinMedia } from '../server/media.mjs';
import { transcribeAudio } from '../server/model.mjs';
import { sendImage } from '../server/weixin.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');

test('private image store validates type, size and id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pws-media-'));
  try {
    const media = createMedia(root);
    const saved = await media.saveImage(png);
    assert.equal((await media.getImage(saved.id)).mime, 'image/png');
    assert.equal(imageFromDataUrl(`data:image/png;base64,${png.toString('base64')}`).bytes.length, png.length);
    assert.throws(() => imageFromDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`), /格式/);
    await assert.rejects(() => media.getImage('../state.json'), /不存在/);
    await assert.rejects(() => media.saveImage(Buffer.from('not an image')), /仅支持/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Weixin image media is downloaded from CDN and decrypted', async () => {
  const key = Buffer.alloc(16, 7);
  const cipher = createCipheriv('aes-128-ecb', key, null);
  const encrypted = Buffer.concat([cipher.update(png), cipher.final()]);
  const item = { type: 2, image_item: { aeskey: key.toString('hex'), media: { encrypt_query_param: 'opaque' } } };
  const bytes = await downloadWeixinMedia(item, async (url) => {
    assert.match(url, /^https:\/\/novac2c\.cdn\.weixin\.qq\.com/);
    return new Response(encrypted);
  });
  assert.deepEqual(bytes, png);
  await assert.rejects(() => downloadWeixinMedia({ type: 2, image_item: { media: { full_url: 'https://evil.test/a' } } }), /来源无效/);
});

test('audio transcription sends configured credential and returns text', async () => {
  const text = await transcribeAudio({ baseUrl: 'https://model.test/v1', apiKey: 'secret' }, Buffer.from('voice'), 'audio/webm', async (url, init) => {
    assert.equal(url, 'https://model.test/v1/audio/transcriptions');
    assert.equal(init.headers.Authorization, 'Bearer secret');
    assert.equal(init.body.get('model'), 'whisper-1');
    return Response.json({ text: '今天吃了晚餐' });
  });
  assert.equal(text, '今天吃了晚餐');
});

test('Weixin image send uploads encrypted bytes then submits image message', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return Response.json({ upload_param: 'upload-token' });
    if (calls.length === 2) return new Response('', { headers: { 'x-encrypted-param': 'download-token' } });
    return Response.json({ ret: 0 });
  };
  await sendImage({ base: 'https://ilinkai.weixin.qq.com', token: 'secret', userId: 'owner', contextToken: 'ctx' }, png, '照片', fetchImpl);
  assert.equal(JSON.parse(calls[0].init.body).rawsize, png.length);
  assert.notDeepEqual(calls[1].init.body, png);
  assert.match(calls[1].url, /novac2c\.cdn\.weixin\.qq\.com/);
  const message = JSON.parse(calls[2].init.body).msg;
  assert.equal(message.item_list[0].text_item.text, '照片');
  assert.equal(message.item_list[1].image_item.media.encrypt_query_param, 'download-token');
});
