#!/usr/bin/env bash
# テストの準備: Playwright と、外のライブラリの控え(jsDelivr の代わり)をそろえる。
# 使い方: bash tools/test/setup.sh <しらべもの用フォルダ>   → そのフォルダを S に指定してテストを動かす
set -e
S="${1:?しらべもの用フォルダを指定してください}"; mkdir -p "$S/libs"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if [ ! -d /tmp/node_modules/playwright ]; then (cd /tmp && npm init -y >/dev/null 2>&1; npm i --no-audit --no-fund playwright@1.47.2 >/dev/null); fi
cd "$S/libs"
for pkg in d3@7.9.0 topojson-client@3.1.0 world-atlas@2.0.2; do
  name="${pkg%@*}"; ver="${pkg#*@}"
  if [ ! -d "$name-$ver" ]; then npm pack "$pkg" >/dev/null 2>&1; tar xzf "$name-$ver.tgz"; mv package "$name-$ver"; rm -f "$name-$ver.tgz"; fi
done
if [ ! -f "$S/chart.umd.js" ]; then (cd "$S" && npm pack chart.js@4.4.4 >/dev/null 2>&1 && tar xzf chart.js-4.4.4.tgz && cp package/dist/chart.umd.js . && rm -rf package chart.js-4.4.4.tgz); fi
if [ ! -f "$S/alert_real.json" ]; then
  python3 - "$S" <<'PY'
import json,sys
j={"quakes":[{"id":"20261021100437","at":"2026-10-21T10:04:00+09:00","place":"千葉県北西部","mag":"4.0","depth":70,"maxi":"2","ttl":"震源・震度情報"}],"qsrc":"jma","tsunami":None,"special":[],
 "warn":[{"pref":"東京都","who":"気象庁","at":"2026-10-21T10:00:00+09:00","lv":0,"text":"東京都では、高波に注意してください。"}],"sent":[],"wx":None,"wxmap":None,"checked":"2026-10-21T22:00:00+09:00","updated":"2026-10-21T22:00:00+09:00"}
open(sys.argv[1]+"/alert_real.json","w").write(json.dumps(j,ensure_ascii=False))
PY
fi
ls "$S/libs" >/dev/null && echo "準備できました: $S"
