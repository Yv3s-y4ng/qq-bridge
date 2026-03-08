import { buildSystemPrompt } from './companion-personas.js';
import { getUser, addHistory } from './companion-state.js';

const CHAT_URL = 'https://ai-gateway.trickle-lab.tech/api/v1/chat/completions';
const CHAT_MODEL = 'anthropic/claude-sonnet-4.5';

// Keywords that mean "send me a selfie / show yourself"
const SELFIE_PATTERNS = /发(个|张|一张)?自拍|自拍(发|给我)|让我看看你|晒(个|张)照|看看你长什么/;

// Keywords that mean "send me any image (not a selfie)"
// e.g. "给我一张卡皮图片", "来张猫咪照片", "发张动物图", "能发图吗"
const IMAGE_REQUEST_PATTERNS = /给我(发|来)?(一张|张|几张)?(.{1,20}?)(图片|照片|图)|来(一张|张)?(.{1,20}?)(图|图片|照片)|发(一张|张)?(.{1,20}?)(图|图片|照片)|能发图吗|可以发图吗|发(张|个)?图/;

// Extract the requested image subject from message
function extractImageSubject(msg) {
  const m = msg.match(
    /(?:给我(?:发|来)?|来|发)(?:一张|张|几张)?(.{1,20}?)(?:图片|照片|图|的图|的照片)/
  );
  return m ? m[1].trim() : msg.replace(/给我|发|来|一张|张|图片|照片|图/g, '').trim() || '可爱的场景';
}

// Per-persona in-character selfie reactions (text sent before the image)
const SELFIE_REACTIONS = {
  ice:    '……凭什么。',
  orange: '好嘛好嘛～等我一秒！',
  star:   '……好。',
  shen:   '……',
  bai:    '嗯，等我。',
  ling:   '哦？想看我？……行吧。',
};

// Per-persona reactions for general image sends
const IMAGE_REACTIONS = {
  ice:    '……给你。',
  orange: '找到啦～给你！',
  star:   '……。',
  shen:   '嗯。',
  bai:    '给你找了一张。',
  ling:   '行，给你搞一张。',
};

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

// Bypass Claude entirely for selfie requests — generate image directly from persona
function handleSelfieRequest(openid, userMessage) {
  const u = getUser(openid);
  const persona = u.persona;
  const text = SELFIE_REACTIONS[persona?.id] ?? '……等一下。';
  const sceneDesc = `${persona?.refDescription ?? ''}，对着手机自拍，自然姿势`;
  addHistory(openid, 'user', userMessage);
  addHistory(openid, 'assistant', text);
  return { text, imageScene: sceneDesc, videoScene: null };
}

// Bypass Claude for general image requests — user asked for a pic of something
function handleImageRequest(openid, userMessage) {
  const u = getUser(openid);
  const persona = u.persona;
  const text = IMAGE_REACTIONS[persona?.id] ?? '给你。';
  const subject = extractImageSubject(userMessage);
  const imageScene = `${subject}，高清，自然真实，精美摄影`;
  addHistory(openid, 'user', userMessage);
  addHistory(openid, 'assistant', text);
  return { text, imageScene, videoScene: null };
}

// Call AI Gateway and return parsed reply + update history
export async function companionChat(openid, userMessage) {
  // Intercept selfie requests — Claude's safety training will refuse these;
  // handle entirely in-bridge using persona refDescription instead.
  if (SELFIE_PATTERNS.test(userMessage)) {
    return handleSelfieRequest(openid, userMessage);
  }

  // Intercept general image requests — Claude also refuses "I can't send images";
  // extract subject and generate directly.
  if (IMAGE_REQUEST_PATTERNS.test(userMessage)) {
    return handleImageRequest(openid, userMessage);
  }

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
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error(`Unexpected API response: ${JSON.stringify(data)}`);

  const parsed = parseReply(raw);

  // Update history (strips media tags internally)
  addHistory(openid, 'user', userMessage);
  addHistory(openid, 'assistant', raw);

  return parsed;
}
