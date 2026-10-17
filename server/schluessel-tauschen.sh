#!/usr/bin/env bash
# DR Lab: Claude- und ElevenLabs-Schluessel der Sense Engine austauschen, ohne Neuinstallation.
# Aufruf auf dem kleinen Server:
#   curl -fsSL "https://raw.githubusercontent.com/Diegorobert-code/Stimmraum/nova-server-klein/server/schluessel-tauschen.sh" | sudo bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo starten." >&2
  exit 1
fi
ENV=/etc/sense-engine.env
[ -f "$ENV" ] || { echo "Sense Engine ist noch nicht installiert." >&2; exit 1; }

setze() {
  # $1 = Name, $2 = Wert; ersetzt die Zeile oder haengt sie an
  if grep -q "^$1=" "$ENV"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV"
  else
    echo "$1=$2" >>"$ENV"
  fi
}

echo "Neuen Claude-Schluessel einfuegen (oder einfach Enter, dann bleibt der alte)."
echo "Es darf auch der ganze cURL-Beispieltext aus der Claude Console sein."
printf "Claude-Schluessel: "
CLAUDE_KEY=""
IFS= read -r -s ZEILE </dev/tty || true
CLAUDE_KEY="$(printf '%s' "$ZEILE" | grep -oE 'sk-ant-[A-Za-z0-9_-]+' | head -n1 || true)"
while IFS= read -r -s -t 2 _REST </dev/tty; do :; done
echo
if [ -n "$CLAUDE_KEY" ]; then
  setze ANTHROPIC_API_KEY "$CLAUDE_KEY"
  echo "Claude-Schluessel ersetzt (endet auf ...${CLAUDE_KEY: -4})."
else
  echo "Claude-Schluessel bleibt."
fi

echo "ElevenLabs-Schluessel einfuegen (oder einfach Enter, dann bleibt der alte)."
printf "ElevenLabs-Schluessel: "
IFS= read -r -s ELEVEN_KEY </dev/tty || true
ELEVEN_KEY="$(printf '%s' "$ELEVEN_KEY" | tr -d '[:space:]')"
echo
if [ -n "$ELEVEN_KEY" ]; then
  setze ELEVENLABS_API_KEY "$ELEVEN_KEY"
  echo "ElevenLabs-Schluessel gesetzt (endet auf ...${ELEVEN_KEY: -4})."
else
  echo "ElevenLabs-Schluessel bleibt."
fi
unset CLAUDE_KEY ELEVEN_KEY ZEILE

chmod 600 "$ENV"
systemctl restart sense-engine
sleep 2
curl -fsS http://127.0.0.1:8650/health && echo " Sense Engine laeuft mit den neuen Schluesseln."
echo "Jetzt den alten Claude-Schluessel in der Claude Console loeschen."
