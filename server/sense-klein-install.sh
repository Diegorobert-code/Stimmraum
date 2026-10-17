#!/usr/bin/env bash
# DR Lab: Sense Engine (Novas Zuhause) auf dem KLEINEN Server, mit Fia (Claude) direkt.
# Brix (Hermes) kommt später dazu. Aufruf in Termius auf dem kleinen Server:
#   curl -fsSL https://raw.githubusercontent.com/Diegorobert-code/Stimmraum/nova-server-klein/server/sense-klein-install.sh | sudo bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo starten." >&2
  exit 1
fi

REPO_RAW="https://raw.githubusercontent.com/Diegorobert-code/Stimmraum/nova-server-klein/server"
ORIGINS="https://diegorobert-code.github.io,https://drlab.ch,https://www.drlab.ch,https://headless-zewdelhstzx-diegoroberttherapy-1412.wix-site-host.com,https://raw.githack.com"

echo "== 1/5 System aktualisieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates openssl caddy ufw python3 python3-venv sqlite3

echo "== 2/5 Fia (Claude) anbinden"
echo "Claude-Schluessel (beginnt mit sk-ant-) hier einfuegen. Er wird nicht angezeigt und nur auf diesem Server gespeichert."
echo "Es darf auch der ganze cURL-Beispieltext aus der Claude Console sein, der Schluessel wird herausgesucht."
printf "Claude-Schluessel: "
CLAUDE_KEY=""
while IFS= read -r -s ZEILE </dev/tty; do
  CLAUDE_KEY="$(printf '%s' "$ZEILE" | grep -oE 'sk-ant-[A-Za-z0-9_-]+' | head -n1 || true)"
  [ -n "$CLAUDE_KEY" ] && break
done
# Restliche eingefuegte Zeilen (z. B. vom cURL-Beispiel) verwerfen
while IFS= read -r -s -t 2 _REST </dev/tty; do :; done
echo
echo "Claude-Schluessel erkannt (endet auf ...${CLAUDE_KEY: -4})."
echo "Figurenstimmen: ElevenLabs-Schluessel einfuegen (oder einfach Enter, dann sprechen die Apps mit der Handy-Stimme)."
read -r -s -p "ElevenLabs-Schluessel: " ELEVEN_KEY </dev/tty
echo

echo "== 3/5 Sense Engine mit eigener Datenbank einrichten"
API_KEY="$(openssl rand -hex 24)"
mkdir -p /opt/sense-engine /var/lib/sense-engine
chmod 700 /var/lib/sense-engine
python3 -m venv /opt/sense-engine/venv
/opt/sense-engine/venv/bin/pip install --quiet --upgrade pip anthropic
curl -fsSL "$REPO_RAW/sense-klein.py" -o /opt/sense-engine/sense-engine.py
cat >/etc/sense-engine.env <<EOF
SENSE_API_KEY=$API_KEY
SENSE_ORIGINS=$ORIGINS
ANTHROPIC_API_KEY=$CLAUDE_KEY
SENSE_MODELL=claude-haiku-5-5
SENSE_KI_DECKEL_USD=5.5
ELEVENLABS_API_KEY=$ELEVEN_KEY
SENSE_STIMME_MODELL=eleven_flash_v2_5
SENSE_STIMME_DECKEL_USD=11
EOF
chmod 600 /etc/sense-engine.env
unset CLAUDE_KEY ELEVEN_KEY
cat >/etc/systemd/system/sense-engine.service <<'EOF'
[Unit]
Description=Sense Engine - Novas Zuhause
After=network.target

[Service]
EnvironmentFile=/etc/sense-engine.env
ExecStart=/opt/sense-engine/venv/bin/python /opt/sense-engine/sense-engine.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now sense-engine

echo "== 4/5 Sichere Adresse (HTTPS) einrichten"
IP="$(curl -fsS https://api.ipify.org)"
HOST="sense-${IP//./-}.sslip.io"
cat >/etc/caddy/Caddyfile <<EOF
$HOST {
  reverse_proxy 127.0.0.1:8650
}
EOF
systemctl restart caddy
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "== 5/5 Kurzer Test"
sleep 3
curl -fsS http://127.0.0.1:8650/health && echo " Sense Engine laeuft."

echo
echo "=============================================="
echo " Sense Engine ist bereit. Nova kann aufwachen."
echo " Sense-Adresse:   https://$HOST"
echo " Sense-Passwort:  $API_KEY"
echo " Nova-Link fuer alle Apps (auf dem Handy oeffnen):"
echo "   https://diegorobert-code.github.io/DR_Lab/apps/#hermes=https://$HOST"
echo " Die Adresse darf in den Chat, das Passwort NICHT."
echo "=============================================="
