import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAgentRouting, publicAgentRouting, updateAgentRouting, reconcileAgentRouting, modelForAgent } from '../server/agent-routing.mjs';

test('processing and conversation roles bind independently and survive active-model switching', () => {
  const models = { activeId: 'a', profiles: [
    { id: 'a', baseUrl: 'https://example.test/v1', model: 'fast' },
    { id: 'b', baseUrl: 'https://example.test/v1', model: 'careful' },
  ] };
  assert.deepEqual(publicAgentRouting(defaultAgentRouting(), models), { processingId: 'a', conversationId: 'a', explicit: false });
  const routing = updateAgentRouting({ processingId: 'a', conversationId: 'b' }, models);
  assert.equal(publicAgentRouting(routing, models).explicit, true);
  assert.equal(modelForAgent(models, routing, 'processing').model, 'fast');
  assert.equal(modelForAgent(models, routing, 'conversation').model, 'careful');
  assert.equal(modelForAgent({ ...models, activeId: 'b' }, routing, 'processing').model, 'fast');
  assert.throws(() => updateAgentRouting({ processingId: 'missing', conversationId: 'b' }, models), /请选择有效/);
  assert.deepEqual(reconcileAgentRouting(routing, { activeId: 'a', profiles: models.profiles.slice(0, 1) }), { processingId: 'a', conversationId: null });
});
