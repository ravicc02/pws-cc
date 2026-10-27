import { randomUUID, createHash } from 'node:crypto';
import { dateInZone } from './review.mjs';
import { reviewAnswer, appendReviewAnswer } from './daily-review.mjs';
import { sendText, textFromMessage } from './weixin.mjs';

export function createWeixinInbox(store, chat, workspace, send = sendText, media = {}) {
  async function flushPending() {
    const { account, pendingReply } = store.get();
    if (!account || !pendingReply) return;
    await send({ ...account, contextToken: pendingReply.contextToken }, pendingReply.text, pendingReply.clientId);
    const latest = store.get();
    store.update({ pendingReply: null, seenMessages: [...latest.seenMessages, pendingReply.id].slice(-200) });
  }

  async function handle(message) {
    const state = store.get();
    if (!state.account || message.from_user_id !== state.account.userId || !message.context_token) return;
    const id = String(message.message_id ?? message.msg_id ?? message.client_id ?? createHash('sha256').update(JSON.stringify(message)).digest('hex'));
    if (state.seenMessages.includes(id)) return;
    if (state.pendingReply) {
      await flushPending();
      if (state.pendingReply.id === id) return;
    }
    store.update({ account: { ...store.get().account, contextToken: message.context_token } });
    let text = textFromMessage(message);
    const prompt = store.get().reviewPromptDelivery;
    const today = dateInZone();
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    let reply;
    let stage = 'message';
    const startedAt = Date.now();
    try {
      const voice = message.item_list?.find((item) => item.type === 3 && item.voice_item);
      if (voice) {
        stage = 'voice';
        const transcript = voice.voice_item.text?.trim() || await media.transcribe?.(voice);
        if (!transcript) throw new Error('语音消息没有转写内容或转写服务未配置。');
        text = [text, transcript].filter(Boolean).join('\n');
      }
      const picture = message.item_list?.find((item) => item.type === 2 && item.image_item);
      if (picture) stage = 'image';
      const imageId = picture ? await media.saveWeixinImage?.(picture) : null;
      if (picture && !imageId) throw new Error('微信图片下载未配置。');
      if (['accepted', 'answered'].includes(prompt?.status) && [today, yesterday.toISOString().slice(0, 10)].includes(prompt.date) && reviewAnswer(text)) {
        await appendReviewAnswer(workspace, prompt.date, prompt.questions, text, id);
        store.update({ reviewPromptDelivery: { ...prompt, status: 'answered', answeredAt: new Date().toISOString() } });
        reply = '已记录你的每日复盘。';
      } else if (text || imageId) {
        stage = 'agent';
        reply = (await chat.send(imageId ? { text, imageId } : text, `weixin:${id}`)).answer.text;
      } else {
        reply = '这条消息暂不支持，请发文字、图片或语音。';
      }
    } catch (error) {
      console.error('Weixin reply generation:', { stage, elapsedMs: Date.now() - startedAt, error: error.message });
      reply = stage === 'voice' ? '语音转写失败，请稍后重发或改发文字。'
        : stage === 'image' ? '图片读取失败，请稍后重新发送。'
          : /超时|超过 90 秒/.test(error.message) ? '模型处理超时（90 秒），这条消息未完成，请稍后重发。'
            : '这条消息未处理成功，请稍后重发。';
    }
    store.update({ pendingReply: { id, clientId: randomUUID(), contextToken: message.context_token, text: reply } });
    await flushPending();
  }

  return { handle, flushPending };
}
