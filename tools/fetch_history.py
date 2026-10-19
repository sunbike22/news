"""株・円・原油の長い期間のデータを FRED(米セントルイス連銀)から取り、history.json に書き出す。
GitHub Actions で毎日動かす。キーは不要。
1つの系列が取れなくても、前回のデータを残して続ける(全部失敗したときだけエラー)。
取れなかった理由は history.json の "errors" に残す。"""
import csv, io, json, os, time, urllib.request, datetime

SERIES = {
    "nikkei": ("NIKKEI225", "日経平均株価(終値)", "円"),
    "yen":    ("DEXJPUS",   "1ドルあたりの円(米連銀の正午レート)", "円"),
    "oil":    ("DCOILWTICO","NY原油 WTI(スポット価格)", "ドル"),
}
URLS = [
    "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}",
    "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=1990-01-01",
]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

def parse(text):
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2 or row[0] in ("DATE", "observation_date"):
            continue
        try:
            rows.append((row[0], round(float(row[1]), 2)))
        except ValueError:
            continue  # 祝日などの「.」は飛ばす
    return rows

def fetch(sid):
    last = None
    for attempt in range(3):
        for u in URLS:
            try:
                req = urllib.request.Request(u.format(sid=sid), headers={"User-Agent": UA, "Accept": "text/csv,*/*"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    rows = parse(r.read().decode("utf-8", "replace"))
                if len(rows) > 100:
                    return rows
                last = f"少なすぎる({len(rows)}行)"
            except Exception as e:  # noqa: BLE001
                last = f"{type(e).__name__}: {e}"
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(last or "unknown")

old = {}
if os.path.exists("history.json"):
    try:
        with open("history.json", encoding="utf-8") as f:
            old = json.load(f).get("series", {})
    except Exception:  # noqa: BLE001
        old = {}

out = {"source": "FRED, Federal Reserve Bank of St. Louis",
       "fetched": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
       "series": {}, "errors": {}}
ok = 0
for key, (sid, label, unit) in SERIES.items():
    try:
        rows = fetch(sid)
    except Exception as e:  # noqa: BLE001
        out["errors"][key] = str(e)[:300]
        if key in old:
            out["series"][key] = old[key]
        print("NG", key, e)
        continue
    ok += 1
    monthly = {}
    for d, v in rows:
        monthly.setdefault(d[:7], []).append(v)
    prev = old.get(key, {})
    out["series"][key] = {
        "id": sid, "label": label, "unit": unit,
        "daily": [[d, v] for d, v in rows if d >= "2023-01-01"],
        "monthly": [[m, round(sum(vs) / len(vs), 2)] for m, vs in sorted(monthly.items()) if m >= "1990-01"],
    }

if not out["errors"]:
    del out["errors"]
if not out["series"]:
    # 何も取れず、前回分もない: 理由だけ書き出して失敗にする(サイトは「準備中」と表示)
    with open("history.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("全部取れませんでした", out.get("errors"))
    raise SystemExit(0)

with open("history.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print({k: len(v.get("daily", [])) for k, v in out["series"].items()}, out.get("errors"))
