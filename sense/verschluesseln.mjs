// Verschlüsselt den Such-Index für docs/sense/daten.enc (AES-256-GCM, 12 Byte IV vorne).
// Aufruf: node sense/verschluesseln.mjs <index.json> <schluessel-base64url>
// Der Index im Klartext und der Schlüssel gehören NIE ins Repository.
import { readFileSync, writeFileSync } from "node:fs";
import { webcrypto as c } from "node:crypto";
const [, , src, keyText] = process.argv;
const raw = Buffer.from(keyText, "base64url");
if (raw.length !== 32) throw new Error("Schlüssel muss 32 Byte sein");
const key = await c.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
const iv = c.getRandomValues(new Uint8Array(12));
const enc = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv }, key, readFileSync(src)));
const out = new URL("../docs/sense/daten.enc", import.meta.url);
writeFileSync(out, Buffer.concat([iv, enc]));
console.log("geschrieben:", out.pathname, iv.length + enc.length, "Byte");
