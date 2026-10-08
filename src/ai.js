/* ==========================================================================
   KI: Claude als Gesangslehrerin «Aria». Zwei Wege:
   1. im Claude-Viewer über window.claude ("sample"), ohne Schlüssel
   2. auf der eigenen Website mit dem eigenen Anthropic-Schlüssel,
      der nur im Browser dieses Geräts gespeichert wird
   ========================================================================== */
const AI_STORE = "stimmraum-ai";
const AI_MODELS = {
  "claude-opus-5-5": "Opus 5.5 (beste Qualität)",
  "claude-sonnet-5-5": "Sonnet 5.5 (schneller, günstiger)",
  "claude-haiku-5-5": "Haiku 5.5 (am schnellsten, am günstigsten)"
};
const FENCE = "```";

const AI = {
  cfg: { key: "", model: "claude-opus-5-5", speak: false },
  sample: undefined,
  load() { try { Object.assign(this.cfg, JSON.parse(localStorage.getItem(AI_STORE) || "{}")); } catch (e) {} },
  store() { try { localStorage.setItem(AI_STORE, JSON.stringify(this.cfg)); } catch (e) {} },
  async provider() {
    if (this.cfg.key) return "key";
    if (this.sample === undefined) {
      try { this.sample = window.claude?.use ? await window.claude.use("sample") : null; } catch (e) { this.sample = null; }
    }
    return this.sample ? "sample" : null;
  },
  /* system: Text, messages: [{role, content}], onText: laufend der bisherige Text */
  async ask({ system, messages, max = 4000, onText, effort = "low" }) {
    const p = await this.provider();
    if (!p) throw aiErr("no_ai", "Die KI ist noch nicht eingerichtet. Trage im Profil deinen Schlüssel ein.");
    if (p === "sample") {
      const convo = messages.map(m => (m.role === "user" ? "Schülerin/Schüler: " : "Aria: ") + m.content).join("\n\n");
      const prompt = `${system}\n\n---\n${messages.length > 1 ? "Bisheriges Gespräch:\n" + convo + "\n\nAntworte jetzt als Aria auf die letzte Nachricht." : messages[0].content}`;
      let text = "";
      try {
        const res = await this.sample(prompt, { onText: ({ text: t }) => { text = t; onText?.(t); }, cache: false });
        if (!text && typeof res === "string") text = res;
        if (!text && res?.text) text = res.text;
      } catch (e) {
        throw aiErr(e.code, e.code === "not_granted" ? "Die KI ist im Claude-Viewer nicht freigegeben." : e.code === "rate_limited" ? "Gerade zu viele Anfragen. Versuche es gleich noch einmal." : "Das hat nicht geklappt. Versuche es noch einmal.");
      }
      return text;
    }
    return this.direct({ system, messages, max, onText, effort }, true);
  },
  async direct({ system, messages, max, onText, effort }, withFallback) {
    const model = this.cfg.model in AI_MODELS ? this.cfg.model : "claude-opus-5-5";
    const body = { model, max_tokens: max, system, messages, stream: true };
    if (model !== "claude-haiku-5-5") body.output_config = { effort };
    const headers = {
      "content-type": "application/json",
      "x-api-key": this.cfg.key.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };
    if (withFallback && model === "claude-opus-5-5") { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; body.fallbacks = "default"; }
    let res;
    try { res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) }); }
    catch (e) { throw aiErr("network", "Keine Verbindung zur KI. Bist du online?"); }
    if (!res.ok) {
      let msg = ""; try { msg = (await res.json())?.error?.message || ""; } catch (e) {}
      if (res.status === 400 && withFallback && /fallback|beta/i.test(msg)) return this.direct({ system, messages, max, onText, effort }, false);
      throw aiErr("http_" + res.status,
        res.status === 401 ? "Der Schlüssel wird nicht akzeptiert. Prüfe ihn im Profil." :
        res.status === 403 ? "Dieser Schlüssel darf das nicht. Prüfe die Berechtigungen in der Anthropic Console." :
        res.status === 429 ? "Gerade zu viele Anfragen. Warte einen Moment." :
        res.status === 529 || res.status >= 500 ? "Die KI ist gerade überlastet. Versuche es gleich noch einmal." :
        /credit|balance/i.test(msg) ? "Dein Guthaben bei Anthropic ist aufgebraucht. Lade es in der Console auf." :
        "Die KI hat die Anfrage abgelehnt" + (msg ? ": " + msg : "."));
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", text = "", stop = null;
    const handle = chunk => {
      const data = chunk.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
      if (!data) return;
      let ev; try { ev = JSON.parse(data); } catch (e) { return; }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { text += ev.delta.text; onText?.(text); }
      else if (ev.type === "message_delta") stop = ev.delta?.stop_reason || stop;
      else if (ev.type === "error") throw aiErr(ev.error?.type || "stream", ev.error?.type === "overloaded_error" ? "Die KI ist gerade überlastet. Versuche es gleich noch einmal." : "Die Antwort wurde unterbrochen.");
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
    if (buf.trim()) handle(buf);
    if (stop === "refusal" && !text) throw aiErr("refusal", "Dazu kann ich leider nichts sagen.");
    if (!text) throw aiErr("empty", "Die KI hat keine Antwort geschickt. Versuche es noch einmal.");
    return text;
  }
};
function aiErr(code, message) { const e = new Error(message); e.code = code; return e; }
AI.load();

/* ---------- Sprache: Vorlesen und Diktieren ---------- */
const Voice = {
  canSpeak: "speechSynthesis" in window,
  canListen: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  current: null,
  clean(t) { return t.replace(new RegExp(FENCE + "[\\s\\S]*?(" + FENCE + "|$)", "g"), "").replace(/[*#_`>]/g, "").replace(/^- /gm, "").replace(/«|»/g, "").trim(); },
  speak(text, onEnd) {
    if (!this.canSpeak) return;
    this.stop();
    const u = new SpeechSynthesisUtterance(this.clean(text));
    const vs = speechSynthesis.getVoices();
    const v = vs.find(x => /^de[-_]CH/i.test(x.lang)) || vs.find(x => /^de/i.test(x.lang) && /female|anna|petra|helena|katja|google/i.test(x.name)) || vs.find(x => /^de/i.test(x.lang));
    if (v) u.voice = v;
    u.lang = v?.lang || "de-DE";
    u.rate = document.body.dataset.mode === "kids" ? 0.95 : 1.02;
    u.onend = u.onerror = () => { if (this.current === u) this.current = null; onEnd?.(); };
    this.current = u;
    speechSynthesis.speak(u);
  },
  stop() { if (this.canSpeak) { this.current = null; speechSynthesis.cancel(); } },
  listen(onText, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = "de-CH"; r.interimResults = true; r.continuous = false;
    let ended = false;
    const end = err => { if (ended) return; ended = true; onEnd?.(err); };
    r.onresult = e => onText([...e.results].map(x => x[0].transcript).join(""));
    r.onerror = e => end(e.error);
    r.onend = () => end();
    try { r.start(); } catch (e) { end("start"); }
    return () => { try { r.stop(); } catch (e) {} };
  }
};
if (Voice.canSpeak) try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch (e) {}

/* Lautsprecher-Knopf, liest getText() vor oder stoppt */
const SPK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
function speakBtn(getText, label = "Vorlesen") {
  if (!Voice.canSpeak) return null;
  const b = h("button", { class: "icon-btn spk", "aria-label": label, title: label, html: SPK });
  b.onclick = () => {
    if (b.classList.contains("on")) { Voice.stop(); b.classList.remove("on"); return; }
    document.querySelectorAll(".spk.on").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    Voice.speak(getText(), () => b.classList.remove("on"));
  };
  return b;
}
