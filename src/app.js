/* ==========================================================================
   App: Zustand, Navigation, Lektions-Player, Werkzeuge
   ========================================================================== */

const VOICES = {
  tm: { label: "Tiefe Männerstimme (Bass/Bariton)", low: 40, high: 62 },
  hm: { label: "Hohe Männerstimme (Tenor)", low: 45, high: 67 },
  tf: { label: "Tiefe Frauenstimme (Alt/Mezzo)", low: 53, high: 74 },
  hf: { label: "Hohe Frauenstimme (Sopran)", low: 57, high: 79 },
  kid: { label: "Kinderstimme", low: 57, high: 74 }
};

/* ---------- Speicher (lokal, mit Absicherung) ---------- */
const STORE_KEY = "stimmraum-v1";
const defaults = () => ({
  mode: "adult",
  prof: { adult: { voice: "tm", low: null, high: null }, kids: { voice: "kid", low: null, high: null, name: "" } },
  done: {}, days: [], guide: false, sol: false, unlock: false, ranges: []
});
let S = defaults();
try { const raw = localStorage.getItem(STORE_KEY); if (raw) S = Object.assign(defaults(), JSON.parse(raw)); } catch (e) {}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }

const profFor = course => course === "kids" ? S.prof.kids : S.prof.adult;
function rangeOf(p) { const v = VOICES[p.voice]; return { low: p.low ?? v.low, high: p.high ?? v.high }; }
function rootOf(p) { const r = rangeOf(p); return r.low + (p.voice === "kid" ? 3 : 5); }
const nn = m => noteName(m, S.sol);

const todayStr = () => new Date().toISOString().slice(0, 10);
function markDay() { const t = todayStr(); if (!S.days.includes(t)) { S.days.push(t); save(); } }
function streak() {
  const set = new Set(S.days); let n = 0; const d = new Date();
  if (!set.has(todayStr())) d.setDate(d.getDate() - 1);
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------- Kursstruktur ---------- */
function allLessons(course) { return COURSES[course].stages.flatMap((st, si) => st.lessons.map(l => ({ ...l, stage: si, course }))); }
function findLesson(id) { for (const c of Object.keys(COURSES)) { const l = allLessons(c).find(x => x.id === id); if (l) return l; } }
function isUnlocked(l) {
  if (S.unlock || l.course === "styles") return true;
  const list = allLessons(l.course), i = list.findIndex(x => x.id === l.id);
  return i === 0 || !!S.done[list[i - 1].id];
}
function nextLesson(course) { return allLessons(course).find(l => !S.done[l.id]) || null; }
const stars = sc => sc >= 85 ? 3 : sc >= 70 ? 2 : sc >= 1 ? 1 : 0;

/* ---------- DOM-Helfer ---------- */
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("aria-")) { el.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
const starRow = n => h("span", { class: "stars", "aria-label": n + " von 3 Sternen" }, ...[1, 2, 3].map(i => h("span", { class: i <= n ? "on" : "" }, "★")));

/* ---------- Mikrofon-Status ---------- */
const Mic = {
  async ensure() {
    if (Engine.live === true) return true;
    if (Engine.live === false) return false;
    return await Engine.startMic();
  },
  /* Aufnahme über die Handy-Aufnahme-App */
  pickRecording() {
    return new Promise(res => {
      const inp = h("input", { type: "file", accept: "audio/*", capture: "user", style: "position:fixed;left:-9999px" });
      inp.addEventListener("change", () => { res(inp.files[0] || null); inp.remove(); });
      document.body.append(inp); inp.click();
    });
  }
};

/* ==========================================================================
   Navigation
   ========================================================================== */
const app = $("#app");
let view = "heute", cleanup = [];
function runCleanup() { cleanup.forEach(f => { try { f(); } catch (e) {} }); cleanup = []; }

function setMode(m) { S.mode = m; save(); document.body.dataset.mode = m === "kids" ? "kids" : "adult"; render(); }
function go(v) { runCleanup(); view = v; render(); window.scrollTo(0, 0); }

function render() {
  runCleanup();
  document.body.dataset.mode = S.mode === "kids" ? "kids" : "adult";
  document.querySelectorAll(".tabbar button").forEach(b => b.setAttribute("aria-current", b.dataset.v === view ? "page" : "false"));
  app.innerHTML = "";
  ({ heute: viewHome, kurs: viewCourse, werkzeuge: viewTools, wissen: viewKnow, profil: viewSettings })[view]();
}

document.querySelectorAll(".tabbar button").forEach(b => b.addEventListener("click", () => go(b.dataset.v)));

/* ---------- Startseite ---------- */
function modeSwitch() {
  return h("div", { class: "seg", role: "tablist", "aria-label": "Kurs wählen" },
    h("button", { role: "tab", "aria-selected": S.mode === "adult", onclick: () => setMode("adult") }, "Erwachsene"),
    h("button", { role: "tab", "aria-selected": S.mode === "kids", onclick: () => setMode("kids") }, "Kinder"));
}

/* ---------- Cover-Art: jede Stufe hat ihr eigenes Farbcover ---------- */
const PALS = [
  ["#ff375f", "#ff9f0a"], ["#5e5ce6", "#bf5af2"], ["#0a84ff", "#30d158"], ["#ff2d92", "#5e5ce6"],
  ["#ff9f0a", "#ffd60a"], ["#bf5af2", "#ff375f"], ["#30d158", "#64d2ff"], ["#ff453a", "#bf5af2"],
  ["#64d2ff", "#5e5ce6"], ["#ffd60a", "#ff375f"], ["#32d74b", "#0a84ff"], ["#ff6482", "#ffb340"]
];
const WAVE = '<svg class="cover-wave" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30 Q 12.5 4 25 30 T 50 30 T 75 30 T 100 30 T 125 30 T 150 30 T 175 30 T 200 30" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3"/><path d="M0 34 Q 16 14 33 34 T 66 34 T 100 34 T 133 34 T 166 34 T 200 34" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2"/></svg>';
function palFor(l) {
  const off = l.course === "kids" ? 3 : l.course === "styles" ? 6 : l.course === "warm" ? 9 : 0;
  return PALS[(off + (l.stage || 0)) % PALS.length];
}
function coverArt(l, cls = "") {
  const [a, b] = palFor(l);
  const st = COURSES[l.course]?.stages[l.stage];
  const label = l.course === "styles" ? (st?.title || "") : l.course === "warm" ? "Aufwärmen" : "Stufe " + ((l.stage || 0) + 1);
  return h("div", { class: "cover " + cls, style: `--c1:${a};--c2:${b}` },
    h("span", { class: "cover-k" }, label),
    h("span", { class: "cover-t" }, l.title),
    h("span", { html: WAVE }));
}
const PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor"/></svg>';
const playBtn = (label, fn, cls = "") => h("button", { class: "btn play " + cls, onclick: fn }, h("span", { html: PLAY }), label);

function shelf(title, items, more) {
  return h("section", { class: "shelf" },
    h("div", { class: "shelf-head" }, h("h2", { class: "h3" }, title), more || null),
    h("div", { class: "shelf-row" }, ...items));
}
function tile(l) {
  const ok = isUnlocked(l), sc = S.done[l.id];
  return h("button", { class: "tile" + (ok ? "" : " locked"), disabled: !ok, onclick: () => openLesson(l), "aria-label": l.title + (ok ? "" : " (gesperrt)") },
    coverArt(l),
    h("span", { class: "tile-t" }, l.title),
    h("span", { class: "tile-m" }, sc != null ? starRow(stars(sc)) : ok ? `${l.min} Min. · ${l.steps.length} Schritte` : "Gesperrt"));
}

function viewHome() {
  const course = S.mode === "kids" ? "kids" : "adult";
  const nl = nextLesson(course), list = allLessons(course);
  const doneN = list.filter(l => S.done[l.id]).length;
  const d = new Date(), tip = TIPS_DAILY[(d.getDate() + d.getMonth()) % TIPS_DAILY.length];
  const kidName = S.prof.kids.name;
  const startI = nl ? list.findIndex(l => l.id === nl.id) : 0;
  const upcoming = list.slice(Math.max(0, startI - 1), startI + 8);
  const r = rangeOf(profFor(course));

  app.append(
    h("header", { class: "top" },
      h("div", {}, h("p", { class: "eyebrow" }, d.toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long" })),
        h("h1", {}, course === "kids" ? (kidName ? `Singzeit mit ${kidName}` : "Singzeit") : "Heute")),
      modeSwitch()),
    nl ? lessonHero(nl) : h("section", { class: "feature done" },
      coverArt({ ...list[list.length - 1] }, "big"),
      h("div", { class: "feature-body" },
        h("p", { class: "eyebrow" }, "Kurs abgeschlossen"),
        h("h2", {}, course === "kids" ? "Urkunde: Kleine Sängerin, kleiner Sänger" : "Alle Lektionen geschafft"),
        h("p", { class: "muted" }, course === "kids" ? "Ihr habt alle zwölf Singspiele gemeistert. Bravo!" : "Wiederhole Lektionen mit weniger als drei Sternen oder probiere die Stilrichtungen aus."),
        h("div", { class: "row" }, playBtn("Zum Kurs", () => go("kurs"))))),
    h("section", { class: "stats" },
      stat(streak(), streak() === 1 ? "Tag in Folge" : "Tage in Folge"),
      stat(doneN + "/" + list.length, "Lektionen"),
      stat(nn(r.low) + "–" + nn(r.high), "Tonumfang")),
    shelf(course === "kids" ? "Eure Singspiele" : "Dein Weg", upcoming.map(tile), h("button", { class: "link-btn", onclick: () => go("kurs") }, "Alle")),
    h("section", { class: "shelf" },
      h("div", { class: "shelf-head" }, h("h2", { class: "h3" }, "Schnell üben")),
      h("div", { class: "quick-grid" },
        quick("Einsingen", "5 Minuten", 9, () => openLesson(warmupLesson(course))),
        quick("Stimmgerät", "Ton live sehen", 1, () => { go("werkzeuge"); setTimeout(() => openTool("tuner"), 0); }),
        quick("Töne treffen", "10 Runden", 4, () => { go("werkzeuge"); setTimeout(() => openTool("ear"), 0); }),
        quick("Atmen", "Atem-Trainer", 6, () => { go("werkzeuge"); setTimeout(() => openTool("breath"), 0); }))),
    course === "adult" ? shelf("Stilrichtungen", allLessons("styles").filter((l, i, a) => a.findIndex(x => x.stage === l.stage) === i).map(tile)) : null,
    h("aside", { class: "tip" }, h("p", { class: "eyebrow" }, "Tipp des Tages"), h("p", {}, tip))
  );
}
const stat = (v, l) => h("div", { class: "stat" }, h("strong", {}, String(v)), h("span", {}, l));
const quick = (t, s, pi, fn) => { const [a, b] = PALS[pi % PALS.length]; return h("button", { class: "quick-btn", style: `--c1:${a};--c2:${b}`, onclick: fn }, h("strong", {}, t), h("span", {}, s)); };

function lessonHero(l) {
  const st = COURSES[l.course].stages[l.stage];
  const [a, b] = palFor(l);
  return h("section", { class: "feature", style: `--c1:${a};--c2:${b}` },
    coverArt(l, "big"),
    h("div", { class: "feature-body" },
      h("p", { class: "eyebrow" }, `Als Nächstes · ${l.course === "styles" ? st.title : "Stufe " + (l.stage + 1) + ": " + st.title}`),
      h("h2", {}, l.title),
      h("p", { class: "muted" }, l.goal),
      h("div", { class: "row" },
        playBtn("Lektion starten", () => openLesson(l), "big"),
        h("span", { class: "meta" }, `${l.min} Min. · ${l.steps.length} Schritte`))));
}

function warmupLesson(course) {
  if (course === "kids") return { id: "warm-k", course: "warm", title: "Einsingen für Kinder", min: 4, goal: "Stimme aufwecken", stage: 0,
    steps: [{ type: "glide", title: "Sirene", text: "Rauf und runter mit «uuu».", secs: 5 }, { type: "match", title: "Treppe", notes: "1 2 3 4 5:2 5 4 3 2 1:2", syl: "la", bpm: 80 }], links: [] };
  return { id: "warm-a", course: "warm", title: "Einsingen", min: 5, goal: "Stimme und Atem aufwärmen", stage: 0,
    steps: [
      { type: "breath", title: "Ankommen", pattern: [4, 1, 6, 0], rounds: 2 },
      { type: "glide", title: "Lippenflattern", text: "Auf «brrr» von tief nach hoch und zurück.", secs: 8 },
      { type: "match", title: "Summen", notes: "1 2 3 4 5 4 3 2 1:2", syl: "mmm", bpm: 88, keys: [0, 1, 2] },
      { type: "match", title: "Dreiklang", notes: "1 3 5 8 5 3 1:2", syl: "ni", bpm: 92, keys: [0, 2] }], links: [] };
}

/* ---------- Kursübersicht ---------- */
let courseTab = null;
function viewCourse() {
  courseTab = courseTab || (S.mode === "kids" ? "kids" : "adult");
  const c = COURSES[courseTab];
  const list = allLessons(courseTab), doneN = list.filter(l => S.done[l.id]).length;
  app.append(
    h("header", { class: "top" }, h("div", {}, h("p", { class: "eyebrow" }, `${doneN} von ${list.length} erledigt`), h("h1", {}, "Kurs"))),
    h("div", { class: "seg three", role: "tablist" },
      ...["adult", "kids", "styles"].map(k => h("button", { role: "tab", "aria-selected": courseTab === k, onclick: () => { courseTab = k; render(); } }, COURSES[k].name))),
    h("p", { class: "lead" }, c.blurb),
    ...c.stages.map((st, si) => h("section", { class: "shelf" },
      h("div", { class: "shelf-head col" },
        h("p", { class: "eyebrow" }, courseTab === "styles" ? "Stil" : "Stufe " + (si + 1)),
        h("h2", { class: "h3" }, st.title),
        h("p", { class: "muted small" }, st.intro)),
      h("div", { class: "shelf-row" }, ...st.lessons.map(l0 => tile({ ...l0, stage: si, course: courseTab })))))
  );
}

/* ==========================================================================
   Lektions-Player
   ========================================================================== */
let player = null;
function openLesson(l) {
  runCleanup();
  const [c1, c2] = palFor(l);
  const ov = h("div", { class: "player", role: "dialog", "aria-modal": "true", "aria-label": l.title, style: `--c1:${c1};--c2:${c2}` });
  document.body.append(ov); document.body.classList.add("noscroll");
  let wake = null; try { navigator.wakeLock?.request("screen").then(w => wake = w).catch(() => {}); } catch (e) {}
  player = { l, i: 0, scores: {}, ov, close() { stopAll(); ov.remove(); document.body.classList.remove("noscroll"); try { wake?.release(); } catch (e) {} player = null; render(); } };
  showStep();
}
let stepCleanup = [];
function stopAll() { stepCleanup.forEach(f => { try { f(); } catch (e) {} }); stepCleanup = []; }

function showStep() {
  stopAll();
  const { l, i, ov } = player, step = l.steps[i];
  ov.innerHTML = "";
  const prof = profFor(l.course === "kids" || l.id === "warm-k" ? "kids" : "adult");
  const body = h("div", { class: "p-body" });
  ov.append(
    h("div", { class: "p-top" },
      h("button", { class: "icon-btn", "aria-label": "Lektion schliessen", onclick: () => player.close() }, "✕"),
      h("div", { class: "p-prog" }, ...l.steps.map((_, k) => h("span", { class: k < i ? "done" : k === i ? "cur" : "" }))),
      h("span", { class: "p-count" }, `${i + 1}/${l.steps.length}`)),
    h("div", { class: "p-scroll" },
      h("div", { class: "now" }, coverArt(l, "mini"), h("div", {}, h("p", { class: "eyebrow" }, "Lektion"), h("p", { class: "now-t" }, l.title))),
      h("h2", {}, step.title || ""),
      step.text && step.type !== "info" ? h("p", { class: "p-text" }, step.text) : null,
      body)
  );
  const next = (score) => {
    if (score != null) player.scores[i] = score;
    if (player.i < l.steps.length - 1) { player.i++; showStep(); } else finishLesson();
  };
  STEP_RENDER[step.type](step, body, next, prof);
}

function finishLesson() {
  stopAll();
  const { l, ov, scores } = player;
  const vals = Object.values(scores);
  const sc = vals.length ? Math.round(mean(vals)) : 100;
  markDay();
  if (l.course !== "warm") { S.done[l.id] = Math.max(S.done[l.id] ?? 0, sc); save(); }
  const nl = l.course !== "warm" ? nextLesson(l.course) : null;
  ov.innerHTML = "";
  ov.append(h("div", { class: "p-scroll finish" },
    h("p", { class: "eyebrow" }, "Geschafft"),
    h("h2", {}, l.title),
    h("div", { class: "big-stars" }, starRow(stars(sc))),
    h("p", { class: "p-text" }, vals.length ? `Durchschnitt deiner Übungen: ${sc} von 100 Punkten.` : "Diese Lektion hatte keine bewerteten Übungen."),
    h("p", { class: "muted" }, sc >= 70 ? "Sehr gut. Morgen geht es weiter." : "Wiederhole die Lektion gerne morgen noch einmal, bevor du weitergehst. Freigeschaltet ist die nächste trotzdem."),
    l.links?.length ? h("div", { class: "links" }, h("h3", { class: "h3" }, "Zum Weiterlernen"),
      h("ul", {}, ...l.links.map(([t, u]) => h("li", {}, h("a", { href: u, target: "_blank", rel: "noopener" }, t))))) : null,
    h("div", { class: "row" },
      nl && isUnlocked(nl) ? h("button", { class: "btn", onclick: () => { player.close(); openLesson(nl); } }, "Nächste Lektion") : null,
      h("button", { class: "btn ghost", onclick: () => player.close() }, "Fertig"))));
}

/* ---------- Schritt-Typen ---------- */
const STEP_RENDER = {
  info(step, body, next) {
    body.append(
      ...step.text.split(/\n+/).map(p => h("p", { class: "p-text" }, p)),
      step.bullets ? h("ul", { class: "bullets" }, ...step.bullets.map(b => h("li", {}, b))) : null,
      h("div", { class: "row" }, h("button", { class: "btn big", onclick: () => next(null) }, "Weiter")));
  },

  breath(step, body, next) {
    breathWidget(body, step.pattern, step.rounds, () => next(null));
  },

  free(step, body, next) {
    let left = step.secs, iv = null;
    const out = h("div", { class: "timer" }, fmt(left));
    const btn = h("button", { class: "btn" }, "Timer starten");
    btn.onclick = () => {
      if (iv) { clearInterval(iv); iv = null; btn.textContent = "Weiter laufen lassen"; return; }
      btn.textContent = "Pause";
      iv = setInterval(() => { left--; out.textContent = fmt(Math.max(0, left)); if (left <= 0) { clearInterval(iv); iv = null; btn.textContent = "Zeit um"; Engine.ensure(); Engine.tone(72, Engine.now(), 0.4, 0.3); } }, 1000);
    };
    stepCleanup.push(() => clearInterval(iv));
    body.append(out, h("div", { class: "row" }, btn, h("button", { class: "btn ghost", onclick: () => next(null) }, "Weiter")));
  },

  hiss(step, body, next) {
    const out = h("div", { class: "timer" }, "0,0 s");
    const goal = h("p", { class: "muted" }, `Ziel: ${step.goal} Sekunden`);
    const res = h("div", { class: "feedback" });
    const btn = h("button", { class: "btn big" }, "Start");
    let running = false, best = 0;
    const show = s => out.textContent = s.toFixed(1).replace(".", ",") + " s";
    const done = sec => {
      running = false; best = Math.max(best, sec);
      const sc = Math.round(clamp(sec / step.goal, 0, 1) * 100);
      res.innerHTML = "";
      res.append(scoreRing(sc), h("ul", { class: "tips" },
        h("li", {}, sec >= step.goal ? `Stark: ${sec.toFixed(1).replace(".", ",")} Sekunden. Ziel erreicht.` : `${sec.toFixed(1).replace(".", ",")} Sekunden. Noch ${Math.ceil(step.goal - sec)} bis zum Ziel.`),
        h("li", {}, sec < step.goal * 0.6 ? "Atme tiefer in den Bauch und die Flanken ein und lass die Luft sparsamer und gleichmässiger ausströmen." : "Achte darauf, dass das Zischen bis zum Schluss gleich laut bleibt.")),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => next(sc) }, "Weiter"), h("button", { class: "btn ghost", onclick: () => { res.innerHTML = ""; show(0); } }, "Nochmal")));
      btn.textContent = "Start";
    };
    btn.onclick = async () => {
      if (running) { running = false; return; }
      const live = await Mic.ensure();
      running = true; btn.textContent = "Stopp"; res.innerHTML = "";
      const t0 = performance.now();
      if (live) {
        // automatisch messen: Start beim ersten Laut, Ende nach Stille
        const track = []; let started = null;
        const off = Engine.on(fr => {
          track.push(fr);
          if (started == null && fr.rms > 0.02) started = fr.t;
          if (started != null) show(fr.t - started);
          const recent = track.slice(-25);
          if (!running || (started != null && fr.t - started > 1 && recent.every(f => f.rms < 0.012))) { off(); done(analyzeHiss(track)); }
        });
        stepCleanup.push(off);
        btn.textContent = "Stopp";
      } else {
        // Stoppuhr: selbst stoppen
        const iv = setInterval(() => { const s = (performance.now() - t0) / 1000; show(s); if (!running) { clearInterval(iv); done(s); } }, 100);
        stepCleanup.push(() => clearInterval(iv));
      }
    };
    body.append(goal, out, h("p", { class: "muted small" }, Engine.live === false ? "Tippe auf Start, zische und tippe auf Stopp, wenn die Luft ausgeht." : "Tippe auf Start und zische los. Die Zeit stoppt automatisch, wenn du aufhörst."), h("div", { class: "row" }, btn, h("button", { class: "btn ghost", onclick: () => next(null) }, "Überspringen")), res);
  },

  sustain(step, body, next, prof) {
    const root = rootOf(prof);
    const target = root + parseNotes(step.note)[0].semi;
    exerciseWidget(body, {
      title: `Ton: ${nn(target)} auf «${step.syl}»`,
      targetsFor: t0 => [{ midi: target, t0, t1: t0 + step.secs, syl: step.syl }],
      listenDur: 1.6, playRef: t => Engine.tone(target, t, 1.4, 0.5),
      analyze: (targets, track) => analyzeSustain(target, track, { dyn: step.dyn, vib: step.vib }),
      next, kind: "sustain", step
    });
  },

  match(step, body, next, prof) {
    const root = rootOf(prof), r = rangeOf(prof);
    const notes = parseNotes(step.notes, step.syl);
    const beat = 60 / (step.bpm || 80);
    const keys = step.keys || [0];
    const maxS = Math.max(...notes.map(n => n.semi)), minS = Math.min(...notes.map(n => n.semi));
    const blocks = keys.map(k => clamp(root + k, r.low - minS, r.high - maxS));
    const patDur = notes.reduce((s, n) => s + n.beats * beat, 0);
    exerciseWidget(body, {
      title: `${notes.length} Töne${keys.length > 1 ? `, ${keys.length} Tonarten` : ""} · ab ${nn(blocks[0])}`,
      blocks, notes, beat, patDur,
      next, kind: "match", step
    });
  },

  glide(step, body, next) {
    exerciseWidget(body, { title: "Sirene", glide: true, secs: step.secs, analyze: (_, track) => analyzeGlide(track), next, kind: "glide", step });
  },

  range(step, body, next, prof) {
    rangeWidget(body, prof, () => next(null));
  }
};

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---------- Atem-Widget ---------- */
function breathWidget(body, pattern, rounds, onDone) {
  const labels = ["Einatmen", "Halten", "Ausatmen", "Pause"];
  const circle = h("div", { class: "breath" }, h("div", { class: "breath-ball" }), h("div", { class: "breath-label" }, "Bereit?"), h("div", { class: "breath-sec" }, ""));
  const info = h("p", { class: "muted center" }, `${pattern[0]} Sek. ein${pattern[1] ? `, ${pattern[1]} halten` : ""}, ${pattern[2]} aus · ${rounds} Runden`);
  const btn = h("button", { class: "btn big" }, "Start");
  let tm = [];
  const stop = () => { tm.forEach(clearTimeout); tm = []; };
  stepCleanup.push(stop);
  btn.onclick = () => {
    stop(); btn.disabled = true;
    const ball = $(".breath-ball", circle), lab = $(".breath-label", circle), sec = $(".breath-sec", circle);
    let t = 0;
    for (let r = 0; r < rounds; r++) pattern.forEach((d, p) => {
      if (!d) return;
      tm.push(setTimeout(() => {
        lab.textContent = labels[p];
        ball.style.transitionDuration = d + "s";
        ball.style.transform = p === 0 ? "scale(1)" : p === 2 ? "scale(0.45)" : ball.style.transform;
        let left = d; sec.textContent = left;
        const iv = setInterval(() => { left--; sec.textContent = left > 0 ? left : ""; if (left <= 0) clearInterval(iv); }, 1000);
        tm.push(iv);
      }, t * 1000));
      t += d;
    });
    tm.push(setTimeout(() => { lab.textContent = "Fertig"; sec.textContent = ""; btn.disabled = false; btn.textContent = "Weiter"; btn.onclick = onDone; }, t * 1000));
  };
  body.append(circle, info, h("div", { class: "row center" }, btn, onDone ? h("button", { class: "btn ghost", onclick: onDone }, "Überspringen") : null));
}

/* ==========================================================================
   Übungs-Widget: Vorspielen, Singen (live oder Aufnahme), Auswertung
   ========================================================================== */
function exerciseWidget(body, cfg) {
  const canvas = h("canvas", { class: "roll", height: 220, "aria-label": "Tonhöhen-Anzeige" });
  const live = h("div", { class: "live-note" }, h("span", { class: "ln-note" }, "–"), h("span", { class: "ln-dev" }, ""));
  const fb = h("div", { class: "feedback", "aria-live": "polite" });
  const status = h("p", { class: "status" }, "");
  const btnRow = h("div", { class: "row" });
  body.append(h("p", { class: "ex-title" }, cfg.title), h("div", { class: "roll-wrap" }, canvas, live), status, btnRow, fb);

  // Ziel-Timeline
  let targets = [], listenSpans = [];
  function buildTimeline(t0, withListen) {
    targets = []; listenSpans = [];
    let t = t0;
    if (cfg.kind === "match") {
      for (const root of cfg.blocks) {
        if (withListen) { const ls = t; cfg.notes.forEach(n => { const d = n.beats * cfg.beat; listenSpans.push({ midi: root + n.semi, t0: t, t1: t + d * 0.92, syl: n.syl }); t += d; }); t += cfg.beat; void ls; }
        cfg.notes.forEach(n => { const d = n.beats * cfg.beat; targets.push({ midi: root + n.semi, t0: t, t1: t + d * 0.92, syl: n.syl }); t += d; });
        t += cfg.beat * 1.5;
      }
    } else if (cfg.kind === "sustain") {
      if (withListen) { listenSpans.push({ midi: cfg.targetsFor(t)[0].midi, t0: t, t1: t + 1.4 }); t += cfg.listenDur + 0.6; }
      targets = cfg.targetsFor(t);
    }
    return targets.length ? targets[targets.length - 1].t1 : t0 + (cfg.secs || 6);
  }
  buildTimeline(0, false);

  const ctx2 = canvas.getContext("2d");
  let track = [], viewT = 0, raf = 0, running = false, mode = "idle";
  function fitCanvas() { const w = canvas.clientWidth || 600; canvas.width = w * devicePixelRatio; canvas.height = 220 * devicePixelRatio; }
  fitCanvas();
  const ro = new ResizeObserver(() => { fitCanvas(); draw(); }); ro.observe(canvas);
  stepCleanup.push(() => { ro.disconnect(); cancelAnimationFrame(raf); running = false; });

  function yRange() {
    const ms = [...targets, ...listenSpans].map(x => x.midi);
    const vals = track.filter(f => f.midi != null).map(f => f.midi);
    if (cfg.glide) { const all = vals.length ? vals : [rootOf(profFor(S.mode === "kids" ? "kids" : "adult"))]; return [Math.min(...all) - 3, Math.max(...all) + 3]; }
    const lo = Math.min(...ms) - 4, hi = Math.max(...ms) + 4;
    return [lo, Math.max(hi, lo + 10)];
  }
  function draw(full) {
    const W = canvas.width, H = canvas.height, dpr = devicePixelRatio, cs = getComputedStyle(document.body);
    const col = n => cs.getPropertyValue(n).trim();
    ctx2.clearRect(0, 0, W, H);
    const [lo, hi] = yRange();
    let tA, tB;
    const end = Math.max(targets.length ? targets[targets.length - 1].t1 : 0, track.length ? track[track.length - 1].t : 0) + 0.5;
    const start0 = listenSpans.length ? listenSpans[0].t0 : targets.length ? targets[0].t0 : 0;
    if (full || mode !== "live") { tA = Math.min(start0, track[0]?.t ?? start0) - 0.3; tB = Math.max(end, tA + 4); }
    else { tA = viewT - 2; tB = viewT + 4.5; }
    const X = t => (t - tA) / (tB - tA) * W, Y = m => H - (m - lo) / (hi - lo) * H;
    // Notenlinien
    ctx2.font = `${11 * dpr}px "IBM Plex Mono", monospace`; ctx2.textBaseline = "middle";
    for (let m = Math.ceil(lo); m <= hi; m++) {
      const pc = ((m % 12) + 12) % 12, isC = pc === 0, white = [0, 2, 4, 5, 7, 9, 11].includes(pc);
      if (!white) continue;
      ctx2.strokeStyle = col(isC ? "--line-strong" : "--line"); ctx2.lineWidth = dpr * (isC ? 1 : 0.6);
      ctx2.beginPath(); ctx2.moveTo(0, Y(m)); ctx2.lineTo(W, Y(m)); ctx2.stroke();
      if (isC || pc === 7) { ctx2.fillStyle = col("--muted"); ctx2.fillText(nn(m), 4 * dpr, Y(m) - 7 * dpr); }
    }
    const bandH = (H / (hi - lo)) * 0.9;
    const rr = (x, y, w, hh, r) => { ctx2.beginPath(); ctx2.roundRect ? ctx2.roundRect(x, y, w, hh, r) : ctx2.rect(x, y, w, hh); };
    // Vorspiel-Noten (blass)
    listenSpans.forEach(s => { ctx2.fillStyle = col("--ghost"); rr(X(s.t0), Y(s.midi) - bandH / 2, Math.max(2, X(s.t1) - X(s.t0)), bandH, 6 * dpr); ctx2.fill(); });
    // Zielnoten
    const res = lastResult;
    const drawT = (tg, k) => {
      let fill = col("--target");
      if (res?.kind === "match" && res.notes[k]) fill = res.notes[k].score >= 0.6 ? col("--good-soft") : res.notes[k].found ? col("--warn-soft") : col("--bad-soft");
      let a = tg.t0, b = tg.t1;
      if (res?.kind === "match" && res.notes[k]?.seg) { a = res.notes[k].seg.t0; b = res.notes[k].seg.t1; }
      ctx2.fillStyle = fill; rr(X(a), Y(tg.midi) - bandH / 2, Math.max(3, X(b) - X(a)), bandH, 6 * dpr); ctx2.fill();
      if (tg.syl && X(b) - X(a) > 18 * dpr) { ctx2.fillStyle = col("--ink"); ctx2.fillText(tg.syl, X(a) + 5 * dpr, Y(tg.midi)); }
    };
    if (!(mode !== "live" && lastResult && !lastResult.live && cfg.kind === "match")) targets.forEach(drawT);
    else targets.forEach((tg, k) => { if (lastResult.notes[k]?.seg) drawT(tg, k); });
    // gesungene Linie
    ctx2.lineWidth = 3 * dpr; ctx2.lineCap = "round"; ctx2.lineJoin = "round";
    let prev = null;
    for (const f of track) {
      if (f.midi == null || f.t < tA || f.t > tB) { prev = null; continue; }
      if (prev && f.t - prev.t < 0.12) {
        const tg = targets.find(x => f.t >= x.t0 && f.t <= x.t1);
        const ok = tg ? Math.abs(foldCents((f.midi - tg.midi) * 100)) <= 50 : null;
        ctx2.strokeStyle = ok == null ? col("--voice") : ok ? col("--good") : col("--voice");
        ctx2.beginPath(); ctx2.moveTo(X(prev.t), Y(prev.midi)); ctx2.lineTo(X(f.t), Y(f.midi)); ctx2.stroke();
      }
      prev = f;
    }
    if (mode === "live" && !full) { ctx2.strokeStyle = col("--accent"); ctx2.lineWidth = 2 * dpr; ctx2.beginPath(); ctx2.moveTo(X(viewT), 0); ctx2.lineTo(X(viewT), H); ctx2.stroke(); }
  }

  let lastResult = null;
  function playListen(t0) {
    if (cfg.kind === "match") listenSpans.forEach(s => Engine.tone(s.midi, s.t0, s.t1 - s.t0, 0.5));
    if (cfg.kind === "sustain") cfg.playRef(listenSpans[0].t0);
    if (S.guide) targets.forEach(tg => Engine.tone(tg.midi, tg.t0, tg.t1 - tg.t0, 0.18));
    // Einzähler vor dem Singen
    if (targets.length) for (let k = 1; k <= 2; k++) Engine.click(targets[0].t0 - k * (cfg.beat || 0.5), k === 1);
  }
  function setLive(f) {
    const n = $(".ln-note", live), d = $(".ln-dev", live);
    if (f?.midi == null) { n.textContent = "–"; d.textContent = ""; live.dataset.state = ""; return; }
    n.textContent = nn(f.midi);
    const tg = targets.find(x => f.t >= x.t0 - 0.1 && f.t <= x.t1 + 0.1);
    if (tg) {
      const c = Math.round(foldCents((f.midi - tg.midi) * 100));
      d.textContent = Math.abs(c) <= 25 ? "genau" : c > 0 ? `${c} Cent zu hoch` : `${-c} Cent zu tief`;
      live.dataset.state = Math.abs(c) <= 50 ? "ok" : "off";
    } else { d.textContent = ""; live.dataset.state = ""; }
  }

  async function runLive() {
    const ok = await Mic.ensure();
    if (!ok) { setButtons(); return; }
    fb.innerHTML = ""; lastResult = null; track = []; mode = "live";
    const t0 = Engine.now() + 0.8;
    const endT = cfg.glide ? t0 + cfg.secs : buildTimeline(t0, true);
    if (cfg.glide) { targets = []; listenSpans = []; }
    playListen(t0);
    status.textContent = cfg.glide ? "Los geht's: gleite rauf und runter." : listenSpans.length ? "Hör zu …" : "Sing!";
    running = true; setButtons();
    const off = Engine.on(f => {
      if (!running) return;
      viewT = f.t;
      const firstT = targets[0]?.t0 ?? t0;
      if (f.t >= firstT - 0.3) track.push(f);
      if (!cfg.glide && listenSpans.length) status.textContent = f.t < firstT ? (f.t < firstT - (cfg.beat || 0.5) * 2 ? "Hör zu …" : "Gleich du …") : "Jetzt du!";
      setLive(f);
      if (f.t > endT + 0.4) finish();
    });
    stepCleanup.push(off);
    const loop = () => { if (!running) return; draw(); raf = requestAnimationFrame(loop); };
    loop();
    function finish() {
      if (!running) return;
      running = false; off(); cancelAnimationFrame(raf); mode = "done"; status.textContent = "";
      evaluate(true);
    }
    cancelBtn.onclick = finish;
  }

  async function runRecord() {
    fb.innerHTML = "";
    status.textContent = "Die Aufnahme-App öffnet sich. Singe die Übung und speichere die Aufnahme.";
    const file = await Mic.pickRecording();
    if (!file) { status.textContent = "Keine Aufnahme erhalten. Versuche es noch einmal."; return; }
    status.textContent = "Ich werte deine Aufnahme aus …";
    try {
      const r = await Engine.analyzeFile(file);
      buildTimeline(0, false);
      track = r.track; mode = "done";
      if (cfg.kind === "match") { // Ziele an Aufnahmezeit anpassen (nur für Anzeige)
        const off = (track.find(f => f.midi != null)?.t ?? 0) - (targets[0]?.t0 ?? 0);
        targets = targets.map(t => ({ ...t, t0: t.t0 + off, t1: t.t1 + off }));
      }
      if (cfg.kind === "sustain") { const v = track.filter(f => f.midi != null); if (v.length) targets = [{ ...targets[0], t0: v[0].t, t1: v[v.length - 1].t }]; }
      status.textContent = "";
      evaluate(false);
    } catch (e) { status.textContent = "Diese Aufnahme konnte ich nicht lesen. Bitte nimm sie im Format M4A, MP3 oder WAV auf."; }
  }

  function playOnly() {
    Engine.ensure();
    const t0 = Engine.now() + 0.2;
    if (cfg.kind === "match") { let t = t0; cfg.blocks.forEach(root => { cfg.notes.forEach(n => { const d = n.beats * cfg.beat; Engine.tone(root + n.semi, t, d * 0.92, 0.5); t += d; }); t += cfg.beat * 1.5; }); }
    if (cfg.kind === "sustain") Engine.tone(targets[0].midi, t0, 2.5, 0.5);
  }

  function evaluate(isLive) {
    let r;
    if (cfg.kind === "match") r = analyzeMatch(targets, track, isLive);
    else r = cfg.analyze(targets, track);
    r.live = isLive; lastResult = r;
    draw(true);
    renderFeedback(fb, r, cfg, () => { fb.innerHTML = ""; lastResult = null; track = []; draw(true); setButtons(); }, cfg.next);
    setButtons();
  }

  const cancelBtn = h("button", { class: "btn ghost" }, "Stopp");
  function setButtons() {
    btnRow.innerHTML = "";
    if (running) { btnRow.append(cancelBtn); return; }
    if (Engine.live !== false) {
      btnRow.append(playBtn(lastResult ? "Nochmal singen" : cfg.glide ? "Start" : "Anhören und singen", runLive, "big"));
    } else {
      if (!cfg.glide) btnRow.append(h("button", { class: "btn", onclick: playOnly }, "Vorspielen"));
      btnRow.append(h("button", { class: "btn big", onclick: runRecord }, lastResult ? "Neu aufnehmen" : "Aufnehmen"));
      if (!lastResult) status.innerHTML = "";
      if (!lastResult) status.append(micNotice());
    }
    if (!lastResult) btnRow.append(h("button", { class: "btn ghost", onclick: () => cfg.next(null) }, "Überspringen"));
  }
  setButtons();
  draw(true);
}

function micNotice() {
  return h("span", { class: "notice" }, "Live-Mikrofon ist hier nicht erlaubt. Tippe auf «Vorspielen», dann auf «Aufnehmen» und singe die Übung in die Aufnahme-App deines Handys. Danach wertet die App alles aus.");
}

/* ---------- Rückmeldung ---------- */
function scoreRing(sc) {
  const r = 34, c = 2 * Math.PI * r;
  const svg = `<svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true"><circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - sc / 100)}" transform="rotate(-90 40 40)"/></svg>`;
  return h("div", { class: "ring" }, h("div", { html: svg }), h("strong", {}, String(sc)), h("span", {}, "Punkte"));
}
const cents = c => `${Math.abs(Math.round(c))} Cent`;

function tipsFor(r, kid) {
  const t = [];
  if (r.kind === "match") {
    if (r.foundFrac < 0.5) t.push(kid ? "Ich habe euch kaum gehört. Singt ruhig etwas lauter und näher am Handy!" : "Ich habe wenige Töne gehört. Sing etwas lauter, geh näher ans Gerät und sorg für eine ruhige Umgebung.");
    if (Math.abs(r.octave) >= 1) t.push(`Du singst eine Oktave ${r.octave < 0 ? "tiefer" : "höher"} als vorgespielt. Das ist in Ordnung und wird richtig gewertet.`);
    if (r.avgDev < -25) t.push(kid ? "Die Töne waren ein bisschen zu tief. Stellt euch vor, die Töne fliegen wie ein Vogel nach oben." : `Du singst im Schnitt ${cents(r.avgDev)} zu tief. Denk den Ton «von oben», hebe innerlich die Wangen wie beim Lächeln und gib etwas mehr Atemenergie.`);
    else if (r.avgDev > 25) t.push(kid ? "Die Töne waren ein bisschen zu hoch. Ganz locker bleiben!" : `Du singst im Schnitt ${cents(r.avgDev)} zu hoch. Meist steckt zu viel Druck dahinter: Kiefer und Nacken lockern, etwas leiser singen.`);
    if (!kid && r.highDev - r.lowDev < -35) t.push("Die hohen Töne geraten zu tief. Nicht hinaufdrücken, sondern leichter und mit mehr Kopfstimme hineingehen, der Vokal darf schmaler werden.");
    if (!kid && r.highDev - r.lowDev > 35) t.push("Die tiefen Töne sind zu tief, die hohen stimmen. Lass die tiefen Töne nicht «durchhängen», sondern singe sie mit der gleichen Spannung wie die hohen.");
    if (r.avgSd > 35) t.push(kid ? "Der Ton hat etwas gewackelt. Ganz ruhig Luft geben, wie beim langsamen Pusten." : "Die Töne schwanken. Lass die Luft gleichmässig fliessen und halte die Flanken weit, so wird jeder Ton ruhiger.");
    const missed = r.notes.filter(n => !n.found).length;
    if (missed && r.foundFrac >= 0.5) t.push(`${missed} ${missed === 1 ? "Ton fehlte" : "Töne fehlten"}. Setz jeden Ton bewusst neu an, auch wenn er gleich bleibt.`);
    if (r.score >= 85) t.unshift(kid ? "Wow, super gesungen!" : "Sehr sauber gesungen. Du kannst das Tempo oder die Tonart steigern.");
    else if (!t.length) t.push("Gut gemacht. Wiederhole die Übung und achte auf die orange markierten Töne.");
  }
  if (r.kind === "sustain") {
    if (r.n < 10) t.push("Ich habe kaum einen gehaltenen Ton gehört. Sing den Ton etwas lauter und länger.");
    else {
      if (r.med < -25) t.push(`Der Ton liegt ${cents(r.med)} zu tief. Mehr Spannung im Körper, Blick nach vorne oben, Ton von oben ansetzen.`);
      else if (r.med > 25) t.push(`Der Ton liegt ${cents(r.med)} zu hoch. Entspanne Kiefer und Zunge und nimm etwas Druck weg.`);
      if (r.drift < -30) t.push(`Der Ton sinkt zum Ende um ${cents(r.drift)} ab. Teile die Luft besser ein und halte die Stütze bis zum Schluss.`);
      if (r.drift > 30) t.push(`Der Ton steigt zum Ende um ${cents(r.drift)}. Achte darauf, am Schluss nicht mehr zu drücken.`);
      if (r.sd > 30 && !r.vibRate) t.push("Der Ton wackelt. Gleichmässig ausatmen und den Ton wie einen geraden Faden halten.");
      if (r.dynRange != null) t.push(r.dynRange < 6 ? "Die Lautstärke hat sich kaum verändert. Trau dich, in der Mitte deutlich lauter zu werden." : r.peakPos < 0.25 || r.peakPos > 0.75 ? "Der lauteste Moment war am Rand. Plane den Höhepunkt in der Mitte des Tons." : `Schönes An- und Abschwellen mit ${Math.round(r.dynRange)} dB Unterschied.`);
      if (r.vibRate) t.push(r.vibRate >= 4.5 && r.vibRate <= 7.5 && r.vibExtent > 30 ? `Vibrato erkannt: ${r.vibRate.toFixed(1).replace(".", ",")} Schwingungen pro Sekunde. Das ist ein gesundes Tempo.` : r.vibExtent <= 30 ? "Noch kaum Vibrato. Bleib locker, es kommt mit der Zeit von selbst." : `Vibrato mit ${r.vibRate.toFixed(1).replace(".", ",")} pro Sekunde. ${r.vibRate > 7.5 ? "Etwas schnell, das deutet auf Spannung hin." : "Etwas langsam, gib mehr Atemfluss."}`);
      if (r.score >= 85) t.unshift("Ruhig und sauber gehalten. Sehr gut!");
      if (!t.length) t.push("Guter Ton. Versuche ihn beim nächsten Mal noch etwas länger zu halten.");
    }
  }
  if (r.kind === "glide") {
    if (r.empty) t.push("Ich habe nichts gehört. Sing etwas lauter oder geh näher ans Gerät.");
    else {
      t.push(`Deine Sirene reichte von ${nn(r.lo)} bis ${nn(r.hi)}, das sind ${Math.round(r.range)} Halbtöne.`);
      if (r.jumps.length) t.push(`Bei ${nn(median(r.jumps))} ist die Stimme gesprungen. An dieser Stelle leiser werden und ganz weich weitergleiten.`);
      if (r.gaps > 1) t.push("Der Ton ist mehrmals abgerissen. Halte den Luftstrom gleichmässig, auch wenn es hoch wird.");
      if (r.range < 10) t.push(kid ? "Probiert, noch höher und noch tiefer zu kommen!" : "Wage dich noch etwas weiter nach oben, ganz leicht und leise.");
    }
  }
  return t;
}

function renderFeedback(fb, r, cfg, again, next) {
  const kid = document.body.dataset.mode === "kids";
  fb.innerHTML = "";
  const tips = tipsFor(r, kid);
  const chips = r.kind === "match" ? h("div", { class: "chips" }, ...r.notes.map(n => {
    const cls = !n.found ? "miss" : n.score >= 0.6 ? "ok" : "off";
    const arrow = !n.found ? "–" : Math.abs(n.med) <= 25 ? "✓" : n.med > 0 ? "↑" : "↓";
    return h("span", { class: "chip " + cls, title: n.found ? `${Math.round(n.med)} Cent` : "nicht gehört" }, nn(n.tg.midi), h("b", {}, arrow));
  })) : null;
  const ai = h("div", { class: "ai" });
  fb.append(
    h("div", { class: "fb-head" }, scoreRing(r.score), h("div", {},
      h("p", { class: "eyebrow" }, "Auswertung"),
      h("p", { class: "fb-sum" }, summaryLine(r)))),
    chips, chips ? h("p", { class: "muted small" }, "✓ getroffen · ↑ zu hoch · ↓ zu tief · – nicht gehört") : null,
    h("ul", { class: "tips" }, ...tips.map(x => h("li", {}, x))),
    ai,
    h("div", { class: "row" },
      h("button", { class: "btn", onclick: () => next(r.score) }, "Weiter"),
      h("button", { class: "btn ghost", onclick: again }, "Nochmal")));
  Coach.attach(ai, r, cfg, tips);
}
function summaryLine(r) {
  if (r.kind === "match") return `${r.notes.filter(n => n.score >= 0.6).length} von ${r.notes.length} Tönen getroffen.`;
  if (r.kind === "sustain") return r.n < 10 ? "Kaum Ton erkannt." : `${Math.round(r.hit * 100)} % der Zeit im Ziel (±50 Cent).`;
  if (r.kind === "glide") return r.empty ? "Kein Ton erkannt." : `Umfang ${Math.round(r.range)} Halbtöne.`;
  return "";
}

/* ---------- KI-Gesangslehrer (Claude, falls verfügbar) ---------- */
const Coach = {
  fn: undefined,
  async get() {
    if (this.fn !== undefined) return this.fn;
    try { this.fn = window.claude?.use ? await window.claude.use("sample") : null; } catch (e) { this.fn = null; }
    return this.fn;
  },
  async attach(box, r, cfg, tips) {
    const s = await this.get(); if (!s || !box.isConnected) return;
    const out = h("div", { class: "ai-out" });
    const btn = h("button", { class: "btn soft" }, "KI-Gesangslehrer fragen");
    btn.onclick = async () => {
      btn.disabled = true; out.textContent = "Denkt nach …";
      const data = JSON.parse(JSON.stringify(r, (k, v) => k === "seg" || k === "v" ? undefined : typeof v === "number" ? Math.round(v * 100) / 100 : v));
      const prompt = `Du bist eine erfahrene, warmherzige Gesangslehrerin. Schreibe auf Deutsch (Schweizer Schreibweise, «ss» statt «ß»), duze, 3 bis 5 kurze Sätze, keine Aufzählungszeichen, kein Markdown.
Übung: «${cfg.step?.title || ""}» (${cfg.kind}) ${cfg.step?.text || ""}
Silbe: ${cfg.step?.syl || "-"}. Kinderkurs: ${document.body.dataset.mode === "kids" ? "ja, sprich das Kind und den Elternteil spielerisch an" : "nein"}.
Messdaten (Cent-Abweichungen, negativ = zu tief; score 0-100; sd = Schwankung; drift = Veränderung zum Ende):
${JSON.stringify(data).slice(0, 3500)}
Bereits angezeigte Tipps: ${tips.join(" ")}
Gib eine persönliche Einschätzung und einen konkreten nächsten Übungsschritt, ohne die Tipps zu wiederholen.`;
      try { await s(prompt, { onText: ({ text }) => { out.textContent = text; } }); }
      catch (e) { out.textContent = e.code === "not_granted" ? "Der KI-Lehrer ist nicht freigegeben." : e.code === "rate_limited" ? "Gerade zu viele Anfragen. Versuche es gleich noch einmal." : "Das hat nicht geklappt."; }
      btn.disabled = false;
    };
    box.append(btn, out);
  }
};

/* ==========================================================================
   Tonumfang
   ========================================================================== */
function rangeWidget(body, prof, onDone) {
  const out = h("div", { class: "range-out" });
  const r0 = rangeOf(prof);
  out.append(h("p", { class: "muted" }, `Bisher: ${nn(r0.low)} bis ${nn(r0.high)}${prof.low == null ? " (Standard für deine Stimmlage)" : ""}`));
  const status = h("p", { class: "status" });
  const big = h("div", { class: "timer" }, "–");
  const btns = h("div", { class: "row" });
  function saveRange(lo, hi) {
    if (!(hi - lo >= 5)) { status.textContent = "Das war zu wenig, um den Umfang zu bestimmen. Versuche es noch einmal und gleite von ganz tief nach ganz hoch."; return; }
    prof.low = lo; prof.high = hi; S.ranges.push({ d: todayStr(), lo, hi, who: prof === S.prof.kids ? "kids" : "adult" }); save();
    out.innerHTML = "";
    out.append(h("p", { class: "fb-sum" }, `Dein Tonumfang: ${nn(lo)} bis ${nn(hi)}, ${hi - lo} Halbtöne.`), h("p", { class: "muted" }, "Alle Übungen passen sich jetzt an diesen Umfang an."));
    status.textContent = "";
    if (onDone) btns.innerHTML = "", btns.append(h("button", { class: "btn", onclick: onDone }, "Weiter"));
  }
  async function live() {
    if (!(await Mic.ensure())) { setup(); return; }
    const res = { low: [], high: [] };
    for (const phase of ["low", "high"]) {
      status.textContent = phase === "low" ? "Sing langsam immer tiefer, so tief es bequem geht …" : "Jetzt gleite leicht und leise nach ganz oben …";
      await new Promise(done => {
        const t0 = Engine.now(), trk = [];
        const off = Engine.on(f => { trk.push(f); if (f.midi) big.textContent = nn(f.midi); if (f.t - t0 > 7) { off(); res[phase] = trk; done(); } });
        stepCleanup.push(off);
      });
    }
    const a = analyzeRange(res.low), b = analyzeRange(res.high);
    if (!a || !b) { status.textContent = "Ich habe zu wenig gehört. Bitte noch einmal und etwas lauter."; return; }
    saveRange(Math.min(a.low, b.low), Math.max(a.high, b.high));
  }
  async function rec() {
    status.textContent = "Sing in der Aufnahme langsam von deinem tiefsten zu deinem höchsten bequemen Ton.";
    const f = await Mic.pickRecording(); if (!f) return;
    status.textContent = "Werte aus …";
    try { const { track } = await Engine.analyzeFile(f); const a = analyzeRange(track); if (!a) throw 0; saveRange(a.low, a.high); }
    catch (e) { status.textContent = "Ich konnte in der Aufnahme keine Töne finden."; }
  }
  function setup() {
    btns.innerHTML = "";
    if (Engine.live !== false) btns.append(h("button", { class: "btn big", onclick: live }, "Messung starten"));
    else { btns.append(h("button", { class: "btn big", onclick: rec }, "Aufnehmen")); status.innerHTML = ""; status.append(micNotice()); }
    if (onDone) btns.append(h("button", { class: "btn ghost", onclick: onDone }, "Überspringen"));
  }
  setup();
  body.append(out, big, status, btns);
}

/* ==========================================================================
   Werkzeuge
   ========================================================================== */
const TOOLS = [
  ["tuner", "Stimmgerät", "Zeigt live, welchen Ton du singst und wie genau."],
  ["ear", "Töne treffen", "Zufällige Töne nachsingen, 10 Runden mit Punkten."],
  ["range", "Tonumfang messen", "Findet deinen tiefsten und höchsten Ton."],
  ["breath", "Atem-Trainer", "Geführte Atemmuster mit Animation."],
  ["piano", "Klavier", "Zwei Oktaven zum Vorspielen und Üben."],
  ["drone", "Grundton und Metronom", "Ein liegender Ton oder ein Takt zum Üben."]
];
let currentTool = null;
function viewTools() {
  app.append(h("header", { class: "page-head" }, h("h1", {}, "Werkzeuge")),
    h("div", { class: "tool-grid" }, ...TOOLS.map(([id, t, d]) => h("button", { class: "tool-card" + (currentTool === id ? " active" : ""), onclick: () => openTool(id) }, h("strong", {}, t), h("span", {}, d)))),
    h("section", { id: "tool-area", class: "card tool-area" }));
  if (currentTool) openTool(currentTool, true);
}
function openTool(id, keep) {
  stopAll(); currentTool = id;
  document.querySelectorAll(".tool-card").forEach((c, i) => c.classList.toggle("active", TOOLS[i][0] === id));
  const area = $("#tool-area"); if (!area) return;
  area.innerHTML = "";
  const prof = profFor(S.mode === "kids" ? "kids" : "adult");
  const [, title, desc] = TOOLS.find(t => t[0] === id);
  area.append(h("h2", {}, title), h("p", { class: "muted" }, desc));
  const body = h("div"); area.append(body);
  ({ tuner: toolTuner, ear: toolEar, range: b => rangeWidget(b, prof), breath: toolBreath, piano: toolPiano, drone: toolDrone })[id](body, prof);
  if (!keep) area.scrollIntoView({ behavior: "smooth", block: "start" });
}

function toolTuner(body) {
  const note = h("div", { class: "tuner-note" }, "–"), hz = h("div", { class: "muted mono" }, "");
  const meter = h("div", { class: "meter" }, h("div", { class: "meter-scale" }, h("span", {}, "−50"), h("span", {}, "0"), h("span", {}, "+50")), h("div", { class: "meter-needle" }));
  const cv = h("canvas", { class: "roll small", height: 140 });
  const btn = h("button", { class: "btn big" }, "Mikrofon starten");
  const st = h("p", { class: "status" });
  body.append(note, hz, meter, cv, st, h("div", { class: "row" }, btn));
  const hist = [];
  btn.onclick = async () => {
    if (!(await Mic.ensure())) {
      st.innerHTML = ""; st.append(h("span", { class: "notice" }, "Live-Mikrofon ist hier nicht erlaubt. Du kannst stattdessen eine Aufnahme analysieren lassen."));
      btn.textContent = "Aufnahme analysieren"; btn.onclick = async () => {
        const f = await Mic.pickRecording(); if (!f) return;
        const { track } = await Engine.analyzeFile(f);
        const v = track.filter(x => x.midi != null).map(x => x.midi);
        if (!v.length) { st.textContent = "Keine Töne gefunden."; return; }
        const m = median(v); note.textContent = nn(m); hz.textContent = `Mittlerer Ton ${midiToFreq(m).toFixed(1)} Hz · tiefster ${nn(Math.min(...v))} · höchster ${nn(Math.max(...v))}`;
        drawHist(track.map(x => x.midi));
      };
      return;
    }
    btn.hidden = true;
    const off = Engine.on(f => {
      hist.push(f.midi); if (hist.length > 300) hist.shift();
      if (f.midi != null) {
        const c = Math.round((f.midi - Math.round(f.midi)) * 100);
        note.textContent = nn(f.midi); hz.textContent = `${midiToFreq(f.midi).toFixed(1)} Hz · ${c > 0 ? "+" : ""}${c} Cent`;
        $(".meter-needle", meter).style.left = (50 + c) + "%";
        meter.dataset.state = Math.abs(c) <= 10 ? "ok" : Math.abs(c) <= 25 ? "near" : "off";
      }
      drawHist(hist);
    });
    stepCleanup.push(off);
  };
  function drawHist(arr) {
    const c = cv.getContext("2d"), W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = 140 * devicePixelRatio;
    const v = arr.filter(x => x != null); if (!v.length) return;
    const lo = Math.min(...v) - 2, hi = Math.max(...v) + 2, cs = getComputedStyle(document.body);
    c.clearRect(0, 0, W, H); c.strokeStyle = cs.getPropertyValue("--voice"); c.lineWidth = 2.5 * devicePixelRatio; c.beginPath();
    let pen = false;
    arr.forEach((m, i) => { if (m == null) { pen = false; return; } const x = i / Math.max(arr.length - 1, 1) * W, y = H - (m - lo) / (hi - lo) * H; pen ? c.lineTo(x, y) : c.moveTo(x, y); pen = true; });
    c.stroke();
  }
}

function toolEar(body, prof) {
  const r = rangeOf(prof), root = rootOf(prof);
  let round = 0, points = [], target = null;
  const info = h("p", { class: "fb-sum" }, "Die App spielt einen Ton. Hör zu und singe ihn nach.");
  const res = h("div", { class: "feedback" });
  const btn = h("button", { class: "btn big" }, "Runde 1 starten");
  body.append(info, res, h("div", { class: "row" }, btn));
  const pick = () => clamp(root + Math.floor(Math.random() * 12) - 2, r.low + 1, r.high - 2);
  async function play() {
    target = pick(); round++;
    Engine.ensure(); const t0 = Engine.now() + 0.15; Engine.tone(target, t0, 1.2, 0.5);
    info.textContent = `Runde ${round} von 10: Hör gut zu …`;
    const live = await Mic.ensure();
    if (live) {
      await new Promise(ok => setTimeout(ok, 1500));
      info.textContent = `Runde ${round} von 10: Jetzt singen!`;
      const trk = [], start = Engine.now();
      await new Promise(done => { const off = Engine.on(f => { trk.push(f); if (f.t - start > 2.2) { off(); done(); } }); stepCleanup.push(off); });
      grade(trk.filter(f => f.t - start > 0.4).filter(f => f.midi != null).map(f => f.midi));
    } else {
      info.textContent = `Runde ${round}: Nimm dich auf, wie du den Ton nachsingst.`;
      btn.textContent = "Aufnehmen"; btn.onclick = async () => {
        const f = await Mic.pickRecording(); if (!f) return;
        const { track } = await Engine.analyzeFile(f); grade(track.filter(x => x.midi != null).map(x => x.midi));
      };
    }
  }
  function grade(vals) {
    let pts = 0, msg;
    if (vals.length < 5) msg = "Nichts gehört.";
    else {
      const c = foldCents((median(vals) - target) * 100);
      pts = Math.round(clamp(1 - (Math.abs(c) - 20) / 130, 0, 1) * 10);
      msg = `Ziel ${nn(target)}. ${Math.abs(c) <= 25 ? "Getroffen!" : c > 0 ? cents(c) + " zu hoch." : cents(c) + " zu tief."} +${pts}`;
    }
    points.push(pts);
    res.innerHTML = ""; res.append(h("p", {}, msg), h("p", { class: "muted" }, `Punkte: ${points.reduce((a, b) => a + b, 0)} von ${points.length * 10}`));
    if (round >= 10) {
      const total = points.reduce((a, b) => a + b, 0); markDay();
      info.textContent = `Fertig! ${total} von 100 Punkten.`;
      btn.textContent = "Neues Spiel"; btn.onclick = () => { round = 0; points = []; res.innerHTML = ""; btn.textContent = "Nächste Runde"; btn.onclick = play; play(); };
    } else { btn.textContent = "Nächste Runde"; btn.onclick = play; }
  }
  btn.onclick = play;
}

function toolBreath(body) {
  const presets = [["Ruhig (4-2-6)", [4, 2, 6, 1], 5], ["4-7-8 Entspannung", [4, 7, 8, 0], 4], ["Box-Atmung (4-4-4-4)", [4, 4, 4, 4], 4], ["Lange Ausatmung (2-0-10)", [2, 0, 10, 0], 5]];
  const area = h("div");
  const sel = h("div", { class: "seg wrap" }, ...presets.map(([t, p, r], i) => h("button", { "aria-selected": i === 0, onclick: e => { sel.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", b === e.currentTarget)); stopAll(); area.innerHTML = ""; breathWidget(area, p, r, null); } }, t)));
  body.append(sel, area);
  breathWidget(area, presets[0][1], presets[0][2], null);
}

function toolPiano(body, prof) {
  const start = Math.floor(rootOf(prof) / 12) * 12 - 0;
  const kb = h("div", { class: "piano", role: "group", "aria-label": "Klaviatur" });
  const whites = [0, 2, 4, 5, 7, 9, 11];
  for (let m = start; m <= start + 24; m++) {
    const pc = m % 12, white = whites.includes(pc);
    const k = h("button", { class: white ? "w" : "b", "aria-label": nn(m), onpointerdown: e => { e.preventDefault(); Engine.ensure(); Engine.tone(m, Engine.now(), 0.9, 0.55); k.classList.add("down"); setTimeout(() => k.classList.remove("down"), 200); } }, white ? h("span", {}, nn(m)) : "");
    kb.append(k);
  }
  const songs = allLessons("adult").concat(allLessons("kids")).flatMap(l => l.steps.filter(s => s.type === "match").map(s => [l.title + " · " + s.title, s]));
  const sel = h("select", { id: "piano-song", class: "select" }, ...songs.map(([t], i) => h("option", { value: i }, t)));
  const playBtn = h("button", { class: "btn soft", onclick: () => { const s = songs[sel.value][1]; const n = parseNotes(s.notes); const beat = 60 / (s.bpm || 80); let t = Engine.now() + 0.1; n.forEach(x => { Engine.tone(rootOf(prof) + x.semi, t, x.beats * beat * 0.9, 0.5); t += x.beats * beat; }); } }, "Abspielen");
  body.append(h("div", { class: "piano-wrap" }, kb), h("label", { class: "lbl", for: "piano-song" }, "Melodie aus dem Kurs vorspielen"), h("div", { class: "row" }, sel, playBtn));
}

function toolDrone(body, prof) {
  let osc = null, gain = null, met = null;
  const root = rootOf(prof);
  const noteSel = h("select", { id: "drone-note", class: "select" }, ...Array.from({ length: 13 }, (_, i) => h("option", { value: root - 5 + i, selected: i === 5 }, nn(root - 5 + i))));
  const dBtn = h("button", { class: "btn" }, "Grundton an");
  dBtn.onclick = () => {
    const ctx = Engine.ensure();
    if (osc) { gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1); osc.forEach(o => o.stop(ctx.currentTime + 0.5)); osc = null; dBtn.textContent = "Grundton an"; return; }
    gain = ctx.createGain(); gain.gain.value = 0; gain.connect(Engine.master);
    const f = midiToFreq(+noteSel.value);
    osc = [[1, 0.5], [1.5, 0.18], [2, 0.12]].map(([m, a]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = f * m; g.gain.value = a * 0.12; const lp = ctx.createBiquadFilter(); lp.frequency.value = 900; o.connect(lp); lp.connect(g); g.connect(gain); o.start(); return o; });
    gain.gain.setTargetAtTime(0.9, ctx.currentTime, 0.2);
    dBtn.textContent = "Grundton aus";
  };
  const bpm = h("input", { id: "met-bpm", type: "range", min: 40, max: 180, value: 80 });
  const bpmOut = h("span", { class: "mono" }, "80 BPM");
  bpm.oninput = () => { bpmOut.textContent = bpm.value + " BPM"; };
  const mBtn = h("button", { class: "btn" }, "Metronom an");
  mBtn.onclick = () => {
    if (met) { clearInterval(met); met = null; mBtn.textContent = "Metronom an"; return; }
    let next = Engine.now() + 0.1, n = 0;
    met = setInterval(() => { const sp = 60 / bpm.value; while (next < Engine.now() + 0.2) { Engine.click(next, n % 4 === 0); next += sp; n++; } }, 50);
    mBtn.textContent = "Metronom aus";
  };
  stepCleanup.push(() => { if (osc) dBtn.onclick(); if (met) clearInterval(met); });
  body.append(h("label", { class: "lbl", for: "drone-note" }, "Grundton"), h("div", { class: "row" }, noteSel, dBtn),
    h("label", { class: "lbl", for: "met-bpm" }, "Tempo"), h("div", { class: "row" }, bpm, bpmOut, mBtn),
    h("p", { class: "muted small" }, "Halte zum Grundton lange Töne oder singe Tonleitern darüber. So trainierst du saubere Intonation."));
}

/* ==========================================================================
   Wissen
   ========================================================================== */
function viewKnow() {
  const ask = h("section", { class: "card ask", hidden: true });
  app.append(h("header", { class: "page-head" }, h("h1", {}, "Wissen und Links")),
    h("section", { class: "card" }, h("h2", { class: "h3" }, "Stimmpflege in fünf Regeln"),
      h("ol", { class: "rules" },
        h("li", {}, "Viel Wasser trinken, über den Tag verteilt."),
        h("li", {}, "Immer erst einsingen, nie kalt laut singen."),
        h("li", {}, "Schmerz oder Heiserkeit heisst: Pause. Bei Heiserkeit länger als zwei Wochen zur Ärztin oder zum Arzt (HNO)."),
        h("li", {}, "Genug schlafen. Die Stimme spiegelt den ganzen Körper."),
        h("li", {}, "Lieber kurz und täglich üben als selten und lange."))),
    ask,
    ...RESOURCES.map(g => h("section", { class: "res" }, h("h2", { class: "h3" }, g.group),
      h("ul", { class: "res-list" }, ...g.items.map(([t, u, d]) => h("li", {}, h("a", { href: u, target: "_blank", rel: "noopener" }, t), h("span", {}, d)))))));
  Coach.get().then(s => {
    if (!s) return;
    ask.hidden = false;
    const q = h("textarea", { id: "ask-q", rows: 3, class: "input", placeholder: "Zum Beispiel: Warum kratzt es nach dem Singen im Hals?" });
    const out = h("div", { class: "ai-out" });
    const b = h("button", { class: "btn" }, "Fragen");
    b.onclick = async () => {
      if (!q.value.trim()) return;
      b.disabled = true; out.textContent = "Denkt nach …";
      try { await s(`Du bist eine erfahrene Gesangslehrerin. Antworte auf Deutsch (Schweizer Schreibweise, «ss» statt «ß»), duze, kurz und konkret, höchstens 150 Wörter, ohne Markdown. Bei gesundheitlichen Beschwerden empfiehl eine HNO-Ärztin oder Logopädin.\nFrage: ${q.value.trim()}`, { onText: ({ text }) => out.textContent = text, cache: false }); }
      catch (e) { out.textContent = e.code === "not_granted" ? "Die KI-Frage ist nicht freigegeben." : "Das hat nicht geklappt. Versuche es später noch einmal."; }
      b.disabled = false;
    };
    ask.append(h("h2", { class: "h3" }, "Frag die KI-Gesangslehrerin"), h("label", { class: "lbl", for: "ask-q" }, "Deine Frage"), q, h("div", { class: "row" }, b), out);
  });
}

/* ==========================================================================
   Einstellungen
   ========================================================================== */
function viewSettings() {
  const voiceSel = (p, id, opts) => h("select", { id, class: "select", onchange: e => { p.voice = e.target.value; p.low = p.high = null; save(); render(); } },
    ...opts.map(k => h("option", { value: k, selected: p.voice === k }, VOICES[k].label)));
  const rng = p => { const r = rangeOf(p); return `${nn(r.low)} bis ${nn(r.high)}${p.low == null ? " (Standard)" : " (gemessen)"}`; };
  const toggle = (key, label, id) => h("label", { class: "switch", for: id }, h("input", { id, type: "checkbox", checked: !!S[key], onchange: e => { S[key] = e.target.checked; save(); } }), h("span", {}, label));
  const confirmBox = h("div", { class: "confirm", hidden: true },
    h("p", {}, "Wirklich alle Fortschritte löschen? Das kann nicht rückgängig gemacht werden."),
    h("div", { class: "row" }, h("button", { class: "btn danger", onclick: () => { const keep = S.prof; S = defaults(); S.prof = keep; save(); render(); } }, "Ja, löschen"), h("button", { class: "btn ghost", onclick: () => confirmBox.hidden = true }, "Abbrechen")));
  app.append(h("header", { class: "page-head" }, h("h1", {}, "Profil")),
    h("section", { class: "card form" },
      h("h2", { class: "h3" }, "Meine Stimme"),
      h("label", { class: "lbl", for: "v-adult" }, "Stimmlage"), voiceSel(S.prof.adult, "v-adult", ["tm", "hm", "tf", "hf"]),
      h("p", { class: "muted" }, "Tonumfang: " + rng(S.prof.adult) + ". Miss ihn im Werkzeug «Tonumfang messen».")),
    h("section", { class: "card form" },
      h("h2", { class: "h3" }, "Kinderstimme"),
      h("label", { class: "lbl", for: "kid-name" }, "Name des Kindes (optional)"),
      h("input", { id: "kid-name", class: "input", value: S.prof.kids.name || "", oninput: e => { S.prof.kids.name = e.target.value.slice(0, 30); save(); } }),
      h("p", { class: "muted" }, "Tonumfang: " + rng(S.prof.kids) + ". Im Kindermodus misst das Werkzeug den Umfang des Kindes.")),
    h("section", { class: "card form" },
      h("h2", { class: "h3" }, "Üben"),
      toggle("guide", "Begleitton beim Singen (am besten mit Kopfhörern)", "t-guide"),
      toggle("sol", "Notennamen als Do-Re-Mi statt C-D-E", "t-sol"),
      toggle("unlock", "Alle Lektionen freischalten", "t-unlock")),
    h("section", { class: "card form" },
      h("h2", { class: "h3" }, "Fortschritt"),
      h("p", { class: "muted" }, `${Object.keys(S.done).length} Lektionen erledigt · ${S.days.length} Übungstage. Gespeichert nur auf diesem Gerät.`),
      h("button", { class: "btn ghost", onclick: () => confirmBox.hidden = false }, "Fortschritt zurücksetzen"), confirmBox),
    h("p", { class: "muted small center" }, "Stimmraum · Tonhöhenerkennung mit dem YIN-Verfahren (offener Algorithmus), alles läuft direkt auf deinem Gerät."));
}

/* ---------- Start ---------- */
// Mikrofon-Verfügbarkeit still vorab prüfen, ohne zu fragen
(async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia || window.isSecureContext === false) { Engine.live = false; return; }
    const p = await navigator.permissions?.query({ name: "microphone" });
    if (p?.state === "denied") Engine.live = false;
  } catch (e) {}
  // Im Claude-Viewer ist das Mikrofon gesperrt
  try { if (window.self !== window.top && /claude/.test(document.referrer + location.ancestorOrigins?.[0])) Engine.live = false; } catch (e) {}
})();
render();
