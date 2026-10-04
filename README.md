# Stimmraum

Tägliche Gesangsschule im Browser, mit Erwachsenenkurs, Kinderkurs, Stilrichtungen und Live-Tonhöhenerkennung über das Mikrofon.

**App öffnen:** https://diegorobert-code.github.io/stimmraum/

Auf dem Handy: Seite öffnen, dann «Teilen» → «Zum Home-Bildschirm» (iPhone) oder Menü → «App installieren» (Android).

## Inhalte erweitern

Alle Lektionen stehen in `src/data.js`. Neue Lektion hinzufügen, dann `bash build.sh` ausführen. Das Ergebnis landet in `docs/`, von dort wird die Website ausgeliefert.

- `src/data.js` – Kurse, Lektionen, Links
- `src/audio.js` – Klang, Mikrofon, Tonhöhenerkennung (YIN) und Auswertung
- `src/app.js` – Oberfläche
- `src/shell.html` – Gestaltung
