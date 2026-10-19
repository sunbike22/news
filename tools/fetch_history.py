"""株・円・原油の長い期間のデータを FRED(米セントルイス連銀)から取り、history.json に書き出す。
GitHub Actions で毎日動かす。キーは不要。"""
import csv, io, json, urllib.request, datetime

SERIES = {
    "nikkei": ("NIKKEI225", "日経平均株価(終値)", "円"),
    "yen":    ("DEXJPUS",   "1ドルあたりの円(米連銀の正午レート)", "円"),
    "oil":    ("DCOILWTICO","NY原油 WTI(スポット価格)", "ドル"),
}

def fetch(sid):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
    req = urllib.request.Request(url, headers={"User-Agent": "mainichi-news/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode("utf-8")
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2 or row[0] in ("DATE", "observation_date"):
            continue
        try:
            rows.append((row[0], round(float(row[1]), 2)))
        except ValueError:
            continue  # 祝日などの「.」は飛ばす
    return rows

out = {"source": "FRED, Federal Reserve Bank of St. Louis", "fetched": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"), "series": {}}
for key, (sid, label, unit) in SERIES.items():
    rows = fetch(sid)
    monthly = {}
    for d, v in rows:
        monthly.setdefault(d[:7], []).append(v)
    out["series"][key] = {
        "id": sid, "label": label, "unit": unit,
        "daily": [[d, v] for d, v in rows if d >= "2023-01-01"],
        "monthly": [[m, round(sum(vs) / len(vs), 2)] for m, vs in sorted(monthly.items()) if m >= "1990-01"],
    }

with open("history.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print({k: len(v["daily"]) for k, v in out["series"].items()})
