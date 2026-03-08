// qq-bridge/qq-api.js
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const BASE_URL = 'https://api.sgroup.qq.com';
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';

let tokenCache = null;

export async function getAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: process.env.QQ_APP_ID,
      clientSecret: process.env.QQ_APP_SECRET,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token fetch failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return tokenCache.token;
}

export async function getGatewayUrl() {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/gateway`, {
    headers: { Authorization: `QQBot ${token}` },
  });
  if (!res.ok) throw new Error(`Gateway fetch failed: ${res.status}`);
  const data = await res.json();
  return data.url;
}

export async function sendC2CMessage(openid, msgId, content) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/users/${openid}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content,
      msg_type: 0,
      msg_id: msgId,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Send C2C failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function uploadC2CFile(openid, fileUrl, fileType = 1) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/users/${openid}/files`, {
    method: 'POST',
    headers: {
      Authorization: `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_type: fileType, // 1 = image
      url: fileUrl,
      srv_send_msg: false,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload C2C file failed: ${res.status} ${err}`);
  }
  return res.json(); // { file_uuid, file_info, ttl, id }
}

export async function sendC2CImage(openid, msgId, imageUrl) {
  const token = await getAccessToken();
  const uploadResult = await uploadC2CFile(openid, imageUrl);
  const res = await fetch(`${BASE_URL}/v2/users/${openid}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `QQBot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 7,
      media: { file_info: uploadResult.file_info },
      msg_id: msgId,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Send C2C image failed: ${res.status} ${err}`);
  }
  return res.json();
}
