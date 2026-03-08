import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildImagePrompt } from '../companion-media.js';

test('buildImagePrompt combines refDescription and scene', () => {
  const prompt = buildImagePrompt('银白发，蓝眸，着白色汉服', '害羞地低头，手指互绞');
  assert.ok(prompt.includes('银白发'));
  assert.ok(prompt.includes('害羞地低头'));
});

test('buildImagePrompt without refDescription uses scene only', () => {
  const prompt = buildImagePrompt('', '微笑面向镜头');
  assert.ok(prompt.includes('微笑面向镜头'));
});
