"""Version 20: new phones and tablets join the site by themselves, and makers' spec pages are re-read automatically.

    python tools/auto_devices.py                       look for new models (daily) and re-read spec pages (weekly)
    python tools/auto_devices.py --only new|fill       one part only
    python tools/auto_devices.py --force               ignore the schedule
    python tools/auto_devices.py --dry                 print what would change; write nothing

New models. Each maker's Malaysian sitemap is read (only where robots.txt allows it). The first time a maker is read, every
page already listed is only remembered, so old or deliberately left-out models are never added. A specification page that
appears later is a new model: the page is read with the same fixed patterns used for the hand-reviewed records
(tools/v6-import/extract.py) and the device is added when
  - the page is the maker's own Malaysian page, loads without being redirected, and names the model in its title;
  - the name on the page matches the page address, and no device in the hub already has that name (special editions of a
    model in the hub are left out);
  - the core specifications are on the page (screen size, battery, and the chip or main camera) and every value passes
    range checks (a value outside the range is left out, never guessed).
Apple: Apple Support Malaysia lists every iPhone and iPad with its own tech-specs page (support.apple.com/en-my/docs/
iphone and /ipad); a model that appears there is read from its tech-specs page. Samsung: samsung.com/my draws its spec
pages in the browser and Samsung's spec service doesn't allow automated reading, so a new Galaxy phone or tablet is read
from Samsung Newsroom Malaysia's own launch announcement (collected with the headlines), including the Malaysian price
when the announcement states one. Models the news is talking about (live/spotted.json) are also looked up on Xiaomi's
Malaysian site (no sitemap) by its address pattern. Anything that fails a check is listed as held, with the reason,
for a person to look at. Version 22: only models from 2023 on join. Apple's own identify-your-model pages give each iPhone's
and iPad's year; for other makers a model numbered below the oldest of its series in the hub (e.g. "Reno 8" when the hub's
oldest Reno is a 2023 model) is left out (listed under tooOld), or held for a person when that oldest one is newer than 2023.
A model added earlier that fails this check is taken off again on the next run. The announced date comes from the
collected launch news (launch_date: the maker's newsroom, else the earliest launch report a second publication confirms
within a week; "now available" gives the release date); without one it is the day the maker's site first listed the model. Added devices are labelled "Added automatically" and cite the maker's page for every value; the
announced date is the day the model first appeared on the maker's Malaysian site (labelled as such). A hand-made record
with the same id always replaces the automatic one.

Spec pages re-read. About once a week up to --fill-limit official spec pages cited by devices in the hub are read again
(rotating, so each is re-read about once a month). A value the record doesn't have yet is filled from the page (labelled);
a value that differs from the recorded one is never changed automatically: it is listed as "maker page now says" for a
person to check.

Output: live/auto/new_devices.json (the build applies it; tools/devices_all.py shares it with the other tools).
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tools" / "v6-import"))
from devices_all import AUTO_DEVICES, data_devices, read_auto  # noqa: E402
from extract import extract, text_of  # noqa: E402
from chips import clean_name, chip_id as chip_slug, vendor_of, family_of  # noqa: E402

UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0)"  # Version 25: no author name or address in requests (user)
DELAY = {"www.honor.com": 30}     # HONOR's robots.txt asks for 30 seconds between requests
DEFAULT_DELAY = 2.0
SCHEDULE_HOURS = {"new": 20, "fill": 160}
SPOTTED = ROOT / "live" / "spotted.json"
TODAY = dt.date.today().isoformat()

# ------------------------------------------------------------------------------------------------ makers
# Each maker: its Malaysian sitemap(s) and how a specification page address looks. `cat` turns the section and address
# into a category (only phones and tablets are added automatically; other pages are ignored).
PHONE_TABLET = ("smartphone", "tablet")


def _pad_or(default):
    return lambda section, slug: "tablet" if re.search(r"(^|-)pad", slug) else default


MAKERS = {
    "oppo": {"site": "OPPO Malaysia", "source": "oppo", "sitemaps": ["https://www.oppo.com/my/sitemap.xml"],
             "spec": re.compile(r"^https://www\.oppo\.com/my/(smartphones/series-[^/]+|accessories)/([^/]+)/specs/?$"),
             "cat": lambda section, slug: "smartphone" if section.startswith("smartphones") else ("tablet" if "pad" in slug else None)},
    "honor": {"site": "HONOR Malaysia", "source": "honor", "sitemaps": ["https://www.honor.com/my/sitemap.xml"],
              "spec": re.compile(r"^https://www\.honor\.com/my/(phones|tablets)/([^/]+)/spec/?$"),
              "cat": lambda section, slug: "tablet" if section == "tablets" else "smartphone"},
    "huawei": {"site": "Huawei Malaysia", "source": "huawei", "sitemaps": ["https://consumer.huawei.com/my/sitemap.xml"],
               "spec": re.compile(r"^https://consumer\.huawei\.com/my/(phones|tablets)/([^/]+)/specs/?$"),
               "cat": lambda section, slug: "tablet" if section == "tablets" else "smartphone"},
    "vivo": {"site": "vivo Malaysia", "source": "vivo", "sitemaps": ["https://www.vivo.com/my/sitemap.xml"],
             "spec": re.compile(r"^https://www\.vivo\.com/my/(products/param)/([a-z0-9-]+)$"),
             "cat": lambda section, slug: None if re.search(r"watch|tws|buds", slug) else _pad_or("smartphone")(section, slug)},
    "realme": {"site": "realme Malaysia", "source": "realme", "sitemaps": ["https://www.realme.com/sitemap-my.xml"],
               "spec": re.compile(r"^https://www\.realme\.com/(my)/([a-z0-9-]+)/specs/?$"),
               "cat": lambda section, slug: None if re.search(r"buds|watch|band", slug) else _pad_or("smartphone")(section, slug)},
    "oneplus": {"site": "OnePlus Malaysia", "source": "oneplus", "sitemaps": ["https://www.oneplus.com/my/sitemap.xml"],
                "spec": re.compile(r"^https://www\.oneplus\.com/(my)/([a-z0-9-]+)/specs/?$"),
                "product": re.compile(r"^https://www\.oneplus\.com/my/((?:oneplus-)?(?:nord-)?(?:ce-?\d*-?)?(?:pad-)?[0-9][a-z0-9-]*)$"),
                "cat": lambda section, slug: None if re.search(r"buds|watch|band", slug) else _pad_or("smartphone")(section, slug)},
}
# Makers with no usable sitemap: models the news is talking about are looked up by address pattern.
GUESS = {
    "xiaomi": {"site": "Xiaomi Malaysia", "source": "xiaomi", "url": "https://www.mi.com/my/product/{slug}/specs/", "brands": {"xiaomi", "redmi", "poco"}},
}
APPLE_INDEX = {"smartphone": "https://support.apple.com/en-my/docs/iphone", "tablet": "https://support.apple.com/en-my/docs/ipad"}
# Version 22: the hub covers models from 2023 on. Apple's own "Identify your iPhone / iPad model" pages give the year each
# model was introduced ("Year introduced: 2022" / "Year: 2022"); Apple's lists of tech-specs pages don't, and an old
# model that reappears there must not join as new (seen 28 Sep 2026: the 2022 iPad Pro models).
START_YEAR = 2023
APPLE_YEARS = ["https://support.apple.com/en-my/108044", "https://support.apple.com/en-my/108043"]
SAMSUNG_MY = re.compile(r"^https://news\.samsung\.com/my/")
GALAXY = re.compile(r"\bGalaxy\s+((?:Z\s+(?:Fold|Flip)\s?\d+(?:\s+(?:Ultra|FE|Special Edition))?)|(?:S\d{2}(?:\s*(?:Ultra|Edge|FE|Plus|\+))?)|"
                    r"(?:Tab\s+[AS]\d{1,2}(?:\s*(?:Ultra|FE|Lite|Plus|\+))?)|(?:[AM]\d{2,3}(?:\s*5G)?))(?![\w+])")
NOT_LAUNCH = re.compile(r"One UI|update|rollout|security|trade-?in|repair|offer|promotion|campaign|contest|how to|tips|\[Video\]|"
                        r"\[Infographic\]|interview|review|award|recogni[sz]ed|switch to|unpacked\]", re.I)
SOURCE_OF_BRAND = {"xiaomi": "xiaomi", "redmi": "redmi", "poco": "poco"}
BRAND_WORDS = {"oppo": "OPPO", "honor": "HONOR", "huawei": "Huawei", "vivo": "vivo", "realme": "realme", "oneplus": "OnePlus",
               "xiaomi": "Xiaomi", "redmi": "REDMI", "poco": "POCO", "apple": "", "iqoo": "iQOO"}
EDITION = re.compile(r"\b(edition|molly|kids|giveaway|terms|bundle|combo|aston ?martin|got|special|limited|collector|harry potter|"
                     r"porsche design|disney|anniversary|eco)\b", re.I)
NOT_MODEL = re.compile(r"\b(compare|accessor|case|cover|charger|cable|adapter|protector|support|offer|promotion|trade|store)\b", re.I)

# Values outside these ranges are left out, never guessed (per category).
RANGES = {
    "smartphone": {"display.size_in": (4.5, 8.6), "battery.capacity_mah": (2800, 12000), "build.weight_g": (90, 340),
                   "charging.wired_w": (5, 250), "charging.wireless_w": (5, 100), "display.refresh_hz": (60, 240),
                   "display.peak_nits": (300, 8000)},
    "tablet": {"display.size_in": (7, 15.5), "battery.capacity_mah": (3500, 16000), "build.weight_g": (220, 900),
               "charging.wired_w": (5, 250), "charging.wireless_w": (5, 100), "display.refresh_hz": (60, 240),
               "display.peak_nits": (300, 8000)},
}
FILL_FIELDS = ["display.size_in", "display.resolution", "display.refresh_hz", "display.peak_nits", "battery.capacity_mah",
               "charging.wired_w", "charging.wireless_w", "memory.ram_gb", "memory.storage_gb", "build.weight_g", "build.ip",
               "platform.chipset"]
VIRTUAL_RAM = re.compile(r"RAM\s*Turbo|Extended\s*RAM|virtual\s*RAM|RAM\s*expansion|Dynamic\s*RAM|RAM\s*Plus|Memory\s*Extension|Extended\s*memory", re.I)
FILL_HOSTS = re.compile(r"^https://(www\.(oppo|honor|vivo|realme|mi)\.com|consumer\.huawei\.com|support\.apple\.com/en-my/\d+$)")


# ------------------------------------------------------------------------------------------------ fetching
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_robots_unread: set[str] = set()   # Version 24: robots.txt could not be read (timeout, server error): try again later
_last: dict[str, float] = {}


def refusal(url: str) -> str:
    """Why a page may not be read: robots.txt says no, or robots.txt could not be read (then a later run tries again)."""
    parts = urllib.parse.urlsplit(url)
    if f"{parts.scheme}://{parts.netloc}" in _robots_unread:
        return "page not available (HTTP error: robots.txt could not be read; trying again on a later run)"
    return "robots.txt does not allow this page"


def allowed(url: str) -> bool:
    parts = urllib.parse.urlsplit(url)
    key = f"{parts.scheme}://{parts.netloc}"
    if key not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            with urllib.request.urlopen(urllib.request.Request(key + "/robots.txt", headers={"User-Agent": UA}), timeout=25) as r:
                rp.parse(r.read().decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError as e:
            if e.code >= 500:
                rp = None          # a server error on robots.txt means: don't fetch
                _robots_unread.add(key)
            else:
                rp.parse([])       # a missing robots.txt allows everything
        except Exception:
            rp = None
            _robots_unread.add(key)
        _robots[key] = rp
    rp = _robots[key]
    if rp and (rp.crawl_delay(UA) or 0) > DELAY.get(parts.netloc, DEFAULT_DELAY):
        DELAY[parts.netloc] = float(rp.crawl_delay(UA))
    return bool(rp and rp.can_fetch(UA, url))


def fetch(url: str) -> tuple[int, str, str]:
    """(status, final URL, text). One request at a time, with each host's delay; never retried in a loop."""
    host = urllib.parse.urlsplit(url).netloc
    wait = DELAY.get(host, DEFAULT_DELAY) - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-MY,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            status, final = r.status, r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception as e:  # noqa: BLE001
        return 0, url, str(e)[:120]
    finally:
        _last[host] = time.time()
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return status, final, body.decode("utf-8", "replace")


def sitemap_urls(url: str, depth: int = 0) -> list[str]:
    if not allowed(url):
        raise PermissionError(f"robots.txt does not allow {url}")
    status, _, text = fetch(url)
    if status != 200:
        raise OSError(f"sitemap {url}: HTTP {status}")
    locs = [html.unescape(u) for u in re.findall(r"<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*</loc>", text)]
    if "<sitemapindex" in text and depth == 0:
        out = []
        for sub in locs:
            if re.search(r"/my[/_-]|/my\.xml|product|page|b2c", sub, re.I):
                out += sitemap_urls(sub, 1)
        return out
    return locs


def same_page(asked: str, final: str) -> bool:
    norm = lambda u: re.sub(r"(\.html?|/)$", "", urllib.parse.urlsplit(u)._replace(query="", fragment="").geturl().lower())
    return norm(asked) == norm(final)


# ------------------------------------------------------------------------------------------------ names and matching
def key(text: str) -> str:
    t = text.lower().replace("+", " plus ").replace("&", " and ")
    t = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", t)
    return re.sub(r"[^a-z0-9]", "", t)


def meta(page: str, prop: str) -> str | None:
    m = (re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]+content=["\']([^"\']+)' % re.escape(prop), page, re.I)
         or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']%s["\']' % re.escape(prop), page, re.I))
    return html.unescape(m.group(1)).strip() if m else None


def page_title(page: str) -> str:
    t = meta(page, "og:title")
    if not t:
        m = re.search(r"<title[^>]*>([^<]{2,200})</title>", page, re.I)
        t = html.unescape(m.group(1)).strip() if m else ""
    return re.sub(r"\s+", " ", t.replace("‑", "-")).strip()


def model_from_title(title: str, brand: str) -> str | None:
    """'OPPO Reno16 F 5G - Specifications | OPPO Malaysia' -> 'OPPO Reno16 F 5G'. None when the title names no model."""
    t = re.split(r"\s+[|｜–—]\s+|\s+-\s+(?:Specs?|Specifications?|Tech(?:nical)? Specs|Technical|HONOR|HUAWEI|realme|Xiaomi|Apple|vivo)\b", title)[0]
    t = re.sub(r"^Specifications? of\s+", "", t, flags=re.I)
    t = re.sub(r"\s*[-–]?\s*(Mobile Phone\s+|Smartphone\s+)?(Full\s+)?(Tech(nical)?\s+)?(Specs?|Specifications?)"
               r"(\s*(,|&|and)\s*(Features|Price))*\s*$", "", t, flags=re.I)
    t = re.sub(r"\s+(Smartphone|Tablet|Mobile Phone)$", "", t, flags=re.I)
    t = re.sub(r"-\d+MP\b.*$", "", t)                        # vivo: "vivo V60-50MP ZEISS Camera, 6500mAh Battery-Specs"
    t = t.strip(" -|")
    if not t or not re.search(r"\d|Air|Pro|Ultra|Max|Mini|Fold|Flip", t) or len(t) > 48 or re.search(r"Malaysia|Official", t, re.I):
        return None
    word = BRAND_WORDS.get(brand, "")
    t = re.sub(r"^(HUAWEI|Huawei)\b", "Huawei", t)
    t = re.sub(r"^(Realme|REALME)\b", "realme", t)
    t = re.sub(r"^(Vivo|VIVO)\b", "vivo", t)
    t = re.sub(r"^(Oppo)\b", "OPPO", t)
    t = re.sub(r"^(Honor)\b", "HONOR", t)
    t = re.sub(r"^(Redmi)\b", "REDMI", t)
    t = re.sub(r"^(Poco)\b", "POCO", t)
    t = re.sub(r"^(Oneplus|ONEPLUS)\b", "OnePlus", t)
    if word and not t.lower().startswith(word.lower()) and brand not in ("xiaomi", "redmi", "poco"):
        t = f"{word} {t}"
    return t


def slug_matches(slug: str, name: str, brand: str) -> bool:
    """The page address and the name on the page describe the same model ('reno16-f-5g' and 'OPPO Reno16 F 5G')."""
    s = key(re.sub(r"(?i)^(oneplus|realme|honor|huawei|oppo|vivo)-", "", slug))
    n = key(name)
    for w in ("oppo", "honor", "huawei", "vivo", "realme", "oneplus", "xiaomi", "redmi", "poco"):
        n = n.removeprefix(w)
        s = s.removeprefix(w)
    s5, n5 = s.removesuffix("5g"), n.removesuffix("5g")
    return bool(s) and (s == n or s5 == n5 or s5 == n or s == n5)


def series_of(name: str, brand: str, brands: dict) -> tuple[str, int] | None:
    """("reno", 8) for "OPPO Reno8 T", ("galaxy a", 5) for "Galaxy A05", ("", 13) for "Xiaomi 13T Pro". A number with a
    decimal part is a screen size ("MatePad 11.5"), not a generation: None."""
    n = name.lower()
    for w in (str(brands.get(brand, "")).lower(), brand):
        if w and n.startswith(w + " "):
            n = n[len(w) + 1:]
    m = re.match(r"^([a-z]+(?: [a-z]+)*?)?\s*(\d{1,3})(?![\d.])(?:\b|[a-z])", n)
    return ((m.group(1) or "").strip(), int(m.group(2))) if m else None


def apple_years(log) -> dict[str, int] | None:
    """Model name key -> year introduced, from Apple's own identify-your-model pages. None when they can't be read."""
    years: dict[str, int] = {}
    for url in APPLE_YEARS:
        if not allowed(url):
            log(f"[devices] apple: robots.txt does not allow {url}")
            return None
        status, _, page = fetch(url)
        if status != 200:
            log(f"[devices] apple: {url} not read (HTTP {status or 'error'})")
            return None
        lines = [x.strip() for x in html.unescape(re.sub(r"<[^>]+>", "\n", page)).split("\n") if x.strip()]
        for prev, line in zip(lines, lines[1:]):
            m = re.match(r"Year(?: introduced)?:\s*(\d{4})", line)
            if m and re.match(r"^(iPhone|iPad)\b", prev):
                years.setdefault(key(prev.replace("‑", "-")), int(m.group(1)))
    return years or None


class Hub:
    """Names, pages and chips already in the hub."""

    def __init__(self, auto: dict) -> None:
        self.brands = {b["id"]: b["name"] for b in json.loads((DATA / "brands" / "brands.json").read_text(encoding="utf-8"))}
        self.devices = data_devices()
        self.ids = {d["id"] for d in self.devices} | set((auto.get("devices") or {}).keys())
        self.names: dict[str, str] = {}
        self.urls: set[str] = set()
        for d in self.devices + list((auto.get("devices") or {}).values()):
            bname = self.brands.get(d.get("brand"), "")
            for n in [d["name"], f"{bname} {d['name']}", *d.get("aliases", [])]:
                if len(key(n)) > 3:
                    self.names.setdefault(key(n), d["id"])
                    self.names.setdefault(key(n).removesuffix("5g"), d["id"])
            prov = d.get("provenance") or {}
            for p in [prov.get("default") or {}, *(prov.get("fields") or {}).values()]:
                if p.get("url"):
                    self.urls.add(p["url"].rstrip("/").lower())
        self.chips: dict[str, str] = {}
        for p in (DATA / "chipsets").glob("*.json"):
            c = json.loads(p.read_text(encoding="utf-8"))
            for n in [c["name"], *c.get("aliases", [])]:
                self.chips[self.chip_key(n)] = c["id"]
        for c in (auto.get("chipsets") or {}).values():
            self.chips.setdefault(self.chip_key(c["name"]), c["id"])
        # Version 22: numbered series among the hand-checked records ("OPPO Reno" 8, 10, 11 …), for the too-old check
        self.series: dict[tuple, list[tuple[int, str, str]]] = {}
        for d in self.devices:
            s = series_of(d["name"], d.get("brand", ""), self.brands)
            if s and d.get("category") in PHONE_TABLET:
                self.series.setdefault((d["brand"], d["category"], s[0]), []).append((s[1], str(d.get("announced") or "")[:4], d["name"]))

    def too_old(self, name: str, brand: str, cat: str) -> tuple[str, str] | None:
        """("old", why) when the model is numbered below the oldest of its series in the hub and that one is from the
        hub's first year (so this one is older still); ("hold", why) when it is numbered below a newer oldest one (it may
        be a 2023+ model the hub doesn't have: a person decides). None when the name gives no such sign."""
        named_year = re.search(r"\((20\d\d)\)", name)       # "Galaxy Tab S6 Lite (2024)": the name gives the year
        if named_year:
            return ("old", f"its name gives the year {named_year.group(1)}; the hub covers {START_YEAR} on") if int(named_year.group(1)) < START_YEAR else None
        s = series_of(name, brand, self.brands)
        known = self.series.get((brand, cat, s[0])) if s else None
        if not known:
            return None
        num, year, oldest = min(known)
        if s[1] >= num:
            return None
        if year and year <= str(START_YEAR):
            return "old", f"numbered below the {oldest} ({year}), the oldest of its series in the hub, which covers {START_YEAR} on"
        return "hold", f"numbered below the {oldest}, the oldest of its series in the hub; it may be older than {START_YEAR}"

    @staticmethod
    def chip_key(name: str) -> str:
        t = re.sub(r"(?i)qualcomm|mediatek|®|™|mobile platform|processor|chipset|octa-core|\bchip\b|\bapple\b", "", name)
        return re.sub(r"[^a-z0-9+]", "", t.lower())

    def existing(self, name: str) -> str | None:
        k = key(name)
        return self.names.get(k) or self.names.get(k.removesuffix("5g"))

    def chip(self, raw: str) -> tuple[str | None, dict | None]:
        """(chip id, new minimal chip record or None). Unknown vendors are left out."""
        name = re.sub(r"\b(MAX|ULTRA|TURBO|ENERGY|PLUS)\b", lambda m: m.group(1).title(), clean_name(raw))
        cid = self.chips.get(self.chip_key(name)) or self.chips.get(self.chip_key(raw))
        if cid:
            return cid, None
        vendor = vendor_of(name)
        if not vendor or not re.search(r"\d", name):
            return None, None
        new_id = chip_slug(name)
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", new_id):
            return None, None
        return new_id, {"id": new_id, "name": name, "vendor": vendor, **({"family": family_of(name)} if family_of(name) else {})}


# ------------------------------------------------------------------------------------------------ reading a spec page
def get(d: dict, path: str):
    for k in path.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def put(d: dict, path: str, value) -> None:
    parts = path.split(".")
    for k in parts[:-1]:
        d = d.setdefault(k, {})
    d[parts[-1]] = value


def drop(d: dict, path: str) -> None:
    parts = path.split(".")
    for k in parts[:-1]:
        d = d.get(k) or {}
    if isinstance(d, dict):
        d.pop(parts[-1], None)


# Version 20: a number is kept only where the page puts it next to the right words. Pages also carry numbers for other
# things: "Includes an 80W charging adapter", "Touch sampling rate: 240Hz", "HBM: 1400 nits", a power bank in the menu.
CONTEXT = {
    "display.refresh_hz": (r"{v}\s*Hz", r"refresh", r"touch|sampling|PWM|dimming|scan"),
    "charging.wired_w": (r"{v}\s*W\b", r"charg|vooc|flash|hyper|fast|turbo|wired|super", r"adapter|charger\b|power\s*bank|reverse|wireless|in the box|included|includes|cable"),
    "charging.wireless_w": (r"{v}\s*W\b", r"wireless", r"reverse|adapter|charger\b|power\s*bank|stand|pad\b"),
    "display.peak_nits": (r"{v}\s*nits?", r"peak|outdoor|max(imum)? brightness", r"HBM|typical|normal|high brightness mode|manual|SDR"),
}


def said_as(text: str, path: str, value) -> bool:
    """True when the page states `value` in a segment (or right after a label segment) that names what it is."""
    if path not in CONTEXT or value is None:
        return True
    num, good, bad = CONTEXT[path]
    v = f"{value:g}" if isinstance(value, float) else str(value)
    v = re.escape(v).replace(",", ",?")
    segs = [x.strip() for x in text.split("|")]
    for i, seg in enumerate(segs):
        # the clause that holds the number ("80W FlashCharge" of "80W FlashCharge, 50W Wireless FlashCharge")
        clause = next((c for c in re.split(r"[,;，]", seg) if re.search(r"(?<![\d.])" + num.format(v=v), c, re.I)), None)
        if clause is None:
            continue
        hit = re.search(r"(?<![\d.])" + num.format(v=v), clause, re.I)
        near = clause[max(0, hit.start() - 22):hit.end() + 25]   # "45 W wired charging … with 45 W Adapter": each number on its own
        if re.search(bad, near, re.I):
            continue
        window = " ".join([seg, segs[i - 1] if i and len(segs[i - 1]) < 40 else "",
                           segs[i + 1] if i + 1 < len(segs) and len(segs[i + 1]) < 40 else ""])
        if re.search(good, window, re.I):
            return True
    return False


def memory_options(specs: dict, text: str, cat: str):
    """'12+256GB | 12+512GB | 12GB+1TB' or '8 + 128 GB': every configuration on the page, so the list isn't cut short.
    Returns the page's virtual-RAM wording, if any ('8GB + 8GB RAM Turbo' pages keep their RAM list as read)."""
    combos = re.findall(r"(?<![\d.])(\d{1,2})\s*(?:GB)?\s*\+\s*(\d{2,4}|1|2)\s*(GB|TB)\b", text)
    rams = {int(a) for a, _, _ in combos if 2 <= int(a) <= 24}
    roms = {int(b) * (1024 if u == "TB" else 1) for _, b, u in combos if 32 <= int(b) * (1024 if u == "TB" else 1) <= 2048}
    virtual = VIRTUAL_RAM.search(text)
    if cat in PHONE_TABLET and rams and roms:
        if not virtual:
            specs.setdefault("memory", {})["ram_gb"] = sorted(rams | set(get(specs, "memory.ram_gb") or []))
        specs.setdefault("memory", {})["storage_gb"] = sorted(roms | set(get(specs, "memory.storage_gb") or []))
    return virtual


def sanitize(specs: dict, cat: str, page_text: str) -> list[str]:
    """Leave out anything outside plausible ranges or read ambiguously. Returns what was left out (for the log)."""
    left = []
    for path, (lo, hi) in RANGES.get(cat, {}).items():
        v = get(specs, path)
        if v is not None and not (isinstance(v, (int, float)) and lo <= v <= hi):
            drop(specs, path); left.append(path)
    # "2,250 mAh (typical, per cell)" on dual-cell phones is half the battery: leave it out rather than halve the phone
    mah = get(specs, "battery.capacity_mah")
    if mah and re.search(r"dual[- ]cell|per cell|2\s*[x×]\s*\d|two cells|double[- ]cell", page_text, re.I) and mah < 4000:
        drop(specs, "battery.capacity_mah"); left.append("battery.capacity_mah (per cell)")
    for path in CONTEXT:
        if get(specs, path) is not None and not said_as(page_text, path, get(specs, path)):
            drop(specs, path); left.append(f"{path} (not stated as such on the page)")
    ram, rom = get(specs, "memory.ram_gb"), get(specs, "memory.storage_gb")
    if ram and not all(isinstance(x, int) and 2 <= x <= 24 for x in ram):
        drop(specs, "memory.ram_gb"); left.append("memory.ram_gb"); ram = None
    if rom and (not all(isinstance(x, int) and 32 <= x <= 2048 for x in rom) or (ram and min(rom) <= max(ram))):
        drop(specs, "memory.storage_gb"); left.append("memory.storage_gb")
    dims = get(specs, "build.dimensions")
    if dims and not (100 <= dims.get("height_mm", 0) <= 300 and 40 <= dims.get("width_mm", 0) <= 260 and 3 <= dims.get("depth_mm", 0) <= 15):
        drop(specs, "build.dimensions"); left.append("build.dimensions")
    rear = get(specs, "camera.rear")
    if rear:
        main = next((c for c in rear if c.get("role") == "main"), None)
        # a telephoto with more megapixels than the main camera is easily read as the main one: leave the list out then
        tele_mp = {int(float(m)) for m in re.findall(r"(\d{2,3})\s*MP[^|]{0,60}?(?:tele|periscope|APO)", page_text, re.I)}
        main_named = main and re.search(rf"(?<!\d){main.get('mp'):g}\s*MP[^|]{{0,50}}?(main|fusion|primary|wide(?!-?angle)|standard)", page_text, re.I)
        if not main or not (8 <= main.get("mp", 0) <= 320) or (main.get("mp") in tele_mp and not main_named):
            drop(specs, "camera.rear"); left.append("camera.rear")
    for k in [k for k, v in specs.items() if not v]:
        specs.pop(k)
    return left


def read_spec_page(url: str, brand: str, cat: str, hub: Hub, expect_slug: str | None) -> tuple[dict | None, str]:
    """(result, reason). One page's surprise never stops the run: it is reported as the reason instead."""
    try:
        return _read_spec_page(url, brand, cat, hub, expect_slug)
    except Exception as e:  # noqa: BLE001
        return None, f"the page could not be read ({type(e).__name__})"


def _read_spec_page(url: str, brand: str, cat: str, hub: Hub, expect_slug: str | None) -> tuple[dict | None, str]:
    """(result, reason). result: {name, specs, chip, newChip, final, html}."""
    if not allowed(url):
        return None, "the maker's robots.txt does not allow reading this page"
    status, final, page = fetch(url)
    if status != 200:
        return None, f"page not available (HTTP {status or 'error'})"
    if not same_page(url, final):
        return None, "the page redirects elsewhere (the model is not listed there)"
    name = model_from_title(page_title(page), brand)
    if not name:                                          # some pages have a generic title; the heading names the model
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.I | re.S)
        name = model_from_title(re.sub(r"<[^>]+>", " ", html.unescape(h1.group(1))).strip(), brand) if h1 else None
    if not name:
        return None, "the page title names no model"
    if NOT_MODEL.search(name):
        return None, "not a phone or tablet page"
    if expect_slug and not slug_matches(expect_slug, name, brand):
        return None, f"the name on the page ({name}) does not match its address"
    specs = extract(page, cat, name)
    text = " | ".join(text_of(page))
    if brand == "apple":
        if not (specs.get("platform") or {}).get("chipset_name"):
            m = re.search(r"\b(A\d{2}(?: Pro| Bionic)?|M\d(?: Pro| Max| Ultra)?) chip\b", text)
            if m:
                specs.setdefault("platform", {})["chipset_name"] = "Apple " + m.group(1)
        if True:                                          # Apple's own wording wins over the general patterns
            # "…the 11-inch iPad Air is 10.86 inches": the hub records the nominal size, as Apple names the model
            # the size in Apple's own model name comes first: one page can describe both the 11-inch and 13-inch models
            m = (re.search(r"(?<![\d.])(\d{1,2}(?:\.\d)?)-inch\b", name)
                 or re.search(r"measured diagonally as a rectangle, the (\d{1,2}(?:\.\d)?)-inch ", text)
                 or re.search(r"(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)-inch \(diagonal\)", text)
                 or re.search(r"(?<![\d.])(\d{1,2}(?:\.\d)?)-inch\b", name)
                 or re.search(r"(?<![\d.])(\d{1,2}(?:\.\d)?)-inch (?:Ultra |Liquid |Super )?Retina", text)
                 or re.search(r"the (\d{1,2}(?:\.\d)?)-inch iPad", text))
            if not m:
                # "…the screen is 10.86 inches": Apple sells it as the 11-inch model (12.9 -> 13); 8.3 stays 8.3
                exact = re.search(r"diagonally as a rectangle, the screen is (\d{1,2}\.\d{1,2}) inches", text)
                if exact:
                    v = float(exact.group(1))
                    m = re.match(r"(.*)", f"{round(v)}" if abs(v - round(v)) <= 0.2 else f"{round(v, 1):g}")
            if m:
                specs.setdefault("display", {})["size_in"] = float(m.group(1))
            else:
                (specs.get("display") or {}).pop("size_in", None)
        cap = re.search(r"Capacity\s*\d?\s*\|((?:\s*\d{1,4}\s*(?:GB|TB)\s*\|)+)", text)
        if cap:                                           # "Capacity | 256GB | 512GB | 1TB | 2TB"
            sizes = sorted({int(n) * (1024 if u == "TB" else 1) for n, u in re.findall(r"(\d{1,4})\s*(GB|TB)", cap.group(1))})
            if sizes:
                specs.setdefault("memory", {})["storage_gb"] = sizes
    virtual = memory_options(specs, text, cat)
    left = sanitize(specs, cat, text)
    if virtual and get(specs, "memory.ram_gb") and len(get(specs, "memory.ram_gb")) > 1:
        # a page that also advertises virtual RAM can list it as a second RAM size: keep RAM out rather than guess
        drop(specs, "memory.ram_gb"); left.append("memory.ram_gb (virtual RAM on the page)")
    chip_name = (specs.get("platform") or {}).pop("chipset_name", None)
    if chip_name:
        tail = re.search(re.escape(chip_name) + r"[\s-]*(Max\b|Ultra\b|Ultimate\b|Energy\b|Turbo\b|Pro\b|Plus\b|\+|Elite\b|Leading\b|Extreme\b|Apex\b)", text, re.I)
        if tail and not re.search(re.escape(tail.group(1)) + r"$", chip_name, re.I):
            left.append(f"chip ({chip_name} {tail.group(1)} on the page: name cut short)")
            chip_name = None
    cid, new_chip = hub.chip(chip_name) if chip_name else (None, None)
    if cid:
        specs.setdefault("platform", {})["chipset"] = cid
    if not specs.get("platform"):
        specs.pop("platform", None)
    return {"name": name, "specs": specs, "chip": cid, "chipName": chip_name, "newChip": new_chip, "final": final,
            "left": left, "html": page}, "ok"


def read_apple(docs_url: str, p: dict, hub: Hub) -> tuple[dict | None, str]:
    """Apple Support: the model's page links to its Tech Specs page, which is read like any other spec page."""
    try:
        if not allowed(docs_url):
            return None, refusal(url)
        status, final, page = fetch(docs_url)
        if status != 200:
            return None, f"page not available (HTTP {status or 'error'})"
        link = next((h for h, t in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', page, re.S)
                     if re.search(r"tech(nical)? spec", re.sub(r"<[^>]+>", " ", t), re.I)), None)
        if not link:
            return None, "no Tech Specs page is linked yet"
        spec_url = urllib.parse.urljoin(docs_url, html.unescape(link))
        if not re.match(r"^https://support\.apple\.com/", spec_url):
            return None, "the Tech Specs link leaves Apple Support"
    except Exception as e:  # noqa: BLE001
        return None, f"the page could not be read ({type(e).__name__})"
    got, why = read_spec_page(spec_url, "apple", p["cat"], hub, None)
    if got and key(got["name"]) != key(p["name"]):
        return None, f"the Tech Specs page names {got['name']}, not {p['name']}"
    return got, why


def samsung_prices(text: str, day: str, url: str) -> list[dict]:
    """'8GB + 256GB at RM1,299' pairs, or one plain price; anything less clear is left out."""
    pairs = re.findall(r"(\d{1,2})\s*GB\s*\+\s*(\d{2,4}|1)\s*(GB|TB)[^.|]{0,40}?RM\s?([\d,]{3,7})(?![\d,])", text)
    out = []
    for ram, rom, unit, rm in pairs:
        out.append({"config": f"{ram}/{rom}{'TB' if unit == 'TB' else ''}", "amount": int(rm.replace(",", ""))})
    if not out:
        amounts = {int(x.replace(",", "")) for x in re.findall(r"(?:available|priced|retail|purchase|price|at)\b[^.|]{0,60}?RM\s?([\d,]{3,7})(?![\d,])", text, re.I)}
        if len(amounts) == 1:
            out = [{"amount": amounts.pop()}]
    return [{"region": "MY", "currency": "MYR", "amount": o["amount"], **({"config": o["config"]} if o.get("config") else {}),
             "date": day, "type": "launch", "source": "samsung-newsroom-my", "url": url, "class": "official", "accessed": TODAY}
            for o in out if 100 <= o["amount"] <= 20000]


def robots_refuses(url: str) -> bool:
    """True only when the site's robots.txt was read and says no (not when it couldn't be read at all)."""
    allowed(url)
    parts = urllib.parse.urlsplit(url)
    rp = _robots.get(f"{parts.scheme}://{parts.netloc}")
    return bool(rp) and not rp.can_fetch(UA, url)


def archived_copy(url: str) -> str | None:
    """Version 25: the Internet Archive's copy of a page that can't be reached from the build server (Samsung Newsroom's
    server stalls automated requests, although its robots.txt allows every page). Never used when the page's own
    robots.txt says no; the Internet Archive's robots.txt is respected too. None when there is no copy."""
    if robots_refuses(url) or not allowed("https://web.archive.org/web/") or not allowed("https://archive.org/wayback/available"):
        return None
    status, _, body = fetch("https://archive.org/wayback/available?url=" + urllib.parse.quote(url, safe=""))
    try:
        snap = (json.loads(body).get("archived_snapshots") or {}).get("closest") or {} if status == 200 else {}
    except ValueError:
        snap = {}
    if not snap.get("available") or not re.fullmatch(r"\d{14}", snap.get("timestamp", "")):
        return None
    status, _, page = fetch(f"https://web.archive.org/web/{snap['timestamp']}id_/{url}")
    return page if status == 200 and page else None


def read_samsung(url: str, p: dict, hub: Hub) -> tuple[dict | None, str]:
    """A Samsung Newsroom Malaysia launch announcement: its specification table if it has one, otherwise its sentences."""
    try:
        if robots_refuses(url):
            return None, "robots.txt does not allow this page"
        status, final, page = fetch(url) if allowed(url) else (0, url, "")
        if status != 200:
            page = archived_copy(url)                    # Version 25: the same announcement, as the Internet Archive keeps it
            if not page:
                return None, (refusal(url) if not allowed(url) else f"page not available (HTTP {status or 'error'})")
            final = url
        if not same_page(url, final):
            return None, "the page redirects elsewhere"
        title = page_title(page)
        if key(p["name"]) not in key(title):
            return None, f"the announcement title does not name {p['name']}"
        if re.search(r"\bseries\b", title, re.I):          # Version 25: a series announcement covers several models
            named = sorted(i for k, i in hub.names.items() if k.startswith(key(p["name"])))
            if named:                                     # a person has added them already
                return None, f"already in the hub ({', '.join(named)})"
            return None, "the announcement names several models; left for a person"
        lines = text_of(page)
        text = " | ".join(lines)
        from extract import extract_lines, extract_article  # noqa: PLC0415
        specs = extract_lines(lines, p["cat"])
        prose = extract_article(re.sub(r"\s*\|\s*", "\n", text), p["cat"])
        for k, v in prose.items():                       # fill what the table didn't give from the sentences
            if isinstance(v, dict):
                for kk, vv in v.items():
                    specs.setdefault(k, {}).setdefault(kk, vv)
            else:
                specs.setdefault(k, v)
        virtual = memory_options(specs, text, p["cat"])
        left = sanitize(specs, p["cat"], text)
        if virtual and len(get(specs, "memory.ram_gb") or []) > 1:
            drop(specs, "memory.ram_gb"); left.append("memory.ram_gb (virtual RAM in the announcement)")
        chip_name = (specs.get("platform") or {}).pop("chipset_name", None)
        if chip_name:
            tail = re.search(re.escape(chip_name) + r"[\s-]*(Max\b|Ultra\b|Ultimate\b|Energy\b|Turbo\b|Pro\b|Plus\b|\+|Elite\b|Leading\b|Extreme\b|Apex\b)", text, re.I)
            if tail and not re.search(re.escape(tail.group(1)) + r"$", chip_name, re.I):
                chip_name = None
        cid, new_chip = hub.chip(chip_name) if chip_name else (None, None)
        if cid:
            specs.setdefault("platform", {})["chipset"] = cid
        if not specs.get("platform"):
            specs.pop("platform", None)
        day = p.get("firstSeen") or TODAY
        return {"name": "Samsung " + p["name"] if not p["name"].startswith("Samsung") else p["name"], "specs": specs, "chip": cid,
                "chipName": chip_name, "newChip": new_chip, "final": final, "left": left, "html": "",
                "prices": samsung_prices(text, day, final)}, "ok"
    except Exception as e:  # noqa: BLE001
        return None, f"the announcement could not be read ({type(e).__name__})"


def core_ok(specs: dict, cat: str, brand: str) -> str | None:
    if brand == "samsung-news":
        if not (get(specs, "display.size_in") or get(specs, "battery.capacity_mah")):
            return "the announcement gives neither the screen size nor the battery"
        if not get(specs, "platform.chipset") and not get(specs, "camera.rear"):
            return "the announcement gives neither the chip nor the cameras in a form that could be read"
        return None
    if not get(specs, "display.size_in"):
        return "the page gives no screen size that could be read"
    if not get(specs, "battery.capacity_mah") and brand != "apple":
        return "the page gives no battery capacity that could be read"
    if not get(specs, "platform.chipset") and not get(specs, "camera.rear"):
        return "the page gives neither the chip nor the cameras in a form that could be read"
    return None


# ------------------------------------------------------------------------------------------------ building a record
def device_id(brand: str, name: str) -> str:
    if brand == "apple":
        name = re.sub(r"-inch\b", "", name)
    if brand == "samsung" and not name.lower().startswith("samsung"):
        name = f"samsung {name}"
    base = name if name.lower().startswith(brand) or brand == "apple" else f"{brand} {name}"
    s = base.lower().replace("+", " plus").replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if brand == "apple" and not s.startswith("apple-"):
        s = "apple-" + s
    return s


def summary_of(name: str, cat: str, specs: dict, chip_name: str | None) -> tuple[str, list[str]]:
    size, mah = get(specs, "display.size_in"), get(specs, "battery.capacity_mah")
    wired, main = get(specs, "charging.wired_w"), next((c["mp"] for c in get(specs, "camera.rear") or [] if c.get("role") == "main"), None)
    g5 = "5G " if get(specs, "connectivity.cellular") == "5G" else ""
    kind = "tablet" if cat == "tablet" else "phone"
    parts = []
    if chip_name:
        parts.append(f"the {chip_name}")
    if mah:
        parts.append(f"a {mah:,} mAh battery" + (f" with {wired:g} W charging" if wired else ""))
    if main:
        parts.append(f"a {main:g} MP main camera")
    text = f"A {size:g}-inch {g5}{kind}" + (" with " + (", ".join(parts[:-1]) + " and " + parts[-1] if len(parts) > 1 else parts[0]) if parts else "") + "."
    highlights = [x for x in (chip_name, f"{size:g}-inch" if size else None, (f"{mah:,} mAh" + (f", {wired:g} W" if wired else "")) if mah else None) if x]
    return text, highlights


def new_record(brand: str, source: str, site: str, cat: str, got: dict, first_seen: str) -> dict:
    name = got["name"]
    display = re.sub(r"^(Apple|Samsung) ", "", name)   # the hub's own naming: "iPhone 18", "Galaxy A08"
    summary, highlights = summary_of(display, cat, got["specs"], clean_name(got["chipName"]) if got.get("chipName") else None)
    form = "tablet" if cat == "tablet" else ("foldable" if re.search(r"Fold|Flip|Magic ?V\d|Find N|Mate X|razr|X Fold", name, re.I) else "bar")
    note = (f"Added automatically: read from {site}'s own specification page on {TODAY}, with the same fixed patterns as the "
            "hand-reviewed records. Not checked by a person yet; anything the page does not state clearly is left out.")
    return {
        "id": device_id(brand, display), "name": display, "brand": brand, "category": cat, "form": form, "status": "announced",
        "announced": first_seen,
        "summary": summary, "highlights": highlights,
        "availability": {"MY": {"status": "price-not-found", "checked": TODAY, "source": source, "url": got["final"],
                                "note": f"Listed on {site}'s website. No Malaysian launch price has been recorded yet."}},
        "specs": got["specs"],
        "provenance": {"default": {"class": "official", "source": source, "url": got["final"], "checked": TODAY, "note": note},
                       "fields": {"announced": {"class": "official", "source": source, "url": got["final"], "checked": TODAY,
                                                "note": f"The day the model first appeared on {site}'s website, found automatically. "
                                                        "The launch announcement can be a few days earlier."}}},
        "dataStatus": "auto",
        "auto": {"addedAt": TODAY, "url": got["final"], "site": site},
    }


# ------------------------------------------------------------------------------------------------ launch date (Version 22)
OFFICIAL_NEWS = {"apple-newsroom", "samsung-newsroom", "samsung-newsroom-my", "google-blog"}
_HEADLINES: list[dict] | None = None


def _headlines() -> list[dict]:
    """Every collected headline (latest + archive of about a year), read once."""
    global _HEADLINES
    if _HEADLINES is None:
        seen: dict[str, dict] = {}
        for f in (ROOT / "live" / "archive.json", ROOT / "live" / "headlines.json"):
            try:
                for i in json.loads(f.read_text(encoding="utf-8")).get("items", []):
                    if i.get("id") and i.get("title") and i.get("published"):
                        seen.setdefault(i["id"], i)
            except (OSError, ValueError):
                pass
        _HEADLINES = list(seen.values())
    return _HEADLINES


# Announcement wording (past or present tense, the model itself) and sale wording; future, leak or event-coverage wording
# never gives a date.
SAID_UNVEILED = re.compile(r"\b(introduces|introduced|unveils|unveiled|announces|announced|launches|launched|debuts|debuted|"
                           r"goes official|is official|officially launch(?:es|ed))\b|正式发布|(?<!将)(?<!即将)发布[：:，,]|亮相|官宣", re.I)
SAID_ON_SALE = re.compile(r"\b(now available|available (?:now|today)|goes on sale|on sale (?:now|today)|arrives in stores|hits stores)\b|开售|首销|正式上市", re.I)
NOT_YET = re.compile(r"\b(will|to launch|set to|expected|launch date|ahead of|teas(?:e|er|es|ed)|leak(?:s|ed)?|rumou?r(?:s|ed)?|"
                     r"reportedly|tipped|could|may|might|coming|upcoming|soon|when|before|vs\.?|versus|review|hands-on)\b|将|即将|曝光|爆料|预热|定档|对比|评测|上手", re.I)


def launch_date(name: str) -> dict | None:
    """The model's announcement date (and sale date) from the collected news: the maker's own newsroom when it reported
    it, otherwise the earliest report that a second publication confirms within 7 days (a lone report is not enough).
    News articles only (no videos or reviews); the name must stand alone ("iQOO 16", not "iQOO 16 Pro"); a headline
    about what will happen, a leak or an event is never used. None when nothing qualifies."""
    import fetch_headlines as fh  # noqa: PLC0415
    words = fh.normalize(re.sub(r"^(Apple|Samsung) ", "", name))
    if len(words) < 4 or not re.search(r"\d|air|duo|fold|flip", words):
        return None
    pat = re.compile(r"(?<![a-z0-9])" + re.escape(words) + r"(?! (?:pro|max|ultra|plus|lite|fe|mini|neo|turbo|edge|s|e|a|x|t|r|\d))(?![a-z0-9])")
    unveiled, on_sale = [], []
    for i in _headlines():
        title = i["title"]
        if i.get("kind", "news") != "news" or NOT_YET.search(title) or not pat.search(fh.normalize(title)):
            continue
        hit = (i["published"][:10], i.get("source", ""), i.get("url", ""), title)
        if SAID_ON_SALE.search(title):
            on_sale.append(hit)
        elif SAID_UNVEILED.search(title):
            unveiled.append(hit)

    def pick(hits):
        hits.sort()
        official = [h for h in hits if h[1] in OFFICIAL_NEWS]
        if official:
            day, src, url, title = official[0]
            return {"date": day, "class": "official", "source": src, "url": url, "note": f"From the maker's own newsroom: “{title[:120]}”."}
        for n, (day, src, url, title) in enumerate(hits):
            later = dt.date.fromisoformat(day) + dt.timedelta(days=7)
            others = {h[1] for h in hits[n + 1:] if h[1] != src and dt.date.fromisoformat(h[0]) <= later}
            if others:
                return {"date": day, "class": "news", "source": src, "url": url,
                        "note": f"The earliest report, “{title[:120]}”, confirmed by {len(others)} other publication(s) within a week."}
        return None

    got, sale = pick(unveiled), pick(on_sale)
    if not got and not sale:
        return None
    if got and sale and sale["date"] < got["date"]:
        sale = None                                       # a sale date before the announcement can't be right: left out
    return {**(got or {}), **({"released": sale} if sale else {})} if got else {"released": sale}


def date_record(rec: dict, first_seen: str) -> None:
    """Version 22: the announced date comes from a launch report when one is found (labelled with its source); otherwise
    it stays the day the model first appeared on the maker's Malaysian site, and the page says so."""
    rec.setdefault("auto", {}).setdefault("firstSeen", first_seen)
    fields = rec.setdefault("provenance", {}).setdefault("fields", {})
    if (fields.get("announced") or {}).get("source") in OFFICIAL_NEWS | {"samsung-newsroom-my"} and fields["announced"].get("class") == "official" \
            and rec.get("auto", {}).get("dateFrom") != "first-seen":
        return                                            # already the maker's own announcement (Samsung's path, or found earlier)
    found = launch_date(rec["name"]) or {}
    sale = found.get("released")
    if sale and not rec.get("released"):
        rec["released"] = sale["date"]
        fields["released"] = {"class": sale["class"], "source": sale["source"], "url": sale["url"], "checked": TODAY, "note": sale["note"]}
    if found.get("date"):
        rec["announced"] = found["date"]
        fields["announced"] = {"class": found["class"], "source": found["source"], "url": found["url"], "checked": TODAY, "note": found["note"]}
        rec["auto"]["dateFrom"] = "launch-report"
    elif rec["auto"].get("dateFrom") != "launch-report":
        rec["announced"] = rec["auto"]["firstSeen"]
        rec["auto"]["dateFrom"] = "first-seen"
        if rec.get("released") and rec["released"] < rec["announced"]:
            rec["announced"] = rec["released"]            # on sale before it reached the maker's site: announced by then
            fields["announced"] = {**fields["released"], "note": "Announcement date not found; the model was on sale by this date."}


_F = None


def _find_images():
    """tools/find_images.py, loaded by path (tools/v6-import has an older script with the same name)."""
    global _F
    if _F is None:
        import importlib.util  # noqa: PLC0415
        spec = importlib.util.spec_from_file_location("hub_find_images", ROOT / "tools" / "find_images.py")
        _F = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_F)
    return _F


def picture_for(dev_id: str, got: dict) -> dict | None:
    """A product picture under the same rules as tools/find_images.py, from the spec page or the product page that goes
    with it. None when neither declares one that passes (the picture search then keeps trying every 3 days)."""
    F = _find_images()
    pick = F.pick_picture(got["final"], got.get("html", ""), dev_id, [], TODAY)
    if pick:
        return pick
    for page in F.overview_pages(got["final"]):
        if not allowed(page):
            continue
        status, final, text = fetch(page)
        if status == 200 and same_page(page, final):
            pick = F.pick_picture(page, text, dev_id, [], TODAY)
            if pick:
                return pick
    return None


# ------------------------------------------------------------------------------------------------ the two jobs
def spotted_names() -> list[str]:
    try:
        return [m["name"] for m in json.loads(SPOTTED.read_text(encoding="utf-8")).get("models", []) if m.get("name")]
    except (OSError, ValueError):
        return []


def find_new(state: dict, hub: Hub, limit: int, log) -> None:
    seen = state.setdefault("seen", {})
    pending = state.setdefault("pending", {})       # url -> {brand, cat, slug, firstSeen, tries}
    held = state.setdefault("held", {})
    devices = state.setdefault("devices", {})
    chipsets = state.setdefault("chipsets", {})
    sources = state.setdefault("sources", {})
    too_old = state.setdefault("tooOld", {})          # Version 22: models from before 2023, with the reason
    if "_appleYears" not in state:
        state["_appleYears"] = apple_years(log)
    for brand, mk in MAKERS.items():
        try:
            urls = []
            for sm in mk["sitemaps"]:
                urls += sitemap_urls(sm)
        except Exception as e:  # noqa: BLE001
            sources[brand] = {"ok": False, "at": now_iso(), "error": str(e)[:160]}
            log(f"[devices] {brand}: sitemap not read ({e})")
            continue
        specs = {}
        for u in urls:
            u = u.strip()
            m = mk["spec"].match(u)
            if not m and mk.get("product") and mk["product"].match(u.rstrip("/")):
                u = u.rstrip("/") + "/specs"
                m = mk["spec"].match(u)
            if m:
                cat = mk["cat"](m.group(1), m.group(2))
                if cat in PHONE_TABLET:
                    specs[u] = (cat, m.group(2))
        if not specs:                                     # a sitemap with no spec pages is a failed read, never "nothing listed"
            sources[brand] = {"ok": False, "at": now_iso(), "error": "no specification pages found in the sitemap"}
            log(f"[devices] {brand}: no spec pages in the sitemap; nothing changed")
            continue
        first_time = brand not in seen
        known = set(seen.get(brand, []))
        new = [u for u in specs if u not in known]
        sources[brand] = {"ok": True, "at": now_iso(), "pages": len(specs), "new": 0 if first_time else len(new)}
        if first_time:
            seen[brand] = sorted(specs)
            log(f"[devices] {brand}: first read, {len(specs)} spec pages remembered (none added)")
            continue
        for u in new:
            cat, slug = specs[u]
            if u.rstrip("/").lower() in hub.urls or EDITION.search(slug.replace("-", " ")):
                continue
            pending.setdefault(u, {"brand": brand, "cat": cat, "slug": slug, "firstSeen": TODAY, "tries": 0})
        seen[brand] = sorted(known | set(specs))
    # Apple: Apple Support's own lists of iPhone and iPad tech-specs pages (first read remembered, as for sitemaps)
    try:
        entries = {}
        for cat, index in APPLE_INDEX.items():
            if not allowed(index):
                raise PermissionError("robots.txt does not allow " + index)
            status, _, page = fetch(index)
            if status != 200:
                raise OSError(f"HTTP {status}")
            for href, label in re.findall(r'<a[^>]+href="(https://support\.apple\.com/en-my/docs/(?:iphone|ipad)/\d+)"[^>]*>(.*?)</a>', page, re.S):
                name = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(label))).strip()
                # "… Wi-Fi", "… Wi-Fi + Cellular", "… Cellular sub6": one model, whatever the connection
                name = re.sub(r"\s+(?:Wi-?Fi(?:\s*\+\s*Cellular)?|Cellular)(?:\s+(?:sub6|mmWave))?$", "", name, flags=re.I)
                if name and re.search(r"^(iPhone|iPad)\b", name) and name not in {e["name"] for e in entries.values()}:
                    entries[href] = {"name": name, "cat": cat}
        if not entries:
            raise OSError("no models listed")
        known = set(seen.get("apple", []))
        sources["apple"] = {"ok": True, "at": now_iso(), "pages": len(entries), "new": 0 if "apple" not in seen else len(set(entries) - known)}
        years = state.get("_appleYears") or {}
        for href, e in entries.items():                   # an old model listed again is not new (Version 22)
            y = years.get(key(e["name"]))
            if y and y < START_YEAR:
                if href not in known or href in held or href in pending:
                    too_old[href] = {"brand": "apple", "name": e["name"], "reason": f"introduced in {y} (Apple's identify-your-model page); the hub covers {START_YEAR} on", "at": TODAY}
                held.pop(href, None)
                pending.pop(href, None)
        for href in [u for u, h in held.items() if h.get("brand") == "apple" and "/docs/" in u and u not in entries and not h.get("name")]:
            held.pop(href)                                # no longer on Apple's list and never named: nothing left to check
        for href, h in held.items():                      # an Apple page held earlier: its year is known now
            name = h.get("name") or (entries.get(href) or {}).get("name", "")
            y = years.get(key(name)) if h.get("brand") == "apple" else None
            if y and y < START_YEAR:
                too_old[href] = {**h, "name": name, "reason": f"introduced in {y} (Apple's identify-your-model page); the hub covers {START_YEAR} on"}
        for href in too_old:
            held.pop(href, None)
        if "apple" in seen:
            for href, e in entries.items():
                if href not in known and href not in too_old and not hub.existing(e["name"]):
                    pending.setdefault(href, {"brand": "apple", "cat": e["cat"], "slug": None, "name": e["name"], "firstSeen": TODAY,
                                              "tries": 0, "apple": True})
        else:
            log(f"[devices] apple: first read, {len(entries)} models remembered (none added)")
        seen["apple"] = sorted(known | set(entries))
    except Exception as e:  # noqa: BLE001
        sources["apple"] = {"ok": False, "at": now_iso(), "error": str(e)[:160]}
    # Samsung: launch announcements on Samsung Newsroom Malaysia (collected with the headlines), from the first run on
    since = state.setdefault("samsungSince", TODAY)
    news = []
    for f in (ROOT / "live" / "headlines.json", ROOT / "live" / "archive.json"):
        try:
            news += json.loads(f.read_text(encoding="utf-8")).get("items", [])
        except (OSError, ValueError):
            pass
    done_articles = set(seen.get("samsung-newsroom", []))
    count = 0
    price_fills = state.setdefault("priceFills", {})
    no_price = {d["id"] for d in hub.devices if d.get("brand") == "samsung" and not any(p.get("region") == "MY" for p in d.get("prices", []))
                and ((d.get("availability") or {}).get("MY") or {}).get("status") != "not-launched"}
    priced = 0
    for item in news:
        url, title = item.get("url", ""), item.get("title", "")
        devs = item.get("devices") or []
        if (SAMSUNG_MY.match(url) and len(devs) == 1 and devs[0] in no_price and devs[0] not in price_fills
                and not NOT_LAUNCH.search(title) and url not in done_articles and priced < 10):
            model = next((m for m in GALAXY.findall(title)), None)
            if not model or hub.existing("Galaxy " + re.sub(r"\s+", " ", model).replace("Plus", "+")) != devs[0]:
                continue
            priced += 1
            try:
                if allowed(url):
                    status, final, page = fetch(url)
                    if status == 200 and same_page(url, final):
                        found = samsung_prices(" | ".join(text_of(page)), (item.get("published") or TODAY)[:10], final)
                        if found:
                            price_fills[devs[0]] = {"prices": found, "url": final, "at": TODAY}
                            log(f"[devices] {devs[0]}: Malaysian launch price from Samsung Newsroom Malaysia: {[p['amount'] for p in found]}")
            except Exception:  # noqa: BLE001
                pass
    for item in news:
        url, title = item.get("url", ""), item.get("title", "")
        if not SAMSUNG_MY.match(url) or url in done_articles or (item.get("published") or "")[:10] < since or item.get("devices"):
            continue
        models = {re.sub(r"\s+", " ", m).replace("Plus", "+") for m in GALAXY.findall(title)}
        if NOT_LAUNCH.search(title) or not models:
            continue
        done_articles.add(url)
        # Version 25: "Galaxy Tab S12 Series" names one series but announced two models (Tab S12 Ultra and Tab S12+), and
        # there is no plain "Galaxy Tab S12"
        if len(models) != 1 or re.search(r"\bseries\b", title, re.I):
            held[url] = {"brand": "samsung", "name": title[:80], "reason": "the announcement names several models; left for a person", "at": TODAY}
            continue
        model = "Galaxy " + next(iter(models))
        if hub.existing(model) or hub.existing("Samsung " + model):
            continue
        pending.setdefault(url, {"brand": "samsung", "cat": "tablet" if model.startswith("Galaxy Tab") else "smartphone",
                                 "slug": None, "name": model, "firstSeen": (item.get("published") or TODAY)[:10], "tries": 0, "samsung": True})
        count += 1
    seen["samsung-newsroom"] = sorted(done_articles)
    sources["samsung"] = {"ok": True, "at": now_iso(), "pages": len([n for n in news if SAMSUNG_MY.match(n.get("url", ""))]), "new": count}
    # models the news is talking about, on makers' sites without a sitemap
    tried = state.setdefault("guessed", {})
    for name in spotted_names():
        for gk, g in GUESS.items():
            words = name.split()
            brand = words[0].lower() if words[0].lower() in g["brands"] else ("apple" if g.get("names") and g["names"].search(name) else None)
            if not brand or hub.existing(name):
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("+", " plus")).strip("-")
            url = g["url"].format(slug=slug)
            last = tried.get(url)
            if last and (dt.date.today() - dt.date.fromisoformat(last)).days < 7:
                continue
            tried[url] = TODAY
            pending.setdefault(url, {"brand": brand, "cat": "tablet" if "ipad" in slug or "pad" in slug.split("-") else "smartphone",
                                     "slug": slug, "firstSeen": TODAY, "tries": 0, "guess": gk})
    # Version 25: a page held because robots.txt seemed to refuse it is looked at again while robots.txt allows it. Before
    # Version 24 a robots.txt that couldn't be loaded counted as a refusal, so Samsung Newsroom Malaysia's Galaxy Tab S12
    # announcement was held on 30 Sep 2026 although Samsung's robots.txt allows every page; held pages were never read again.
    for url, h in list(held.items()):
        if h.get("reason") != "robots.txt does not allow this page" or url in pending or robots_refuses(url):
            continue
        again = h.get("retry")
        if not again and SAMSUNG_MY.match(url) and h.get("name", "").startswith("Galaxy "):
            headline = next((i for i in news if i.get("url") == url), {})
            if re.search(r"\bseries\b", headline.get("title", ""), re.I):
                h["reason"] = "the announcement names several models; left for a person"
                continue
            published = (headline.get("published") or "")[:10] or h.get("at", TODAY)
            again = {"brand": "samsung", "cat": "tablet" if h["name"].startswith("Galaxy Tab") else "smartphone", "slug": None,
                     "name": h["name"], "firstSeen": published, "samsung": True}
        if again:
            pending[url] = {**again, "tries": 0}
            held.pop(url)
            log(f"[devices] {url}: held as refused by robots.txt, which doesn't refuse it; read again")
    done = honor = 0
    for url, p in sorted(pending.items(), key=lambda kv: kv[1]["firstSeen"]):
        if done >= limit:
            break
        if "honor.com" in url:                            # 30 seconds a page: at most 6 a run, the rest next day
            if honor >= 6:
                continue
            honor += 1
        done += 1
        brand = p["brand"]
        if p.get("apple") and not state.get("_appleYears"):
            done -= 1                                     # no year to check against: the model waits for a later run
            continue
        if p.get("apple"):
            mk = {"site": "Apple Malaysia", "source": "apple-support"}
            got, why = read_apple(url, p, hub)
        elif p.get("samsung"):
            mk = {"site": "Samsung Newsroom Malaysia", "source": "samsung-newsroom-my"}
            got, why = read_samsung(url, p, hub)
        else:
            mk = MAKERS.get(brand) or GUESS[p.get("guess", brand)]
            got, why = read_spec_page(url, brand, p["cat"], hub, p["slug"])
        source = SOURCE_OF_BRAND.get(brand, mk["source"])
        if got is None and why.startswith("page not available (HTTP error") and p["tries"] < 4:
            p["tries"] += 1                               # the site was unreachable: try again on a later run
            continue
        pending.pop(url, None)
        if got is None:
            if not p.get("guess") and not why.startswith("already in the hub"):   # a wrong address guess is not worth listing
                held[url] = {"brand": brand, "reason": why, "at": TODAY, **({"name": p["name"]} if p.get("name") else {}),
                             **({"retry": {k: v for k, v in p.items() if k != "tries"}} if why == "robots.txt does not allow this page" else {})}
            log(f"[devices] {url}: not added ({why})")
            continue
        existing = hub.existing(got["name"])
        if existing:
            log(f"[devices] {url}: {got['name']} is already in the hub ({existing})")
            continue
        if EDITION.search(got["name"]):
            held[url] = {"brand": brand, "name": got["name"], "reason": "a special edition; left for a person to decide", "at": TODAY}
            continue
        # Version 22: only models from 2023 on (Apple: the year Apple gives; others: the model's number in its series)
        year = (state.get("_appleYears") or {}).get(key(re.sub(r"^Apple ", "", got["name"]))) if brand == "apple" else None
        age = (("old", f"introduced in {year} (Apple's identify-your-model page); the hub covers {START_YEAR} on")
               if year and year < START_YEAR else None) or hub.too_old(re.sub(r"^(Apple|Samsung) ", "", got["name"]), brand, p["cat"])
        if age:
            (too_old if age[0] == "old" else held)[url] = {"brand": brand, "name": got["name"], "reason": age[1], "at": TODAY}
            log(f"[devices] {url}: {got['name']} not added ({age[1]})")
            continue
        why = core_ok(got["specs"], p["cat"], "samsung-news" if p.get("samsung") else brand)
        if why:
            held[url] = {"brand": brand, "name": got["name"], "reason": why, "at": TODAY}
            log(f"[devices] {url}: {got['name']} held ({why})")
            continue
        rec = new_record(brand, source, mk["site"], p["cat"], got, p["firstSeen"])
        if p.get("samsung"):
            rec["provenance"]["default"]["note"] = (
                f"Added automatically: read from Samsung Newsroom Malaysia's launch announcement on {TODAY}. samsung.com/my shows its "
                "specifications only in the browser, so only what the announcement states is recorded; the rest is left out. "
                "Not checked by a person yet.")
            rec["provenance"]["fields"]["announced"]["note"] = "The date of Samsung Newsroom Malaysia's launch announcement."
            if got.get("prices"):
                rec["prices"] = got["prices"]
                rec.pop("availability", None)
            else:
                rec["availability"]["MY"]["note"] = "Announced by Samsung Malaysia. No Malaysian launch price has been recorded yet."
        date_record(rec, p["firstSeen"])                  # Version 22: launch date from a launch report when there is one
        if rec["announced"][:4] < str(START_YEAR):
            too_old[url] = {"brand": brand, "name": got["name"], "reason": f"launched in {rec['announced'][:4]} (launch report); the hub covers {START_YEAR} on", "at": TODAY}
            log(f"[devices] {url}: {got['name']} not added (launched {rec['announced']})")
            continue
        if rec["id"] in hub.ids:
            held[url] = {"brand": brand, "name": got["name"], "reason": f"its id ({rec['id']}) is already used", "at": TODAY}
            continue
        new_chip = None
        if got.get("newChip") and got["newChip"]["id"] not in hub.chips.values():
            ch = got["newChip"]
            new_chip = {**ch, "summary": "Name recorded automatically from a phone maker's specification page. Chip details have not been compiled yet.",
                        "provenance": {"default": {"class": "official", "source": source, "url": got["final"], "checked": TODAY,
                                                   "note": f"Chip name as given for the {rec['name']}."}}, "auto": True}
            hub.chips[hub.chip_key(ch["name"])] = ch["id"]
        try:
            image = picture_for(rec["id"], got)
        except Exception:  # noqa: BLE001  (no picture is fine; the picture search tries again every 3 days)
            image = None
        if image:
            rec["image"] = image
        # Version 23: nothing joins the site before the open-source AI check (tools/ai_device_check.py) has looked at it
        state.setdefault("awaitingAi", {})[rec["id"]] = {"record": rec, "url": url, "since": TODAY, **({"chip": new_chip} if new_chip else {})}
        hub.ids.add(rec["id"])
        hub.names[key(rec["name"])] = rec["id"]
        held.pop(url, None)
        log(f"[devices] PASSED THE RULES {rec['id']} ({rec['name']}) from {got['final']}; waiting for the AI check; left out: {', '.join(got['left']) or 'nothing'}")


def drop_too_old(state: dict, hub: Hub, log) -> None:
    """Version 22: a model added automatically that turns out to be from before 2023 is taken off again (every run)."""
    devices = state.get("devices") or {}
    if not devices:
        return
    if any(d.get("brand") == "apple" for d in devices.values()) and "_appleYears" not in state:
        state["_appleYears"] = apple_years(log)
    years = state.get("_appleYears") or {}
    for dev_id, rec in list(devices.items()):
        name, brand = rec.get("name", ""), rec.get("brand", "")
        before = rec.get("announced")
        date_record(rec, (rec.get("auto") or {}).get("firstSeen") or before or TODAY)
        if rec.get("announced") != before:
            log(f"[devices] {dev_id}: announced date {before} -> {rec['announced']} ({rec['provenance']['fields']['announced'].get('source')})")
        y = years.get(key(name)) if brand == "apple" else None
        if not y and (rec.get("auto") or {}).get("dateFrom") == "launch-report":
            y = int(rec["announced"][:4])
        age = (("old", f"introduced in {y} ({'Apple' + chr(39) + 's identify-your-model page' if brand == 'apple' and years.get(key(name)) else 'launch report'}); the hub covers {START_YEAR} on") if y and y < START_YEAR
               else None) or hub.too_old(name, brand, rec.get("category", ""))
        if age and age[0] == "old":
            devices.pop(dev_id)
            url = (rec.get("auto") or {}).get("url") or dev_id
            state.setdefault("tooOld", {})[url] = {"brand": brand, "name": name, "reason": age[1], "at": TODAY, "removed": dev_id}
            log(f"[devices] REMOVED {dev_id} ({name}): {age[1]}")


def fill_existing(state: dict, hub: Hub, limit: int, log) -> None:
    """Re-read official spec pages cited by devices in data/: fill missing values, list changed ones for a person."""
    fills = state.setdefault("fills", {})
    changes = state.setdefault("changes", {})
    targets = []
    for d in sorted(hub.devices, key=lambda d: d["id"]):
        u = ((d.get("provenance") or {}).get("default") or {}).get("url", "")
        if d.get("category") in PHONE_TABLET and FILL_HOSTS.match(u) and (d.get("provenance") or {}).get("default", {}).get("class") == "official":
            targets.append((d, u))
    if not targets:
        return
    cursor = state.get("fillCursor") or ""
    start = next((i for i, (d, _) in enumerate(targets) if d["id"] > cursor), 0)
    order = targets[start:] + targets[:start]
    honor = 0
    read = 0
    for d, u in order:
        if read >= limit:
            break
        if "honor.com" in u:
            if honor >= 8:
                continue
            honor += 1
        read += 1
        state["fillCursor"] = d["id"]
        brand = d["brand"]
        got, why = read_spec_page(u, brand, d["category"], hub, None)
        if got is None:
            continue
        rec = d.get("specs") or {}
        fprov = (d.get("provenance") or {}).get("fields") or {}
        for path in FILL_FIELDS:
            new = get(got["specs"], path)
            if new is None:
                continue
            old = get(rec, path)
            if old is None and f"specs.{path}" not in fprov:
                if path == "platform.chipset" and new not in set(hub.chips.values()):
                    ch = got.get("newChip")
                    if not ch or ch["id"] != new:
                        continue
                    state.setdefault("chipsets", {})[new] = {
                        **ch, "summary": "Name recorded automatically from a phone maker's specification page. Chip details have not been compiled yet.",
                        "provenance": {"default": {"class": "official", "source": (d.get("provenance") or {}).get("default", {}).get("source"),
                                                   "url": got["final"], "checked": TODAY, "note": f"Chip name as given for the {d['name']}."}},
                        "auto": True}
                    hub.chips[hub.chip_key(ch["name"])] = new
                fills.setdefault(d["id"], {})[path] = {"value": new, "url": got["final"], "checked": TODAY}
                log(f"[specs] {d['id']}: {path} filled from the maker's page: {new}")
            elif old is not None and old != new and not (isinstance(old, list) and isinstance(new, list) and set(new) <= set(old)):
                if f"specs.{path}" in fprov and fprov[f"specs.{path}"].get("url") != u:
                    continue                              # the recorded value is cited from another source on purpose
                changes.setdefault(d["id"], {})[path] = {"recorded": old, "page": new, "url": got["final"], "checked": TODAY}
            else:
                changes.get(d["id"], {}).pop(path, None)
        if d["id"] in changes and not changes[d["id"]]:
            changes.pop(d["id"])
    # a fill or change the record now has by hand is no longer needed
    by_id = {d["id"]: d for d in hub.devices}
    for dev_id in list(fills):
        dev = by_id.get(dev_id)
        for path in list(fills[dev_id]):
            if dev is None or get(dev.get("specs") or {}, path) is not None:
                fills[dev_id].pop(path)
        if not fills[dev_id]:
            fills.pop(dev_id)
    log(f"[specs] {read} spec pages re-read; {sum(len(v) for v in fills.values())} values filled in total, "
        f"{sum(len(v) for v in changes.values())} differences listed for a person")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["new", "fill"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--limit", type=int, default=40, help="most new-model pages to read in one run")
    ap.add_argument("--fill-limit", type=int, default=120, help="most spec pages to re-read in one run")
    args = ap.parse_args()
    state = read_auto()
    state.pop("updatedAt", None)
    hub = Hub(state)
    # a device that now has a hand-made record is dropped from the automatic list
    for dev_id in [i for i in (state.get("devices") or {}) if (DATA / "devices" / state["devices"][i]["category"] / f"{i}.json").exists()]:
        state["devices"].pop(dev_id)
    for cid in [c for c in (state.get("chipsets") or {}) if (DATA / "chipsets" / f"{c}.json").exists()]:
        state["chipsets"].pop(cid)
    runs = state.setdefault("runs", {})
    lines: list[str] = []
    log = lambda s: (print(s, flush=True), lines.append(s))
    drop_too_old(state, hub, log)
    for job, fn, lim in (("new", find_new, args.limit), ("fill", fill_existing, args.fill_limit)):
        if args.only and args.only != job:
            continue
        last = runs.get(job)
        if last and not args.force:
            age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(last)).total_seconds() / 3600
            if age < SCHEDULE_HOURS[job]:
                print(f"[devices] {job}: last run {age:.0f} h ago; skipping")
                continue
        fn(state, hub, lim, log)
        runs[job] = now_iso()
    state["updatedAt"] = now_iso()
    # held entries older than 60 days are forgotten (the page is then treated as seen)
    cutoff = (dt.date.today() - dt.timedelta(days=60)).isoformat()
    state["held"] = {u: h for u, h in (state.get("held") or {}).items() if h.get("at", TODAY) >= cutoff}
    state.pop("_appleYears", None)
    if args.dry:
        print(json.dumps({k: state.get(k) for k in ("devices", "held", "tooOld", "fills", "changes", "sources")}, indent=1, ensure_ascii=False)[:6000])
        return 0
    AUTO_DEVICES.parent.mkdir(parents=True, exist_ok=True)
    ordered = {k: state[k] for k in ("updatedAt", "runs", "sources", "devices", "chipsets", "held", "fills", "changes",
                                     "pending", "awaitingAi", "guessed", "fillCursor", "samsungSince", "priceFills", "tooOld", "seen") if k in state}
    AUTO_DEVICES.write_text(json.dumps(ordered, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"[devices] {len(state.get('devices') or {})} devices added automatically in total; "
          f"{len(state.get('held') or {})} held for a person; {len(state.get('pending') or {})} waiting")
    return 0


if __name__ == "__main__":
    sys.exit(main())
