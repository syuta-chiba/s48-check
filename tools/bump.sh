#!/bin/sh
# index.html の app.js?v=… を新しい番号にする（キャッシュバスター）。
# app.js / index.html を直したら、commit の前に必ず実行する:  sh tools/bump.sh
cd "$(dirname "$0")/.." || exit 1
B=$(date +%Y%m%d%H%M%S)
sed -i.bak -E "s#src=\"app\.js(\?v=[0-9A-Za-z]*)?\"#src=\"app.js?v=$B\"#" index.html && rm -f index.html.bak
grep -o "app.js?v=[0-9]*" index.html
