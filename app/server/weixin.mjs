import { randomBytes, randomUUID, createHash, createCipheriv } from 'node:crypto';

const BASE_URL = 'https://ilinkai.weixin.qq.com';
const VERSION = '2.4.10';
const CLIENT_VERSION = String((2 << 16) | (4 << 8) | 10);
const baseInfo = { channel_version: VERSION, bot_agent: 'PersonalWorkspace/0.1.0' };

function safeBase(url) {
  const target = new URL(url || BASE_URL);
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.weixin.qq.com')) {
    throw new Error('Unexpected Weixin API host');
  }
  return target.origin;
}

async function request(base, endpoint, { method = 'POST', token, body, timeout = 15000, fetchImpl = fetch } = {}) {
  const headers = {
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': CLIENT_VERSION,
  };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers.AuthorizationType = 'ilink_bot_token';
    headers['X-WECHAT-UIN'] = Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetchImpl(new URL(endpoint, `${safeBase(base)}/`), {
    method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`Weixin API HTTP ${response.status}`);
  return response.json();
}

export async function beginBinding(existingToken) {
  const response = await request(BASE_URL, 'ilink/bot/get_bot_qrcode?bot_type=3', {
    body: { local_token_list: existingToken ? [existingToken] : [] },
  });
  if (!response.qrcode || !response.qrcode_img_content) throw new Error('Weixin did not return a QR code');
  return { code: response.qrcode, qrText: response.qrcode_img_content, base: BASE_URL, startedAt: Date.now() };
}

export async function checkBinding(binding, verifyCode) {
  const query = new URLSearchParams({ qrcode: binding.code });
  if (verifyCode) query.set('verify_code', verifyCode);
  const response = await request(binding.base, `ilink/bot/get_qrcode_status?${query}`, {
    method: 'GET', timeout: 35000,
  });
  const next = { ...binding };
  if (response.status === 'scaned_but_redirect' && response.redirect_host) {
    next.base = safeBase(`https://${response.redirect_host}`);
  }
  if (response.status === 'confirmed') {
    if (!response.bot_token || !response.ilink_bot_id || !response.ilink_user_id) {
      throw new Error('Weixin confirmation omitted required credentials');
    }
    return { status: 'confirmed', account: {
      botId: response.ilink_bot_id,
      userId: response.ilink_user_id,
      token: response.bot_token,
      base: safeBase(response.baseurl || next.base),
      contextToken: null,
    } };
  }
  return { status: response.status || 'wait', binding: next };
}

export async function getUpdates(account, buffer, signal) {
  const response = await request(account.base, 'ilink/bot/getupdates', {
    token: account.token, body: { get_updates_buf: buffer || '', base_info: baseInfo },
    timeout: 35000, signal,
  });
  if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
    throw new Error(`Weixin getupdates failed: ${response.ret ?? response.errcode}`);
  }
  return response;
}

export function textFromMessage(message) {
  return (message?.item_list || [])
    .filter((item) => item?.type === 1 && typeof item.text_item?.text === 'string')
    .map((item) => item.text_item.text).join('\n').trim();
}

export async function sendText(account, text, clientId = randomUUID()) {
  if (!account.contextToken) throw new Error('Send a message to the bot from Weixin first');
  const response = await request(account.base, 'ilink/bot/sendmessage', {
    token: account.token, body: {
      msg: {
        from_user_id: '', to_user_id: account.userId,
        client_id: clientId, message_type: 2, message_state: 2,
        context_token: account.contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      }, base_info: baseInfo,
    },
  });
  if ((response.ret ?? 0) !== 0) throw new Error(`Weixin send failed: ${response.ret}`);
  return { clientId, acceptedAt: new Date().toISOString() };
}

export async function sendImage(account, bytes, text = '', fetchImpl = fetch) {
  if (!account?.contextToken) throw new Error('请先在微信中向机器人发送一条消息。');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 6 * 1024 * 1024) throw new Error('图片不能超过 6 MB。');
  const filekey = randomBytes(16).toString('hex');
  const key = randomBytes(16);
  const cipher = createCipheriv('aes-128-ecb', key, null);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const upload = await request(account.base, 'ilink/bot/getuploadurl', {
    token: account.token, fetchImpl,
    body: { filekey, media_type: 1, to_user_id: account.userId, rawsize: bytes.length,
      rawfilemd5: createHash('md5').update(bytes).digest('hex'), filesize: encrypted.length,
      no_need_thumb: true, aeskey: key.toString('hex'), base_info: baseInfo },
  });
  if ((upload.ret ?? 0) !== 0) throw new Error('微信图片上传授权失败。');
  const url = upload.upload_full_url || `https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param || '')}&filekey=${encodeURIComponent(filekey)}`;
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== 'novac2c.cdn.weixin.qq.com' || (!upload.upload_full_url && !upload.upload_param)) throw new Error('微信返回的上传地址无效。');
  const response = await fetchImpl(target, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: encrypted, signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.headers.get('x-encrypted-param')) throw new Error('图片上传到微信失败。');
  const clientId = randomUUID();
  const result = await request(account.base, 'ilink/bot/sendmessage', { token: account.token, fetchImpl, body: {
    msg: { from_user_id: '', to_user_id: account.userId, client_id: clientId, message_type: 2,
      message_state: 2, context_token: account.contextToken,
      item_list: [...(text ? [{ type: 1, text_item: { text } }] : []), { type: 2, image_item: {
        media: { encrypt_query_param: response.headers.get('x-encrypted-param'), aes_key: Buffer.from(key.toString('hex')).toString('base64'), encrypt_type: 1 },
        mid_size: encrypted.length,
      } }],
    }, base_info: baseInfo,
  } });
  if ((result.ret ?? 0) !== 0) throw new Error('微信拒绝发送图片。');
  return { clientId, acceptedAt: new Date().toISOString() };
}
