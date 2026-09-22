"""Merge the full official spec sheets (sheets.json) into the Version 7 device files.

Only empty fields are filled; nothing already recorded is changed. Each added value points at the page it was read
from: when the device's default source is that same official page nothing extra is needed, otherwise a field-level
provenance override is written (for archived pages: class official, linked to the Internet Archive copy).
Also derives a few core fields from the same page when they are missing: charging watts from the charging line,
optical zoom from the camera features, main-camera sensor/aperture/OIS, IP rating and claimed peak brightness.
"""
import json, re, sys, collections
from pathlib import Path
import sys; sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "v6-import"))
from extract import text_of

HERE = Path(__file__).parent
V7 = Path(__file__).resolve().parents[2]
TODAY = "2026-09-19"
BRANDS = ["samsung", "apple", "oppo", "honor", "huawei", "vivo", "xiaomi"]
DRY = "--dry" in sys.argv
SHOW = {"charging.wired_w", "charging.wireless_w", "charging.reverse_w", "camera.zoom_optical_x", "build.ip", "display.peak_nits", "connectivity.nfc", "connectivity.uwb"}

sheets = json.loads((HERE / "sheets.json").read_text(encoding="utf-8"))
wayback = json.loads((HERE / "cache/wayback/_index.json").read_text(encoding="utf-8"))
index = {b: json.loads((HERE / f"cache/spec_{b}/_index.json").read_text(encoding="utf-8")) for b in BRANDS}
codes = json.loads((HERE / "samsung_support_codes.json").read_text(encoding="utf-8"))
sources = {s["id"] for s in json.loads((V7 / "data/sources/sources.json").read_text(encoding="utf-8"))}
catalog_brand = {}
for b in BRANDS:
    for dv in json.loads((HERE / f"catalog_{b}.json").read_text(encoding="utf-8")):
        catalog_brand[dv["id"]] = b


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


def empty(v):
    return v is None or v == "" or v == [] or v == {}


def effective(prov, path):
    """Provenance that applies to a dotted path: the longest matching override, else the default."""
    fields = prov.get("fields", {})
    parts = path.split(".")
    for n in range(len(parts), 0, -1):
        p = ".".join(parts[:n])
        if p in fields:
            return fields[p]
    return prov["default"]


def page_text(did, via, brand):
    if via == "samsung-api":
        for f in (HERE / f"cache/samsung_api/{did}.json", HERE / f"cache/samsung_api/mem-{did}.json"):
            if f.exists():
                return f.read_text(encoding="utf-8")
        return ""
    folder = {"spec_alt": "spec_alt", "wayback": "wayback"}.get(via, via)
    f = HERE / f"cache/{folder}/{did}.html"
    return "\n".join(text_of(f.read_text(encoding="utf-8", errors="replace"))) if f.exists() else ""


def page_ref(dev, did, via, brand):
    """Provenance record for the page the sheet was read from, or None when it can't be linked."""
    src = dev["brand"] if dev["brand"] in sources else brand
    default = dev["provenance"]["default"]
    if via == "wayback":
        w = wayback[did]
        ts = w["timestamp"]
        return {"class": "official", "source": src, "url": w["capture"], "checked": TODAY,
                "note": f"The maker's own specification page ({w['original']}) is no longer online; read from the Internet Archive copy captured {ts[:4]}-{ts[4:6]}-{ts[6:8]}."}
    if default.get("class") == "official":
        return None  # the default source already is this official page
    if via == "samsung-api":
        code = (codes.get(did) or [None])[0]
        url = f"https://www.samsung.com/my/support/model/{code}/" if code else None
    elif via.startswith("spec_") and via != "spec_alt":
        i = index[brand].get(did, {})
        url = i.get("final") or i.get("url")
    else:
        url = None
    if not url:
        return False
    return {"class": "official", "source": src, "url": url, "checked": TODAY,
            "note": f"Read from the maker's specification page on {TODAY}."}


# ------------------------------------------------------------------ value clean-up and derived fields
def split_modules(mods):
    out = []
    for m in mods:
        parts = [m]
        if re.search(r"\)\s*\+|\s\+\s", m):
            cand = [p.strip() for p in re.split(r"\s*\+\s*", m) if p.strip()]
            if len(cand) > 1 and all(re.search(r"camera|\d\s*MP|lens", p, re.I) for p in cand):
                parts = cand
        more = []
        for p in parts:
            more += [x.strip() for x in re.split(r",\s*(?=Leica \d+(?:-\d+)?mm )", p) if x.strip()]
        out += more
    return out


def clean_claim(t):
    parts = [p.strip() for p in t.split(";") if p.strip() and not p.strip().startswith("*")]
    parts = [p for p in parts if not re.match(r"^(material|2\.5d|plastic)", p, re.I)]
    s = "; ".join(dict.fromkeys(parts))
    return s[:180].rstrip(" ,;") if s else None


def watts(claim, kind):
    """Charging power stated in the charging line. Wired: the highest figure (protocol lists come after the headline);
    HONOR-style "up to 11V/3.2A" is converted; bare protocol voltages ("PD2.0 (9V/1.5A)") are not a charging claim."""
    best = None
    for p in re.split(r"[;,]", claim):
        is_wl, is_rev = bool(re.search(r"wireless", p, re.I)), bool(re.search(r"reverse", p, re.I))
        if kind == "wired" and (is_wl or is_rev):
            continue
        if kind == "wireless" and (not is_wl or is_rev):
            continue
        if kind == "reverse" and not is_rev:
            continue
        if re.search(r"adapter|charger", p, re.I) and not re.search(r"charging|charge\b", re.sub(r"adapter|charger", "", p, flags=re.I), re.I):
            continue  # "45W In-box charger" describes the charger, not the phone
        for m in re.finditer(r"(\d{1,3}(?:\.\d)?)\s*W\b", p):
            v = float(m.group(1))
            if 5 <= v <= 300:
                best = max(best or 0, v)
        if kind == "wired" and best is None:
            m = re.search(r"up to\s*(\d{1,2}(?:\.\d+)?)\s*V\s*/\s*(\d{1,2}(?:\.\d+)?)\s*A", p, re.I)
            if m:
                best = round(float(m.group(1)) * float(m.group(2)))
        if kind != "wired" and best is not None:
            break
    if best is None:
        return None
    return int(best) if float(best).is_integer() else best


def optical_zoom(features, mods):
    """Optical zoom of a real telephoto lens. Sensor-crop zoom ("optical-quality", "enabled by quad-pixel sensor"),
    zoom-out and zoom-range figures don't count."""
    best = None
    texts = [features or ""] + [m for m in (mods or []) if not re.search(r"enabled by|optical[- ]quality|also enables", m, re.I)]
    for t in texts:
        for m in re.finditer(r"(?<!quality )(?<!-)optical zoom\s*(?:of\s*|up to\s*)?(\d{1,2}(?:\.\d)?)\s*x|(\d{1,2}(?:\.\d)?)\s*x\s*optical zoom(?! out| range)|(\d{1,2}(?:\.\d)?)x Telephoto|Telephoto: \d+\s*mm \((\d{1,2}(?:\.\d)?)x\)", t, re.I):
            v = float(next(g for g in m.groups() if g))
            if 1.5 <= v <= 10:
                best = max(best or 0, v)
    return (int(best) if best and best.is_integer() else best) if best else None


def main_module_detail(mods):
    for m in mods:
        if re.search(r"ultra[- ]?wide|macro|depth|telephoto|periscope|mono", m.split(",")[0], re.I):
            continue
        return m
    return None


def sensor_of(t):
    m = re.search(r"\b1\s*/\s*(\d(?:\.\d+)?)\s*(?:\"|”|″|''|-inch|\s?inch|\s?-?type)", t)
    if m:
        return f'1/{m.group(1)}"'
    if re.search(r"\b1(?:\"|”|″|-inch| inch)\s*(?:sensor|type|image)", t, re.I):
        return '1"'
    return None


IP_RE = re.compile(r"\bIP(6[4-9]|5[2-4]|X[4-8])(K?)\b")
NITS_RE = re.compile(r"\b(\d{1,2},\d{3}|\d{3,4})\s*nits\b", re.I)


def ip_of(text):
    found = []
    for m in IP_RE.finditer(text):
        v = f"IP{m.group(1)}{m.group(2)}"
        if v not in found:
            found.append(v)
    if not found:
        return None
    found.sort(key=lambda s: (s[2] != "X", s))
    return " / ".join(found[:3])


def nits_of(text):
    vals = [int(m.group(1).replace(",", "")) for m in NITS_RE.finditer(text)]
    vals = [v for v in vals if 300 <= v <= 8000]
    return max(vals) if vals else None


# ------------------------------------------------------------------ merge
BOOL_FIELDS = {"audio.jack", "connectivity.nfc", "connectivity.uwb"}
stats = collections.Counter()
per_device = {}
for path in sorted((V7 / "data/devices").glob("*/*.json")):
    dev = json.loads(path.read_text(encoding="utf-8"))
    did = dev["id"]
    sh = sheets.get(did)
    if not sh:
        continue
    brand = catalog_brand.get(did, sh.get("brand"))
    ref = page_ref(dev, did, sh["via"], brand)
    if ref is False:
        stats["skipped: no linkable page"] += 1
        continue
    specs = dev.setdefault("specs", {})
    prov = dev["provenance"]
    added = []

    def add(p, v):
        if empty(v) or not empty(get(specs, p)):
            return
        put(specs, p, v)
        added.append(p)
        if DRY and p in SHOW:
            print(f"  {did:34} {p:22} {v!r}"[:170])
        stats[p] += 1

    f = dict(sh["fields"])
    if f.get("camera.rear_detail"):
        f["camera.rear_detail"] = split_modules(f["camera.rear_detail"])
    if f.get("camera.front_detail"):
        f["camera.front_detail"] = split_modules(f["camera.front_detail"])
    if f.get("charging.claim"):
        f["charging.claim"] = clean_claim(f["charging.claim"])
    for k, v in f.items():
        if k in BOOL_FIELDS and not isinstance(v, bool):
            continue
        # the legacy yes/no field already answers the card question
        if k == "memory.card" and isinstance(get(specs, "memory.expandable"), bool):
            continue
        add(k, v)

    phone = dev["category"] == "smartphone"
    claim = f.get("charging.claim") or ""
    if phone and claim:
        if brand != "apple":  # Apple's charging line names adapter ratings ("with 20W adapter or higher"), not the phone's power
            add("charging.wired_w", watts(claim, "wired"))
        add("charging.wireless_w", watts(claim, "wireless"))
        add("charging.reverse_w", watts(claim, "reverse"))
    if phone:
        add("camera.zoom_optical_x", optical_zoom(None if brand == "apple" else f.get("camera.features"), f.get("camera.rear_detail")))  # Apple lists sensor-crop zoom as "optical zoom in"
        # main camera sensor size / aperture / OIS, when the module's megapixels match the recorded main camera
        mods = f.get("camera.rear_detail") or []
        det = main_module_detail(mods)
        rear = specs.get("camera", {}).get("rear") or []
        main = next((c for c in rear if c.get("role") == "main"), None)
        if det and main and ref is None:  # only when the module list itself came from this same page
            mp = re.search(r"(\d{1,3}(?:\.\d)?)\s*MP", det, re.I)
            if mp and main.get("mp") and abs(float(mp.group(1)) - float(main["mp"])) < 0.6:
                sensor = sensor_of(det)
                ap = re.search(r"[fƒ]\s*/\s*(\d(?:\.\d{1,2})?)", det)
                changed = False
                if sensor and not main.get("sensor"):
                    main["sensor"] = sensor; changed = True
                if ap and not main.get("aperture"):
                    main["aperture"] = f"f/{ap.group(1)}"; changed = True
                if re.search(r"\bOIS\b", det) and "ois" not in main:
                    main["ois"] = True; changed = True
                if changed:
                    added.append("camera.rear")
                    stats["camera.rear main details"] += 1
        text = page_text(did, sh["via"], brand)
        add("build.ip", ip_of(text))
        add("display.peak_nits", nits_of(text))

    if not added:
        continue
    if ref:
        fields = prov.setdefault("fields", {})
        for p in sorted(set(added)):
            full = f"specs.{p}"
            eff = effective(prov, full)
            if eff.get("url") != ref["url"] or eff.get("class") != ref["class"]:
                fields[full] = ref
    else:
        # default is the official page: make sure no broader override (e.g. specs.platform from a news report) captures the new field
        fields = prov.get("fields", {})
        for p in sorted(set(added)):
            full = f"specs.{p}"
            eff = effective(prov, full)
            if eff is not prov["default"] and full not in fields:
                fields[full] = dict(prov["default"])
    per_device[did] = len(set(added))
    stats["devices updated"] += 1
    if not DRY:
        path.write_text(json.dumps(dev, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

for k, v in stats.most_common():
    print(f"{k:34} {v}")
print("median fields added:", sorted(per_device.values())[len(per_device) // 2] if per_device else 0)
