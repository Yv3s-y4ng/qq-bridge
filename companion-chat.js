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
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error(`Unexpected API response: ${JSON.stringify(data)}`);

  const parsed = parseReply(raw);

  // Update history (strips media tags internally)
  addHistory(openid, 'user', userMessage);
  addHistory(openid, 'assistant', raw);

  return parsed;
}
