/* ==========================================================================
   Aria, die KI-Gesangslehrerin: Chat (auch per Sprache), Tagesplan,
   eigene Lektionen nach Mass, Fortschritt
   ========================================================================== */
const CHAT_STORE = "stimmraum-chat", PLAN_STORE = "stimmraum-plan";
let chatSeed = null, chatBusy = false;
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/* ---------- Was Aria über dich weiss ---------- */
function ariaContext() {
  const kid = S.mode === "kids", course = kid ? "kids" : "adult";
  const p = profFor(course), r = rangeOf(p);
  const list = allLessons(course), nl = nextLesson(course);
  const recent = S.hist.filter(x => x.m === course).slice(-12).map(x => `${x.d} · ${x.l} / ${x.ex}: ${x.sc} Punkte. ${x.s}`).join("\n");
  const rs = S.ranges.filter(x => x.who === course);
  return [
    `Modus: ${kid ? `Kinderkurs, ein Elternteil singt mit seinem Kind${S.prof.kids.name ? " (das Kind heisst " + S.prof.kids.name + ")" : ""}` : "Erwachsenenkurs"}`,
    `Stimmlage: ${VOICES[p.voice].label}, Tonumfang ${noteName(r.low)} bis ${noteName(r.high)}${p.low == null ? " (Standardwert, noch nicht gemessen)" : " (gemessen)"}${rs.length > 1 ? `, erste Messung war ${noteName(rs[0].lo)} bis ${noteName(rs[0].hi)}` : ""}`,
    `Kurs: ${list.filter(l => S.done[l.id]).length} von ${list.length} Lektionen erledigt. Nächste Lektion: ${nl ? `«${nl.title}» (${nl.goal})` : "Kurs abgeschlossen"}`,
    `Lektionen im Kurs: ${list.map((l, i) => `${i + 1}. ${l.title}${S.done[l.id] != null ? " (" + S.done[l.id] + " Punkte)" : ""}`).join("; ")}`,
    `Stilrichtungen in der App: ${COURSES.styles.stages.map(s => s.title).join(", ")}`,
    `Übungstage insgesamt: ${S.days.length}, Serie: ${streak()} Tage in Folge. Heute ist ${new Date().toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`,
    S.custom.length ? `Lektionen, die du (Aria) schon erstellt hast: ${S.custom.map(l => "«" + l.title + "»").join(", ")}` : "",
    recent ? "Letzte Übungsergebnisse (Tonhöhen-Messung der App):\n" + recent : "Noch keine gemessenen Übungsergebnisse."
  ].filter(Boolean).join("\n");
}

function ariaSystem({ short = false, lesson = false } = {}) {
  const kid = S.mode === "kids";
  return `Du bist Aria, eine erfahrene, warmherzige und humorvolle Gesangslehrerin in der Übungs-App «Stimmraum». Du unterrichtest klassische Stimmbildung, Pop, Musical, Jazz, Rock, Soul und Volkslied.
Sprache: Deutsch in Schweizer Schreibweise (immer «ss», nie «ß»), du duzt. Deine Antworten werden oft laut vorgelesen: schreibe gesprochen, klar und ${short ? "knapp" : "kurz (meist 2 bis 7 Sätze)"}, keine Überschriften, kein Fettdruck, höchstens einfache Listen mit «- ».
Du kannst die Stimme nicht direkt hören. Die App misst aber die Tonhöhe beim Singen und schickt dir die Ergebnisse. Nutze sie und frage nach, wie es sich angefühlt hat.
Gesundheit: Bei Schmerzen, Heiserkeit über zwei Wochen oder Stimmverlust empfiehlst du eine HNO-Ärztin oder Logopädin. Keine Diagnosen. Nie gegen Schmerz ansingen.
${kid ? `Gerade ist der Kindermodus aktiv. Oft spricht das Kind selbst mit dir. Sei spielerisch, ermutigend und bildhaft (Tiere, Geschichten, Fantasie), mit kurzen, einfachen Sätzen. Keine Fachbegriffe ohne Bild. Übungen für Kinder sind kurz, leise bis mittellaut und höchstens 8 Minuten lang.\n` : ""}
Was du über die Person weisst:
${ariaContext()}
${lesson ? `
Lektionen erstellen: Wenn jemand eine Übung, ein Training, ein Einsingen, ein Lied-Coaching oder einen Plan zum Mitsingen möchte (oder es klar hilft), baust du eine Lektion, die die App sofort abspielt und mit dem Mikrofon auswertet. Schreib davor ein bis zwei Sätze, was die Lektion bringt. Hänge sie GANZ AM ENDE an, genau so:
${FENCE}lektion
{"title":"Kurzer Titel","goal":"Ein Satz zum Ziel","min":8,"steps":[ ... ]}
${FENCE}
Schritt-Typen (gültiges JSON, Texte auf Deutsch):
{"type":"info","title":"…","text":"Anleitung","bullets":["…"]}  Erklärung, Körperübung oder Liedtext
{"type":"breath","title":"…","text":"…","pattern":[4,2,6,0],"rounds":3}  Atmung: Sekunden ein, halten, aus, halten
{"type":"hiss","title":"…","text":"…","goal":15}  Zischen auf «sss», Ziel in Sekunden
{"type":"sustain","title":"…","text":"…","note":"3","secs":5,"syl":"mmm","dyn":false}  langen Ton halten (dyn true = leise-laut-leise)
{"type":"match","title":"…","text":"…","notes":"1 2 3 4 5 4 3 2 1:2","syl":"ma","bpm":80,"keys":[0,2]}  Tonfolge: App spielt vor, dann nachsingen
{"type":"glide","title":"…","text":"…","secs":8}  Sirene, Gleiten, Lippenflattern
{"type":"free","title":"…","text":"…","secs":120}  freies Singen mit Timer, zum Beispiel ein Lied
Noten: Stufen der Dur-Tonleiter relativ zum bequemen Grundton der Person (1 = Grundton, 8 = Oktave, bis 12). "_5" = eine Oktave tiefer, "^2" = eine Oktave höher, "b3" einen Halbton tiefer, "#4" einen Halbton höher, ":2" = zwei Schläge lang. Bleib zwischen "_5" und "10". syl: eine Silbe für alle Töne oder je Ton eine, durch Leerzeichen getrennt. keys: Wiederholungen versetzt um so viele Halbtöne (0 bis 5). bpm 50 bis 120.
Eine Lektion hat 3 bis 7 Schritte, davon mindestens zwei Singübungen (sustain, match oder glide), und baut von leicht zu schwer auf. Nutze für bekannte Lieder keine geschützten Liedtexte, sondern beschreibe die Stelle oder nimm Silben.` : ""}`;
}

/* ---------- Lektionen aus der KI-Antwort ---------- */
const STEP_TYPES = ["info", "breath", "hiss", "sustain", "match", "glide", "free"];
function sanitizeLesson(o) {
  if (!o || !Array.isArray(o.steps)) return null;
  const str = (v, n) => String(v ?? "").trim().slice(0, n);
  const num = (v, a, b, d) => { v = +v; return Number.isFinite(v) ? clamp(v, a, b) : d; };
  const okNotes = n => { try { const p = parseNotes(String(n)); return p.length > 0 && p.length <= 40 && p.every(x => Number.isFinite(x.semi) && x.semi >= -12 && x.semi <= 21 && x.beats > 0 && x.beats <= 8); } catch (e) { return false; } };
  const steps = o.steps.slice(0, 10).map(st => {
    const t = st?.type; if (!STEP_TYPES.includes(t)) return null;
    const b = { type: t, title: str(st.title, 80) || "Übung", text: str(st.text, 1200) };
    if (t === "info") { if (!b.text) return null; if (Array.isArray(st.bullets)) b.bullets = st.bullets.slice(0, 10).map(x => str(x, 240)).filter(Boolean); }
    if (t === "breath") { const pt = (Array.isArray(st.pattern) ? st.pattern : []).slice(0, 4).map(x => Math.round(num(x, 0, 12, 0))); while (pt.length < 4) pt.push(0); if (!pt[0]) pt[0] = 4; if (!pt[2]) pt[2] = 6; b.pattern = pt; b.rounds = Math.round(num(st.rounds, 1, 10, 3)); }
    if (t === "hiss") b.goal = Math.round(num(st.goal, 5, 60, 15));
    if (t === "sustain") { const n = String(st.note ?? "3").trim().split(/\s+/)[0]; if (!okNotes(n)) return null; b.note = n; b.secs = num(st.secs, 2, 15, 5); b.syl = str(st.syl || "a", 12); if (st.dyn === true) b.dyn = true; if (st.vib === true) b.vib = true; }
    if (t === "match") { if (!okNotes(st.notes)) return null; b.notes = String(st.notes).trim(); b.syl = str(st.syl || "la", 120); b.bpm = Math.round(num(st.bpm, 40, 160, 80)); if (Array.isArray(st.keys) && st.keys.length) b.keys = st.keys.slice(0, 5).map(k => Math.round(num(k, -5, 7, 0))); }
    if (t === "glide") b.secs = num(st.secs, 3, 15, 8);
    if (t === "free") b.secs = Math.round(num(st.secs, 20, 600, 120));
    return b;
  }).filter(Boolean);
  if (!steps.length) return null;
  return { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: str(o.title, 60) || "Lektion von Aria", goal: str(o.goal, 240), min: Math.round(num(o.min, 2, 45, 8)), steps, links: [], mode: S.mode, made: todayStr() };
}
function splitReply(text) {
  const i = text.indexOf(FENCE);
  if (i < 0) return { text, building: false, raw: null };
  const rest = text.slice(i + FENCE.length), j = rest.indexOf(FENCE);
  const body = (j < 0 ? rest : rest.slice(0, j)).replace(/^[a-zäöü]*\s*\n?/i, "");
  return { text: (text.slice(0, i) + (j < 0 ? "" : rest.slice(j + FENCE.length))).trim(), building: j < 0, raw: j < 0 ? null : body };
}
function lessonFromReply(text) {
  const { raw } = splitReply(text);
  if (!raw) return null;
  try { return sanitizeLesson(JSON.parse(raw)); }
  catch (e) { const m = raw.match(/\{[\s\S]*\}/); try { return m ? sanitizeLesson(JSON.parse(m[0])) : null; } catch (e2) { return null; } }
}
function saveCustom(l) {
  if (!S.custom.find(x => x.id === l.id)) { S.custom.push(l); save(); }
  return findLesson(l.id);
}
function lessonCard(l) {
  const saved = () => !!S.custom.find(x => x.id === l.id);
  const lbl = h("span", {}, saved() ? "Starten" : "Speichern und starten");
  return h("div", { class: "lesson-card" },
    coverArt({ ...l, course: "custom" }, "mini"),
    h("div", { class: "lc-body" }, h("strong", {}, l.title), h("span", { class: "muted small" }, `${l.min} Min. · ${l.steps.length} Schritte${saved() ? " · gespeichert" : ""}`)),
    h("button", { class: "btn play", onclick: () => openLesson(saveCustom(l)) }, h("span", { html: PLAY }), lbl));
}

/* ---------- Chat ---------- */
const SUGGEST = {
  adult: ["Was soll ich heute üben?", "Bau mir ein Einsingen für 10 Minuten", "Wie komme ich höher, ohne zu pressen?", "Hilf mir, ein Lied einzustudieren", "Warum kratzt es nach dem Singen?", "Erklär mir die Kopfstimme"],
  kids: ["Erzähl uns eine Sing-Geschichte", "Mach ein Singspiel für uns", "Wie singe ich wie ein Vogel?", "Ein lustiges Aufwärmspiel, bitte", "Warum ist meine Stimme manchmal kratzig?"]
};
function viewCoach() {
  const kid = S.mode === "kids", key = kid ? "kids" : "adult";
  const all = lsGet(CHAT_STORE, {}); const msgs = all[key] = Array.isArray(all[key]) ? all[key] : [];
  const persist = () => { all[key] = msgs.slice(-40); lsSet(CHAT_STORE, all); };
  const list = h("div", { class: "chat" });
  const setup = h("div", { class: "setup" });
  const q = h("textarea", { id: "chat-q", class: "input", rows: 1, placeholder: kid ? "Schreib oder sprich mit Aria …" : "Frag Aria etwas oder bitte um eine Übung …", "aria-label": "Nachricht an Aria" });
  const sendB = h("button", { class: "btn send", "aria-label": "Senden" }, "↑");
  const micB = Voice.canListen ? h("button", { class: "icon-btn mic", "aria-label": "Sprechen", title: "Sprechen", html: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>' }) : null;
  const sugg = h("div", { class: "sugg" }, ...SUGGEST[key].map(t => h("button", { class: "chip-btn", onclick: () => send(t) }, t)));
  const composer = h("div", { class: "composer" }, micB, q, sendB);

  function bubble(m) {
    if (m.role === "user") return h("div", { class: "msg me" }, h("p", {}, m.content));
    const sp = splitReply(m.content);
    const l = m.lesson || null;
    return h("div", { class: "msg ai" },
      h("div", { class: "ai-av", "aria-hidden": "true" }, "✦"),
      h("div", { class: "msg-c" }, h("p", {}, sp.text || (m.lesson ? "Hier ist deine Lektion." : m.content)),
        l ? lessonCard(l) : null,
        h("div", { class: "msg-tools" }, speakBtn(() => sp.text))));
  }
  function draw() {
    list.innerHTML = "";
    if (!msgs.length) list.append(h("div", { class: "msg ai" }, h("div", { class: "ai-av", "aria-hidden": "true" }, "✦"),
      h("div", { class: "msg-c" }, h("p", {}, kid
        ? `Hallo${S.prof.kids.name ? " " + S.prof.kids.name : ""}! Ich bin Aria, deine Sing-Freundin. Wollen wir zusammen ein Singspiel machen? Du kannst mir auch einfach etwas erzählen.`
        : "Hallo, ich bin Aria, deine Gesangslehrerin. Ich kenne deinen Kursstand und deine letzten Messwerte. Frag mich alles rund ums Singen, oder sag mir, was du üben willst, dann baue ich dir eine Lektion, die du gleich mit dem Mikrofon singen kannst."))));
    msgs.forEach(m => list.append(bubble(m)));
  }
  const autosize = () => { q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 160) + "px"; };
  q.addEventListener("input", autosize);
  q.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(q.value); } });
  sendB.onclick = () => send(q.value);
  let stopListen = null;
  if (micB) micB.onclick = () => {
    if (stopListen) { stopListen(); return; }
    Voice.stop();
    const before = q.value ? q.value.trimEnd() + " " : "";
    micB.classList.add("on");
    stopListen = Voice.listen(t => { q.value = before + t; autosize(); }, err => {
      micB.classList.remove("on"); stopListen = null;
      if (err && err !== "no-speech" && err !== "aborted") toastIn(list, err === "not-allowed" ? "Spracheingabe ist hier nicht erlaubt. Tippe die Frage ein." : "Spracheingabe hat nicht geklappt.");
      else if (q.value.trim() && !err) send(q.value);
    });
  };
  cleanup.push(() => { stopListen?.(); Voice.stop(); });

  async function send(text) {
    text = String(text || "").trim();
    if (!text || chatBusy) return;
    if (!(await AI.provider())) { setup.scrollIntoView({ behavior: "smooth" }); return; }
    Voice.stop();
    q.value = ""; autosize();
    msgs.push({ role: "user", content: text });
    draw();
    const live = h("p", {}, ""), wait = h("p", { class: "muted small typing" }, "Aria denkt nach …");
    const tmp = h("div", { class: "msg ai" }, h("div", { class: "ai-av", "aria-hidden": "true" }, "✦"), h("div", { class: "msg-c" }, live, wait));
    list.append(tmp); tmp.scrollIntoView({ block: "end", behavior: "smooth" });
    chatBusy = true; sendB.disabled = true;
    try {
      let hist = msgs.slice(-20).map(({ role, content }) => ({ role, content }));
      while (hist.length && hist[0].role !== "user") hist.shift();
      const out = await AI.ask({ system: ariaSystem({ lesson: true }), messages: hist, max: 8000, onText: t => {
        const sp = splitReply(t); live.textContent = sp.text;
        wait.textContent = sp.building ? "Aria baut deine Lektion …" : ""; wait.hidden = !sp.building;
      } });
      const m = { role: "assistant", content: out };
      const l = lessonFromReply(out); if (l) m.lesson = l;
      msgs.push(m); persist();
      if (tmp.isConnected) { tmp.replaceWith(bubble(m)); list.lastChild.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      if (AI.cfg.speak) Voice.speak(splitReply(out).text);
    } catch (e) {
      msgs.pop(); persist();
      if (tmp.isConnected) { tmp.remove(); draw(); toastIn(list, e.message); q.value = text; autosize(); }
    }
    chatBusy = false; sendB.disabled = false;
  }

  app.append(
    h("header", { class: "top" },
      h("div", {}, h("p", { class: "eyebrow" }, "Deine KI-Gesangslehrerin"), h("h1", {}, "Aria")),
      h("div", { class: "row" }, modeSwitch(), msgs.length ? h("button", { class: "link-btn", onclick: () => { msgs.length = 0; persist(); render(); } }, "Neu") : null)),
    setup, list, sugg, composer);
  draw();
  AI.provider().then(p => {
    if (p) {
      if (chatSeed) { const s0 = chatSeed; chatSeed = null; send(s0); }
      return;
    }
    composer.classList.add("off"); sugg.hidden = true;
    setup.append(aiSetupCard(true));
  });
  setTimeout(() => list.lastChild?.scrollIntoView({ block: "end" }), 0);
}
function toastIn(list, text) { list.append(h("p", { class: "notice" }, text)); list.lastChild.scrollIntoView({ block: "nearest" }); }

/* ---------- Einrichtung (Schlüssel) ---------- */
function aiSetupCard(intro) {
  const inp = h("input", { id: "ai-key", class: "input", type: "password", autocomplete: "off", spellcheck: "false", placeholder: "sk-ant-…", value: AI.cfg.key ? "••••••••••••" + AI.cfg.key.slice(-4) : "" });
  const out = h("p", { class: "muted small", "aria-live": "polite" }, "");
  const test = async () => {
    out.textContent = "Teste die Verbindung …";
    try { const t = await AI.ask({ system: "Antworte auf Deutsch in Schweizer Schreibweise, in einem kurzen Satz.", messages: [{ role: "user", content: "Sag hallo als Gesangslehrerin Aria." }], max: 1500 }); out.textContent = "Funktioniert: " + t; }
    catch (e) { out.textContent = e.message; }
  };
  const saveB = h("button", { class: "btn", onclick: () => {
    const v = inp.value.trim();
    if (!v || v.startsWith("•")) { out.textContent = "Bitte füge zuerst deinen Schlüssel ein."; return; }
    if (!/^sk-ant-/.test(v)) { out.textContent = "Das sieht nicht wie ein Anthropic-Schlüssel aus (er beginnt mit «sk-ant-»)."; return; }
    AI.cfg.key = v; AI.store(); inp.value = "••••••••••••" + v.slice(-4);
    test().then(() => { if (intro) setTimeout(render, 1600); });
  } }, "Speichern und testen");
  const delB = h("button", { class: "btn ghost", onclick: () => { AI.cfg.key = ""; AI.store(); render(); } }, "Schlüssel entfernen");
  return h("section", { class: "card form ai-setup" },
    h("h2", { class: "h3" }, intro ? "Aria freischalten" : "KI-Gesangslehrerin"),
    intro ? h("p", {}, "Aria gibt dir persönliches Feedback zu deinen Übungen, baut dir Lektionen nach Mass, plant deinen Übungstag und beantwortet jede Frage, auch per Sprache.") : null,
    h("ol", { class: "rules small" },
      h("li", {}, "Öffne ", h("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener" }, "console.anthropic.com"), ", erstelle ein Konto und lade ein kleines Guthaben (ab 5 Dollar)."),
      h("li", {}, "Unter «API Keys» auf «Create Key» tippen und den Schlüssel kopieren."),
      h("li", {}, "Hier einfügen und speichern.")),
    h("label", { class: "lbl", for: "ai-key" }, "Anthropic-Schlüssel"), inp,
    h("div", { class: "row" }, saveB, AI.cfg.key ? h("button", { class: "btn ghost", onclick: test }, "Testen") : null, AI.cfg.key ? delB : null),
    out,
    h("p", { class: "muted small" }, "Der Schlüssel bleibt nur auf diesem Gerät gespeichert und geht direkt an Anthropic. Eine Frage kostet meist weniger als ein paar Rappen. Tipp: Setze in der Console ein Monatslimit. Für ein zweites Handy trägst du dort denselben oder einen eigenen Schlüssel ein."));
}

/* ---------- Startseite: Aria und Tagesplan ---------- */
function ariaHome(course) {
  const box = h("section", { class: "aria-card" });
  AI.provider().then(p => {
    box.append(h("div", { class: "aria-head" }, h("div", { class: "ai-av big", "aria-hidden": "true" }, "✦"),
      h("div", {}, h("p", { class: "eyebrow" }, "KI-Gesangslehrerin"), h("h2", { class: "h3" }, course === "kids" ? "Aria, eure Sing-Freundin" : "Aria"))));
    if (!p) {
      box.append(h("p", {}, "Persönliches Feedback, Lektionen nach Mass und Antworten auf alles rund ums Singen, auch per Sprache."),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => go("coach") }, "Aria einrichten")));
      return;
    }
    const plans = lsGet(PLAN_STORE, {}), cached = plans[course]?.d === todayStr() ? plans[course].text : "";
    const out = h("div", { class: "ai-out plan" }, cached);
    const b = h("button", { class: "btn" }, cached ? "Neuer Plan" : "Mein Plan für heute");
    b.onclick = async () => {
      b.disabled = true; out.textContent = "Aria plant deinen Tag …";
      try {
        const t = await AI.ask({ system: ariaSystem({ short: true }), max: 3000, onText: x => out.textContent = x,
          messages: [{ role: "user", content: `Erstelle ${course === "kids" ? "unseren" : "meinen"} Übungsplan für heute. Zuerst ein kurzer, persönlicher Satz zur Motivation, dann 3 bis 5 Zeilen, jede beginnt mit «- » und nennt einen konkreten Punkt aus der App mit Minutenangabe, insgesamt ${course === "kids" ? "8 bis 12" : "12 bis 20"} Minuten. Baue die nächste Lektion ein und stütze dich auf die letzten Ergebnisse. Sonst nichts.` }] });
        out.textContent = t; plans[course] = { d: todayStr(), text: t }; lsSet(PLAN_STORE, plans);
        b.textContent = "Neuer Plan";
        if (AI.cfg.speak) Voice.speak(t);
      } catch (e) { out.textContent = e.message; }
      b.disabled = false;
    };
    box.append(out, h("div", { class: "row" }, b, h("button", { class: "btn ghost", onclick: () => go("coach") }, "Mit Aria reden"), speakBtn(() => out.textContent)));
  });
  return box;
}

/* ---------- Fortschritt ---------- */
function progressCard(course) {
  const hs = S.hist.filter(x => x.m === course && Number.isFinite(x.sc));
  const by = {}; hs.forEach(x => (by[x.d] = by[x.d] || []).push(x.sc));
  const days = Object.keys(by).sort().slice(-21);
  const rs = S.ranges.filter(x => x.who === course);
  if (days.length < 2 && rs.length < 2) return null;
  const parts = [];
  if (days.length >= 2) {
    const pts = days.map(d => Math.round(mean(by[d])));
    const W = 320, H = 96, P = 8, X = i => P + i * (W - 2 * P) / (days.length - 1), Y = v => H - P - v / 100 * (H - 2 * P);
    const line = pts.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
    const svg = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Punkte pro Übungstag"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="${line} L${X(days.length - 1)} ${H} L${X(0)} ${H} Z" fill="url(#sg)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${pts.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="var(--accent)"/>`).join("")}</svg>`;
    const d = pts[pts.length - 1] - pts[0];
    const fd = s => new Date(s + "T12:00").toLocaleDateString("de-CH", { day: "numeric", month: "short" });
    parts.push(h("div", { html: svg }), h("p", { class: "muted small" }, `Durchschnittliche Punkte pro Übungstag, zuletzt ${pts[pts.length - 1]}. ${d > 0 ? `Plus ${d} seit dem ${fd(days[0])}.` : d < 0 ? `Seit dem ${fd(days[0])} ${-d} weniger, dranbleiben.` : "Stabil."}`));
  }
  if (rs.length >= 2) {
    const a = rs[0], b = rs[rs.length - 1], gain = (b.hi - b.lo) - (a.hi - a.lo);
    parts.push(h("p", { class: "small" }, `Tonumfang: anfangs ${nn(a.lo)} bis ${nn(a.hi)}, jetzt ${nn(b.lo)} bis ${nn(b.hi)}${gain > 0 ? `, ${gain} Halbtöne mehr` : ""}.`));
  }
  return h("section", { class: "card progress" }, h("div", { class: "shelf-head" }, h("h2", { class: "h3" }, "Fortschritt"), h("span", { class: "muted small" }, `${days.length} Tage gemessen`)), ...parts);
}
