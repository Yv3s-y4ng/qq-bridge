import { strict as assert } from 'assert';
import { test } from 'node:test';
import { PERSONAS, buildSystemPrompt } from '../companion-personas.js';

test('PERSONAS has 3 presets with required fields', () => {
  assert.equal(PERSONAS.length, 3);
  for (const p of PERSONAS) {
    assert.ok(p.name, 'name required');
    assert.ok(p.personality, 'personality required');
    assert.ok(p.refDescription, 'refDescription required');
  }
});

test('buildSystemPrompt contains name, personality, refDescription', () => {
  const state = {
    persona: PERSONAS[0],
    relationship: 'stranger',
    emotionalArc: 'tsundere',
  };
  const prompt = buildSystemPrompt(state);
  assert.ok(prompt.includes(PERSONAS[0].name));
  assert.ok(prompt.includes(PERSONAS[0].personality));
  assert.ok(prompt.includes(PERSONAS[0].refDescription));
  assert.ok(prompt.includes('[SEND_IMAGE:'));
});

test('buildSystemPrompt reflects relationship and arc', () => {
  const state = {
    persona: PERSONAS[1],
    relationship: 'childhood',
    emotionalArc: 'gentle',
  };
  const prompt = buildSystemPrompt(state);
  assert.ok(prompt.includes('青梅竹马'));
  assert.ok(prompt.includes('温柔'));
});
