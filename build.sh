#!/bin/sh
# Baut die App: docs/index.html (installierbare Web-App für GitHub Pages) und artifact.html (Claude-Version, nicht im Repository)
cd "$(dirname "$0")"
JS=$(cat src/data.js src/audio.js src/app.js)
{ cat src/shell.html; printf '<script>\n%s\n</script>\n' "$JS"; } > artifact.html
mkdir -p docs
{ printf '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="theme-color" content="#1f6b64"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg"><link rel="apple-touch-icon" href="icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Stimmraum">\n<style>:root{padding-top:env(safe-area-inset-top,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style></head><body>\n';
  cat src/shell.html; printf '<script>\n%s\n</script>\n' "$JS";
  printf '<script>if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});</script>\n</body></html>\n'; } > docs/index.html
echo built
