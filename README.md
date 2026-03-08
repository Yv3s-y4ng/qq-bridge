# qq-bridge

QQ Bot bridge for HappyCapy / Claude Code. Forwards QQ private messages into your Claude session, and supports an emotional companion mode with AI-generated images and videos.

## 使用教程

**新用户请先查看：https://q.qq.com/qqbot/openclaw/index.html**

## Features

- **Normal mode** — QQ messages are forwarded to your Claude Code session; Claude replies are sent back to the QQ user
- **Companion mode** — 3 preset AI companions with personality, relationship, and emotional arc selection; auto-sends AI-generated images and videos
- **Real-time monitor panel** — web UI on port 8080 showing live message feed
- **Commands** — `/reset` and `/mode` work from any state

## Requirements

- Node.js 18+
- A QQ Bot account at https://q.qq.com (mini-program bot)
- Deployed inside a HappyCapy session (`AI_GATEWAY_API_KEY` is auto-detected)

---

## Deploy on HappyCapy (screenshot method)

The easiest way to set up: send a screenshot of your QQ Bot developer console and Claude will extract the credentials and start the bridge automatically.

**Steps:**

1. Clone the repo into your HappyCapy workspace:
   ```bash
   git clone https://github.com/Y1fe1-Yang/qq-bridge ~/workspace/qq-bridge
   ```

2. Open or continue a Claude Code session in that directory.

3. Send a screenshot of your QQ Bot developer console — the page at:
   ```
   https://q.qq.com > 你的应用 > 开发设置
   ```
   The screenshot should show **AppID** and **AppSecret** (click "显示" to reveal the secret first).

4. Claude reads the credentials from the screenshot and runs:
   ```bash
   bash setup.sh <AppID> <AppSecret>
   ```
   The bridge starts automatically.

---

## Manual Setup

```bash
git clone https://github.com/Y1fe1-Yang/qq-bridge ~/workspace/qq-bridge
cd ~/workspace/qq-bridge
bash setup.sh YOUR_APP_ID YOUR_APP_SECRET
```

`setup.sh` will:
- Run `npm install`
- Write `.env` with your credentials
- Auto-detect and save `CAPY_SESSION_ID` if running inside HappyCapy
- Start the bridge process in the background

---

## Bridge Management

```bash
# Check logs
tail -20 /tmp/qq-bridge.log

# Stop bridge
pkill -f qq-bridge.js

# Restart bridge
cd ~/workspace/qq-bridge && nohup node qq-bridge.js > /tmp/qq-bridge.log 2>&1 &

# Monitor panel (after exposing port 8080 in HappyCapy)
/app/export-port.sh 8080
```

---

## User Commands in QQ

| Command | Effect |
|---------|--------|
| `/reset` | Reset all state; show mode selection again |
| `/mode` | Toggle between normal and companion mode |

On the very first message, users see:
```
1. 情感陪伴模式
2. 普通对话模式（默认）
```

---

## Companion Mode

Three-step onboarding after choosing companion mode:

**Step 1 — Choose persona:**
| # | Character | Personality |
|---|-----------|-------------|
| 1 | 冰儿 | 冰山美人，高冷慢热，嘴硬心软 |
| 2 | 小橙 | 活泼少女，阳光爱笑，情绪外露 |
| 3 | 夜星 | 神秘精灵，言辞简短，意味深长 |

**Step 2 — Choose relationship:** stranger / old friend / childhood friend

**Step 3 — Choose emotional arc:** tsundere / gentle / scheming

The companion responds in character via Claude Sonnet. When the emotional moment is right, it automatically sends an AI-generated image (Gemini Flash) or video (Veo 3) inline.

---

## Architecture

```
QQ User
  └─► QQ WebSocket Gateway
        └─► qq-bridge.js
              ├─ Normal mode ──► injectToSession() ──► HappyCapy Claude session ──► sendC2CMessage()
              └─ Companion mode
                    ├─ Setup  ──► companion-setup.js
                    ├─ Chat   ──► companion-chat.js ──► AI Gateway (Claude Sonnet)
                    └─ Media  ──► companion-media.js ──► AI Gateway (Gemini / Veo)
```

---

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `QQ_APP_ID` | Yes | From QQ Bot developer console |
| `QQ_APP_SECRET` | Yes | From QQ Bot developer console |
| `AI_GATEWAY_API_KEY` | Auto | Auto-detected in HappyCapy environment |
| `CAPY_SESSION_ID` | Auto | Auto-detected; needed for normal mode injection |

See `.env.example` for reference.
