#!/usr/bin/env bash
# macOS: agent'i ~/.homedeck-agent altina kurar ve launchd ile oturum acilinca otomatik baslatir.
# Kullanim: ./install-macos.sh <hub-url> <token> [host-id] [etiket]
#   ornek:  ./install-macos.sh http://HUB_IP:8787 TOKEN laptop "Laptop"
set -euo pipefail

HUB="${1:?hub url gerekli (ornek http://HUB_IP:8787)}"
TOKEN="${2:?token gerekli}"
HOST_ID="${3:-laptop}"
LABEL="${4:-Laptop}"

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node bulunamadi. Once kur: brew install node"; exit 1; }

DIR="$HOME/.homedeck-agent"
PLIST="$HOME/Library/LaunchAgents/com.homedeck.agent.plist"
SRC="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$DIR"
cp "$SRC/agent.js" "$DIR/agent.js"
cp "$SRC/quota-readers.mjs" "$DIR/quota-readers.mjs"
cp "$SRC/claude-usage.mjs" "$DIR/claude-usage.mjs"
cp "$SRC/extra-metrics.mjs" "$DIR/extra-metrics.mjs"
cat > "$DIR/agent.config.json" <<EOF
{ "hub": "$HUB", "token": "$TOKEN", "host": "$HOST_ID", "label": "$LABEL" }
EOF
chmod 600 "$DIR/agent.config.json"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.homedeck.agent</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/agent.js</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$DIR/agent.log</string>
</dict></plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Kuruldu. Log: $DIR/agent.log"
echo "Kaldirmak icin: launchctl unload $PLIST && rm -rf $DIR $PLIST"
