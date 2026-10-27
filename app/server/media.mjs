import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createDecipheriv } from 'node:crypto';

const CDN = 'https://novac2c.cdn.weixin.qq.com/c2c';
const MAX_IMAGE = 6 * 1024 * 1024;
const MAX_AUDIO = 12 * 1024 * 1024;
const formats = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function imageMime(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return formats.jpeg;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return formats.png;
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return formats.webp;
  throw new Error('仅支持 JPEG、PNG 或 WebP 图片。');
}

export function imageFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw new Error('图片格式无效。');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match || match[2].length > MAX_IMAGE * 1.4) throw new Error('图片格式无效或超过 6 MB。');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE || imageMime(bytes) !== match[1]) throw new Error('图片内容与格式不符。');
  return { bytes, mime: match[1] };
}

export function createMedia(root) {
  const folder = path.join(root, 'app', 'runtime', 'media');
  async function saveImage(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE) throw new Error('图片不能超过 6 MB。');
    const mime = imageMime(bytes);
    const id = randomUUID();
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${id}.img`), bytes, { flag: 'wx' });
    return { id, mime };
  }
  async function getImage(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('图片不存在。');
    const bytes = await readFile(path.join(folder, `${id}.img`));
    return { bytes, mime: imageMime(bytes), dataUrl: `data:${imageMime(bytes)};base64,${bytes.toString('base64')}` };
  }
  return { saveImage, getImage };
}

function cdnUrl(media) {
  const url = media.full_url || `${CDN}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param || '')}`;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'novac2c.cdn.weixin.qq.com') throw new Error('微信媒体来源无效。');
  return url;
}

function aesKey(value) {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) return Buffer.from(decoded.toString('ascii'), 'hex');
  throw new Error('微信媒体密钥无效。');
}

export async function downloadWeixinMedia(item, fetchImpl = fetch) {
  const media = item.type === 2 ? item.image_item?.media : item.voice_item?.media;
  if (!media || (!media.full_url && !media.encrypt_query_param)) throw new Error('微信消息缺少媒体地址。');
  const response = await fetchImpl(cdnUrl(media), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`微信媒体下载失败 (HTTP ${response.status})`);
  const size = Number(response.headers.get('content-length') || 0);
  const limit = item.type === 2 ? MAX_IMAGE : MAX_AUDIO;
  if (size > limit) throw new Error('媒体文件过大。');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit + 16) {
      await response.body.cancel().catch(() => {});
      throw new Error('媒体文件过大。');
    }
    chunks.push(chunk);
  }
  const encrypted = Buffer.concat(chunks);
  if (encrypted.length > limit + 16) throw new Error('媒体文件过大。');
  if (!media.aes_key && !(item.type === 2 && item.image_item?.aeskey)) return encrypted;
  const keyValue = item.type === 2 && item.image_item?.aeskey
    ? Buffer.from(item.image_item.aeskey, 'hex') : aesKey(media.aes_key);
  if (keyValue.length !== 16) throw new Error('微信媒体密钥无效。');
  const decipher = createDecipheriv('aes-128-ecb', keyValue, null);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  if (plain.length > limit) throw new Error('媒体文件过大。');
  return plain;
}

export async function voiceToWav(bytes) {
  const { decode } = await import('silk-wasm');
  const decoded = await decode(bytes, 24000);
  const pcm = Buffer.from(decoded.data);
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}
