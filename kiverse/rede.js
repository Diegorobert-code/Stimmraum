// Reden mit der Figur einer App – ein Gehirn auf dem KI-Verse-Server (Diego 23.10. 18:57: «alle Apps auf den Server verbinden …
// alle Apps in Form des Gesprächs, so wie du»). Einbinden: <script src="/rede.js" data-figur="sparky" defer></script>
// Hört zu (Aufnahme, Ende nach Sprechpause, Text über den Server), antwortet mit der Figurenstimme, merkt sich alles auf dem Server.
(() => {
  if (window.__rede) return; window.__rede = true;
  const tag = document.currentScript, fid = (tag?.dataset.figur || new URLSearchParams(location.search).get('figur') || 'sunny').toLowerCase();
  const NAMEN = { sunny: 'Sunny', sparky: 'Sparky', otti: 'Otti', kimo: 'Kiki', jackie: 'Jacky', mrping: 'Mr. Ping', nova: 'Nova', mamaaffe: 'Mama Affe', fompa: 'Fompa', coinmaker: 'Coin Maker', waefwaef: 'Wäf Wäf', fia: 'Fia', ava: 'Ava', letti: 'Letti' };
  const name = tag?.dataset.name || NAMEN[fid] || 'Sunny';
  let K = new URLSearchParams(location.search).get('k');
  try { if (K) sessionStorage.setItem('kiverse_k', K); else K = sessionStorage.getItem('kiverse_k'); } catch {}
  if (!K) return; // ohne KI-Verse-Zugang bleibt die App wie sie ist
  const q = (p) => '/api/' + p + '?k=' + encodeURIComponent(K);
  const css = `.rede-k{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483000;font:700 16px system-ui,sans-serif}
.rede-k button{border:0;border-radius:999px;padding:14px 20px;background:linear-gradient(#ffd98a,#e8a93a);color:#1a1205;font:inherit;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer}
.rede-k button.an{background:linear-gradient(#ff9a8a,#e8573a);color:#fff;animation:rede-p 1.2s infinite}
.rede-k button.denkt{opacity:.75}
@keyframes rede-p{50%{box-shadow:0 0 0 10px rgba(232,87,58,.25)}}
.rede-b{position:fixed;left:max(16px,env(safe-area-inset-left));right:max(16px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 64px);z-index:2147483000;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.rede-b p{margin:0;max-width:min(520px,92%);padding:10px 14px;border-radius:16px;background:rgba(11,20,48,.92);color:#fff;font:500 15px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.3)}
.rede-b p.du{align-self:flex-end;background:rgba(232,169,58,.95);color:#1a1205}
.rede-b p b{color:#ffd98a}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const box = document.createElement('div'); box.className = 'rede-k'; const knopf = document.createElement('button'); knopf.type = 'button'; box.appendChild(knopf);
  const blasen = document.createElement('div'); blasen.className = 'rede-b';
  document.body.append(blasen, box);
  const anzeige = (art) => { knopf.className = art || ''; knopf.textContent = art === 'an' ? '🎙 Ich höre …' : art === 'denkt' ? `${name} denkt …` : art === 'spricht' ? `🔊 ${name} spricht` : `🎙 Mit ${name} reden`; };
  anzeige('');
  const blase = (wer, text, du) => { const p = document.createElement('p'); if (du) p.className = 'du'; else { const b = document.createElement('b'); b.textContent = wer + ': '; p.appendChild(b); } p.appendChild(document.createTextNode(text)); blasen.appendChild(p); while (blasen.children.length > 3) blasen.firstChild.remove(); clearTimeout(blase.t); blase.t = setTimeout(() => { blasen.innerHTML = ''; }, 25000); };
  const zustand = { an: false, rec: null, stopp: null, strom: null, ctx: null, audio: null };
  async function zuhoeren() {
    if (!zustand.strom || !zustand.strom.getAudioTracks().some(t => t.readyState === 'live')) zustand.strom = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    try { zustand.ctx = zustand.ctx || new (window.AudioContext || window.webkitAudioContext)(); await zustand.ctx.resume(); } catch {}
    const typ = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    const rec = new MediaRecorder(zustand.strom, typ ? { mimeType: typ } : undefined), teile = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) teile.push(e.data); };
    let an = null, puf = null, qu = null;
    if (zustand.ctx) try { qu = zustand.ctx.createMediaStreamSource(zustand.strom); an = zustand.ctx.createAnalyser(); an.fftSize = 1024; qu.connect(an); puf = new Float32Array(an.fftSize); } catch { an = null; }
    const t0 = performance.now(); let rau = 0, n = 0, gesprochen = false, still = 0, timer = 0;
    return new Promise(ok => {
      const ende = () => { clearInterval(timer); try { qu?.disconnect(); } catch {} if (rec.state !== 'inactive') rec.stop(); };
      zustand.stopp = ende; zustand.rec = rec; anzeige('an');
      rec.onstop = async () => {
        zustand.rec = null; zustand.stopp = null;
        const blob = new Blob(teile, { type: rec.mimeType || typ || 'audio/webm' });
        if ((an && !gesprochen) || blob.size < 1200) return ok('');
        anzeige('denkt');
        try {
          const b64 = await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1] || ''); f.readAsDataURL(blob); });
          const d = await (await fetch(q('hoeren'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: b64, typ: blob.type }) })).json();
          ok((d.text || '').trim());
        } catch { ok(''); }
      };
      rec.start(250);
      timer = setInterval(() => {
        const j = performance.now(), dauer = j - t0;
        if (an) {
          an.getFloatTimeDomainData(puf); let s = 0; for (const v of puf) s += v * v; const rms = Math.sqrt(s / puf.length);
          if (dauer < 350) { rau += rms; n++; return; }
          if (rms > Math.max(.012, (rau / Math.max(1, n)) * 2.6)) { gesprochen = true; still = 0; } else if (gesprochen) { still = still || j; if (j - still > 1000) return ende(); }
          if (!gesprochen && dauer > 9000) return ende();
        } else if (dauer > 7000) return ende();
        if (dauer > 30000) ende();
      }, 60);
    });
  }
  async function sprechen(text) {
    anzeige('spricht');
    try {
      const r = await fetch(q('stimme'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ figur: fid, text }) });
      if (r.status === 200) { const a = zustand.audio = new Audio(URL.createObjectURL(await r.blob())); await new Promise(ok => { a.onended = a.onerror = ok; a.play().catch(ok); }); return; }
    } catch {}
    if ('speechSynthesis' in window) await new Promise(ok => { const u = new SpeechSynthesisUtterance(text); u.lang = 'de-CH'; u.onend = u.onerror = ok; speechSynthesis.speak(u); setTimeout(ok, 60000); });
  }
  async function runde() {
    while (zustand.an) {
      let t = ''; try { t = await zuhoeren(); } catch { blase(name, 'Ich darf dein Mikrofon nicht benutzen. Bitte erlauben.'); break; }
      if (!zustand.an) break;
      if (!t) { blase(name, 'Ich habe nichts gehört. Tipp nochmals, wenn du reden willst.'); break; }
      blase('Du', t, true); anzeige('denkt');
      let a = null; try { a = (await (await fetch(q('figur'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ figur: fid, text: t }) })).json()); } catch {}
      const antwort = a?.text || a?.fehler || 'Hm, die Verbindung wackelt. Sag es nochmals.';
      blase(name, antwort); if (!zustand.an) break; await sprechen(antwort);
    }
    zustand.an = false; anzeige('');
  }
  knopf.onclick = () => {
    if (zustand.an) { zustand.an = false; zustand.stopp?.(); try { zustand.audio?.pause(); speechSynthesis.cancel(); } catch {} anzeige(''); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices) { blase(name, 'Dieses Gerät kann hier leider nicht zuhören.'); return; }
    zustand.an = true; runde();
  };
})();
