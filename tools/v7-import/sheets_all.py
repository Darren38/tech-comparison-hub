"""Full spec sheets for every catalogue device with an official source: sheets.json {id: {"fields": {...}, "source": url}}."""
import json, collections, sys
from pathlib import Path
import sys; sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "v6-import"))
from extract import text_of
from sheet import sheet_from_lines, apple_sheet, samsung_sheet

BRANDS = ["samsung", "apple", "oppo", "honor", "huawei", "vivo", "xiaomi"]
out = {}
for b in BRANDS:
    cat = json.loads(Path(f"catalog_{b}.json").read_text(encoding="utf-8"))
    idx = json.loads(Path(f"cache/spec_{b}/_index.json").read_text(encoding="utf-8"))
    for dv in cat:
        did, c = dv["id"], dv["category"]
        res, src = None, None
        if b == "samsung":
            for f in (Path(f"cache/samsung_api/{did}.json"), Path(f"cache/samsung_api/mem-{did}.json")):
                if f.exists():
                    res = samsung_sheet(json.loads(f.read_text(encoding="utf-8")), c); src = "samsung-api"; break
        if not res:
            for f in (Path(f"cache/spec_{b}/{did}.html"), Path(f"cache/spec_alt/{did}.html"), Path(f"cache/wayback/{did}.html")):
                ok = f.exists() and (f.parent.name != f"spec_{b}" or idx.get(did, {}).get("ok"))
                if ok:
                    lines = text_of(f.read_text(encoding="utf-8", errors="replace"))
                    res = apple_sheet(lines) if b == "apple" else sheet_from_lines(lines, c, b); src = f.parent.name; break
        if res: out[did] = {"fields": res, "via": src, "category": c, "brand": dv["brand"]}
Path("sheets.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
cnt = collections.Counter(); per = collections.Counter()
phones = [v for v in out.values() if v["category"] == "smartphone"]
for v in phones:
    for k in v["fields"]: cnt[k] += 1
print(len(out), "devices with a sheet;", len(phones), "phones")
for k, n in cnt.most_common(): print(f"  {k:28} {n:4} ({n * 100 // max(1, len(phones))}%)")
