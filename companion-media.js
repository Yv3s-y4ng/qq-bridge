import { uploadC2CFile } from './qq-api.js';

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
  return data.data[0].url;
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

async function sendMediaToQQ(openid, msgId, mediaUrl, fileType, msgSeq) {
  const { getAccessToken } = await import('./qq-api.js');
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const upload = await uploadC2CFile(openid, mediaUrl, fileType);
      const token = await getAccessToken();
      const sendRes = await fetch(
        `https://api.sgroup.qq.com/v2/users/${openid}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `QQBot ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            msg_type: 7,
            media: { file_info: upload.file_info },
            msg_id: msgId,
            msg_seq: msgSeq,
          }),
        }
      );
      if (sendRes.ok) return;
      const err = await sendRes.text();
      if (attempt === 2) throw new Error(`Send media failed: ${err}`);
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

export async function sendCompanionImage(openid, msgId, sceneDesc, persona) {
  const prompt = buildImagePrompt(persona?.refDescription || '', sceneDesc);
  const imageUrl = await generateImage(prompt, persona?.refImageUrl || null);
  await sendMediaToQQ(openid, msgId, imageUrl, 1, 2);
}

export async function sendCompanionVideo(openid, msgId, sceneDesc, persona) {
  const prompt = buildImagePrompt(persona?.refDescription || '', sceneDesc);
  const videoUrl = await generateVideo(prompt);
  await sendMediaToQQ(openid, msgId, videoUrl, 2, 3);
}
