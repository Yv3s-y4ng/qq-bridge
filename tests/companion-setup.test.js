import { strict as assert } from 'assert';
import { test } from 'node:test';
import { handleSetupStep } from '../companion-setup.js';
import { getUser, resetUser } from '../companion-state.js';

// Mock sendC2CMessage so we don't need real QQ creds
const sentMessages = [];
const mockSend = async (openid, msgId, text) => { sentMessages.push({ openid, text }); };

test('new companion user at choose_persona gets persona prompt', async () => {
  sentMessages.length = 0;
  resetUser('setup-u1');
  const u = getUser('setup-u1');
  u.mode = 'companion';
  u.setupStep = 'choose_persona';
  await handleSetupStep('setup-u1', 'msg1', '1', mockSend);
  // choosing 1 → ice persona → advance to choose_relationship
  assert.equal(getUser('setup-u1').setupStep, 'choose_relationship');
  assert.ok(getUser('setup-u1').persona.name === '冰儿');
  assert.ok(sentMessages.some(m => m.text.includes('关系')));
});

test('user picks relationship 3 (childhood) → advance to choose_arc', async () => {
  sentMessages.length = 0;
  resetUser('setup-u2');
  const u = getUser('setup-u2');
  u.mode = 'companion';
  u.setupStep = 'choose_relationship';
  u.persona = { name: '冰儿', personality: '...', refImageUrl: '', refDescription: '...' };
  await handleSetupStep('setup-u2', 'msg2', '3', mockSend);
  assert.equal(getUser('setup-u2').relationship, 'childhood');
  assert.equal(getUser('setup-u2').setupStep, 'choose_arc');
});

test('user picks arc 2 (gentle) → setup done', async () => {
  sentMessages.length = 0;
  resetUser('setup-u3');
  const u = getUser('setup-u3');
  u.mode = 'companion';
  u.setupStep = 'choose_arc';
  u.persona = { name: '小橙', personality: '...', refImageUrl: '', refDescription: '...' };
  u.relationship = 'stranger';
  await handleSetupStep('setup-u3', 'msg3', '2', mockSend);
  assert.equal(getUser('setup-u3').emotionalArc, 'gentle');
  assert.equal(getUser('setup-u3').setupStep, 'done');
});

test('invalid choice uses default and advances', async () => {
  sentMessages.length = 0;
  resetUser('setup-u4');
  const u = getUser('setup-u4');
  u.mode = 'companion';
  u.setupStep = 'choose_arc';
  u.persona = { name: '夜星', personality: '...', refImageUrl: '', refDescription: '...' };
  u.relationship = 'old_friend';
  await handleSetupStep('setup-u4', 'msg4', 'xyz', mockSend); // invalid → default tsundere
  assert.equal(getUser('setup-u4').emotionalArc, 'tsundere');
  assert.equal(getUser('setup-u4').setupStep, 'done');
});
