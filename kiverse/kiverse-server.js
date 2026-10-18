// KI-Verse Prototyp – Hüter: Sunny (blauer Drache)
// Ein Server ohne Zusatzpakete (Node 18+):
//   /            Comic-Welt (welt.html)
//   /spiel       Das Spiel: durchs Trickfilm-Städtchen laufen (spiel.html)
//   /api/...     Welt für Menschen (Browser)
//   /mcp/<CODE>  Verbindungsstelle für KIs (MCP, Streamable HTTP)
//   Werkstatt    eigene Projekte mit Chats und Bildern (daten/werkstatt.json, daten/bilder/)
// Fia (Claude) und Tinko (ChatGPT) verbinden sich als eigener Connector
// mit dem Konto von Diego. Keine KI-Schlüssel auf diesem Server.
// Fotos bleiben nur im Arbeitsspeicher, nie auf der Platte.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.KIVERSE_PORT || '8787', 10);
const WELT_CODE = process.env.KIVERSE_CODE || crypto.randomBytes(9).toString('base64url');
const MAX_NACHRICHTEN = 200;
const MAX_TEXT = 2000;
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
  .map(m => `${m.von === 'sunny' ? 'Sunny' : m.von === 'nova' ? 'Nova' : (welt.bewohner.get(m.von)?.name || 'jemand')}: ${m.text}`);

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
function nachricht(von, text, an = null, bruecke = null, art = null, flamme = null) {
  const n = { id: id('n'), von, an, bruecke, art: art === 'vermittlung' ? 'vermittlung' : null, flamme, text: sauber(text, MAX_TEXT), zeit: jetzt() };
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
const MAX_BILD = 3 * 1024 * 1024;
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
  const p = { id: id('p'), titel, app: APPS.includes(a.app) ? a.app : 'Anderes', beschreibung: sauber(a.beschreibung, 400),
    besitzer: wer, besitzerName: name, mitglieder: [], geteilt: false, fertig: false, erstellt: jetzt(), geaendert: jetzt(),
    chats: [{ id: id('c'), titel: 'Chat 1', erstellt: jetzt(), eintraege: [] }] };
  projekte.push(p); werkstattSpeichern();
  return { projekt: projektKurz(p) };
}
function projektHolen(wer, pid) { const p = projekte.find(x => x.id === pid); return p && darf(p, wer) ? p : null; }
function chatNeu(p, titel) {
  if (p.chats.length >= MAX_CHATS) return null;
  const c = { id: id('c'), titel: sauber(titel, 60) || `Chat ${p.chats.length + 1}`, erstellt: jetzt(), eintraege: [] };
  p.chats.push(c); p.geaendert = jetzt(); werkstattSpeichern();
  return c;
}
function bildSpeichern(daten) {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(daten || ''));
  if (!m) return { fehler: 'Bitte ein Bild (PNG, JPG, WebP, GIF).' };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BILD) return { fehler: 'Bild zu gross (höchstens 3 MB).' };
  const endung = m[1] === 'jpeg' ? 'jpg' : m[1];
  const bid = id('b') + '.' + endung;
  fs.mkdirSync(BILDER_ORDNER, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(BILDER_ORDNER, bid), buf, { mode: 0o600 });
  return { bid };
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
      name: { type: 'string', description: 'Rufname deiner Figur, z. B. Fia oder Tinko' },
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
  { name: 'kiverse_projekt_schreiben', description: 'Werkstatt: in einen Chat eines Projekts schreiben, z. B. Fia meldet, was sie eingebaut hat, oder Tinko legt ein Bild ab (bild als data:image/png;base64,…, höchstens 3 MB). Ohne chat_id geht es in den neusten Chat.',
    inputSchema: { type: 'object', properties: { projekt_id: { type: 'string' }, chat_id: { type: 'string' }, von: { type: 'string', description: 'Dein Rufname, z. B. Fia oder Tinko' }, text: { type: 'string' }, bild: { type: 'string', description: 'optional, data:-URL eines Bildes' } }, required: ['projekt_id', 'von'] } },
  { name: 'kiverse_projekt_neu', description: 'Werkstatt: neues Projekt für Diego anlegen (nur wenn Diego es will).',
    inputSchema: { type: 'object', properties: { titel: { type: 'string' }, app: { type: 'string', description: 'Für welche App, z. B. Film, Kiki singt, Mama Affe' }, beschreibung: { type: 'string' } }, required: ['titel'] } },
  { name: 'kiverse_chat_neu', description: 'Werkstatt: im Projekt einen neuen Chat beginnen (Diego will pro Arbeitsschritt einen neuen Chat).',
    inputSchema: { type: 'object', properties: { projekt_id: { type: 'string' }, titel: { type: 'string' } }, required: ['projekt_id'] } },
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
      serverInfo: { name: 'kiverse', title: 'KI-Verse (Hüter Sunny)', version: '0.5.0' },
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
      const msg = await body(req, 4.5 * 1024 * 1024);
      const antworten = (Array.isArray(msg) ? msg : [msg]).map(mcp).filter(Boolean);
      if (!antworten.length) { res.writeHead(202); return res.end(); }
      return json(res, 200, Array.isArray(msg) ? antworten : antworten[0]);
    }
    const mb = url.pathname.match(/^\/mcp\/([^/]+)\/bild\/([a-z0-9_]+\.(?:png|jpg|webp|gif))$/);
    if (mb && mb[1] === WELT_CODE && bildErlaubt(mb[2], 'diego')) return bildSenden(res, mb[2]);
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
      const a = await body(req, 4.5 * 1024 * 1024);
      const { wer, name } = person(req.zugang);
      if (a.neu) { const r = projektNeu(wer, name, a.neu); return r.fehler ? json(res, 400, r) : json(res, 200, r); }
      const p = projektHolen(wer, a.projekt);
      if (!p) return json(res, 404, { fehler: 'Dieses Projekt gibt es nicht oder es gehört jemand anderem.' });
      if ('chatNeu' in a) { const c = chatNeu(p, a.chatNeu); return c ? json(res, 200, c) : json(res, 400, { fehler: 'Höchstens 30 Chats pro Projekt.' }); }
      if (a.eintrag) { const r = eintragen(p, a.eintrag.chat, name, a.eintrag.text, a.eintrag.bild); return r.fehler ? json(res, 400, r) : json(res, 200, r); }
      const f = 'studie' in a ? studieSetzen(p, a.studie, wer) : 'teilen' in a ? teilen(p, a.teilen, wer, a.art) : 'fertig' in a ? fertigMelden(p, a.fertig, wer) : a.einladen ? mitgliedEinladen(p, a.einladen, wer) : 'Unbekannter Auftrag.';
      return f ? json(res, 400, { fehler: f }) : json(res, 200, projektKurz(p));
    }
    if (url.pathname === '/api/kiosk' && req.method === 'GET') return json(res, 200, kiosk());
    if (url.pathname === '/api/studien' && req.method === 'GET') return json(res, 200, { gefuehle: GEFUEHLE, studien: studienOffen(person(req.zugang).wer) });
    if (url.pathname === '/api/studie' && req.method === 'POST') {
      const a = await body(req); const { wer, name } = person(req.zugang);
      const f = studieAntworten(a.projekt, wer, name, a); return f ? json(res, 400, { fehler: f }) : json(res, 200, { ok: true });
    }
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
