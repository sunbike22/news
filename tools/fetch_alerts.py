"""気象庁の公式データから、地震・津波・特別警報を見張って alert.json を作る。GitHub Actions で10分ごとに動かす。キーは不要。
- 地震: 気象庁(bosai の list.json)→ だめなら P2P地震情報(気象庁の発表を配るサービス)
- 津波: P2P地震情報(code 552)と、気象庁の防災情報XML(eqvol)の題名
- 特別警報・都道府県ごとの警報: 気象庁の防災情報XML(extra)
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

# ---------- 都道府県ごとの気象庁のよびかけ(防災情報XML。文は発表そのまま。lv 2=特別警報 1=警戒 0=注意) ----------
PREF_NAMES = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
              "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
              "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
              "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]
# 気象台の名前 → 都道府県(本文に県名が出てこないときの手がかり)
OFFICE_PREF = {"気象庁": "東京都", "札幌管区気象台": "北海道", "函館地方気象台": "北海道", "旭川地方気象台": "北海道",
    "室蘭地方気象台": "北海道", "釧路地方気象台": "北海道", "網走地方気象台": "北海道", "稚内地方気象台": "北海道",
    "青森地方気象台": "青森県", "盛岡地方気象台": "岩手県", "仙台管区気象台": "宮城県", "秋田地方気象台": "秋田県",
    "山形地方気象台": "山形県", "福島地方気象台": "福島県", "水戸地方気象台": "茨城県", "宇都宮地方気象台": "栃木県",
    "前橋地方気象台": "群馬県", "熊谷地方気象台": "埼玉県", "銚子地方気象台": "千葉県", "横浜地方気象台": "神奈川県",
    "新潟地方気象台": "新潟県", "富山地方気象台": "富山県", "金沢地方気象台": "石川県", "福井地方気象台": "福井県",
    "甲府地方気象台": "山梨県", "長野地方気象台": "長野県", "岐阜地方気象台": "岐阜県", "静岡地方気象台": "静岡県",
    "名古屋地方気象台": "愛知県", "津地方気象台": "三重県", "彦根地方気象台": "滋賀県", "京都地方気象台": "京都府",
    "大阪管区気象台": "大阪府", "神戸地方気象台": "兵庫県", "奈良地方気象台": "奈良県", "和歌山地方気象台": "和歌山県",
    "鳥取地方気象台": "鳥取県", "松江地方気象台": "島根県", "岡山地方気象台": "岡山県", "広島地方気象台": "広島県",
    "下関地方気象台": "山口県", "徳島地方気象台": "徳島県", "高松地方気象台": "香川県", "松山地方気象台": "愛媛県",
    "高知地方気象台": "高知県", "福岡管区気象台": "福岡県", "佐賀地方気象台": "佐賀県", "長崎地方気象台": "長崎県",
    "熊本地方気象台": "熊本県", "大分地方気象台": "大分県", "宮崎地方気象台": "宮崎県", "鹿児島地方気象台": "鹿児島県",
    "沖縄気象台": "沖縄県", "宮古島地方気象台": "沖縄県", "石垣島地方気象台": "沖縄県", "南大東島地方気象台": "沖縄県"}

def warn_collect(root):
    out = []
    for en in root.findall("a:entry", ATOM):
        title = (en.findtext("a:title", "", ATOM) or "")
        body = (en.findtext("a:content", "", ATOM) or "")
        upd = en.findtext("a:updated", "", ATOM) or ""
        who = en.findtext("a:author/a:name", "", ATOM) or ""
        if "警報" not in title and "注意報" not in title:
            continue
        # 気象庁は 特別警報=最大級の警戒 / 警報=「警戒してください」 / 注意報=「注意してください」と書き分けている。
        # 発表そのものの言い方で分け、こちらで種類を決めつけない。
        if "特別警報" in body:
            lv = 2
        elif "警戒" in body:
            lv = 1
        elif "注意" in body:
            lv = 0
        else:
            continue
        if re.search(r"(警報|注意報)[^。]*解除", body) and "ください" not in body:
            continue
        try:
            at = iso(datetime.datetime.fromisoformat(upd.replace("Z", "+00:00")))
        except ValueError:
            at = iso(NOW)
        if at < iso(NOW - datetime.timedelta(hours=12)):
            continue
        prefs = [p for p in PREF_NAMES if p in body or p[:-1] in body]
        if not prefs and who in OFFICE_PREF:
            prefs = [OFFICE_PREF[who]]
        if not prefs:
            continue
        out.append({"at": at, "who": who, "lv": lv, "pref": prefs[:3], "text": re.sub(r"\s+", " ", body).strip()[:110]})
    # 同じ気象台の古いものは落として、新しい順に
    seen, keep = set(), []
    for w in sorted(out, key=lambda x: x["at"], reverse=True):
        if w["who"] in seen:
            continue
        seen.add(w["who"]); keep.append(w)
    return keep[:30]

warn = []
try:
    warn = warn_collect(ET.fromstring(get("https://www.data.jma.go.jp/developer/xml/feed/extra.xml")))
except Exception as e:  # noqa: BLE001
    errors["warn"] = f"{type(e).__name__}: {e}"[:200]

# ---------- 1時間ごとの天気(東京・Open-Meteo。気象庁などの予報モデル。キー不要・CC BY 4.0) ----------
# 予報は1時間ごとに変わるので、前回から50分たっていなければ前回分を使う(むだに書きかえない)
def wx_fetch(prev_wx):
    try:
        if prev_wx and prev_wx.get("at") and prev_wx["at"] >= iso(NOW - datetime.timedelta(minutes=50)):
            return prev_wx
    except Exception:  # noqa: BLE001
        pass
    q = urllib.parse.urlencode({"latitude": 35.6895, "longitude": 139.6917, "timezone": "Asia/Tokyo", "forecast_days": 2,
        "hourly": "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,uv_index"})
    j = json.loads(get("https://api.open-meteo.com/v1/forecast?" + q, timeout=20))
    h = j["hourly"]
    rows = []
    for i, t in enumerate(h["time"]):
        rows.append([t[5:16].replace("-", "/").replace("T", " "),
                     h["temperature_2m"][i], h["relative_humidity_2m"][i], h["precipitation_probability"][i],
                     h["precipitation"][i], h["weather_code"][i], h["wind_speed_10m"][i],
                     (h.get("uv_index") or [None] * len(h["time"]))[i]])
    return {"at": iso(NOW), "place": "東京", "cols": ["時刻", "気温", "湿度", "降水確率", "降水量", "天気コード", "風速", "紫外線"], "rows": rows}

# ---------- 全国の天気(14都市・今日と明日。Open-Meteo を1回でまとめて) ----------
CITIES = [("札幌", 43.06, 141.35), ("釧路", 42.98, 144.38), ("青森", 40.82, 140.74), ("仙台", 38.27, 140.87), ("新潟", 37.90, 139.02),
          ("金沢", 36.59, 136.63), ("東京", 35.69, 139.69), ("名古屋", 35.18, 136.91), ("大阪", 34.69, 135.52), ("広島", 34.40, 132.46),
          ("高知", 33.56, 133.53), ("福岡", 33.61, 130.42), ("鹿児島", 31.56, 130.56), ("那覇", 26.21, 127.68)]
def wxmap_fetch(prev_m):
    try:
        if prev_m and prev_m.get("at") and prev_m["at"] >= iso(NOW - datetime.timedelta(minutes=50)):
            return prev_m
    except Exception:  # noqa: BLE001
        pass
    q = urllib.parse.urlencode({"latitude": ",".join(str(c[1]) for c in CITIES), "longitude": ",".join(str(c[2]) for c in CITIES),
        "timezone": "Asia/Tokyo", "forecast_days": 2, "current": "temperature_2m,weather_code",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"})
    L = json.loads(get("https://api.open-meteo.com/v1/forecast?" + q, timeout=25))
    if isinstance(L, dict):
        L = [L]
    out = []
    for (name, la, lo), j in zip(CITIES, L):
        d = j["daily"]; c = j.get("current") or {}
        days = [[d["weather_code"][i], d["temperature_2m_max"][i], d["temperature_2m_min"][i], d["precipitation_probability_max"][i]] for i in range(min(2, len(d["time"])))]
        out.append([name, la, lo, days, c.get("temperature_2m"), c.get("weather_code")])
    return {"at": iso(NOW), "dates": L[0]["daily"]["time"][:2], "cities": out}


# ---------- 雨雲の動き(気象庁のナウキャスト)の時刻 ----------
# アプリは地図のタイル画像を直接読む。ここでは「どの時刻の画像があるか」だけを入れる(5分ごとに増える)。
def radar_fetch():
    def jl(u):
        req = urllib.request.Request(u, headers={"User-Agent": UA, "Origin": "https://sunbike22.github.io"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode()), r.headers.get("Access-Control-Allow-Origin")
    n1, cors = jl("https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json")
    n2, _ = jl("https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N2.json")
    past = sorted({(x["basetime"], x["validtime"]) for x in n1 if x.get("basetime") == x.get("validtime")})[-12:]
    fut = sorted({(x["basetime"], x["validtime"]) for x in n2 if x.get("validtime", "") > x.get("basetime", "")})[:12]
    probe = {"cors_json": cors}
    if past:
        b, v = past[-1]
        u = f"https://www.jma.go.jp/bosai/jmatile/data/nowc/{b}/none/{v}/surf/hrpns/6/56/25.png"
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Origin": "https://sunbike22.github.io"})
            with urllib.request.urlopen(req, timeout=20) as r:
                probe["tile"] = r.status; probe["cors_tile"] = r.headers.get("Access-Control-Allow-Origin"); probe["type"] = r.headers.get("Content-Type")
        except Exception as e:  # noqa: BLE001
            probe["tile"] = f"{type(e).__name__}: {e}"[:120]
    return {"at": iso(NOW), "past": [list(x) for x in past], "fut": [list(x) for x in fut], "probe": probe}


# ---------- (ためし)防災の地図タイルが読めるか、1回だけ調べる ----------
def probe_maps():
    U = {"flood": "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/12/3637/1612.png",
         "flood_kk": "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_kuni_data/12/3637/1612.png",
         "dosha": "https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/12/3637/1612.png",
         "dosha2": "https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/12/3638/1613.png",
         "tsunami": "https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/12/3638/1614.png",
         "takashio": "https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/12/3638/1614.png",
         "skhb01": "https://cyberjapandata.gsi.go.jp/xyz/skhb01/10/909/403.geojson",
         "skhb04": "https://cyberjapandata.gsi.go.jp/xyz/skhb04/10/909/403.geojson",
         "pale9": "https://cyberjapandata.gsi.go.jp/xyz/pale/9/454/201.png"}
    out = {}
    for k, u in U.items():
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Origin": "https://sunbike22.github.io"})
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read()
                out[k] = [r.status, r.headers.get("Access-Control-Allow-Origin"), r.headers.get("Content-Type"), len(body), body[:160].decode("utf-8", "replace") if k.startswith("skhb") else ""]
        except Exception as e:  # noqa: BLE001
            out[k] = f"{type(e).__name__}: {e}"[:120]
    return out

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

wx = prev.get("wx")
try:
    wx = wx_fetch(prev.get("wx"))
except Exception as e:  # noqa: BLE001
    errors["wx"] = f"{type(e).__name__}: {e}"[:200]
wxm = prev.get("wxmap")
try:
    wxm = wxmap_fetch(prev.get("wxmap"))
except Exception as e:  # noqa: BLE001
    errors["wxmap"] = f"{type(e).__name__}: {e}"[:200]
radar = None
try:
    radar = radar_fetch()
except Exception as e:  # noqa: BLE001
    errors["radar"] = f"{type(e).__name__}: {e}"[:200]
out = {"quakes": quakes, "qsrc": qsrc, "tsunami": tsunami, "special": special, "warn": warn, "sent": sent, "wx": wx, "wxmap": wxm}
same = {k: prev.get(k) for k in out} == out
# 雨雲は5分ごとに新しくなるので、変わったかどうかの判定には入れない(書くときは入れる)
out["radar"] = radar or prev.get("radar")
out["probe2"] = prev.get("probe2")
if not out["probe2"]:
    try:
        out["probe2"] = probe_maps()
    except Exception as e:  # noqa: BLE001
        out["probe2"] = str(e)[:100]
out["checked"] = iso(NOW)
out["updated"] = prev.get("updated") if same and prev.get("updated") else iso(NOW)
if errors:
    out["errors"] = errors
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("quakes", len(quakes), qsrc, "tsunami", bool(tsunami), "special", len(special), "warn", len(warn), "errors", errors)
for w in warn[:6]:
    print("  warn", w["lv"], w["pref"], w["who"], w["text"][:50])
for q in quakes[:3]:
    print(" ", q)
# 30分に1回は checked を更新するため、変わっていなくても書き出す(見張りが動いている証拠)
last = prev.get("checked") or ""
radar_new = bool(radar) and (radar.get("past") or [None])[-1] != ((prev.get("radar") or {}).get("past") or [None])[-1]
if not same or radar_new or last < iso(NOW - datetime.timedelta(minutes=30)):
    print("CHANGED")
