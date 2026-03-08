import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseReply } from '../companion-chat.js';

test('parseReply with no media tag returns text only', () => {
  const r = parseReply('你好啊～');
  assert.equal(r.text, '你好啊～');
  assert.equal(r.imageScene, null);
  assert.equal(r.videoScene, null);
});

test('parseReply extracts SEND_IMAGE tag from last line', () => {
  const r = parseReply('啊，被你发现了。\n[SEND_IMAGE: 低头，脸颊微红]');
  assert.equal(r.text, '啊，被你发现了。');
  assert.equal(r.imageScene, '低头，脸颊微红');
  assert.equal(r.videoScene, null);
});

test('parseReply extracts SEND_VIDEO tag', () => {
  const r = parseReply('好吧，给你看看。\n[SEND_VIDEO: 在窗边发呆，微风吹动头发]');
  assert.equal(r.text, '好吧，给你看看。');
  assert.equal(r.videoScene, '在窗边发呆，微风吹动头发');
  assert.equal(r.imageScene, null);
});

test('parseReply handles tag mid-text (strips it)', () => {
  const r = parseReply('嗯。[SEND_IMAGE: 微笑] 就这样。');
  assert.equal(r.imageScene, '微笑');
  assert.ok(!r.text.includes('[SEND_IMAGE'));
});
