"""Official Samsung specs for models whose samsung.com/my spec pages render in the browser: the same spec API those
pages call (searchapi.samsung.com .../b2c/product/spec/detail), queried with the Malaysian (XME) model codes listed
in Samsung Malaysia's support sitemap. Output: cache/samsung_api/<id>.json (raw), samsung_api_extract.json."""
import json, re, time, urllib.request
from pathlib import Path
from extract import extract_lines

UA = {"User-Agent": "Mozilla/5.0 TechComparisonHub/6.0 (research)"}
OUT = Path("cache/samsung_api"); OUT.mkdir(parents=True, exist_ok=True)
cat = {d["id"]: d for d in json.load(open("catalog_samsung.json", encoding="utf-8"))}
codes = json.load(open("samsung_support_codes.json"))
for k, v in json.load(open("samsung_codes.json")).items():
    if v.get("codes"): codes[k] = sorted(set(codes.get(k, [])) | set(v["codes"]))
PREFIX = {"samsung-galaxy-s24": "SM-S921", "samsung-galaxy-s24-ultra": "SM-S928", "samsung-galaxy-z-fold6": "SM-F956", "samsung-galaxy-z-flip6": "SM-F741",
          "samsung-galaxy-z-fold7": "SM-F966", "samsung-galaxy-z-flip7": "SM-F766", "samsung-galaxy-z-flip7-fe": "SM-F761"}
result = {}
for did, cs in codes.items():
    cs = [c for c in cs if c.endswith("XME") and (did not in PREFIX or c.startswith(PREFIX[did]))][:25]
    if not cs: continue
    f = OUT / f"{did}.json"
    if not f.exists():
        time.sleep(1.5)
        url = "https://searchapi.samsung.com/v6/front/b2c/product/spec/detail?siteCode=my&specAnnotationYN=Y&modelList=" + ",".join(cs)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
            f.write_bytes(r.read())
    data = json.loads(f.read_text(encoding="utf-8"))
    models = [m for m in data["response"]["resultData"]["modelList"] if m["spec"]["specItems"]]
    if not models: print(did, "NO SPEC"); continue
    rams, roms = set(), set()
    lines = []
    for i, m in enumerate(models):
        for it in m["spec"]["specItems"]:
            if i == 0:
                lines.append(it["attrName"] if it["attrValue"] is None else f'{it["attrName"]} | {it["attrValue"]}')
            for a in it["attrs"] or []:
                v = (a["attrValue"] or "").replace("\t", " ")
                if i == 0: lines.append(f'{a["attrName"]} | {v}')
                if a["attrName"] == "Memory_(GB)" and re.fullmatch(r"\d{1,2}", v.strip()): rams.add(int(v))
                if a["attrName"] == "Storage (GB)":
                    mm = re.fullmatch(r"(\d{2,4})", v.strip())
                    if mm: roms.add(int(mm.group(1)))
                    elif re.fullmatch(r"1\s*TB|1024", v.strip()): roms.add(1024)
    c = cat[did]["category"]
    specs = extract_lines(lines, c)
    if c == "smartphone" and (rams or roms):
        specs["memory"] = {k: sorted(v) for k, v in (("ram_gb", rams), ("storage_gb", roms)) if v}
    (OUT / f"{did}.txt").write_text("\n".join(lines), encoding="utf-8")
    result[did] = {"specs": specs, "codes": [m["modelCode"] for m in models]}
    print(did, len(models), json.dumps(specs, ensure_ascii=False)[:260], flush=True)
Path("samsung_api_extract.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
print(len(result))
