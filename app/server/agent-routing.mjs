import { activeModelConfig, normalizeModelState } from './model.mjs';

export const defaultAgentRouting = () => ({ processingId: null, conversationId: null });

export function publicAgentRouting(routing, modelState) {
  const models = normalizeModelState(modelState);
  return {
    processingId: routing?.processingId || models.activeId,
    conversationId: routing?.conversationId || models.activeId,
    explicit: Boolean(routing?.processingId && routing?.conversationId),
  };
}

export function updateAgentRouting(input, modelState) {
  const ids = new Set(normalizeModelState(modelState).profiles.map((profile) => profile.id));
  if (!input || !ids.has(input.processingId) || !ids.has(input.conversationId)) {
    throw new Error('请选择有效的处理 Agent 和对话 Agent 模型。');
  }
  return { processingId: input.processingId, conversationId: input.conversationId };
}

export function reconcileAgentRouting(routing, modelState) {
  const ids = new Set(normalizeModelState(modelState).profiles.map((profile) => profile.id));
  return {
    processingId: ids.has(routing?.processingId) ? routing.processingId : null,
    conversationId: ids.has(routing?.conversationId) ? routing.conversationId : null,
  };
}

export function modelForAgent(modelState, routing, role) {
  const id = role === 'processing' ? routing?.processingId : routing?.conversationId;
  if (!id) return activeModelConfig(modelState);
  const profile = normalizeModelState(modelState).profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`${role === 'processing' ? '处理' : '对话'} Agent 的模型已删除，请重新绑定。`);
  return profile;
}
