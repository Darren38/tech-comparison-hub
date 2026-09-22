"""Check that recorded core values (battery mAh, weight, screen size) actually appear on the official page they cite."""
import json, re, collections
from pathlib import Path
import sys; sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "v6-import"))
from extract import text_of

HERE = Path(__file__).parent
V7 = Path(__file__).resolve().parents[2]
BRANDS = ["samsung", "apple", "oppo", "honor", "huawei", "vivo", "xiaomi"]
index = {b: json.loads((HERE / f"cache/spec_{b}/_index.json").read_text(encoding="utf-8")) for b in BRANDS}
brand_of = {}
for b in BRANDS:
    for dv in json.loads((HERE / f"catalog_{b}.json").read_text(encoding="utf-8")):
        brand_of[dv["id"]] = b


def page(did):
    b = brand_of.get(did)
    if not b:
        return None
    f = HERE / f"cache/spec_{b}/{did}.html"
    if f.exists() and index[b].get(did, {}).get("ok"):
        return "\n".join(text_of(f.read_text(encoding="utf-8", errors="replace")))
    for alt in (HERE / f"cache/spec_alt/{did}.html", HERE / f"cache/wayback/{did}.html"):
        if alt.exists():
            return "\n".join(text_of(alt.read_text(encoding="utf-8", errors="replace")))
    for api in (HERE / f"cache/samsung_api/{did}.json", HERE / f"cache/samsung_api/mem-{did}.json"):
        if api.exists():
            return api.read_text(encoding="utf-8")
    return None


def mah_values(t):
    return {int(m.group(1).replace(",", "").replace(" ", "")) for m in re.finditer(r"(\d[\d, ]{2,5}\d)\s*mAh", t)} | \
           {int(m.group(1)) for m in re.finditer(r"Battery Capacity \(mAh, Typical\)[^\d]{0,20}(\d{3,5})", t)}


issues = collections.defaultdict(list)
checked = collections.Counter()
for path in sorted((V7 / "data/devices/smartphone").glob("*.json")):
    d = json.loads(path.read_text(encoding="utf-8"))
    t = page(d["id"])
    if not t:
        continue
    s = d["specs"]
    mah = s.get("battery", {}).get("capacity_mah")
    if mah:
        vals = mah_values(t)
        checked["battery"] += 1
        if vals and mah not in vals and not any(abs(v - mah) <= 10 for v in vals):
            issues[d["id"]].append(f"battery {mah} mAh not on page (page has {sorted(vals)[:6]})")
    w = s.get("build", {}).get("weight_g")
    if w:
        ws = {float(m.group(1)) for m in re.finditer(r"(\d{3}(?:\.\d{1,2})?)\s*(?:g|grams)\b", t)} | {float(m.group(1)) for m in re.finditer(r"Weight \(g\)[^\d]{0,20}(\d{3}(?:\.\d)?)", t)}
        checked["weight"] += 1
        if ws and not any(abs(x - w) < 0.6 for x in ws):
            issues[d["id"]].append(f"weight {w} g not on page (page has {sorted(ws)[:6]})")
    size = s.get("display", {}).get("size_in")
    if size:
        ss = {float(m.group(1)) for m in re.finditer(r"(\d{1,2}\.\d{1,2})\s*(?:-?\s*inch(?:es)?|\"|”|″|'')", t)}
        checked["size"] += 1
        if ss and not any(abs(x - size) < 0.015 for x in ss):
            issues[d["id"]].append(f"screen {size} in not on page (page has {sorted(ss)[:6]})")

print(dict(checked))
print(len(issues), "devices with a value not found on their page")
for k, v in issues.items():
    print(f"  {k}: " + "; ".join(v))
