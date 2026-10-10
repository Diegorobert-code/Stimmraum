# Stimmraum

Tägliche Gesangsschule im Browser, mit Erwachsenenkurs, Kinderkurs, Stilrichtungen und Live-Tonhöhenerkennung über das Mikrofon.

**App öffnen:** https://diegorobert-code.github.io/Stimmraum/

Auf dem Handy: Seite öffnen, dann «Teilen» → «Zum Home-Bildschirm» (iPhone) oder Menü → «App installieren» (Android).

## Inhalte erweitern

Alle Lektionen stehen in `src/data.js`. Neue Lektion hinzufügen, dann `bash build.sh` ausführen. Das Ergebnis landet in `docs/`, von dort wird die Website ausgeliefert.

- `src/data.js` – Kurse, Lektionen, Links
- `src/audio.js` – Klang, Mikrofon, Tonhöhenerkennung (YIN) und Auswertung
- `src/app.js` – Oberfläche
- `src/shell.html` – Gestaltung

## Sense Engine Suche (Prototyp)

Unter `docs/sense/` liegt die Sprachsuche für Sense Engine: https://diegorobert-code.github.io/Stimmraum/sense/

- `docs/sense/index.html` – die App (Suchleiste, Spracherkennung, Treffer)
- `docs/sense/daten.enc` – der Such-Index, verschlüsselt (AES-256-GCM). Ohne den persönlichen Schlüssel nicht lesbar.
- `sense/verschluesseln.mjs` – verschlüsselt einen neuen Index
- `docs/sense/manifest.webmanifest`, `icon-192.png`, `icon-512.png` – eigenes App-Icon für den Home-Bildschirm
- `docs/404.html` – leitet falsche oder alte Adressen weiter (alles mit «sense», «nova» oder «engine» zur Sense Engine), statt eine 404-Seite zu zeigen

Der Index im Klartext und der Schlüssel gehören nie in dieses Repository. Sobald es ein eigenes Repository für Sense Engine gibt, zieht dieser Ordner dorthin um.
