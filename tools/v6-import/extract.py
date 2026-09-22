"""Extract core specifications from an official spec page (cached HTML) into the Tech Comparison Hub schema.

Deterministic regex extraction over the page text; every value is read from the page. Anything not found is
left out (the site shows "Not recorded"). Output is reviewed before it is written into data/devices.
"""
import re, json, sys, html
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from pagetext import to_text

NUM = r"(\d{1,3}(?:[.,]\d{1,3})?)"


def text_of(html_str):
    # Non-breaking hyphens/spaces (Apple writes "6.1‑inch") become plain characters.
    html_str = html_str.replace("‑", "-").replace("‐", "-").replace("&#8209;", "-").replace(" ", " ")
    # HONOR keeps each spec value in a data-value attribute of an empty element; turn it into text.
    html_str = re.sub(r'<div[^>]*\bdata-value="([^"]*)"[^>]*>', lambda m: "<div>" + html.unescape(m.group(1)) + " ", html_str)
    lines = [l.replace("‑", "-").replace("‐", "-").replace(" ", " ") for l in to_text(html_str)]
    # Cut navigation/footers: start at the first spec-looking heading, end at typical footer markers.
    start = 0
    for i, l in enumerate(lines):
        if re.fullmatch(r"(Specifications?|Specs|Dimensions?|Size and Weight|Capacity|Dimension|Tech Specs|Height|Appearance|Physical Dimensions?)(\s*\d)?", l, re.I):
            start = i; break
    end = len(lines)
    for i in range(start + 20, len(lines)):
        if re.match(r"(Copyright|©|\* ?All specifications|Footnotes?|Disclaimer|Legal)", lines[i], re.I) and i > start + 40:
            end = i; break
    return lines[start:end]


def f(v):
    return float(v.replace(",", "")) if v is not None else None


def first(pattern, text, flags=re.I, group=1):
    m = re.search(pattern, text, flags)
    return m.group(group) if m else None


def section(lines, head_pat, stop_pat=None, maxlen=60):
    """Lines after the first heading matching head_pat, up to the next major heading."""
    heads = r"^(Display|Screen|Camera|Rear Camera|Front Camera|Battery|Charging|Power|Processor|Chip|Platform|Performance|Memory|Storage|Operating System|Software|OS|Network|Connectivity|Sensors?|Audio|Dimensions?|Weight|Size|Navigation|Durability|Design|In the Box|Package|Video|Colou?rs?|Biometrics|Buttons?)\b"
    for i, l in enumerate(lines):
        if re.match(head_pat, l, re.I) and len(l) < 40:
            out = []
            for l2 in lines[i + 1:i + 1 + maxlen]:
                if re.match(stop_pat or heads, l2, re.I) and len(l2) < 40 and not re.match(head_pat, l2, re.I):
                    break
                out.append(l2)
            return out
    return []


CHIP_PATTERNS = [
    r"Snapdragon\s*(?:®|™)?\s*(?:8\s*Elite(?:\s*Gen\s*\d)?|\d\+?\s*s?\s*(?:4G\s*)?Gen\s*\d\+?|\d{3}\+?|W5\+?\s*Gen\s*\d|W5|Wear\s*Elite)(?:\s*(?:for Galaxy|Leading Version|Accelerated Edition))?",
    r"Dimensity\s*(?:™)?\s*\d{3,4}\+?(?:\s*(?:Ultra|Ultimate|Energy|Turbo|Pro|Max|5G|-Ultra|-Turbo|e))?",
    r"Helio\s*[A-Z]\d{2,3}(?:\s*(?:Ultra|5G))?",
    r"Exynos\s*(?:W)?\d{3,4}",
    r"Kirin\s*(?:A)?\d{3,4}[A-Z]?(?:\s*Pro)?",
    r"Tensor\s*G\d",
    r"(?:Apple\s*)?A\d{2}\s*(?:Pro|Bionic)?\s*chip",
    r"\bS\d{1,2}\s*SiP",
    r"Unisoc\s*(?:T|SC)\d{3,4}",
    r"(?:MediaTek\s*)?(?:MT\d{4}|Dimensity\s*\d{3,4})",
    r"BES\d{4}\w*", r"Snapdragon\s*W5\+?\s*Gen\s*\d", r"Snapdragon\s*Wear\s*\w+",
]


def chipset(text):
    t = text.replace("™", "").replace("®", "")
    t = re.sub(r"(Snapdragon|Dimensity|Helio|Exynos|Kirin)(?=\d)", r"\1 ", t)
    for p in CHIP_PATTERNS:
        m = re.search(p, t, re.I)
        if m:
            s = re.sub(r"\s+", " ", m.group(0)).strip()
            s = re.sub(r"\s*(Mobile Platform|5G)$", "", s, flags=re.I)
            return s
    return None


def dims(text):
    # Samsung: "Dimension (HxWxD, mm) | 161.5 x 76.8 x 6.9"
    m = re.search(r"Dimension \(HxWxD, mm\)\s*\|\s*(\d{2,3}(?:\.\d+)?)\s*x\s*(\d{2,3}(?:\.\d+)?)\s*x\s*(\d{1,2}(?:\.\d+)?)\b", text)
    if m:
        a, b, c = map(float, m.groups())
        return {"height_mm": a, "width_mm": b, "depth_mm": c}
    # "164.16 × 74.93 × 7.58 mm" or Height/Width/Thickness|Depth lines
    m = re.search(r"(\d{2,3}\.\d{1,2})\s*(?:mm)?\s*[x×\*]\s*(\d{2,3}\.\d{1,2})\s*(?:mm)?\s*[x×\*]\s*(\d{1,2}\.\d{1,2})\s*mm", text)
    if m:
        a, b, c = map(float, m.groups())
        return {"height_mm": max(a, b), "width_mm": min(a, b), "depth_mm": c}
    h = first(r"Height[^0-9]{0,45}?(\d{2,3}(?:\.\d{1,2})?)\s*mm", text)
    w = first(r"Width[^0-9]{0,45}?(\d{2,3}(?:\.\d{1,2})?)\s*mm", text)
    dd = first(r"(?:Thickness|Depth)[^0-9]{0,45}?(\d{1,2}(?:\.\d{1,2})?)\s*mm", text)
    if h and w and dd:
        return {"height_mm": float(h), "width_mm": float(w), "depth_mm": float(dd)}
    return None


def weight(text):
    v = first(r"Weight \(g\)\s*\|\s*(\d{1,3}(?:\.\d+)?)\b", text)
    if v: return float(v)
    v = first(r"Weight[^0-9]{0,60}?(\d{2,3}(?:\.\d{1,2})?)\s*(?:g\b|grams)", text)
    return float(v) if v else None


def display_size(text, cat):
    if cat == "smartphone":
        # Screen sizes only (4-9 in); skip "Width: 77.8 mm (3.06 inches)". Foldables list the main screen first.
        for m in re.finditer(r"(\d{1,2}\.\d{1,3})\s*(?:-|\s)?\s*(?:inch(?:es)?|in\b|\"|″|”|'')", text):
            if 4.0 <= float(m.group(1)) < 9 and not re.search(r"(Width|Height|Depth|Thickness)[^|]{0,25}$", text[max(0, m.start() - 40):m.start()]):
                return float(m.group(1))
        return None
    v = first(r"(\d\.\d{1,2})\s*(?:-|\s)?\s*(?:inch(?:es)?|\"|″|”|'')", text)
    return float(v) if v and 0.8 < float(v) < 2.6 else None


def resolution(text):
    m = re.search(r"(\d{3,4})\s*(?:px|pixels)?\s*[x×\*]\s*(\d{3,4})\s*(?:px|pixels|resolution|\b)", text)
    if not m: return None
    a, b = int(m.group(1)), int(m.group(2))
    return f"{max(a, b)} × {min(a, b)}" if max(a, b) >= 300 else None


def refresh(text):
    # Only labelled refresh values or "... Hz refresh" phrases: never the touch sampling rate.
    vals = []
    for m in re.finditer(r"Refresh\s*Rate[^|]{0,30}\|([^|]{0,90})", text, re.I):
        vals += [int(v) for v in re.findall(r"(?<!\d)(\d{2,3})(?=\s*(?:/\s*\d{2,3}\s*)*\s*Hz)", m.group(1))]
    vals += [int(v) for v in re.findall(r"(?<!\d)(\d{2,3})\s*Hz\s*(?:adaptive\s*|dynamic\s*|high\s*|LTPO\s*|smart\s*|variable\s*)?refresh", text, re.I)]
    vals += [int(v) for v in re.findall(r"refresh rate[^|.]{0,25}?(?:of|up to|to)\s*(\d{2,3})\s*Hz", text, re.I)]
    vals = [v for v in vals if 60 <= v <= 185]
    return max(vals) if vals else None


def battery_mah(text):
    v = first(r"Battery Capacity \(mAh, Typical\)\s*\|\s*(\d{3,5})\b", text)
    if v: return int(v)
    vals =[int(v.replace(",", "")) for v in re.findall(r"(\d{1,2},?\d{3})\s*mAh", text, re.I)]
    typ = re.search(r"(\d{1,2},?\d{3})\s*mAh\s*\(?\s*(?:typical|Typ)", text, re.I)
    if typ: return int(typ.group(1).replace(",", ""))
    vals = [v for v in vals if 150 <= v <= 12000]
    return max(vals) if vals else None


def charging(text):
    text = re.sub(r"\s*(?:™|®|\bTM\b)", "", text)
    wired = []
    for m in re.finditer(r"(?:SUPERVOOC|Fast Charg\w*|FlashCharge|HyperCharge|SuperCharge|Wired Charging|Charging Power|Wired)", text, re.I):
        win = text[m.end():m.end() + 70]
        for v in re.finditer(r"(\d{2,3})\s*W\b", win):
            if "wireless" not in win[:v.start()].lower():
                wired.append(int(v.group(1)))
    wired += [int(v) for v in re.findall(r"(\d{2,3})\s*W\s*(?:SUPERVOOC|FlashCharge|HyperCharge|SuperCharge|Super Fast|Wired|fast|FastCharge|charging|\(max|max|HUAWEI SuperCharge|HONOR SuperCharge|Turbo)", text, re.I)]
    wired += [int(v) for v in re.findall(r"(?:Wired|Fast Charging|Charging|SUPERVOOC|FlashCharge|HyperCharge|SuperCharge)[^|0-9]{0,40}\|?\s*(?:up to|max(?:imum)?)?\s*(\d{2,3})\s*W\b", text, re.I)]
    wireless = [int(v) for v in re.findall(r"(\d{2,3})\s*W\s*(?:AIRVOOC|wireless|Wireless|FlashCharge Wireless|Wireless HyperCharge|Wireless SuperCharge|magnetic)", text)]
    wireless += [int(v) for v in re.findall(r"Wireless[^|0-9]{0,40}\|?\s*(?:up to|max(?:imum)?)?\s*(\d{2,3})\s*W\b", text, re.I)]
    wired = [w for w in wired if 5 <= w <= 240 and w not in wireless]
    return (max(wired) if wired else None), (max(wireless) if wireless else None)


def memory(text):
    ram, rom = set(), set()
    # Samsung product pages: one configuration per page
    r1 = first(r"Memory_?\s*\(GB\)\s*\|\s*(\d{1,2})\b", text); r2 = first(r"(?<!Available )Storage \(GB\)\s*\|\s*(\d{2,4})\b", text)
    if r1: ram.add(int(r1))
    if r2: rom.add(int(r2))
    for a, b, u in re.findall(r"(?<![\d.])(\d{1,2})\s*GB\s*(?:RAM)?\s*(?:\+|,)\s*(\d{2,4}|1|2)\s*(GB|TB)(?!\s*(?:Ultra Space|Extended|virtual))", text):
        ram.add(int(a)); rom.add(int(b) * (1024 if u == "TB" else 1))
    # Labelled values only; "Expandable/Extended RAM" is virtual memory, not the phone's RAM.
    if not ram:
        for r in re.finditer(r"(?<!Expandable )(?<!Extended )(?<!Virtual )\bRAM\b(?: Capacity)?\s*\|\s*((?:\d{1,2}\s*GB[^|]{0,20}\|?\s*)+)", text):
            ram |= {int(x) for x in re.findall(r"(\d{1,2})\s*GB", r.group(1))}
    if not rom:
        for r in re.finditer(r"(?<!Expandable )(?<!Extended )(?<!RAM )\b(?:ROM|Memory|Storage|Internal Storage|ROM Capacity|Capacity)\b\s*\d?\s*\|\s*((?:\d{2,4}\s*(?:GB|TB)[^|]{0,20}\|?\s*)+)", text):
            rom |= {int(x) * (1024 if u == "TB" else 1) for x, u in re.findall(r"(\d{1,4})\s*(GB|TB)", r.group(1))}
    ram = sorted(v for v in ram if 1 <= v <= 24); rom = sorted(v for v in rom if 16 <= v <= 2048)
    return ram or None, rom or None


def role_of(ctx):
    ctx = ctx.lower()
    return ("periscope" if "periscope" in ctx else "telephoto" if "tele" in ctx else "ultrawide" if re.search(r"ultra[- ]?wide|wide-angle|ultra wide|\buw\b", ctx) else
            "macro" if "macro" in ctx else "depth" if re.search(r"depth|bokeh|portrait lens", ctx) else "monochrome" if "mono" in ctx else
            "main" if re.search(r"main|primary|fusion|wide\b|\bwide\)", ctx) else None)


def cameras(lines):
    """Rear modules [{role, mp}] (only roles the page states; the first listed module is the main camera),
    the front camera, and the rear line as written when roles are not stated."""
    text = " | ".join(lines)
    text = re.sub(r"(?:up to|Panorama|panoramic)[^|]{0,20}?\d{2,3}\s*MP", " ", text, flags=re.I)
    front = first(r"(?:Front(?:\s*Camera)?|Selfie(?:\s*Camera)?|Front-facing Camera|TrueDepth Camera)\s*:?\s*\|?\s*(?:[^0-9|]{0,30}\|?\s*)?(\d{1,2}(?:\.\d)?)\s*MP", text)
    if front and front.endswith(".0"): front = front[:-2]
    # "Rear 50 MP + 50 MP + 2 MP Bokeh" (vivo, Samsung "Rear Camera - Resolution (Multiple)"): roles only where named
    listed = re.search(r"Rear(?:\s*Camera)?(?:\s*-\s*Resolution(?:\s*\(Multiple\))?)?\s*:?\s*\|?\s*((?:\d{1,3}(?:\.\d)?\s*MP[^|+]{0,45}\+\s*)+\d{1,3}(?:\.\d)?\s*MP[^|]{0,45})", text, re.I)
    if listed:
        parts = [p.strip() for p in listed.group(1).split("+") if re.search(r"\d\s*MP", p, re.I)]
        out = []
        for k, p in enumerate(parts):
            mp = float(re.search(r"(\d{1,3}(?:\.\d)?)\s*MP", p, re.I).group(1)); role = role_of(p) or ("main" if k == 0 else None)
            if role: out.append({"role": role, "mp": int(mp) if mp == int(mp) else mp})
        rear_text = "Rear: " + " + ".join(re.sub(r"\s+", " ", p) for p in parts)
        return out or None, (f"{front} MP" if front else None), rear_text
    # A "Rear:" block (possibly after the front camera) runs to the next label; otherwise take everything before "Front".
    rb = re.search(r"Rear(?:\s*Camera)?\s*:\s*\|(.*?)(?:\|\s*(?:Aperture|Flash|Front|Video|Scene|Zoom|Photo)\b|$)", text, re.I | re.S)
    rear_txt = rb.group(1) if rb else re.split(r"Front Camera|Selfie|Front-facing|TrueDepth|Front\b", text, flags=re.I)[0]
    mods = []
    for m in re.finditer(r"(\d{1,3}(?:\.\d)?)\s*MP\b([^|]{0,80})", rear_txt, re.I):
        mp = float(m.group(1))
        # the role is read from this module's own words only: stop at the next "+", the next "NN MP" or a label
        after = re.split(r"\+|\d{1,3}(?:\.\d)?\s*MP\b", m.group(2), flags=re.I)[0]
        before = re.split(r"\+|\||MP\b", rear_txt[max(0, m.start() - 40):m.start()], flags=re.I)[-1]
        role = role_of(after + " " + before) or "main"
        mods.append((mp, role))
    # de-duplicate (pages repeat the same module)
    seen, out = set(), []
    for mp, role in mods:
        if (mp, role) in seen: continue
        seen.add((mp, role)); out.append({"role": role, "mp": int(mp) if mp == int(mp) else mp})
    # "macro" mentioned for the ultra-wide (macro photography) is the same module, not another camera
    uw = {m["mp"] for m in out if m["role"] == "ultrawide"}
    out = [m for m in out if not (m["role"] == "macro" and m["mp"] in uw)]
    mains = [m for m in out if m["role"] == "main"]
    if len(mains) > 1:  # keep the largest as main, others are ambiguous
        keep = max(mains, key=lambda m: m["mp"]); out = [m for m in out if m["role"] != "main" or m is keep]
    if out and not any(m["role"] == "main" for m in out):
        # every phone has a main camera; when none is labelled, the page is ambiguous: keep only the text
        return None, (f"{front} MP" if front else None), "Rear: " + " + ".join(f"{m['mp']} MP" for m in out)
    return out[:5] or None, (f"{front} MP" if front else None), None


def ip_rating(text):
    ips = re.findall(r"\bIP(\d)(\d)(K?)\b", text)
    if not ips: return None
    best = max(ips, key=lambda t: (int(t[1]), t[2] == "K", int(t[0])))
    return "IP" + "".join(best)


def os_name(text):
    lab = re.search(r"(?:Operating System|\bOS\b|System Version)\s*\|\s*([^|]{3,60})", text)
    # A bare "Android" label or a footnote ("*Availability of ...") says less than the versioned name elsewhere on the page.
    if lab and re.search(r"OS|Android|Harmony|Wear|RTOS|One UI|Magic|Funtouch|Origin|Hyper|EMUI|iOS|watchOS", lab.group(1)) \
            and not re.fullmatch(r"\s*Android\s*", lab.group(1)) and not lab.group(1).lstrip().startswith("*"):
        return re.sub(r"\s+", " ", lab.group(1)).strip().rstrip("*").strip()
    m = re.search(r"(ColorOS\s*[\d.]+|Funtouch\s*OS\s*[\d.]+|OriginOS\s*[\d.]+|HarmonyOS\s*[\d.]+|EMUI\s*[\d.]+|MagicOS\s*[\d.]+|Xiaomi HyperOS\s*[\d.]*|HyperOS\s*[\d.]*|MIUI\s*[\d.]+|One UI\s*[\d.]+(?:\s*Watch)?|iOS\s*\d+|watchOS\s*\d+|Wear OS[^|,]{0,20})", text)
    a = re.search(r"Android\s*(?:™)?\s*(\d{2})", text)
    parts = []
    if a: parts.append(f"Android {a.group(1)}")
    if m: parts.append(re.sub(r"\s+", " ", m.group(1)).strip())
    return ", ".join(parts) or None


def panel(text):
    for p in ["LTPO AMOLED", "Dynamic AMOLED 2X", "Super AMOLED Plus", "Super AMOLED", "LTPO OLED", "AMOLED", "OLED", "IPS LCD", "LCD", "TFT"]:
        if re.search(re.escape(p), text, re.I): return p
    return None


def peak_nits(text):
    vals = [int(v.replace(",", "")) for v in re.findall(r"(\d{1,2},?\d{3}|\d{3,4})\s*nits", text, re.I)]
    vals = [v for v in vals if 300 <= v <= 8000]
    return max(vals) if vals else None


def watch_life_h(text):
    lab = re.search(r"Battery Life[^|]{0,60}\|\s*(?:up to\s*)?(\d{1,3})\s*(h\b|hours|days?)", text, re.I)
    if lab: return int(lab.group(1)) * (24 if lab.group(2).lower().startswith("day") else 1)
    m = re.search(r"(?:up to|Typical usage[^0-9]{0,40}|typical[^0-9]{0,30})\s*(\d{1,2})\s*days?", text, re.I) or re.search(r"(\d{1,2})\s*days?\s*(?:of\s*)?(?:typical|battery)", text, re.I)
    if m: return int(m.group(1)) * 24
    m = re.search(r"up to\s*(\d{2,3})\s*hours", text, re.I)
    return int(m.group(1)) if m else None


def water(text):
    atm = first(r"(\d{1,2})\s*ATM", text)
    m = first(r"water[- ]resistan\w*[^|0-9]{0,40}(\d{2,3})\s*m(?:etres|eters)?\b", text)
    wm = int(atm) * 10 if atm else (int(m) if m else None)
    return (f"{atm} ATM" if atm else (f"{m} m" if m else None)), wm


def extract(html_str, cat, name=""):
    lines = text_of(html_str)
    specs = extract_lines(lines, cat)
    # "16GB RAM + 512GB ROM (8GB HONOR RAM Turbo included)": the page counts virtual memory; keep the physical RAM.
    turbo = re.search(r"(\d{1,2})\s*GB\s*(?:HONOR\s*)?(?:RAM Turbo|Extended RAM|virtual RAM)\s*included", " | ".join(lines), re.I)
    mem = specs.get("memory", {})
    if turbo and mem.get("ram_gb"):
        phys = [r - int(turbo.group(1)) for r in mem["ram_gb"] if r - int(turbo.group(1)) >= 2]
        if phys: mem["ram_gb"] = phys
    # A "5G" model name is itself the maker's statement (some pages list the bands only in images).
    if cat == "smartphone" and re.search(r"\b5G\b", name or ""):
        specs.setdefault("connectivity", {})["cellular"] = "5G"
    return specs


def extract_article(text, cat):
    """Launch-article prose (fallback when the official page is gone): same patterns, sentence by sentence."""
    lines = [re.sub(r"\s+", " ", l).strip() for l in re.split(r"\n|(?<=[.!?])\s+", text.replace("‑", "-")) if l.strip()]
    return extract_lines(lines, cat)


FIVE_G = re.compile(r"5G\s*(?:NR|SA\b|NSA|Sub-?6|FDD|TDD|network|bands?|mode)|5G\s*[(:]\s*(?:NR|SA|NSA|n\d)|\b[Nn]\d{1,3}(?:\(\d+\))?\s*[/,]\s*[Nn]\d{1,3}\b"
                    r"|5G\s*\|\s*(?:[BbNn]\d|Supported|Yes|SA|NSA)|\bSupports? 5G\b|5G connectivity|5G[- ]capable", re.I)


def extract_lines(lines, cat):
    text = " | ".join(lines)
    specs = {}
    dm = dims(text); wg = weight(text)
    build = {}
    # Foldables list folded and unfolded sizes; existing records leave dimensions out rather than pick one.
    if dm and not re.search(r"Folded|Unfolded|Expanded", text): build["dimensions"] = dm
    if wg: build["weight_g"] = wg
    ip = ip_rating(text)
    if cat == "smartphone":
        disp = {}
        sz = display_size(text, cat); res = resolution(text); hz = refresh(text); pk = peak_nits(text); pt = panel(text)
        if sz: disp["size_in"] = sz
        if pt: disp["type"] = pt
        if res: disp["resolution"] = res
        if hz: disp["refresh_hz"] = hz
        if pk: disp["peak_nits"] = pk
        if disp: specs["display"] = disp
        ch = chipset(text)
        if ch: specs["platform"] = {"chipset_name": ch}
        ram, rom = memory(text)
        if ram or rom: specs["memory"] = {k: v for k, v in (("ram_gb", ram), ("storage_gb", rom)) if v}
        mah = battery_mah(text)
        if mah: specs["battery"] = {"capacity_mah": mah}
        w, wl = charging(text)
        if w or wl: specs["charging"] = {k: v for k, v in (("wired_w", w), ("wireless_w", wl)) if v}
        cam_lines = section(lines, r"^(Camera|Rear Camera|Cameras|Main Camera|Camera System)\b", maxlen=80) or lines
        rear, front, rear_text = cameras(cam_lines)
        if (not rear or not front) and cam_lines is not lines:
            rear2, front2, rear_text2 = cameras(lines)
            if not rear: rear, rear_text = rear2, rear_text2
            front = front or front2
        cam = {}
        if rear: cam["rear"] = rear
        if rear_text: cam["rear_text"] = rear_text
        if front: cam["front"] = front
        if cam: specs["camera"] = cam
        vid = first(r"Video playback[^|]{0,15}\|?\s*Up to\s*(\d{2,3})\s*hours", text)
        if vid: specs.setdefault("battery", {})["video_h"] = int(vid)
        if ip: build["ip"] = ip
        conn = {}
        # Positive evidence only: 5G band lists or labels. Pages also say "WLAN 5G" (Wi-Fi), "5G | /" (not supported)
        # and carry other models' names ("Reno16 5G") in their menus.
        if FIVE_G.search(text): conn["cellular"] = "5G"
        elif re.search(r"\b4G\b|LTE", text): conn["cellular"] = "4G"
        if re.search(r"\bNFC\b", text) and not re.search(r"NFC\s*\|?\s*(No|Not supported|✕)", text, re.I): conn["nfc"] = True
        if conn: specs["connectivity"] = conn
    else:
        disp = {}
        sz = display_size(text, cat); res = resolution(text); pt = panel(text); pk = peak_nits(text)
        if sz: disp["size_in"] = sz
        if pt: disp["type"] = pt
        if res: disp["resolution"] = res
        if pk: disp["peak_nits"] = pk
        if disp: specs["display"] = disp
        life = watch_life_h(text); mah = first(r"(\d{3})\s*mAh", text)
        bat = {}
        if life: bat["life_h"] = life
        if mah: bat["capacity_mah"] = int(mah)
        if bat: specs["battery"] = bat
        wtxt, wm = water(text)
        if wtxt: build["water"] = wtxt
        if wm: build["water_m"] = wm
        if ip: build["ip"] = ip
        conn = {}
        if re.search(r"\bGPS\b|GNSS|Beidou|GLONASS", text): conn["gps"] = "Built-in GNSS"
        if re.search(r"\bNFC\b", text): conn["nfc"] = True
        if re.search(r"eSIM|LTE|4G", text): conn["cellular"] = "LTE option"
        if conn: specs["connectivity"] = conn
    if build: specs["build"] = build
    # Watches list the phone OS versions they pair with; those are not the watch's own OS.
    os_ = os_name(text if cat == "smartphone" else re.sub(r"(?:iOS|Android)\s*\d+(?:\.\d)?\s*(?:or (?:later|above|higher)|and above|\+)", "", text))
    if os_: specs["software"] = {"launch_os": os_}
    return specs


if __name__ == "__main__":
    b = sys.argv[1]
    cat = {x["id"]: x for x in json.loads(Path(f"catalog_{b}.json").read_text(encoding="utf-8"))}
    idx = json.loads(Path(f"cache/spec_{b}/_index.json").read_text())
    out = {}
    for i, v in idx.items():
        p = Path(f"cache/spec_{b}/{i}.html")
        if not v.get("ok") or not p.exists(): continue
        out[i] = extract(p.read_text(encoding="utf-8"), cat[i]["category"], cat[i]["name"])
    Path(f"extract_{b}.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    for i, s in out.items():
        d = s.get("display", {}); b_ = s.get("build", {}); p = s.get("platform", {}); m = s.get("memory", {}); c = s.get("camera", {})
        print(f"{i:28} {d.get('size_in','-')}\" {d.get('refresh_hz','-')}Hz {d.get('resolution','-')} | {p.get('chipset_name','-')} | {m.get('ram_gb','-')}/{m.get('storage_gb','-')} | "
              f"{s.get('battery',{})} | {s.get('charging',{})} | {[str(x['mp'])+x['role'][:2] for x in c.get('rear',[])]} f{c.get('front','-')} | "
              f"{b_.get('dimensions',{}).get('height_mm','-')}x{b_.get('dimensions',{}).get('width_mm','-')}x{b_.get('dimensions',{}).get('depth_mm','-')} {b_.get('weight_g','-')}g {b_.get('ip','-')} {b_.get('water','')} | {s.get('software',{}).get('launch_os','-')}")
