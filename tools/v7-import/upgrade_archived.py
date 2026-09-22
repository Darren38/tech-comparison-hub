"""Devices whose official page is gone: where a recorded core value also appears on the archived copy of the maker's
page, cite that page (class official, archived) for the value. Values not found there keep their news source."""
import json, re, sys
from pathlib import Path
import sys; sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "v6-import"))
from extract import text_of

HERE = Path(__file__).parent
V7 = Path(__file__).resolve().parents[2]
TODAY = "2026-09-19"
DRY = "--dry" in sys.argv
wb = json.loads((HERE / "cache/wayback/_index.json").read_text(encoding="utf-8"))
sources = {s["id"] for s in json.loads((V7 / "data/sources/sources.json").read_text(encoding="utf-8"))}


def has_num(t, v, unit_re):
    s = f"{v:g}" if isinstance(v, float) else str(v)
    forms = {s, f"{int(v):,}" if float(v).is_integer() else s}
    return any(re.search(r"(?<![\d.,])" + re.escape(f) + r"\s*" + unit_re, t, re.I) for f in forms)


def checks(specs, t, chip_name):
    out = []
    g = lambda p: p.split(".") and __import__("functools").reduce(lambda o, k: o.get(k) if isinstance(o, dict) else None, p.split("."), specs)
    v = g("battery.capacity_mah")
    if v and has_num(t, v, r"mAh"):
        out.append("battery.capacity_mah")
    v = g("build.weight_g")
    if v and has_num(t, v, r"(g|grams)\b"):
        out.append("build.weight_g")
    v = g("display.size_in")
    if v and has_num(t, v, r"(-?\s*inch|\"|”|″)"):
        out.append("display.size_in")
    v = g("display.refresh_hz")
    if v and has_num(t, v, r"Hz"):
        out.append("display.refresh_hz")
    v = g("charging.wired_w")
    if v and has_num(t, v, r"W\b"):
        out.append("charging.wired_w")
    d = g("build.dimensions")
    if d and all(x and re.search(r"(?<![\d.])" + re.escape(f"{x:g}") + r"(?![\d])", t) for x in (d.get("height_mm"), d.get("width_mm"), d.get("depth_mm"))):
        out.append("build.dimensions")
    v = g("display.resolution")
    if v:
        nums = re.findall(r"\d{3,4}", v)
        if nums and all(re.search(r"(?<!\d)" + n + r"(?!\d)", t) for n in nums):
            out.append("display.resolution")
    rear = g("camera.rear") or []
    if rear and all(c.get("mp") and has_num(t, c["mp"], r"(MP|megapixel)") for c in rear):
        out.append("camera.rear")
    for p, unit in (("memory.ram_gb", "GB"), ("memory.storage_gb", "(GB|TB)")):
        vals = g(p) or []
        if vals and all(has_num(t, x if x < 1024 else x // 1024, unit) for x in vals):
            out.append(p)
    if chip_name and re.search(re.escape(chip_name), t, re.I):
        out.append("platform.chipset")
    v = g("display.type")
    if v and v.lower() in t.lower():
        out.append("display.type")
    v = g("software.launch_os")
    if v and v.lower() in t.lower():
        out.append("software.launch_os")
    return out


chips = {p.stem: json.loads(p.read_text(encoding="utf-8")).get("name") for p in (V7 / "data/chipsets").glob("*.json")}
total = 0
for i, w in wb.items():
    if not w.get("ok"):
        continue
    path = next((V7 / "data/devices").glob(f"*/{i}.json"), None)
    if not path:
        continue
    dev = json.loads(path.read_text(encoding="utf-8"))
    if dev["provenance"]["default"].get("class") == "official":
        continue
    t = "\n".join(text_of((HERE / f"cache/wayback/{i}.html").read_text(encoding="utf-8", errors="replace")))
    specs = dev.get("specs", {})
    ok = checks(specs, t, chips.get(specs.get("platform", {}).get("chipset")))
    ts = w["timestamp"]
    src = dev["brand"] if dev["brand"] in sources else "huawei"
    ref = {"class": "official", "source": src, "url": w["capture"], "checked": TODAY,
           "note": f"Matches the maker's own specification page ({w['original']}), which is no longer online; checked against the Internet Archive copy captured {ts[:4]}-{ts[4:6]}-{ts[6:8]}."}
    fields = dev["provenance"].setdefault("fields", {})
    for p in ok:
        fields[f"specs.{p}"] = ref
    total += len(ok)
    print(f"{i:28} {len(ok):2} verified: {', '.join(ok)}")
    if not DRY and ok:
        path.write_text(json.dumps(dev, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("values upgraded to official (archived):", total)
