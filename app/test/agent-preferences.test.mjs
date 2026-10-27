import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAgentPreferences, publicAgentPreferences, updateAgentPreferences, replyPreferenceInstructions } from '../server/agent-preferences.mjs';

test('global prompt is validated and revision-protected; legacy style has no effect', () => {
  const initial = defaultAgentPreferences();
  const next = updateAgentPreferences(initial, { prompt: '先说结论', revision: publicAgentPreferences(initial).revision });
  assert.deepEqual(next, { prompt: '先说结论' });
  assert.match(replyPreferenceInstructions(next), /先说结论/);
  assert.throws(() => updateAgentPreferences(next, { ...initial, revision: publicAgentPreferences(initial).revision }), /别处更新/);
  assert.throws(() => updateAgentPreferences(initial, { prompt: 'a'.repeat(4001), revision: publicAgentPreferences(initial).revision }), /4000/);
  const legacy = { prompt: '原有提示词', style: 'warm' };
  assert.equal(publicAgentPreferences(legacy).prompt, legacy.prompt);
  assert.equal(replyPreferenceInstructions(legacy).includes('Response style'), false);
  assert.deepEqual(updateAgentPreferences(legacy, { prompt: '新提示词', revision: publicAgentPreferences(legacy).revision }), { prompt: '新提示词' });
});
