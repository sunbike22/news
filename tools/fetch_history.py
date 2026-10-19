"""株・円・原油の長い期間のデータを取り、history.json に書き出す。GitHub Actions で毎日動かす。キーは不要。
取り先は順番に試す(FRED → 予備)。1つの系列が取れなくても前回のデータを残して続け、理由を "errors" に残す。"""
import csv, io, json, os, time, urllib.request, datetime

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")

def fred(sid):
    rows = []
    for row in csv.reader(io.StringIO(get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"))):
        if len(row) < 2 or row[0] in ("DATE", "observation_date"):
            continue
        try:
            rows.append((row[0], round(float(row[1]), 2)))
        except ValueError:
            continue
    return rows

def stooq(sym):
    rows = []
    for r in csv.DictReader(io.StringIO(get(f"https://stooq.com/q/d/l/?s={sym}&i=d"))):
        try:
            rows.append((r["Date"], round(float(r["Close"]), 2)))
        except (KeyError, ValueError):
            continue
    return rows

def yahoo(sym):
    rows = []
    for host in ("query1", "query2"):
        try:
            j = json.loads(get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{sym}?range=max&interval=1d", timeout=40))
            r = j["chart"]["result"][0]
            ts = r["timestamp"]; cl = r["indicators"]["quote"][0]["close"]
            for t, c in zip(ts, cl):
                if c is None:
                    continue
                d = (datetime.datetime.fromtimestamp(t, datetime.timezone.utc) + datetime.timedelta(hours=9)).strftime("%Y-%m-%d")
                rows.append((d, round(float(c), 2)))
            if rows:
                return rows
        except Exception:  # noqa: BLE001
            continue
    return rows

def nikkei_official():
    rows = []
    for name in ("nikkei_stock_average_daily_jp.csv", "nikkei_stock_average_daily_en.csv"):
        try:
            txt = get(f"https://indexes.nikkei.co.jp/nkave/historical/{name}", timeout=40)
        except Exception:  # noqa: BLE001
            continue
        for row in csv.reader(io.StringIO(txt)):
            if len(row) < 2:
                continue
            d = row[0].strip().replace("/", "-")
            try:
                if len(d) == 10 and d[4] == "-":
                    rows.append((d, round(float(row[1].replace(",", "")), 2)))
            except ValueError:
                continue
        if rows:
            break
    return rows

def frankfurter():
    rows = []
    for start, end in (("1999-01-04", "2012-12-31"), ("2013-01-01", "")):
        j = json.loads(get(f"https://api.frankfurter.app/{start}..{end}?from=USD&to=JPY", timeout=40))
        rows += [(d, round(v["JPY"], 2)) for d, v in sorted(j.get("rates", {}).items())]
    return rows

SERIES = {
    "nikkei": ("日経平均株価(終値)", "円", [("FRED", lambda: fred("NIKKEI225")), ("Yahoo", lambda: yahoo("%5EN225")), ("日経公式CSV", nikkei_official), ("Stooq", lambda: stooq("%5Enkx"))]),
    "yen":    ("1ドルあたりの円", "円", [("FRED", lambda: fred("DEXJPUS")), ("Frankfurter(欧州中央銀行)", frankfurter)]),
    "oil":    ("NY原油 WTI", "ドル", [("FRED", lambda: fred("DCOILWTICO")), ("Yahoo", lambda: yahoo("CL%3DF")), ("Stooq", lambda: stooq("cl.f"))]),
}

old = {}
if os.path.exists("history.json"):
    try:
        with open("history.json", encoding="utf-8") as f:
            old = json.load(f).get("series", {})
    except Exception:  # noqa: BLE001
        old = {}

out = {"fetched": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "series": {}, "errors": {}}
for key, (label, unit, sources) in SERIES.items():
    rows, src, errs = None, None, []
    for name, fn in sources:
        for attempt in range(2):
            try:
                r = fn()
                if len(r) > 100:
                    rows, src = sorted(r), name
                    break
                errs.append(f"{name}: 少なすぎる({len(r)}行)")
            except Exception as e:  # noqa: BLE001
                errs.append(f"{name}: {type(e).__name__}: {e}"[:200])
            time.sleep(3)
        if rows:
            break
    if not rows:
        out["errors"][key] = " / ".join(errs)[:600]
        if key in old:
            out["series"][key] = old[key]
        print("NG", key, errs)
        continue
    monthly = {}
    for d, v in rows:
        monthly.setdefault(d[:7], []).append(v)
    out["series"][key] = {
        "label": label, "unit": unit, "src": src,
        "daily": [[d, v] for d, v in rows if d >= "2023-01-01"],
        "monthly": [[m, round(sum(vs) / len(vs), 2)] for m, vs in sorted(monthly.items()) if m >= "1990-01"],
    }
    print("OK", key, src, len(rows))

if not out["errors"]:
    del out["errors"]
with open("history.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
