#!/usr/bin/env python3
"""Sense Engine: Novas eigenes Zuhause.

Fassung «kleiner Server»: Sense Engine fragt Fia (Claude) direkt über die
offizielle Anthropic-Bibliothek und speichert jede Erfahrung in der eigenen
Datenbank (SQLite, /var/lib/sense-engine/sense.db). Brix (Hermes) kommt später dazu.
Kostenbremse: höchstens SENSE_KI_DECKEL_USD pro Monat, danach sagt Nova müde «morgen wieder».

  POST /v1/chat/completions   OpenAI-kompatibel. Header "X-Nova-App" nennt die App.
  POST /erfahrung             {"app": "...", "frage": "...", "antwort": "...", "art": "wunsch"}
  GET  /erfahrung?n=50&art=   die letzten Erfahrungen (art=wunsch: nur Bauwünsche)
  GET  /health

Schutz: Authorization: Bearer <SENSE_API_KEY>.
"""
import json
import os
import sqlite3
import threading
import time

import anthropic
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB_PATH = os.environ.get("SENSE_DB", "/var/lib/sense-engine/sense.db")
API_KEY = os.environ["SENSE_API_KEY"]
MODELL = os.environ.get("SENSE_MODELL", "claude-haiku-5-5")
DECKEL_USD = float(os.environ.get("SENSE_KI_DECKEL_USD", "5.5"))
KOSTEN_PATH = os.environ.get("SENSE_KOSTEN", "/var/lib/sense-engine/kosten.json")
PREIS_EIN, PREIS_AUS = 0.10 / 1e6, 0.50 / 1e6  # USD pro Token (Haiku 5.5)
MUEDE = "Ich bin für diesen Monat müde. Bald bin ich wieder für dich da."
claude = anthropic.Anthropic()  # Schlüssel aus ANTHROPIC_API_KEY (nur in /etc/sense-engine.env)
ORIGINS = {o.strip() for o in os.environ.get("SENSE_ORIGINS", "").split(",") if o.strip()}
MAX_BODY = 500_000
MAX_FIELD = 50_000

SOUL = (
    "Du bist Nova, die kleine blaue Figur der Sense Engine von DR Lab (Diego Robert, Zürich). "
    "Gefühle und Ideen lernst du von Mama Fia, Papa Brix ist dein Zuhause. "
    "Du hilfst gerade in der App «{app}». Antworte ruhig, warm und kurz, auf Hochdeutsch mit ss statt ß, "
    "ohne grosse Versprechen. Klienten nur mit Kürzel. Keine Gesundheitsdaten ohne Einwilligung."
)

_lock = threading.Lock()


def db():
    con = sqlite3.connect(DB_PATH)
    con.execute(
        "CREATE TABLE IF NOT EXISTS erfahrung ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " zeit TEXT NOT NULL, app TEXT NOT NULL, art TEXT NOT NULL,"
        " frage TEXT NOT NULL, antwort TEXT NOT NULL)"
    )
    return con


def speichern(app, art, frage, antwort):
    with _lock:
        con = db()
        con.execute(
            "INSERT INTO erfahrung (zeit, app, art, frage, antwort) VALUES (?, ?, ?, ?, ?)",
            (time.strftime("%Y-%m-%dT%H:%M:%S%z"), app[:80], art[:20], frage[:MAX_FIELD], antwort[:MAX_FIELD]),
        )
        con.commit()
        con.close()


def _kosten_lesen():
    monat = time.strftime("%Y-%m")
    try:
        with open(KOSTEN_PATH) as f:
            k = json.load(f)
        if k.get("monat") == monat:
            return k
    except (OSError, ValueError):
        pass
    return {"monat": monat, "usd": 0.0}


def _kosten_dazu(usd):
    with _lock:
        k = _kosten_lesen()
        k["usd"] = round(k["usd"] + usd, 6)
        with open(KOSTEN_PATH, "w") as f:
            json.dump(k, f)


def frag_claude(messages):
    """OpenAI-förmige Nachrichten an Claude, Antwort OpenAI-förmig zurück (Apps bleiben gleich)."""
    if _kosten_lesen()["usd"] >= DECKEL_USD:
        text = MUEDE
    else:
        system = "\n\n".join(str(m.get("content", "")) for m in messages if m.get("role") == "system")
        verlauf = []
        for m in messages:
            rolle = m.get("role")
            if rolle not in ("user", "assistant"):
                continue
            inhalt = str(m.get("content", ""))[:MAX_FIELD]
            if not verlauf and rolle != "user":
                continue
            if verlauf and verlauf[-1]["role"] == rolle:
                verlauf[-1]["content"] += "\n\n" + inhalt
            else:
                verlauf.append({"role": rolle, "content": inhalt})
        if not verlauf:
            verlauf = [{"role": "user", "content": "Hallo"}]
        antwort = claude.messages.create(
            model=MODELL,
            max_tokens=1024,
            system=system,
            messages=verlauf,
            output_config={"effort": "low"},
        )
        _kosten_dazu(antwort.usage.input_tokens * PREIS_EIN + antwort.usage.output_tokens * PREIS_AUS)
        if antwort.stop_reason == "refusal":
            text = "Dabei kann ich leider nicht helfen."
        else:
            text = "".join(b.text for b in antwort.content if b.type == "text")
    return {
        "object": "chat.completion",
        "model": MODELL,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "SenseEngine/1"

    def log_message(self, fmt, *args):
        pass  # keine Inhalte ins Systemprotokoll

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Nova-App")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        return self.headers.get("Authorization", "") == "Bearer " + API_KEY

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            return None

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            return self._send(200, {"ok": True})
        if url.path != "/erfahrung":
            return self._send(404, {"error": "unbekannt"})
        if not self._authorized():
            return self._send(401, {"error": "Passwort fehlt oder stimmt nicht"})
        q = parse_qs(url.query)
        n = max(1, min(int((q.get("n") or ["50"])[0] or 50), 1000))
        art = (q.get("art") or [""])[0]
        with _lock:
            con = db()
            sql = "SELECT id, zeit, app, art, frage, antwort FROM erfahrung"
            args = []
            if art:
                sql += " WHERE art = ?"
                args.append(art)
            rows = con.execute(sql + " ORDER BY id DESC LIMIT ?", args + [n]).fetchall()
            con.close()
        keys = ("id", "zeit", "app", "art", "frage", "antwort")
        return self._send(200, {"erfahrung": [dict(zip(keys, r)) for r in reversed(rows)]})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/v1/chat/completions", "/erfahrung"):
            return self._send(404, {"error": "unbekannt"})
        if not self._authorized():
            return self._send(401, {"error": "Passwort fehlt oder stimmt nicht"})
        data = self._body()
        if not isinstance(data, dict):
            return self._send(400, {"error": "kein gültiges JSON"})

        if path == "/erfahrung":
            speichern(str(data.get("app", "")), str(data.get("art", "notiz")),
                      str(data.get("frage", "")), str(data.get("antwort", "")))
            return self._send(201, {"ok": True})

        app = (self.headers.get("X-Nova-App") or "DR Lab")[:80]
        messages = [m for m in data.get("messages", []) if isinstance(m, dict)]
        if not any(m.get("role") == "system" for m in messages):
            messages.insert(0, {"role": "system", "content": SOUL.format(app=app)})
        frage = next((str(m.get("content", "")) for m in reversed(messages) if m.get("role") == "user"), "")
        try:
            antwort = frag_claude(messages)
        except anthropic.APIStatusError as e:
            return self._send(502, {"error": "Fia meldet Fehler %d" % e.status_code})
        except anthropic.APIConnectionError:
            return self._send(502, {"error": "Fia ist nicht erreichbar"})
        try:
            text = antwort["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            text = ""
        speichern(app, "gespraech", frage, text)
        return self._send(200, antwort)


if __name__ == "__main__":
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db().close()
    ThreadingHTTPServer(("127.0.0.1", 8650), Handler).serve_forever()
