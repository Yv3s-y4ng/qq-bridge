// qq-bridge/qq-bridge.js — pure injection mode
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';
import WebSocket from 'ws';
import { getAccessToken, getGatewayUrl, sendC2CMessage } from './qq-api.js';
import { getUser, setUserMode, setSetupStep, resetUser } from './companion-state.js';
import { transcribeVoice } from './voice-transcribe.js';
import { handleSetupStep, sendOnboardingPrompt } from './companion-setup.js';
import { companionChat } from './companion-chat.js';
import { sendCompanionImage, sendCompanionVideo } from './companion-media.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

// Auto-detect HappyCapy environment variables if not set in .env
if (!process.env.AI_GATEWAY_API_KEY) {
  try {
    const { execSync } = await import('child_process');
    const val = execSync('printenv AI_GATEWAY_API_KEY 2>/dev/null || cat /run/secrets/ai_gateway_api_key 2>/dev/null || true', { encoding: 'utf8' }).trim();
    if (val) process.env.AI_GATEWAY_API_KEY = val;
  } catch {}
}
if (!process.env.CAPY_SESSION_ID) {
  try {
    // Try to read from HappyCapy session context
    const { execSync } = await import('child_process');
    const val = execSync('printenv CAPY_SESSION_ID 2>/dev/null || true', { encoding: 'utf8' }).trim();
    if (val) process.env.CAPY_SESSION_ID = val;
  } catch {}
}

const C2C_MESSAGE_INTENT = 1 << 25;

let heartbeatTimer = null;
let seq = null;

// Monitor panel: SSE clients + recent messages
const sseClients = new Set();
const recentChats = []; // last 50

function log(msg) {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
}

function pushToMonitor(openid, user) {
  const chat = { openid: openid.slice(0, 8), user, time: new Date().toISOString() };
  recentChats.push(chat);
  if (recentChats.length > 50) recentChats.shift();
  const data = `data: ${JSON.stringify(chat)}\n\n`;
  sseClients.forEach(res => res.write(data));
}

// --- Monitor HTTP server ---
const PANEL_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QQ Bridge 监控</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #f0f2f5; min-height: 100vh; }
  header { background: #1677ff; color: #fff; padding: 14px 20px; font-size: 17px; font-weight: 600; display: flex; align-items: center; gap: 10px; position: sticky; top: 0; z-index: 10; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #52c41a; flex-shrink: 0; }
  .dot.offline { background: #ff4d4f; }
  #feed { padding: 16px; display: flex; flex-direction: column; gap: 14px; max-width: 720px; margin: 0 auto; }
  .card { background: #fff; border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 4px rgba(0,0,0,.08); animation: fadeIn .3s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .meta { font-size: 12px; color: #999; margin-bottom: 10px; display: flex; justify-content: space-between; }
  .bubble { padding: 9px 13px; border-radius: 10px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-width: 90%; }
  .user-row { display: flex; justify-content: flex-end; }
  .user-bubble { background: #1677ff; color: #fff; border-bottom-right-radius: 2px; }
  .tag { display: inline-block; background: #e6f4ff; color: #1677ff; border-radius: 4px; font-size: 11px; padding: 2px 7px; margin-top: 8px; }
  .empty { text-align: center; color: #bbb; margin-top: 60px; font-size: 15px; }
</style>
</head>
<body>
<header><span class="dot" id="dot"></span>QQ Bridge 实时监控</header>
<div id="feed"><p class="empty">等待 QQ 消息...</p></div>
<script>
const feed = document.getElementById('feed');
const dot = document.getElementById('dot');
let first = true;

function addCard(d) {
  if (first) { feed.innerHTML = ''; first = false; }
  const t = new Date(d.time).toLocaleTimeString('zh-CN');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = \`
    <div class="meta"><span>用户 \${d.openid}...</span><span>\${t}</span></div>
    <div class="user-row"><div class="bubble user-bubble">\${esc(d.user)}</div></div>
    <span class="tag">已注入 HappyCapy</span>
  \`;
  feed.prepend(card);
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function connect() {
  const es = new EventSource('/events');
  es.addEventListener('history', e => {
    const chats = JSON.parse(e.data);
    chats.slice().reverse().forEach(addCard);
  });
  es.addEventListener('chat', e => addCard(JSON.parse(e.data)));
  es.onopen = () => dot.className = 'dot';
  es.onerror = () => { dot.className = 'dot offline'; setTimeout(connect, 3000); es.close(); };
}
connect();
</script>
</body>
</html>`;

const monitorServer = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`event: history\ndata: ${JSON.stringify(recentChats)}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { sseClients.delete(res); clearInterval(ping); });
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(PANEL_HTML);
  }
});

monitorServer.listen(8080, () => log('Monitor panel on :8080'));

// --- Session injection ---
async function injectToSession(content) {
  const sessionId = process.env.CAPY_SESSION_ID;
  if (!sessionId) { log('ERROR: CAPY_SESSION_ID not set'); return; }
  const res = await fetch('http://localhost:3001/api/agent/claude/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message: { role: 'user', content } }),
  });
  const data = await res.json();
  if (!data.success) log(`Inject failed: ${JSON.stringify(data)}`);
  return data.success;
}

// --- Keepalive: ping session every 4 minutes to prevent cold start ---
setInterval(async () => {
  try {
    await injectToSession('[KEEPALIVE]');
    log('Keepalive sent');
  } catch (e) {
    log(`Keepalive error: ${e.message}`);
  }
}, 4 * 60 * 1000);

// --- Message handler ---
async function handleMessage(openid, msgId, content, attachments = []) {
  log(`Message from ${openid.slice(0, 8)}...: ${content.slice(0, 50)}${attachments.length ? ` [+${attachments.length} attachment(s)]` : ''}`);

  // --- Voice message handling: transcribe before anything else ---
  const voiceAttachment = attachments.find(a =>
    a.content_type?.startsWith('audio/') ||
    /\.(silk|amr|ogg|mp3|wav|m4a|mp4|opus)(\?|$)/i.test(a.url || '')
  );
  if (voiceAttachment && !content) {
    log(`Voice message from ${openid.slice(0, 8)}..., url: ${voiceAttachment.url?.slice(0, 80)}`);
    await sendC2CMessage(openid, msgId, '🎙️ 正在识别语音...');
    const transcript = await transcribeVoice(voiceAttachment);
    if (!transcript) {
      await sendC2CMessage(openid, msgId, '抱歉，暂时无法识别这段语音，请发文字吧～');
      return;
    }
    log(`Voice transcript: ${transcript.slice(0, 80)}`);
    content = transcript;
  }

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

  // --- First message: mode selection (only for brand-new users) ---
  if (u.mode === 'normal' && u.setupStep === 'choose_persona' && !u.persona) {
    if (content.trim() === '1') {
      setUserMode(openid, 'companion');
      setSetupStep(openid, 'choose_persona'); // stays in companion setup flow
      await sendOnboardingPrompt(openid, msgId, sendC2CMessage);
      return;
    }
    if (content.trim() === '2') {
      // Mark past onboarding so this block is never entered again
      setSetupStep(openid, 'normal_done');
      const messageContent = `${content}\n[QQ:openid=${openid}·msgid=${msgId}]`;
      await injectToSession(messageContent);
      return;
    }
    await sendC2CMessage(openid, msgId, '你好！请选择模式：\n1. 情感陪伴模式\n2. 普通对话模式');
    return;
  }

  // --- Companion mode ---
  if (u.mode === 'companion') {
    if (u.setupStep !== 'done') {
      // Note: custom image upload (option 4 / awaiting_image) requires parsing
      // QQ image attachment messages — not yet implemented; users see option 4
      // but images won't be processed until QQ attachment parsing is added.
      await handleSetupStep(openid, msgId, content, sendC2CMessage);
      return;
    }
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

// --- QQ WebSocket ---
async function connect(retryDelay = 1000) {
  try {
    const token = await getAccessToken();
    const gatewayUrl = await getGatewayUrl();
    log(`Connecting to ${gatewayUrl}`);

    const ws = new WebSocket(gatewayUrl);

    ws.on('message', async (data) => {
      let packet;
      try { packet = JSON.parse(data); } catch { return; }

      const { op, t, s, d } = packet;
      if (s != null) seq = s;

      if (op === 10) {
        const interval = d.heartbeat_interval;
        heartbeatTimer = setInterval(() => {
          ws.send(JSON.stringify({ op: 1, d: seq }));
        }, interval);
        ws.send(JSON.stringify({
          op: 2,
          d: {
            token: `QQBot ${token}`,
            intents: C2C_MESSAGE_INTENT,
            shard: [0, 1],
            properties: {},
          },
        }));
      } else if (op === 0 && t === 'READY') {
        log(`Ready. Bot: ${d.user?.username}, session: ${d.session_id?.slice(0, 8)}...`);
      } else if (op === 0 && t === 'C2C_MESSAGE_CREATE') {
        const openid = d.author?.user_openid;
        const msgId = d.id;
        const content = (d.content || '').trim();
        const attachments = d.attachments || [];
        if (attachments.length) log(`Attachments: ${JSON.stringify(attachments).slice(0, 200)}`);
        handleMessage(openid, msgId, content, attachments);
      }
    });

    ws.on('close', (code) => {
      clearInterval(heartbeatTimer);
      const next = Math.min(retryDelay * 2, 30000);
      log(`Closed (${code}). Reconnecting in ${retryDelay}ms...`);
      setTimeout(() => connect(next), retryDelay);
    });

    ws.on('error', (err) => {
      log(`WS error: ${err.message}`);
    });

  } catch (e) {
    const next = Math.min(retryDelay * 2, 30000);
    log(`Connect error: ${e.message}. Retry in ${retryDelay}ms...`);
    setTimeout(() => connect(next), retryDelay);
  }
}

log('QQ Bridge starting (injection mode)...');
connect();
