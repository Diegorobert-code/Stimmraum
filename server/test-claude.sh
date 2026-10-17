#!/usr/bin/env bash
# DR Lab: prueft, ob der Claude-Schluessel der Sense Engine funktioniert. Zeigt nie den Schluessel.
#   ssh ubuntu@<server> 'curl -fsSL "https://raw.githubusercontent.com/Diegorobert-code/Stimmraum/nova-server-klein/server/test-claude.sh" | sudo bash'
set -uo pipefail
ENV=/etc/sense-engine.env
K="$(sed -n 's/^ANTHROPIC_API_KEY=//p' "$ENV")"
M="$(sed -n 's/^SENSE_MODELL=//p' "$ENV")"
M="${M:-claude-haiku-5-5}"
echo "Schluessel endet auf ...${K: -4}, Modell $M"
curl -sS -m 30 https://api.anthropic.com/v1/messages \
  -H "x-api-key: $K" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d "{\"model\":\"$M\",\"max_tokens\":20,\"messages\":[{\"role\":\"user\",\"content\":\"Sag nur: Verbindung steht.\"}]}" \
  -w "\nHTTP %{http_code}\n" | sed -E 's/sk-ant-[A-Za-z0-9_-]+/sk-ant-***/g' | cut -c1-400
systemctl is-active sense-engine
