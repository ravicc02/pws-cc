import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const defaultState = () => ({
  schedule: { enabled: false, time: '21:30', timezone: 'Asia/Shanghai' },
  reminder: { enabled: false, time: '20:00', timezone: 'Asia/Shanghai' },
  reminderDelivery: null,
  reviewPrompt: { enabled: false, time: '20:30', timezone: 'Asia/Shanghai' },
  reviewPromptDelivery: null,
  account: null,
  delivery: null,
  syncBuffer: '',
  seenMessages: [],
  pendingReply: null,
});

export function createStore(file, defaults = defaultState) {
  mkdirSync(path.dirname(file), { recursive: true });
  let state;
  try {
    state = { ...defaults(), ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = defaults();
  }

  function replace(next) {
    state = next;
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(temp, file);
    return state;
  }

  function update(change) {
    return replace({ ...state, ...change });
  }

  return { get: () => state, update, replace };
}
