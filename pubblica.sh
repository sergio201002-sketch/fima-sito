#!/bin/bash
# pubblica il sito: nuova versione di data.js (i browser riscaricano il listino), commit e push
cd "$(dirname "$0")"
sed -i "s/data\.js?v=[0-9]*/data.js?v=$(date +%s)/" index.html
git add -A
git commit -qm "${1:-Aggiorna listino}

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -c http.postBuffer=524288000 push -q 2>&1 | tail -2
