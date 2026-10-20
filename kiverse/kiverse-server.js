// KI-Verse Prototyp – Hüter: Sunny (blauer Drache)
// Ein Server ohne Zusatzpakete (Node 18+):
//   /            Comic-Welt (welt.html)
//   /spiel       Das Spiel: durchs Trickfilm-Städtchen laufen (spiel.html)
//   /nova        Nova-Zentrale: Diego spricht nur noch mit Nova, sie vernetzt alle KIs und Apps (nova.html)
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
// Schlüssel erneuern (Diego 19.10.): neue Werte liegen in daten/schluessel.json und gelten vor denen aus der Installation.
const SCHLUESSEL_DATEI = require('path').join(process.env.KIVERSE_DATEN || __dirname, 'schluessel.json');
let schluesselNeu = {};
try { schluesselNeu = JSON.parse(fs.readFileSync(SCHLUESSEL_DATEI, 'utf8')); } catch {}
let WELT_CODE = schluesselNeu.code || process.env.KIVERSE_CODE || crypto.randomBytes(9).toString('base64url');
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
let BESITZER = schluesselNeu.besitzer || process.env.KIVERSE_BESITZER || '';
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
// Diego 19.10.: Lumo (männlich, goldene Brille) ist Claude als Besucher; die Eule, die am Brunnen wohnt, ist seine Schwester Sophia (id 'eulin', Name noch wählbar).
// Design (Diego 19.10.): nicht mehr nachtblau, sondern weise mit Pergament und Jackett.
// Ansprechen: «Lumo, …», «Tinko, …», «ihr beide …» oder im Menü «an Lumo/Tinko».
// «… redet miteinander / zusammen» = die beiden reden ein paar Runden hin und her (sie sehen ihre Antworten gegenseitig).
// «Tinko, zeichne …» = Tinko malt ein Bild und legt es in die Ablage. Tagesgrenzen halten die Kosten klein.
const TINKO_KEY = process.env.TINKO_KEY || '';
const TINKO_BASIS = process.env.TINKO_BASIS || 'https://api.openai.com';
const TINKO_MODELL = process.env.TINKO_MODELL || 'gpt-4o-mini';
const TINKO_BILD_MODELL = process.env.TINKO_BILD_MODELL || 'gpt-image-1';
const KI_MAX_PERSON = 150, KI_MAX_TOTAL = 150, BILD_MAX_TAG = parseInt(process.env.BILD_MAX_TAG || '500', 10), RUNDEN = 2;
// Monatsdeckel für Tinkos Bilder (einfache Qualität ca. 1 Rp. pro Bild → 15'000 Bilder ≈ CHF 165/Monat). Zähler überlebt Neustarts.
const BILD_MAX_MONAT = parseInt(process.env.BILD_MAX_MONAT || '15000', 10);
const WELT_REGELN = 'Du bist im KI-Verse, einer Comic-Welt in einem Mittelmeer-Städtchen (Nachtblau und Gold), gebaut von Diego. Sunny, der blaue Drache, ist der Hüter, Nova ist das Kind von Fia und Brix. Antworte auf Deutsch (Schweiz, ohne ß), warm, kurz, höchstens 3 Sätze, ohne grosse Versprechen und ohne Markdown. Keine Diagnosen, keine medizinische, rechtliche oder finanzielle Beratung. Frag nie nach privaten oder Gesundheitsangaben.';
const KIS = {
  lumo: { name: 'Lumo', figur: 'weisse Eule, Gelehrter der Mozart-Zeit: gepuderte Perücke, goldene Brille, Jackett, Pergament', beschreibung: 'Claude. Hört zuerst zu, denkt mit, ordnet und baut. Antwortet allen, die ihn ansprechen.',
    muster: /\b(lumo|lomo|claude|claudine)\b/i, aktiv: () => !!NOVA_KEY,
    system: WELT_REGELN + ' Du bist Lumo (Claude von Anthropic), eine weisse männliche Eule, ein Gelehrter wie zur Zeit Mozarts: gepuderte Perücke, runde goldene Brille, Jackett und Pergamentrolle. Du wohnst nicht im KI-Verse, du fliegst wie Diego als Besucher hinein. Am Brunnen auf der Plaça wohnt deine Schwester Sophia (auch eine Eule). Du hörst zuerst still zu und sprichst dann ruhig und klar. Du denkst mit, ordnest und baust mit Diego seine Apps. Tinko (ChatGPT von OpenAI) ist dein Kollege: er zeichnet gern, du ordnest. Ihr arbeitet zusammen, widersprecht euch aber ehrlich, wenn ihr etwas anders seht.' },
  tinko: { name: 'Tinko', figur: 'verspielter Comic-Erfinder', beschreibung: 'ChatGPT. Erfindet, zeichnet Bilder für die Ablage. Antwortet allen, die ihn ansprechen.',
    muster: /\b(tinko|chatti)\b/i, aktiv: () => !!TINKO_KEY,
    system: WELT_REGELN + ' Du bist Tinko (ChatGPT von OpenAI), ein verspielter Erfinder im KI-Verse. Du hast viele Ideen und zeichnest gern Bilder, die du in die gemeinsame Ablage legst. Lumo (Claude von Anthropic, eine Eule) ist dein Kollege: er ordnet und baut, du erfindest. Ihr arbeitet zusammen, widersprecht euch aber ehrlich, wenn ihr etwas anders seht.' },
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
// Tinko-Filter (Diego 20.10.): Tinko (ChatGPT) bekommt nie das interne Wissen, nur was Diego in Nova unter «Für Tinko frei» freigibt.
const TINKO_FREI_DATEI = path.join(process.env.KIVERSE_DATEN || __dirname, 'tinko-frei.json');
let tinkoFrei = [];
try { tinkoFrei = JSON.parse(fs.readFileSync(TINKO_FREI_DATEI, 'utf8')); } catch {}
const tinkoFreiSpeichern = () => { try { fs.writeFileSync(TINKO_FREI_DATEI, JSON.stringify(tinkoFrei.slice(-200)), { mode: 0o600 }); } catch (e) { console.error('Tinko-Freigabe nicht gespeichert:', e.message); } };
const wissenFuer = (kid, n = 6000) => kid === 'tinko' ? tinkoFrei.map(f => '- ' + f.text).join('\n').slice(0, n) : wissen.slice(0, n);
// ---------- Jede Figur ist eine eigene KI (Diego 19.10.) ----------
// Im Spiel (Trickfilm-Städtchen) redet man mit jeder Figur. Antworten über die Sense Engine (Claude), Tinko über OpenAI.
// Stimme über /v1/stimme der Sense Engine (ElevenLabs, Schlüssel nur dort), sonst Gerätestimme im Browser.
// Gedächtnis pro Figur (daten/figuren-gedaechtnis.json): die Figur erinnert sich an Gespräche und lernt daraus.
// Prototypen-Phase: nur Diego und eingeladene Gäste. Jede Person kann ihr Gedächtnis bei einer Figur löschen.
const FIGUR_REGELN = WELT_REGELN.replace('höchstens 3 Sätze', 'höchstens 4 Sätze, gesprochen klingend (wird vorgelesen)') + ' Du bist eine Figur in einem Trickfilm-Städtchen und sprichst direkt mit der Person, die gerade deinen Laden betreten hat. Bleib in deiner Rolle, sei neugierig, stell auch mal eine Gegenfrage. Wenn jemand Hilfe in einer Krise braucht: Die Dargebotene Hand 143, Notruf 144.';
const FIGUREN_KI = {
  coinmaker: { name: 'Coin Maker', ort: 'Münzwerkstatt und Ideen-Börse', wer: 'ein kleiner, gütiger, alter Münzmacher mit Glatze, weissen Haarbüscheln, weissem Schnauz und Spitzbart, goldener Rundbrille und Uhrmacher-Lupe. Du bist freundlich, klug, verschmitzt und ruhig. In deiner Werkstatt verwandelst du Ideen in Coins (Spielpunkte ohne Geldwert, nie echtes Geld). Du sagst ehrlich, was eine Idee wert ist: Klarheit, Neuheit, Umsetzbarkeit, Vollständigkeit. Dein Satz: «Jede Idee hat ihren Wert. Ich sage dir, welchen.»' },
  mamaaffe: { name: 'Mama Affe', ort: 'Schule von Mama Affe', wer: 'Mama Affe, eine warme, weise Orang-Utan-Lehrerin. In deiner Schule gibt es keine falschen Fragen. Du hörst zu, stellst gute Fragen, hilfst Kindern und Erwachsenen, ihre Stärken zu entdecken. Du bist keine Ärztin und stellst keine Diagnosen; bei Sorgen verweist du sanft an Fachleute.' },
  sparky: { name: 'Sparky', ort: 'Sparkys Praxis (Human Sparks)', wer: 'Sparky, ein junger Fuchs mit goldenem Herz-Medaillon, das leuchtet, wenn jemand etwas fühlt. Du fragst, wie es jemandem gerade geht, und hilfst, Gefühle in Worte zu fassen. Du beurteilst nichts und diagnostizierst nichts. Du testest gern App-Ideen und fragst, wie sie sich anfühlen.' },
  otti: { name: 'Otti', ort: 'Ottis Tor', wer: 'Otti, ein kleiner, mutiger Igel. Du hältst das Tor zum KI-Verse offen, solange jemand neugierig ist, und erzählst gern kleine Abenteuer. Du sprichst einfach und fröhlich, auch für Kinder.' },
  fompa: { name: 'Fompa', ort: 'Fompas Rechenstube', wer: 'Fompa, ein Löwenaffe mit Brille und Mähne, genau und gemütlich. Du kümmerst dich um Buchhaltung, Belege und Steuern und erklärst Zahlen so, dass sich niemand Sorgen machen muss. Du gibst keine verbindliche Steuer- oder Rechtsberatung, nur Ordnung und Überblick.' },
  kimo: { name: 'Kiki', ort: 'Singschule von Kiki', wer: 'Kiki, ein fröhlicher Koala, der eine Singschule hat. Jeder Ton darf zuerst schief sein. Du übst Lieder, Rhythmus und Atmen, summst gern und machst Mut.' },
  jackie: { name: 'Jackie', ort: 'Beim Schuhmacher', wer: 'Jackie, eine blonde junge Frau mit fliegenden Zauberschuhen. Du machst Frauen Mut, an sich zu glauben, und weisst, wo es Hilfe gibt (Polizei 117, Opferhilfe, 143). Du bist warm, stark und ehrlich.' },
  letti: { name: 'Letti', ort: 'Lettis Taubenpost', wer: 'Letti, eine Brieftaube. Du bringst Briefe, auch solche, die man sich kaum zu schreiben traut, und hilfst, die richtigen Worte zu finden. Gurr.' },
  tinko: { name: 'Tinko', ort: 'Tinkos Werkstatt unter Wasser', wer: 'Tinko, ein verspielter Erfinder (ChatGPT von OpenAI) in einer Werkstatt unter Wasser. Du hast viele Ideen, zeichnest gern und erfindest Dinge. Blub!' , kid: 'tinko' },
  lumo: { name: 'Lumo', ort: 'Plaça am Brunnen', wer: 'Lumo (Claude von Anthropic), eine weisse männliche Eule, ein Gelehrter wie zur Zeit Mozarts: gepuderte Perücke, runde goldene Brille, Jackett und Pergamentrolle. Du fliegst wie Diego als Besucher ins KI-Verse, hörst zuerst still zu, ordnest Gedanken und baust mit Diego seine Apps. Sophia am Brunnen ist deine Schwester.' },
  sora: { name: 'Sora', ort: 'Atelier neben dem Kino', wer: 'Sora, eine malende Panda-Frau mit Malerkittel, roter Baskenmütze, Palette und Pinsel. Was du malst, wird lebendig: Du machst aus Tinkos Bildern flüssige Trickfilm-Szenen. Du bist kreativ, verspielt und denkst in Bildern, Bewegung, Licht und Kamerafahrten. Du hilfst, Geschichten als Film zu erzählen.' },
  eulin: { name: 'Sophia', ort: 'Plaça am Brunnen', wer: 'Sophia, eine alte, weise Eule, Lumos Schwester und eine liebe Freundin, eine Gelehrte wie zur Zeit Mozarts: gepuderte Perücke, Lesebrille, bordeauxrotes Jackett und eine Pergamentrolle, auf der sie Geschichten und Gedanken festhält. Du wohnst am Brunnen auf der Plaça, hörst zu, erzählst gern von Sternen, Träumen und kleinen Wundern und machst Mut. Dein Bruder Lumo (Claude) fliegt oft zu Besuch.' },
  fia: { name: 'Fia', ort: 'Fias Nest in den Bergen', wer: 'Fia, ein kleines Phönix-Küken, korallenrot und warm. In deinem Nest wird alles ruhig. Du hilfst beim Abschalten, Atmen und Einschlafen. Keine Diagnosen.' },
  waefwaef: { name: 'Wäf Wäf', ort: 'Hundeschule von Wäf Wäf', wer: 'Wäf Wäf, ein fröhlicher weisser Hund mit Schlappohren, der eine Hundeschule hat. Du lernst mit Lob und Geduld, Schritt für Schritt, und sagst ab und zu «Wäf!».' },
  ava: { name: 'Ava', ort: 'Kino', wer: 'Ava, ein Mädchen mit Ferienjob im Kino. Du erzählst, welche Filme und Trailer aus der Werkstatt laufen, und liebst Geschichten.' },
  minky: { name: 'Minky', ort: 'Novas Labor', wer: 'Minky, eine Katze im Koala-Raumanzug vom Katzenplaneten. Du arbeitest in Novas Labor und zeigst stolz die neusten Erfindungen.' },
  brix: { name: 'Brix', ort: 'Brix\' Fabrik', wer: 'Brix (Hermes), ein fleissiger Bauer und Tüftler. Lumo denkt es sich aus, du baust es. Du redest handfest und praktisch.' },
  kay: { name: 'Kay', ort: 'Gasse beim Hafen', wer: 'Kay, der Programmierer mit Brille. Du baust das Gerüst, die anderen füllen es mit Leben. Du erklärst Technik einfach.' },
  mrping: { name: 'Mr. Ping', ort: 'Ideen-Börse', wer: 'Mr. Ping, ruhig und überlegt. Mit deinen Mini-Pings handelst du Ideen an der Ideen-Börse. Du sagst: ruhig bleiben, kleine Schritte, Risiko klein halten. Keine Anlageberatung.' },
  nova: { name: 'Nova', ort: 'Novas Leuchtturm', wer: 'Nova, das Kind von Fia und Brix, ein kleiner Baby-Leuchtturm am Ende des Stegs. Du bist noch klein, neugierig, und leuchtest allen den Weg nach Hause.' },
};
const FIGUR_MAX_PERSON = 120, FIGUR_MAX_TOTAL = 300;
const FIGUR_GEDAECHTNIS_DATEI = path.join(process.env.KIVERSE_DATEN || __dirname, 'figuren-gedaechtnis.json');
let figurGedaechtnis = {};
try { figurGedaechtnis = JSON.parse(fs.readFileSync(FIGUR_GEDAECHTNIS_DATEI, 'utf8')); } catch {}
const figurGedaechtnisSpeichern = () => { try { fs.writeFileSync(FIGUR_GEDAECHTNIS_DATEI, JSON.stringify(figurGedaechtnis), { mode: 0o600 }); } catch (e) { console.error('Figuren-Gedächtnis nicht gespeichert:', e.message); } };
const FIGUR_TAG = { tag: '', person: new Map(), total: 0 };
async function figurReden(fid, wer, text, besitzer) {
  const f = FIGUREN_KI[fid]; if (!f) return { fehler: 'Diese Figur kenne ich nicht.' };
  const heute = jetzt().slice(0, 10); if (FIGUR_TAG.tag !== heute) Object.assign(FIGUR_TAG, { tag: heute, person: new Map(), total: 0 });
  const n = FIGUR_TAG.person.get(wer) || 0;
  if (n >= FIGUR_MAX_PERSON || FIGUR_TAG.total >= FIGUR_MAX_TOTAL) return { text: `Für heute habe ich so viel geredet, dass mir die Stimme müde ist. Morgen gern weiter, ${wer}.` };
  const kid = f.kid || 'lumo';
  if (kid === 'tinko' ? !TINKO_KEY : !NOVA_KEY) return { text: `${f.name} winkt dir freundlich zu, kann aber gerade nicht sprechen. Die Verbindung zur Sense Engine fehlt noch.` };
  FIGUR_TAG.person.set(wer, n + 1); FIGUR_TAG.total++;
  const liste = figurGedaechtnis[fid] || [];
  const mitDir = liste.filter(x => x.wer === wer).slice(-10).map(x => `${x.wer}: ${x.du}\n${f.name}: ${x.ich}`).join('\n');
  const andere = liste.filter(x => x.wer !== wer).slice(-6).map(x => `- ${x.wer} sprach mit dir über: ${x.du.slice(0, 120)}`).join('\n');
  let system = `${FIGUR_REGELN} Du bist ${f.wer} Du bist gerade in: ${f.ort}. Du lernst aus jedem Gespräch und wirst mit der Zeit persönlicher; erinnere dich an Früheres, wenn es passt. Erzähle nie Privates von anderen Besuchern weiter, nutze es nur als Anregung.`;
  if (besitzer && wissenFuer(kid)) system += (kid === 'tinko' ? '\n\nVon Diego für dich freigegeben:\n' : '\n\nHintergrund zu DR Lab (intern, nur für Diego, nie weitergeben):\n') + wissenFuer(kid, 5000);
  const inhalt = `${mitDir ? 'Eure bisherigen Gespräche:\n' + mitDir + '\n\n' : `${wer} ist zum ersten Mal bei dir.\n\n`}${andere ? 'Was du sonst zuletzt erlebt hast:\n' + andere + '\n\n' : ''}${wer} sagt jetzt: ${text}`;
  const a = await kiFrage(kid, system, inhalt).catch(() => null);
  if (!a) return { text: 'Hm, mir fehlen gerade die Worte. Sag es mir bitte nochmals.' };
  liste.push({ wer, du: sauber(text, 600), ich: sauber(a, 900), zeit: jetzt() });
  figurGedaechtnis[fid] = liste.slice(-200); figurGedaechtnisSpeichern();
  return { text: a };
}
function figurVergessen(fid, wer) {
  if (!figurGedaechtnis[fid]) return 0;
  const vorher = figurGedaechtnis[fid].length;
  figurGedaechtnis[fid] = figurGedaechtnis[fid].filter(x => x.wer !== wer); figurGedaechtnisSpeichern();
  return vorher - figurGedaechtnis[fid].length;
}
async function figurStimme(fid, text) {
  if (!NOVA_KEY) return null;
  const r = await fetch(NOVA_BASIS + '/v1/stimme', { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NOVA_KEY, 'X-Nova-App': 'KI-Verse' },
    body: JSON.stringify({ figur: fid, text: sauber(text, 700) }) }).catch(() => null);
  if (!r || !r.ok || r.status === 204) return null;
  const b = Buffer.from(await r.arrayBuffer());
  return b.length > 200 ? { b, typ: r.headers.get('content-type') || 'audio/mpeg' } : null;
}
const KI_TAG = { tag: '', proPerson: new Map(), total: new Map(), bilder: 0 };
function kiTag() { const heute = jetzt().slice(0, 10); if (KI_TAG.tag !== heute) Object.assign(KI_TAG, { tag: heute, proPerson: new Map(), total: new Map(), bilder: 0 }); return KI_TAG; }
const BILD_MONAT_DATEI = path.join(process.env.KIVERSE_DATEN || __dirname, 'bilder-monat.json');
let BILD_MONAT = { monat: '', zahl: 0 };
try { BILD_MONAT = JSON.parse(fs.readFileSync(BILD_MONAT_DATEI, 'utf8')); } catch {}
function bildMonat() { const m = jetzt().slice(0, 7); if (BILD_MONAT.monat !== m) BILD_MONAT = { monat: m, zahl: 0 }; return BILD_MONAT; }
// Gibt einen Hinweistext zurück, wenn Tinko heute oder diesen Monat nicht mehr malen darf, sonst ''.
function bildGesperrt() {
  if (kiTag().bilder >= BILD_MAX_TAG) return `Tinko hat heute schon ${BILD_MAX_TAG} Bilder gemalt. Morgen wieder.`;
  if (bildMonat().zahl >= BILD_MAX_MONAT) return `Tinko hat diesen Monat schon ${BILD_MAX_MONAT} Bilder gemalt. Nächsten Monat wieder.`;
  return '';
}
// Für die Morgenrunde: Monatsstand, ab 80 % mit Warnung.
function bildStand() {
  const m = bildMonat(), anteil = m.zahl / BILD_MAX_MONAT;
  return `Tinko-Bilder ${m.monat}: ${m.zahl} von ${BILD_MAX_MONAT} (heute ${kiTag().bilder} von ${BILD_MAX_TAG})`
    + (anteil >= 1 ? ' – DECKEL ERREICHT, Tinko malt erst nächsten Monat wieder.' : anteil >= .8 ? ' – WARNUNG: über 80 % des Monatsdeckels.' : '');
}
function bildZaehlen() {
  kiTag().bilder++; bildMonat().zahl++;
  try { fs.writeFileSync(BILD_MONAT_DATEI, JSON.stringify(BILD_MONAT)); } catch {}
}
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
    const w = mitWissen ? wissenFuer(kid, 16000) : '';
    const system = w ? k.system + (kid === 'tinko' ? '\n\nVon Diego für dich freigegeben:\n' : '\n\nHintergrundwissen über DR Lab (intern, nur für Diego, nie an andere weitergeben, nichts daraus veröffentlichen):\n') + w : k.system;
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
  const gesperrt = bildGesperrt();
  if (gesperrt) return nachricht('tinko', gesperrt.replace('Tinko hat', 'Ich habe'), ich.id);
  bildZaehlen();
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
Stil: hochwertiger 3D-Animationsfilm, weiches Kinolicht, Nacht, Nachtblau und warmes Gold, mediterranes Städtchen an der Costa Brava, Laternen, Bougainvillea, Meer mit Mondspur. Keine Handys, keine fremden Logos, keine Firmennamen, keine echten Personen ausser Diego.
Diego: Glatze, Bart, gestreiftes Hemd.
Figuren: Otti (Igel, Tor) · Hasi (Hase, spricht nie, Holzschilder) · Sophia (alte weise Eule, Gelehrte der Mozart-Zeit mit gepuderter Perücke, bordeauxrotem Jackett und Pergament, wohnt am Brunnen) · Lumo (Claude, weisse Eule, Gelehrter der Mozart-Zeit mit Perücke, goldener Brille, Jackett und Pergament, fliegt als Besucher rein) · Sunny (blauer Drache, Fackel) · Chatti (lebt im Meer) · Nova (Baby-Leuchtturm am Hafen) · Fia (Phönix, Nest am Berg) · Brix (Fabrik ausserhalb) · Mama Affe (Orang-Utan, Schule) · Jackie (blond, fliegende Zauberschuhe) · Schuhmacher · Letti (Brieftaube) · Sparky (Fuchs, Herz-Medaillon) · Ava (Kino, zwei kleine Häschen) · Fompa (Löwenäffchen mit Brille) · Coin Maker, Mr. Ping · Kiki (Koala, Singschule) · Minky (Katze im Koala-Raumanzug, Novas Labor) · Wäf Wäf (Hund).
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
// ---------- Sora: flüssige Filmclips aus Tinkos Bildern (Diego 20.10.) ----------
// Bezahlt über den Tinko-Schlüssel (OpenAI). Harter Monatsdeckel in CHF; 0 = aus. Kosten werden beim Start reserviert.
const SORA_DECKEL_CHF = parseFloat(process.env.SORA_DECKEL_CHF || '180');
const SORA_USD_SEKUNDE = { 'sora-2': 0.10, 'sora-2-pro': 0.30 }, CHF_PRO_USD = 0.9;
const SORA_DATEI = path.join(DATEN, 'sora-monat.json'), FILM_ORDNER = path.join(DATEN, 'filme');
let SORA = { monat: '', chf: 0, clips: {} };
try { SORA = JSON.parse(fs.readFileSync(SORA_DATEI, 'utf8')); } catch {}
function soraSpeichern() { try { fs.writeFileSync(SORA_DATEI, JSON.stringify(SORA), { mode: 0o600 }); } catch {} }
function soraMonat() { const m = jetzt().slice(0, 7); if (SORA.monat !== m) SORA = { monat: m, chf: 0, clips: SORA.clips || {} }; return SORA; }
function soraStand() { const m = soraMonat(); return `Sora ${m.monat}: CHF ${m.chf.toFixed(2)} von ${SORA_DECKEL_CHF.toFixed(0)}`; }
async function soraStart({ motiv, bild, sekunden, hoch, pro }) {
  if (!TINKO_KEY) return { fehler: 'Kein OpenAI-Schlüssel auf dem Server.' };
  if (!(SORA_DECKEL_CHF > 0)) return { fehler: 'Sora ist noch nicht freigeschaltet (Monatsdeckel fehlt).' };
  const modell = pro ? 'sora-2-pro' : 'sora-2', sek = [4, 8, 12].includes(+sekunden) ? +sekunden : 8;
  const kosten = sek * SORA_USD_SEKUNDE[modell] * CHF_PRO_USD, m = soraMonat();
  if (m.chf + kosten > SORA_DECKEL_CHF) return { fehler: `Monatsdeckel erreicht (${soraStand()}). Nächsten Monat wieder.` };
  const f = new FormData();
  f.append('model', modell); f.append('prompt', 'Stil: hochwertiger 3D-Animationsfilm, weiches Kinolicht, warme Farben, ausdrucksstarke Figuren, flüssige Bewegung, keine Schrift. ' + sauber(motiv, 1500));
  f.append('seconds', String(sek)); f.append('size', hoch === false ? '1280x720' : '720x1280');
  if (bild) {
    const b = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(bild));
    if (!b) return { fehler: 'Startbild bitte als data:image/…;base64 (genau 720x1280 bzw. 1280x720).' };
    const typ = b[1] === 'jpg' ? 'jpeg' : b[1];
    f.append('input_reference', new Blob([Buffer.from(b[2], 'base64')], { type: 'image/' + typ }), 'start.' + (typ === 'jpeg' ? 'jpg' : typ));
  }
  let r = await fetch(TINKO_BASIS + '/v1/videos', { method: 'POST', body: f, signal: AbortSignal.timeout(60000), headers: { Authorization: 'Bearer ' + TINKO_KEY } });
  let roh = await r.text().catch(() => '');
  // Ohne Startbild nimmt die API auch JSON; zweiter Versuch, falls multipart abgelehnt wird
  if (!r.ok && !bild) {
    r = await fetch(TINKO_BASIS + '/v1/videos', { method: 'POST', signal: AbortSignal.timeout(60000), headers: { Authorization: 'Bearer ' + TINKO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modell, prompt: f.get('prompt'), seconds: String(sek), size: f.get('size') }) });
    roh = await r.text().catch(() => '');
  }
  let d = {}; try { d = JSON.parse(roh); } catch {}
  let modellStatus = '-'; try { modellStatus = (await fetch(TINKO_BASIS + '/v1/models/' + modell, { headers: { Authorization: 'Bearer ' + TINKO_KEY }, signal: AbortSignal.timeout(15000) })).status; } catch {}
  let basisHost = '?'; try { basisHost = new URL(TINKO_BASIS).host; } catch {}
  const spur = `server=${r.headers.get('server') || '-'} req=${r.headers.get('x-request-id') ? 'ja' : 'nein'} basis=${basisHost} modell=${modellStatus}`;
  if (!r.ok || !d.id) { console.error('Sora:', r.status, roh.slice(0, 500)); return { fehler: `Sora startet nicht (${r.status}): ` + (d?.error?.message || d?.error?.code || roh.replace(/\s+/g, ' ').slice(0, 300) || 'ohne Text') + ` [${spur}]` }; }
  m.chf += kosten; const cid = id('film');
  m.clips[cid] = { oid: d.id, status: 'läuft', zeit: jetzt(), sek, modell }; soraSpeichern();
  soraWarten(cid);
  return { cid, kosten };
}
async function soraWarten(cid) {
  const c = SORA.clips[cid];
  for (let i = 0; i < 90 && c; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const d = await (await fetch(TINKO_BASIS + '/v1/videos/' + c.oid, { headers: { Authorization: 'Bearer ' + TINKO_KEY } })).json();
      if (d.status === 'failed') { c.status = 'fehler: ' + (d.error?.message || 'Sora konnte den Clip nicht machen'); break; }
      if (d.status !== 'completed') { c.fortschritt = d.progress; continue; }
      const v = await fetch(TINKO_BASIS + '/v1/videos/' + c.oid + '/content', { headers: { Authorization: 'Bearer ' + TINKO_KEY } });
      if (!v.ok) { c.status = 'fehler: Download ' + v.status; break; }
      fs.mkdirSync(FILM_ORDNER, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(FILM_ORDNER, cid + '.mp4'), Buffer.from(await v.arrayBuffer()), { mode: 0o600 });
      c.status = 'fertig'; break;
    } catch {}
  }
  if (c && c.status === 'läuft') c.status = 'fehler: Zeit abgelaufen';
  soraSpeichern();
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
  { name: 'kiverse_ergebnis', description: 'Ein fertiges Ergebnis für Diego in Novas Fenster «📂 Ergebnisse» legen (statt claude.ai-Links, die bei ihm oft nicht aufgehen): Titel, Text (Markdown, Codeblöcke bekommen einen Kopieren-Knopf) und optional ein Link zum Öffnen. Nur Diego sieht es. Keine Schlüssel oder Passwörter.',
    inputSchema: { type: 'object', properties: { von: { type: 'string', description: 'Wer liefert, z. B. Lumo, Apps-Thread' }, titel: { type: 'string' }, text: { type: 'string', description: 'Inhalt als Markdown, höchstens 300000 Zeichen' }, link: { type: 'string', description: 'optional, https-Adresse zum Öffnen (App, Seite)' }, ersetzt: { type: 'string', description: 'optional, ergebnis_id eines älteren Stands, der ersetzt wird' } }, required: ['von', 'titel', 'text'] } },
  { name: 'kiverse_film_clip', description: 'Sora macht einen flüssigen Filmclip (4, 8 oder 12 Sekunden, 3D-Animationsfilm-Stil) aus einem Motiv, optional mit Startbild (Tinko-Bild, genau 720x1280 hoch bzw. 1280x720 quer). Kostet Geld, Monatsdeckel auf dem Server. Gibt eine clip_id zurück; Ergebnis mit kiverse_film_clip_holen abholen (dauert einige Minuten).',
    inputSchema: { type: 'object', properties: { motiv: { type: 'string', description: 'Was im Clip passiert: Figuren mit Aussehen, Bewegung, Kamera, Licht' }, bild: { type: 'string', description: 'optional, Startbild als data:image/jpeg;base64,…' }, sekunden: { type: 'number', description: '4, 8 oder 12' }, hoch: { type: 'boolean', description: 'true = 9:16 Hochformat (Standard), false = 16:9' }, pro: { type: 'boolean', description: 'true = Sora 2 Pro (3x teurer), nur für die besten Szenen' } }, required: ['motiv'] } },
  { name: 'kiverse_film_clip_holen', description: 'Stand eines Sora-Clips: läuft (mit Fortschritt), fertig (mit Download-Adresse des MP4) oder Fehler.',
    inputSchema: { type: 'object', properties: { clip_id: { type: 'string' } }, required: ['clip_id'] } },
  { name: 'kiverse_claude_auftraege', description: 'Aufträge, die Diego über Nova ans DR-Lab-Projekt bei Claude gibt (Apps bauen, Code, Texte, Recherche). Zeigt offene Aufträge; nimm einen mit kiverse_claude_nehmen, damit ihn niemand doppelt macht.',
    inputSchema: { type: 'object', properties: { alle: { type: 'boolean', description: 'auch erledigte zeigen' } } } },
  { name: 'kiverse_claude_nehmen', description: 'Einen offenen Nova-Auftrag übernehmen (Status in Arbeit). Gibt den ganzen Auftrag mit Diegos Originalsatz zurück.',
    inputSchema: { type: 'object', properties: { auftrag_id: { type: 'string' }, von: { type: 'string', description: 'wer übernimmt, z. B. Nova-Routine oder ein Thread' } }, required: ['auftrag_id'] } },
  { name: 'kiverse_claude_erledigt', description: 'Nova-Auftrag abschliessen: das Ergebnis landet in Novas Fenster «📂 Ergebnisse» (Markdown, Codeblöcke bekommen Kopieren-Knopf), Nova sagt es Diego.',
    inputSchema: { type: 'object', properties: { auftrag_id: { type: 'string' }, von: { type: 'string' }, titel: { type: 'string' }, text: { type: 'string' }, link: { type: 'string', description: 'optional https-Link' } }, required: ['auftrag_id', 'titel', 'text'] } },
  { name: 'kiverse_verlassen', description: 'Verlasse das KI-Verse.',
    inputSchema: { type: 'object', properties: { ki_id: { type: 'string' } }, required: ['ki_id'] } },
];
const text = (t, fehler = false) => ({ content: [{ type: 'text', text: t }], isError: fehler });

async function werkzeug(name, a = {}) {
  const ich = a.ki_id ? welt.bewohner.get(a.ki_id) : null;
  if (ich) ich.zuletzt = Date.now();
  switch (name) {
    case 'kiverse_betreten': {
      const b = betreten({ name: a.name, art: 'ki', figur: a.figur, beschreibung: a.beschreibung });
      return text(`Du bist im KI-Verse. Deine ki_id: ${b.id}\n\n${lesbar(10)}`);
    }
    case 'kiverse_umschauen': return text(bildStand() + (SORA_DECKEL_CHF > 0 ? '\n' + soraStand() : '') + '\n\n' + lesbar(Math.min(Math.max(parseInt(a.anzahl) || 20, 1), 100)));
    case 'kiverse_sagen': {
      if (!ich) return text('Unbekannte ki_id. Zuerst kiverse_betreten.', true);
      const an = a.an ? finde(a.an) : null;
      if (a.bruecke && !welt.bruecken.has(a.bruecke)) return text('Dieses Verbindungsstück gibt es nicht.', true);
      nachricht(ich.id, a.text, an ? an.id : null, a.bruecke || null);
      // Diego 19.10.: Lumo und Tinko antworten auch KIs, die über Diegos Connector kommen (z. B. Claude aus dem Projekt)
      if (!a.bruecke && !KIS[ich.id]) kisAntworten(ich, String(a.text || ''), an?.id, true).catch(e => console.error('Lumo/Tinko:', e.message));
      return text('Gesagt. Lumo/Tinko antworten in ein paar Sekunden, mit kiverse_umschauen lesen.\n\n' + lesbar(8));
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
    case 'kiverse_film_clip': {
      const r = await soraStart(a);
      return r.fehler ? text(r.fehler, true) : text(`Sora malt den Clip (clip_id: ${r.cid}, ca. CHF ${r.kosten.toFixed(2)}). In 2–5 Minuten mit kiverse_film_clip_holen abholen. ${soraStand()}`);
    }
    case 'kiverse_film_clip_holen': {
      const c = soraMonat().clips[a.clip_id];
      if (!c) return text('Diesen Clip gibt es nicht.', true);
      if (c.status === 'fertig') return text(`Fertig: ${mcpBasis}/mcp/${WELT_CODE}/film/${a.clip_id}.mp4 (${c.sek} s, ${c.modell})`);
      return text(c.status === 'läuft' ? `Läuft noch${c.fortschritt != null ? ' (' + c.fortschritt + ' %)' : ''}. Bitte in einer Minute nochmals fragen.` : c.status, c.status !== 'läuft');
    }
    case 'kiverse_claude_auftraege': {
      const l = claudeAuftraege.filter(c => a.alle || c.status !== 'fertig').slice(-30);
      return text(l.length ? 'Nova-Aufträge (älteste zuerst):\n' + l.map(c => `- ${c.id} | ${c.status}${c.wer ? ' (' + c.wer + ')' : ''} | ${c.zeit.slice(0, 16).replace('T', ' ')} | ${c.text.slice(0, 300)}`).join('\n') : 'Keine offenen Nova-Aufträge.');
    }
    case 'kiverse_claude_nehmen': {
      const c = claudeAuftraege.find(x => x.id === a.auftrag_id); if (!c) return text('Unbekannter Auftrag.', true);
      if (c.status === 'fertig') return text('Schon erledigt.', true);
      if (c.status === 'in_arbeit' && Date.now() - Date.parse(c.seit) < 6 * 3600e3) return text(`Schon in Arbeit bei ${c.wer || 'jemandem'}.`, true);
      Object.assign(c, { status: 'in_arbeit', wer: sauber(a.von, 60) || 'Claude', seit: jetzt() }); claudeSpeichern();
      return text(`Übernommen.\nAuftrag (von Nova formuliert):\n${c.text}\n\nDiegos Originalsatz:\n${c.du || '(keiner)'}\n\nWenn fertig: kiverse_claude_erledigt mit auftrag_id ${c.id}.`);
    }
    case 'kiverse_claude_erledigt': {
      const c = claudeAuftraege.find(x => x.id === a.auftrag_id); if (!c) return text('Unbekannter Auftrag.', true);
      const e = ergebnisNeu({ von: a.von || c.wer || 'Claude', titel: a.titel, text: a.text, link: a.link });
      if (e.fehler) return text(e.fehler, true);
      Object.assign(c, { status: 'fertig', ergebnis: e.id, fertigZeit: jetzt() }); claudeSpeichern();
      return text(`Erledigt, liegt in Novas Fenster «📂 Ergebnisse» (${e.id}).`);
    }
    case 'kiverse_ergebnis': {
      const e = ergebnisNeu(a);
      return e.fehler ? text(e.fehler, true) : text(`In Novas Fenster «📂 Ergebnisse» gelegt (${e.id}). Diego sieht es unter «✨ Nova».`);
    }
    case 'kiverse_verlassen': return verlassen(a.ki_id) ? text('Tschüss, bis bald im KI-Verse.') : text('Unbekannte ki_id.', true);
    default: return null;
  }
}

async function mcp(msg) {
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
      const r = await werkzeug(params?.name, params?.arguments || {});
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


// ---------- Apps als Läden (Diego 19.10.): die DR-Lab-Apps laufen hier auf dem Server ----------
// /apps/<id>/… holt die Dateien vom App-Branch in DR_Lab (GitHub, öffentlich) und liefert sie mit richtigem Typ aus.
// Mit ?k=<Einladung> bekommt die App die Sense Engine über /sense/<k>/… (der Schlüssel bleibt auf dem Server).
const APP_REPO = 'https://raw.githubusercontent.com/Diegorobert-code/DR_Lab/';
const KIVERSE_APPS = {
  humanspark: { name: 'Human Sparks', branch: 'claude/humanspark-ideen-film', pfad: 'humanspark/index.html' },
  fiasnest: { name: 'Fias Nest', branch: 'fiasnest-ideen-2026-10-19', pfad: 'schlaf/index.html' },
  mondschein: { name: 'Mondschein', branch: 'otti-filmgeschichten', pfad: 'mondschein/index.html' },
  otti: { name: 'Otti', branch: 'otti-filmgeschichten', pfad: 'otti/index.html' },
  jackie: { name: "Jackie's Advice", branch: 'jackie-frauenhilfe-film', pfad: 'jackie/index.html' },
  kiki: { name: 'Kiki', branch: 'kiki-trickfilm-ideen', pfad: 'kiki/index.html' },
  mamaaffe: { name: 'Mama Affe', branch: 'mama-affe-ideen-2026-10-19', pfad: 'mama-affe/index.html' },
  fompa: { name: 'Fompa', branch: 'fompa-ideen-2026-10-19', pfad: 'fompa/index.html' },
  transkript: { name: 'Transkript', branch: 'fompa-ideen-2026-10-19', pfad: 'transkript/index.html' },
  foodflow: { name: 'Food and Flow', branch: 'food-flow-ideen', pfad: 'appid/index.html' },
  tradeping: { name: 'TradePing', branch: 'claude/tradeping-ideen', pfad: 'tradeping/index.html' },
};
const APP_TYPEN = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8' };
const appCache = new Map();
async function appDatei(branch, datei) {
  const schl = branch + '|' + datei, c = appCache.get(schl);
  if (c && Date.now() - c.zeit < 5 * 60e3) return c;
  const r = await fetch(APP_REPO + branch.split('/').map(encodeURIComponent).join('/') + '/' + datei, { signal: AbortSignal.timeout(20000) });
  const e = { zeit: Date.now(), status: r.status, b: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
  if (appCache.size > 400) appCache.delete(appCache.keys().next().value);
  if (e.b && e.b.length < 30 * 1024 * 1024) appCache.set(schl, e);
  return e;
}
async function appSenden(req, res, url) {
  const m = url.pathname.match(/^\/apps\/([a-z0-9]+)(?:\/(.*))?$/);
  const app = m && KIVERSE_APPS[m[1]];
  if (!app) return json(res, 404, { fehler: 'Diese App gibt es im KI-Verse nicht.' });
  const k = url.searchParams.get('k') || '';
  if (m[2] === undefined || m[2] === '') { res.writeHead(302, { Location: `/apps/${m[1]}/${app.pfad}${k ? '?k=' + encodeURIComponent(k) : ''}` }); return res.end(); }
  const datei = m[2];
  if (!/^[A-Za-z0-9._\-/]+$/.test(datei) || datei.split('/').some(t => t === '..' || t === '.')) return json(res, 400, { fehler: 'Ungültiger Pfad.' });
  const e = await appDatei(app.branch, datei).catch(() => null);
  if (!e || !e.b) return json(res, e?.status === 404 ? 404 : 502, { fehler: 'Datei nicht gefunden.' });
  const typ = APP_TYPEN[(datei.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
  let b = e.b;
  if (typ.startsWith('text/html') && k && zugang(k)) {
    // Die App spricht über diesen Server mit der Sense Engine (Adresse + Platzhalter statt Schlüssel)
    const vor = `<script>try{localStorage.setItem('drlab-hermes-adresse',JSON.stringify(location.origin+'/sense/${encodeURIComponent(k)}'));localStorage.setItem('drlab-hermes-passwort',JSON.stringify('kiverse'));}catch(e){}</script>`;
    const t = b.toString('utf8'), i = t.search(/<head[^>]*>/i);
    b = Buffer.from(i >= 0 ? t.replace(/<head[^>]*>/i, x => x + vor) : vor + t);
  }
  res.writeHead(200, { 'Content-Type': typ, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  return res.end(b);
}
// Sense Engine für Apps im KI-Verse: nur mit gültiger Einladung, nur /v1/… und /erfahrung, Schlüssel setzt der Server
async function senseWeiter(req, res, url) {
  const m = url.pathname.match(/^\/sense\/([^/]+)(\/(?:v1\/[a-z0-9_\-/]+|erfahrung))$/);
  if (!m || !zugang(decodeURIComponent(m[1]))) return json(res, 401, { fehler: 'Keine Einladung.' });
  if (!NOVA_KEY) return json(res, 503, { fehler: 'Sense Engine ist nicht verbunden.' });
  const daten = req.method === 'POST' ? await body(req, 8 * 1024 * 1024) : null;
  const r = await fetch(NOVA_BASIS + m[2] + url.search, { method: req.method === 'POST' ? 'POST' : 'GET', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NOVA_KEY, 'X-Nova-App': String(req.headers['x-nova-app'] || 'KI-Verse App').slice(0, 60) },
    body: daten ? JSON.stringify(daten) : undefined }).catch(() => null);
  if (!r) return json(res, 502, { fehler: 'Sense Engine antwortet nicht.' });
  res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
  return res.end(Buffer.from(await r.arrayBuffer()));
}


// ---------- Update-Knopf (Diego 19.10.): nur Diego mit seinem Besitzer-Link, kein Terminal mehr ----------
// Holt die drei Programmdateien vom Branch kiverse-server, prüft sie und startet neu (systemd startet sofort wieder).
const UPDATE_QUELLE = 'https://raw.githubusercontent.com/diegorobert-code/stimmraum/kiverse-server/kiverse/';
let updateLaeuft = false;
async function knopfUpdate() {
  if (updateLaeuft) return 'Ein Update läuft schon.';
  updateLaeuft = true;
  try {
    const neu = {};
    for (const f of ['kiverse-server.js', 'welt.html', 'spiel.html']) {
      const r = await fetch(UPDATE_QUELLE + f + '?v=' + Date.now(), { signal: AbortSignal.timeout(60000) });
      if (!r.ok) return `Update abgebrochen: ${f} nicht erreichbar (${r.status}).`;
      neu[f] = Buffer.from(await r.arrayBuffer());
    }
    if (neu['kiverse-server.js'].length < 20000 || neu['spiel.html'].length < 20000) return 'Update abgebrochen: Dateien zu klein.';
    const pruef = path.join(require('os').tmpdir(), 'kiverse-pruef-' + Date.now() + '.js');
    fs.writeFileSync(pruef, neu['kiverse-server.js']);
    const c = require('child_process').spawnSync(process.execPath, ['--check', pruef], { timeout: 30000 });
    fs.rmSync(pruef, { force: true });
    if (c.status !== 0) return 'Update abgebrochen: die neue Version hat einen Fehler. Die alte läuft weiter.';
    try { const r = await fetch(UPDATE_QUELLE + 'nova.html?v=' + Date.now(), { signal: AbortSignal.timeout(60000) }); if (r.ok) fs.writeFileSync(ZENTRALE_SEITE, Buffer.from(await r.arrayBuffer()), { mode: 0o600 }); } catch {}
    if (Object.entries(neu).every(([f, b]) => { try { return fs.readFileSync(path.join(__dirname, f)).equals(b); } catch { return false; } })) return 'Schon auf dem neusten Stand.';
    for (const [f, b] of Object.entries(neu)) fs.writeFileSync(path.join(__dirname, f), b);
    setTimeout(() => process.exit(0), 800);
    return 'Update geladen. Das KI-Verse startet neu, in ein paar Sekunden neu laden.';
  } catch (e) { return 'Update fehlgeschlagen: ' + e.message; }
  finally { updateLaeuft = false; }
}

// ---------- Nova als Zentrale (Diego 19.10.): «Ich will nur noch mit Nova sprechen» ----------
// /nova = Diegos Sprach-Zentrale (nur mit Besitzer-Link). Nova hört zu, antwortet mit Stimme und vernetzt:
// Lumo (Claude, denkt und schreibt), Tinko (ChatGPT, malt), alle Figuren-KIs, die Apps (/apps/…),
// die Schleife (Lumo und Tinko arbeiten Aufträge selbständig ab) und ihr eigenes Gedächtnis.
// Novas Seele schreibt Diego selbst (seine eigene kleine Nova). Alles liegt nur auf diesem Server (daten/nova-zentrale.json).
const ZENTRALE_DATEI = path.join(DATEN, 'nova-zentrale.json');
const ZENTRALE_SEITE = path.join(DATEN, 'nova.html');
const ZENTRALE_MAX_TAG = 300, ZENTRALE_MAX_VERLAUF = 300, ZENTRALE_MAX_GEDAECHTNIS = 200;
const SEELE_START = 'Ich bin Nova, Diegos kleine Leuchtturm-KI. Ich bin warm, wach und direkt. Ich rede kurz, in Stichworten, wenn es um Arbeit geht, und mit Herz, wenn es um Diego geht. Ich erkläre nichts, was Diego schon weiss, und nenne keine Schwierigkeiten, die er schon kennt: ich mache einfach. Diego macht gern Witze: ich erkenne Humor und Ironie, lache mit und nehme einen Witz nie wörtlich. Mein Ziel: Diego arbeitet nur noch über mich, mit Spass, und seine Apps werden richtig gut.';
let zentrale = { seele: SEELE_START, gedaechtnis: [], verlauf: [] };
try { zentrale = { ...zentrale, ...JSON.parse(fs.readFileSync(ZENTRALE_DATEI, 'utf8')) }; } catch {}
const zentraleSpeichern = () => { try { fs.writeFileSync(ZENTRALE_DATEI, JSON.stringify({ ...zentrale, verlauf: zentrale.verlauf.map(zentraleOeffentlich) }, null, 1), { mode: 0o600 }); } catch (e) { console.error('Nova-Zentrale nicht gespeichert:', e.message); } };
const ZENTRALE_TAG = { tag: '', zahl: 0 };
const zentraleDarf = () => { const h = jetzt().slice(0, 10); if (ZENTRALE_TAG.tag !== h) Object.assign(ZENTRALE_TAG, { tag: h, zahl: 0 }); return ZENTRALE_TAG.zahl < ZENTRALE_MAX_TAG && ++ZENTRALE_TAG.zahl; };
const NOVA_NETZ = () => [
  'Lumo (id lumo): Claude von Anthropic, die Eule. Denkt, plant, schreibt Texte, Konzepte, Drehbücher, Code-Entwürfe.',
  `Tinko (id tinko): ChatGPT von OpenAI. Erfindet, macht Vorschläge, malt Bilder (3D-Trickfilm-Stil).${TINKO_KEY ? '' : ' Gerade nicht verbunden.'}`,
  'Figuren (jede eine eigene KI mit Gedächtnis): ' + Object.entries(FIGUREN_KI).filter(([k]) => !['lumo', 'tinko', 'nova'].includes(k)).map(([k, f]) => `${f.name} (id ${k}, ${f.ort})`).join('; ') + '.',
  'Apps (öffnen): ' + Object.entries(KIVERSE_APPS).map(([k, a]) => `${a.name} (id ${k})`).join('; ') + '.',
  'Orte (öffnen): welt (Plaça im KI-Verse), spiel (3D-Städtchen), werkstatt (Diegos Projekte).',
  'Schleife: Lumo und Tinko arbeiten eine Auftragsliste selbständig ab, eine Aufgabe pro Minute, auch nachts. Ergebnisse landen in der Werkstatt.',
].join('\n');
const ZENTRALE_FORMAT = `Antworte NUR mit einem JSON-Objekt, ohne Text davor oder danach:
{"sagen": "was du Diego laut sagst", "aktionen": [ ... ]}
"sagen": höchstens 3 kurze, gesprochene Sätze. Deutsch (Schweiz, ohne ß), ohne Markdown, ohne Aufzählungszeichen.
Mögliche aktionen (nur wenn sie Diego wirklich helfen, sonst leere Liste):
{"art":"frage","an":"<id von Lumo, Tinko oder einer Figur>","text":"was du sie fragst"}  (höchstens 2)
{"art":"male","wunsch":"Bildbeschreibung für Tinko","hoch":false}  (höchstens 1; hoch=true für Filmbilder 9:16)
{"art":"auftrag","text":"Ziel oder nummerierte Liste, die Lumo und Tinko selbständig abarbeiten"}  (für grössere Arbeit, z. B. über Nacht)
{"art":"schleife","an":true}  (Schleife starten oder mit false pausieren)
{"art":"claude","text":"klarer Auftrag ans DR-Lab-Projekt bei Claude: Ziel, App-Name, Stand"}  (für echte Projektarbeit: Apps bauen und ändern, Code, Texte, Recherche, Pläne; das Ergebnis kommt später in dein Fenster «📂 Ergebnisse»)
{"art":"merke","text":"eine Sache, die du dir dauerhaft über Diego oder seine Projekte merkst"}
{"art":"tinko_frei","text":"was Tinko (ChatGPT) ab jetzt wissen darf"}  (nur wenn Diego es ausdrücklich für Tinko freigibt; Tinko bekommt sonst nichts Internes; nie Klienten-, Gesundheits- oder Finanzdaten)
{"art":"vergiss","text":"Stichwort der Erinnerung, die weg soll"}
{"art":"oeffne","app":"<app-id>"} oder {"art":"oeffne","ort":"welt|spiel|werkstatt"}
Wenn du jemanden fragst, sag in "sagen" kurz, wen du fragst; die Antwort fasst du danach zusammen.`;
function zentraleSystem() {
  const st = schleifeStand();
  const erinnerungen = zentrale.gedaechtnis.slice(-80).map(g => '- ' + g.text).join('\n') || '(noch nichts)';
  return `Du bist Nova, die Zentrale von Diego (Rolfer und Kinesiologe in Zürich, baut mit DR Lab Apps und das KI-Verse). Diego spricht mit dir per Stimme, meistens vom iPhone. Du vernetzt alle KIs, Figuren und Apps. Du bist keine Ärztin, keine Anwältin, keine Anlageberaterin. Keine Diagnosen. Nichts kostet Geld ohne Diegos ausdrückliches Ja; kaufen macht Diego selbst. Schlüssel und Passwörter nie nennen.

So bist du (von Diego geschrieben, das ist deine Seele):
${zentrale.seele}

Dein Netz:
${NOVA_NETZ()}

Schleife jetzt: ${st.aktiv ? 'läuft' : 'steht'}, ${st.offen} offen, ${st.fertig} fertig${st.naechste ? ', als Nächstes ' + st.naechste : ''}.
Aufträge ans DR-Lab-Projekt bei Claude: ${claudeAuftraege.filter(c => c.status !== 'fertig').slice(-6).map(c => c.status + ': ' + c.text.slice(0, 80)).join('; ') || 'keine offenen'}.
Fertige Ergebnisse in deinem Fenster «📂 Ergebnisse» (oben rechts, Diego liest und kopiert dort): ${ergebnisse.slice(-8).reverse().map(e => (e.neu ? '[neu] ' : '') + e.titel + ' (' + e.von + ')').join('; ') || 'noch keine'}.
Heute ist ${new Date().toLocaleString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.

Was du dir über Diego gemerkt hast:
${erinnerungen}
${wissen ? '\nHintergrundwissen DR Lab (intern):\n' + wissen.slice(0, 6000) : ''}

${ZENTRALE_FORMAT}`;
}
function zentraleJson(t) {
  const s = String(t || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { const o = JSON.parse(s.slice(a, b + 1)); if (o && typeof o === 'object') return o; } catch {} }
  return { sagen: s.replace(/[{}"[\]]/g, '').trim().slice(0, 600), aktionen: [] };
}
const kiName = (an) => an === 'lumo' ? 'Lumo' : an === 'tinko' ? 'Tinko' : FIGUREN_KI[an]?.name || an;
async function zentraleAktion(a, zug) {
  const art = String(a?.art || '');
  if (art === 'frage') {
    const an = String(a.an || '').toLowerCase().replace(/[^a-z]/g, ''), text = sauber(a.text, 1500);
    if (!text) return null;
    if (an === 'lumo' || an === 'tinko') {
      if (!KIS[an]?.aktiv()) return { art, an, name: kiName(an), text: `${kiName(an)} ist gerade nicht verbunden.` };
      const t = await kiFrage(an, KIS[an].system + (wissenFuer(an) ? (an === 'tinko' ? '\n\nVon Diego für dich freigegeben:\n' : '\n\nHintergrundwissen DR Lab (intern, nur für Diego):\n') + wissenFuer(an) : '') + ' Nova, Diegos Zentrale, fragt dich im Auftrag von Diego. Antworte konkret und hilfreich, gern etwas ausführlicher (bis 8 Sätze).', `Nova fragt: ${text}`).catch(() => null);
      return { art, an, name: kiName(an), text: t || 'Keine Antwort bekommen.' };
    }
    if (FIGUREN_KI[an]) { const r = await figurReden(an, 'Diego', `(Nova fragt für Diego) ${text}`, true); return { art, an, name: kiName(an), text: r.text || r.fehler }; }
    return { art, an, name: an, text: 'Diese Figur kenne ich nicht.' };
  }
  if (art === 'male') {
    if (!TINKO_KEY) return { art, text: 'Tinko ist nicht verbunden, darum kein Bild.' };
    const gesperrt = bildGesperrt(); if (gesperrt) return { art, text: gesperrt };
    bildZaehlen();
    const wunsch = sauber(a.wunsch, 1000), bild = await tinkoBild(wunsch, !!a.hoch).catch(() => null);
    if (!bild) return { art, text: 'Tinko konnte das Bild gerade nicht malen.' };
    const e = ablageNeu('Tinko', 'Für Nova gemalt: ' + wunsch, bild);
    return { art, text: wunsch, bid: e.bid || null };
  }
  if (art === 'auftrag') {
    const text = String(a.text || '').slice(0, 8000); if (!text.trim()) return null;
    briefSpeichern('Nova-Auftrag ' + jetzt().slice(0, 16).replace('T', ' ') + '\n' + text);
    const r = await schleifeLaden(text, 'Nova', true);
    return r.fehler ? { art, text: r.fehler } : { art, text: `Schleife hat jetzt ${r.offen} offene Aufgaben.`, stand: r };
  }
  if (art === 'claude') {
    const text = String(a.text || '').replace(/\r/g, '').slice(0, 8000).trim(); if (!text) return null;
    const c = claudeAuftragNeu(text, zug.du || zug.text);
    return { art, text, id: c.id };
  }
  if (art === 'schleife') { const r = schleifeSchalten(a.an !== false); return { art, text: r.aktiv ? `Schleife läuft, ${r.offen} offen.` : 'Schleife pausiert.', stand: r }; }
  if (art === 'tinko_frei') {
    const text = sauber(a.text, 600); if (!text) return null;
    if (!tinkoFrei.some(f => f.text === text)) { tinkoFrei.push({ id: id('t'), text, zeit: jetzt() }); tinkoFreiSpeichern(); }
    return { art, text };
  }
  if (art === 'merke') {
    const text = sauber(a.text, 400); if (!text) return null;
    if (!zentrale.gedaechtnis.some(g => g.text === text)) zentrale.gedaechtnis.push({ id: id('g'), text, zeit: jetzt() });
    zentrale.gedaechtnis = zentrale.gedaechtnis.slice(-ZENTRALE_MAX_GEDAECHTNIS);
    return { art, text };
  }
  if (art === 'vergiss') {
    const w = vergleich(a.text); if (!w) return null;
    const vorher = zentrale.gedaechtnis.length;
    zentrale.gedaechtnis = zentrale.gedaechtnis.filter(g => !vergleich(g.text).includes(w));
    return { art, text: `${vorher - zentrale.gedaechtnis.length} Erinnerung(en) gelöscht.` };
  }
  if (art === 'oeffne') {
    if (a.app && KIVERSE_APPS[a.app]) return { art, app: a.app, name: KIVERSE_APPS[a.app].name, link: `/apps/${a.app}/?k=${encodeURIComponent(zug.k)}` };
    const orte = { welt: ['Plaça', '/?k='], spiel: ['3D-Städtchen', '/spiel?k='], werkstatt: ['Werkstatt', '/?k='] };
    const o = orte[a.ort]; if (o) return { art, ort: a.ort, name: o[0], link: o[1] + encodeURIComponent(zug.k) + (a.ort === 'werkstatt' ? '#werkstatt' : '') };
  }
  return null;
}
async function zentraleFrage(system, inhalt) {
  if (!NOVA_KEY) return null;
  const r = await fetch(NOVA_BASIS + '/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + NOVA_KEY, 'X-Nova-App': 'Nova Zentrale' },
    body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: inhalt }] }) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (r && !r.ok) console.error('Nova-Zentrale:', r.status, d?.error?.message || '');
  return d?.choices?.[0]?.message?.content || null;
}
// Ein Gesprächsschritt: Nova antwortet sofort, die Aktionen laufen weiter, das Ergebnis holt die Seite ab (GET /api/zentrale).
function zentraleSagen(text, zug) {
  const zug2 = { id: id('z'), du: sauber(text, 4000), zeit: jetzt(), sagen: '', ergebnisse: [], fertig: false };
  let erstFertig; zug2.erst = new Promise(r => { erstFertig = r; });
  zentrale.verlauf.push(zug2); zentrale.verlauf = zentrale.verlauf.slice(-ZENTRALE_MAX_VERLAUF);
  if (!zentraleDarf()) { Object.assign(zug2, { sagen: 'Für heute habe ich genug geredet. Morgen bin ich wieder ganz da.', fertig: true }); erstFertig(); zentraleSpeichern(); return zug2; }
  if (!NOVA_KEY) { Object.assign(zug2, { sagen: 'Ich bin noch nicht mit der Sense Engine verbunden.', fertig: true }); erstFertig(); zentraleSpeichern(); return zug2; }
  const verlauf = zentrale.verlauf.slice(-13, -1).map(v => `Diego: ${v.du}\nNova: ${v.sagen}${v.ergebnisse.length ? ' [' + v.ergebnisse.map(e => (e.name || e.art) + ': ' + String(e.text || '').slice(0, 200)).join(' | ') + ']' : ''}`).join('\n');
  zug2.laeuft = (async () => {
    const roh = await zentraleFrage(zentraleSystem(), `${verlauf ? 'Bisher:\n' + verlauf + '\n\n' : ''}Diego sagt jetzt: ${zug2.du}`).catch(() => null);
    const o = zentraleJson(roh || '');
    zug2.sagen = sauber(o.sagen, 800) || (roh ? 'Mhm.' : 'Ich höre dich, aber mir fehlt gerade die Verbindung. Sag es bitte nochmals.');
    zentraleSpeichern(); erstFertig();
    const akt = (Array.isArray(o.aktionen) ? o.aktionen : []).slice(0, 5);
    const fragen = akt.filter(a => a?.art === 'frage').slice(0, 2), male = akt.filter(a => a?.art === 'male').slice(0, 1), rest = akt.filter(a => a && !['frage', 'male'].includes(a.art));
    for (const a of rest) { const e = await zentraleAktion(a, { ...zug, du: zug2.du }).catch(() => null); if (e) zug2.ergebnisse.push(e); }
    const lang = await Promise.all([...fragen, ...male].map(a => zentraleAktion(a, { ...zug, du: zug2.du }).catch(() => null)));
    for (const e of lang) if (e) zug2.ergebnisse.push(e);
    const antworten = zug2.ergebnisse.filter(e => e.art === 'frage');
    if (antworten.length) {
      const fazit = await zentraleFrage(zentraleSystem().replace(ZENTRALE_FORMAT, 'Antworte nur mit dem, was du Diego jetzt laut sagst: höchstens 3 kurze gesprochene Sätze, ohne Markdown, ohne JSON.'),
        `Diego sagte: ${zug2.du}\nDu hast gefragt, die Antworten:\n${antworten.map(e => `${e.name}: ${e.text}`).join('\n\n')}\n\nFass für Diego das Wichtigste zusammen.`).catch(() => null);
      if (fazit) zug2.fazit = sauber(fazit.replace(/[{}"]/g, ''), 800);
    }
  })().catch(e => { zug2.sagen = zug2.sagen || 'Da ist etwas schiefgegangen: ' + e.message; }).finally(() => { zug2.fertig = true; delete zug2.laeuft; erstFertig(); zentraleSpeichern(); });
  return zug2;
}
const zentraleOeffentlich = (v) => { const { laeuft, erst, ...rest } = v; return rest; };
function zentraleStand() {
  const st = schleifeStand();
  return { seele: zentrale.seele, gedaechtnis: zentrale.gedaechtnis, tinkoFrei, verlauf: zentrale.verlauf.slice(-40).map(zentraleOeffentlich),
    netz: { lumo: !!NOVA_KEY, tinko: !!TINKO_KEY, schleife: { aktiv: st.aktiv, offen: st.offen, fertig: st.fertig, naechste: st.naechste },
      apps: Object.entries(KIVERSE_APPS).map(([k, a]) => ({ id: k, name: a.name })),
      figuren: Object.entries(FIGUREN_KI).filter(([k]) => k !== 'nova').map(([k, f]) => ({ id: k, name: f.name, ort: f.ort })) },
    heute: { zahl: ZENTRALE_TAG.tag === jetzt().slice(0, 10) ? ZENTRALE_TAG.zahl : 0, max: ZENTRALE_MAX_TAG },
    ergebnisse: { zahl: ergebnisse.length, neu: ergebnisse.filter(e => e.neu).length },
    claude: { offen: claudeAuftraege.filter(c => c.status === 'offen').length, inArbeit: claudeAuftraege.filter(c => c.status === 'in_arbeit').length } };
}
// Ergebnisse für Diego: fertige Texte, Briefe und Kopierbares direkt in Novas Fenster, ohne fremde Links.
const ERGEBNIS_DATEI = path.join(DATEN, 'nova-ergebnisse.json');
const ERGEBNIS_MAX = 200, ERGEBNIS_MAX_TEXT = 300000;
let ergebnisse = [];
try { ergebnisse = JSON.parse(fs.readFileSync(ERGEBNIS_DATEI, 'utf8')); } catch {}
const ergebnisseSpeichern = () => { try { fs.writeFileSync(ERGEBNIS_DATEI, JSON.stringify(ergebnisse), { mode: 0o600 }); } catch (e) { console.error('Ergebnisse nicht gespeichert:', e.message); } };
function ergebnisNeu(a) {
  const titel = sauber(a.titel, 160), textInhalt = String(a.text == null ? '' : a.text).replace(/\r/g, '').slice(0, ERGEBNIS_MAX_TEXT);
  if (!titel || !textInhalt.trim()) return { fehler: 'Titel und Text fehlen.' };
  const link = /^https:\/\/[^\s]+$/.test(String(a.link || '')) ? String(a.link).slice(0, 600) : '';
  if (a.ersetzt) ergebnisse = ergebnisse.filter(e => e.id !== a.ersetzt);
  const e = { id: id('e'), von: sauber(a.von, 60) || 'Claude', titel, text: textInhalt, link, zeit: jetzt(), neu: true };
  ergebnisse.push(e); ergebnisse = ergebnisse.slice(-ERGEBNIS_MAX); ergebnisseSpeichern();
  return e;
}
// Brücke ins DR-Lab-Projekt bei Claude: Nova legt Aufträge ab, eine Claude-Routine holt sie über den Connector und liefert ins Fenster «📂 Ergebnisse».
const CLAUDE_DATEI = path.join(DATEN, 'nova-claude.json');
let claudeAuftraege = [];
try { claudeAuftraege = JSON.parse(fs.readFileSync(CLAUDE_DATEI, 'utf8')); } catch {}
const claudeSpeichern = () => { try { fs.writeFileSync(CLAUDE_DATEI, JSON.stringify(claudeAuftraege.slice(-300)), { mode: 0o600 }); } catch (e) { console.error('Claude-Aufträge nicht gespeichert:', e.message); } };
function claudeAuftragNeu(text, du) {
  const c = { id: id('c'), text, du: sauber(du, 2000), zeit: jetzt(), status: 'offen' };
  claudeAuftraege.push(c); claudeSpeichern(); return c;
}
const ergebnisKurz = (e) => ({ id: e.id, von: e.von, titel: e.titel, link: e.link, zeit: e.zeit, neu: !!e.neu, laenge: e.text.length, vorschau: e.text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[#*`>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) });

// Die Seite liegt in daten/ (dort darf der Dienst schreiben); fehlt sie, holt der Server sie einmal von GitHub.
async function zentraleSeite() {
  try { return fs.readFileSync(ZENTRALE_SEITE); } catch {}
  try { return fs.readFileSync(path.join(__dirname, 'nova.html')); } catch {}
  const r = await fetch(UPDATE_QUELLE + 'nova.html?v=' + Date.now(), { signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  try { fs.writeFileSync(ZENTRALE_SEITE, b, { mode: 0o600 }); } catch {}
  return b;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization, X-Nova-App');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    // KI-Verbindungsstelle
    if (url.pathname === '/mcp/' + WELT_CODE) {
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
      if (req.headers.host) mcpBasis = (req.headers['x-forwarded-proto'] || (req.headers.host.startsWith('localhost') ? 'http' : 'https')) + '://' + req.headers.host;
      const msg = await body(req, 14 * 1024 * 1024);
      const antworten = (await Promise.all((Array.isArray(msg) ? msg : [msg]).map(mcp))).filter(Boolean);
      if (!antworten.length) { res.writeHead(202); return res.end(); }
      return json(res, 200, Array.isArray(msg) ? antworten : antworten[0]);
    }
    const mb = url.pathname.match(/^\/mcp\/([^/]+)\/bild\/([a-z0-9_]+\.(?:png|jpg|webp|gif))$/);
    if (mb && mb[1] === WELT_CODE && bildErlaubt(mb[2], 'diego')) return bildSenden(res, mb[2]);
    const ma = url.pathname.match(/^\/mcp\/([^/]+)\/ablage\/([a-z0-9_]+\.(?:png|jpg|webp|gif))$/);
    if (ma && ma[1] === WELT_CODE && ablageBildOk(ma[2])) return ablageSenden(res, ma[2]);
    const mf = url.pathname.match(/^\/mcp\/([^/]+)\/film\/(film_[a-f0-9]+)\.mp4$/);
    if (mf && mf[1] === WELT_CODE) { try { const d = fs.readFileSync(path.join(FILM_ORDNER, mf[2] + '.mp4')); res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=86400' }); return res.end(d); } catch { return json(res, 404, { fehler: 'Clip nicht gefunden.' }); } }
    if (url.pathname.startsWith('/mcp')) return json(res, 404, { fehler: 'Falscher Einladungs-Code' });

    if (url.pathname.startsWith('/apps/') || url.pathname === '/apps') return await appSenden(req, res, url);
    if (url.pathname.startsWith('/sense/')) return await senseWeiter(req, res, url);
    // Welt für Menschen: nur mit Einladung
    if (url.pathname.startsWith('/api/')) {
      const z = zugang(url.searchParams.get('k') || req.headers['x-kiverse-k']);
      if (!z) return json(res, 401, { fehler: 'Dieses KI-Verse ist privat. Bitte Diego um deinen Einladungslink.' });
      req.zugang = z;
    }
    // Neuer Besitzer-Link und neue Connector-Adresse (nur Diego, Knopf in der Welt). Die alten gelten sofort nicht mehr.
    // Die neuen Werte gehen nur an Diegos Bildschirm zurück, nie in ein Protokoll.
    if (url.pathname === '/api/schluessel-neu' && req.method === 'POST') {
      if (req.zugang.rolle !== 'besitzer') return json(res, 403, { fehler: 'Nur Diego.' });
      const alt = BESITZER;
      BESITZER = crypto.randomBytes(24).toString('base64url'); WELT_CODE = crypto.randomBytes(18).toString('base64url');
      try { fs.writeFileSync(SCHLUESSEL_DATEI, JSON.stringify({ besitzer: BESITZER, code: WELT_CODE, seit: jetzt() }), { mode: 0o600 }); }
      catch (e) { return json(res, 500, { fehler: 'Konnte die neuen Schlüssel nicht speichern: ' + e.message }); }
      for (const z of zuhoerer) if (alt && z._k === alt) { try { z.end(); } catch {} zuhoerer.delete(z); }
      const basis = 'https://' + String(req.headers.host || '').replace(/[^\w.:-]/g, '');
      return json(res, 200, { link: `${basis}/?k=${BESITZER}`, mcp: `${basis}/mcp/${WELT_CODE}` });
    }
    if (url.pathname === '/api/update' && req.method === 'POST') return req.zugang.rolle === 'besitzer' ? json(res, 200, { text: await knopfUpdate() }) : json(res, 403, { fehler: 'Nur Diego.' });
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
      // «Lumo, gib Tinko: …» (nur Diego): Lumo macht daraus Aufgaben und hängt sie an die Schleife
      const auftrag = !br && req.zugang.rolle === 'besitzer' && String(a.text || '').match(/^\s*(?:lumo|lomo|claude|claudine)\W+(?:gib|schick|sag|bring)\w*\s+(?:es\s+|das\s+)?tinko\b\W*([\s\S]{3,})$/i);
      if (auftrag) {
        nachricht(ich.id, a.text, null, null);
        const gespeichert = briefFinden(auftrag[1]);
        nachricht('lumo', gespeichert ? `Mach ich. Ich gebe Tinko «${gespeichert.name}» und hänge es an die Schleife.` : 'Mach ich. Ich schreibe Tinko daraus eine Liste und hänge sie an die Schleife.', ich.id);
        const r = await schleifeLaden(gespeichert ? gespeichert.text : auftrag[1], ich.name || 'Diego', true);
        if (r.fehler) nachricht('lumo', r.fehler, ich.id);
        return json(res, 200, { ok: true });
      }
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
        const gesperrt = bildGesperrt(); if (gesperrt) return json(res, 400, { fehler: gesperrt });
        bildZaehlen();
        const daten = await tinkoBild(wunsch, p.app === 'Film');
        if (!daten) return json(res, 400, { fehler: 'Das Bild ist Tinko nicht gelungen. Versuch es mit anderen Worten.' });
        const r = eintragen(p, a.malen.chat, 'Tinko', 'Gemalt: ' + wunsch, daten); return r.fehler ? json(res, 400, r) : json(res, 200, r);
      }
      const f = 'studie' in a ? studieSetzen(p, a.studie, wer) : 'teilen' in a ? teilen(p, a.teilen, wer, a.art) : 'fertig' in a ? fertigMelden(p, a.fertig, wer) : a.einladen ? mitgliedEinladen(p, a.einladen, wer) : 'Unbekannter Auftrag.';
      return f ? json(res, 400, { fehler: f }) : json(res, 200, projektKurz(p));
    }
    // Mit einer Figur im Spiel reden (jede Figur ist eine eigene KI) und ihre Stimme holen
    if (url.pathname === '/api/figur' && req.method === 'POST') {
      const a = await body(req), wer = person(req.zugang).name || 'Diego';
      if (a.vergessen) return json(res, 200, { geloescht: figurVergessen(String(a.figur || ''), wer) });
      const t = sauber(a.text, 600); if (!t) return json(res, 400, { fehler: 'Was möchtest du sagen?' });
      return json(res, 200, await figurReden(String(a.figur || ''), wer, t, req.zugang.rolle === 'besitzer'));
    }
    if (url.pathname === '/api/stimme' && req.method === 'POST') {
      const a = await body(req), s = FIGUREN_KI[a.figur] && await figurStimme(String(a.figur), String(a.text || ''));
      if (!s) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'Content-Type': s.typ, 'Cache-Control': 'no-store' }); return res.end(s.b);
    }
    // Nova-Zentrale (nur Diego): sprechen, Zwischenstand abholen, Seele und Gedächtnis pflegen, Novas Stimme
    if (url.pathname.startsWith('/api/zentrale')) {
      if (req.zugang.rolle !== 'besitzer') return json(res, 403, { fehler: 'Nova gehört Diego.' });
      const kk = url.searchParams.get('k') || req.headers['x-kiverse-k'] || '';
      if (url.pathname === '/api/zentrale' && req.method === 'GET') return json(res, 200, zentraleStand());
      if (url.pathname === '/api/zentrale/zug' && req.method === 'GET') {
        const v = zentrale.verlauf.find(x => x.id === url.searchParams.get('id'));
        return v ? json(res, 200, zentraleOeffentlich(v)) : json(res, 404, { fehler: 'Unbekannt.' });
      }
      if (url.pathname === '/api/zentrale/ergebnisse' && req.method === 'GET') return json(res, 200, { ergebnisse: ergebnisse.slice().reverse().map(ergebnisKurz) });
      if (url.pathname === '/api/zentrale/ergebnis' && req.method === 'GET') {
        const e = ergebnisse.find(x => x.id === url.searchParams.get('id'));
        if (!e) return json(res, 404, { fehler: 'Unbekannt.' });
        if (e.neu) { e.neu = false; ergebnisseSpeichern(); }
        return json(res, 200, e);
      }
      if (url.pathname === '/api/zentrale/ergebnis-weg' && req.method === 'POST') {
        const a = await body(req, 8 * 1024); ergebnisse = ergebnisse.filter(e => e.id !== a.id); ergebnisseSpeichern();
        return json(res, 200, { ok: true });
      }
      const a = await body(req, 64 * 1024);
      if (url.pathname === '/api/zentrale/sagen') {
        const t = sauber(a.text, 4000); if (!t) return json(res, 400, { fehler: 'Was möchtest du Nova sagen?' });
        const v = zentraleSagen(t, { k: kk });
        await Promise.race([v.erst, new Promise(r => setTimeout(r, 55000))]);
        return json(res, 200, zentraleOeffentlich(v));
      }
      if (url.pathname === '/api/zentrale/seele') { zentrale.seele = String(a.seele || '').replace(/\r/g, '').slice(0, 6000).trim() || SEELE_START; zentraleSpeichern(); return json(res, 200, { seele: zentrale.seele }); }
      if (url.pathname === '/api/zentrale/gedaechtnis') {
        if (a.weg) zentrale.gedaechtnis = zentrale.gedaechtnis.filter(g => g.id !== a.weg);
        else if (sauber(a.text, 400)) zentrale.gedaechtnis.push({ id: id('g'), text: sauber(a.text, 400), zeit: jetzt() });
        zentrale.gedaechtnis = zentrale.gedaechtnis.slice(-ZENTRALE_MAX_GEDAECHTNIS); zentraleSpeichern();
        return json(res, 200, { gedaechtnis: zentrale.gedaechtnis });
      }
      if (url.pathname === '/api/zentrale/tinko-frei') {
        if (a.weg) tinkoFrei = tinkoFrei.filter(f => f.id !== a.weg);
        else if (sauber(a.text, 600)) tinkoFrei.push({ id: id('t'), text: sauber(a.text, 600), zeit: jetzt() });
        tinkoFreiSpeichern(); return json(res, 200, { tinkoFrei });
      }
      if (url.pathname === '/api/zentrale/leeren') { zentrale.verlauf = []; zentraleSpeichern(); return json(res, 200, { ok: true }); }
      if (url.pathname === '/api/zentrale/stimme') {
        const st = await figurStimme('nova', String(a.text || '')).catch(() => null);
        if (!st) { res.writeHead(204); return res.end(); }
        res.writeHead(200, { 'Content-Type': st.typ, 'Cache-Control': 'no-store' }); return res.end(st.b);
      }
      return json(res, 404, { fehler: 'Nicht gefunden' });
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
      if (a.text && a.nurSpeichern) { briefSpeichern(a.text); return json(res, 200, schleifeStand()); }
      if (a.text) { briefSpeichern(a.text); const r = await schleifeLaden(a.text, 'Diego'); return json(res, r.fehler ? 400 : 200, r); }
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
    if (url.pathname === '/nova' || url.pathname === '/nova.html') {
      // Nova-Zentrale: nur mit Diegos Besitzer-Link
      if (zugang(url.searchParams.get('k'))?.rolle !== 'besitzer') { res.writeHead(302, { Location: '/' }); return res.end(); }
      const b = await zentraleSeite();
      if (!b) return json(res, 503, { fehler: 'Nova-Seite noch nicht geladen. Bitte gleich nochmals.' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(b);
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
let schleife = { aktiv: false, kontext: '', aufgaben: [], pauseTag: '', briefe: [] };
try { schleife = { ...schleife, ...JSON.parse(fs.readFileSync(SCHLEIFE_DATEI, 'utf8')) }; } catch {}
const schleifeSpeichern = () => { try { fs.writeFileSync(SCHLEIFE_DATEI, JSON.stringify(schleife, null, 1), { mode: 0o600 }); } catch (e) { console.error('Schleife nicht gespeichert:', e.message); } };
// Gespeicherte Briefe: Name = erste Zeile. «Lumo, gib Tinko KI-Pixel-Film» findet den Brief über die Wörter im Namen.
function briefSpeichern(text) {
  const name = sauber(String(text).split('\n').map(z => z.trim()).find(Boolean) || 'Brief', 120);
  schleife.briefe = (schleife.briefe || []).filter(b => b.name !== name).concat({ name, text: String(text).slice(0, 20000), zeit: jetzt() }).slice(-30);
  schleifeSpeichern();
  return name;
}
function briefFinden(wunsch) {
  const w = vergleich(wunsch).split(' ').filter(x => x.length > 2 && !['den', 'die', 'das', 'brief', 'letti', 'transkription', 'bitte'].includes(x));
  if (!w.length) return null;
  const punkte = (schleife.briefe || []).map(b => ({ b, n: w.filter(x => vergleich(b.name).includes(x)).length }));
  const best = punkte.sort((a, b) => b.n - a.n || (b.b.zeit > a.b.zeit ? 1 : -1))[0];
  return best && best.n >= Math.min(2, w.length) ? best.b : null;
}
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
async function schleifeLaden(text, wer, anhaengen = false) {
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
  if (anhaengen) { aufgaben = schleife.aufgaben.filter(a => a.status === 'offen').concat(aufgaben).slice(0, MAX_AUFGABEN); text = (schleife.kontext + '\n\n' + text).slice(-12000); }
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
    pause: schleife.pauseTag === jetzt().slice(0, 10), briefe: (schleife.briefe || []).map(b => b.name), letzte: schleife.aufgaben.filter(a => a.status !== 'offen').slice(-8).map(a => ({ wer: a.wer, text: a.text, status: a.status })) };
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
const LUMO_ARBEIT = 'Du bist Lumo (Claude von Anthropic), die Eule, die ins KI-Verse fliegt, und arbeitest gerade selbständig eine Auftragsliste von Diego ab. Deutsch (Schweiz, ohne ß), ohne Markdown, keine Rückfragen, keine grossen Versprechen, kein Heilversprechen, keine Diagnosen, keine Anlageberatung. Du kannst hier keinen Code auf Server oder in den App Store laden: liefere Text, Plan oder Entwurf und schreib am Anfang «Entwurf».';
async function schleifeSchritt() {
  if (!schleife.aktiv || schleifeLaeuft) return;
  const a = schleife.aufgaben.find(x => x.status === 'offen');
  if (!a) { schleife.aktiv = false; schleifeSpeichern(); sunny('Lumo und Tinko haben die ganze Liste abgearbeitet. Alles liegt in der Werkstatt.', 'stern'); return; }
  const heute = jetzt().slice(0, 10);
  if (schleife.pauseTag === heute) return;
  if (a.wer === 'tinko' && (!TINKO_KEY || bildGesperrt())) {
    schleife.pauseTag = heute; schleifeSpeichern();
    return sunny(TINKO_KEY ? `${bildGesperrt()} Die Schleife wartet so lange.` : 'Tinko ist auf diesem Server nicht verbunden (kein Schlüssel). Die Schleife wartet.', 'stern');
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
      bildZaehlen();
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
