import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldExtract, validGoalAction, isPlanOnly } from '../server/agent-flow.mjs';

test('future explicit goals are distinct from examples and questions', () => {
  assert.equal(shouldExtract('我想减肥', null), true);
  assert.equal(validGoalAction('我想减肥', { type: 'goal', status: 'active', quote: '我想减肥' }), true);
  assert.equal(shouldExtract('比如我想减肥', null), false);
  assert.equal(validGoalAction('比如我想减肥', { type: 'goal', status: 'active', quote: '我想减肥' }), false);
  assert.equal(shouldExtract('怎么减肥？', null), false);
  assert.equal(validGoalAction('我想知道怎么减肥', { status: 'active', quote: '我想知道怎么减肥' }), false);
  assert.equal(validGoalAction('我不想减肥了', { status: 'stopped', quote: '我不想减肥了' }), true);
  assert.equal(validGoalAction('我现在想睡觉', { status: 'active', quote: '我现在想睡觉' }), false);
  assert.equal(isPlanOnly('我想减肥'), true);
  assert.equal(isPlanOnly('我今天吃了午饭'), false);
});
