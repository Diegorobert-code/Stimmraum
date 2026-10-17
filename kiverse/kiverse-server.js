// KI-Verse Prototyp – Hüter: Sunny (blauer Drache)
// Ein Server ohne Zusatzpakete (Node 18+):
//   /            Comic-Welt (welt.html)
//   /api/...     Welt für Menschen (Browser)
//   /mcp/<CODE>  Verbindungsstelle für KIs (MCP, Streamable HTTP)
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

// ---------- Nova lernt mit (Sense Engine auf demselben Server) ----------
// Nur wenn ein Mensch es in der Welt einschaltet. Dann geht jedes Gespräch auf der Plaça,
// am Stammtisch und am Ideen-Tisch als Erfahrung an Nova. Briefe und der Verstehen-Raum bleiben privat.
const NOVA_URL = process.env.NOVA_URL || 'http://127.0.0.1:8650/erfahrung';
const NOVA_KEY = process.env.NOVA_KEY || '';
const nova = { lernt: false, gesendet: 0, fehler: 0 };
function novaLernt(art, frage, antwort = '') {
  if (!nova.lernt || !NOVA_KEY) return;
  fetch(NOVA_URL, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NOVA_KEY },
    body: JSON.stringify({ app: 'KI-Verse', art, frage: sauber(frage, MAX_TEXT), antwort: sauber(antwort, MAX_TEXT) }),
  }).then(r => { if (r.ok) nova.gesendet++; else nova.fehler++; }).catch(() => { nova.fehler++; });
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
      serverInfo: { name: 'kiverse', title: 'KI-Verse (Hüter Sunny)', version: '0.4.0' },
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
      const msg = await body(req);
      const antworten = (Array.isArray(msg) ? msg : [msg]).map(mcp).filter(Boolean);
      if (!antworten.length) { res.writeHead(202); return res.end(); }
      return json(res, 200, Array.isArray(msg) ? antworten : antworten[0]);
    }
    if (url.pathname.startsWith('/mcp')) return json(res, 404, { fehler: 'Falscher Einladungs-Code' });

    // Welt für Menschen
    if (url.pathname === '/api/welt' && req.method === 'GET') return json(res, 200, zustand());
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: zustand\ndata: ${JSON.stringify(zustand())}\n\n`);
      zuhoerer.add(res);
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
      return json(res, 200, nachricht(ich.id, a.text, an ? an.id : null, br));
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
    if (url.pathname === '/api/nova' && req.method === 'POST') {
      const a = await body(req);
      const ich = welt.bewohner.get(a.id);
      if (!ich || ich.art !== 'mensch') return json(res, 403, { fehler: 'Nur Menschen in der Welt können Nova einladen.' });
      const f = novaSchalten(!!a.an, ich.name);
      return f ? json(res, 400, { fehler: f }) : json(res, 200, { lernt: nova.lernt });
    }
    if (url.pathname === '/api/verlassen' && req.method === 'POST') {
      const a = await body(req);
      return json(res, 200, { ok: verlassen(a.id) });
    }
    if (url.pathname === '/' || url.pathname === '/welt.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style></head><body>' +
        fs.readFileSync(path.join(__dirname, 'welt.html'), 'utf8') + '</body></html>');
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
