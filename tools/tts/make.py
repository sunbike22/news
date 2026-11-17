#!/usr/bin/env python3
"""読み上げの音声ファイルを作る(GitHub Actions の tts.yml から動く)。
plan.json([しるし, 文] の一覧)の文を、VOICEVOX(ずんだもん)と Google Cloud Text-to-Speech で mp3 にして out/tts/<声>/<しるし>.mp3 に置く。
前回作ったもの(prev/tts/)は作り直さない。plan にない古いファイルは消す。index.json に、ある文のしるしを書く。
- Google は GOOGLE_TTS_KEY(GitHub の Secrets)があるときだけ。1か月 GG_MONTH_CAP 字までで止める(無料のわく 100万字より少なく)。
- 時間の上限 TIME_BUDGET 秒をこえたら、そこまでを公開する(のこりは次の回)。
使い方: python3 make.py plan.json prev_dir out_dir
"""
import json, os, sys, time, base64, shutil, subprocess, urllib.request, urllib.parse

VV_URL = os.environ.get("VV_URL", "http://127.0.0.1:50021")
VV_SPEAKER = int(os.environ.get("VV_SPEAKER", "3"))  # 3 = ずんだもん(ノーマル)
GG_KEY = os.environ.get("GOOGLE_TTS_KEY", "").strip()
GG_VOICE = os.environ.get("GG_VOICE", "ja-JP-Neural2-B")
GG_MONTH_CAP = int(os.environ.get("GG_MONTH_CAP", "800000"))
TIME_BUDGET = int(os.environ.get("TIME_BUDGET", "2100"))
T0 = time.time()

def fnv(t):  # index.html の ttsKey と同じ(UTF-16 の1単位ずつ FNV-1a、うしろに UTF-16 の長さを36進で)
    b = t.encode("utf-16-le"); units = [int.from_bytes(b[i:i+2], "little") for i in range(0, len(b), 2)]
    h = 0x811c9dc5
    for u in units: h ^= u; h = (h * 0x01000193) & 0xffffffff
    n = len(units); d = "0123456789abcdefghijklmnopqrstuvwxyz"; o = ""
    while True:
        n, r = divmod(n, 36); o = d[r] + o
        if n == 0: break
    return f"{h:08x}" + o

def to_mp3(src, dst):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-ar", "24000", "-b:a", "40k", dst], check=True)

def vv(text, dst):
    q = urllib.request.urlopen(urllib.request.Request(f"{VV_URL}/audio_query?" + urllib.parse.urlencode({"text": text, "speaker": VV_SPEAKER}), method="POST"), timeout=120).read()
    j = json.loads(q); j["speedScale"] = 1.08; j["prePhonemeLength"] = 0.05; j["postPhonemeLength"] = 0.12
    wav = urllib.request.urlopen(urllib.request.Request(f"{VV_URL}/synthesis?speaker={VV_SPEAKER}", data=json.dumps(j).encode(), headers={"Content-Type": "application/json"}, method="POST"), timeout=300).read()
    open("/tmp/vv.wav", "wb").write(wav); to_mp3("/tmp/vv.wav", dst)

def gg(text, dst):
    body = {"input": {"text": text}, "voice": {"languageCode": "ja-JP", "name": GG_VOICE}, "audioConfig": {"audioEncoding": "MP3", "sampleRateHertz": 24000, "speakingRate": 1.0}}
    r = urllib.request.urlopen(urllib.request.Request("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + GG_KEY, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST"), timeout=60).read()
    open("/tmp/gg.mp3", "wb").write(base64.b64decode(json.loads(r)["audioContent"])); to_mp3("/tmp/gg.mp3", dst)

def main():
    plan_p, prev, out = sys.argv[1], sys.argv[2], sys.argv[3]
    plan = json.load(open(plan_p))
    bad = [t for k, t in plan if fnv(t) != k]
    if bad: print("WARN key mismatch", len(bad), bad[:2])
    try: pidx = json.load(open(os.path.join(prev, "tts", "index.json")))
    except Exception: pidx = {}
    month = time.strftime("%Y-%m", time.gmtime(time.time() + 9 * 3600))
    used = pidx.get("ggUsed", {}).get(month, 0)
    idx = {"vv": {}, "gg": {}, "ggUsed": {month: used}, "voices": {"vv": "VOICEVOX:ずんだもん", "gg": "Google Cloud Text-to-Speech " + GG_VOICE}}
    log = []
    vv_ok = True
    try: urllib.request.urlopen(VV_URL + "/version", timeout=10).read()
    except Exception as e: vv_ok = False; log.append(f"VOICEVOX に つながらない: {e}")
    for src in ("vv", "gg"):
        os.makedirs(os.path.join(out, "tts", src), exist_ok=True)
    made = {"vv": 0, "gg": 0}; kept = {"vv": 0, "gg": 0}; stopped = False
    for key, text in plan:
        for src in ("vv", "gg"):
            dst = os.path.join(out, "tts", src, key + ".mp3"); old = os.path.join(prev, "tts", src, key + ".mp3")
            if os.path.exists(old):
                shutil.copy(old, dst); idx[src][key] = 1; kept[src] += 1; continue
            if time.time() - T0 > TIME_BUDGET: stopped = True; continue
            try:
                if src == "vv" and vv_ok: vv(text, dst)
                elif src == "gg" and GG_KEY and used + len(text) <= GG_MONTH_CAP: gg(text, dst); used += len(text)
                else: continue
                idx[src][key] = 1; made[src] += 1
            except Exception as e:
                log.append(f"{src} でエラー: {str(e)[:200]} 文: {text[:30]}")
    idx["ggUsed"][month] = used
    idx["made"] = made; idx["kept"] = kept; idx["plan"] = len(plan); idx["stopped"] = stopped
    idx["at"] = time.strftime("%Y-%m-%dT%H:%M:%S+09:00", time.gmtime(time.time() + 9 * 3600))
    idx["log"] = log[:20]
    json.dump(idx, open(os.path.join(out, "tts", "index.json"), "w"), ensure_ascii=False)
    print(json.dumps({k: idx[k] for k in ("made", "kept", "plan", "stopped", "ggUsed", "log")}, ensure_ascii=False))

if __name__ == "__main__": main()
