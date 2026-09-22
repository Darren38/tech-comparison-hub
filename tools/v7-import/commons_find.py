"""Candidate Wikimedia Commons files for devices still without an image: file search by model name, keeping only
files whose title names the model and whose licence is reusable. Output commons_candidates.json for visual review."""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
V7 = Path(__file__).resolve().parents[2]
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "TechComparisonHub/7.0 (device photo research)"}
FREE = re.compile(r"^(CC0|Public domain|CC BY(-SA)? \d\.\d)$")


def api(params):
    q = urllib.parse.urlencode({**params, "format": "json"})
    for _ in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{API}?{q}", headers=UA), timeout=40) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(3)
    return {}


def key(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


ids = sys.argv[1:]
out = {}
for i in ids:
    dev = json.loads(next((V7 / "data/devices").glob(f"*/{i}.json")).read_text(encoding="utf-8"))
    name = dev["name"]
    brand = dev["brand"]
    # the distinctive part of the name must appear in the file title ("13T Pro", "Z9x", "Pura 80 Ultra")
    core = re.sub(r"^(Samsung|Apple|Xiaomi|Huawei|HONOR|OPPO|vivo|iQOO|POCO|Redmi|Galaxy|Google|Sony|OnePlus|realme|ASUS|REDMAGIC)\s+", "", name, flags=re.I)
    is5g = bool(re.search(r"\s5G$", core))
    need = key(re.sub(r"\s*5G$", "", core))
    extra = r"(pro|ultra|plus|max|lite|mini|fe|s|x)" if is5g else r"(pro|ultra|plus|max|lite|mini|fe|5g|s|x)"
    res = api({"action": "query", "list": "search", "srsearch": f"{name}", "srnamespace": 6, "srlimit": 25})
    titles = [h["title"] for h in res.get("query", {}).get("search", [])]
    good = [t for t in titles if need in key(t) and not re.search(r"\.(pdf|svg|webm|ogv|gif)$", t, re.I)
            and not re.search(need + (r"5g" if is5g else "") + extra + r"\b", key(t) + " ")]
    time.sleep(1)
    cands = []
    if good:
        info = api({"action": "query", "titles": "|".join(good[:10]), "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": 500})
        for p in info.get("query", {}).get("pages", {}).values():
            ii = (p.get("imageinfo") or [{}])[0]
            md = ii.get("extmetadata", {})
            lic = re.sub(r"<[^>]+>", "", md.get("LicenseShortName", {}).get("value", "")).strip()
            author = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", ""))).strip()
            if FREE.match(lic):
                cands.append({"title": p["title"], "thumb": ii.get("thumburl"), "license": lic, "author": author[:80]})
        time.sleep(1)
    out[i] = cands
    print(i, "|", core, "|", len(titles), "results,", len(cands), "free candidates", flush=True)
(HERE / "commons_candidates.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
