"""Full specification sheet (GSMArena-style detail) from an official spec page's text lines.

Three passes over the page text:
  1. labelled rows ("WLAN | Wi-Fi 6 ...", "Height: 163 mm"),
  2. heading + bullet sections ("Navigation & Positioning | GPS ... | Galileo ..."),
  3. pattern fallbacks for values stated in running lists ("Corning Gorilla Glass 7i", "Dual speakers").
Every value is text copied from the page (lightly cleaned); "Supported"/"Not supported" become yes/no.
"""
import re

COLOR_WORDS = r"black|white|silver|gold|gr[ae]y|blue|green|purple|pink|red|orange|yellow|titanium|graphite|cream|lavender|mint|violet|bronze|beige|brown|teal|cyan|rose|coral|navy|midnight|starlight|obsidian|jade|peach|lilac|sand|sky|ocean|forest|onyx|ivory|champagne|amber|aqua|indigo|charcoal|pearl|emerald|sapphire|ruby|lime|olive|plum|magenta|burgundy|mauve|copper|platinum|glacier|frost|dune|desert|velvet|matte|glossy"


def clean(s):
    s = re.sub(r"[®™]|\(R\)|\(TM\)|\bTM\b", "", s)
    s = s.replace("­", "").replace("：", ": ").replace("；", "; ")
    s = re.sub(r"\s*\|\s*", "; ", s)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"(\S)\*+(?=\s|$|[,;)])", r"\1", s)     # "Wi-Fi 6E*" -> "Wi-Fi 6E"
    return s.strip(" ;,|").strip()


def is_note(seg):
    return bool(re.match(r"^(\*|※|Note\b|\d{1,2}\.\s+[A-Z]|For details|Please |Actual |The actual |Availability|Specifications are|Learn more)", seg)) or len(seg) > 260


LABELS = [
    (r"sim card type|sim type|sim size|sim card|number of sim|sim slot type|sim slot|dual sim|sim card slot|card slot", "connectivity.sim"),
    (r"cpu|cpu type|cpu core count|cpu clock speed|cpu speed|cpu frequency|cpu dominant frequency|cpu cores|number of cores|core number|cpu core", "platform.cpu"),
    (r"gpu|graphics|gpu type", "platform.gpu"),
    (r"process node|process technology|manufacturing process", "platform.process"),
    (r"ram type|memory type", "memory.ram_type"),
    (r"rom specifications|rom type|storage type|rom specification|flash type", "memory.storage_type"),
    (r"phone storage card|expandable rom capacity|expandable storage|memory card|external memory( support)?|micro ?sd( card)?( slot)?|external storage|storage expansion|expandable memory", "memory.card"),
    (r"rear|rear camera|rear cameras|main camera|rear camera system|camera \(rear\)|back camera", "camera.rear_detail"),
    (r"front|front camera|selfie camera|camera \(front\)|front-facing camera", "camera.front_detail"),
    (r"video recording|rear camera video recording|video resolution|video recording resolution|rear video recording", "camera.video"),
    (r"front camera video recording|front video recording", "camera.front_video"),
    (r"zoom mode|zoom|optical zoom", "camera.features"),
    (r"speakers?|loudspeakers?|stereo support|stereo speakers?|speaker type|audio output", "audio.speakers"),
    (r"earphone jack|headphone jack|earjack|audio jack|3\.5 ?mm (headphone )?jack|headset jack", "audio.jack"),
    (r"wlan|wi-?fi|wi-fi standard|wlan protocols?|wi-fi protocols?|wireless networks", "connectivity.wifi"),
    (r"bluetooth( version)?|bluetooth version", "connectivity.bluetooth"),
    (r"location technology|location|positioning|gnss|navigation|navigation (&|and) positioning|location services|satellite positioning|gps", "connectivity.positioning"),
    (r"fm|fm radio|radio", "connectivity.radio"),
    (r"usb interface|usb|usb version|usb type|interface|charging port|data interface", "connectivity.usb"),
    (r"sensors?", "sensors"),
    (r"battery type|battery chemistry", "battery.chemistry"),
    (r"fast charge|fast charging|charging|charging power|wired charging|standard charger|charging specifications|power adapter|charging mode", "charging.claim"),
    (r"colou?rs?|product colou?rs?|colou?r options|colou?rway", "misc.colors"),
    (r"back cover material|back material|back cover|rear cover material|back panel", "build.back"),
    (r"frame|frame material|middle frame|mid-frame", "build.frame"),
    (r"cover glass(es)?|screen protection|display protection|protective glass", "display.protection"),
    (r"fingerprint( sensor)?( type)?|fingerprint unlock|fingerprint recognition", "biometrics.fingerprint"),
    (r"fac(e|ial) (recognition|unlock)|face id|face unlock|2d face unlock", "biometrics.face"),
    (r"nfc", "connectivity.nfc_text"),
    (r"network standard", "connectivity.technology_list"),
]
LABEL_RES = [(re.compile(rf"^(?:{p})\s*\d?$", re.I), f) for p, f in LABELS]
STOP = re.compile(r"^(height|width|depth|thickness|weight|size|screen size|resolution|refresh rate|touch sampling rate|colou?r gamut|colou?r depth|"
                  r"pixel density|brightness|panel|type|screen ratio|contrast ratio|ram and rom capacities|ram & rom|ram & storage|memory|ram|rom|storage|"
                  r"capacity|battery|operating system|android version|user interface|os|system|chips?|soc|processor|platform|chipset|cpu model|"
                  r"model|model \d|image resolution|capture mode|shooting mode|scene mode|flash( light)?|stabilization|image stabilization|"
                  r"autofocus mode|aperture|in the box|media|audio playback|video playback|voice recording|otg|usb otg|hi-fi|ingress protection rating|"
                  r"water and dust resistance|dust and water resistance|dust & water resistance|biometrics|cellular network|network|frequency band|standby mode|connectivity|"
                  r"design|display|camera|video|front camera capture mode|rear camera capture mode|basic|dimensions( and weight)?|"
                  r"size and weight|light-emitting material|touch screen|local peak brightness|colou?r saturation|primary sim card|secondary sim card|"
                  r"others|ai|features|sound|audio|in-box accessories|packing list|warranty|what's in the box|expandable ram capacity|"
                  r"bluetooth audio codec|audio codec|infrared( remote control)?|ir blaster|infrared sensor|sim card \d|sim \d|"
                  r"network bands|video & audio playback|security & authentication|network & connectivity|navigation & positioning|"
                  r"cooling system|xiaomi hyperai|operating system|packaging contents|connectivity and location|battery & charging|"
                  r"rear camera photography features|rear camera video features|front camera photography features|front camera video features|"
                  r"video playback time|audio playback time|standby time|talk time|vibration motor|haptics|storage & ram|keyboard type|input method|"
                  r"video call|water & dust resistance|dust & water resistance|security|unlock|cooling|gaming|ai features)\s*\d?:?$", re.I)
HEADINGS = re.compile(r"^(display|camera|cameras|rear camera|front camera|battery|battery & charging|charging|network|connectivity|sensors?|chips?|"
                      r"processor|platform|performance|memory|storage|design|system|media|biometrics|audio|sound|dimensions|size and weight|"
                      r"in the box|video|location|cellular network|operating system|basic|network & connectivity|security & authentication|"
                      r"video & audio playback|navigation & positioning|wireless networks|connectivity and location|ram & storage)\s*\d?$", re.I)

BOOL_YES = re.compile(r"^(supported|support|yes|✓|available|supports?)\.?$", re.I)
BOOL_NO = re.compile(r"^(not supported|unsupported|not support|no|none|n/a|-|—|/|×|✕)\.?$", re.I)


def label_of(seg):
    s = seg.rstrip(":").strip()
    for rx, f in LABEL_RES:
        if rx.match(s): return f
    return None


def is_stop(seg, keep_sensor_names=False):
    s = seg.rstrip(":").strip()
    if keep_sensor_names and re.search(r"sensor|compass|gyro|accelero|barometer|gravity|infrared|fingerprint|hall|proximity|light|flicker|laser|temperature|motor|blaster", s, re.I) and not HEADINGS.match(s):
        return False
    return bool(label_of(s) or STOP.match(s) or HEADINGS.match(s) or is_note(seg))


def segments(lines):
    out = []
    for l in lines:
        l = re.sub(r"[®™]", "", l.replace("­", "").replace("｜", " | "))
        l = re.sub(r"\s+", " ", l).strip()
        if not l: continue
        m = re.match(r"^([A-Za-z][A-Za-z0-9 &/()\-]{1,40}):\s*(.+)$", l)
        if m and (label_of(m.group(1)) or STOP.match(m.group(1))):
            out += [m.group(1), m.group(2)]
        elif l.endswith(":") and len(l) < 45:
            out.append(l[:-1])
        else:
            out.append(l)
    return out


LEAKY = {"wifi", "bluetooth", "gpu", "cpu", "sim", "nfc_text", "speakers", "radio", "card", "features", "process"}
OTHER_FIELD = re.compile(r"^(Bluetooth\b|BT\s?\d|NFC\b|GPS\b|USB\b|Wi-?Fi\b|WLAN\b|Water (&|and) Dust|IP\d\d)", re.I)


def collect(segs, i, maxn=12, sensors=False):
    vals = []
    own = (label_of(segs[i]) or "").split(".")[-1]
    for s in segs[i + 1:i + 1 + maxn]:
        if is_stop(s, keep_sensor_names=sensors): break
        # a value that starts another field ("Bluetooth 5.4" after "Wi-Fi") ends this one
        m = OTHER_FIELD.match(s)
        if m and own in LEAKY and not own.startswith(m.group(1).lower()[:3]) and not (own == "wifi" and m.group(1).lower().startswith("wlan")): break
        vals.append(s)
    return vals


def bands(text):
    out = {}
    t = text.replace("：", ":")
    g2 = re.findall(r"(?<![\w-])(?:2G\s*(?:GSM|EDGE)?|GSM/EDGE|GSM)\s*[:|(]\s*((?:Bands?\s*)?[\dB/ ,(){}MHzGSM]{4,120})", t)
    g3 = re.findall(r"(?<![\w-])(?:3G\s*(?:WCDMA|UMTS|HSPA)?|UMTS/HSPA\+?[^|(:]{0,20}|WCDMA|UMTS)\s*[:|(]\s*((?:Bands?\s*)?[\dB/ ,().MHz]{4,160})", t)
    g4 = re.findall(r"((?:4G\s*)?(?:FDD|TDD)[- ]?LTE|4G\s*(?:LTE\s*)?[- ]?(?:FDD|TDD)(?:\s*LTE)?|LTE\s*(?:FDD|TDD))\s*[:|(]\s*((?:Bands?\s*)?B?\d[\dB/ ,().MHz]{1,200})", t, re.I)
    g5 = re.findall(r"((?:FDD|TDD)-?\s*5G\s*NR|5G\s*NR(?:\s*(?:SA|NSA))?|5G\s*(?:SA|NSA)|5G\s*(?:FDD|TDD)\s*Sub6|5G)\s*[:|(]\s*((?:SA:\s*|NSA:\s*)?(?:Bands?\s*)?[nN]\d[^|]{0,200})", t, re.I)
    def tidy(v): return clean(re.sub(r"[()]+$", "", v.strip()))
    g2 = [x for x in g2 if re.search(r"\d", x)]
    g3 = [x for x in g3 if re.search(r"\d", x)]
    if g2: out["connectivity.bands_2g"] = tidy(g2[0])
    if g3: out["connectivity.bands_3g"] = tidy(g3[0])
    if g4: out["connectivity.bands_4g"] = "; ".join(dict.fromkeys(f"{clean(a)}: {tidy(b)}" for a, b in g4[:3]))
    if g5: out["connectivity.bands_5g"] = "; ".join(dict.fromkeys(f"{clean(a)}: {tidy(b)}" for a, b in g5[:3]))
    tech = [x for x, k in (("GSM", "connectivity.bands_2g"), ("HSPA", "connectivity.bands_3g"), ("LTE", "connectivity.bands_4g"), ("5G", "connectivity.bands_5g")) if k in out]
    if tech: out["connectivity.technology"] = " / ".join(tech)
    return out


def video_summary(vals):
    lines = [x for v in vals for x in v.split("|")]
    best = None
    for res in ("8K", "4K", "2160p", "3840", "1080p", "1080P", "1920"):
        if any(re.search(rf"(?<![\d.]){res}", l) for l in lines): best = res; break
    if not best: return None
    label = {"2160p": "4K", "3840": "4K", "1080P": "1080p", "1920": "1080p"}.get(best, best)
    # every frame rate on the best resolution's own lines (not slow-motion, time-lapse or cinematic modes)
    fps = [int(x) for l in lines if re.search(rf"(?<![\d.]){best}", l) and not re.search(r"slo|slow|time-?lapse|cinematic|action mode", l, re.I)
           for x in re.findall(r"(\d{2,3})\s*fps", l)]
    extra = "; 1080p" if label in ("4K", "8K") and any(re.search(r"1080p|1080P|1920", l) for l in lines) else ""
    return f"{label}@{max(fps)}fps{extra}" if fps else label + extra


def yesno(vals):
    if not vals: return None
    v = vals[0].strip()
    if BOOL_NO.match(v): return False
    if BOOL_YES.match(v): return True
    return None


def is_colors(seg):
    items = [x.strip() for x in re.split(r"[,;/、]|\band\b", seg) if x.strip()]
    return 1 <= len(items) <= 8 and all(re.search(rf"\b({COLOR_WORDS})\b", x, re.I) and len(x) < 30 for x in items) and not re.search(r"billion|bit|gamut|ntsc|dci", seg, re.I)


def sheet_from_lines(lines, cat="smartphone", brand=""):
    segs = segments(lines)
    text = " | ".join(segs)
    out = {}
    if cat == "smartphone": out.update(bands(text))
    section = ""
    cpu_parts = []
    # ---------------- pass 1: labelled rows
    for i, s in enumerate(segs):
        if HEADINGS.match(s): section = s.lower()
        f = label_of(s)
        if not f: continue
        vals = collect(segs, i, maxn=(30 if f in ("camera.rear_detail", "camera.front_detail", "sensors") else 12), sensors=(f == "sensors"))
        if not vals: continue
        if f == "camera.rear_detail" and not any(re.search(r"\d\s*MP|\bMP\b", v, re.I) for v in vals):
            if s.lower() == "rear" and "video" in section: f = "camera.video"
            else: continue
        if f == "camera.front_detail" and not any(re.search(r"\d\s*MP|\bMP\b", v, re.I) for v in vals):
            if s.lower() == "front" and "video" in section: f = "camera.front_video"
            else: continue
        if f == "misc.colors" and ("display" in section or not any(is_colors(v) for v in vals)): continue
        if f == "biometrics.fingerprint" and "sensor" in section: continue
        if f == "memory.card" and re.search(r"sim", " ".join(vals), re.I): f = "connectivity.sim"
        if f == "platform.cpu":
            cpu_parts += [v for v in vals[:4] if not BOOL_YES.match(v)]
            continue
        if f == "connectivity.technology_list":
            gens = [g for g, rx in (("GSM", r"2G|GSM"), ("HSPA", r"3G|WCDMA"), ("LTE", r"4G|LTE"), ("5G", r"5G")) if re.search(rx, " ".join(vals))]
            if gens: out.setdefault("connectivity.technology", " / ".join(gens))
            continue
        if f in out: continue
        if f in ("camera.rear_detail", "camera.front_detail"):
            mods = group_modules(vals)
            if mods: out[f] = mods[:5]
        elif f in ("camera.video", "camera.front_video"):
            v = video_summary(vals)
            if v: out[f] = v
        elif f == "sensors":
            names, k = [], 0
            while k < len(vals):
                v, nxt = vals[k], (vals[k + 1] if k + 1 < len(vals) else "")
                if BOOL_YES.match(nxt) or BOOL_NO.match(nxt):
                    if BOOL_YES.match(nxt): names.append(v)
                    k += 2; continue
                names += [x.strip() for x in re.split(r",|、|;|\|", v) if x.strip()]
                k += 1
            names = [clean(n) for n in names if not re.match(r"^(and|etc\.?)$", n, re.I)]
            if names: out[f] = ", ".join(dict.fromkeys(names))[:400]
        elif f == "audio.jack":
            v = " ".join(vals[:2])
            if re.search(r"3\.5", v) or (BOOL_YES.match(vals[0]) and "jack" in s.lower()): out[f] = True
            elif re.search(r"type-?c|usb|not supported|unsupported|^no\b", v, re.I): out[f] = False
        elif f == "connectivity.nfc_text":
            yn = yesno(vals)
            if yn is not None: out["connectivity.nfc"] = yn
        elif f == "memory.card":
            yn = yesno(vals)
            v = clean(vals[0])
            # only a real card statement: yes/no, or text naming a card or a maximum size
            if yn is not None: out[f] = "Yes" if yn else "No"
            elif re.search(r"micro ?sd|\bTF\b|card|up to \d|\d\s*TB", v, re.I): out[f] = v[:120]
        elif f == "connectivity.radio":
            yn = yesno(vals)
            if yn is not None or len(vals[0]) < 60: out[f] = "No" if yn is False else ("Yes" if yn else clean(vals[0]))
        else:
            texts = [clean(x) for x in vals[:6] if not BOOL_YES.match(x.strip()) and not BOOL_NO.match(x.strip())]
            if not texts:
                if f in ("biometrics.fingerprint", "biometrics.face") and yesno(vals): out[f] = "Yes"
                continue
            if f == "connectivity.wifi": texts = texts[:3]
            if f == "connectivity.sim" and re.match(r"^[A-Z]{3}-[A-Z]{1,3}\d{1,2}\b", texts[0]):
                out.setdefault("misc.models", "; ".join(texts[:2]))   # Huawei lists the model code under Network
                continue
            val = "; ".join(texts)[:300]
            if f == "connectivity.bluetooth" and re.fullmatch(r"\d\.\d", val): val = f"Bluetooth {val}"
            out[f] = val
    if cpu_parts and "platform.cpu" not in out:
        parts = [("%s cores" % p) if re.fullmatch(r"\d{1,2}", p) else clean(p) for p in cpu_parts]
        out["platform.cpu"] = "; ".join(dict.fromkeys(parts))[:240]
    # ---------------- pass 2: heading + bullets (Xiaomi-style pages)
    for i, s in enumerate(segs):
        h = s.lower().rstrip(":")
        if not HEADINGS.match(s) and h not in ("network & connectivity", "security & authentication", "video & audio playback", "navigation & positioning", "wireless networks"):
            continue
        bullets = []
        for x in segs[i + 1:i + 16]:
            if HEADINGS.match(x) or (STOP.match(x.rstrip(":")) and x.lower().rstrip(":") not in ("network bands",)) or is_note(x): break
            bullets.append(x)
        if not bullets: continue
        blob = " | ".join(bullets)
        if h in ("network & connectivity", "network", "cellular network"):
            sim = [b for b in bullets if re.search(r"\bSIM\b", b, re.I) and len(b) < 120]
            if sim: out.setdefault("connectivity.sim", clean(sim[0]))
        if h in ("wireless networks", "connectivity", "network & connectivity", "connectivity and location"):
            wf = [b for b in bullets if re.search(r"Wi-?Fi|802\.11", b)]
            if wf: out.setdefault("connectivity.wifi", "; ".join(clean(x) for x in wf[:2]))
            bt = [b for b in bullets if re.match(r"Bluetooth|BT\s?\d", b)]
            if bt: out.setdefault("connectivity.bluetooth", clean(bt[0]))
        if h in ("video & audio playback", "audio", "sound", "media"):
            sp = [b for b in bullets if re.search(r"speaker", b, re.I)]
            if sp: out.setdefault("audio.speakers", clean(sp[0]))
            if re.search(r"3\.5\s?mm", blob): out.setdefault("audio.jack", True)
        if h in ("security & authentication", "biometrics"):
            fp = [b for b in bullets if re.search(r"fingerprint", b, re.I)]
            fc = [b for b in bullets if re.search(r"face", b, re.I)]
            if fp and not BOOL_YES.match(fp[0]): out.setdefault("biometrics.fingerprint", clean(fp[0]))
            if fc and not BOOL_YES.match(fc[0]): out.setdefault("biometrics.face", clean(fc[0]))
        if h in ("navigation & positioning", "location"):
            out.setdefault("connectivity.positioning", clean("; ".join(bullets[:6]))[:300])
        if h in ("camera", "cameras", "rear camera") and "camera.rear_detail" not in out:
            rear = []
            for x in bullets:
                if re.search(r"front|selfie", x, re.I): break
                rear.append(x)
            mods = group_modules(rear)
            if mods: out["camera.rear_detail"] = mods[:5]
        if h in ("sensors", "sensor"):
            if "sensors" not in out:
                names = [clean(n) for b in bullets for n in re.split(r",|;|\|", b) if n.strip() and not BOOL_YES.match(n.strip())]
                if names: out["sensors"] = ", ".join(dict.fromkeys(names))[:400]
    # ---------------- pass 3: pattern fallbacks from the whole page
    fb = {
        "display.protection": r"(Corning[^|;,]{0,30}Gorilla[^|;,]{0,25}|Gorilla Glass[^|;,]{0,20}|Dragon ?Crystal Glass[^|;,]{0,10}|Kunlun Glass[^|;,]{0,10}|Ceramic Shield[^|;,]{0,20}|Xiaomi Shield Glass[^|;,]{0,10}|Panda Glass[^|;,]{0,10}|NanoCrystal Shield[^|;,]{0,10}|Schott[^|;,]{0,30})",
        "memory.ram_type": r"\b(LPDDR\d[Xx]?(?:\s*Ultra)?)\b",
        "memory.storage_type": r"\b(UFS\s?\d\.\d)\b",
        "connectivity.bluetooth": r"\b(Bluetooth\s?(?:v)?\d\.\d|BT\s?\d\.\d)",
        "audio.speakers": r"\b((?:symmetrical |dual |stereo |ultra-linear )+speakers?|single speaker|mono speaker|built-in stereo speaker)\b",
        "biometrics.fingerprint": r"\b((?:in-display|under-display|in-screen|side-mounted|side|power button)[^|;,]{0,20}fingerprint(?: sensor| unlock| scanner)?)",
        "battery.chemistry": r"\b(Li-?ion(?: polymer)?|Li-?Po(?:lymer)?|lithium[- ]ion|lithium polymer|silicon-carbon)\b",
        "connectivity.usb": r"\b(USB[ -]?Type-?C(?:,? USB \d(?:\.\d)?(?: Gen ?\d)?)?|USB-C(?: \d\.\d)?)",
    }
    # vivo/iQOO (older pages): "Front 32MP / Rear 50MP + 12MP + 12MP | Aperture | Front f/2.45 (32MP), Rear f/1.75 (50MP) + f/2.0 (12MP)"
    for side, key in (("Rear", "camera.rear_detail"), ("Front", "camera.front_detail")):
        if key in out: continue
        m = re.search(rf"\b{side}\s+((?:\d+(?:\.\d+)?\s*MP)(?:\s*\+\s*\d+(?:\.\d+)?\s*MP)*)", text)
        if not m: continue
        mps = re.findall(r"\d+(?:\.\d+)?\s*MP", m.group(1))
        ap = re.search(rf"\b{side}\s+(f/[\d.]+(?:\s*\([^)]*\))?(?:\s*\+\s*f/[\d.]+(?:\s*\([^)]*\))?)*)", text)
        aps = re.findall(r"f/[\d.]+", ap.group(1)) if ap else []
        out[key] = [clean(f"{mp}" + (f", {aps[i]}" if i < len(aps) else "")) for i, mp in enumerate(mps)]
    if "camera.front_detail" not in out:
        # "20MP front camera | OV20B | f/2.2 | 4p lens" as a free-standing block
        for i, x in enumerate(segs):
            if re.match(r"^\d+(?:\.\d+)?\s*MP\b.{0,40}\b(front|selfie)\b", x, re.I):
                cut = [x]
                for y in segs[i + 1:i + 6]:
                    if is_stop(y) or re.search(r"camera|video|\d{3,4}p\b|fps", y, re.I) or len(y) > 60: break
                    cut.append(y)
                out["camera.front_detail"] = [clean(", ".join(cut))]
                break
    if "connectivity.nfc" not in out:
        m = re.search(r"\bNFC\s*[|:]\s*([^|]{1,200})", text)
        if m and re.search(r"\bsupported\b|\byes\b", m.group(1), re.I) and not re.search(r"not supported|unsupported", m.group(1), re.I): out["connectivity.nfc"] = True
        elif m and re.search(r"not supported|unsupported|^\s*no\b", m.group(1), re.I): out["connectivity.nfc"] = False
    if "charging.claim" not in out:
        ch = [clean(x) for x in segs if re.search(r"\b\d{2,3}\s?W\b", x) and re.search(r"charg|HyperCharge|SUPERVOOC|SuperCharge|FlashCharge|turbo", x, re.I) and len(x) < 140]
        if ch: out["charging.claim"] = "; ".join(dict.fromkeys(ch[:3]))
    if out.get("biometrics.fingerprint") == "Yes": out.pop("biometrics.fingerprint")
    sim = out.get("connectivity.sim", "")
    if re.match(r"^[A-Z]{3}-[A-Z]{1,3}\d{1,2}\b", sim):
        out.setdefault("misc.models", sim)
        out.pop("connectivity.sim")
    for k, rx in fb.items():
        if k not in out:
            m = re.search(rx, text, re.I)
            if m: out[k] = clean(m.group(1))
    if "audio.jack" not in out and re.search(r"3\.5\s?mm (headphone|audio|earphone) jack", text, re.I): out["audio.jack"] = True
    if "misc.colors" not in out:
        # colour swatches: the longest run of consecutive colour names near the top of the page
        runs, cur = [], []
        for sgm in segs[:45]:
            if is_colors(sgm) and not re.search(r"\b(display|screen)\b", sgm, re.I): cur.append(clean(sgm))
            else:
                if cur: runs.append(cur)
                cur = []
        if cur: runs.append(cur)
        if runs:
            best = max(runs, key=lambda r: sum(len(re.split(r"[,;/]", x)) for x in r))
            out["misc.colors"] = ", ".join(best)
    if "misc.colors" in out: out["misc.colors"] = re.sub(r"\s*;\s*", ", ", out["misc.colors"])
    # tidy
    for k in ("connectivity.positioning", "sensors", "connectivity.wifi"):
        if k in out: out[k] = re.sub(r"\s*;\s*", "; ", out[k])
    return out


def group_modules(vals):
    """Camera modules: one line each (OPPO/vivo/HONOR/Huawei), or a name line followed by spec lines (Xiaomi)."""
    # drop summary lines ("108MP+2MP+2MP triple camera") when the modules are also listed one by one
    if sum(1 for v in vals if re.search(r"\d\s*MP", v, re.I)) > 1:
        vals = [v for v in vals if not re.search(r"\d\s*MP\s*\+\s*\d", v, re.I)] or vals
    mp_lines = [v for v in vals if re.search(r"\d\s*MP|\bMP\b", v, re.I)]
    detail_lines = [v for v in vals if v not in mp_lines and re.search(r"^f/\d|µm|μm|\bIMX\d|\bOV\d|\bJN\d|\bHP\d|^OIS$|sensor|\d+p lens|equivalent|^\d+mm", v, re.I)]
    if len(mp_lines) >= 1 and all(len(v) > 14 for v in mp_lines) and not any(re.fullmatch(r"\d+\s*MP", v.strip(), re.I) for v in vals) and not detail_lines:
        return [clean(v) for v in mp_lines]
    mods, cur = [], []
    first = next((i for i, v in enumerate(vals) if re.search(r"camera", v, re.I)), 0)
    for v in vals[first:]:
        if re.search(r"camera", v, re.I) and cur and any(re.search(r"\d\s*MP", c, re.I) for c in cur):
            mods.append(cur); cur = []
        cur.append(v)
    if cur and any(re.search(r"\d\s*MP", c, re.I) for c in cur): mods.append(cur)
    return [clean(", ".join(m)) for m in mods]


def apple_sheet(lines):
    heads = {"capacity", "size and weight", "display", "splash, water and dust resistant", "chip", "camera", "video recording",
             "truedepth camera", "front camera", "power and battery", "face id", "touch id", "mobile and wireless", "cellular and wireless",
             "location", "external buttons and connectors", "charging and expansion", "magsafe and wireless charging", "sensors",
             "sim card", "operating system", "in the box", "apple intelligence", "peace of mind", "safety features", "video calling",
             "audio calling", "audio playback", "video playback", "environmental requirements", "languages", "accessibility",
             "built-in apps", "headphones", "siri", "materials", "finish", "colour", "color", "rating for hearing aids", "apple pay",
             "mail attachment support", "system requirements", "magsafe, qi2 and qi wireless charging"}
    sec, groups = None, {}
    for l in lines:
        s = clean(re.sub(r"\s\d{1,2}$", "", l.replace("­", "")))
        key = re.sub(r"\s*\d+$", "", s).lower()
        if key in heads and not (sec == "sensors" and key in ("face id", "touch id")):
            sec = key; groups.setdefault(sec, []); continue
        if sec: groups[sec].append(s)
    out = {}
    mw = groups.get("mobile and wireless") or groups.get("cellular and wireless") or []
    b = {}
    for line in mw:
        if re.search(r"5G NR", line): b.setdefault("5g", []).append(line)
        elif re.search(r"LTE \(", line): b.setdefault("4g", []).append(line)
        elif re.search(r"UMTS|HSPA", line): b.setdefault("3g", []).append(line)
        elif re.search(r"GSM/EDGE", line): b.setdefault("2g", []).append(line)
        elif re.match(r"Wi-Fi", line) and "connectivity.wifi" not in out: out["connectivity.wifi"] = line
        elif re.match(r"Bluetooth", line): out["connectivity.bluetooth"] = line
        elif re.match(r"NFC", line): out["connectivity.nfc"] = True
    for g, k in (("2g", "connectivity.bands_2g"), ("3g", "connectivity.bands_3g"), ("4g", "connectivity.bands_4g"), ("5g", "connectivity.bands_5g")):
        if b.get(g): out[k] = "; ".join(b[g])
    tech = [x for x, g in (("GSM", "2g"), ("HSPA", "3g"), ("LTE", "4g"), ("5G", "5g")) if b.get(g)]
    if tech: out["connectivity.technology"] = " / ".join(tech)
    if groups.get("location"): out["connectivity.positioning"] = "; ".join(groups["location"][:4])
    if groups.get("sensors"): out["sensors"] = ", ".join(groups["sensors"][:12])
    if groups.get("sim card"): out["connectivity.sim"] = "; ".join(x for x in groups["sim card"][:3] if not x.lower().startswith("learn more"))
    chip = groups.get("chip", [])
    cpu = [x for x in chip if re.search(r"CPU", x)]
    gpu = [x for x in chip if re.search(r"GPU", x)]
    if cpu: out["platform.cpu"] = cpu[0]
    if gpu: out["platform.gpu"] = gpu[0]
    cam = groups.get("camera", [])
    mods = [x for x in cam if re.search(r"\d+MP", x) and ":" in x]
    if mods: out["camera.rear_detail"] = mods[:5]
    feats = [x for x in cam if re.search(r"optical zoom|Digital zoom", x, re.I)]
    if feats: out["camera.features"] = "; ".join(feats[:3])
    vid = groups.get("video recording", [])
    v = video_summary(vid) if vid else None
    if v: out["camera.video"] = v
    front = groups.get("truedepth camera") or groups.get("front camera") or []
    if front:
        mp = [x for x in front if re.search(r"\d+MP", x)]
        ap = [x for x in front if re.search(r"ƒ/|f/", x)]
        if mp: out["camera.front_detail"] = [", ".join(mp[:1] + ap[:1])]
        fv = video_summary([x for x in front if re.search(r"video recording", x)])
        if fv: out["camera.front_video"] = fv
    ext = groups.get("external buttons and connectors", []) + groups.get("charging and expansion", [])
    spk = [x for x in ext if re.search(r"speaker", x, re.I)]
    if spk: out["audio.speakers"] = spk[0]
    usb = [x for x in ext if re.search(r"USB", x) and not x.endswith(":")]
    if usb: out["connectivity.usb"] = "; ".join(dict.fromkeys(usb[:3]))
    pw = groups.get("power and battery", [])
    chem = [x for x in pw if re.search(r"lithium", x, re.I)]
    if chem: out["battery.chemistry"] = chem[0]
    wl = groups.get("magsafe and wireless charging", []) + groups.get("magsafe, qi2 and qi wireless charging", [])
    ch = [x for x in pw + wl if re.search(r"charg", x, re.I) and re.search(r"\d+W\b|\d+%", x)]
    if ch: out["charging.claim"] = "; ".join(re.sub(r"\s\d{1,2}(?=\s(?:with|and|or)\b)", "", x) for x in ch[:3])[:300]
    return out


def samsung_sheet(data, cat="smartphone"):
    """Samsung spec data (searchapi .../spec/detail): attrName/attrValue pairs, several model codes per device."""
    models = [m for m in data["response"]["resultData"]["modelList"] if m["spec"]["specItems"]]
    if not models: return {}
    A, colours, storage_ext = {}, [], None
    for mi, m in enumerate(models):
        for it in m["spec"]["specItems"]:
            if it["attrValue"] is not None and mi == 0: A[it["attrName"]] = it["attrValue"]
            for a in it["attrs"] or []:
                v = (a["attrValue"] or "").replace("\t", " ").strip()
                if a["attrName"] == "Colour" and v: colours.append(v)
                if mi == 0 and v: A[a["attrName"]] = v
    g = lambda *ks: next((A[k] for k in ks if A.get(k)), None)
    out = {}
    if cat == "smartphone":
        for k, key in (("2G GSM", "connectivity.bands_2g"), ("3G UMTS", "connectivity.bands_3g")):
            if g(k): out[key] = clean(g(k))
        b4 = [f"{k}: {clean(g(k))}" for k in ("4G FDD LTE", "4G TDD LTE") if g(k)]
        b5 = [f"{k}: {clean(g(k))}" for k in ("5G FDD Sub6", "5G TDD Sub6", "5G FDD mmWave", "5G TDD mmWave") if g(k)]
        if b4: out["connectivity.bands_4g"] = "; ".join(b4)
        if b5: out["connectivity.bands_5g"] = "; ".join(b5)
        tech = [x for x, k in (("GSM", "connectivity.bands_2g"), ("HSPA", "connectivity.bands_3g"), ("LTE", "connectivity.bands_4g"), ("5G", "connectivity.bands_5g")) if k in out]
        if tech: out["connectivity.technology"] = " / ".join(tech)
        sim = "; ".join(x for x in (g("Number of SIM"), g("SIM size"), g("SIM Slot Type")) if x)
        if sim: out["connectivity.sim"] = clean(sim)
        cpu = "; ".join(x for x in (g("CPU Type"), g("CPU Speed")) if x)
        if cpu: out["platform.cpu"] = clean(cpu)
        res = [x.strip() for x in re.split(r"\s*\+\s*", g("Rear Camera - Resolution (Multiple)", "Rear Camera - Resolution_(Multiple)") or "") if x.strip()]
        fno = [x.strip() for x in re.split(r"\s*,\s*", g("Rear Camera - F Number (Multiple)", "Rear Camera - F Number_(Multiple)") or "") if x.strip()]
        if res:
            mods = []
            for i, r in enumerate(res):
                r = re.sub(r"(\d+)\.0 MP", r"\1 MP", r)
                bits = [r] + ([f"f/{fno[i].lstrip('Ff').strip()}"] if i < len(fno) and re.search(r"\d", fno[i]) else [])
                if i == 0 and (g("Rear Camera - OIS") or "").lower() == "yes": bits.append("OIS")
                mods.append(", ".join(bits))
            out["camera.rear_detail"] = mods
        z = g("Rear Camera - Zoom", "Rear Camera Zoom")
        if z: out["camera.features"] = clean(z)
        fr = g("Front Camera - Resolution")
        if fr:
            ff = g("Front Camera - F Number")
            out["camera.front_detail"] = [re.sub(r"(\d+)\.0 MP", r"\1 MP", fr) + (f", f/{ff.lstrip('Ff').strip()}" if ff else "")]
        cv = g("Cover Camera - Resolution", "Under Display Camera - Resolution")
        if cv: out["camera.front_detail"] = out.get("camera.front_detail", []) + [re.sub(r"(\d+)\.0 MP", r"\1 MP", cv) + (" (cover screen)" if g("Cover Camera - Resolution") else " (under display)")]
        vr = g("Video Recording Resolution")
        if vr: out["camera.video"] = clean(vr)
        if g("Stereo Support"): out["audio.speakers"] = "Stereo speakers" if g("Stereo Support").lower() == "yes" else "Mono speaker"
        ej = g("Earjack")
        if ej: out["audio.jack"] = bool(re.search(r"3\.5", ej))
        es = g("External Storage Support")
        if es: out["memory.card"] = clean(es)
    if g("Wi-Fi"): out["connectivity.wifi"] = clean(g("Wi-Fi"))
    if g("Bluetooth Version"): out["connectivity.bluetooth"] = clean(g("Bluetooth Version"))
    if g("Location Technology"): out["connectivity.positioning"] = clean(g("Location Technology"))
    usb = ", ".join(x for x in (g("USB Interface"), g("USB Version")) if x)
    if usb: out["connectivity.usb"] = clean(usb)
    if g("NFC"): out["connectivity.nfc"] = g("NFC").lower() == "yes"
    if g("UWB (Ultra-Wideband)"): out["connectivity.uwb"] = g("UWB (Ultra-Wideband)").lower() == "yes"
    if g("Sensors"): out["sensors"] = clean(g("Sensors"))
    if colours: out["misc.colors"] = ", ".join(dict.fromkeys(c.strip() for c in colours))
    if g("Durability"): out["build.durability"] = clean(g("Durability"))
    return out
