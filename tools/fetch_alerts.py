"""気象庁の公式データから、地震・津波・特別警報を見張って alert.json を作る。GitHub Actions で10分ごとに動かす。キーは不要。
- 地震: 気象庁(bosai の list.json)→ だめなら P2P地震情報(気象庁の発表を配るサービス)
- 津波: P2P地震情報(code 552)と、気象庁の防災情報XML(eqvol)の題名
- 特別警報: 気象庁の防災情報XML(extra)
大きなもの(震度5弱以上・津波の警報/注意報・特別警報)が新しく出たら ntfy で1通送る。同じものは2回送らない。
使い方: python tools/fetch_alerts.py prev.json out/alert.json  → 中身が変わったら "CHANGED" と出す"""
import json, re, sys, time, datetime, urllib.request, urllib.parse
import xml.etree.ElementTree as ET

UA = "Mozilla/5.0 (mainichi-news alert watcher; +https://sunbike22.github.io/news/)"
TOPIC = "mainichi-news-sb22-q7k4"
JST = datetime.timezone(datetime.timedelta(hours=9))
NOW = datetime.datetime.now(JST)
SCALE = ["1", "2", "3", "4", "5-", "5+", "6-", "6+", "7"]
SNAME = {"1": "1", "2": "2", "3": "3", "4": "4", "5-": "5弱", "5+": "5強", "6-": "6弱", "6+": "6強", "7": "7"}
P2P_SCALE = {10: "1", 20: "2", 30: "3", 40: "4", 45: "5-", 46: "5-", 50: "5+", 55: "6-", 60: "6+", 70: "7"}

def get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")

def rank(s):
    return SCALE.index(s) if s in SCALE else -1

def iso(dt):
    return dt.astimezone(JST).strftime("%Y-%m-%dT%H:%M:%S+09:00")

errors = {}

# ---------- 地震 ----------
def quakes_jma():
    L = json.loads(get("https://www.jma.go.jp/bosai/quake/data/list.json"))
    by = {}
    for r in L:
        eid = r.get("eid")
        if not eid or not r.get("anm"):
            continue
        if "遠地" in (r.get("ttl") or ""):
            continue
        cur = by.get(eid)
        # 同じ地震の情報のうち、いちばん新しい発表を使う
        if not cur or (r.get("rdt") or "") > (cur.get("rdt") or ""):
            by[eid] = r
    out = []
    for eid, r in by.items():
        depth = None
        m = re.search(r"([+-]\d+(?:\.\d+)?)/?$", r.get("cod") or "")
        if m:
            try:
                depth = round(abs(float(m.group(1))) / 1000)
            except ValueError:
                depth = None
        mx = r.get("maxi") or ""
        out.append({"id": eid, "at": r.get("at"), "place": r.get("anm"), "mag": r.get("mag") or None,
                    "depth": depth, "maxi": mx if mx in SCALE else None, "ttl": r.get("ttl")})
    return out

def quakes_p2p():
    L = json.loads(get("https://api.p2pquake.net/v2/history?codes=551&limit=40"))
    out = []
    for r in L:
        e = r.get("earthquake") or {}
        h = e.get("hypocenter") or {}
        if (r.get("issue") or {}).get("type") == "Foreign":
            continue
        t = e.get("time")  # "2026/10/20 16:05:00"
        try:
            at = iso(datetime.datetime.strptime(t, "%Y/%m/%d %H:%M:%S").replace(tzinfo=JST))
        except Exception:  # noqa: BLE001
            continue
        mag = h.get("magnitude")
        dep = h.get("depth")
        out.append({"id": "p" + at.replace("-", "").replace(":", "")[:15], "at": at, "place": h.get("name") or "調査中",
                    "mag": str(mag) if mag not in (None, -1) else None, "depth": dep if dep not in (None, -1) else None,
                    "maxi": P2P_SCALE.get(e.get("maxScale")), "ttl": "地震情報"})
    # 同じ時刻の重複をまとめる
    seen, uniq = set(), []
    for q in out:
        if q["at"] in seen:
            continue
        seen.add(q["at"]); uniq.append(q)
    return uniq

quakes, qsrc = [], None
for name, fn in (("気象庁", quakes_jma), ("P2P地震情報", quakes_p2p)):
    try:
        q = fn()
        if q:
            quakes, qsrc = q, name
            break
        errors["quake_" + name] = "0件"
    except Exception as e:  # noqa: BLE001
        errors["quake_" + name] = f"{type(e).__name__}: {e}"[:200]
cut = iso(NOW - datetime.timedelta(days=3))
quakes = sorted([q for q in quakes if (q.get("at") or "") >= cut], key=lambda q: q["at"], reverse=True)[:15]

# ---------- 津波 ----------
tsunami = None
GRADE = {"MajorWarning": "大津波警報", "Warning": "津波警報", "Watch": "津波注意報"}
try:
    L = json.loads(get("https://api.p2pquake.net/v2/history?codes=552&limit=3"))
    if L:
        r = L[0]
        areas = r.get("areas") or []
        grades = [a.get("grade") for a in areas]
        top = next((g for g in ("MajorWarning", "Warning", "Watch") if g in grades), None)
        if not r.get("cancelled") and top:
            t = r.get("time") or ""
            try:
                at = iso(datetime.datetime.strptime(t[:19], "%Y/%m/%d %H:%M:%S").replace(tzinfo=JST))
            except Exception:  # noqa: BLE001
                at = iso(NOW)
            names = [a.get("name") for a in areas if a.get("grade") == top][:8]
            tsunami = {"id": "t" + at, "at": at, "grade": GRADE[top], "areas": names, "count": len(areas)}
except Exception as e:  # noqa: BLE001
    errors["tsunami"] = f"{type(e).__name__}: {e}"[:200]

# ---------- 特別警報(気象庁 防災情報XML) ----------
ATOM = {"a": "http://www.w3.org/2005/Atom"}
special = []
try:
    root = ET.fromstring(get("https://www.data.jma.go.jp/developer/xml/feed/extra.xml"))
    for en in root.findall("a:entry", ATOM):
        title = (en.findtext("a:title", "", ATOM) or "")
        body = (en.findtext("a:content", "", ATOM) or "")
        upd = en.findtext("a:updated", "", ATOM) or ""
        who = en.findtext("a:author/a:name", "", ATOM) or ""
        # 題名は「気象特別警報・警報・注意報」なので、本文に「特別警報」があるものだけ(ふつうの警報・注意報は除く)
        if "警報" not in title or "特別警報" not in body:
            continue
        # 「特別警報を解除」だけのものは出さない
        if re.search(r"特別警報[^。]*解除", body) and not re.search(r"特別警報を発表", body):
            continue
        try:
            at = iso(datetime.datetime.fromisoformat(upd.replace("Z", "+00:00")))
        except ValueError:
            at = iso(NOW)
        if at < iso(NOW - datetime.timedelta(hours=24)):
            continue
        txt = re.sub(r"\s+", " ", body).strip()[:120]
        special.append({"id": "s" + at + who, "at": at, "who": who, "text": txt})
    special = special[:5]
except Exception as e:  # noqa: BLE001
    errors["special"] = f"{type(e).__name__}: {e}"[:200]

# ---------- 前回分と通知 ----------
prev = {}
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        prev = json.load(f)
except Exception:  # noqa: BLE001
    prev = {}
sent = list(prev.get("sent") or [])
first_run = not prev

def ntfy(title, msg, prio, tags):
    body = {"topic": TOPIC, "title": title, "message": msg + "\nくわしくは気象庁・NHKなどで確かめてください。",
            "tags": tags, "priority": prio, "click": "https://sunbike22.github.io/news/#quake"}
    req = urllib.request.Request("https://ntfy.sh", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        print("ntfy", r.status)

def hm(at):
    try:
        d = datetime.datetime.fromisoformat(at)
        return f"{d.month}/{d.day} {d.hour}:{d.minute:02d}"
    except Exception:  # noqa: BLE001
        return ""

todo = []
for q in quakes:
    # 震度5弱以上は昼夜を問わずお知らせ(3時間以内に発生したものだけ)
    if rank(q.get("maxi")) >= rank("5-") and q["at"] >= iso(NOW - datetime.timedelta(hours=3)):
        key = "q" + q["at"][:16]
        if key not in sent:
            m = f"{hm(q['at'])}ごろ {q['place']} 最大震度{SNAME[q['maxi']]}" + (f" M{q['mag']}" if q.get("mag") else "")
            todo.append((key, "🔴 地震(気象庁発表)", m, 5 if rank(q["maxi"]) >= rank("6-") else 4, ["warning"]))
if tsunami and tsunami["id"] not in sent:
    todo.append((tsunami["id"], f"🌊 {tsunami['grade']}(気象庁発表)", "対象: " + "・".join(tsunami["areas"]) + (" ほか" if tsunami["count"] > len(tsunami["areas"]) else ""), 5, ["ocean", "warning"]))
for s in special:
    if s["id"] not in sent:
        todo.append((s["id"], "⚠️ 特別警報(気象庁発表)", f"{s['who']} {s['text']}", 5, ["warning"]))

for key, title, msg, prio, tags in todo:
    if first_run:
        sent.append(key); continue  # 初回は送らずに記録だけ(古いものを送らないため)
    try:
        ntfy(title, msg, prio, tags); sent.append(key)
    except Exception as e:  # noqa: BLE001
        errors["ntfy"] = f"{type(e).__name__}: {e}"[:200]
sent = sent[-60:]

out = {"quakes": quakes, "qsrc": qsrc, "tsunami": tsunami, "special": special, "sent": sent}
same = {k: prev.get(k) for k in out} == out
out["checked"] = iso(NOW)
out["updated"] = prev.get("updated") if same and prev.get("updated") else iso(NOW)
if errors:
    out["errors"] = errors
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("quakes", len(quakes), qsrc, "tsunami", bool(tsunami), "special", len(special), "errors", errors)
for q in quakes[:3]:
    print(" ", q)
# 30分に1回は checked を更新するため、変わっていなくても書き出す(見張りが動いている証拠)
last = prev.get("checked") or ""
if not same or last < iso(NOW - datetime.timedelta(minutes=30)):
    print("CHANGED")
