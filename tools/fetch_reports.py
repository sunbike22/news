#!/usr/bin/env python3
"""見る人からの「作った人に知らせる」(読みまちがい・わかりにくい説明)を ntfy から集めて reports.json にまとめる。
ntfy.sh は12時間しか保存しないので、1時間ごとに読んで reports ブランチに残す(新しい300件まで)。
使い方: fetch_reports.py 前回のreports.json 書き出し先
"""
import json, sys, urllib.request

TOPIC = "mainichi-yomi-0ddaf8b5"   # index.html の RPT_TOPIC と同じ
prev_path, out_path = sys.argv[1], sys.argv[2]
try:
    prev = json.load(open(prev_path, encoding="utf-8"))
except Exception:
    prev = {}
items = prev.get("items", [])
seen = {x.get("id") for x in items}

url = f"https://ntfy.sh/{TOPIC}/json?poll=1&since=13h"
req = urllib.request.Request(url, headers={"User-Agent": "mainichi-news-reports"})
new = 0
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        for line in r.read().decode("utf-8", "replace").splitlines():
            try:
                m = json.loads(line)
            except Exception:
                continue
            if m.get("event") != "message" or m.get("id") in seen:
                continue
            msg = str(m.get("message", ""))[:600]
            f = {}
            for ln in msg.splitlines():
                if ": " in ln:
                    k, v = ln.split(": ", 1)
                    f[k.strip()[:10]] = v.strip()[:200]
            items.append({"id": m.get("id"), "time": m.get("time"), "title": str(m.get("title", ""))[:40], "kind": f.get("種類", ""), "f": f})
            seen.add(m.get("id"))
            new += 1
except Exception as e:
    print("ERR", e)

items.sort(key=lambda x: x.get("time") or 0)
items = items[-300:]
json.dump({"items": items}, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(("CHANGED " if new else "SAME ") + str(new))
