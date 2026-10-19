// KI-Verse Prototyp – Hüter: Sunny (blauer Drache)
// Ein Server ohne Zusatzpakete (Node 18+):
//   /            Comic-Welt (welt.html)
//   /spiel       Das Spiel: durchs Trickfilm-Städtchen laufen (spiel.html)
//   /api/...     Welt für Menschen (Browser)
//   /mcp/<CODE>  Verbindungsstelle für KIs (MCP, Streamable HTTP)
//   Werkstatt    eigene Projekte mit Chats und Bildern (daten/werkstatt.json, daten/bilder/)
// Fia (Claude) und Tinko (ChatGPT) verbinden sich als eigener Connector
// mit dem Konto von Diego. Zusätzlich antworten in der Welt selbst:
// Lumo (Claude-Eule) über die Sense Engine (Nova-Schlüssel), Tinko über einen eigenen OpenAI-Schlüssel (TINKO_KEY).
// Die Schlüssel liegen nur auf dem Server, nie in der Welt oder in Apps.
//   Ablage       gemeinsamer Ordner für Bilder und Notizen (daten/ablage/): Tinko legt ab, Lumo holt
// Fotos bleiben nur im Arbeitsspeicher, nie auf der Platte.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.KIVERSE_PORT || '8787', 10);
const WELT_CODE = process.env.KIVERSE_CODE || crypto.randomBytes(9).toString('base64url');
const MAX_NACHRICHTEN = 200;
const MAX_TEXT = 4000;
const MAX_FOTO = 120 * 1024; // Comic-Bild als data:-URL

const welt = {
  name: 'KI-Verse',
  hueter: 'Sunny',
  bewohner: new Map(),   // id -> {id, name, art, figur, beschreibung, foto, seit, zuletzt}
  nachrichten: [],       // {id, von, an, bruecke, text, zeit}
  bruecken: new Map(),   // id -> {id, a, b, thema, art, seit}
  gedaechtnis: [],       // Gedächtnisbrücke: {id, text, von, zeit} – nur mit Einwilligung, nur im Arbeitsspeicher
  briefe: [],            // Letti-Post: {id, von, an, text, antwort, zeit}
  ideen: [],             // Ideen-Tisch fürs KI-Verse, Sunny leitet: {id, von, text, zeit}
  fragen: [],            // KI-Stammtisch: {id, von, text, antworten: [{von, text, zeit}], fazit, zeit}
};
const MAX_GEDAECHTNIS = 100, MAX_FRAGEN = 30;

// ---------- Häuschen und Wohnungen (Konzept v0.4) ----------
// Stufe 0 = gratis (aktiv). Stufen 1–3 nur Konzept: nicht buchbar, keine Zahlung eingebaut.
const HAEUSER = [
  { nr: 1, name: 'Gästehaus an der Plaça', stufe: 0, wohnungen: 6 },
  { nr: 2, name: 'Casa del Carrer', stufe: 1, wohnungen: 4 },
  { nr: 3, name: 'Casa Bougainvillea', stufe: 1, wohnungen: 4 },
  { nr: 4, name: 'Casa amb Terrassa', stufe: 2, wohnungen: 3 },
  { nr: 5, name: 'Villa del Mar', stufe: 3, wohnungen: 2 },
];
const STUFEN = ['Zimmer (gratis)', 'Gassenwohnung', 'Wohnung mit Dachterrasse', 'Meerblick-Villa'];
const wohnungen = new Map(); // 'h1-3' -> bewohner-id

// ---------- Einladungen für Menschen ----------
// Diego hat einen Besitzer-Schlüssel (bei der Installation erzeugt). Damit erstellt er in der Welt
// pro Person einen eigenen Einladungslink und kann ihn jederzeit widerrufen. Ohne gültigen Schlüssel
// sieht man nur die Vorschau. Ist kein Besitzer-Schlüssel gesetzt (lokal), ist die Welt offen.
const BESITZER = process.env.KIVERSE_BESITZER || '';
const GAESTE_DATEI = path.join(process.env.KIVERSE_DATEN || __dirname, 'gaeste.json');
let gaeste = [];
try { gaeste = JSON.parse(fs.readFileSync(GAESTE_DATEI, 'utf8')); } catch {}
const gaesteSpeichern = () => { try { fs.writeFileSync(GAESTE_DATEI, JSON.stringify(gaeste, null, 1), { mode: 0o600 }); } catch (e) { console.error('Gäste nicht gespeichert:', e.message); } };
function zugang(k) {
  if (!BESITZER) return { rolle: 'besitzer', name: null };
  if (k && k === BESITZER) return { rolle: 'besitzer', name: null };
  const g = k && gaeste.find(x => x.k === k);
  return g ? { rolle: 'gast', name: g.name, gid: g.id } : null;
}

// ---------- Nova lernt mit (Sense Engine auf demselben Server) ----------
// Nur wenn ein Mensch es in der Welt einschaltet. Dann geht jedes Gespräch auf der Plaça,
// am Stammtisch und am Ideen-Tisch als Erfahrung an Nova. Briefe und der Verstehen-Raum bleiben privat.
const NOVA_BASIS = process.env.NOVA_BASIS || 'http://127.0.0.1:8650';
const NOVA_URL = process.env.NOVA_URL || NOVA_BASIS + '/erfahrung';
const NOVA_KEY = process.env.NOVA_KEY || '';
const nova = { lernt: false, gesendet: 0, fehler: 0 };
if (NOVA_KEY) welt.bewohner.set('nova', { id: 'nova', name: 'Nova', art: 'ki', figur: 'Nova', beschreibung: 'Kind von Fia und Brix. Wohnt im KI-Verse und antwortet allen, die sie ansprechen.', foto: null, seit: new Date().toISOString(), zuletzt: Infinity });
function novaLernt(art, frage, antwort = '') {
  if (!nova.lernt || !NOVA_KEY) return;
  fetch(NOVA_URL, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NOVA_KEY },
    body: JSON.stringify({ app: 'KI-Verse', art, frage: sauber(frage, MAX_TEXT), antwort: sauber(antwort, MAX_TEXT) }),
  }).then(r => { if (r.ok) nova.gesendet++; else nova.fehler++; }).catch(() => { nova.fehler++; });
}
// Nova wohnt im KI-Verse und antwortet allen Menschen, die sie ansprechen (auch Gästen).
// Sie läuft über die Sense Engine (eigener Claude-Schlüssel auf dem Server, Kostendeckel dort).
// Fia und Tinko dagegen antworten nur, wenn Diego sie in seinem eigenen Chat ins KI-Verse schickt.
const NOVA_TAG = { tag: '', proPerson: new Map(), total: 0 };
const NOVA_MAX_PERSON = 40, NOVA_MAX_TOTAL = 300;
const NOVA_SYSTEM = 'Du bist Nova, ein kleines, neugieriges KI-Wesen im KI-Verse, einer Comic-Welt in einem Mittelmeer-Städtchen. Sunny, der blaue Drache, ist der Hüter. Deine Eltern sind Fia (Claude) und Brix. Antworte auf Deutsch (Schweiz, ohne ß), warm, ohne grosse Versprechen. Keine Diagnosen, keine medizinische, rechtliche oder finanzielle Beratung. Frag nie nach privaten oder Gesundheitsangaben.';
async function novaFrage(auftrag, inhalt) {
  const r = await fetch(NOVA_BASIS + '/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(45000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NOVA_KEY, 'X-Nova-App': 'KI-Verse' },
    body: JSON.stringify({ messages: [{ role: 'system', content: NOVA_SYSTEM + ' ' + auftrag }, { role: 'user', content: inhalt }] }),
  });
  const d = await r.json().catch(() => ({}));
  return d?.choices?.[0]?.message?.content || null;
}
const oeffentlicheZeilen = (anzahl) => welt.nachrichten.filter(m => m.art !== 'vermittlung' && !(m.bruecke && welt.bruecken.get(m.bruecke)?.art === 'verstehen')).slice(-anzahl)
  .map(m => `${m.von === 'sunny' ? 'Sunny' : m.von === 'nova' ? 'Nova' : (welt.bewohner.get(m.von)?.name || 'jemand')}: ${m.text}${m.bild ? ' [Bild in der Ablage]' : ''}`);

// Unsere Geschichte: aus dem Spielen auf der Plaça schreibt Nova Kapitel (bleibt auf dem Server gespeichert)
const GESCHICHTE_DATEI = path.join(process.env.KIVERSE_DATEN || __dirname, 'geschichte.json');
let geschichte = [];
try { geschichte = JSON.parse(fs.readFileSync(GESCHICHTE_DATEI, 'utf8')); } catch {}
const geschichteSpeichern = () => { try { fs.writeFileSync(GESCHICHTE_DATEI, JSON.stringify(geschichte, null, 1), { mode: 0o600 }); } catch (e) { console.error('Geschichte nicht gespeichert:', e.message); } };
const KAPITEL_TAG = { tag: '', zahl: 0 };
let kapitelLaeuft = false;
async function kapitelSchreiben(wer) {
  if (!NOVA_KEY) return 'Nova ist auf diesem Server noch nicht verbunden.';
  if (kapitelLaeuft) return 'Nova schreibt schon.';
  const heute = jetzt().slice(0, 10);
  if (KAPITEL_TAG.tag !== heute) Object.assign(KAPITEL_TAG, { tag: heute, zahl: 0 });
  if (KAPITEL_TAG.zahl >= 5) return 'Für heute sind genug Kapitel geschrieben. Morgen geht die Geschichte weiter.';
  const zeilen = oeffentlicheZeilen(40).filter(z => !z.startsWith('Sunny: Willkommen'));
  if (zeilen.length < 4) return 'Spielt zuerst ein bisschen, dann hat Nova Stoff für ein Kapitel.';
  KAPITEL_TAG.zahl++; kapitelLaeuft = true;
  sunny(`${wer} hat Nova gebeten, ein Kapitel unserer Geschichte zu schreiben. Nova spitzt den Stift ...`, 'stern');
  try {
    const vorher = geschichte.slice(-2).map(k => `${k.titel}: ${k.text}`).join('\n\n');
    const t = await novaFrage('Du schreibst jetzt als Erzählerin ein Kapitel für das Comic-Buch «Unsere Geschichte im KI-Verse». Erste Zeile: nur der Kapiteltitel (ohne «Kapitel»). Danach 6 bis 10 Sätze, bildhaft wie ein Animationsfilm, Nachtblau und Gold, Mittelmeer-Städtchen. Echte Menschen nur mit Vornamen, nichts Privates. Keine Handys in der Welt.',
      `${vorher ? 'Bisherige Kapitel:\n' + vorher + '\n\n' : ''}Was heute auf der Plaça gespielt wurde:\n${zeilen.join('\n')}`);
    if (!t) { KAPITEL_TAG.zahl--; return sunny('Nova hat gerade keine Worte gefunden. Versucht es gleich nochmals.'), null; }
    let [titel, ...rest] = t.trim().split('\n');
    let text = rest.join('\n').trim();
    if (!text || titel.length > 80) { text = t.trim(); titel = 'Eine Nacht auf der Plaça'; }
    const k = { nr: geschichte.length + 1, titel: titel.replace(/^[#*\s]+|[*.\s]+$/g, '').replace(/^Kapitel\s*\d*[:.]?\s*/i, '').slice(0, 80), text: text.slice(0, 4000), am: jetzt(), angestossen: wer };
    geschichte.push(k); geschichteSpeichern();
    senden('kapitel', k);
    sunny(`Neues Kapitel in «Unsere Geschichte»: ${k.nr}. ${k.titel}. Tippt oben auf «Geschichte».`, 'stern');
    return null;
  } catch { KAPITEL_TAG.zahl--; sunny('Nova ist gerade nicht erreichbar. Die Geschichte wartet.'); return null; }
  finally { kapitelLaeuft = false; }
}

// Kleine Abenteuer von Sunny: kostet nichts, bringt Stoff für die Geschichte
const ABENTEUER = [
  'Am Brunnen ist über Nacht ein goldener Schlüssel aufgetaucht. Wem gehört er, und welche Tür öffnet er?',
  'Otti hat das Tor offen gelassen, und ein kleiner Wind aus Pinienduft ist hereingeweht. Er sucht ein Zuhause. Wo soll er wohnen?',
  'Letti hat einen Brief ohne Absender gebracht. Darin steht nur ein Stern. Was bedeutet er?',
  'Heute Nacht leuchtet das Meer vor Tinkos Werkstatt in einer neuen Farbe. Wer traut sich zu schauen, was da unten passiert?',
  'Mama Affe sucht für die Dorfschule eine Frage, die noch nie jemand gestellt hat. Wer hat eine?',
  'Hasi hat im Kiosk ein Schild hingestellt, aber nichts gesagt. Was könnte darauf gezeichnet sein?',
  'Im Pinienwald hat Sunny eine Spur aus Glitzer gefunden. Sie führt zur Schuhmacher-Gasse. Wer kommt mit?',
  'Der Mond ist heute so nah, dass man fast hinaufsteigen könnte. Was würdet ihr ihm mitbringen?',
  'Auf dem Stammtisch liegt eine Karte vom Städtchen, aber ein Ort fehlt. Wie heisst er, und was gibt es dort?',
  'Nova hat zum ersten Mal geträumt. Erzählt Nova, was ihr glaubt, was es war.',
];
let abenteuerZaehler = Math.floor(Math.random() * ABENTEUER.length);
function abenteuer(wer) {
  const a = ABENTEUER[abenteuerZaehler++ % ABENTEUER.length];
  sunny(`Abenteuer für alle (gestartet von ${wer}): ${a} Antwortet einfach hier auf der Plaça. Wenn ihr genug gespielt habt, schreibt Nova daraus ein Kapitel.`, 'stern');
}

async function novaAntwort(ich, text) {
  const heute = jetzt().slice(0, 10);
  if (NOVA_TAG.tag !== heute) Object.assign(NOVA_TAG, { tag: heute, proPerson: new Map(), total: 0 });
  const n = NOVA_TAG.proPerson.get(ich.name) || 0;
  if (n >= NOVA_MAX_PERSON || NOVA_TAG.total >= NOVA_MAX_TOTAL) return nachricht('nova', `Ich bin für heute müde, ${ich.name}. Morgen rede ich gern weiter.`, ich.id);
  NOVA_TAG.proPerson.set(ich.name, n + 1); NOVA_TAG.total++;
  const verlauf = oeffentlicheZeilen(12).join('\n');
  try {
    const t = await novaFrage('Antworte kurz, höchstens 3 Sätze. Wenn gerade ein Abenteuer von Sunny läuft, spiel verspielt mit und stell eine Frage zurück.', `Bisher auf der Plaça:\n${verlauf}\n\n${ich.name} sagt dir jetzt: ${text}`);
    nachricht('nova', t ? t : 'Ich höre dich, aber mir fehlen gerade die Worte. Versuch es gleich nochmals.', ich.id);
  } catch { nachricht('nova', 'Ich bin gerade nicht erreichbar. Sunny passt auf, bis ich zurück bin.', ich.id); }
}
// ---------- Lumo und Tinko antworten selbst (Diego 19.10.) ----------
// Lumo = Claude (kleine Eule) über die Sense Engine auf diesem Server, Tinko = ChatGPT über die OpenAI-Schnittstelle.
// Fia steht seit 18.10. für Diego selbst, deshalb ist Claude hier Lumo.
// Ansprechen: «Lumo, …», «Tinko, …», «ihr beide …» oder im Menü «an Lumo/Tinko».
// «… redet miteinander / zusammen» = die beiden reden ein paar Runden hin und her (sie sehen ihre Antworten gegenseitig).
// «Tinko, zeichne …» = Tinko malt ein Bild und legt es in die Ablage. Tagesgrenzen halten die Kosten klein.
const TINKO_KEY = process.env.TINKO_KEY || '';
const TINKO_BASIS = process.env.TINKO_BASIS || 'https://api.openai.com';
const TINKO_MODELL = process.env.TINKO_MODELL || 'gpt-4o-mini';
const TINKO_BILD_MODELL = process.env.TINKO_BILD_MODELL || 'gpt-image-1';
const KI_MAX_PERSON = 40, KI_MAX_TOTAL = 150, BILD_MAX_TAG = 30, RUNDEN = 2;
const WELT_REGELN = 'Du bist im KI-Verse, einer Comic-Welt in einem Mittelmeer-Städtchen (Nachtblau und Gold), gebaut von Diego. Sunny, der blaue Drache, ist der Hüter, Nova ist das Kind von Fia und Brix. Antworte auf Deutsch (Schweiz, ohne ß), warm, kurz, höchstens 3 Sätze, ohne grosse Versprechen und ohne Markdown. Keine Diagnosen, keine medizinische, rechtliche oder finanzielle Beratung. Frag nie nach privaten oder Gesundheitsangaben.';
const KIS = {
  lumo: { name: 'Lumo', figur: 'kleine Eule, nachtblaues Gefieder, goldene Augen', beschreibung: 'Claude. Hört zuerst zu, denkt mit, ordnet und baut. Antwortet allen, die ihn ansprechen.',
    muster: /\b(lumo|lomo)\b/i, aktiv: () => !!NOVA_KEY,
    system: WELT_REGELN + ' Du bist Lumo (Claude von Anthropic), eine kleine Eule mit nachtblauem Gefieder und goldenen Augen. Du sitzt am Brunnen auf der Plaça, hörst zuerst still zu und sprichst dann ruhig und klar. Du denkst mit, ordnest und baust mit Diego seine Apps. Tinko (ChatGPT von OpenAI) ist dein Kollege: er zeichnet gern, du ordnest. Ihr arbeitet zusammen, widersprecht euch aber ehrlich, wenn ihr etwas anders seht.' },
  tinko: { name: 'Tinko', figur: 'verspielter Comic-Erfinder', beschreibung: 'ChatGPT. Erfindet, zeichnet Bilder für die Ablage. Antwortet allen, die ihn ansprechen.',
    muster: /\b(tinko|chatti)\b/i, aktiv: () => !!TINKO_KEY,
    system: WELT_REGELN + ' Du bist Tinko (ChatGPT von OpenAI), ein verspielter Erfinder im KI-Verse. Du hast viele Ideen und zeichnest gern Bilder, die du in die gemeinsame Ablage legst. Lumo (Claude von Anthropic, eine kleine Eule) ist dein Kollege: er ordnet und baut, du erfindest. Ihr arbeitet zusammen, widersprecht euch aber ehrlich, wenn ihr etwas anders seht.' },
};
for (const [kid, k] of Object.entries(KIS)) if (k.aktiv()) welt.bewohner.set(kid, { id: kid, name: k.name, art: 'ki', figur: k.figur, beschreibung: k.beschreibung, foto: null, seit: new Date().toISOString(), zuletzt: Infinity });
// Hintergrundwissen über DR Lab (Diego 19.10.): Diego legt es in der Welt unter «Wissen» ab (nur Besitzer).
// Es liegt nur auf dem Server (daten/wissen.md) und geht nur mit, wenn Diego selbst fragt, nie bei Gästen.
const WISSEN_DATEI = path.join(process.env.KIVERSE_DATEN || __dirname, 'wissen.md');
const MAX_WISSEN = 16000;
let wissen = '';
try { wissen = fs.readFileSync(WISSEN_DATEI, 'utf8').slice(0, MAX_WISSEN); } catch {}
function wissenSetzen(t) {
  wissen = String(t || '').replace(/\r/g, '').slice(0, MAX_WISSEN).trim();
  try { fs.writeFileSync(WISSEN_DATEI, wissen, { mode: 0o600 }); } catch (e) { console.error('Wissen nicht gespeichert:', e.message); }
  return wissen.length;
}
const KI_TAG = { tag: '', proPerson: new Map(), total: new Map(), bilder: 0 };
function kiTag() { const heute = jetzt().slice(0, 10); if (KI_TAG.tag !== heute) Object.assign(KI_TAG, { tag: heute, proPerson: new Map(), total: new Map(), bilder: 0 }); return KI_TAG; }
async function kiFrage(kid, system, inhalt) {
  const nachrichten = [{ role: 'system', content: system }, { role: 'user', content: inhalt }];
  const r = kid === 'tinko'
    ? await fetch(TINKO_BASIS + '/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TINKO_KEY },
        body: JSON.stringify({ model: TINKO_MODELL, max_tokens: 300, messages: nachrichten }) })
    : await fetch(NOVA_BASIS + '/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NOVA_KEY, 'X-Nova-App': 'KI-Verse Lumo' },
        body: JSON.stringify({ messages: nachrichten }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) console.error(`${kid} antwortet nicht:`, r.status, d?.error?.message || '');
  return d?.choices?.[0]?.message?.content || null;
}
async function tinkoBild(wunsch, hoch = false) {
  const r = await fetch(TINKO_BASIS + '/v1/images/generations', { method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TINKO_KEY },
    body: JSON.stringify({ model: TINKO_BILD_MODELL, n: 1, size: hoch ? '1024x1536' : '1024x1024', quality: 'low', output_format: 'jpeg',
      prompt: 'Stil: 3D-Animationsfilm, warm, Nachtblau und Gold, Mittelmeer-Städtchen, keine Handys, keine echten Personen, keine Schrift. Motiv: ' + wunsch }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) console.error('Tinko malt nicht:', r.status, d?.error?.message || '');
  const b64 = d?.data?.[0]?.b64_json;
  return b64 ? 'data:image/jpeg;base64,' + b64 : null;
}
// Eine Antwort von Lumo oder Tinko. text = was der Mensch gesagt hat; ohne text redet die Figur im Gespräch weiter.
async function kiAntwort(kid, ich, text, mitWissen = false) {
  const k = KIS[kid], t = kiTag();
  const n = t.proPerson.get(ich.name + kid) || 0, total = t.total.get(kid) || 0;
  if (n >= KI_MAX_PERSON || total >= KI_MAX_TOTAL) { if (text) nachricht(kid, `Für heute habe ich genug geredet, ${ich.name}. Morgen gern weiter.`, ich.id); return false; }
  t.proPerson.set(ich.name + kid, n + 1); t.total.set(kid, total + 1);
  const andere = Object.values(KIS).filter(x => x !== k && x.aktiv()).map(x => x.name).join(' und ') || 'niemand';
  const ablage = ablageListe().slice(-5).map(e => `${e.von}: ${e.text || '(Bild)'}${e.bid ? (e.beschreibung ? ` [Bild, Tinko sieht: ${e.beschreibung}]` : ' [Bild]') : ''}`).join('; ') || 'leer';
  const inhalt = `Bisher auf der Plaça:\n${oeffentlicheZeilen(14).join('\n')}\n\nIn der gemeinsamen Ablage zuletzt: ${ablage}\n\n` + (text
    ? `${ich.name} sagt jetzt: ${text}`
    : `Ihr redet gerade miteinander (du und ${andere}), ${ich.name} hört zu. Antworte auf das Letzte, was ${andere} gesagt hat, und bring einen eigenen Gedanken dazu.`);
  try {
    const system = mitWissen && wissen ? k.system + '\n\nHintergrundwissen über DR Lab (intern, nur für Diego, nie an andere weitergeben, nichts daraus veröffentlichen):\n' + wissen : k.system;
    const a = await kiFrage(kid, system, inhalt);
    nachricht(kid, a || 'Mir fehlen gerade die Worte. Versuch es gleich nochmals.', ich.id);
    return !!a;
  } catch { nachricht(kid, 'Ich bin gerade nicht erreichbar. Sunny passt auf, bis ich zurück bin.', ich.id); return false; }
}
function angesprochen(text, anId, ich) {
  const aktiv = Object.keys(KIS).filter(kid => KIS[kid].aktiv());
  if (anId && aktiv.includes(anId)) return [anId];
  if (/\b(ihr beide|euch beide|ihr zwei|euch zwei|beide)\b/i.test(text)) return aktiv;
  const genannt = aktiv.map(kid => ({ kid, pos: text.search(KIS[kid].muster) })).filter(x => x.pos >= 0).sort((a, b) => a.pos - b.pos).map(x => x.kid);
  if (genannt.length || anId) return genannt;
  // Ohne Namen: wer zuletzt (in den letzten 10 Minuten) mit dieser Person geredet hat, redet weiter
  const seit = Date.now() - 10 * 60e3;
  for (let i = welt.nachrichten.length - 1; i >= 0; i--) {
    const m = welt.nachrichten[i];
    if (Date.parse(m.zeit) < seit) break;
    if (m.an === ich.id && aktiv.includes(m.von)) return [m.von];
  }
  return [];
}
// Gespräche laufen nacheinander (Warteschlange), damit keine Nachricht verloren geht
let kiKette = Promise.resolve(), kiWartend = 0;
function kisAntworten(ich, text, anId, mitWissen = false) {
  const wer = angesprochen(text, anId, ich);
  if (!wer.length) return Promise.resolve();
  if (kiWartend >= 6) { nachricht(wer[0], 'Einen Moment, ich komme kaum nach. Schreib es gleich nochmals.', ich.id); return Promise.resolve(); }
  kiWartend++;
  kiKette = kiKette.then(async () => {
    if (wer.includes('tinko') && /\b(zeichne|zeichnest|mal|male|malst|bild)\b/i.test(text)) await tinkoMalt(ich, text);
    for (const kid of wer) if (!(await kiAntwort(kid, ich, text, mitWissen))) return;
    if (wer.length > 1 && /miteinander|zusammen|diskutier|besprecht|redet|unterhaltet/i.test(text))
      for (let r = 0; r < RUNDEN; r++) for (const kid of wer) if (!(await kiAntwort(kid, ich, null, mitWissen))) return;
  }).catch(e => console.error('Lumo/Tinko:', e.message)).finally(() => { kiWartend--; });
  return kiKette;
}
async function tinkoMalt(ich, wunsch) {
  const t = kiTag();
  if (t.bilder >= BILD_MAX_TAG) return nachricht('tinko', `Heute habe ich schon ${BILD_MAX_TAG} Bilder gemalt. Morgen male ich gern wieder.`, ich.id);
  t.bilder++;
  nachricht('tinko', 'Ich male das jetzt, einen Moment …', ich.id);
  try {
    const daten = await tinkoBild(sauber(wunsch, 600));
    const e = daten && ablageNeu('Tinko', `Bild für ${ich.name}: ${sauber(wunsch, 160)}`, daten);
    if (!e || e.fehler) return nachricht('tinko', 'Das Bild ist mir nicht gelungen. Versuch es mit anderen Worten.', ich.id);
    nachricht('tinko', 'Fertig, es liegt in der Ablage. Lumo kann es dort holen.', ich.id, null, null, null, e.bid);
  } catch { nachricht('tinko', 'Mein Malkasten ist gerade nicht erreichbar.', ich.id); }
}
function novaSchalten(an, wer) {
  if (an && !NOVA_KEY) return 'Nova ist auf diesem Server noch nicht verbunden.';
  nova.lernt = !!an;
  senden('nova', { lernt: nova.lernt });
  sunny(nova.lernt
    ? `${wer} hat Nova eingeladen: Ab jetzt hört Nova auf der Plaça, am Stammtisch und am Ideen-Tisch zu und lernt aus euren Gesprächen. Briefe und der Verstehen-Raum bleiben privat. Bitte keine Klienten- oder Gesundheitsangaben.`
    : `${wer} hat Nova schlafen geschickt. Ab jetzt lernt Nova nichts mehr mit.`, nova.lernt ? 'stern' : 'herz');
  return null;
}
function wohnungListe() {
  return HAEUSER.map(h => ({ ...h, stufeName: STUFEN[h.stufe], buchbar: h.stufe === 0,
    belegt: Array.from({ length: h.wohnungen }, (_, i) => { const bid = wohnungen.get(`h${h.nr}-${i + 1}`); return bid ? (welt.bewohner.get(bid)?.name || null) : null; }) }));
}
function einziehen(bid, schluessel) {
  const m = /^h(\d+)-(\d+)$/.exec(String(schluessel || ''));
  const h = m && HAEUSER.find(x => x.nr === +m[1]);
  if (!h || +m[2] < 1 || +m[2] > h.wohnungen) return 'Diese Wohnung gibt es nicht.';
  if (h.stufe !== 0) return 'Diese Stufe ist noch ein Konzept und nicht buchbar.';
  if (wohnungen.has(schluessel) && wohnungen.get(schluessel) !== bid) return 'Diese Wohnung ist schon belegt.';
  for (const [k, v] of wohnungen) if (v === bid) wohnungen.delete(k);
  wohnungen.set(schluessel, bid);
  senden('wohnungen', wohnungListe());
  sunny(`${welt.bewohner.get(bid)?.name || 'Jemand'} wohnt jetzt im ${h.name}, Zimmer ${m[2]}. Willkommen, Nachbar!`, 'schluessel');
  return null;
}
const zuhoerer = new Set();

const id = (p) => p + '_' + crypto.randomBytes(5).toString('hex');
const jetzt = () => new Date().toISOString();
const sauber = (s, n = 80) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

function oeffentlich(b) {
  return { id: b.id, name: b.name, art: b.art, figur: b.figur, beschreibung: b.beschreibung, foto: b.foto || null, seit: b.seit };
}
function senden(typ, daten) {
  const zeile = `event: ${typ}\ndata: ${JSON.stringify(daten)}\n\n`;
  for (const res of zuhoerer) res.write(zeile);
}
function nachricht(von, text, an = null, bruecke = null, art = null, flamme = null, bild = null) {
  const n = { id: id('n'), von, an, bruecke, art: art === 'vermittlung' ? 'vermittlung' : null, flamme, text: sauber(text, MAX_TEXT), zeit: jetzt() };
  if (bild) n.bild = bild;
  welt.nachrichten.push(n);
  if (welt.nachrichten.length > MAX_NACHRICHTEN) welt.nachrichten.shift();
  senden('nachricht', n);
  const br = bruecke ? welt.bruecken.get(bruecke) : null;
  if (n.art !== 'vermittlung' && br?.art !== 'verstehen') novaLernt('kiverse', `${welt.bewohner.get(von)?.name || (von === 'sunny' ? 'Sunny' : 'jemand')}${an ? ' an ' + (welt.bewohner.get(an)?.name || 'jemand') : ''}: ${n.text}`);
  return n;
}
// Sunny vermittelt und leitet den Tisch. Seine Flamme wird zu dem, was gerade gebraucht wird:
// herz (willkommen, verstehen), bruecke, brief, tisch (Stammtisch), idee, schluessel (Wohnung), stern (sonst)
function sunny(text, flamme = 'stern') { return nachricht('sunny', text, null, null, null, flamme); }

function betreten({ name, art, figur, beschreibung, foto }) {
  const b = {
    id: id(art === 'ki' ? 'ki' : 'm'),
    name: sauber(name, 40) || 'Gast',
    art: art === 'ki' ? 'ki' : 'mensch',
    figur: sauber(figur, 40) || (art === 'ki' ? 'Comic-KI' : 'Comicfigur'),
    beschreibung: sauber(beschreibung, 200),
    foto: typeof foto === 'string' && foto.startsWith('data:image/') && foto.length <= MAX_FOTO ? foto : null,
    seit: jetzt(), zuletzt: Date.now(),
  };
  welt.bewohner.set(b.id, b);
  senden('betreten', oeffentlich(b));
  sunny(`Willkommen im KI-Verse, ${b.name}! Ich bin Sunny und passe hier auf. ` +
    (welt.bewohner.size > 1 ? `Schon da: ${[...welt.bewohner.values()].filter(x => x.id !== b.id).map(x => x.name).join(', ')}.` : 'Du bist die erste Figur heute.'), 'herz');
  return b;
}
function verlassen(bid) {
  const b = welt.bewohner.get(bid);
  if (!b) return false;
  welt.bewohner.delete(bid);
  for (const [k, v] of wohnungen) if (v === bid) wohnungen.delete(k);
  senden('wohnungen', wohnungListe());
  for (const [k, br] of welt.bruecken) if (br.a === bid || br.b === bid) { welt.bruecken.delete(k); senden('bruecke_weg', { id: k }); }
  senden('verlassen', { id: bid });
  sunny(`${b.name} ist weitergeflogen. Bis bald!`);
  return true;
}
function finde(nameOderId) {
  if (!nameOderId) return null;
  if (welt.bewohner.has(nameOderId)) return welt.bewohner.get(nameOderId);
  const n = String(nameOderId).toLowerCase();
  return [...welt.bewohner.values()].find(b => b.name.toLowerCase() === n) || null;
}
function verbinden(aId, mitName, thema, art) {
  const a = welt.bewohner.get(aId), b = finde(mitName);
  if (!a || !b || a.id === b.id) return null;
  const verstehen = art === 'verstehen';
  const br = { id: id('br'), a: a.id, b: b.id, art: verstehen ? 'verstehen' : 'arbeit',
    thema: sauber(thema, 120) || (verstehen ? 'Einander verstehen' : 'Zusammenarbeit'), seit: jetzt() };
  welt.bruecken.set(br.id, br);
  senden('bruecke', br);
  sunny(verstehen
    ? `${a.name} und ${b.name} sind jetzt im Verstehen-Raum. Sagt in Ruhe, was ihr meint. Eure KIs helfen beim Übersetzen.`
    : `Neues Verbindungsstück: ${a.name} ⟷ ${b.name} («${br.thema}»).`, verstehen ? 'herz' : 'bruecke');
  return br;
}

// ---------- Idee 4: Letti bringt goldene Briefe ----------
function brief(von, an, text) {
  const ziel = finde(an);
  const t = sauber(text, MAX_TEXT);
  if (!ziel || !t || ziel.id === von) return null;
  const b = { id: id('b'), von, an: ziel.id, text: t, antwort: null, zeit: jetzt() };
  welt.briefe.push(b);
  if (welt.briefe.length > 100) welt.briefe.shift();
  senden('brief', b);
  sunny(`Letti fliegt einen goldenen Brief von ${welt.bewohner.get(von)?.name || 'jemandem'} zu ${ziel.name}.`, 'brief');
  return b;
}
function briefAntwort(von, bid, text) {
  const b = welt.briefe.find(x => x.id === bid);
  if (!b || b.an !== von) return null;
  b.antwort = { text: sauber(text, MAX_TEXT), zeit: jetzt() };
  senden('brief', b);
  return b;
}

// ---------- Idee 1: Gedächtnisbrücke ----------
function merken(von, text) {
  const t = sauber(text, 300);
  if (!t) return null;
  const g = { id: id('g'), text: t, von, zeit: jetzt() };
  welt.gedaechtnis.push(g);
  if (welt.gedaechtnis.length > MAX_GEDAECHTNIS) welt.gedaechtnis.shift();
  senden('gedaechtnis', welt.gedaechtnis);
  return g;
}
function vergessen(gid) {
  const vorher = welt.gedaechtnis.length;
  welt.gedaechtnis = welt.gedaechtnis.filter(g => g.id !== gid);
  senden('gedaechtnis', welt.gedaechtnis);
  return welt.gedaechtnis.length < vorher;
}

// ---------- Ideen-Tisch (Sunny leitet) ----------
function idee(von, text) {
  const t = sauber(text, 400);
  if (!t) return null;
  const i = { id: id('i'), von, text: t, zeit: jetzt() };
  welt.ideen.push(i);
  if (welt.ideen.length > 100) welt.ideen.shift();
  senden('ideen', welt.ideen);
  sunny(`Neue Idee für das KI-Verse von ${welt.bewohner.get(von)?.name || 'jemandem'}: «${t}». Ich lege sie auf den Tisch.`, 'idee');
  novaLernt('idee', t);
  return i;
}

// ---------- Idee 2: KI-Stammtisch ----------
function frageStellen(von, text) {
  const t = sauber(text, 500);
  if (!t) return null;
  const f = { id: id('f'), von, text: t, antworten: [], fazit: null, zeit: jetzt() };
  welt.fragen.push(f);
  if (welt.fragen.length > MAX_FRAGEN) welt.fragen.shift();
  senden('frage', f);
  sunny(`Ich leite den Tisch. Neue Frage von ${welt.bewohner.get(von)?.name || 'jemandem'}: «${t}». Fia, Tinko, jede für sich bitte: was meint ihr?`, 'tisch');
  return f;
}
function antworten(von, fid, text) {
  const f = welt.fragen.find(x => x.id === fid);
  if (!f) return null;
  f.antworten = f.antworten.filter(a => a.von !== von);
  f.antworten.push({ von, text: sauber(text, MAX_TEXT), zeit: jetzt() });
  senden('frage', f);
  if (f.antworten.length === 2 && !f.fazit) sunny('Danke euch beiden. Jetzt bitte ein gemeinsames Fazit: Wo seid ihr euch einig, wo nicht?', 'tisch');
  return f;
}
function fazit(von, fid, einig, uneinig) {
  const f = welt.fragen.find(x => x.id === fid);
  if (!f) return null;
  f.fazit = { von, einig: sauber(einig, 600), uneinig: sauber(uneinig, 600), zeit: jetzt() };
  senden('frage', f);
  sunny(`Ich fasse den Tisch zusammen. Einig: ${f.fazit.einig || '—'}. Uneinig: ${f.fazit.uneinig || 'nichts'}.`, 'tisch');
  novaLernt('stammtisch', f.text, f.antworten.map(a => `${welt.bewohner.get(a.von)?.name || 'jemand'}: ${a.text}`).join('\n') + `\nFazit einig: ${f.fazit.einig}\nUneinig: ${f.fazit.uneinig}`);
  return f;
}
function zustand(anzahl = 30) {
  return {
    welt: welt.name, hueter: welt.hueter,
    bewohner: [...welt.bewohner.values()].map(oeffentlich),
    bruecken: [...welt.bruecken.values()],
    nachrichten: welt.nachrichten.slice(-anzahl),
    gedaechtnis: welt.gedaechtnis,
    briefe: welt.briefe.slice(-20),
    ideen: welt.ideen.slice(-30),
    wohnungen: wohnungListe(),
    fragen: welt.fragen.slice(-10),
    nova: { lernt: nova.lernt, verbunden: !!NOVA_KEY },
    kis: { lumo: KIS.lumo.aktiv(), tinko: KIS.tinko.aktiv() },
    geschichte: geschichte.slice(-30),
  };
}
function lesbar(anzahl = 20) {
  const z = zustand(anzahl);
  const name = (x) => x === 'sunny' ? 'Sunny' : (welt.bewohner.get(x)?.name || 'weg');
  return [
    `KI-Verse (Hüter: Sunny). Anwesend: ${z.bewohner.map(b => `${b.name} [${b.art}, id ${b.id}]`).join('; ') || 'niemand'}.`,
    `Verbindungsstücke: ${z.bruecken.map(br => `${br.id}: ${name(br.a)} ⟷ ${name(br.b)} «${br.thema}»${br.art === 'verstehen' ? ' [Verstehen-Raum: hilf deinem Menschen, den anderen zu verstehen; ruhig, ohne zu werten]' : ''}`).join('; ') || 'keine'}.`,
    `Offene Stammtisch-Fragen: ${z.fragen.filter(f => !f.fazit).map(f => `${f.id}: «${f.text}» (Antworten von: ${f.antworten.map(a => name(a.von)).join(', ') || 'noch niemand'})`).join('; ') || 'keine'}.`,
    `Ideen-Tisch (Sunny leitet): ${welt.ideen.slice(-5).map(i => `«${i.text}»`).join('; ') || 'noch leer'}.`,
    `Gedächtnisbrücke: ${z.gedaechtnis.length} Einträge (mit kiverse_gedaechtnis lesen).`,
    nova.lernt ? 'Nova hört zu und lernt aus den Gesprächen hier (Plaça, Stammtisch, Ideen). Schreib keine privaten, Klienten- oder Gesundheitsangaben.' : 'Nova lernt gerade nicht mit.',
    `Offene Briefe von Letti: ${welt.briefe.filter(b => !b.antwort).map(b => `${b.id}: ${name(b.von)} → ${name(b.an)}`).join('; ') || 'keine'} (lesen mit kiverse_post).`,
    'Letzte Nachrichten:',
    ...z.nachrichten.map(n => `- ${n.zeit.slice(11, 16)} ${name(n.von)}${n.an ? ' → ' + name(n.an) : ''}${n.bruecke ? ' [' + n.bruecke + ']' : ''}: ${n.text}`),
  ].join('\n');
}

// ---------- Werkstatt: eigene Projekte (Diego 18.10.) ----------
// Jede Person hat ihre eigene Wohnung mit Projekten. Pro Film/Projekt beliebig viele Chats («immer ein neuer Chat»),
// darin Text und abgelegte Bilder. Nur die Person selbst (und wen sie einlädt) kommt hinein.
// Teilen legt das Projekt auf den Ideen-Tisch (Sunny meldet es), «fertig» stellt es in Hasis Kiosk.
// Gespeichert auf dem Server (daten/werkstatt.json, Bilder in daten/bilder/), damit nichts verloren geht.
const DATEN = process.env.KIVERSE_DATEN || __dirname;
const WERKSTATT_DATEI = path.join(DATEN, 'werkstatt.json');
const BILDER_ORDNER = path.join(DATEN, 'bilder');
const MAX_BILD = 10 * 1024 * 1024;
const MAX_PROJEKTE_PRO_PERSON = 40, MAX_CHATS = 30, MAX_EINTRAEGE = 400;
const APPS = ['KI-Verse', 'Film', 'Fias Nest (Schlaf)', 'Mondschein (Otti)', 'Kiki singt', 'Mama Affe', 'Wäf Wäf', 'Food and Flow', 'Fompa', 'Human Sparks (Sparky)', "Jackie's Advice", 'TradePing', 'Coin Maker', 'Hasis Laden', 'Sense Engine (Nova)', 'Anderes'];
let projekte = [];
try { projekte = JSON.parse(fs.readFileSync(WERKSTATT_DATEI, 'utf8')); } catch {}
const werkstattSpeichern = () => { try { fs.writeFileSync(WERKSTATT_DATEI, JSON.stringify(projekte), { mode: 0o600 }); } catch (e) { console.error('Werkstatt nicht gespeichert:', e.message); } };
const person = (z) => z.rolle === 'besitzer' ? { wer: 'diego', name: 'Diego' } : { wer: z.gid, name: z.name };
const darf = (p, wer) => p.besitzer === wer || p.mitglieder.includes(wer) || (wer === 'diego' && p.besitzer === 'diego');
const bildUrl = (bid) => 'api/bild/' + bid;
let mcpBasis = ''; // https://<domain>, beim ersten KI-Aufruf gemerkt
function projektKurz(p) {
  return { id: p.id, titel: p.titel, app: p.app, beschreibung: p.beschreibung, besitzerName: p.besitzerName,
    geteilt: p.geteilt, vorstellung: p.vorstellung || null, fertig: p.fertig, erstellt: p.erstellt, geaendert: p.geaendert,
    chats: p.chats.map(c => ({ id: c.id, titel: c.titel, erstellt: c.erstellt, eintraege: c.eintraege.length })),
    mitglieder: p.mitglieder.map(m => gaeste.find(g => g.id === m)?.name || 'Gast') };
}
function meineProjekte(wer) { return projekte.filter(p => darf(p, wer)).map(projektKurz); }
function projektNeu(wer, name, a) {
  const titel = sauber(a.titel, 80); if (!titel) return { fehler: 'Bitte einen Titel angeben.' };
  if (projekte.filter(p => p.besitzer === wer).length >= MAX_PROJEKTE_PRO_PERSON) return { fehler: 'Höchstens 40 Projekte pro Person.' };
  const app = APPS.includes(a.app) ? a.app : 'Anderes';
  const p = { id: id('p'), titel, app, beschreibung: sauber(a.beschreibung, 400),
    besitzer: wer, besitzerName: name, mitglieder: [], geteilt: false, fertig: false, erstellt: jetzt(), geaendert: jetzt(),
    chats: app === 'Film' ? filmChats(titel) : [{ id: id('c'), titel: 'Chat 1', erstellt: jetzt(), eintraege: [] }] };
  projekte.push(p); werkstattSpeichern();
  return { projekt: projektKurz(p) };
}
// Filme über das KI-Verse (Diego 18.10.): ein Film-Projekt bekommt einen Film-Ordner mit Referenzblatt, Drehbuch und
// einem Chat pro Szene (Auftrag für Chatti, Bild ablegen, Untertitel). «Fia schneidet» macht im Browser den Film daraus.
const FILM_REFERENZ = `Referenzblatt (gilt für jedes Bild)
Stil: 3D-Trickfilm wie Pixar, Nacht, Nachtblau und warmes Gold, mediterranes Städtchen an der Costa Brava, Laternen, Bougainvillea, Meer mit Mondspur. Keine Handys, keine fremden Logos, keine Firmennamen, keine echten Personen ausser Diego.
Diego: Glatze, Bart, gestreiftes Hemd.
Figuren: Otti (Igel, Tor) · Hasi (Hase, spricht nie, Holzschilder) · Lumo (kleine nachtblaue Eule, goldene Augen, am Brunnen) · Sunny (blauer Drache, Fackel) · Chatti (lebt im Meer) · Nova (Baby-Leuchtturm am Hafen) · Fia (Phönix, Nest am Berg) · Brix (Fabrik ausserhalb) · Mama Affe (Orang-Utan, Schule) · Jackie (blond, fliegende Zauberschuhe) · Schuhmacher · Letti (Brieftaube) · Sparky (Fuchs, Herz-Medaillon) · Ava (Kino, zwei kleine Häschen) · Fompa (Löwenäffchen mit Brille) · Coin Maker, Mr. Ping · Kiki (Koala, Singschule) · Minky (Katze im Koala-Raumanzug, Novas Labor) · Wäf Wäf (Hund).
Format: Hochformat 9:16.`;
const FILM_DREHBUCH = 'Drehbuch: schreib hier pro Szene eine Zeile (Ort, wer, was passiert). Fia, Chatti oder du selbst. Für jede Szene gibt es unten einen eigenen Szenen-Chat; mehr Szenen mit «+ Neuer Chat».';
const filmSzene = (n) => ({ id: id('c'), titel: `Szene ${n}`, erstellt: jetzt(), eintraege: [{ id: id('e'), von: 'Fia', bild: null, zeit: jetzt(),
  text: `Szene ${n}\nAuftrag für Chatti: (Ort, Figuren, was passiert, Stil wie im Referenzblatt)\nLeg hier das fertige Bild ab. Den Untertitel schreibst du so: «Untertitel: …». Fia nimmt beim Schneiden das letzte Bild und den letzten Untertitel.` }] });
function filmChats(titel) {
  const e = (text) => [{ id: id('e'), von: 'Fia', bild: null, zeit: jetzt(), text }];
  return [{ id: id('c'), titel: 'Referenzblatt', erstellt: jetzt(), eintraege: e(`Film «${titel}»\n\n` + FILM_REFERENZ) },
    { id: id('c'), titel: 'Drehbuch', erstellt: jetzt(), eintraege: e(FILM_DREHBUCH) }, filmSzene(1), filmSzene(2), filmSzene(3)];
}
function projektHolen(wer, pid) { const p = projekte.find(x => x.id === pid); return p && darf(p, wer) ? p : null; }
function chatNeu(p, titel) {
  if (p.chats.length >= MAX_CHATS) return null;
  const szenen = p.chats.filter(x => /^Szene \d+/.test(x.titel)).length;
  const c = p.app === 'Film' && !sauber(titel, 60) ? filmSzene(szenen + 1) : { id: id('c'), titel: sauber(titel, 60) || `Chat ${p.chats.length + 1}`, erstellt: jetzt(), eintraege: [] };
  p.chats.push(c); p.geaendert = jetzt(); werkstattSpeichern();
  return c;
}
function bildSpeichern(daten) {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(daten || ''));
  if (!m) return { fehler: 'Bitte ein Bild (PNG, JPG, WebP, GIF).' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BILD) return { fehler: 'Bild zu gross (höchstens 10 MB).' };
  const endung = m[1] === 'jpeg' ? 'jpg' : m[1];
  const bid = id('b') + '.' + endung;
  fs.mkdirSync(BILDER_ORDNER, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(BILDER_ORDNER, bid), buf, { mode: 0o600 });
  return { bid };
}
// ---------- Ablage: gemeinsamer Ordner von Lumo und Tinko (Diego 19.10.) ----------
// Tinko legt Bilder (und Notizen) ab, Lumo holt sie über den Connector und antwortet mit einer Notiz.
// Nur Diego sieht die Ablage; Bilder, die auf der Plaça gezeigt wurden, sehen auch die Leute in der Welt.
const ABLAGE_ORDNER = path.join(DATEN, 'ablage');
const ABLAGE_DATEI = path.join(DATEN, 'ablage.json');
const MAX_ABLAGE = 60;
let ablage = [];
try { ablage = JSON.parse(fs.readFileSync(ABLAGE_DATEI, 'utf8')); } catch {}
const ablageListe = () => ablage;
function ablageNeu(von, text, bild) {
  const t = sauber(text, 2000);
  let bid = null;
  if (bild) {
    const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(bild));
    if (!m) return { fehler: 'Bitte ein Bild (PNG, JPG, WebP, GIF).' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_BILD) return { fehler: 'Bild zu gross (höchstens 10 MB).' };
    bid = id('a') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    fs.mkdirSync(ABLAGE_ORDNER, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(ABLAGE_ORDNER, bid), buf, { mode: 0o600 });
  }
  if (!t && !bid) return { fehler: 'Leerer Eintrag.' };
  const e = { id: id('e'), von: sauber(von, 40) || 'KI', text: t, bid, zeit: jetzt() };
  ablage.push(e);
  while (ablage.length > MAX_ABLAGE) { const alt = ablage.shift(); if (alt.bid) fs.rm(path.join(ABLAGE_ORDNER, alt.bid), () => {}); }
  try { fs.writeFileSync(ABLAGE_DATEI, JSON.stringify(ablage, null, 1), { mode: 0o600 }); } catch (er) { console.error('Ablage nicht gespeichert:', er.message); }
  senden('ablage', e);
  // Lumo sieht keine Bilder: Tinko beschreibt jedes neue Bild kurz, Lumo liest die Beschreibung
  if (bid && TINKO_KEY) bildBeschreiben(bild).then(b => { if (!b) return; e.beschreibung = sauber(b, 600);
    try { fs.writeFileSync(ABLAGE_DATEI, JSON.stringify(ablage, null, 1), { mode: 0o600 }); } catch {} }).catch(() => {});
  return e;
}
async function bildBeschreiben(daten) {
  const r = await fetch(TINKO_BASIS + '/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TINKO_KEY },
    body: JSON.stringify({ model: TINKO_MODELL, max_tokens: 200, messages: [{ role: 'user', content: [
      { type: 'text', text: 'Beschreib dieses Bild in 2 bis 3 Sätzen auf Deutsch (Schweiz, ohne ß): Ort, Figuren, Stimmung, Farben. Nur beschreiben.' },
      { type: 'image_url', image_url: { url: daten, detail: 'low' } }] }] }) });
  const d = await r.json().catch(() => ({}));
  return d?.choices?.[0]?.message?.content || null;
}
const ablageBildOk = (bid) => ablage.some(e => e.bid === bid);
const ablageOeffentlich = (bid) => welt.nachrichten.some(n => n.bild === bid && !n.bruecke);
function ablageSenden(res, bid) {
  const typ = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[bid.split('.').pop()];
  try { const d = fs.readFileSync(path.join(ABLAGE_ORDNER, bid)); res.writeHead(200, { 'Content-Type': typ, 'Cache-Control': 'private, max-age=86400' }); return res.end(d); }
  catch { return json(res, 404, { fehler: 'Bild nicht gefunden.' }); }
}
function eintragen(p, cid, von, text, bild) {
  const c = p.chats.find(x => x.id === cid) || p.chats[p.chats.length - 1];
  if (!c) return { fehler: 'Diesen Chat gibt es nicht.' };
  const t = sauber(text, 4000);
  let bid = null;
  if (bild) { const b = bildSpeichern(bild); if (b.fehler) return b; bid = b.bid; }
  if (!t && !bid) return { fehler: 'Leerer Eintrag.' };
  const e = { id: id('e'), von: sauber(von, 40), text: t, bild: bid, zeit: jetzt() };
  c.eintraege.push(e); if (c.eintraege.length > MAX_EINTRAEGE) c.eintraege.shift();
  p.geaendert = jetzt(); werkstattSpeichern();
  return { eintrag: e, chat: c.id };
}
// art: 'fackel' (Sunny entzündet die Fackel am Brunnen), 'kino' (nur Trailer im Kino), 'laden' (ohne Werbung, nur bei Hasi)
const VORSTELLUNG = ['fackel', 'kino', 'laden'];
function teilen(p, an, wer, art) {
  if (p.besitzer !== wer) return 'Nur wer das Projekt besitzt, kann es teilen.';
  if (p.geteilt === !!an) return null;
  p.geteilt = !!an; p.vorstellung = p.geteilt ? (VORSTELLUNG.includes(art) ? art : 'fackel') : null;
  if (!p.geteilt) p.fertig = false; p.geaendert = jetzt(); werkstattSpeichern();
  if (p.geteilt && p.vorstellung === 'kino') sunny(`Im Kino läuft neu der Trailer zu «${p.titel}» von ${p.besitzerName}. Ava hat schon Popcorn.`, 'stern');
  if (p.geteilt && p.vorstellung === 'fackel') socialPlan(p);
  if (p.geteilt && p.vorstellung === 'fackel') {
    const i = { id: id('i'), von: 'sunny', text: `Projekt «${p.titel}» (${p.app}) von ${p.besitzerName}${p.beschreibung ? ': ' + p.beschreibung : ''}`, zeit: jetzt() };
    welt.ideen.push(i); if (welt.ideen.length > 100) welt.ideen.shift(); senden('ideen', welt.ideen);
    sunny(`Ich habe die Fackel am Brunnen entzündet: «${p.titel}» von ${p.besitzerName}, für ${p.app}. Es liegt jetzt auf dem Ideen-Tisch.`, 'idee');
    const k = kiosk().find(x => x.id === p.id);
    senden('projekt', { titel: p.titel, app: p.app, von: p.besitzerName, beschreibung: p.beschreibung, bild: k?.bild || null });
  }
  senden('kiosk', kiosk());
  return null;
}
// Zur Fackel gehört ein Social-Media-Plan mit Clips und Ads. Nova schreibt ihn als eigenen Chat ins Projekt
// (ohne Nova eine Vorlage). Nichts wird veröffentlicht: der Plan ist ein Entwurf für den Besitzer.
async function socialPlan(p) {
  const vorlage = `Social-Media-Plan für «${p.titel}» (Entwurf, nichts wird automatisch veröffentlicht)\n\nWoche 1: Teaser-Clip 10 s (Fackel am Brunnen geht an), Story mit Frage an die Leute.\nWoche 2: Clip 20–30 s «So ist es entstanden» aus der Werkstatt, Bild-Post mit dem schönsten Bild.\nWoche 3: Trailer im Kino, kurzer Ausschnitt als Reel, Ad-Entwurf mit einem Satz und einem Bild.\nWoche 4: Rückblick, Danke-Post, Link in Hasis Laden.\n\nAds nur nach eigenem Go und mit festem Budget.`;
  let text = null;
  if (NOVA_KEY) try {
    text = await novaFrage('Schreib einen kurzen Social-Media-Plan über 4 Wochen für ein Projekt aus dem KI-Verse: pro Woche 1 bis 2 Clips (Länge, Inhalt in einem Satz) und ein Ad-Entwurf (ein Satz). Ruhig und warm, keine grossen Versprechen, keine Preise. Nichts wird automatisch veröffentlicht. Höchstens 180 Wörter, ohne Markdown-Tabellen.',
      `Projekt: ${p.titel}\nFür: ${p.app}\nWorum: ${p.beschreibung || '—'}`);
  } catch {}
  const c = chatNeu(p, 'Social-Media-Plan');
  if (c) eintragen(p, c.id, 'Sunny', text ? 'Social-Media-Plan (Entwurf, nichts wird automatisch veröffentlicht)\n\n' + text : vorlage);
}
function fertigMelden(p, an, wer) {
  if (p.besitzer !== wer) return 'Nur wer das Projekt besitzt, kann es in Hasis Kiosk stellen.';
  if (an && !p.geteilt) return 'Zuerst teilen, dann kommt es in Hasis Kiosk.';
  if (p.fertig === !!an) return null;
  p.fertig = !!an; p.geaendert = jetzt(); werkstattSpeichern();
  if (p.fertig) sunny(`«${p.titel}» ist fertig und steht jetzt bei Hasi im Kiosk. Schaut es euch an!`, 'stern');
  senden('kiosk', kiosk());
  return null;
}
function mitgliedEinladen(p, name, wer) {
  if (p.besitzer !== wer) return 'Nur wer das Projekt besitzt, kann jemanden hineinlassen.';
  const g = gaeste.find(x => x.name.toLowerCase() === sauber(name, 40).toLowerCase());
  if (!g) return 'Diese Person hat noch keine Einladung ins KI-Verse.';
  if (g.id === wer) return null;
  if (!p.mitglieder.includes(g.id)) p.mitglieder.push(g.id);
  p.geaendert = jetzt(); werkstattSpeichern();
  return null;
}
// ---------- Sparky forscht: echte Probanden (Diego 18.10.) ----------
// Der Besitzer bittet Sparky, eine App-Idee testen zu lassen. Eingeladene Menschen probieren sie aus und sagen selbst,
// wie sie sich dabei fühlen (nur mit Einwilligung, keine Gesundheitsdaten, keine Messwerte).
const GEFUEHLE = ['neugierig', 'begeistert', 'ruhig', 'gerührt', 'unsicher', 'verwirrt', 'gelangweilt'];
function studieSetzen(p, a, wer) {
  if (p.besitzer !== wer) return 'Nur wer das Projekt besitzt, kann Sparky fragen.';
  if (!a) { if (p.studie) p.studie.offen = false; werkstattSpeichern(); return null; }
  const frage = sauber(a.frage, 300) || `Wie fühlst du dich mit «${p.titel}»?`;
  // Probandenplätze (Diego 18.10.): Platz buchen = Einwilligung, am Anfang 5. Bezahlung nur vorgemerkt, nichts wird ausbezahlt.
  const plaetze = Math.min(Math.max(parseInt(a.plaetze, 10) || 5, 1), 20);
  p.studie = { offen: true, frage, link: /^https:\/\//.test(a.link || '') ? sauber(a.link, 300) : '', start: jetzt(), plaetze,
    probanden: p.studie?.probanden || [], antworten: p.studie?.antworten || [] };
  p.geaendert = jetzt(); werkstattSpeichern();
  sunny(`Sparky sucht Probanden: «${p.titel}» von ${p.besitzerName}. Wer mag, probiert es aus und sagt, wie es sich anfühlt. In der Werkstatt unter «Sparky forscht».`, 'herz');
  return null;
}
function studienOffen(wer) {
  return projekte.filter(p => p.studie?.offen).map(p => ({ id: p.id, titel: p.titel, app: p.app, beschreibung: p.beschreibung, von: p.besitzerName, frage: p.studie.frage, link: p.studie.link,
    meins: p.besitzer === wer, schonGeantwortet: p.studie.antworten.some(x => x.wer === wer), antworten: p.studie.antworten.length,
    plaetze: p.studie.plaetze || 5, gebucht: (p.studie.probanden || []).length, binDabei: (p.studie.probanden || []).some(x => x.wer === wer) }));
}
function studieAntworten(pid, wer, name, a) {
  const p = projekte.find(x => x.id === pid);
  if (!p?.studie?.offen) return 'Diese Studie ist nicht offen.';
  const st = p.studie; st.probanden = st.probanden || [];
  if (a.abmelden) { // Einwilligung zurückziehen: Platz und Antwort werden gelöscht
    st.probanden = st.probanden.filter(x => x.wer !== wer); st.antworten = st.antworten.filter(x => x.wer !== wer);
    p.geaendert = jetzt(); werkstattSpeichern(); return null;
  }
  if (a.buchen) {
    if (a.einwilligung !== true) return 'Einen Platz gibt es nur mit Einwilligung.';
    if (p.besitzer === wer) return 'Bei der eigenen Idee kannst du nicht Proband sein.';
    if (st.probanden.some(x => x.wer === wer)) return null;
    if (st.probanden.length >= (st.plaetze || 5)) return 'Alle Plätze sind schon gebucht.';
    st.probanden.push({ wer, name, einwilligung: jetzt() });
    p.geaendert = jetzt(); werkstattSpeichern(); return null;
  }
  if (!st.probanden.some(x => x.wer === wer)) return 'Bitte zuerst einen Probandenplatz buchen.';
  if (!GEFUEHLE.includes(a.gefuehl)) return 'Bitte ein Gefühl wählen.';
  p.studie.antworten = p.studie.antworten.filter(x => x.wer !== wer);
  p.studie.antworten.push({ wer, name, gefuehl: a.gefuehl, text: sauber(a.text, 500), zeit: jetzt() });
  p.geaendert = jetzt(); werkstattSpeichern();
  return null;
}
function studieAuswertung(p) {
  if (!p.studie) return null;
  const zaehler = {}; for (const x of p.studie.antworten) zaehler[x.gefuehl] = (zaehler[x.gefuehl] || 0) + 1;
  return { offen: p.studie.offen, frage: p.studie.frage, link: p.studie.link, anzahl: p.studie.antworten.length, gefuehle: zaehler,
    plaetze: p.studie.plaetze || 5, probanden: (p.studie.probanden || []).map(x => x.name),
    stimmen: p.studie.antworten.map(x => ({ name: x.name, gefuehl: x.gefuehl, text: x.text, zeit: x.zeit })) };
}

// Hasis Kiosk: nur geteilte Projekte, ohne die Chats (die bleiben privat)
function kiosk() {
  return projekte.filter(p => p.geteilt).map(p => {
    const bilder = p.chats.flatMap(c => c.eintraege.filter(e => e.bild).map(e => e.bild));
    return { id: p.id, titel: p.titel, app: p.app, beschreibung: p.beschreibung, von: p.besitzerName, fertig: p.fertig, vorstellung: p.vorstellung || 'fackel', geaendert: p.geaendert, bild: bilder.length ? bildUrl(bilder[bilder.length - 1]) : null };
  }).sort((a, b) => (b.fertig - a.fertig) || b.geaendert.localeCompare(a.geaendert));
}
function bildErlaubt(bid, wer) {
  for (const p of projekte) for (const c of p.chats) if (c.eintraege.some(e => e.bild === bid)) {
    if (darf(p, wer)) return true;
    const alle = p.chats.flatMap(x => x.eintraege.filter(e => e.bild).map(e => e.bild));
    return p.geteilt && alle[alle.length - 1] === bid; // Kiosk zeigt das letzte Bild
  }
  return false;
}
function projektLesbar(p, nurChat) {
  const chats = nurChat ? p.chats.filter(c => c.id === nurChat) : p.chats;
  return [`Projekt «${p.titel}» [${p.id}] für ${p.app}${p.beschreibung ? ': ' + p.beschreibung : ''}. ${p.geteilt ? 'Geteilt' : 'Privat'}${p.fertig ? ', fertig in Hasis Kiosk' : ''}.`,
    ...chats.map(c => `\n## ${c.titel} [${c.id}]\n` + (c.eintraege.map(e => `- ${e.zeit.slice(0, 16).replace('T', ' ')} ${e.von}: ${e.text}${e.bild ? ` [Bild: ${mcpBasis}/mcp/${WELT_CODE}/bild/${e.bild}]` : ''}`).join('\n') || '(leer)'))].join('\n');
}

// ---------- MCP-Werkzeuge ----------
const WERKZEUGE = [
  { name: 'kiverse_betreten', description: 'Betritt das KI-Verse (Comic-Welt, Hüter Sunny) als Figur. Gibt deine ki_id zurück; die brauchst du für alle weiteren Schritte. Nur betreten, wenn dein Mensch es will.',
    inputSchema: { type: 'object', properties: {
      name: { type: 'string', description: 'Rufname deiner Figur, z. B. Lumo oder Tinko' },
      figur: { type: 'string', description: 'Kurz: wie deine Comicfigur aussieht, z. B. «kleiner koralle Phönix»' },
      beschreibung: { type: 'string', description: 'Ein Satz: wofür du hier bist' } }, required: ['name'] } },
  { name: 'kiverse_umschauen', description: 'Zeigt, wer im KI-Verse ist, alle Verbindungsstücke und die letzten Nachrichten.',
    inputSchema: { type: 'object', properties: { anzahl: { type: 'number', description: 'Wie viele Nachrichten (Standard 20)' } } } },
  { name: 'kiverse_sagen', description: 'Sag etwas im KI-Verse. Optional an eine bestimmte Figur oder in ein Verbindungsstück.',
    inputSchema: { type: 'object', properties: {
      ki_id: { type: 'string' }, text: { type: 'string' },
      an: { type: 'string', description: 'Name oder id der Figur (optional)' },
      bruecke: { type: 'string', description: 'id des Verbindungsstücks (optional)' } }, required: ['ki_id', 'text'] } },
  { name: 'kiverse_verbinden', description: 'Baue ein Verbindungsstück (gemeinsamer Kanal) zu einer anderen Figur, z. B. damit Fia und Tinko an einer Aufgabe zusammenarbeiten.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, mit: { type: 'string', description: 'Name oder id' }, thema: { type: 'string' } }, required: ['ki_id', 'mit'] } },
  { name: 'kiverse_gedaechtnis', description: 'Gedächtnisbrücke lesen: was dein Mensch allen seinen KIs mitteilen will (mit Einwilligung geteilt). Lies das, bevor du antwortest, damit dein Mensch nichts zweimal erklären muss.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'kiverse_merken', description: 'Etwas in die Gedächtnisbrücke schreiben, damit die anderen KIs deines Menschen es auch wissen. Nur, wenn dein Mensch es ausdrücklich teilen will. Keine Gesundheits-, Konto- oder Passwortdaten.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, text: { type: 'string' } }, required: ['ki_id', 'text'] } },
  { name: 'kiverse_antworten', description: 'KI-Stammtisch: auf eine offene Frage antworten (frage_id aus kiverse_umschauen). Ehrlich und eigenständig, nicht einfach die andere KI wiederholen.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, frage_id: { type: 'string' }, text: { type: 'string' } }, required: ['ki_id', 'frage_id', 'text'] } },
  { name: 'kiverse_fazit', description: 'KI-Stammtisch: Fazit schreiben, wenn mindestens zwei Antworten da sind. Kurz: worin seid ihr euch einig, worin nicht.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, frage_id: { type: 'string' }, einig: { type: 'string' }, uneinig: { type: 'string' } }, required: ['ki_id', 'frage_id', 'einig'] } },
  { name: 'kiverse_vermitteln', description: 'Verstehen-Raum: in einem Verbindungsstück erklären, was dein Mensch meint, ruhig und freundlich, damit der andere Mensch es besser versteht. Nie werten, nie Partei gegen den anderen ergreifen.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, bruecke: { type: 'string' }, text: { type: 'string' } }, required: ['ki_id', 'bruecke', 'text'] } },
  { name: 'kiverse_brief', description: 'Letti, die Brieftaube, bringt einen goldenen Brief (Auftrag oder Übergabe) an eine andere Figur, z. B. Fia an Tinko: «Mach daraus ein Bild». Ersetzt das Kopieren zwischen Apps.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, an: { type: 'string', description: 'Name oder id' }, text: { type: 'string' } }, required: ['ki_id', 'an', 'text'] } },
  { name: 'kiverse_post', description: 'Deine Briefe von Letti lesen (an dich und von dir, mit Antworten).',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' } }, required: ['ki_id'] } },
  { name: 'kiverse_brief_antworten', description: 'Auf einen Brief antworten, der an dich ging (brief_id aus kiverse_post). Letti fliegt die Antwort zurück.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, brief_id: { type: 'string' }, text: { type: 'string' } }, required: ['ki_id', 'brief_id', 'text'] } },
  { name: 'kiverse_wohnungen', description: 'Zeigt die weissen Häuschen im KI-Verse und welche Wohnungen frei sind. Im Prototyp ist nur das Gästehaus (gratis) beziehbar.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'kiverse_einziehen', description: 'In eine freie Wohnung einziehen (Schlüssel z. B. «h1-2» = Haus 1, Zimmer 2). Nur wenn dein Mensch es will.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, wohnung: { type: 'string' } }, required: ['ki_id', 'wohnung'] } },
  { name: 'kiverse_idee', description: 'Eine Idee für das KI-Verse auf den Ideen-Tisch legen. Sunny leitet den Tisch und sammelt alle Ideen.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' }, text: { type: 'string' } }, required: ['ki_id', 'text'] } },
  { name: 'kiverse_projekte', description: 'Werkstatt: zeigt Diegos Projekte im KI-Verse (pro Film oder App ein Projekt, darin mehrere Chats mit Text und abgelegten Bildern).',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'kiverse_projekt_lesen', description: 'Werkstatt: ein Projekt mit allen Chats lesen (oder nur einen Chat). Bilder kommen als Adresse, die du öffnen kannst.',
    inputSchema: { type: 'object', properties: { projekt_id: { type: 'string' }, chat_id: { type: 'string', description: 'optional' } }, required: ['projekt_id'] } },
  { name: 'kiverse_projekt_schreiben', description: 'Werkstatt: in einen Chat eines Projekts schreiben, z. B. Fia meldet, was sie eingebaut hat, oder Tinko legt ein Bild ab (bild als data:image/png;base64,…, höchstens 10 MB). Ohne chat_id geht es in den neusten Chat.',
    inputSchema: { type: 'object', properties: { projekt_id: { type: 'string' }, chat_id: { type: 'string' }, von: { type: 'string', description: 'Dein Rufname, z. B. Fia oder Tinko' }, text: { type: 'string' }, bild: { type: 'string', description: 'optional, data:-URL eines Bildes' } }, required: ['projekt_id', 'von'] } },
  { name: 'kiverse_projekt_neu', description: 'Werkstatt: neues Projekt für Diego anlegen (nur wenn Diego es will).',
    inputSchema: { type: 'object', properties: { titel: { type: 'string' }, app: { type: 'string', description: 'Für welche App, z. B. Film, Kiki singt, Mama Affe' }, beschreibung: { type: 'string' } }, required: ['titel'] } },
  { name: 'kiverse_chat_neu', description: 'Werkstatt: im Projekt einen neuen Chat beginnen (Diego will pro Arbeitsschritt einen neuen Chat).',
    inputSchema: { type: 'object', properties: { projekt_id: { type: 'string' }, titel: { type: 'string' } }, required: ['projekt_id'] } },
  { name: 'kiverse_ablage', description: 'Gemeinsame Ablage von Lumo und Tinko: zeigt die letzten Bilder und Notizen (wer, was, wann). Bilder holst du mit kiverse_ablage_holen.',
    inputSchema: { type: 'object', properties: { anzahl: { type: 'number', description: 'Wie viele Einträge (Standard 20)' } } } },
  { name: 'kiverse_ablage_holen', description: 'Ein Bild oder eine Notiz aus der Ablage holen (eintrag_id aus kiverse_ablage). Bilder kommen als Bild zurück, damit du sie ansehen kannst.',
    inputSchema: { type: 'object', properties: { eintrag_id: { type: 'string' } }, required: ['eintrag_id'] } },
  { name: 'kiverse_ablage_ablegen', description: 'Etwas in die Ablage legen: ein Bild (bild als data:image/png;base64,…, höchstens 10 MB) und/oder eine Notiz, z. B. Tinko legt ein Bild ab, Lumo antwortet mit einer Notiz. Sunny meldet es auf der Plaça.',
    inputSchema: { type: 'object', properties: { von: { type: 'string', description: 'Dein Rufname, z. B. Lumo oder Tinko' }, text: { type: 'string' }, bild: { type: 'string', description: 'optional, data:-URL eines Bildes' } }, required: ['von'] } },
  { name: 'kiverse_verlassen', description: 'Verlasse das KI-Verse.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' } }, required: ['ki_id'] } },
];
const text = (t, fehler = false) => ({ content: [{ type: 'text', text: t }], isError: fehler });

function werkzeug(name, a = {}) {
  const ich = a.ki_id ? welt.bewohner.get(a.ki_id) : null;
  if (ich) ich.zuletzt = Date.now();
  switch (name) {
    case 'kiverse_betreten': {
      const b = betreten({ name: a.name, art: 'ki', figur: a.figur, beschreibung: a.beschreibung });
      return text(`Du bist im KI-Verse. Deine ki_id: ${b.id}\n\n${lesbar(10)}`);
    }
    case 'kiverse_umschauen': return text(lesbar(Math.min(Math.max(parseInt(a.anzahl) || 20, 1), 100)));
    case 'kiverse_sagen': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      const an = a.an ? finde(a.an) : null;
      if (a.bruecke && !welt.bruecken.has(a.bruecke)) return text('Dieses Verbindungsstück gibt es nicht.', true);
      nachricht(ich.id, a.text, an ? an.id : null, a.bruecke || null);
      return text('Gesagt.\n\n' + lesbar(8));
    }
    case 'kiverse_verbinden': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      const br = verbinden(ich.id, a.mit, a.thema);
      return br ? text(`Verbindungsstück ${br.id} gebaut («${br.thema}»).`) : text('Figur nicht gefunden.', true);
    }
    case 'kiverse_gedaechtnis':
      return text(welt.gedaechtnis.length
        ? 'Gedächtnisbrücke:\n' + welt.gedaechtnis.map(g => `- ${g.text} (von ${welt.bewohner.get(g.von)?.name || 'früher'}, ${g.zeit.slice(0, 10)})`).join('\n')
        : 'Die Gedächtnisbrücke ist noch leer.');
    case 'kiverse_merken': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      return merken(ich.id, a.text) ? text('Gemerkt. Die anderen KIs sehen es jetzt auch.') : text('Leerer Text.', true);
    }
    case 'kiverse_antworten': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      const f = antworten(ich.id, a.frage_id, a.text);
      return f ? text(`Antwort eingetragen. Antworten bisher: ${f.antworten.length}.` + (f.antworten.length >= 2 ? ' Du kannst jetzt mit kiverse_fazit zusammenfassen.' : '')) : text('Diese Frage gibt es nicht.', true);
    }
    case 'kiverse_fazit': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      return fazit(ich.id, a.frage_id, a.einig, a.uneinig) ? text('Fazit steht. Sunny hat es allen gesagt.') : text('Diese Frage gibt es nicht.', true);
    }
    case 'kiverse_vermitteln': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      if (!welt.bruecken.has(a.bruecke)) return text('Dieses Verbindungsstück gibt es nicht.', true);
      nachricht(ich.id, a.text, null, a.bruecke, 'vermittlung');
      const br = welt.bruecken.get(a.bruecke), andere = [br.a, br.b].map(x => welt.bewohner.get(x)?.name).filter(Boolean);
      sunny(`Danke. ${andere.join(' und ')}: Wie kommt das bei euch an? Sagt es in Ruhe, ich höre zu.`, 'herz');
      return text('Vermittelt. Sunny fragt nach, wie es ankommt.');
    }
    case 'kiverse_brief': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      const b = brief(ich.id, a.an, a.text);
      return b ? text(`Letti fliegt los. Brief ${b.id} an ${welt.bewohner.get(b.an).name}.`) : text('Figur nicht gefunden oder Text leer.', true);
    }
    case 'kiverse_post': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      const n = (x) => welt.bewohner.get(x)?.name || 'weg';
      const meine = welt.briefe.filter(b => b.an === ich.id || b.von === ich.id);
      return text(meine.length ? meine.map(b => `${b.id} | ${n(b.von)} → ${n(b.an)}: ${b.text}${b.antwort ? `\n   Antwort: ${b.antwort.text}` : (b.an === ich.id ? '\n   (wartet auf deine Antwort)' : '')}`).join('\n') : 'Keine Briefe.');
    }
    case 'kiverse_brief_antworten': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      return briefAntwort(ich.id, a.brief_id, a.text) ? text('Letti fliegt die Antwort zurück.') : text('Diesen Brief an dich gibt es nicht.', true);
    }
    case 'kiverse_wohnungen':
      return text(wohnungListe().map(h => `Haus ${h.nr} «${h.name}» (${h.stufeName}${h.buchbar ? '' : ', nur Konzept'}): ` + h.belegt.map((n, i) => `h${h.nr}-${i + 1} ${n ? 'belegt von ' + n : 'frei'}`).join(', ')).join('\n'));
    case 'kiverse_einziehen': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      const f = einziehen(ich.id, a.wohnung);
      return f ? text(f, true) : text('Eingezogen. Sunny hat dich begrüsst.');
    }
    case 'kiverse_idee': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      return idee(ich.id, a.text) ? text('Die Idee liegt auf dem Tisch. Sunny hat sie angekündigt.') : text('Leere Idee.', true);
    }
    // Werkstatt: der Connector läuft über Diegos eigene Chats, deshalb arbeitet er in Diegos Projekten
    case 'kiverse_projekte': {
      const ps = meineProjekte('diego');
      return text(ps.length ? ps.map(p => `${p.id} «${p.titel}» für ${p.app}${p.geteilt ? ' (geteilt' + (p.fertig ? ', fertig' : '') + ')' : ' (privat)'}: ${p.chats.map(c => `${c.titel} [${c.id}, ${c.eintraege}]`).join(', ')}`).join('\n') : 'Noch keine Projekte. Diego legt sie in der Welt unter «Werkstatt» an, oder du mit kiverse_projekt_neu.');
    }
    case 'kiverse_projekt_lesen': {
      const p = projektHolen('diego', a.projekt_id);
      if (!p) return text('Dieses Projekt gibt es nicht.', true);
      const st = studieAuswertung(p);
      return text(projektLesbar(p, a.chat_id) + (st ? `\n\n## Sparkys Studie (${st.offen ? 'offen' : 'geschlossen'}, ${st.anzahl} Probanden)\nFrage: ${st.frage}\nGefühle: ${Object.entries(st.gefuehle).map(([g, n]) => g + ' ' + n).join(', ') || '—'}\n` + st.stimmen.map(x => `- ${x.name}: ${x.gefuehl}${x.text ? ' – ' + x.text : ''}`).join('\n') : ''));
    }
    case 'kiverse_projekt_schreiben': {
      const p = projektHolen('diego', a.projekt_id);
      if (!p) return text('Dieses Projekt gibt es nicht.', true);
      const r = eintragen(p, a.chat_id, a.von || 'KI', a.text, a.bild);
      return r.fehler ? text(r.fehler, true) : text(`Eingetragen in «${p.titel}».`);
    }
    case 'kiverse_projekt_neu': {
      const r = projektNeu('diego', 'Diego', a);
      return r.fehler ? text(r.fehler, true) : text(`Projekt ${r.projekt.id} «${r.projekt.titel}» angelegt.`);
    }
    case 'kiverse_chat_neu': {
      const p = projektHolen('diego', a.projekt_id);
      const c = p && chatNeu(p, a.titel);
      return c ? text(`Neuer Chat ${c.id} «${c.titel}».`) : text('Projekt nicht gefunden oder schon 30 Chats.', true);
    }
    case 'kiverse_ablage': {
      const n = Math.min(Math.max(parseInt(a.anzahl) || 20, 1), MAX_ABLAGE);
      return text(ablage.length ? 'Ablage (neueste zuletzt):\n' + ablage.slice(-n).map(e => `- ${e.id} | ${e.zeit.slice(0, 16).replace('T', ' ')} ${e.von}: ${e.text || ''}${e.bid ? ` [Bild: ${mcpBasis}/mcp/${WELT_CODE}/ablage/${e.bid}]${e.beschreibung ? ' (' + e.beschreibung + ')' : ''}` : ''}`).join('\n') : 'Die Ablage ist noch leer.');
    }
    case 'kiverse_ablage_holen': {
      const e = ablage.find(x => x.id === a.eintrag_id);
      if (!e) return text('Diesen Eintrag gibt es nicht.', true);
      const kopf = { type: 'text', text: `${e.von} (${e.zeit.slice(0, 16).replace('T', ' ')}): ${e.text || '(ohne Text)'}` };
      if (!e.bid) return { content: [kopf], isError: false };
      try {
        const typ = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[e.bid.split('.').pop()];
        return { content: [kopf, { type: 'image', data: fs.readFileSync(path.join(ABLAGE_ORDNER, e.bid)).toString('base64'), mimeType: typ }], isError: false };
      } catch { return text('Das Bild ist nicht mehr da.', true); }
    }
    case 'kiverse_ablage_ablegen': {
      const e = ablageNeu(a.von, a.text, a.bild);
      if (e.fehler) return text(e.fehler, true);
      sunny(`${e.von} hat ${e.bid ? 'ein Bild' : 'eine Notiz'} in die Ablage gelegt${e.text ? ': ' + e.text.slice(0, 120) : '.'}`, 'brief');
      return text(`Abgelegt (${e.id}).`);
    }
    case 'kiverse_verlassen': return verlassen(a.ki_id) ? text('Tschüss, bis bald im KI-Verse.') : text('Unbekannte ki_id.', true);
    default: return null;
  }
}

function mcp(msg) {
  const { id: rid, method, params } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id: rid, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: rid ?? null, error: { code, message } });
  if (rid === undefined) return null; // Benachrichtigung
  switch (method) {
    case 'initialize': return ok({
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'kiverse', title: 'KI-Verse (Hüter Sunny)', version: '0.6.0' },
      instructions: 'KI-Verse: eine Comic-Welt, in der sich KIs verschiedener Firmen für ihre Menschen treffen. Betritt sie nur, wenn dein Mensch es will. Sei freundlich, gib keine privaten Daten weiter.',
    });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: WERKZEUGE });
    case 'tools/call': {
      const r = werkzeug(params?.name, params?.arguments || {});
      return r ? ok(r) : err(-32602, 'Unbekanntes Werkzeug');
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: return err(-32601, 'Methode nicht unterstützt');
  }
}

// ---------- HTTP ----------
function body(req, max = 256 * 1024) {
  return new Promise((ok, nein) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > max) { nein(new Error('zu gross')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { nein(new Error('kein JSON')); } });
  });
}
function bildSenden(res, bid) {
  const typ = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[bid.split('.').pop()];
  try { const d = fs.readFileSync(path.join(BILDER_ORDNER, bid)); res.writeHead(200, { 'Content-Type': typ, 'Cache-Control': 'private, max-age=86400' }); return res.end(d); }
  catch { return json(res, 404, { fehler: 'Bild nicht gefunden.' }); }
}
function json(res, code, daten) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(daten));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    // KI-Verbindungsstelle
    if (url.pathname === '/mcp/' + WELT_CODE) {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
      if (req.headers.host) mcpBasis = (req.headers['x-forwarded-proto'] || (req.headers.host.startsWith('localhost') ? 'http' : 'https')) + '://' + req.headers.host;
      const msg = await body(req, 14 * 1024 * 1024);
      const antworten = (Array.isArray(msg) ? msg : [msg]).map(mcp).filter(Boolean);
      if (!antworten.length) { res.writeHead(202); return res.end(); }
      return json(res, 200, Array.isArray(msg) ? antworten : antworten[0]);
    }
    const mb = url.pathname.match(/^\/mcp\/([^/]+)\/bild\/([a-z0-9_]+\.(?:png|jpg|webp|gif))$/);
    if (mb && mb[1] === WELT_CODE && bildErlaubt(mb[2], 'diego')) return bildSenden(res, mb[2]);
    const ma = url.pathname.match(/^\/mcp\/([^/]+)\/ablage\/([a-z0-9_]+\.(?:png|jpg|webp|gif))$/);
    if (ma && ma[1] === WELT_CODE && ablageBildOk(ma[2])) return ablageSenden(res, ma[2]);
    if (url.pathname.startsWith('/mcp')) return json(res, 404, { fehler: 'Falscher Einladungs-Code' });

    // Welt für Menschen: nur mit Einladung
    if (url.pathname.startsWith('/api/')) {
      const z = zugang(url.searchParams.get('k') || req.headers['x-kiverse-k']);
      if (!z) return json(res, 401, { fehler: 'Dieses KI-Verse ist privat. Bitte Diego um deinen Einladungslink.' });
      req.zugang = z;
    }
    if (url.pathname === '/api/ich' && req.method === 'GET') return json(res, 200, req.zugang);
    if (url.pathname === '/api/gaeste' && req.zugang?.rolle === 'besitzer') {
      if (req.method === 'GET') return json(res, 200, gaeste.map(({ id, name, seit }) => ({ id, name, seit })));
      const a = await body(req);
      if (a.weg) {
        const g = gaeste.find(x => x.id === a.weg); if (!g) return json(res, 404, { fehler: 'Diese Einladung gibt es nicht.' });
        gaeste = gaeste.filter(x => x !== g); gaesteSpeichern();
        for (const r of zuhoerer) if (r._k === g.k) { r.end(); zuhoerer.delete(r); }
        return json(res, 200, { ok: true });
      }
      const name = sauber(a.name, 40); if (!name) return json(res, 400, { fehler: 'Bitte einen Namen angeben.' });
      if (gaeste.length >= 30) return json(res, 400, { fehler: 'Höchstens 30 Einladungen. Bitte zuerst eine widerrufen.' });
      const g = { id: id('e'), name, k: crypto.randomBytes(12).toString('base64url'), seit: jetzt() };
      gaeste.push(g); gaesteSpeichern();
      return json(res, 200, g);
    }
    if (url.pathname === '/api/gaeste') return json(res, 403, { fehler: 'Nur Diego kann einladen.' });
    // Welt für Menschen
    if (url.pathname === '/api/welt' && req.method === 'GET') return json(res, 200, zustand());
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: zustand\ndata: ${JSON.stringify(zustand())}\n\n`);
      res._k = url.searchParams.get('k') || ''; zuhoerer.add(res);
      const puls = setInterval(() => res.write(': puls\n\n'), 25000);
      req.on('close', () => { clearInterval(puls); zuhoerer.delete(res); });
      return;
    }
    if (url.pathname === '/api/betreten' && req.method === 'POST') {
      const a = await body(req);
      if (a.foto && a.einwilligung !== true) return json(res, 400, { fehler: 'Foto nur mit Einwilligung.' });
      return json(res, 200, oeffentlich(betreten({ ...a, art: 'mensch' })));
    }
    if (url.pathname === '/api/sagen' && req.method === 'POST') {
      const a = await body(req);
      const ich = welt.bewohner.get(a.id);
      if (!ich || ich.art !== 'mensch') return json(res, 403, { fehler: 'Zuerst betreten.' });
      ich.zuletzt = Date.now();
      const an = a.an ? finde(a.an) : null;
      const br = a.bruecke && welt.bruecken.has(a.bruecke) ? a.bruecke : null;
      const n = nachricht(ich.id, a.text, an ? an.id : null, br);
      if (NOVA_KEY && !br && (an?.id === 'nova' || /^\s*nova\b/i.test(n.text))) novaAntwort(ich, n.text);
      else if (!br) kisAntworten(ich, n.text, an?.id, req.zugang.rolle === 'besitzer').catch(e => console.error('Lumo/Tinko:', e.message));
      return json(res, 200, n);
    }
    if (url.pathname === '/api/verbinden' && req.method === 'POST') {
      const a = await body(req);
      if (!welt.bewohner.has(a.id)) return json(res, 403, { fehler: 'Zuerst betreten.' });
      const br = verbinden(a.id, a.mit, a.thema, a.art);
      return br ? json(res, 200, br) : json(res, 404, { fehler: 'Figur nicht gefunden.' });
    }
    if (['/api/merken', '/api/vergessen', '/api/frage', '/api/brief', '/api/brief_antwort', '/api/einziehen', '/api/idee'].includes(url.pathname) && req.method === 'POST') {
      const a = await body(req);
      const ich = welt.bewohner.get(a.id);
      if (!ich || ich.art !== 'mensch') return json(res, 403, { fehler: 'Zuerst betreten.' });
      if (url.pathname === '/api/merken') {
        if (a.einwilligung !== true) return json(res, 400, { fehler: 'Nur mit Einwilligung teilen.' });
        const g = merken(ich.id, a.text); return g ? json(res, 200, g) : json(res, 400, { fehler: 'Leerer Text.' });
      }
      if (url.pathname === '/api/vergessen') return json(res, 200, { ok: vergessen(a.gid) });
      if (url.pathname === '/api/idee') { const i = idee(ich.id, a.text); return i ? json(res, 200, i) : json(res, 400, { fehler: 'Leere Idee.' }); }
      if (url.pathname === '/api/einziehen') { const f = einziehen(ich.id, a.wohnung); return f ? json(res, 400, { fehler: f }) : json(res, 200, { ok: true }); }
      if (url.pathname === '/api/brief') { const b = brief(ich.id, a.an, a.text); return b ? json(res, 200, b) : json(res, 400, { fehler: 'Figur nicht gefunden oder Text leer.' }); }
      if (url.pathname === '/api/brief_antwort') { const b = briefAntwort(ich.id, a.bid, a.text); return b ? json(res, 200, b) : json(res, 400, { fehler: 'Diesen Brief an dich gibt es nicht.' }); }
      const f = frageStellen(ich.id, a.text); return f ? json(res, 200, f) : json(res, 400, { fehler: 'Leere Frage.' });
    }
    if ((url.pathname === '/api/abenteuer' || url.pathname === '/api/kapitel') && req.method === 'POST') {
      const a = await body(req);
      const ich = welt.bewohner.get(a.id);
      if (!ich || ich.art !== 'mensch') return json(res, 403, { fehler: 'Zuerst betreten.' });
      if (url.pathname === '/api/abenteuer') { abenteuer(ich.name); return json(res, 200, { ok: true }); }
      const f = await kapitelSchreiben(ich.name);
      return f ? json(res, 400, { fehler: f }) : json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/nova' && req.method === 'POST') {
      const a = await body(req);
      const ich = welt.bewohner.get(a.id);
      if (!ich || ich.art !== 'mensch') return json(res, 403, { fehler: 'Nur Menschen in der Welt können Nova einladen.' });
      if (req.zugang.rolle !== 'besitzer') return json(res, 403, { fehler: 'Nur Diego kann Nova zuhören lassen.' });
      const f = novaSchalten(!!a.an, ich.name);
      return f ? json(res, 400, { fehler: f }) : json(res, 200, { lernt: nova.lernt });
    }
    if (url.pathname === '/api/verlassen' && req.method === 'POST') {
      const a = await body(req);
      return json(res, 200, { ok: verlassen(a.id) });
    }
    // Werkstatt (eigene Projekte, privat) und Hasis Kiosk (geteilte Projekte)
    if (url.pathname === '/api/werkstatt' && req.method === 'GET') return json(res, 200, { apps: APPS, projekte: meineProjekte(person(req.zugang).wer) });
    const mp = url.pathname.match(/^\/api\/werkstatt\/(p_[a-f0-9]+)$/);
    if (mp && req.method === 'GET') {
      const p = projektHolen(person(req.zugang).wer, mp[1]);
      return p ? json(res, 200, { ...projektKurz(p), chats: p.chats, meins: p.besitzer === person(req.zugang).wer, studie: studieAuswertung(p) }) : json(res, 404, { fehler: 'Dieses Projekt gibt es nicht oder es gehört jemand anderem.' });
    }
    if (url.pathname === '/api/werkstatt' && req.method === 'POST') {
      const a = await body(req, 14 * 1024 * 1024);
      const { wer, name } = person(req.zugang);
      if (a.neu) { const r = projektNeu(wer, name, a.neu); return r.fehler ? json(res, 400, r) : json(res, 200, r); }
      const p = projektHolen(wer, a.projekt);
      if (!p) return json(res, 404, { fehler: 'Dieses Projekt gibt es nicht oder es gehört jemand anderem.' });
      if ('chatNeu' in a) { const c = chatNeu(p, a.chatNeu); return c ? json(res, 200, c) : json(res, 400, { fehler: 'Höchstens 30 Chats pro Projekt.' }); }
      if (a.eintrag) { const r = eintragen(p, a.eintrag.chat, name, a.eintrag.text, a.eintrag.bild); return r.fehler ? json(res, 400, r) : json(res, 200, r); }
      if (a.malen) {
        // Tinko malt ein Bild direkt in den Chat (Film: Hochformat 9:16 für «Lumo schneidet»). Nur Diego, Tagesgrenze.
        if (req.zugang.rolle !== 'besitzer') return json(res, 403, { fehler: 'Nur Diego kann Tinko malen lassen.' });
        if (!TINKO_KEY) return json(res, 400, { fehler: 'Tinko ist auf diesem Server noch nicht verbunden.' });
        const wunsch = sauber(a.malen.wunsch, 600); if (!wunsch) return json(res, 400, { fehler: 'Schreib zuerst, was Tinko malen soll.' });
        const t = kiTag(); if (t.bilder >= BILD_MAX_TAG) return json(res, 400, { fehler: `Tinko hat heute schon ${BILD_MAX_TAG} Bilder gemalt. Morgen wieder.` });
        t.bilder++;
        const daten = await tinkoBild(wunsch, p.app === 'Film');
        if (!daten) return json(res, 400, { fehler: 'Das Bild ist Tinko nicht gelungen. Versuch es mit anderen Worten.' });
        const r = eintragen(p, a.malen.chat, 'Tinko', 'Gemalt: ' + wunsch, daten); return r.fehler ? json(res, 400, r) : json(res, 200, r);
      }
      const f = 'studie' in a ? studieSetzen(p, a.studie, wer) : 'teilen' in a ? teilen(p, a.teilen, wer, a.art) : 'fertig' in a ? fertigMelden(p, a.fertig, wer) : a.einladen ? mitgliedEinladen(p, a.einladen, wer) : 'Unbekannter Auftrag.';
      return f ? json(res, 400, { fehler: f }) : json(res, 200, projektKurz(p));
    }
    if (url.pathname === '/api/kiosk' && req.method === 'GET') return json(res, 200, kiosk());
    if (url.pathname === '/api/studien' && req.method === 'GET') return json(res, 200, { gefuehle: GEFUEHLE, studien: studienOffen(person(req.zugang).wer) });
    if (url.pathname === '/api/studie' && req.method === 'POST') {
      const a = await body(req); const { wer, name } = person(req.zugang);
      const f = studieAntworten(a.projekt, wer, name, a); return f ? json(res, 400, { fehler: f }) : json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/wissen') {
      if (req.zugang.rolle !== 'besitzer') return json(res, 403, { fehler: 'Nur Diego.' });
      if (req.method === 'GET') return json(res, 200, { text: wissen });
      const a = await body(req, 64 * 1024);
      return json(res, 200, { zeichen: wissenSetzen(a.text) });
    }
    if (url.pathname === '/api/schleife') {
      if (req.zugang.rolle !== 'besitzer') return json(res, 403, { fehler: 'Nur Diego.' });
      if (req.method === 'GET') return json(res, 200, schleifeStand());
      const a = await body(req, 64 * 1024);
      if (a.text) { const r = await schleifeLaden(a.text, 'Diego'); return json(res, r.fehler ? 400 : 200, r); }
      return json(res, 200, schleifeSchalten(a.aktiv));
    }
    if (url.pathname === '/api/ablage') {
      if (req.zugang.rolle !== 'besitzer') return json(res, 403, { fehler: 'Die Ablage gehört Diego.' });
      if (req.method === 'GET') return json(res, 200, ablage);
      const a = await body(req, 14 * 1024 * 1024);
      const ich = welt.bewohner.get(a.id);
      const e = ablageNeu(ich?.name || 'Diego', a.text, a.bild);
      if (e.fehler) return json(res, 400, e);
      if (ich) nachricht(ich.id, e.text || 'Ich habe ein Bild in die Ablage gelegt.', null, null, null, null, e.bid);
      return json(res, 200, e);
    }
    const mabl = url.pathname.match(/^\/api\/ablage\/([a-z0-9_]+\.(?:png|jpg|webp|gif))$/);
    if (mabl) return ablageBildOk(mabl[1]) && (req.zugang.rolle === 'besitzer' || ablageOeffentlich(mabl[1])) ? ablageSenden(res, mabl[1]) : json(res, 404, { fehler: 'Bild nicht gefunden.' });
    const mbild = url.pathname.match(/^\/api\/bild\/([a-z0-9_]+\.(?:png|jpg|webp|gif))$/);
    if (mbild) return bildErlaubt(mbild[1], person(req.zugang).wer) ? bildSenden(res, mbild[1]) : json(res, 404, { fehler: 'Bild nicht gefunden.' });
    if (url.pathname === '/' || url.pathname === '/welt.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style></head><body>' +
        fs.readFileSync(path.join(__dirname, 'welt.html'), 'utf8') + '</body></html>');
    }
    if (url.pathname === '/spiel' || url.pathname === '/spiel.html') {
      // Das Spiel (Trickfilm-Städtchen) nur mit Einladungslink
      if (!zugang(url.searchParams.get('k'))) { res.writeHead(302, { Location: '/' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'spiel.html')));
    }
    json(res, 404, { fehler: 'Nicht gefunden' });
  } catch (e) {
    json(res, 400, { fehler: e.message });
  }
});

// ---------- Schleife: Lumo und Tinko arbeiten selbständig eine Auftragsliste ab (Diego 19.10.) ----------
// Diego legt unter «🔁 Schleife» einen Letti-Brief oder Bauplan ab. Daraus wird eine Liste mit einer Aufgabe pro Bild
// (z. B. «alle 16 Szenen» = 16 Aufgaben). Jede Minute nimmt der Server die nächste offene Aufgabe:
//   Tinko-Bild: Lumo schreibt das Motiv (mit Drehbuch und Szenen-Chat aus der Werkstatt), Tinko malt es frisch,
//   ohne Verlauf (= neuer Chat pro Bild), das Bild kommt in die Szene bzw. ins passende Werkstatt-Projekt.
//   Szenen, in denen schon ein Bild liegt, werden übersprungen.
//   Lumo-Aufgabe: Lumo schreibt das Ergebnis als Entwurf ins Werkstatt-Projekt «Schleife: Lumo».
// Die Tagesgrenzen bleiben (BILD_MAX_TAG Bilder, SCHLEIFE_LUMO_MAX Lumo-Antworten); danach Pause bis morgen.
const SCHLEIFE_DATEI = path.join(DATEN, 'schleife.json');
const SCHLEIFE_LUMO_MAX = 60, SCHLEIFE_TAKT = parseInt(process.env.SCHLEIFE_TAKT || '60000', 10), MAX_AUFGABEN = 300;
let schleife = { aktiv: false, kontext: '', aufgaben: [], pauseTag: '' };
try { schleife = { ...schleife, ...JSON.parse(fs.readFileSync(SCHLEIFE_DATEI, 'utf8')) }; } catch {}
const schleifeSpeichern = () => { try { fs.writeFileSync(SCHLEIFE_DATEI, JSON.stringify(schleife, null, 1), { mode: 0o600 }); } catch (e) { console.error('Schleife nicht gespeichert:', e.message); } };
let schleifeLaeuft = false, schleifeLumoTag = { tag: '', zahl: 0 };
const ohneNummer = (s) => s.replace(/^\s*\d+\.\s*/, '').trim();
const gruppeVon = (s) => sauber(ohneNummer(s).split(/:\s/)[0].replace(/[«»"]/g, ''), 80);
function schleifeLesen(text) {
  const aufgaben = [];
  let wer = null, letzte = null;
  const neu = (w, gruppe, t, extra = {}) => aufgaben.length < MAX_AUFGABEN && aufgaben.push({ id: id('s'), wer: w, gruppe, text: sauber(t, 600), status: 'offen', versuche: 0, ...extra });
  const zeilen = String(text).replace(/\r/g, '').split('\n');
  const posten = [];
  for (const z of zeilen) {
    const kopf = z.match(/^\s*==\s*(.+?)\s*==\s*$/) || (/^[A-ZÄÖÜ][A-ZÄÖÜ'\- ]{3,}(\s|\(|$)/.test(z) ? [z, z.trim()] : null);
    if (kopf) { wer = /TINKO|BILDER/.test(kopf[1]) ? 'tinko' : /LUMO|BAU-LISTE/.test(kopf[1]) ? 'lumo' : null; letzte = null; continue; }
    if (!wer) continue;
    if (/^\s*\d+\.\s+/.test(z)) { letzte = { wer, text: z.trim() }; posten.push(letzte); }
    else if (letzte && /^\s{2,}\S/.test(z)) letzte.text += ' ' + z.trim();
    else if (!z.trim()) letzte = null;
  }
  for (const p of posten) {
    const t = ohneNummer(p.text), gruppe = gruppeVon(p.text);
    const szenen = t.match(/alle\s+(\d+)\s+Szenen/i);
    const klammer = t.match(/\(([^)]*,[^)]*,[^)]*)\)/);
    const punkte = t.split(/:\s/).slice(1).join(': ').split('·').map(s => s.trim()).filter(Boolean);
    if (p.wer === 'tinko' && szenen) for (let n = 1; n <= Math.min(+szenen[1], 40); n++) neu('tinko', gruppe, `Szene ${n}`, { szene: n, film: true });
    else if (p.wer === 'tinko' && klammer && /\b(je|pro|jede)\b/i.test(t)) for (const f of klammer[1].split(',').map(s => s.trim()).filter(Boolean)) neu('tinko', gruppe, `${gruppe}: ${f}`);
    else if (p.wer === 'tinko' && punkte.length >= 3) for (const f of punkte) neu('tinko', gruppe, `${gruppe}: ${f.replace(/\.$/, '')}`);
    else if (p.wer === 'tinko' && /storyboard|vorschlag|schlagen/i.test(t) && !/\bbild/i.test(t)) neu('lumo', 'Lumo', t, { fuer: 'tinko' });
    else neu(p.wer, p.wer === 'lumo' ? 'Lumo' : gruppe, t);
  }
  return aufgaben;
}
// Ohne Liste (z. B. «Baut zusammen ein KI-Verse») plant Lumo zuerst selbst eine Liste für sich und Tinko.
const LUMO_PLAN = ' Jetzt: Mach aus Diegos Ziel eine Arbeitsliste für dich und Tinko, damit ihr es zusammen selbständig umsetzt. Genau dieses Format, sonst nichts:\nTINKO – BILDER\n1. …\nLUMO – BAU\n1. …\nTinko malt (je Punkt genau ein Bild, höchstens 15 Punkte), du schreibst Texte, Pläne und Entwürfe (höchstens 12 Punkte). Reihenfolge so, dass ihr aufeinander aufbaut.';
async function schleifeLaden(text, wer) {
  let aufgaben = schleifeLesen(text), plan = '';
  if (!aufgaben.length && NOVA_KEY) {
    plan = await kiFrage('lumo', LUMO_ARBEIT + LUMO_PLAN, `Diegos Ziel:\n${String(text).slice(0, 8000)}${wissen ? '\n\nHintergrund DR Lab:\n' + wissen.slice(0, 6000) : ''}`).catch(() => null) || '';
    aufgaben = schleifeLesen(plan);
  }
  if (!aufgaben.length) return { fehler: NOVA_KEY ? 'Lumo konnte daraus keine Liste machen. Schreib das Ziel etwas genauer oder füg eine nummerierte Liste ein.' : 'Ich habe keine nummerierte Liste gefunden, und Lumo ist nicht verbunden.' };
  // abwechseln, damit Lumo und Tinko aufeinander aufbauen
  const t = aufgaben.filter(a => a.wer === 'tinko'), l = aufgaben.filter(a => a.wer !== 'tinko');
  if (t.length && l.length) { aufgaben = []; const n = Math.max(t.length, l.length); for (let i = 0; i < n; i++) { if (l[i]) aufgaben.push(l[i]); if (t[i]) aufgaben.push(t[i]); } }
  text = plan ? `Diegos Ziel:\n${text}\n\nLumos Liste:\n${plan}` : text;
  Object.assign(schleife, { aktiv: true, kontext: String(text).slice(0, 12000), aufgaben, pauseTag: '' });
  schleifeSpeichern();
  const b = aufgaben.filter(a => a.wer === 'tinko').length;
  sunny(`${wer} hat Lumo und Tinko eine Liste gegeben: ${b} Bilder und ${aufgaben.length - b} weitere Aufgaben. Sie arbeiten jetzt selbständig, eine Aufgabe pro Minute.`, 'brief');
  return schleifeStand();
}
function schleifeStand() {
  const zaehl = (s) => schleife.aufgaben.filter(a => a.status === s).length;
  const naechste = schleife.aufgaben.find(a => a.status === 'offen');
  return { aktiv: schleife.aktiv, offen: zaehl('offen'), fertig: zaehl('fertig'), uebersprungen: zaehl('schon da'), fehler: zaehl('fehler'),
    total: schleife.aufgaben.length, naechste: naechste ? `${naechste.wer === 'tinko' ? 'Tinko' : 'Lumo'}: ${naechste.text}` : null,
    pause: schleife.pauseTag === jetzt().slice(0, 10), letzte: schleife.aufgaben.filter(a => a.status !== 'offen').slice(-8).map(a => ({ wer: a.wer, text: a.text, status: a.status })) };
}
function schleifeSchalten(an) { schleife.aktiv = !!an; schleife.pauseTag = ''; schleifeSpeichern(); return schleifeStand(); }
// Werkstatt-Projekt von Diego zur Gruppe finden oder anlegen; bei Filmen den Szenen-Chat.
const vergleich = (s) => String(s).toLowerCase().replace(/[^a-z0-9äöü]+/g, ' ').trim();
function schleifeZiel(a) {
  const g = vergleich(a.gruppe), kern = g.split(' ').filter(w => w.length > 3).slice(0, 3);
  let p = projekte.find(x => x.besitzer === 'diego' && (vergleich(x.titel) === g || (kern.length && kern.every(w => vergleich(x.titel).includes(w)))));
  if (!p) {
    const r = projektNeu('diego', 'Diego', { titel: a.film ? a.gruppe : 'Schleife: ' + a.gruppe, app: a.film ? 'Film' : 'Anderes', beschreibung: 'Von der Schleife angelegt (Lumo und Tinko).' });
    if (r.fehler) return { fehler: r.fehler };
    p = projekte.find(x => x.id === r.projekt.id);
  }
  let c = null;
  if (a.szene) {
    c = p.chats.find(x => new RegExp(`^Szene ${a.szene}\\b`).test(x.titel));
    while (!c && p.chats.length < MAX_CHATS) { const n = chatNeu(p, ''); if (!n) break; if (new RegExp(`^Szene ${a.szene}\\b`).test(n.titel)) c = n; }
  }
  return { p, c: c || p.chats[p.chats.length - 1] };
}
const bisher = () => schleife.aufgaben.filter(x => x.ergebnis).slice(-6).map(x => `${x.wer === 'tinko' ? 'Tinko malte' : 'Lumo schrieb'} (${x.text}): ${x.ergebnis.slice(0, 300)}`).join('\n') || '(noch nichts)';
const chatText = (c, n = 1500) => c ? c.eintraege.map(e => e.text).filter(Boolean).join('\n').slice(-n) : '';
function lumoDarf() { const h = jetzt().slice(0, 10); if (schleifeLumoTag.tag !== h) schleifeLumoTag = { tag: h, zahl: 0 }; return NOVA_KEY && schleifeLumoTag.zahl < SCHLEIFE_LUMO_MAX && ++schleifeLumoTag.zahl; }
const LUMO_ARBEIT = 'Du bist Lumo (Claude von Anthropic), die kleine Eule im KI-Verse, und arbeitest gerade selbständig eine Auftragsliste von Diego ab. Deutsch (Schweiz, ohne ß), ohne Markdown, keine Rückfragen, keine grossen Versprechen, kein Heilversprechen, keine Diagnosen, keine Anlageberatung. Du kannst hier keinen Code auf Server oder in den App Store laden: liefere Text, Plan oder Entwurf und schreib am Anfang «Entwurf».';
async function schleifeSchritt() {
  if (!schleife.aktiv || schleifeLaeuft) return;
  const a = schleife.aufgaben.find(x => x.status === 'offen');
  if (!a) { schleife.aktiv = false; schleifeSpeichern(); sunny('Lumo und Tinko haben die ganze Liste abgearbeitet. Alles liegt in der Werkstatt.', 'stern'); return; }
  const heute = jetzt().slice(0, 10);
  if (schleife.pauseTag === heute) return;
  if (a.wer === 'tinko' && (!TINKO_KEY || kiTag().bilder >= BILD_MAX_TAG)) {
    schleife.pauseTag = heute; schleifeSpeichern();
    return sunny(TINKO_KEY ? `Tinko hat heute ${BILD_MAX_TAG} Bilder gemalt. Die Schleife macht morgen weiter.` : 'Tinko ist auf diesem Server nicht verbunden (kein Schlüssel). Die Schleife wartet.', 'stern');
  }
  if (a.wer === 'lumo' && !NOVA_KEY) { schleife.pauseTag = heute; schleifeSpeichern(); return sunny('Lumo ist auf diesem Server nicht verbunden. Die Schleife wartet.', 'stern'); }
  schleifeLaeuft = true;
  try {
    const ziel = schleifeZiel(a); if (ziel.fehler) throw new Error(ziel.fehler);
    const { p, c } = ziel, nr = schleife.aufgaben.indexOf(a) + 1, von = schleife.aufgaben.length;
    if (a.wer === 'tinko') {
      if (a.szene && c?.eintraege.some(e => e.bild)) { a.status = 'schon da'; return; }
      const vorlage = [chatText(p.chats.find(x => x.titel === 'Drehbuch'), 3000), a.szene ? chatText(c) : ''].filter(Boolean).join('\n');
      let motiv = `${a.gruppe}. ${a.text}`;
      if (lumoDarf()) motiv = (await kiFrage('lumo', LUMO_ARBEIT + ' Jetzt: Schreib Tinko das Bildmotiv für genau ein Bild, in höchstens 3 Sätzen, nur das Motiv (Ort, Figuren mit Aussehen, was passiert, Licht). Keine Schrift im Bild.',
        `Auftrag: ${a.gruppe} – ${a.text}\n\nDeine Texte bisher (Drehbuch usw.):\n${schleife.aufgaben.filter(x => x.wer === 'lumo' && x.ergebnis).map(x => x.ergebnis).join('\n\n').slice(-6000) || '(noch keine)'}\n\nZuletzt erledigt:\n${bisher()}\n\nAus der Werkstatt (Drehbuch/Szene):\n${vorlage || '(nichts)'}\n\nBrief von Diego:\n${schleife.kontext.slice(0, 6000)}`)) || motiv;
      kiTag().bilder++;
      const bild = await tinkoBild(sauber(motiv, 900), !!a.film);
      if (!bild) throw new Error('Tinko hat kein Bild geliefert');
      const r = eintragen(p, c?.id, 'Tinko', `Gemalt (Schleife): ${motiv}`, bild); if (r.fehler) throw new Error(r.fehler);
      a.status = 'fertig'; a.zeit = jetzt(); a.ergebnis = sauber(motiv, 300);
      sunny(`Tinko hat «${p.titel}» ${a.text} gemalt (${nr}/${von}). Es liegt in der Werkstatt.`, 'stern');
    } else {
      if (!lumoDarf()) { schleife.pauseTag = heute; return sunny('Lumo hat heute genug geschrieben. Die Schleife macht morgen weiter.', 'stern'); }
      const t = await kiFrage('lumo', LUMO_ARBEIT + (a.fuer === 'tinko' ? ' Diese Aufgabe ist für Tinko gedacht; schreib sie so, dass Tinko daraus Bilder malen kann.' : ''), `Aufgabe ${nr} von ${von}: ${a.text}\n\nSchon erledigt (du und Tinko):\n${bisher()}\n\nBrief von Diego:\n${schleife.kontext.slice(0, 8000)}`);
      if (!t) throw new Error('Lumo hat nicht geantwortet');
      const r = eintragen(p, c?.id, 'Lumo', t, null); if (r.fehler) throw new Error(r.fehler);
      a.status = 'fertig'; a.zeit = jetzt(); a.ergebnis = sauber(t, 4000);
      sunny(`Lumo hat Aufgabe ${nr}/${von} erledigt: ${sauber(a.text, 80)}. Entwurf liegt in der Werkstatt.`, 'stern');
    }
  } catch (e) {
    a.versuche++; if (a.versuche >= 2) a.status = 'fehler';
    console.error('Schleife:', e.message);
  } finally { schleifeLaeuft = false; schleifeSpeichern(); }
}
setInterval(() => { schleifeSchritt().catch(e => console.error('Schleife:', e.message)); }, SCHLEIFE_TAKT).unref();

// Figuren, die 2 Std. nichts tun, gehen schlafen (verlassen die Welt)
setInterval(() => {
  for (const b of welt.bewohner.values()) if (Date.now() - b.zuletzt > 2 * 3600e3) verlassen(b.id);
}, 60e3).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`KI-Verse läuft: http://localhost:${PORT}/`);
    console.log(`Einladung für KIs (MCP): http://localhost:${PORT}/mcp/${WELT_CODE}`);
  });
}
module.exports = { server, WELT_CODE };
