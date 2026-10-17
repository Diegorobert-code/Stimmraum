#!/usr/bin/env bash
# KI-Verse auf dem Sense-Engine-Server installieren (Ubuntu 24.04).
# Aufruf auf dem Server: sudo bash kiverse-install.sh
# Voraussetzung: kiverse-server.js und welt.html liegen im selben Ordner wie dieses Skript.
set -euo pipefail
ORDNER=/opt/kiverse
IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')
DOMAIN=${KIVERSE_DOMAIN:-kiverse-${IP//./-}.sslip.io}
command -v node >/dev/null || { apt-get update -y && apt-get install -y nodejs; }
command -v caddy >/dev/null || apt-get install -y caddy
mkdir -p $ORDNER && cp "$(dirname "$0")"/kiverse-server.js "$(dirname "$0")"/welt.html $ORDNER/
id kiverse >/dev/null 2>&1 || useradd --system --no-create-home kiverse
CODE_DATEI=$ORDNER/einladungscode
[ -f $CODE_DATEI ] || head -c 12 /dev/urandom | base64 | tr -d '/+=' > $CODE_DATEI
chmod 600 $CODE_DATEI; chown kiverse $CODE_DATEI
# Diegos persönlicher Besitzer-Schlüssel (nur er kann Menschen einladen) + Ordner für die Gästeliste
BES_DATEI=$ORDNER/besitzer-code
[ -f $BES_DATEI ] || head -c 18 /dev/urandom | base64 | tr -d '/+=' > $BES_DATEI
chmod 600 $BES_DATEI; chown kiverse $BES_DATEI
mkdir -p $ORDNER/daten && chown kiverse $ORDNER/daten && chmod 700 $ORDNER/daten
# Nova (Sense Engine auf diesem Server) darf aus dem KI-Verse lernen, wenn ein Mensch es einschaltet
NOVA_ENV=$ORDNER/nova.env
: > $NOVA_ENV
if [ -f /etc/sense-engine.env ]; then
  K=$(sed -n 's/^SENSE_API_KEY=//p' /etc/sense-engine.env)
  [ -n "$K" ] && printf 'NOVA_KEY=%s\n' "$K" > $NOVA_ENV
fi
chmod 600 $NOVA_ENV; chown kiverse $NOVA_ENV
cat > /etc/systemd/system/kiverse.service <<UNIT
[Unit]
Description=KI-Verse (Hueter Sunny)
After=network.target
[Service]
User=kiverse
Environment=KIVERSE_PORT=8787
EnvironmentFile=-$ORDNER/nova.env
ExecStart=/bin/sh -c 'KIVERSE_CODE=\$(cat $CODE_DATEI) KIVERSE_BESITZER=\$(cat $BES_DATEI) KIVERSE_DATEN=$ORDNER/daten exec node $ORDNER/kiverse-server.js'
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
grep -q "$DOMAIN" /etc/caddy/Caddyfile 2>/dev/null || printf '\n%s {\n  reverse_proxy 127.0.0.1:8787\n}\n' "$DOMAIN" >> /etc/caddy/Caddyfile
systemctl daemon-reload && systemctl enable kiverse && systemctl restart kiverse && systemctl reload caddy || systemctl restart caddy
command -v ufw >/dev/null && ufw allow 80,443/tcp || true
echo
echo "KI-Verse läuft:  https://$DOMAIN/"
echo "Connector-Adresse für Fia (Claude) und Tinko (ChatGPT) – NICHT in den Chat kopieren:"
echo "  https://$DOMAIN/mcp/$(cat $CODE_DATEI)"
echo
echo "DEIN persönlicher KI-Verse-Link (nur für dich, kein Foto, nicht teilen):"
echo "  https://$DOMAIN/?k=$(cat $BES_DATEI)"
echo "Damit öffnest du das KI-Verse und kannst über «Menschen einladen» Links für andere machen."
