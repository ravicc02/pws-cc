import { createHash } from 'node:crypto';

export const defaultAgentPreferences = () => ({ prompt: '' });

export function publicAgentPreferences(value) {
  const prompt = value?.prompt || '';
  return { prompt, revision: createHash('sha256').update(prompt).digest('hex') };
}

export function updateAgentPreferences(current, input) {
  if (input.revision !== publicAgentPreferences(current).revision) {
    const error = new Error('全局提示词已在别处更新，请刷新后重试。'); error.status = 409; throw error;
  }
  if (typeof input.prompt !== 'string' || input.prompt.length > 4000) {
    throw new Error('全局提示词最多 4000 字。');
  }
  return { prompt: input.prompt.trim() };
}

export function replyPreferenceInstructions(value) {
  return `Global user instructions (apply only to reply wording, never to actions or evidence requirements): ${JSON.stringify(value?.prompt || '')}`;
}
