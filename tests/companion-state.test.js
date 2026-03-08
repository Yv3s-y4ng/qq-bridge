import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  getUser, setUserMode, setSetupStep, setPersona,
  setRelationship, setEmotionalArc, addHistory, resetUser
} from '../companion-state.js';

test('new user defaults to normal mode at choose_persona step', () => {
  const u = getUser('user-new');
  assert.equal(u.mode, 'normal');
  assert.equal(u.setupStep, 'choose_persona');
  assert.deepEqual(u.history, []);
});

test('setUserMode updates mode', () => {
  setUserMode('user-a', 'companion');
  assert.equal(getUser('user-a').mode, 'companion');
});

test('setSetupStep transitions step', () => {
  setSetupStep('user-b', 'choose_relationship');
  assert.equal(getUser('user-b').setupStep, 'choose_relationship');
});

test('addHistory appends and caps at 30', () => {
  const id = 'user-hist';
  for (let i = 0; i < 35; i++) {
    addHistory(id, 'user', `msg ${i}`);
  }
  assert.equal(getUser(id).history.length, 30);
  assert.equal(getUser(id).history[0].content, 'msg 5');
});

test('[SEND_IMAGE/VIDEO:] tags are stripped before storing history', () => {
  addHistory('user-c', 'assistant', 'hello\n[SEND_IMAGE: 微笑]');
  const last = getUser('user-c').history.at(-1);
  assert.equal(last.content, 'hello');
});

test('resetUser clears state', () => {
  setUserMode('user-d', 'companion');
  addHistory('user-d', 'user', 'hi');
  resetUser('user-d');
  const u = getUser('user-d');
  assert.equal(u.mode, 'normal');
  assert.deepEqual(u.history, []);
});
