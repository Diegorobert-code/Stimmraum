/* ==========================================================================
   Audio: Klangerzeugung, Mikrofon, Tonhöhenerkennung (YIN) und Auswertung.
   YIN nach de Cheveigné & Kawahara (2002), wie in aubio und pitchy.
   ========================================================================== */

const NOTE_DE = ["C", "Cis", "D", "Dis", "E", "F", "Fis", "G", "Gis", "A", "B", "H"];
const NOTE_SOL = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "Sib", "Si"];
const DEG = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 8: 12, 9: 14, 10: 16, 11: 17, 12: 19 };

const freqToMidi = f => 69 + 12 * Math.log2(f / 440);
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
function noteName(m, sol) {
  const r = Math.round(m), n = ((r % 12) + 12) % 12, o = Math.floor(r / 12) - 1;
  return (sol ? NOTE_SOL : NOTE_DE)[n] + o;
}
const foldCents = c => ((c + 600) % 1200 + 1200) % 1200 - 600;
const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const stdev = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* Notenfolge "1 2 3:2 _5 b3" -> [{semi, beats, syl}] */
function parseNotes(str, sylStr) {
  const syls = (sylStr || "").split(/\s+/).filter(Boolean);
  return str.trim().split(/\s+/).map((tok, i) => {
    let [d, b] = tok.split(":");
    let oct = 0, acc = 0;
    while (d[0] === "_" || d[0] === "^") { oct += d[0] === "_" ? -12 : 12; d = d.slice(1); }
    if (d[0] === "b") { acc = -1; d = d.slice(1); }
    if (d[0] === "#") { acc = 1; d = d.slice(1); }
    return { semi: DEG[+d] + acc + oct, beats: b ? +b : 1, syl: syls.length ? syls[i % syls.length] : "" };
  });
}

/* ---------- YIN ---------- */
function yin(buf, sr, minF = 65, maxF = 1100, thr = 0.15) {
  const maxTau = Math.min(Math.floor(sr / minF), buf.length >> 1);
  const minTau = Math.floor(sr / maxF);
  const W = buf.length - maxTau;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = s;
  }
  // kumulierte mittlere normierte Differenz
  let run = 0; d[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; d[tau] = run ? d[tau] * tau / run : 1; }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < thr) { while (t + 1 <= maxTau && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 0) return { f: -1, c: 0 };
  // parabolische Interpolation
  const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
  const den = a + c - 2 * b;
  const better = den ? tau + (a - c) / (2 * den) : tau;
  return { f: sr / better, c: 1 - b };
}
function rmsOf(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }

/* ---------- Engine ---------- */
const Engine = {
  ctx: null, master: null, stream: null, analyser: null, live: null, // live: true/false/null(unbekannt)
  listeners: new Set(), raf: 0, buf: null, t0: 0, smooth: [],
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.6;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  now() { return this.ensure().currentTime; },
  /* Klavierähnlicher Ton */
  tone(midi, when, dur, vol = 0.5) {
    const ctx = this.ensure(), f = midiToFreq(midi);
    const g = ctx.createGain(); g.connect(this.master);
    const parts = [[1, 1, "triangle"], [2, 0.35, "sine"], [3, 0.12, "sine"], [4, 0.05, "sine"]];
    const oscs = parts.map(([h, a, type]) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type; o.frequency.value = f * h; og.gain.value = a;
      o.connect(og); og.connect(g); return o;
    });
    const end = when + Math.max(dur, 0.15);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.45, when + 0.25);
    g.gain.setTargetAtTime(vol * 0.28, when + 0.25, 0.6);
    g.gain.setTargetAtTime(0.0001, end, 0.08);
    oscs.forEach(o => { o.start(when); o.stop(end + 0.5); });
  },
  click(when, accent) {
    const ctx = this.ensure(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1500 : 1000; o.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.25, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    o.start(when); o.stop(when + 0.06);
  },
  /* Mikrofon live starten. Gibt true/false zurück. */
  async startMic() {
    if (this.stream) return true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("kein getUserMedia");
      this.ensure();
      this.stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Zeitüberschreitung")), 15000))]);
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.live = true; this.loop();
      return true;
    } catch (e) { this.live = false; this.stream = null; return false; }
  },
  stopMic() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
  },
  loop() {
    const step = () => {
      if (!this.stream) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      const r = rmsOf(this.buf);
      let midi = null, clar = 0;
      if (r > 0.008) {
        const { f, c } = yin(this.buf, this.ctx.sampleRate);
        if (f > 0 && c > 0.8) { midi = freqToMidi(f); clar = c; }
      }
      // Median-Glättung gegen Ausreisser
      if (midi != null) { this.smooth.push(midi); if (this.smooth.length > 5) this.smooth.shift(); midi = median(this.smooth); }
      else this.smooth = [];
      const fr = { t: this.ctx.currentTime, midi, rms: r, clar };
      this.listeners.forEach(fn => fn(fr));
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  /* Aufnahme (Datei) analysieren -> Spur */
  async analyzeFile(file) {
    const ctx = this.ensure();
    const ab = await file.arrayBuffer();
    const audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p?.then) p.then(res, rej); });
    const data = audio.getChannelData(0), sr = audio.sampleRate;
    const N = 2048, hop = 512, track = []; let sm = [];
    let peak = 0; for (let i = 0; i < data.length; i += 64) peak = Math.max(peak, Math.abs(data[i]));
    const gate = Math.max(0.006, peak * 0.04);
    for (let i = 0; i + N < data.length; i += hop) {
      const frame = data.subarray(i, i + N), r = rmsOf(frame);
      let midi = null;
      if (r > gate) { const { f, c } = yin(frame, sr); if (f > 0 && c > 0.8) midi = freqToMidi(f); }
      if (midi != null) { sm.push(midi); if (sm.length > 5) sm.shift(); midi = median(sm); } else sm = [];
      track.push({ t: i / sr, midi, rms: r });
    }
    return { track, duration: data.length / sr };
  }
};

/* ==========================================================================
   Auswertung
   ========================================================================== */

/* Spur in stabile Tonsegmente zerlegen */
function segmentTrack(track, minDur = 0.12) {
  const segs = []; let cur = null, lastT = -1;
  for (const fr of track) {
    if (fr.midi == null) { if (cur && fr.t - lastT > 0.07) { segs.push(cur); cur = null; } continue; }
    if (cur && Math.abs(fr.midi - median(cur.v.slice(-6))) < 0.7 && fr.t - lastT < 0.1) { cur.v.push(fr.midi); cur.t1 = fr.t; }
    else { if (cur) segs.push(cur); cur = { t0: fr.t, t1: fr.t, v: [fr.midi] }; }
    lastT = fr.t;
  }
  if (cur) segs.push(cur);
  return segs.filter(s => s.t1 - s.t0 >= minDur).map(s => ({ ...s, m: median(s.v.slice(Math.floor(s.v.length * 0.2))) }));
}

/* Zielnoten und Segmente per Editierdistanz zuordnen (für Aufnahmen ohne Zeitbezug) */
function alignTargets(targets, segs) {
  const n = targets.length, m = segs.length, INF = 1e9;
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(INF));
  const B = Array.from({ length: n + 1 }, () => new Int8Array(m + 1));
  const SKIP_T = 1.4, SKIP_S = 0.5;
  D[0][0] = 0;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
    if (i && D[i - 1][j] + SKIP_T < D[i][j]) { D[i][j] = D[i - 1][j] + SKIP_T; B[i][j] = 1; }
    if (j && D[i][j - 1] + SKIP_S < D[i][j]) { D[i][j] = D[i][j - 1] + SKIP_S; B[i][j] = 2; }
    if (i && j) {
      const c = Math.min(Math.abs(foldCents((segs[j - 1].m - targets[i - 1].midi) * 100)) / 100, 3);
      if (D[i - 1][j - 1] + c < D[i][j]) { D[i][j] = D[i - 1][j - 1] + c; B[i][j] = 3; }
    }
  }
  const map = new Array(n).fill(null);
  let i = n, j = m;
  while (i || j) { const b = B[i][j]; if (b === 3) { map[i - 1] = segs[j - 1]; i--; j--; } else if (b === 1) i--; else j--; }
  return map;
}

function noteStats(values, target) {
  const devs = values.map(v => foldCents((v - target) * 100));
  const med = median(devs);
  const hit = devs.filter(d => Math.abs(d) <= 50).length / (devs.length || 1);
  const sd = devs.length > 2 ? stdev(devs) : 0;
  const octave = values.length ? Math.round((median(values) - target) / 12) : 0;
  return { med, hit, sd, octave, n: devs.length };
}

/* Tonfolge auswerten. live: Frames mit Zeit; sonst Zuordnung über Segmente */
function analyzeMatch(targets, track, live) {
  const notes = [];
  if (live) {
    for (const tg of targets) {
      const d = tg.t1 - tg.t0, from = tg.t0 + Math.min(0.18, d * 0.3);
      const fr = track.filter(f => f.t >= from && f.t <= tg.t1 + 0.05);
      const voiced = fr.filter(f => f.midi != null).map(f => f.midi);
      const vf = voiced.length / (fr.length || 1);
      const st = noteStats(voiced, tg.midi);
      notes.push({ tg, ...st, voicedFrac: vf, found: voiced.length >= 2, score: voiced.length >= 2 ? st.hit * Math.min(1, vf / 0.5) : 0 });
    }
  } else {
    const segs = segmentTrack(track);
    const map = alignTargets(targets, segs);
    targets.forEach((tg, i) => {
      const s = map[i];
      if (!s) { notes.push({ tg, found: false, score: 0, n: 0 }); return; }
      const st = noteStats(s.v.slice(Math.floor(s.v.length * 0.2)), tg.midi);
      notes.push({ tg, seg: s, ...st, voicedFrac: 1, found: true, score: st.hit });
    });
  }
  const found = notes.filter(n => n.found);
  const score = Math.round(100 * mean(notes.map(n => n.score)));
  const allDev = found.map(n => n.med);
  const avgDev = allDev.length ? mean(allDev) : 0;
  const avgSd = found.length ? mean(found.map(n => n.sd)) : 0;
  // hohe vs. tiefe Töne
  const sorted = [...found].sort((a, b) => a.tg.midi - b.tg.midi);
  const third = Math.max(1, Math.floor(sorted.length / 3));
  const lowDev = mean(sorted.slice(0, third).map(n => n.med));
  const highDev = mean(sorted.slice(-third).map(n => n.med));
  const octaves = found.map(n => n.octave);
  return { kind: "match", notes, score, avgDev, avgSd, lowDev, highDev, foundFrac: found.length / (notes.length || 1), octave: median(octaves) || 0 };
}

function analyzeSustain(target, track, opts = {}) {
  const v = track.filter(f => f.midi != null);
  const start = v.length ? v[0].t + 0.3 : 0;
  const use = v.filter(f => f.t >= start);
  const vals = use.map(f => f.midi);
  const st = noteStats(vals, target);
  const n = vals.length, third = Math.max(1, Math.floor(n / 3));
  const devs = vals.map(x => foldCents((x - target) * 100));
  const drift = n > 6 ? median(devs.slice(-third)) - median(devs.slice(0, third)) : 0;
  const dur = use.length ? use[use.length - 1].t - use[0].t + 0.3 : 0;
  const res = { kind: "sustain", target, ...st, drift, dur, score: Math.round(100 * st.hit * clamp(n / 20, 0, 1)) };
  if (opts.dyn && use.length > 8) {
    const db = use.map(f => 20 * Math.log10(f.rms + 1e-6));
    const sm = db.map((_, i) => mean(db.slice(Math.max(0, i - 4), i + 5)));
    const peakI = sm.indexOf(Math.max(...sm));
    res.dynRange = Math.max(...sm) - Math.min(...sm);
    res.peakPos = peakI / sm.length;
  }
  if (opts.vib && use.length > 30) {
    // Vibrato: Nulldurchgänge der trendbereinigten Tonhöhe
    const dt = (use[use.length - 1].t - use[0].t) / use.length;
    const w = Math.max(3, Math.round(0.4 / dt));
    const det = vals.map((x, i) => x - mean(vals.slice(Math.max(0, i - w), i + w + 1)));
    let zc = 0; for (let i = 1; i < det.length; i++) if (det[i - 1] < 0 && det[i] >= 0) zc++;
    res.vibRate = zc / (use[use.length - 1].t - use[0].t);
    res.vibExtent = 2 * stdev(det) * 100 * 1.41;
  }
  return res;
}

function analyzeGlide(track) {
  const v = track.filter(f => f.midi != null);
  if (v.length < 5) return { kind: "glide", score: 0, range: 0, empty: true };
  const vals = v.map(f => f.midi);
  const sorted = [...vals].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.03)], hi = sorted[Math.floor(sorted.length * 0.97)];
  // Lücken und Sprünge innerhalb der Sirene
  let gaps = 0, jumps = [];
  for (let i = 1; i < v.length; i++) {
    const dt = v[i].t - v[i - 1].t;
    if (dt > 0.15 && dt < 1.5) gaps++;
    else if (dt < 0.06 && Math.abs(v[i].midi - v[i - 1].midi) > 1.8) jumps.push((v[i].midi + v[i - 1].midi) / 2);
  }
  const range = hi - lo;
  const score = Math.round(clamp(range / 14, 0, 1) * 70 + clamp(1 - (gaps + jumps.length) / 6, 0, 1) * 30);
  return { kind: "glide", lo, hi, range, gaps, jumps, score };
}

function analyzeRange(track) {
  const segs = segmentTrack(track, 0.2);
  if (!segs.length) return null;
  const ms = segs.map(s => s.m).sort((a, b) => a - b);
  return { low: Math.round(ms[0]), high: Math.round(ms[ms.length - 1]) };
}

/* Längster zusammenhängender Laut (Zischen) */
function analyzeHiss(track) {
  const rs = track.map(f => f.rms), peak = Math.max(...rs, 0);
  const gate = Math.max(0.004, peak * 0.15);
  let best = 0, start = null, lastOn = 0;
  for (const f of track) {
    if (f.rms > gate) { if (start == null) start = f.t; lastOn = f.t; best = Math.max(best, lastOn - start); }
    else if (start != null && f.t - lastOn > 0.35) start = null;
  }
  return best;
}
