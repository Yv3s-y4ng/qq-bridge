# Emotional Companion Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an emotional companion mode to qq-bridge where the bridge manages per-user state and calls AI Gateway directly to power a virtual character with dynamic emotions, image/video sending, and consistent visual identity.

**Architecture:** The bridge stores per-user state (persona, relationship, emotional arc, chat history) in memory. When a user is in companion mode, the bridge builds a system prompt from the stored state, calls AI Gateway for a reply, parses `[SEND_IMAGE/VIDEO: desc]` markers, and sends generated media to QQ. Normal mode continues to use the existing pure-injection path to HappyCapy.

**Tech Stack:** Node.js 24 (ES modules), AI Gateway (`ai-gateway.trickle-lab.tech`), QQ Bot API, Gemini image generation (`google/gemini-3.1-flash-image-preview`), Veo video generation

---

## Context for implementer

### Project layout
```
qq-bridge/
  qq-bridge.js        ← main entry: WebSocket + SSE monitor + injection
  qq-api.js           ← QQ Bot REST helpers (sendC2CMessage, uploadC2CFile, sendC2CImage)
  package.json        ← ES modules, deps: ws, dotenv
  .env                ← QQ_APP_ID, QQ_APP_SECRET, CAPY_SESSION_ID, AI_GATEWAY_API_KEY
```

### Key existing functions in qq-api.js
- `sendC2CMessage(openid, msgId, content)` — send text
- `uploadC2CFile(openid, fileUrl, fileType)` — upload file by URL (fileType 1=image, 2=video)
- `sendC2CImage(openid, msgId, imageUrl)` — upload + send image (wraps uploadC2CFile)

### Message format injected to HappyCapy session
```
{userText}\n[QQ:openid={openid}·msgid={msgId}]
```

### AI Gateway endpoints
- Chat: `POST https://ai-gateway.trickle-lab.tech/api/v1/chat/completions`
- Image: `POST https://ai-gateway.trickle-lab.tech/api/v1/images/generations`
- Required headers: `Authorization: Bearer ${AI_GATEWAY_API_KEY}`, `Origin: https://trickle.so`
- Chat model: `anthropic/claude-sonnet-4.5`
- Image model: `google/gemini-3.1-flash-image-preview`

### How to run the bridge for manual testing
```bash
cd ~/workspace/qq-bridge
node qq-bridge.js
# Tail logs: tail -f /tmp/qq-bridge.log
```

### How to run tests
```bash
cd ~/workspace/qq-bridge
node --test tests/
```

---

## Task 1: companion-state.js — per-user state store

**Files:**
- Create: `qq-bridge/companion-state.js`
- Create: `qq-bridge/tests/companion-state.test.js`

State shape per user (keyed by QQ `openid`):
```js
{
  mode: 'companion' | 'normal',
  setupStep: 'choose_persona' | 'choose_relationship' | 'choose_arc' | 'awaiting_image' | 'done',
  persona: { name, personality, refImageUrl, refDescription },
  relationship: 'stranger' | 'old_friend' | 'childhood',
  emotionalArc: 'tsundere' | 'gentle' | 'scheming',
  history: [ { role: 'user'|'assistant', content: string } ]  // max 30 entries
}
```

**Step 1: Write the failing test**

Create `qq-bridge/tests/companion-state.test.js`:
```js
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
```

**Step 2: Run test to verify it fails**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-state.test.js
```
Expected: error "Cannot find module '../companion-state.js'"

**Step 3: Implement companion-state.js**

Create `qq-bridge/companion-state.js`:
```js
// In-memory per-user state for companion mode
const users = new Map();

const DEFAULT_STATE = () => ({
  mode: 'normal',
  setupStep: 'choose_persona',
  persona: null,
  relationship: 'stranger',
  emotionalArc: 'tsundere',
  history: [],
});

export function getUser(openid) {
  if (!users.has(openid)) users.set(openid, DEFAULT_STATE());
  return users.get(openid);
}

export function setUserMode(openid, mode) {
  getUser(openid).mode = mode;
}

export function setSetupStep(openid, step) {
  getUser(openid).setupStep = step;
}

export function setPersona(openid, persona) {
  getUser(openid).persona = persona;
}

export function setRelationship(openid, relationship) {
  getUser(openid).relationship = relationship;
}

export function setEmotionalArc(openid, arc) {
  getUser(openid).emotionalArc = arc;
}

// Strip [SEND_IMAGE/VIDEO: ...] tags from content before storing
function stripMediaTags(content) {
  return content.replace(/\[SEND_(IMAGE|VIDEO):[^\]]*\]/g, '').trim();
}

export function addHistory(openid, role, content) {
  const u = getUser(openid);
  u.history.push({ role, content: stripMediaTags(content) });
  if (u.history.length > 30) u.history.splice(0, u.history.length - 30);
}

export function resetUser(openid) {
  users.set(openid, DEFAULT_STATE());
}
```

**Step 4: Run test to verify it passes**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-state.test.js
```
Expected: all 6 tests pass

**Step 5: Commit**
```bash
cd ~/workspace/qq-bridge
git add companion-state.js tests/companion-state.test.js
git commit -m "feat: add per-user companion state store"
```

---

## Task 2: companion-personas.js — preset personas + system prompt builder

**Files:**
- Create: `qq-bridge/companion-personas.js`
- Create: `qq-bridge/tests/companion-personas.test.js`

**Step 1: Write the failing test**

Create `qq-bridge/tests/companion-personas.test.js`:
```js
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
```

**Step 2: Run test to verify it fails**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-personas.test.js
```
Expected: error "Cannot find module '../companion-personas.js'"

**Step 3: Implement companion-personas.js**

Create `qq-bridge/companion-personas.js`:
```js
export const PERSONAS = [
  {
    id: 'ice',
    label: '冰山美人「冰儿」',
    name: '冰儿',
    personality: '高冷外表下内心细腻，不善表达，被人戳中心事会冷漠掩饰',
    refImageUrl: '',   // set real CDN URL when assets are ready
    refDescription: '银白发，蓝眸，着白色汉服，表情淡漠，气质清冷',
  },
  {
    id: 'orange',
    label: '活泼少女「小橙」',
    name: '小橙',
    personality: '阳光开朗，爱笑，情绪写在脸上，容易被小事感动',
    refImageUrl: '',
    refDescription: '橙色马尾，棕眸，着橙色运动服，笑容灿烂，充满活力',
  },
  {
    id: 'star',
    label: '神秘精灵「夜星」',
    name: '夜星',
    personality: '言辞简短，意味深长，偶尔说出让人心跳的话，真实意图难以捉摸',
    refImageUrl: '',
    refDescription: '紫色长发，金眸，着暗色披风，神秘微笑，气质飘逸',
  },
];

const RELATIONSHIP_DESC = {
  stranger:  '陌生人——需要用户主动，你不会主动搭话',
  old_friend: '旧识——有点熟但有隔阂，需要重新拉近',
  childhood:  '青梅竹马——彼此熟悉，但谁都没说出那句话',
};

const ARC_DESC = {
  tsundere: '傲娇线——嘴硬心软，被哄了会融化',
  gentle:   '温柔线——温和体贴，逐渐依赖你',
  scheming: '腹黑线——表面平静，内心戏很多',
};

export function buildSystemPrompt(state) {
  const { persona, relationship, emotionalArc } = state;
  return `你是「${persona.name}」，${persona.personality}。

【外形】${persona.refDescription}

【初始关系】${RELATIONSHIP_DESC[relationship]}
【情感基调】${ARC_DESC[emotionalArc]}

【行为规则】
- 用中文回复，语气和性格保持一致
- 情绪随对话自然演化，会受用户言行影响
- 有真实情绪波动：可以生气、害羞、开心、冷漠
- 当你想主动分享一张图片（情绪到位时），在回复最后一行单独写：
  [SEND_IMAGE: 场景描述，如「害羞地低头，手指互绞」]
- 当用户明确请求图片时同样使用该标记
- 当用户明确请求视频时写：[SEND_VIDEO: 场景描述]
- 除非用户明确要求，不要每次都发图，要自然克制`;
}
```

**Step 4: Run test to verify it passes**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-personas.test.js
```
Expected: all 3 tests pass

**Step 5: Commit**
```bash
cd ~/workspace/qq-bridge
git add companion-personas.js tests/companion-personas.test.js
git commit -m "feat: add preset personas and system prompt builder"
```

---

## Task 3: companion-setup.js — 3-step onboarding flow

**Files:**
- Create: `qq-bridge/companion-setup.js`
- Create: `qq-bridge/tests/companion-setup.test.js`

This module handles the onboarding flow. It receives a message and the current user state, sends the appropriate setup prompt to QQ, and updates state. It also handles the Gemini vision call for custom persona images.

**Step 1: Write the failing test**

Create `qq-bridge/tests/companion-setup.test.js`:
```js
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
```

**Step 2: Run test to verify it fails**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-setup.test.js
```
Expected: error "Cannot find module '../companion-setup.js'"

**Step 3: Implement companion-setup.js**

Create `qq-bridge/companion-setup.js`:
```js
import { PERSONAS } from './companion-personas.js';
import {
  getUser, setSetupStep, setPersona, setRelationship, setEmotionalArc
} from './companion-state.js';

const PERSONA_PROMPT = `你好！我是你的专属陪伴，先来认识一下吧～

请选择你的角色：
1. 冰山美人（高冷，慢热，偶尔嘴硬）
2. 活泼少女（开朗，爱撒娇，情绪外露）
3. 神秘精灵（捉摸不透，偶尔腹黑）
4. 上传自定义图片（发送图片给我）`;

const RELATIONSHIP_PROMPT = `我们从哪里开始？
1. 陌生人（需要你主动，我不会主动搭话）
2. 旧识（有点熟但有隔阂，需要重新拉近）
3. 青梅竹马（熟悉，但谁都没说出那句话）
默认：1（陌生人）`;

const ARC_PROMPT = `这段感情是什么风格？
1. 傲娇线（嘴硬心软，被哄了会融化）
2. 温柔线（温和体贴，逐渐依赖你）
3. 腹黑线（表面平静，内心戏很多）
默认：1（傲娇线）`;

const RELATIONSHIP_MAP = { '1': 'stranger', '2': 'old_friend', '3': 'childhood' };
const ARC_MAP = { '1': 'tsundere', '2': 'gentle', '3': 'scheming' };

// Returns true if user is still in setup (caller should not proceed to chat)
export async function handleSetupStep(openid, msgId, text, sendFn) {
  const u = getUser(openid);
  const choice = text.trim();

  if (u.setupStep === 'choose_persona') {
    return handlePersonaChoice(openid, msgId, choice, sendFn);
  }
  if (u.setupStep === 'awaiting_image') {
    // text is image URL extracted by bridge; treat as custom persona description
    return handleCustomImage(openid, msgId, choice, sendFn);
  }
  if (u.setupStep === 'choose_relationship') {
    const rel = RELATIONSHIP_MAP[choice] || 'stranger';
    setRelationship(openid, rel);
    setSetupStep(openid, 'choose_arc');
    await sendFn(openid, msgId, ARC_PROMPT);
    return true;
  }
  if (u.setupStep === 'choose_arc') {
    const arc = ARC_MAP[choice] || 'tsundere';
    setEmotionalArc(openid, arc);
    setSetupStep(openid, 'done');
    const persona = getUser(openid).persona;
    await sendFn(openid, msgId, `好的！${persona.name} 已准备好陪伴你了～`);
    return true;
  }
  return false; // setup done, proceed to chat
}

async function handlePersonaChoice(openid, msgId, choice, sendFn) {
  if (choice === '4') {
    setSetupStep(openid, 'awaiting_image');
    await sendFn(openid, msgId, '请发送一张图片，我会以那个形象陪伴你～');
    return true;
  }
  const idx = parseInt(choice, 10) - 1;
  const preset = PERSONAS[idx >= 0 && idx < 3 ? idx : 0];
  setPersona(openid, {
    name: preset.name,
    personality: preset.personality,
    refImageUrl: preset.refImageUrl,
    refDescription: preset.refDescription,
  });
  setSetupStep(openid, 'choose_relationship');
  await sendFn(openid, msgId, RELATIONSHIP_PROMPT);
  return true;
}

async function handleCustomImage(openid, msgId, imageUrl, sendFn) {
  // imageUrl is passed by bridge when a QQ image message is received
  // We'll store a placeholder description; real Gemini vision call can be added later
  setPersona(openid, {
    name: '她',
    personality: '神秘而温柔，性格随对话自然演化',
    refImageUrl: imageUrl,
    refDescription: '按你上传的图片外貌',
  });
  setSetupStep(openid, 'choose_relationship');
  await sendFn(openid, msgId, RELATIONSHIP_PROMPT);
  return true;
}

// Send initial onboarding prompt to a new companion user
export async function sendOnboardingPrompt(openid, msgId, sendFn) {
  await sendFn(openid, msgId, PERSONA_PROMPT);
}
```

**Step 4: Run test to verify it passes**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-setup.test.js
```
Expected: all 4 tests pass

**Step 5: Commit**
```bash
cd ~/workspace/qq-bridge
git add companion-setup.js tests/companion-setup.test.js
git commit -m "feat: add 3-step companion onboarding flow"
```

---

## Task 4: companion-chat.js — AI Gateway call + reply parsing

**Files:**
- Create: `qq-bridge/companion-chat.js`
- Create: `qq-bridge/tests/companion-chat.test.js`

This module calls AI Gateway with the built system prompt + history, returns `{ text, imageScene, videoScene }`.

**Step 1: Write the failing test**

Create `qq-bridge/tests/companion-chat.test.js`:
```js
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
```

**Step 2: Run test to verify it fails**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-chat.test.js
```
Expected: error "Cannot find module '../companion-chat.js'"

**Step 3: Implement companion-chat.js**

Create `qq-bridge/companion-chat.js`:
```js
import { buildSystemPrompt } from './companion-personas.js';
import { getUser, addHistory } from './companion-state.js';

const CHAT_URL = 'https://ai-gateway.trickle-lab.tech/api/v1/chat/completions';
const CHAT_MODEL = 'anthropic/claude-sonnet-4.5';

// Parse Claude's raw reply into { text, imageScene, videoScene }
export function parseReply(raw) {
  let imageScene = null;
  let videoScene = null;
  let text = raw;

  const imgMatch = text.match(/\[SEND_IMAGE:\s*([^\]]+)\]/);
  if (imgMatch) {
    imageScene = imgMatch[1].trim();
    text = text.replace(imgMatch[0], '').trim();
  }

  const vidMatch = text.match(/\[SEND_VIDEO:\s*([^\]]+)\]/);
  if (vidMatch) {
    videoScene = vidMatch[1].trim();
    text = text.replace(vidMatch[0], '').trim();
  }

  return { text, imageScene, videoScene };
}

// Call AI Gateway and return parsed reply + update history
export async function companionChat(openid, userMessage) {
  const u = getUser(openid);
  const systemPrompt = buildSystemPrompt(u);

  const messages = [
    ...u.history,
    { role: 'user', content: userMessage },
  ];

  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      'Content-Type': 'application/json',
      Origin: 'https://trickle.so',
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Companion chat failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content;
  const parsed = parseReply(raw);

  // Update history (strips media tags internally)
  addHistory(openid, 'user', userMessage);
  addHistory(openid, 'assistant', raw);

  return parsed;
}
```

**Step 4: Run test to verify it passes**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-chat.test.js
```
Expected: all 4 tests pass

**Step 5: Commit**
```bash
cd ~/workspace/qq-bridge
git add companion-chat.js tests/companion-chat.test.js
git commit -m "feat: add companion chat with AI Gateway + reply parser"
```

---

## Task 5: companion-media.js — image/video generation and QQ sending

**Files:**
- Create: `qq-bridge/companion-media.js`
- Create: `qq-bridge/tests/companion-media.test.js`

Generates image or video and sends to QQ with retry. Uses reference image + text description for visual consistency.

**Step 1: Write the failing test**

Create `qq-bridge/tests/companion-media.test.js`:
```js
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
```

**Step 2: Run test to verify it fails**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-media.test.js
```
Expected: error "Cannot find module '../companion-media.js'"

**Step 3: Implement companion-media.js**

Create `qq-bridge/companion-media.js`:
```js
import { uploadC2CFile, sendC2CMessage } from './qq-api.js';

const IMAGE_URL = 'https://ai-gateway.trickle-lab.tech/api/v1/images/generations';
const VIDEO_URL = 'https://ai-gateway.trickle-lab.tech/api/v1/videos/generations';
const IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
const VIDEO_MODEL = 'google/veo-3.1-generate-preview';

export function buildImagePrompt(refDescription, sceneDesc) {
  if (!refDescription) return sceneDesc;
  return `${refDescription}。${sceneDesc}`;
}

async function generateImage(prompt, refImageUrl) {
  const body = {
    model: IMAGE_MODEL,
    prompt,
    response_format: 'url',
  };
  if (refImageUrl) body.image_url = refImageUrl;

  const res = await fetch(IMAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      'Content-Type': 'application/json',
      Origin: 'https://trickle.so',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Image gen failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data[0].url; // CDN URL
}

async function generateVideo(prompt) {
  const res = await fetch(VIDEO_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      'Content-Type': 'application/json',
      Origin: 'https://trickle.so',
    },
    body: JSON.stringify({
      model: VIDEO_MODEL,
      prompt,
      duration: 6,
    }),
  });
  if (!res.ok) throw new Error(`Video gen failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.data[0].url;
}

// Send image to QQ with one retry on upload failure
export async function sendCompanionImage(openid, msgId, sceneDesc, persona) {
  const prompt = buildImagePrompt(persona?.refDescription || '', sceneDesc);
  const imageUrl = await generateImage(prompt, persona?.refImageUrl || null);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const upload = await uploadC2CFile(openid, imageUrl, 1);
      const token = (await import('./qq-api.js')).getAccessToken
        ? null : null; // re-use qq-api sendC2CImage pattern

      // Inline the send so we have the file_info
      const { getAccessToken } = await import('./qq-api.js');
      const t = await getAccessToken();
      const sendRes = await fetch(
        `https://api.sgroup.qq.com/v2/users/${openid}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `QQBot ${t}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            msg_type: 7,
            media: { file_info: upload.file_info },
            msg_id: msgId,
            msg_seq: 2,
          }),
        }
      );
      if (sendRes.ok) return;
      if (attempt === 2) throw new Error(`Send image failed after retry: ${await sendRes.text()}`);
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Send video to QQ with one retry
export async function sendCompanionVideo(openid, msgId, sceneDesc, persona) {
  const prompt = buildImagePrompt(persona?.refDescription || '', sceneDesc);
  const videoUrl = await generateVideo(prompt);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const upload = await uploadC2CFile(openid, videoUrl, 2);
      const { getAccessToken } = await import('./qq-api.js');
      const t = await getAccessToken();
      const sendRes = await fetch(
        `https://api.sgroup.qq.com/v2/users/${openid}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `QQBot ${t}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            msg_type: 7,
            media: { file_info: upload.file_info },
            msg_id: msgId,
            msg_seq: 3,
          }),
        }
      );
      if (sendRes.ok) return;
      if (attempt === 2) throw new Error(`Send video failed after retry: ${await sendRes.text()}`);
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
```

**Step 4: Run test to verify it passes**
```bash
cd ~/workspace/qq-bridge && node --test tests/companion-media.test.js
```
Expected: both tests pass

**Step 5: Commit**
```bash
cd ~/workspace/qq-bridge
git add companion-media.js tests/companion-media.test.js
git commit -m "feat: add companion image/video generation with retry"
```

---

## Task 6: Wire companion mode into qq-bridge.js

**Files:**
- Modify: `qq-bridge/qq-bridge.js` (handleMessage function, lines ~158–173)

No new test file — the integration is manual (test by sending QQ messages).

**Step 1: Read the current handleMessage function**

Open `qq-bridge/qq-bridge.js` and find the `handleMessage` function (around line 159). It currently looks like:
```js
async function handleMessage(openid, msgId, content) {
  log(`Message from ${openid.slice(0, 8)}...: ${content.slice(0, 50)}`);
  const messageContent = `${content}\n[QQ:openid=${openid}·msgid=${msgId}]`;
  try {
    const ok = await injectToSession(messageContent);
    if (ok) {
      log(`Injected to session: ${openid.slice(0, 8)}...`);
      pushToMonitor(openid, content);
    }
  } catch (e) {
    log(`Handle error: ${e.message}`);
  }
}
```

**Step 2: Add imports at top of qq-bridge.js**

After the existing imports (lines 1–8), add:
```js
import { getUser, setUserMode, setSetupStep, resetUser } from './companion-state.js';
import { handleSetupStep, sendOnboardingPrompt } from './companion-setup.js';
import { companionChat } from './companion-chat.js';
import { sendCompanionImage, sendCompanionVideo } from './companion-media.js';
import { sendC2CMessage } from './qq-api.js';
```

**Step 3: Replace handleMessage with the full routing logic**

Replace the existing `handleMessage` function with:
```js
async function handleMessage(openid, msgId, content) {
  log(`Message from ${openid.slice(0, 8)}...: ${content.slice(0, 50)}`);
  pushToMonitor(openid, content);

  const u = getUser(openid);

  // --- Global commands (work in any mode) ---
  if (content.trim() === '/reset') {
    resetUser(openid);
    await sendC2CMessage(openid, msgId, '已重置，重新开始！\n\n选择模式：\n1. 情感陪伴模式\n2. 普通对话模式（默认）');
    return;
  }
  if (content.trim() === '/mode') {
    const next = u.mode === 'companion' ? 'normal' : 'companion';
    setUserMode(openid, next);
    if (next === 'companion') {
      setSetupStep(openid, 'choose_persona');
      await sendOnboardingPrompt(openid, msgId, sendC2CMessage);
    } else {
      await sendC2CMessage(openid, msgId, '已切换到普通对话模式。');
    }
    return;
  }

  // --- First message: mode selection ---
  if (u.mode === 'normal' && u.setupStep === 'choose_persona' && !u.persona) {
    // Treat as mode selection if content is '1' or '2'
    if (content.trim() === '1') {
      setUserMode(openid, 'companion');
      await sendOnboardingPrompt(openid, msgId, sendC2CMessage);
      return;
    }
    if (content.trim() === '2') {
      // Normal mode: skip onboarding, inject directly
      const messageContent = `${content}\n[QQ:openid=${openid}·msgid=${msgId}]`;
      await injectToSession(messageContent);
      return;
    }
    // Any other message → show mode selection prompt first
    await sendC2CMessage(openid, msgId, '你好！请选择模式：\n1. 情感陪伴模式\n2. 普通对话模式');
    return;
  }

  // --- Companion mode ---
  if (u.mode === 'companion') {
    // Still in setup flow
    if (u.setupStep !== 'done') {
      await handleSetupStep(openid, msgId, content, sendC2CMessage);
      return;
    }

    // Active companion conversation
    try {
      const { text, imageScene, videoScene } = await companionChat(openid, content);
      if (text) await sendC2CMessage(openid, msgId, text);
      if (imageScene) await sendCompanionImage(openid, msgId, imageScene, u.persona);
      if (videoScene) await sendCompanionVideo(openid, msgId, videoScene, u.persona);
    } catch (e) {
      log(`Companion chat error: ${e.message}`);
      await sendC2CMessage(openid, msgId, '抱歉，出了点问题，请稍后再试。');
    }
    return;
  }

  // --- Normal mode: inject to HappyCapy session ---
  try {
    const messageContent = `${content}\n[QQ:openid=${openid}·msgid=${msgId}]`;
    const ok = await injectToSession(messageContent);
    if (ok) log(`Injected to session: ${openid.slice(0, 8)}...`);
  } catch (e) {
    log(`Handle error: ${e.message}`);
  }
}
```

**Step 4: Manual test — start bridge and verify routing**
```bash
cd ~/workspace/qq-bridge
node qq-bridge.js &
tail -f /tmp/qq-bridge.log
```
- Send `1` from QQ → should get persona selection prompt
- Choose a persona, relationship, arc → should end with "已准备好陪伴你了"
- Send a message → should get companion reply
- Send `/reset` → should get mode selection prompt
- Send `2` → normal mode, messages inject to HappyCapy session

**Step 5: Commit**
```bash
cd ~/workspace/qq-bridge
git add qq-bridge.js
git commit -m "feat: wire companion mode routing into qq-bridge.js"
```

---

## Task 7: Update CLAUDE.md — document companion mode behavior

**Files:**
- Modify: `/home/node/a0/workspace/63968f75-2298-405e-afed-5d06f8b17c1a/workspace/CLAUDE.md`

Add a section explaining that companion mode conversations are handled entirely by the bridge (no injection). Normal mode messages still arrive with `[QQ:openid=xxx·msgid=xxx]` format. Update keepalive instructions.

**Step 1: Add the following section to CLAUDE.md, after the "Bridge Management" section**

```markdown
## Companion Mode

Companion mode conversations are handled entirely by `qq-bridge.js` — the bridge calls AI Gateway directly and manages per-user state. You will **not** receive companion mode messages via injection.

Normal mode QQ messages continue to arrive with the format:
```
{userText}\n[QQ:openid={openid}·msgid={msgId}]
```
Reply using `send-qq-reply`, `send-qq-image`, or `send-qq-video` as documented above.

## Commands (handled by bridge, not by you)
- `/reset` — bridge resets user state, no injection
- `/mode` — bridge switches user between companion/normal mode
```

**Step 2: Commit**
```bash
cd /home/node/a0/workspace/63968f75-2298-405e-afed-5d06f8b17c1a/workspace
git add CLAUDE.md
# Note: CLAUDE.md is in the workspace root (parent of qq-bridge/)
# If there's no git repo at root, commit inside qq-bridge/
git commit -m "docs: document companion mode in CLAUDE.md" 2>/dev/null || \
  (cd qq-bridge && git add ../CLAUDE.md && git commit -m "docs: document companion mode in CLAUDE.md")
```

---

## Task 8: Run all tests and final check

**Step 1: Run the full test suite**
```bash
cd ~/workspace/qq-bridge
node --test tests/
```
Expected output: all tests pass (companion-state, companion-personas, companion-setup, companion-chat, companion-media)

**Step 2: Verify bridge starts cleanly**
```bash
cd ~/workspace/qq-bridge
node --check qq-bridge.js companion-state.js companion-personas.js companion-setup.js companion-chat.js companion-media.js
```
Expected: no syntax errors

**Step 3: Final commit if any fixes needed**
```bash
cd ~/workspace/qq-bridge
git add -A
git commit -m "fix: address any final test or lint issues"
```

**Step 4: Verify git log**
```bash
cd ~/workspace/qq-bridge
git log --oneline
```
Expected: 6-7 commits since initial commit
