"""Chip makers' own pages: new chipsets and the details of known ones (Version 35).

Phones added automatically already bring their chip's name (tools/auto_devices.py), but a name only, and a new flagship
chip only joined the site once a phone with it had. This reads the chip makers' own product pages instead:

  Qualcomm   www.qualcomm.com  - Snapdragon 7 and 8 series pages (from Qualcomm's sitemap); specifications from the
                                 structured data (schema.org) on each page
  MediaTek   www.mediatek.com  - Dimensity pages (the Dimensity overview daily, MediaTek's sitemap weekly); the page's
                                 Specifications table
  Samsung    semiconductor.samsung.com - Exynos pages (from Samsung Semiconductor's sitemap); the specification list the
                                 page itself loads (/aemapi/semi/prdSpecInfo)

robots.txt is read first on each site and the requests carry the site's neutral bot name only.

What happens with what is read:

  - A chip already on the site (entered by hand, or named by a phone): only details it does not have yet are added -
    CPU cores and speeds, GPU, NPU, modem, memory, storage, process - each marked with the maker's page it came from.
    Anything entered by hand is never changed.
  - A chip not on the site: it waits for the open-source AI check (tools/ai_chip_check.py, the same Qwen3.5 9B that
    checks new devices). The site covers chips from 2023 on. The AI must be sure the chip is from 2023 or later for it
    to be added; if it is sure the chip is older, it is left out; if it is not sure or does not know the chip, the chip
    is held until a person has checked it (the owner asks Claude, who verifies it before adding it by hand).
  - Three-digit Snapdragon names (7xx/8xx, last used in 2022) and Exynos 9xxx are older than the site's range and are
    left out by rule, without asking the AI.

Only exact names are matched: "Dimensity 7300 Energy" (named by a phone) is not filled from MediaTek's Dimensity 7300
page. Every value comes from the chip maker's own page; nothing is estimated.

    python tools/auto_chips.py            daily: list pages, read new or month-old chip pages (at most 40 a run)
    python tools/auto_chips.py --weekly   also read the full sitemaps (default on Mondays)
    python tools/auto_chips.py --dry      print what would change, save nothing

State and results: live/auto/auto_chips.json (carried between runs like the other automatic results).
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "live" / "auto" / "auto_chips.json"
NEW_DEVICES = ROOT / "live" / "auto" / "new_devices.json"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0)"  # no author name or address in requests (user rule)
TODAY = dt.date.today().isoformat()
REREAD_DAYS = 30
MAX_PAGES = 40
PAUSE = 1.0  # seconds between requests to the same site

QUALCOMM_SITEMAP = "https://www.qualcomm.com/sitemap.xml"
QUALCOMM_PAGE = re.compile(r"^https://www\.qualcomm\.com/smartphones/products/(?:7|8)-series/[a-z0-9-]+$")
MEDIATEK_LIST = "https://www.mediatek.com/products/smartphones/dimensity-5g"
MEDIATEK_SITEMAP = "https://www.mediatek.com/sitemap.xml"
MEDIATEK_PAGE = re.compile(r"^https://www\.mediatek\.com/products/smartphones/(?:mediatek-)?dimensity-\d[a-z0-9-]*$")
SAMSUNG_SITEMAP = "https://semiconductor.samsung.com/sitemap.xml"
SAMSUNG_PAGE = re.compile(r"^https://semiconductor\.samsung\.com/processor/mobile-processor/exynos-[12]\d{3}[a-z]?/$")
SAMSUNG_SPEC = "https://semiconductor.samsung.com/aemapi/semi/prdSpecInfo?siteCode=global&iaId={code}&prdId="

# --------------------------------------------------------------------------------------------- fetching, politely
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_last: dict[str, float] = {}


def allowed(url: str) -> bool:
    host = urlparse(url).netloc
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(f"https://{host}/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                rp.parse(r.read().decode("utf-8", "replace").splitlines())
            _robots[host] = rp
        except (urllib.error.URLError, TimeoutError, OSError):
            _robots[host] = None  # robots.txt unreadable: leave the site alone this run
    rp = _robots[host]
    return bool(rp and rp.can_fetch(UA, url))


def fetch(url: str, timeout: int = 40) -> str | None:
    if not allowed(url):
        return None
    host = urlparse(url).netloc
    wait = PAUSE - (time.monotonic() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.monotonic()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def page_text(raw: str) -> str:
    t = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", raw)
    t = html.unescape(re.sub(r"<[^>]+>", " | ", t))
    t = re.sub(r"(\s*\|\s*)+", " | ", t)
    return re.sub(r"\s+", " ", t)


def tidy(s: str) -> str:
    s = re.sub(r"[®™]|\(R\)|\(TM\)", "", s)
    return re.sub(r"\s+", " ", s).strip(" ,;|")


def title_of(raw: str) -> str:
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
    return tidy(html.unescape(m.group(1))) if m else ""


# --------------------------------------------------------------------------------------------- names
def chip_key(name: str) -> str:
    """Same key as tools/auto_devices.py (Hub.chip_key), so both tools agree on what is already on the site."""
    t = re.sub(r"(?i)qualcomm|mediatek|®|™|mobile platform|processor|chipset|octa-core|\bchip\b|\bapple\b", "", name)
    return re.sub(r"[^a-z0-9+]", "", t.lower())


def chip_id(name: str) -> str:
    s = name.lower().replace("+", " plus ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def clean_name(vendor: str, title: str) -> str | None:
    """The chip's name from the page title ("MediaTek | Dimensity 9500 | Flagship 5G Mobile Chipset",
    "Snapdragon 8 Elite Gen 5 | Snapdragon", "Exynos 2600 | Mobile Processor | ...")."""
    pattern = {"qualcomm": r"^Snapdragon \d.*", "mediatek": r"^Dimensity \d{3,4}\b.*", "samsung": r"^Exynos \d{4}[A-Za-z]?$"}[vendor]
    for part in title.split("|"):
        t = re.sub(r"(?i)\b(?:qualcomm|mediatek|samsung)\b", "", tidy(part))
        t = re.sub(r"(?i)\b(?:5g\s+)?mobile platform\b|\bmobile processor\b|\bprocessor\b|\bplatform\b", "", t)
        t = re.sub(r"\s+", " ", t).strip(" -")
        if re.match(pattern, t):
            return t
    return None


def too_old_by_rule(name: str) -> str | None:
    if re.match(r"^Snapdragon [78]\d\d", name):
        return "three-digit Snapdragon names were last used in 2022"
    if re.match(r"^Exynos 9\d{3}", name):
        return "Exynos 9000-series names were last used before 2023"
    return None


class Known:
    """Every chip already on the site, by key: hand-entered files, chips named by automatically added phones, and chips
    this tool has added."""

    def __init__(self, state: dict):
        self.by_key: dict[str, str] = {}
        self.records: dict[str, dict] = {}
        self.hand: set[str] = set()
        for p in sorted((DATA / "chipsets").glob("*.json")):
            c = json.loads(p.read_text(encoding="utf-8"))
            self.records[c["id"]] = c
            self.hand.add(c["id"])
            for n in [c["name"], *c.get("aliases", [])]:
                self.by_key.setdefault(chip_key(n), c["id"])
        try:
            auto = json.loads(NEW_DEVICES.read_text(encoding="utf-8")).get("chipsets") or {}
        except (OSError, ValueError):
            auto = {}
        for c in [*auto.values(), *(state.get("added") or {}).values()]:
            if isinstance(c, dict) and c.get("id") and c.get("name"):
                self.records.setdefault(c["id"], c)
                self.by_key.setdefault(chip_key(c["name"]), c["id"])

    def find(self, name: str) -> str | None:
        return self.by_key.get(chip_key(name))


# --------------------------------------------------------------------------------------------- reading the pages
def cluster_list(items: list[str]) -> list[dict]:
    """'1x Arm C1-Ultra, 2MB L2 cache' / 'C1-Prox3 3.25 GHz' / 'Cortex-A78 2.4GHz x4' -> [{count, core, ghz}]."""
    out = []
    for item in items:
        item = tidy(item)
        count = 1
        m = re.match(r"^(\d+)\s*x\s+(.*)$", item, re.I)
        if m:
            count, item = int(m.group(1)), m.group(2)
        m = re.search(r"\s*x\s*(\d+)\b", item)
        if m:
            count, item = int(m.group(1)), (item[:m.start()] + " " + item[m.end():])
        ghz = None
        m = re.search(r"(?:up to\s*|@\s*)?(\d+(?:\.\d+)?)\s*GHz", item, re.I)
        if m:
            ghz, item = float(m.group(1)), item[:m.start()] + item[m.end():]
        core = re.split(r",|\bwith\b", item)[0]
        core = re.sub(r"(?i)\b(?:up to|at)\b", "", core).strip(" ,")
        if not core or not re.search(r"[A-Za-z]", core) or re.search(r"(?i)cache|MB|KB", core):
            continue
        core = re.sub(r"^C([AX])(\d{3})\b", r"Cortex-\1\2", core)  # Samsung writes "CA720" for Arm Cortex-A720
        if re.match(r"(?i)^(?:cortex|c\d)", core):
            core = "Arm " + core
        if not (1 <= count <= 12) or (ghz is not None and not 0.5 <= ghz <= 6.0):
            return []
        out.append({"count": count, "core": core, **({"ghz": ghz} if ghz is not None else {})})
    return out


CORES = {"dual": 2, "quad": 4, "hexa": 6, "octa": 8, "nona": 9, "deca": 10, "dodeca": 12}


def cores_of(text: str) -> int | None:
    m = re.search(r"\((\d+)\)", text) or re.search(r"^\s*(\d+)\b", text)
    if m:
        return int(m.group(1))
    w = re.match(r"(?i)\s*(dual|quad|hexa|octa|nona|deca|dodeca)", text)
    return CORES[w.group(1).lower()] if w else None


def node_of(text: str) -> str | None:
    m = re.search(r"(\d+(?:\.\d+)?)\s*nm", text, re.I)
    return f"{m.group(1)} nm" if m else None


def read_mediatek(raw: str) -> dict:
    t = page_text(raw)
    i = t.find("Specifications | CPU |")
    if i < 0:
        return {}
    toks = [x.strip() for x in t[i:i + 6000].split("|")][2:]
    labels = {"Processor", "Cores", "CPU Frequency", "Max CPU Frequency", "Max CPU frequency", "Memory Type", "Max Memory Frequency",
              "Storage Type", "GPU Type", "AI Processing Unit", "Process", "Manufacturing Process", "Cellular Technologies",
              "Specific Functions", "Memory & Storage", "Connectivity", "Graphics", "Camera", "Video", "Display", "AI", "Products",
              "Wi-Fi", "Bluetooth", "GNSS", "Max Camera Sensor Supported", "Max Refresh Rate", "Max Display Resolution"}
    fields: dict[str, list[str]] = {}
    cur = None
    for tok in toks:
        if tok in labels:
            cur = tok
            fields.setdefault(cur, [])
        elif cur and tok:
            fields[cur].append(tok)
    spec: dict = {}
    clusters = cluster_list(fields.get("Processor", []))
    cores = cores_of(" ".join(fields.get("Cores", [])))
    if clusters and (cores is None or sum(c["count"] for c in clusters) == cores):
        spec["cpu"] = {"cores": sum(c["count"] for c in clusters), "clusters": clusters}
    elif cores:
        spec["cpu"] = {"cores": cores}
    freq = " ".join(fields.get("Max CPU Frequency", []) or fields.get("Max CPU frequency", []) or fields.get("CPU Frequency", []))
    m = re.search(r"(\d+(?:\.\d+)?)\s*GHz", freq)
    if m and "cpu" in spec and not any("ghz" in c for c in spec["cpu"].get("clusters", [])):
        spec["cpu"]["note"] = f"Up to {float(m.group(1)):g} GHz"
    if fields.get("GPU Type"):
        spec["gpu"] = {"name": tidy(fields["GPU Type"][0])}
    if fields.get("AI Processing Unit") and re.search(r"\d", fields["AI Processing Unit"][0]):
        spec["npu"] = tidy(re.sub(r"\(.*?\)", "", fields["AI Processing Unit"][0]))
    if fields.get("Memory Type"):
        spec["memory"] = tidy(", ".join(fields["Memory Type"][:2]))
    if fields.get("Storage Type"):
        spec["storage"] = tidy(", ".join(fields["Storage Type"][:2]))
    node = node_of(" ".join(fields.get("Process", []) + fields.get("Manufacturing Process", [])))
    if node:
        spec["process"] = {"node": node}
    return spec


def read_qualcomm(raw: str) -> dict:
    props: dict[str, str] = {}
    for block in re.findall(r'(?s)<script[^>]*application/ld\+json[^>]*>(.*?)</script>', raw):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        stack = [data]
        while stack:
            n = stack.pop()
            if isinstance(n, dict):
                if n.get("name") == "Specifications":
                    for part in n.get("hasPart") or []:
                        group = tidy(str(part.get("name", "")))
                        for p in part.get("additionalProperty") or []:
                            props[f"{group}::{tidy(str(p.get('name', '')))}"] = tidy(str(p.get("value", "")))
                stack.extend(n.values())
            elif isinstance(n, list):
                stack.extend(n)
    spec: dict = {}
    cpu_name = props.get("CPU::Name", "")
    clock = props.get("CPU::Clock Speed", "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*GHz", clock)
    cores = props.get("CPU::Cores") or props.get("CPU::Number of Cores") or ""
    n_cores = cores_of(cores) if cores else None
    note = ", ".join(x for x in [cpu_name.replace("Qualcomm ", "").strip(), f"up to {float(m.group(1)):g} GHz" if m else ""] if x)
    if note or n_cores:
        spec["cpu"] = {**({"cores": n_cores} if n_cores else {}), **({"note": note[0].upper() + note[1:]} if note else {})}
    gpu = props.get("GPU::Name", "").replace("Qualcomm ", "").strip()
    if re.search(r"\d", gpu):  # "Adreno" alone says nothing new; "Adreno 830" does
        spec["gpu"] = {"name": gpu}
    modem = props.get("Cellular Modem-RF::Modem Name", "").replace("Qualcomm ", "Snapdragon ").strip()
    if modem:
        spec["modem"] = re.sub(r"(?i)\s*Modem-RF System$", "", modem)
    for key in ("Memory::Memory Type", "Memory::Memory Support", "Memory::Type"):
        if props.get(key):
            spec["memory"] = props[key]
            break
    for key in ("Process Technology::Process Technology", "Process::Process Technology", "CPU::Process Technology"):
        node = node_of(props.get(key, ""))
        if node:
            spec["process"] = {"node": node}
            break
    return spec


def read_samsung(raw: str) -> dict:
    m = re.search(r'id="PD06_categoryCode"[^>]*value="(\d+)"', raw) or re.search(r'value="(\d+)"[^>]*id="PD06_categoryCode"', raw)
    if not m:
        return {}
    body = fetch(SAMSUNG_SPEC.format(code=m.group(1)))
    try:
        rows = ((json.loads(body or "{}").get("prdSpecInfo") or {}).get("specList")) or []
    except ValueError:
        return {}
    val = {tidy(str(r.get("specName", ""))): tidy(re.sub(r"<[^>]+>", " ", str(r.get("specValue", "")))) for r in rows if isinstance(r, dict)}
    spec: dict = {}
    clusters = cluster_list(re.split(r",\s*(?=[A-Za-z])", val.get("CPU", ""))) if val.get("CPU") else []
    cores = cores_of(val.get("Multi-core", "")) if val.get("Multi-core") else None
    if clusters and (cores is None or sum(c["count"] for c in clusters) == cores):
        spec["cpu"] = {"cores": sum(c["count"] for c in clusters), "clusters": clusters}
    elif cores:
        spec["cpu"] = {"cores": cores}
    if val.get("GPU"):
        spec["gpu"] = {"name": re.sub(r"(?i)^samsung\s+|\s+gpu$", "", val["GPU"]).strip()}
    npu = val.get("AI") or val.get("NPU") or ""
    if re.search(r"\d", npu):  # "AI engine with NPU" alone says nothing; "32K MAC NPU" does
        spec["npu"] = npu
    # Samsung's "Modem" row lists speeds, not the modem's name, so it is not used for the modem field
    if val.get("Memory"):
        spec["memory"] = val["Memory"]
    if val.get("Storage"):
        spec["storage"] = val["Storage"]
    node = node_of(val.get("Process", ""))
    if node:
        spec["process"] = {"node": node}
    return spec


READERS = {"qualcomm": read_qualcomm, "mediatek": read_mediatek, "samsung": read_samsung}
FIELDS = ("cpu", "gpu", "npu", "modem", "memory", "storage", "process")


# --------------------------------------------------------------------------------------------- finding the pages
def sitemap_urls(url: str, keep: re.Pattern) -> list[str]:
    body = fetch(url, timeout=90)
    if not body:
        return []
    locs = [html.unescape(x).strip() for x in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", body)]
    nested = [x for x in locs if x.endswith(".xml") and urlparse(x).netloc == urlparse(url).netloc]
    found = [x for x in locs if keep.match(x)]
    for sub in nested[:30]:  # a sitemap index: follow its own sitemaps on the same site
        sub_body = fetch(sub, timeout=90) or ""
        found += [html.unescape(x).strip() for x in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", sub_body) if keep.match(html.unescape(x).strip())]
    return sorted(set(found))


def list_pages(weekly: bool) -> dict[str, str]:
    """page address -> vendor"""
    pages: dict[str, str] = {}
    for u in sitemap_urls(QUALCOMM_SITEMAP, QUALCOMM_PAGE):
        pages[u] = "qualcomm"
    for u in sitemap_urls(SAMSUNG_SITEMAP, SAMSUNG_PAGE):
        if not u.endswith("-static/"):
            pages[u] = "samsung"
    body = fetch(MEDIATEK_LIST) or ""
    for href in re.findall(r'href="([^"]+)"', body):
        u = urljoin(MEDIATEK_LIST, html.unescape(href)).split("#")[0].split("?")[0].rstrip("/")
        if MEDIATEK_PAGE.match(u):
            pages[u] = "mediatek"
    if weekly:
        for u in sitemap_urls(MEDIATEK_SITEMAP, MEDIATEK_PAGE):
            pages[u.rstrip("/")] = "mediatek"
    return pages


# --------------------------------------------------------------------------------------------- checked by a person
REVIEWED = DATA / "meta" / "chip_reviewed.json"


def reviewed_chips() -> dict:
    """Version 36: chips a person has checked after the automatic check held them (data/meta/chip_reviewed.json)."""
    try:
        return json.loads(REVIEWED.read_text(encoding="utf-8")).get("chips") or {}
    except (OSError, ValueError):
        return {}


def settle_reviewed(state: dict, known: "Known") -> None:
    """A chip that now has a hand-made record, or that a person found too old, leaves the waiting and held lists."""
    reviewed = reviewed_chips()
    for cid in list(state["held"]) + list(state["awaitingAi"]):
        r = reviewed.get(cid)
        if cid in known.hand or (r and r.get("decision") == "added"):
            state["held"].pop(cid, None)
            state["awaitingAi"].pop(cid, None)
        elif r and r.get("decision") == "too old":
            state["held"].pop(cid, None)
            state["awaitingAi"].pop(cid, None)
            state["tooOld"][cid] = {"name": r.get("name", cid), "url": r.get("url"), "at": r.get("checked"),
                                    "reason": f"checked by hand: first announced {r.get('firstSeen')} (before 2023)"}


# --------------------------------------------------------------------------------------------- the run
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weekly", action="store_true", help="also read the full sitemaps (default on Mondays)")
    ap.add_argument("--dry", action="store_true", help="print what would change, save nothing")
    ap.add_argument("--limit", type=int, default=MAX_PAGES, help="chip pages read at most this run")
    ap.add_argument("--force", action="store_true", help="read again although today's reading is done")
    args = ap.parse_args()
    weekly = args.weekly or dt.date.today().weekday() == 0

    try:
        state = json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    # the workflow runs every 3 hours; chip makers' pages are read once a day
    if (state.get("runs") or {}).get("recent", "")[:10] == dt.datetime.now(dt.timezone.utc).date().isoformat() and not (args.force or args.dry):
        print("[chips] the chip makers' pages were already read today")
        return 0
    for k in ("pages", "fill", "added", "awaitingAi", "held", "tooOld"):
        state.setdefault(k, {})
    known = Known(state)
    settle_reviewed(state, known)

    pages = list_pages(weekly)
    if not pages:
        print("[chips] no chip maker's list could be read this run; nothing changed")
        return 0
    for u, vendor in pages.items():
        state["pages"].setdefault(u, {"vendor": vendor, "found": TODAY})

    def due(u: str) -> bool:
        last = state["pages"][u].get("read")
        return not last or (dt.date.fromisoformat(TODAY) - dt.date.fromisoformat(last)).days >= REREAD_DAYS

    todo = sorted((u for u in pages if due(u)), key=lambda u: state["pages"][u].get("read") or "")[: args.limit]
    read = added_fill = new_wait = 0
    for u in todo:
        vendor = pages[u]
        raw = fetch(u)
        if not raw:
            continue
        read += 1
        entry = state["pages"][u]
        entry["read"] = TODAY
        name = clean_name(vendor, title_of(raw))
        if not name:
            entry["skip"] = "no chip name in the page title"
            continue
        entry["name"] = name
        entry.pop("skip", None)
        spec = READERS[vendor](raw)
        cid = known.find(name)
        if cid:
            rec = known.records.get(cid, {})
            missing = {k: v for k, v in spec.items() if k in FIELDS and k not in rec}
            if cid in state["added"]:  # a chip this tool added keeps its maker's newest details
                missing = {k: v for k, v in spec.items() if k in FIELDS}
            if missing:
                state["fill"][cid] = {"fields": missing, "url": u, "source": vendor, "checked": TODAY}
                added_fill += 1
            elif cid in state["fill"] and state["fill"][cid]["url"] == u:
                state["fill"][cid]["checked"] = TODAY
            entry["chip"] = cid
            continue
        new_id = chip_id(name)
        if new_id in state["tooOld"] or new_id in state["held"] or new_id in reviewed_chips():
            continue
        old = too_old_by_rule(name)
        if old:
            state["tooOld"][new_id] = {"name": name, "url": u, "reason": old, "at": TODAY}
            continue
        record = {"id": new_id, "name": name, "vendor": vendor,
                  "summary": f"Added automatically from {'Samsung Semiconductor' if vendor == 'samsung' else vendor.title() if vendor != 'mediatek' else 'MediaTek'}'s own product page.",
                  **{k: v for k, v in spec.items() if k in FIELDS},
                  "provenance": {"default": {"class": "official", "source": vendor, "url": u, "checked": TODAY,
                                             "note": "Read automatically from the chip maker's product page."}},
                  "auto": True}
        if new_id not in state["awaitingAi"]:
            state["awaitingAi"][new_id] = {"record": record, "url": u, "since": TODAY}
            new_wait += 1
        else:
            state["awaitingAi"][new_id]["record"] = record

    # chips added earlier whose page has gone keep their record; a fill whose chip has since been entered by hand with
    # those fields drops them in build.py (hand-entered data always wins)
    state["updatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    state.setdefault("runs", {})["recent"] = state["updatedAt"]
    summary = (f"[chips] {len(pages)} chip pages listed, {read} read; {added_fill} chip(s) with new details from their maker; "
               f"{new_wait} new chip(s) waiting for the AI check; {len(state['awaitingAi'])} waiting in all, "
               f"{len(state['held'])} held for a person, {len(state['added'])} added so far")
    print(summary)
    if args.dry:
        print(json.dumps({"fill": state["fill"], "awaitingAi": {k: v["record"]["name"] for k, v in state["awaitingAi"].items()},
                          "tooOld": {k: v["name"] for k, v in state["tooOld"].items()}}, ensure_ascii=False, indent=1)[:6000])
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
