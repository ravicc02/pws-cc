import test from 'node:test';
import assert from 'node:assert/strict';
import { beginBinding, checkBinding, sendText } from '../server/weixin.mjs';

test('binding exposes QR text but retains token only after confirmed status', async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(calls.length === 1
      ? { qrcode: 'opaque-code', qrcode_img_content: 'https://example.test/qr' }
      : { status: 'confirmed', bot_token: 'secret', ilink_bot_id: 'bot-1', ilink_user_id: 'owner', baseurl: 'https://ilinkai.weixin.qq.com' }), { status: 200 });
  };
  const started = await beginBinding();
  assert.equal(started.qrText, 'https://example.test/qr');
  assert.match(calls[0].url, /get_bot_qrcode/);
  const result = await checkBinding(started);
  assert.equal(result.account.token, 'secret');
  assert.equal(result.account.userId, 'owner');
  assert.match(calls[1].url, /get_qrcode_status/);
});

test('sending requires an inbound conversation token', async () => {
  await assert.rejects(() => sendText({ userId: 'owner', token: 'secret' }, 'brief'), /Send a message/);
});
