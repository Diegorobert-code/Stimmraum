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

## Sense Engine (Prototyp)

Unter `docs/sense/` liegt Sense Engine, Diegos persönliche KI-Zentrale: https://diegorobert-code.github.io/Stimmraum/sense/

Drei Reiter: **Zentrale** (Projekte mit Prozent, Meine Apps, HumanSpark «Jetzt messen», Aufgaben per Sprache, KI-Werkzeuge mit echtem Status, Hermes-Verbindung, Freigaben mit Schaltern), **Transkript** (Diktat auf Schweizerdeutsch/Deutsch, Verlauf, «An Hermes» direkt, «An Claude», «An ChatGPT») und **Suche** (verschlüsselte Notizen-Suche, braucht den Schlüssel; `?demo` zeigt Beispiel-Notizen). Nova, der kleine weisse Roboter, sitzt unten rechts und gibt Fragen an Hermes weiter. Zentrale und Transkript gehen ohne Schlüssel. Die Hermes-Adresse und das Passwort teilt sich Sense Engine mit der DR-Lab-Transkript-App (`drlab-hermes-adresse`, `drlab-hermes-passwort` im Browser-Speicher); sie stehen nie im Code. Alles Persönliche bleibt im Browser des Geräts.

- `docs/sense/index.html` – die App (Zentrale, Transkript, Suche, Nova)
- `docs/sense/daten.enc` – der Such-Index, verschlüsselt (AES-256-GCM). Ohne den persönlichen Schlüssel nicht lesbar.
- `sense/verschluesseln.mjs` – verschlüsselt einen neuen Index
- `docs/sense/manifest.webmanifest`, `icon-192.png`, `icon-512.png` – eigenes App-Icon für den Home-Bildschirm
- `docs/404.html` – leitet falsche oder alte Adressen weiter (alles mit «sense», «nova» oder «engine» zur Sense Engine), statt eine 404-Seite zu zeigen

Der Index im Klartext und der Schlüssel gehören nie in dieses Repository. Sobald es ein eigenes Repository für Sense Engine gibt, zieht dieser Ordner dorthin um.
