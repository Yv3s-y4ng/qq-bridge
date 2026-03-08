# QQ Bridge — Claude Instructions

## Screenshot-Based Setup

When a user sends a screenshot of their QQ Bot developer console (https://q.qq.com > 你的应用 > 开发设置), extract the **AppID** and **AppSecret** from the image and run:

```bash
cd ~/workspace/qq-bridge && bash setup.sh <AppID> <AppSecret>
```

No other input is needed. The script installs dependencies, writes `.env`, auto-detects `CAPY_SESSION_ID`, and starts the bridge. Show the user the last few log lines after it starts.

## Handling QQ Messages (Normal Mode)

When you receive a message that looks like:

```
<user message text>
[QQ:openid=<openid>·msgid=<msgid>]
```

This is a QQ private message forwarded from the bridge. Reply normally — the bridge will intercept your response and send it back to the QQ user. Do NOT manually call `send-qq-reply`; the bridge handles routing automatically.

## Sending Images to QQ (Normal Mode)

To send an image to the QQ user, generate it and get the CDN URL, then:

```bash
node /home/node/.local/bin/send-qq-image <openid> <msgid> "<cdnImageUrl>"
```

Use the AI Gateway CDN URL (`https://ai-gateway-resource.trickle-lab.tech/...`). HappyCapy preview URLs are blocked by GFW and will not reach QQ users.

## Bridge Management

```bash
# Start
cd ~/workspace/qq-bridge && nohup node qq-bridge.js > /tmp/qq-bridge.log 2>&1 &

# Check status
tail -20 /tmp/qq-bridge.log

# Stop
pkill -f qq-bridge.js

# Expose monitor panel
/app/export-port.sh 8080
```

## Companion Mode

The bridge handles companion mode entirely on its own — no Claude session involvement. When a user is in companion mode, messages go through `companion-chat.js` (calls AI Gateway directly) and never reach the injected session. This is intentional.

## Commands Users Can Send in QQ

- `/reset` — resets user state, shows mode selection
- `/mode` — toggles between normal and companion mode
