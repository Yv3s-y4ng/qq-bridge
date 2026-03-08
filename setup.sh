#!/bin/bash
# QQ Bridge setup — run once after cloning
# Usage: bash setup.sh <QQ_APP_ID> <QQ_APP_SECRET>

set -e

QQ_APP_ID="${1:-}"
QQ_APP_SECRET="${2:-}"

if [ -z "$QQ_APP_ID" ] || [ -z "$QQ_APP_SECRET" ]; then
  echo "Usage: bash setup.sh <QQ_APP_ID> <QQ_APP_SECRET>"
  echo ""
  echo "Get these from: https://q.qq.com > 你的应用 > 开发设置 > AppID / AppSecret"
  exit 1
fi

# Install dependencies
npm install

# Write .env
cat > .env <<EOF
QQ_APP_ID=${QQ_APP_ID}
QQ_APP_SECRET=${QQ_APP_SECRET}
EOF

echo ".env created."

# Auto-detect CAPY_SESSION_ID from environment
SESSION_ID="${CAPY_SESSION_ID:-}"
if [ -n "$SESSION_ID" ]; then
  echo "CAPY_SESSION_ID=${SESSION_ID}" >> .env
  echo "CAPY_SESSION_ID auto-detected."
fi

# Start bridge
echo "Starting bridge..."
nohup node qq-bridge.js > /tmp/qq-bridge.log 2>&1 &
sleep 3
tail -5 /tmp/qq-bridge.log
