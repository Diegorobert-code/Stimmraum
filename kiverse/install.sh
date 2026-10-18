#!/usr/bin/env bash
# KI-Verse auf den Sense-Engine-Server holen und starten.
# Aufruf: curl -fsSL https://raw.githubusercontent.com/diegorobert-code/stimmraum/kiverse-server/kiverse/install.sh | sudo bash
set -euo pipefail
QUELLE=https://raw.githubusercontent.com/diegorobert-code/stimmraum/kiverse-server/kiverse
TMP=$(mktemp -d)
for f in kiverse-server.js welt.html spiel.html kiverse-install.sh; do curl -fsSL "$QUELLE/$f?v=$(date +%s)" -o "$TMP/$f"; done
bash "$TMP/kiverse-install.sh"
rm -rf "$TMP"
echo
echo "Bitte von diesem Bildschirm KEIN Foto machen (die Connector-Adresse ist geheim)."
