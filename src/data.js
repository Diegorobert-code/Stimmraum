/* ==========================================================================
   Kursinhalte. Neue Lektionen einfach hier ergänzen: jede Lektion hat
   id, title, min (Minuten), goal und steps. Schritt-Typen:
   info · breath · hiss · sustain · match · glide · range · free
   Töne in match/sustain als Stufen der Dur-Tonleiter: "1 2 3 4 5 6 7 8",
   "_5" = eine Oktave tiefer, "^2" = eine Oktave höher, ":2" = 2 Schläge,
   "b3" = um einen Halbton erniedrigt, "#4" = erhöht.
   ========================================================================== */

const yt = q => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);

const COURSES = {
/* ------------------------------------------------------------------ */
adult: {
  name: "Erwachsene",
  blurb: "Acht Stufen von der Atmung bis zum ersten Lied. Eine Lektion pro Tag, je 10 bis 15 Minuten.",
  stages: [
  { title: "Haltung und Atmung", intro: "Bevor du singst, baust du dein Instrument auf: aufrechter, lockerer Körper und ein ruhiger, tiefer Atem.",
    lessons: [
    { id: "a1", title: "Dein Körper als Instrument", min: 10, goal: "Eine Singhaltung finden und tief in den Bauch atmen.",
      steps: [
        { type: "info", title: "Die Singhaltung", text: "Stell dich hüftbreit hin, Knie locker, nicht durchgedrückt. Stell dir einen Faden vor, der dich am Scheitel sanft nach oben zieht. Schultern einmal hochziehen und fallen lassen. Der Kiefer hängt locker, die Zunge liegt vorne an den unteren Zähnen.",
          bullets: ["Gewicht auf beide Füsse verteilen", "Brustbein leicht angehoben, ohne Hohlkreuz", "Blick geradeaus, Kinn nicht nach vorne schieben"] },
        { type: "breath", title: "Bauchatmung", text: "Lege eine Hand auf den Bauch. Beim Einatmen wölbt sich der Bauch nach vorne, die Schultern bleiben unten.", pattern: [4, 2, 6, 1], rounds: 4 },
        { type: "hiss", title: "Langes Zischen", text: "Atme tief ein und lass die Luft auf einem gleichmässigen «sss» ausströmen, so lange es angenehm geht. Nicht pressen.", goal: 15 },
        { type: "sustain", title: "Erster Summton", text: "Summe auf «mmm» einen bequemen Ton. Die Lippen dürfen dabei leicht kribbeln.", note: "3", secs: 5, syl: "mmm" }
      ],
      links: [["Singhaltung erklärt (Videos)", yt("Singhaltung richtig stehen Gesang")], ["Bauchatmung beim Singen (Videos)", yt("Bauchatmung Singen Übung")]] },
    { id: "a2", title: "Das Zwerchfell entdecken", min: 12, goal: "Den Atemmuskel spüren und bewusst einsetzen.",
      steps: [
        { type: "info", title: "Was ist das Zwerchfell?", text: "Das Zwerchfell ist ein kuppelförmiger Muskel unter der Lunge. Beim Einatmen senkt es sich und schafft Platz für Luft, deshalb wölbt sich der Bauch. Beim Singen bremst es die Ausatmung, damit der Ton gleichmässig bleibt.",
          bullets: ["Hecheln wie ein Hund: 10 Sekunden, der Bauch federt", "Fünfmal kräftig «ha!» lachen und den Impuls im Bauch spüren"] },
        { type: "breath", title: "4-7-8 Atmung", text: "Diese Atmung beruhigt und verlängert die Ausatmung.", pattern: [4, 7, 8, 0], rounds: 3 },
        { type: "hiss", title: "Zischen mit Impulsen", text: "Atme ein und zische «ts-ts-ts-ts» in kurzen Stössen, danach ein langes «sss». Ziel: länger als gestern.", goal: 18 },
        { type: "sustain", title: "Summen auf mmm", text: "Summe ruhig und gleichmässig. Achte darauf, dass der Ton nicht absinkt, wenn die Luft knapp wird.", note: "1", secs: 6, syl: "mmm" }
      ],
      links: [["Zwerchfell beim Singen (Videos)", yt("Zwerchfell Singen erklärt")], ["Stimmbildung auf Wikipedia", "https://de.wikipedia.org/wiki/Stimmbildung"]] },
    { id: "a3", title: "Die Atemstütze", min: 12, goal: "Luft dosieren, damit der Ton ruhig und tragend wird.",
      steps: [
        { type: "info", title: "Stütze heisst Gleichgewicht", text: "Stütze ist kein Drücken. Die Einatemmuskeln arbeiten beim Singen weiter und bremsen die Luft. Stell dir vor, du atmest gegen einen sanften Widerstand aus, wie durch einen Strohhalm." },
        { type: "glide", title: "Lippenflattern", text: "Lass die Lippen auf «brrr» flattern wie ein Pferd und gleite dabei von tief nach hoch und zurück. Wenn die Lippen stoppen, ist zu wenig Luft oder zu viel Spannung im Spiel. Leg notfalls zwei Finger an die Wangen.", secs: 8 },
        { type: "hiss", title: "Zischen gegen den Widerstand", text: "Halte die Flanken weit, während du zischst. Die Luft soll gleich laut bleiben bis zum Schluss.", goal: 20 },
        { type: "sustain", title: "Langes «a»", text: "Singe auf einem offenen «a» und halte den Ton ruhig. Stell dir vor, der Ton fliesst nach vorne aus dem Mund.", note: "3", secs: 6, syl: "a" }
      ],
      links: [["Atemstütze üben (Videos)", yt("Atemstütze Gesang Übung")], ["Lippenflattern / Lip Trill (Videos)", yt("Lippenflattern Gesang Übung")]] }
  ]},
  { title: "Töne treffen", intro: "Hören, merken, nachsingen. Hier trainierst du die Verbindung zwischen Ohr und Stimme.",
    lessons: [
    { id: "a4", title: "Der erste Ton", min: 10, goal: "Einen vorgespielten Ton sicher treffen.",
      steps: [
        { type: "info", title: "So funktioniert die Übung", text: "Die App spielt dir Töne vor. Danach singst du nach, die farbigen Balken zeigen den Zielton, deine Linie zeigt, was du singst. Grün heisst getroffen. Kopfhörer helfen, sind aber nicht nötig." },
        { type: "match", title: "Einzeltöne", text: "Singe jeden Ton auf «na» nach.", notes: "1:2 3:2 5:2 3:2 1:2", syl: "na", bpm: 70 },
        { type: "match", title: "Gleich und anders", text: "Zweimal derselbe Ton, dann ein Schritt.", notes: "1 1 2:2 2 2 3:2 3 3 1:2", syl: "na", bpm: 76 }
      ],
      links: [["Gehörbildung: Töne nachsingen (Videos)", yt("Töne treffen lernen singen Übung")], ["Gehörbildungs-Übungen (musictheory.net)", "https://www.musictheory.net/exercises"]] },
    { id: "a5", title: "Fünf Töne", min: 12, goal: "Eine Fünftonreihe sauber hinauf und hinunter singen.",
      steps: [
        { type: "match", title: "Fünftonreihe", text: "Singe die Tonleiter auf «ma» hinauf und wieder hinunter.", notes: "1 2 3 4 5 4 3 2 1:2", syl: "ma", bpm: 84, keys: [0, 2] },
        { type: "info", title: "Tipp für Schritte", text: "Kleine Schritte geraten oft zu klein, besonders aufwärts. Denk beim Hinaufsingen an eine Treppe, auf der jede Stufe gleich hoch ist. Abwärts nicht absacken lassen, sondern jede Stufe mit gleicher Energie singen." },
        { type: "match", title: "Mit Vokalwechsel", text: "Gleiche Reihe, jeder Ton ein anderer Vokal: «a e i o u o i e a».", notes: "1 2 3 4 5 4 3 2 1:2", syl: "a e i o u o i e a", bpm: 80, keys: [1] }
      ],
      links: [["Tonleiter singen (Videos)", yt("Tonleiter singen Einsingen")]] },
    { id: "a6", title: "Intervalle hören", min: 12, goal: "Terz, Quinte und Oktave erkennen und singen.",
      steps: [
        { type: "info", title: "Merkhilfen", text: "Die grosse Terz klingt wie der Anfang von «Oh when the saints» (1–3), die Quinte wie der Anfang von «Morgen kommt der Weihnachtsmann» (1–5), die Oktave wie der Anfang von «Somewhere over the rainbow» (1–8). Solche Liedanfänge helfen dir, Abstände im Kopf zu speichern." },
        { type: "match", title: "Terzen", notes: "1:2 3:2 1:2 3:2 5:2 3:2", syl: "la", bpm: 72 },
        { type: "match", title: "Quinte und Oktave", notes: "1:2 5:2 1:2 8:2 5:2 1:2", syl: "la", bpm: 70 }
      ],
      links: [["Intervalltrainer (tonedear.com)", "https://tonedear.com/ear-training/intervals"], ["Intervalle erklärt (Wikipedia)", "https://de.wikipedia.org/wiki/Intervall_(Musik)"]] }
  ]},
  { title: "Resonanz", intro: "Resonanz macht die Stimme gross, ohne dass du lauter drücken musst.",
    lessons: [
    { id: "a7", title: "Summen und Maske", min: 10, goal: "Den Ton vorne im Gesicht spüren.",
      steps: [
        { type: "info", title: "Die Maske", text: "Sänger sprechen vom «Singen in die Maske»: Lippen, Nase und Wangenknochen vibrieren mit. Summe und berühre dabei leicht deine Nase. Spürst du ein Kribbeln? Genau dorthin soll der Klang später auch bei offenen Vokalen." },
        { type: "sustain", title: "mmm", note: "1", secs: 6, syl: "mmm" },
        { type: "sustain", title: "ng (wie in «sing»)", text: "Die Zunge liegt hinten am Gaumen, der Ton geht durch die Nase.", note: "3", secs: 6, syl: "ng" },
        { type: "match", title: "Summen auf der Reihe", notes: "1 2 3 4 5 4 3 2 1:2", syl: "mmm", bpm: 80, keys: [0, 1] }
      ],
      links: [["Resonanz im Gesang (Videos)", yt("Resonanz Gesang Maske Übung")]] },
    { id: "a8", title: "Vokale ausgleichen", min: 12, goal: "Alle Vokale mit gleicher Klangfarbe singen.",
      steps: [
        { type: "info", title: "Ein Raum für alle Vokale", text: "Bei «i» und «e» wird der Klang oft eng, bei «a» flach. Lass den Raum im Mund ähnlich: Kiefer locker offen, nur Zunge und Lippen formen den Vokal. Denk bei «i» etwas «ü», bei «e» etwas «ö» mit." },
        { type: "sustain", title: "a – e – i – o – u", text: "Wechsle auf einem Ton langsam die Vokale, ohne dass die Lautstärke springt.", note: "3", secs: 8, syl: "a e i o u" },
        { type: "match", title: "Dreiklang auf «ni»", notes: "1 3 5 3 1:2", syl: "ni", bpm: 80, keys: [0, 2, 4] }
      ],
      links: [["Vokalausgleich (Videos)", yt("Vokale ausgleichen singen Übung")]] },
    { id: "a9", title: "Heller, tragender Klang", min: 12, goal: "Mit wenig Kraft viel Klang erzeugen.",
      steps: [
        { type: "info", title: "Das «nj»", text: "Ein freches «njä» wie ein quengelndes Kind bringt den Klang nach vorne. Klingt erst komisch, trainiert aber Brillanz. Danach den gleichen Sitz bei schönem Vokal behalten." },
        { type: "match", title: "Njä-Arpeggio", notes: "1 3 5 8 5 3 1:2", syl: "njä", bpm: 84, keys: [0, 1, 2] },
        { type: "match", title: "Gleich auf «a»", notes: "1 3 5 8 5 3 1:2", syl: "a", bpm: 84, keys: [0] }
      ],
      links: [["Twang / Brillanz im Gesang (Videos)", yt("Twang Gesang Übung deutsch")]] }
  ]},
  { title: "Register", intro: "Bruststimme, Kopfstimme und der Übergang dazwischen. Ziel ist eine Stimme ohne Bruch.",
    lessons: [
    { id: "a10", title: "Die Bruststimme", min: 10, goal: "Tiefe Töne voll und entspannt singen.",
      steps: [
        { type: "info", title: "Bruststimme", text: "Die Bruststimme ist deine Sprechstimme. Leg eine Hand aufs Brustbein und sprich «hallo» tief und gemütlich: Die Brust vibriert. Diese Vibration nehmen wir in die tiefen Töne mit, ohne zu drücken." },
        { type: "match", title: "Abwärts auf «a»", notes: "5 4 3 2 1:2", syl: "a", bpm: 76, keys: [0, -2] },
        { type: "sustain", title: "Tiefer Halteton", note: "1", secs: 6, syl: "o" }
      ],
      links: [["Bruststimme erklärt (Videos)", yt("Bruststimme Kopfstimme Unterschied")], ["Stimmregister (Wikipedia)", "https://de.wikipedia.org/wiki/Register_(Stimme)"]] },
    { id: "a11", title: "Die Kopfstimme", min: 12, goal: "Hohe Töne leicht und ohne Druck erreichen.",
      steps: [
        { type: "info", title: "Kopfstimme", text: "Imitiere eine Eule: «huu» hoch und weich. Das ist Kopfstimme. Sie klingt leiser und luftiger, und das darf sie am Anfang auch. Männer erleben sie oft als Falsett, das ist ein guter Startpunkt." },
        { type: "glide", title: "Eulen-Sirene", text: "Gleite auf «u» von der Mitte nach ganz oben und wieder hinunter. Leise bleiben.", secs: 8 },
        { type: "match", title: "Von oben herab", notes: "8 5 3 1:2", syl: "u", bpm: 72, keys: [0, 1, 2] }
      ],
      links: [["Kopfstimme finden (Videos)", yt("Kopfstimme finden Übung")]] },
    { id: "a12", title: "Der Übergang", min: 14, goal: "Bruch zwischen den Registern glätten.",
      steps: [
        { type: "info", title: "Passaggio", text: "Im Übergang kippt die Stimme gern. Hilfreich: leiser werden, Vokal etwas abdunkeln («a» Richtung «o»), nicht mit mehr Kraft durchpressen. Konsonanten wie «g» helfen, weil sie den Kehlkopf ruhig halten." },
        { type: "glide", title: "Sirene durch den Bruch", text: "Auf «ng» oder «brrr» gleiten, die Stelle mit dem Knick ganz sanft passieren.", secs: 10 },
        { type: "match", title: "«Gug» Oktavsprung", notes: "1 5 8 5 1:2", syl: "gug", bpm: 80, keys: [0, 2, 4] }
      ],
      links: [["Passaggio und Registerbruch (Videos)", yt("Registerbruch Übergang singen Übung")]] }
  ]},
  { title: "Beweglichkeit", intro: "Schnelle Noten, präzise Sprünge und leichte Läufe.",
    lessons: [
    { id: "a13", title: "Staccato", min: 10, goal: "Kurze, präzise Töne aus der Atemstütze.",
      steps: [
        { type: "info", title: "Kurz und leicht", text: "Staccato heisst kurz und abgesetzt. Jeder Ton entsteht aus einem kleinen Bauchimpuls wie beim Lachen «ha ha ha», nicht aus dem Hals." },
        { type: "match", title: "Gelachte Dreiklänge", notes: "1 3 5 8 5 3 1:2", syl: "ha", bpm: 96, keys: [0, 2] }
      ],
      links: [["Staccato singen (Videos)", yt("Staccato singen Übung")]] },
    { id: "a14", title: "Läufe", min: 12, goal: "Schnelle Tonfolgen sauber singen.",
      steps: [
        { type: "match", title: "Langsam", notes: "1 2 3 4 5 4 3 2 1:2", syl: "a", bpm: 92 },
        { type: "match", title: "Schneller", notes: "1 2 3 4 5 4 3 2 1:2", syl: "a", bpm: 120, keys: [0, 2] },
        { type: "info", title: "Tipp", text: "Bei Läufen nicht jeden Ton neu anstossen. Die Luft fliesst durch, die Töne perlen auf dem Atemstrom. Wenn es schmiert, erst langsamer werden." }
      ],
      links: [["Läufe / Riffs üben (Videos)", yt("Gesang Läufe üben Anfänger")]] },
    { id: "a15", title: "Arpeggios über die Oktave", min: 12, goal: "Grosse Sprünge sicher meistern.",
      steps: [
        { type: "match", title: "Arpeggio mit Spitze", notes: "1 3 5 8 10 8 5 3 1:2", syl: "a", bpm: 96, keys: [0, 1] },
        { type: "match", title: "Oktavsprünge", notes: "1:2 8:2 1:2 8:2 1:2", syl: "wa", bpm: 76 }
      ],
      links: [["Arpeggio Einsingen (Videos)", yt("Arpeggio Einsingübung")]] }
  ]},
  { title: "Ausdauer und Dynamik", intro: "Lange Phrasen tragen und zwischen leise und laut gestalten.",
    lessons: [
    { id: "a16", title: "Messa di voce", min: 12, goal: "Einen Ton anschwellen und abschwellen lassen.",
      steps: [
        { type: "info", title: "An- und abschwellen", text: "Beginne leise, werde langsam lauter und wieder leiser, auf einem einzigen Atem. Die Tonhöhe soll dabei gleich bleiben. Das ist eine der wichtigsten klassischen Übungen überhaupt." },
        { type: "sustain", title: "Leise – laut – leise", note: "3", secs: 8, syl: "a", dyn: true },
        { type: "sustain", title: "Noch einmal höher", note: "5", secs: 8, syl: "o", dyn: true }
      ],
      links: [["Messa di voce (Videos)", yt("messa di voce Übung")]] },
    { id: "a17", title: "Lange Phrasen", min: 12, goal: "Luft für lange Linien einteilen.",
      steps: [
        { type: "breath", title: "Schnell ein, lang aus", pattern: [2, 0, 10, 0], rounds: 4 },
        { type: "hiss", title: "Rekord-Zischen", goal: 25 },
        { type: "match", title: "Doppelte Reihe auf einem Atem", notes: "1 2 3 4 5 6 7 8 7 6 5 4 3 2 1:2", syl: "a", bpm: 104 }
      ],
      links: [["Luft einteilen beim Singen (Videos)", yt("Atem einteilen Singen lange Töne")]] },
    { id: "a18", title: "Leise singen", min: 10, goal: "Auch leise Töne stabil halten.",
      steps: [
        { type: "info", title: "Leise ist schwer", text: "Leise singen verlangt mehr Kontrolle als laut. Halte die Stütze, auch wenn wenig Luft fliesst. Stell dir vor, du singst einem schlafenden Kind etwas vor." },
        { type: "sustain", title: "Piano-Ton", note: "5", secs: 6, syl: "u" },
        { type: "match", title: "Leise Reihe", notes: "5 4 3 2 1:2", syl: "no", bpm: 72 }
      ],
      links: [["Leise singen lernen (Videos)", yt("leise singen lernen Übung")]] }
  ]},
  { title: "Aussprache und Ausdruck", intro: "Text verständlich machen und Gefühl transportieren.",
    lessons: [
    { id: "a19", title: "Konsonanten", min: 10, goal: "Deutlich artikulieren, ohne den Klang zu verlieren.",
      steps: [
        { type: "info", title: "Zungenbrecher", text: "Sprich langsam, dann schneller, dann singe auf einem Ton: «Fischers Fritz fischt frische Fische.» – «Blaukraut bleibt Blaukraut und Brautkleid bleibt Brautkleid.» Konsonanten kurz und präzise, Vokale lang." },
        { type: "match", title: "la le li lo lu", notes: "1 2 3 4 5 4 3 2 1:2", syl: "la le li lo lu lo li le la", bpm: 100, keys: [0, 2] }
      ],
      links: [["Artikulation im Gesang (Videos)", yt("Artikulation Gesang Übungen")]] },
    { id: "a20", title: "Legato", min: 12, goal: "Töne ohne Lücke verbinden.",
      steps: [
        { type: "info", title: "Wie eine Perlenkette", text: "Legato heisst gebunden: Der Ton reisst zwischen den Noten nicht ab. Die App zeigt dir Lücken in deiner Linie. Je weniger Lücken, desto besser." },
        { type: "match", title: "Gebundene Terzen", notes: "1:2 3:2 5:2 3:2 1:4", syl: "a", bpm: 72, keys: [0, 2] },
        { type: "glide", title: "Langsame Sirene ohne Abriss", secs: 10 }
      ],
      links: [["Legato singen (Videos)", yt("Legato singen Übung")]] },
    { id: "a21", title: "Gefühl", min: 12, goal: "Mit derselben Melodie verschiedene Stimmungen ausdrücken.",
      steps: [
        { type: "info", title: "Eine Melodie, vier Gefühle", text: "Singe die gleiche kurze Reihe viermal: fröhlich, traurig, geheimnisvoll, stolz. Was verändert sich? Tempo, Lautstärke, Klangfarbe, Gesichtsausdruck. Ausdruck beginnt im Gesicht und in den Augen." },
        { type: "match", title: "Fröhlich", notes: "1 3 5 6 5 3 1:2", syl: "la", bpm: 110 },
        { type: "match", title: "Traurig", notes: "1 b3 5 6 5 b3 1:2", syl: "u", bpm: 66 },
        { type: "free", title: "Frei gestalten", text: "Singe die Reihe noch zweimal: geheimnisvoll und stolz. Nimm dich ruhig mit dem Handy auf und hör dir an, was anders klingt.", secs: 60 }
      ],
      links: [["Ausdruck beim Singen (Videos)", yt("Ausdruck Gefühl beim Singen Tipps")]] }
  ]},
  { title: "Lieder", intro: "Jetzt kommt alles zusammen. Alle Lieder sind traditionell und frei verwendbar.",
    lessons: [
    { id: "a22", title: "Ode an die Freude", min: 14, goal: "Eine ganze Melodie sauber singen.",
      steps: [
        { type: "info", title: "Beethovens Melodie", text: "Die Melodie aus Beethovens 9. Sinfonie (Text: Friedrich Schiller) bewegt sich fast nur in Schritten. Erst auf «la» lernen, dann mit Text: «Freude, schöner Götterfunken, Tochter aus Elysium»." },
        { type: "match", title: "Erste Zeile", notes: "3 3 4 5 5 4 3 2 1 1 2 3 3:1.5 2:0.5 2:2", syl: "la", bpm: 100 },
        { type: "match", title: "Zweite Zeile", notes: "3 3 4 5 5 4 3 2 1 1 2 3 2:1.5 1:0.5 1:2", syl: "la", bpm: 100 }
      ],
      links: [["Ode an die Freude (Wikipedia)", "https://de.wikipedia.org/wiki/An_die_Freude"], ["Mitsing-Videos", yt("Ode an die Freude zum Mitsingen")]] },
    { id: "a23", title: "Bruder Jakob im Kanon", min: 14, goal: "Die eigene Stimme halten, während eine andere singt.",
      steps: [
        { type: "match", title: "Melodie lernen", notes: "1 2 3 1 1 2 3 1 3 4 5:2 3 4 5:2", syl: "la", bpm: 100 },
        { type: "match", title: "Zweiter Teil", notes: "5:0.5 6:0.5 5:0.5 4:0.5 3 1 5:0.5 6:0.5 5:0.5 4:0.5 3 1 1 _5 1:2 1 _5 1:2", syl: "la", bpm: 100 },
        { type: "info", title: "Kanon", text: "Im Werkzeug «Klavier» kannst du die Melodie vorspielen lassen. Noch schöner: Singe mit einer zweiten Person, die zwei Takte später einsetzt. Bleib bei deiner Melodie, auch wenn es um dich herum anders klingt." }
      ],
      links: [["Bruder Jakob als Kanon (Videos)", yt("Bruder Jakob Kanon")]] },
    { id: "a24", title: "Abschluss: Wo stehst du?", min: 15, goal: "Den Fortschritt messen und weitermachen.",
      steps: [
        { type: "range", title: "Tonumfang neu messen", text: "Vergleiche mit deiner ersten Messung. Viele gewinnen in den ersten Wochen zwei bis vier Töne dazu." },
        { type: "glide", title: "Sirene über den ganzen Umfang", secs: 10 },
        { type: "info", title: "Wie geht es weiter?", text: "Gratuliere! Wiederhole Lektionen mit niedrigen Punkten, probiere die Stilrichtungen aus und überlege dir ein paar Stunden bei einer Gesangslehrerin oder einem Gesangslehrer. Eine App ersetzt kein Ohr, das dir direkt zuhört." }
      ],
      links: [["Musikschulen in der Schweiz", "https://www.musikschule.ch"]] }
  ]}
  ]
},

/* ------------------------------------------------------------------ */
kids: {
  name: "Kinder",
  blurb: "Zwölf kurze Singspiele für Kinder ab etwa 4 Jahren, zum gemeinsamen Singen mit Mama oder Papa.",
  stages: [
  { title: "Die Stimme entdecken", intro: "Spielerisch Töne machen, summen und tönen.",
    lessons: [
    { id: "k1", title: "Hallo, Stimme!", min: 6, goal: "Die Stimme aufwecken.",
      steps: [
        { type: "info", title: "Aufwachen wie ein Löwe", text: "Strecken, gähnen wie ein grosser Löwe, dann schütteln wie ein nasser Hund. Jetzt die Lippen pusten lassen wie ein Pferd: «brrr»!", kid: true },
        { type: "sustain", title: "Bienchen summen", text: "Summt zusammen wie ein Bienchen: «sssummm». Wer schafft es lange?", note: "3", secs: 4, syl: "summ" }
      ],
      links: [["Chrome Music Lab: Spielen mit Tönen", "https://musiclab.chromeexperiments.com/"]] },
    { id: "k2", title: "Feuerwehr-Sirene", min: 6, goal: "Hoch und tief spielerisch entdecken.",
      steps: [
        { type: "info", title: "Tatü-tata", text: "Die Feuerwehr fährt los! Mit «uuu» ganz tief anfangen und hoch hinauf wie eine Sirene, dann wieder runter. Mit der Hand die Höhe zeigen.", kid: true },
        { type: "glide", title: "Sirene", text: "Rauf und runter mit «uuu»!", secs: 6 }
      ],
      links: [["Sirenen-Spiele für Kinder (Videos)", yt("Kinder Stimme Sirene Spiel singen")]] },
    { id: "k3", title: "Der Kuckuck ruft", min: 6, goal: "Zwei Töne treffen.",
      steps: [
        { type: "info", title: "Kuckuck!", text: "Der Kuckuck ruft immer gleich: einen hohen und einen tieferen Ton. Hört gut zu und ruft zurück!", kid: true },
        { type: "match", title: "Kuckuck rufen", notes: "5:2 3:2 5:2 3:2", syl: "kuk kuck kuk kuck", bpm: 80 }
      ],
      links: [["Kuckucks-Lieder (Videos)", yt("Kuckuck Kinderlied")]] }
  ]},
  { title: "Hören und nachsingen", intro: "Echo-Spiele, Treppen und Atem-Abenteuer.",
    lessons: [
    { id: "k4", title: "Das Echo-Spiel", min: 6, goal: "Einen Ton nachsingen.",
      steps: [
        { type: "info", title: "Im Wald ruft das Echo", text: "Ihr seid in den Bergen. Die App ruft, ihr seid das Echo und ruft genau gleich zurück.", kid: true },
        { type: "match", title: "Echo", notes: "1:2 1:2 3:2 3:2 5:2 5:2", syl: "hoo", bpm: 80 }
      ],
      links: [] },
    { id: "k5", title: "Die Ton-Treppe", min: 7, goal: "Fünf Töne hinauf und hinunter.",
      steps: [
        { type: "info", title: "Treppensteigen", text: "Stellt euch vor, ihr lauft eine Treppe hinauf und wieder hinunter. Bei jedem Ton eine Stufe! Dabei könnt ihr auch mit den Händen die Stufen zeigen.", kid: true },
        { type: "match", title: "Treppe", notes: "1 2 3 4 5:2 5 4 3 2 1:2", syl: "la", bpm: 76 }
      ],
      links: [] },
    { id: "k6", title: "Luftballon und Schlange", min: 6, goal: "Tief atmen und lange ausatmen.",
      steps: [
        { type: "breath", title: "Luftballon aufblasen", text: "Der Bauch ist ein Luftballon. Beim Einatmen wird er dick, beim Ausatmen langsam wieder dünn.", pattern: [3, 1, 4, 0], rounds: 3 },
        { type: "hiss", title: "Die Schlange zischt", text: "Wie lange kann die Schlange zischen? «sssss»", goal: 8 }
      ],
      links: [["Atemspiele für Kinder (Videos)", yt("Atemübungen Kinder Spiel")]] }
  ]},
  { title: "Kleine Lieder", intro: "Traditionelle Kinderlieder Stück für Stück.",
    lessons: [
    { id: "k7", title: "Leise Maus, lauter Löwe", min: 6, goal: "Leise und laut singen.",
      steps: [
        { type: "info", title: "Tierkonzert", text: "Die Maus singt ganz leise «piep». Der Löwe singt laut «uaah», aber ohne zu schreien. Wechselt euch ab!", kid: true },
        { type: "sustain", title: "Mäuschen (leise)", note: "5", secs: 3, syl: "piep" },
        { type: "sustain", title: "Löwe (laut)", note: "1", secs: 3, syl: "ua" }
      ],
      links: [] },
    { id: "k8", title: "Alle meine Entchen", min: 7, goal: "Das erste ganze Lied.",
      steps: [
        { type: "info", title: "Ein bekanntes Lied", text: "Kennt ihr «Alle meine Entchen»? Erst hören, dann mitsingen. Das Lied ist sehr alt und gehört allen.", kid: true },
        { type: "match", title: "Erste Hälfte", notes: "1 2 3 4 5:2 5:2 6 6 6 6 5:4", syl: "al le mei ne Ent chen schwim men auf dem See", bpm: 96 },
        { type: "match", title: "Zweite Hälfte", notes: "4 4 4 4 3:2 3:2 2 2 2 2 1:4", syl: "Köpf chen in das Was ser Schwänz chen in die Höh", bpm: 96 }
      ],
      links: [["Alle meine Entchen (Wikipedia)", "https://de.wikipedia.org/wiki/Alle_meine_Entchen"]] },
    { id: "k9", title: "Hänschen klein", min: 7, goal: "Sprünge in einem Lied.",
      steps: [
        { type: "match", title: "Erste Zeile", notes: "5 3 3:2 4 2 2:2 1 2 3 4 5 5 5:2", syl: "Häns chen klein ging al lein in die wei te Welt hin ein", bpm: 100 },
        { type: "match", title: "Zweite Zeile", notes: "5 3 3:2 4 2 2:2 1 3 5 5 1:4", syl: "Stock und Hut steht ihm gut ist gar wohl ge mut", bpm: 100 }
      ],
      links: [["Hänschen klein (Wikipedia)", "https://de.wikipedia.org/wiki/H%C3%A4nschen_klein"]] }
  ]},
  { title: "Konzert", intro: "Jetzt seid ihr bereit für die Bühne.",
    lessons: [
    { id: "k10", title: "Bruder Jakob", min: 7, goal: "Ein Lied mit schnellen Tönen.",
      steps: [
        { type: "match", title: "Bruder Jakob", notes: "1 2 3 1 1 2 3 1 3 4 5:2 3 4 5:2", syl: "Bru der Ja kob Bru der Ja kob schläfst du noch schläfst du noch", bpm: 96 },
        { type: "match", title: "Hörst du nicht die Glocken", notes: "5:0.5 6:0.5 5:0.5 4:0.5 3 1 5:0.5 6:0.5 5:0.5 4:0.5 3 1 1 _5 1:2 1 _5 1:2", syl: "hörst du nicht die Glo cken hörst du nicht die Glo cken ding dang dong ding dang dong", bpm: 96 }
      ],
      links: [["Bruder Jakob (Wikipedia)", "https://de.wikipedia.org/wiki/Bruder_Jakob"]] },
    { id: "k11", title: "Tierkonzert", min: 7, goal: "Alles Gelernte als Spiel.",
      steps: [
        { type: "glide", title: "Die Katze miaut", text: "«Miaaau» von oben nach unten.", secs: 5 },
        { type: "match", title: "Die Eule ruft", notes: "5:2 3:2 5:2 3:2", syl: "hu hu hu hu", bpm: 76 },
        { type: "sustain", title: "Die Kuh muht", note: "1", secs: 3, syl: "muh" }
      ],
      links: [] },
    { id: "k12", title: "Das grosse Konzert", min: 8, goal: "Ein Lied vorsingen und feiern.",
      steps: [
        { type: "free", title: "Bühne frei!", text: "Sucht euch euer Lieblingslied aus dem Kurs aus. Stellt euch auf eine «Bühne» (einen Teppich), verbeugt euch und singt es vor. Die Familie klatscht!", secs: 90, kid: true },
        { type: "info", title: "Urkunde", text: "Ihr habt den Kinder-Singkurs geschafft! Auf der Startseite gibt es jetzt eure Urkunde.", kid: true }
      ],
      links: [["Kinderlieder zum Mitsingen (Videos)", yt("Kinderlieder zum Mitsingen deutsch")]] }
  ]}
  ]
},

/* ------------------------------------------------------------------ */
styles: {
  name: "Stilrichtungen",
  blurb: "Jeder Stil hat eigene Klangideale. Diese Module stehen dir jederzeit offen, am besten ab Stufe 2 des Erwachsenenkurses.",
  stages: [
  { title: "Pop", intro: "Natürlicher, sprechnaher Klang, Mikrofontechnik und kleine Verzierungen.",
    lessons: [
    { id: "s-pop1", title: "Sprechnah singen", min: 12, goal: "Den Pop-Klang zwischen Sprechen und Singen finden.",
      steps: [
        { type: "info", title: "Wie gesprochen", text: "Pop klingt, als würde jemand dir etwas erzählen. Sprich einen Satz, dann sprich ihn auf einer Tonhöhe, dann singe ihn. Behalte dabei die Sprachmelodie und die natürliche Aussprache. Kein klassisches Vibrato, eher gerade Töne mit Vibrato am Ende.",
          bullets: ["Nah am Mikrofon leise singen (Proximity-Effekt)", "Vokale wie im Sprechen", "Luftige Töne als Stilmittel"] },
        { type: "match", title: "Pop-Pentatonik", notes: "1 2 3 5 6 5 3 2 1:2", syl: "yeah", bpm: 96, keys: [0, 2] },
        { type: "sustain", title: "Gerader Ton", text: "Halte den Ton zuerst ganz gerade, gegen Ende darf er leicht schwingen.", note: "5", secs: 6, syl: "oh" }
      ],
      links: [["Pop-Gesang Tipps (Videos)", yt("Pop Gesang lernen Tipps deutsch")]] },
    { id: "s-pop2", title: "Riffs und Verzierungen", min: 12, goal: "Kleine Melismen sauber singen.",
      steps: [
        { type: "info", title: "Riffs", text: "Riffs sind schnelle Tonfolgen auf einer Silbe. Erst sehr langsam und präzise, dann schneller. Meistens auf der Pentatonik." },
        { type: "match", title: "Riff langsam", notes: "5 3 2 1 2 1 _6 1:2", syl: "oh", bpm: 84 },
        { type: "match", title: "Riff schneller", notes: "5 3 2 1 2 1 _6 1:2", syl: "oh", bpm: 120 }
      ],
      links: [["Gesangsriffs lernen (Videos)", yt("vocal runs riffs tutorial beginner")]] }
  ]},
  { title: "Klassik", intro: "Weiter Raum, gleichmässiger Klang, Vibrato und Legato.",
    lessons: [
    { id: "s-kla1", title: "Der klassische Raum", min: 12, goal: "Den Gähnraum nutzen.",
      steps: [
        { type: "info", title: "Gähnraum", text: "Beginne ein Gähnen und stoppe kurz davor: Der weiche Gaumen hebt sich, der Kehlkopf sinkt leicht. Diese Weite gibt der klassischen Stimme Rundung und Tragfähigkeit. Nicht künstlich abdunkeln!" },
        { type: "sustain", title: "Runder Vokal", note: "3", secs: 8, syl: "o", dyn: true },
        { type: "match", title: "Legato-Arpeggio", notes: "1:2 3:2 5:2 8:2 5:2 3:2 1:4", syl: "a", bpm: 72, keys: [0, 2] }
      ],
      links: [["Klassischer Gesang Grundlagen (Videos)", yt("klassischer Gesang Grundlagen Technik")], ["Belcanto (Wikipedia)", "https://de.wikipedia.org/wiki/Belcanto"]] },
    { id: "s-kla2", title: "Vibrato", min: 12, goal: "Ein freies Vibrato zulassen.",
      steps: [
        { type: "info", title: "Vibrato entsteht von selbst", text: "Ein gesundes Vibrato schwingt etwa fünf- bis siebenmal pro Sekunde um den Ton. Es entsteht, wenn Atem und Kehlkopf frei sind. Nicht machen, sondern zulassen: lange Töne locker halten." },
        { type: "sustain", title: "Lange Note, Vibrato zulassen", note: "5", secs: 8, syl: "a", vib: true }
      ],
      links: [["Vibrato lernen (Videos)", yt("Vibrato lernen Gesang")]] }
  ]},
  { title: "Musical", intro: "Belting, Sprechgesang und Schauspiel beim Singen.",
    lessons: [
    { id: "s-mus1", title: "Belting sicher", min: 12, goal: "Kraftvolle Töne ohne Druck auf den Hals.",
      steps: [
        { type: "info", title: "Belting", text: "Belting klingt wie ein kräftiger Ruf («Hey!»). Sicher wird es mit viel Twang (das «njä» aus Lektion 9), hellem Vokal und stabiler Stütze. Niemals schreien oder pressen. Wenn es kratzt, sofort leiser werden." },
        { type: "match", title: "Hey-Rufe", notes: "1 3 5:2 3 1:2", syl: "hey", bpm: 90, keys: [0, 2] },
        { type: "sustain", title: "Gehaltener Belt", note: "5", secs: 4, syl: "ä" }
      ],
      links: [["Belting lernen (Videos)", yt("Belting lernen gesund")]] }
  ]},
  { title: "Jazz", intro: "Swing, Blue Notes und Improvisation.",
    lessons: [
    { id: "s-jazz1", title: "Blue Notes und Scat", min: 12, goal: "Die Bluestonleiter kennenlernen.",
      steps: [
        { type: "info", title: "Blues", text: "Die Bluestonleiter hat Töne, die zwischen Dur und Moll liegen. Beim Scat-Singen improvisierst du auf Silben wie «du-ba-di-ba». Swing heisst: lang-kurz, lang-kurz." },
        { type: "match", title: "Bluestonleiter", notes: "1 b3 4 #4 5 b7 8:2 b7 5 #4 4 b3 1:2", syl: "du ba di ba", bpm: 92 },
        { type: "free", title: "Scat frei", text: "Improvisiere eine Minute lang auf Scat-Silben über die Töne der Bluestonleiter. Fehler gibt es hier nicht.", secs: 60 }
      ],
      links: [["Scat Singing (Videos)", yt("Scat singen lernen")], ["Blues-Tonleiter (Wikipedia)", "https://de.wikipedia.org/wiki/Blues-Tonleiter"]] }
  ]},
  { title: "Rock und Soul", intro: "Energie, Rauheit und Gospel-Feeling.",
    lessons: [
    { id: "s-rock1", title: "Energie ohne Heiserkeit", min: 12, goal: "Druckvoll singen und die Stimme schonen.",
      steps: [
        { type: "info", title: "Kraft aus dem Körper", text: "Rock- und Soul-Energie kommt aus Körper und Atem, nicht aus dem Hals. Rauheit (Distortion) gehört zu Fortgeschrittenen und sollte mit Lehrperson geübt werden. Hier trainierst du die Basis: kräftig, hell, gestützt." },
        { type: "match", title: "Gospel-Ruf", notes: "1 b3 4 5:2 b3 1:2", syl: "oh yeah", bpm: 88, keys: [0, 2] },
        { type: "sustain", title: "Kräftiger Ton", note: "5", secs: 5, syl: "ä" }
      ],
      links: [["Rock-Gesang gesund (Videos)", yt("Rockgesang lernen gesund")], ["Gospel (Wikipedia)", "https://de.wikipedia.org/wiki/Gospel"]] }
  ]},
  { title: "Volkslied und Jodel", intro: "Schweizer Tradition: Volkslied und Naturjodel.",
    lessons: [
    { id: "s-jod1", title: "Jodel-Kehlschlag", min: 12, goal: "Zwischen Brust- und Kopfstimme bewusst wechseln.",
      steps: [
        { type: "info", title: "Jodeln", text: "Beim Jodeln springt die Stimme absichtlich zwischen Bruststimme (tief, «jo») und Kopfstimme (hoch, «di»). Der Bruch, den du in Lektion 12 glättest, wird hier zum Stilmittel. Vokale helfen: tief «o, a», hoch «i, u, ü»." },
        { type: "match", title: "Jo-di-ri", notes: "1:2 5 8:2 5 3:2 1:2", syl: "jo du ri jo i ri", bpm: 84 },
        { type: "glide", title: "Kippen lassen", text: "Gleite von tief nach hoch und lass die Stimme bewusst in die Kopfstimme kippen.", secs: 8 }
      ],
      links: [["Eidgenössischer Jodlerverband", "https://www.jodlerverband.ch"], ["Jodeln lernen (Videos)", yt("jodeln lernen Anfänger")], ["Jodeln (Wikipedia)", "https://de.wikipedia.org/wiki/Jodeln"]] }
  ]}
  ]
}
};

const RESOURCES = [
  { group: "Üben und Gehörbildung", items: [
    ["musictheory.net", "https://www.musictheory.net/exercises", "Kostenlose Übungen für Noten, Intervalle und Akkorde."],
    ["Tonedear", "https://tonedear.com", "Gehörtraining für Intervalle und Tonleitern im Browser."],
    ["Chrome Music Lab", "https://musiclab.chromeexperiments.com/", "Spielerische Musik-Experimente, ideal mit Kindern."],
    ["Singing Carrots", "https://singingcarrots.com", "Online-Tonumfang-Test und Tonhöhen-Übungen (englisch)."]
  ]},
  { group: "Wissen", items: [
    ["Gesang (Wikipedia)", "https://de.wikipedia.org/wiki/Gesang", "Überblick über Stimme, Stile und Geschichte."],
    ["Stimmbildung (Wikipedia)", "https://de.wikipedia.org/wiki/Stimmbildung", "Grundlagen der Stimmbildung."],
    ["Stimmlage (Wikipedia)", "https://de.wikipedia.org/wiki/Stimmlage", "Sopran, Alt, Tenor, Bass und die Bereiche dazwischen."]
  ]},
  { group: "Unterricht und Gemeinschaft", items: [
    ["Verband Musikschulen Schweiz", "https://www.musikschule.ch", "Musikschulen in deiner Nähe für Gesangsunterricht."],
    ["Eidgenössischer Jodlerverband", "https://www.jodlerverband.ch", "Jodelklubs und Kurse in der ganzen Schweiz."],
    ["Chor finden (Videos und Tipps)", yt("im Chor singen Anfänger Tipps"), "Im Chor zu singen ist eines der besten Trainings."]
  ]},
  { group: "Technik hinter der App (Open Source)", items: [
    ["YIN-Algorithmus (Tonhöhe)", "https://en.wikipedia.org/wiki/Pitch_detection_algorithm", "Die App erkennt die Tonhöhe mit dem YIN-Verfahren, direkt im Browser."],
    ["pitchy auf GitHub", "https://github.com/ianprime0509/pitchy", "Offene JavaScript-Bibliothek für Tonhöhenerkennung, als Vorbild genutzt."],
    ["aubio auf GitHub", "https://github.com/aubio/aubio", "Offene Audio-Analyse-Bibliothek mit YIN-Implementierung."]
  ]}
];

const TIPS_DAILY = [
  "Trink vor dem Singen ein Glas Wasser. Die Stimmlippen brauchen Feuchtigkeit von innen.",
  "Wenn es im Hals kratzt, hör auf. Singen soll sich nie schmerzhaft anfühlen.",
  "Lieber jeden Tag 10 Minuten als einmal pro Woche eine Stunde.",
  "Gähnen ist eine der besten Lockerungsübungen für Kehle und Kiefer.",
  "Nimm dich ab und zu auf. Die eigene Stimme klingt von aussen anders als von innen.",
  "Lächeln beim Singen hebt den Klang und hilft gegen zu tiefe Töne.",
  "Nach lauten Proben: Stimmruhe und Summen statt Flüstern. Flüstern belastet die Stimme mehr als leises Sprechen.",
  "Singe im Stehen, so kann der Atem frei fliessen.",
  "Rauch, trockene Luft und viel Koffein trocknen die Stimme aus.",
  "Vor dem Einschlafen ein Lied im Kopf singen trainiert das innere Hören."
];
