"""Samsung: core specs from Samsung's own Malaysian spec data (the API behind samsung.com/my spec pages).

Fills missing core fields and corrects recorded values that disagree with Samsung's data (for example a battery
figure picked up from a neighbouring model on a spec page). Every correction is printed for the QA log.
Run with --dry to only report.
"""
import json, re, sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).parent
V7 = Path(__file__).resolve().parents[2]
DRY = "--dry" in sys.argv
TODAY = "2026-09-19"


def attrs(data):
    out = {}
    def walk(o):
        if isinstance(o, dict):
            if "attrName" in o and o.get("attrValue") not in (None, "") and o["attrName"] not in out:
                out[o["attrName"]] = str(o["attrValue"]).strip()
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(data)
    return out


def num(s):
    m = re.search(r"\d+(?:\.\d+)?", s or "")
    return float(m.group(0)) if m else None


def core(a, category):
    c = {}
    t = a.get("Technology (Main Display)") or a.get("Technology")
    if t:
        c["display.type"] = t
    r = a.get("Max Refresh Rate (Main Display)") or a.get("Max Refresh Rate")
    if r and num(r):
        c["display.refresh_hz"] = int(num(r))
    size = a.get("Size (Main Display)") or a.get("Size")
    m = re.search(r'(\d{1,2}\.\d{1,2})\s*"', size or "")
    if m and category == "smartphone":
        c["display.size_in"] = float(m.group(1))
    res = a.get("Resolution (Main Display)") or a.get("Resolution")
    m = re.match(r"\s*(\d{3,4})\s*x\s*(\d{3,4})", res or "")
    if m:
        c["display.resolution"] = f"{m.group(1)} × {m.group(2)}"
    dim = a.get("Dimension (HxWxD, mm)")
    if dim:
        nums = re.findall(r"\d+(?:\.\d+)?", dim)
        if len(nums) == 3 and not re.search(r"fold|unfold", dim, re.I):
            c["build.dimensions"] = {"height_mm": float(nums[0]), "width_mm": float(nums[1]), "depth_mm": float(nums[2])}
    w = num(a.get("Weight (g)"))
    if w:
        c["build.weight_g"] = w
    cap = num(a.get("Battery Capacity (mAh, Typical)"))
    if cap:
        c["battery.capacity_mah"] = int(cap)
    v = num(a.get("Video Playback Time (Hours)"))
    if v and category == "smartphone":
        c["battery.video_h"] = int(v) if float(v).is_integer() else v
    until = a.get("Security Update Period (Valid until)")
    if until:
        try:
            from datetime import datetime
            d = datetime.strptime(until, "%d %B %Y").date()
            c["software.security_until"] = d.isoformat()
        except ValueError:
            pass
    return c


def get(d, path):
    for k in path.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def put(d, path, value):
    keys = path.split(".")
    for k in keys[:-1]:
        d = d.setdefault(k, {})
    d[keys[-1]] = value


def differs(old, new):
    if isinstance(new, dict):
        return any(differs(old.get(k) if isinstance(old, dict) else None, v) for k, v in new.items())
    if isinstance(new, (int, float)) and isinstance(old, (int, float)):
        return abs(old - new) > max(0.051, abs(new) * 0.002)
    if isinstance(new, str) and isinstance(old, str):
        return new.replace(" ", "").lower() != old.replace(" ", "").lower()
    return old != new


# fields where a disagreement is corrected (Samsung's data wins); others are only filled when empty
CORRECT = {"battery.capacity_mah", "build.weight_g", "build.dimensions", "display.refresh_hz", "display.size_in"}
codes = json.loads((HERE / "samsung_support_codes.json").read_text(encoding="utf-8"))
fixes, fills = [], 0
for path in sorted((V7 / "data/devices").glob("*/samsung-*.json")):
    dev = json.loads(path.read_text(encoding="utf-8"))
    did = dev["id"]
    src = next((f for f in (HERE / f"cache/samsung_api/{did}.json", HERE / f"cache/samsung_api/mem-{did}.json") if f.exists()), None)
    if not src:
        continue
    c = core(attrs(json.loads(src.read_text(encoding="utf-8"))), dev["category"])
    specs = dev.setdefault("specs", {})
    prov = dev["provenance"]
    default_official = prov["default"].get("class") == "official" and prov["default"].get("source") == "samsung"
    code = (codes.get(did) or [None])[0]
    ref = None if default_official else {"class": "official", "source": "samsung", "url": f"https://www.samsung.com/my/support/model/{code}/" if code else prov["default"].get("url"),
                                         "checked": TODAY, "note": "Samsung's own specification data for the Malaysian model."}
    changed = []
    # security updates: store the end date Samsung gives and the years it covers from launch
    until = c.pop("software.security_until", None)
    if until and not get(specs, "software.security_updates_years"):
        start = str(dev.get("released") or dev.get("announced") or "")
        if re.match(r"\d{4}-\d{2}", start):
            y0, m0 = int(start[:4]), int(start[5:7])
            months = (int(until[:4]) - y0) * 12 + int(until[5:7]) - m0
            years = round(months / 12)
            if 1 <= years <= 10:
                put(specs, "software.security_updates_years", years)
                put(specs, "software.security_until", until)
                changed += ["software.security_updates_years", "software.security_until"]
    for k, v in c.items():
        old = get(specs, k)
        if old in (None, "", [], {}):
            put(specs, k, v); changed.append(k); fills += 1
        elif k in CORRECT and differs(old, v):
            fixes.append((did, k, old, v))
            put(specs, k, v); changed.append(k)
    if not changed:
        continue
    fields = prov.setdefault("fields", {})
    for k in changed:
        full = f"specs.{k}"
        if ref:
            fields[full] = ref
        else:
            # a broader override (e.g. specs.build from a news report) must not claim Samsung's value
            parts = full.split(".")
            if any(".".join(parts[:n]) in fields for n in range(1, len(parts))) and full not in fields:
                fields[full] = dict(prov["default"])
    if not DRY:
        path.write_text(json.dumps(dev, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

print(f"filled {fills} empty fields")
print(f"{len(fixes)} corrections:")
for did, k, old, new in fixes:
    print(f"  {did:32} {k:22} {old!r} -> {new!r}")
