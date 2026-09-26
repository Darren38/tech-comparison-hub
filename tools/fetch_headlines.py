"""Collect the latest headlines and videos from registered sources into live/headlines.json.

Reads the feed list in data/meta/live-feeds.json (RSS 2.0 or Atom, including YouTube channel
feeds), keeps only items about phones, tablets, watches, their chips and their makers, tags the
devices each headline names, and stores the title, link, source, kind and date, plus the address of
the thumbnail the publisher put in its own feed (shown from the publisher's server, never copied).
No article text is copied. GSMArena's thumbnails are not kept (its robots.txt disallows Claude's crawlers).

Version 18: headlines also get flags for the News page sections (iOS / One UI software updates, reported problems,
Apple and Samsung service offers in Malaysia, flagship chips), and YouTube videos are read through the official YouTube
Data API (YouTube's robots.txt asks automated readers not to fetch its RSS feeds). The API needs a key in the
YOUTUBE_API_KEY environment variable (a GitHub Actions secret on the live site); without one, the videos collected
earlier are kept and no YouTube address is fetched.

serve.py runs this at start-up and when someone presses Refresh on the News or Reviews page; the
scheduled GitHub Actions build runs it for the live site. A failing feed does not stop the others,
and each feed's status is recorded in the output.

Usage:
    python tools/fetch_headlines.py          collect and write live/headlines.json
    python tools/fetch_headlines.py --quiet  print nothing unless something fails
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import email.utils
import hashlib
import os
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from devices_all import all_devices, auto_chipsets  # noqa: E402  (Version 20: devices added automatically count too)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = DATA / "meta" / "live-feeds.json"
OUT = ROOT / "live" / "headlines.json"
VIEWS_OUT = ROOT / "live" / "views.json"  # YouTube view counts by video id (Version 16)
MRSS = "{http://search.yahoo.com/mrss/}"
# Published next to the headlines so a browser (through the relay in relay/) collects with the same feeds and rules.
LIVE_CONFIG = ROOT / "live" / "config.json"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/5.0; headline collector)"
ATOM = "{http://www.w3.org/2005/Atom}"
MEDIA = "{http://search.yahoo.com/mrss/}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"
NO_IMAGE_SOURCES = {"gsmarena"}  # headlines stay text-only for these sources
KINDS = {"news", "review", "video"}
# Version 17: every headline that names a device or chipset is kept in live/archive.json for a year, so device and
# chipset pages build up their own news, reviews, videos and test reports over time. Matching is re-run over the
# whole archive on every collection, so a device added to the database later picks up the older headlines about it.
ARCHIVE_OUT = ROOT / "live" / "archive.json"
ARCHIVE_DAYS = 400
ARCHIVE_MAX = 6000
# Model names seen in headlines that are not in the database yet (shown on the Coverage page for whoever adds devices)
SPOTTED_OUT = ROOT / "live" / "spotted.json"
# What a headline is about, which decides the section of a device page it appears in. First match wins; reviews and
# videos that report a measurement go to "test" (Test results & benchmarks), other reviews and videos to Reviews & videos.
TOPIC_RULES = [
    ("test", r"\b(?:benchmarks?|benchmarked|geekbench|antutu|3dmark|dxomark|battery (?:life |drain )?tests?|drop tests?|durability tests?|bend tests?|"
             r"scratch tests?|teardowns?|thermals?|throttl\w*|speed tests?|camera tests?|display tests?|charging tests?|stress tests?)\b|跑分|续航测试|拆解|实测|发热"),
    ("software", r"\b(?:updates?|updated|one ui ?\d*|hyperos|coloros|oxygenos|originos|magicos|harmonyos|ios \d+|ipados|watchos|wear os|android \d+|"
                 r"betas?|patch(?:es)?|firmware)\b|系统更新|升级|推送|内测"),
    ("price", r"\b(?:price[sd]?|pricing|deals?|discount\w*|sale|cheaper|rm ?\d[\d,]*|\$\d[\d,]*)\b|售价|降价|优惠|价格|到手价"),
    ("issue", r"\b(?:bugs?|issues?|problems?|recall\w*|complain\w*|overheat\w*|defects?|faults?|broken|glitch\w*)\b|故障|问题|翻车|召回"),
    ("launch", r"\b(?:launch\w*|announc\w*|unveil\w*|debuts?|pre-?orders?|goes on sale|now available|release date|officially)\b|发布|上市|开售|首销|官宣"),
]
TOPIC_RES = [(name, re.compile(pattern, re.I)) for name, pattern in TOPIC_RULES]
# Version 18: flags for the News page sections. Unlike the topic, a headline can carry several.
FLAG_RULES = [
    ("ios", r"\b(?:i(?:pad)?os|watchos) ?\d+(?:\.\d+)*\b|\bios (?:update|beta|release)|\bapple intelligence\b|苹果.{0,6}(?:系统|更新)|iOS ?\d"),
    ("oneui", r"\bone ?ui\b|\bsamsung (?:security|software|firmware) (?:update|patch)|\bgalaxy\b.{0,40}\b(?:update|patch|firmware|rollout|rolling out)\b|三星.{0,8}(?:系统|更新)"),
    ("problem", r"\b(?:bugs?|issues?|problems?|glitch\w*|broken|breaks?|drain\w*|overheat\w*|crash\w*|lag\w*|complain\w*|fix(?:es|ed)?|pulled|halted|paused)\b|故障|问题|翻车|发热|耗电|卡顿"),
    ("chip", r"\bsnapdragon 8\b|\bdimensity 9\d{3}|\bexynos 2\d{3}|\bapple [am]\d{2}\b|\b[am]\d{2} (?:pro|bionic|max|ultra)\b|\btensor g\d|\bkirin 9\d{3}|\bxring\b|骁龙 ?8|骁龙.{0,6}旗舰|天玑 ?9\d{3}|麒麟 ?9\d{3}|玄戒"),
]
FLAG_RES = [(name, re.compile(pattern, re.I)) for name, pattern in FLAG_RULES]
# Service offers: Apple or Samsung, a service word and an offer word, and Malaysia (a Malaysian source or named in the title).
OFFER_BRAND = r"\b(?:apple|iphone|ipad|airpods|apple watch|samsung|galaxy)\b|苹果|三星"
OFFER_SERVICE = r"\b(?:replace\w*|repairs?|battery|batteries|screens?|display|green lines?|pink lines?|warranty|service|recall\w*|programmes?|programs?|trade-?in)\b|换屏|换电池|保修|维修|绿线"
OFFER_DEAL = r"\b(?:free|complimentary|discount\w*|rebates?|waive\w*|extend\w*|extension|recall\w*|programmes?|programs?|cashback|trade-?in|off)\b|免费|优惠|折扣|延长"
OFFER_MY = r"\bmalaysia\w*\b|\brm ?\d|大马|马来西亚"
MY_SOURCES = {"soyacincau", "technave", "zinggadget", "malaymail", "samsung-newsroom-my"}
OFFER_RES = [re.compile(x, re.I) for x in (OFFER_BRAND, OFFER_SERVICE, OFFER_DEAL)]
OFFER_MY_RE = re.compile(OFFER_MY, re.I)
# Headlines the archive keeps even when they name no device or chip in the database
ARCHIVE_FLAGS = {"ios", "oneui", "offer", "chip"}
TOPICS = ["test", "review", "video", "software", "price", "issue", "launch", "news"]
# A chip name followed by one of these is a different chip ("Snapdragon 8 Elite" in "Snapdragon 8 Elite Gen 5").
CHIP_NEXT_REJECT = {"gen", "plus", "pro", "ultra", "extreme", "s", "e", "m", "max", "lite", "for"}
# A chip alias preceded by one of these is a phone name ("A19 Pro" in "Galaxy A19 Pro").
CHIP_PREV_REJECT = {"galaxy", "iphone", "redmi", "poco", "vivo", "oppo", "honor", "moto", "nokia"}

REVIEW_WORDS = re.compile(r"\b(review|reviewed|hands[- ]on|tested|benchmarks?|battery (?:life )?test|camera test|teardown|durability|drop test|vs)\b", re.I)
# Words that mean a longer model name continues ("Galaxy S26" must not match "Galaxy S26 FE").
NEXT_REJECT = {"fe", "plus", "edge", "ultra", "pro", "max", "mini", "lite", "xl", "fold", "flip", "air", "classic", "neo", "se", "s", "e", "r", "t", "a"}
# A headline is kept when it names a device in the database or one of these phone, tablet, watch or
# chip topics. Brand names alone are not enough: Xiaomi or Huawei headlines are often about appliances or cars.
TOPIC_PATTERNS = [
    r"iphone", r"ipad", r"apple watch", r"galaxy", r"pixel", r"xperia", r"rog phone", r"red ?magic", r"nothing phone",
    r"cmf phone", r"oneplus", r"redmi", r"poco", r"iqoo", r"realme gt", r"find x\d*", r"reno ?\d+", r"honor magic\w*",
    r"pura ?\d+", r"mate x\w*", r"xiaomi \d{2}\w*", r"vivo x\w+", r"moto g\w*", r"razr", r"snapdragon", r"dimensity",
    r"exynos", r"tensor g?\d*", r"kirin", r"smartphones?", r"phones?", r"tablets?", r"smartwatch(?:es)?", r"foldables?",
    r"one ui", r"hyperos", r"coloros", r"oxygenos", r"wear os", r"watchos", r"ios \d+", r"ipados", r"android \d+",
]
# Words that cannot identify a model on their own ("17 Pro" says nothing about which brand).
GENERIC_TOKENS = {"pro", "max", "ultra", "plus", "mini", "lite", "fe", "xl", "fold", "flip", "air", "s", "e", "5g", "edition", "phone", "series"}


# Chinese headlines (Version 15): brand names written in Chinese read as the English ones ("小米17 Ultra" = "Xiaomi 17
# Ultra"), and these words mark a phone, tablet, watch or chip topic, or a review. Longer names first ("红米" before "米").
ZH_BRANDS = [("摩托罗拉", "motorola"), ("努比亚", "nubia"), ("小米", "xiaomi"), ("红米", "redmi"), ("华为", "huawei"),
             ("荣耀", "honor"), ("三星", "samsung"), ("苹果", "apple"), ("一加", "oneplus"), ("真我", "realme"),
             ("红魔", "redmagic"), ("谷歌", "google"), ("索尼", "sony"), ("华硕", "asus"), ("中兴", "zte")]
TOPIC_PATTERNS_ZH = r"手机|平板|手表|手环|折叠屏|骁龙|天玑|麒麟|芯片|处理器|澎湃OS|ColorOS|OriginOS|MagicOS"  # not 鸿蒙/旗舰/续航/快充: they also head car news
REVIEW_WORDS_ZH = r"评测|上手|体验|实测|测试|续航测试|拆解|对比|跑分|横评"


def normalize(text: str) -> str:
    for zh, en in ZH_BRANDS:
        text = text.replace(zh, f" {en} ")
    text = re.sub(r"['’]s\b", "", text.lower())
    text = text.replace("+", " plus ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"(\d)([a-z]{2,})\b", r"\1 \2", text)  # "17Pro", "X200Ultra" (Chinese headlines leave no space)
    text = re.sub(r"\b([a-z]{3,})(\d+)\b", r"\1 \2", text)  # "Fold8", "Magic8", "Watch8" read the same as "Fold 8"
    return re.sub(r"\s+", " ", text).strip()


def clean_title(text: str | None) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    return re.sub(r"\s+", " ", text).strip()[:220]


def parse_date(text: str | None, tz: str | None = None) -> dt.datetime | None:
    """A feed date as UTC. `tz` ("+08:00") is the feed's own offset, used when a date carries none."""
    if not text:
        return None
    text = text.strip()
    try:
        value = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        try:
            value = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if value.tzinfo is None:
        offset = dt.timezone.utc
        if tz and re.fullmatch(r"[+-]\d\d:\d\d", tz):
            sign = -1 if tz[0] == "-" else 1
            offset = dt.timezone(sign * dt.timedelta(hours=int(tz[1:3]), minutes=int(tz[4:6])))
        value = value.replace(tzinfo=offset)
    return value.astimezone(dt.timezone.utc)


IMG_EXT = re.compile(r"\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)", re.I)


def feed_image(node) -> str | None:
    """The thumbnail a publisher attached to a feed item: media:thumbnail, an image media:content or
    enclosure, or the first <img> in the item's summary. Only https addresses; tracking pixels skipped."""
    candidates = [t.get("url") for t in node.iter(f"{MEDIA}thumbnail")]
    candidates += [c.get("url") for c in node.iter(f"{MEDIA}content")
                   if c.get("medium") == "image" or (c.get("type") or "").startswith("image") or IMG_EXT.search(c.get("url") or "")]
    candidates += [e.get("url") for e in node.findall("enclosure") if (e.get("type") or "").startswith("image")]
    body = (node.findtext("description") or "") + (node.findtext(CONTENT) or "") + (node.findtext(f"{ATOM}summary") or "")
    candidates += [html.unescape(m) for m in re.findall(r"<img[^>]+src=[\"']([^\"']+)", body)]
    for url in candidates:
        url = (url or "").strip()
        if url.startswith("//"):
            url = "https:" + url
        if url.startswith("https://") and not re.search(r"feedburner|pixel|tracking|gravatar|emoji|1x1", url, re.I):
            return url[:500]
    return None


def feed_views(node) -> int | None:
    """The view count a YouTube feed publishes for a video (media:statistics views), if any."""
    for stat in node.iter(f"{MRSS}statistics"):
        value = stat.get("views", "")
        if value.isdigit():
            return int(value)
    return None


def youtube_id(url: str | None) -> str | None:
    m = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)([\w-]{11})", url or "")
    return m.group(1) if m else None


def parse_feed(raw: bytes) -> list[tuple[str | None, str | None, str | None, str | None, int | None]]:
    root = ET.fromstring(raw)
    items = []
    for item in root.iter("item"):
        date = item.findtext("pubDate") or item.findtext("{http://purl.org/dc/elements/1.1/}date")
        items.append((item.findtext("title"), item.findtext("link"), date, feed_image(item), feed_views(item)))
    for entry in root.iter(f"{ATOM}entry"):
        link = next((l.get("href") for l in entry.findall(f"{ATOM}link") if l.get("rel", "alternate") == "alternate"), None)
        date = entry.findtext(f"{ATOM}published") or entry.findtext(f"{ATOM}updated")
        items.append((entry.findtext(f"{ATOM}title"), link, date, feed_image(entry), feed_views(entry)))
    return items


def fetch(url: str, timeout: int = 20) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(4_000_000)


def device_keys(devices: list[dict], brand_names: dict[str, str]) -> list[tuple[str, str]]:
    # Version 17: a name shared by several devices ("iPad Air M4" = the 11-inch and the 13-inch) links to all of them
    keys: dict[str, list[str]] = {}
    for dev in devices:
        name = dev["name"]
        brand = brand_names.get(dev["brand"], "")
        variants = {name, *dev.get("aliases", [])}
        if brand and not name.lower().startswith(brand.lower()):
            variants.add(f"{brand} {name}")
        variants |= {re.sub(r"\s+5G$", "", v, flags=re.I) for v in variants}
        for v in variants:
            key = normalize(v)
            tokens = key.split()
            has_model_number = any(ch.isdigit() for ch in key)  # keeps "Galaxy" alone from matching
            has_identity = any(t not in GENERIC_TOKENS and not t.isdigit() for t in tokens)  # "17 pro" is too vague
            if len(key) >= 4 and has_model_number and has_identity and dev["id"] not in keys.setdefault(key, []):
                keys[key].append(dev["id"])
    return sorted(((k, i) for k, ids in keys.items() for i in ids), key=lambda kv: -len(kv[0]))


def match_devices(title_norm: str, keys: list[tuple[str, str]], next_reject: set[str] = NEXT_REJECT,
                  prev_reject: set[str] = frozenset()) -> list[str]:
    taken: list[tuple[int, int]] = []
    found: list[str] = []
    for key, device_id in keys:
        for m in re.finditer(r"(?<![a-z0-9])" + re.escape(key) + r"(?![a-z0-9])", title_norm):
            start, end = m.span()
            following = title_norm[end:].split()[:1]
            if following and following[0] in next_reject:
                continue
            preceding = title_norm[:start].split()[-1:]
            if preceding and preceding[0] in prev_reject:
                continue
            if any(start < t_end and end > t_start and t_key != key for t_start, t_end, t_key in taken):
                continue
            taken.append((start, end, key))
            if device_id not in found:
                found.append(device_id)
    return found


def load_keys() -> list[tuple[str, str]]:
    brands = json.loads((DATA / "brands" / "brands.json").read_text(encoding="utf-8"))
    devices = all_devices()
    return device_keys(devices, {b["id"]: b["name"] for b in brands})


def load_chip_keys() -> list[tuple[str, str]]:
    """Chip names and aliases ("snapdragon 8 elite gen 5", "dimensity 9500", "a19 pro"), longest first."""
    keys: dict[str, str] = {}
    for path in sorted((DATA / "chipsets").glob("*.json")):
        chip = json.loads(path.read_text(encoding="utf-8"))
        for name in {chip["name"], *chip.get("aliases", [])}:
            key = normalize(name)
            tokens = key.split()
            if len(key) >= 4 and any(ch.isdigit() for ch in key) and any(t not in GENERIC_TOKENS and not t.isdigit() for t in tokens):
                keys.setdefault(key, chip["id"])
    return sorted(keys.items(), key=lambda kv: -len(kv[0]))


def topic_of(title: str, kind: str) -> str:
    """Which section of a device page a headline belongs to (see TOPIC_RULES)."""
    for name, pattern in TOPIC_RES:
        if name == "test" and pattern.search(title):
            return "test"
    if kind in {"review", "video"}:
        return kind
    for name, pattern in TOPIC_RES[1:]:
        if pattern.search(title):
            return name
    return "news"


def flags_of(title: str, source: str) -> list[str]:
    """Version 18: which News page sections a headline belongs to (see FLAG_RULES and the offer rules)."""
    flags = [name for name, pattern in FLAG_RES if pattern.search(title)]
    if "problem" in flags and not ({"ios", "oneui"} & set(flags)) and not TOPIC_RES[1][1].search(title):
        flags.remove("problem")  # "problem" marks reported problems with a software update
    if all(r.search(title) for r in OFFER_RES) and (source in MY_SOURCES or OFFER_MY_RE.search(title)):
        flags.append("offer")
    return flags


def tag_item(item: dict, keys, chip_keys) -> dict:
    norm = normalize(item["title"])
    item["devices"] = match_devices(norm, keys)
    chips = match_devices(norm, chip_keys, CHIP_NEXT_REJECT, CHIP_PREV_REJECT)
    if chips:
        item["chipsets"] = chips
    else:
        item.pop("chipsets", None)
    item["topic"] = topic_of(item["title"], item.get("kind", "news"))
    flags = flags_of(item["title"], item.get("source", ""))
    if flags:
        item["flags"] = flags
    else:
        item.pop("flags", None)
    return item


def update_archive(items: list[dict], keys, chip_keys, video_views: dict[str, int], now: dt.datetime) -> dict:
    """Merge this collection into live/archive.json (headlines that name a device or chipset, kept ARCHIVE_DAYS)."""
    old: list[dict] = []
    if ARCHIVE_OUT.exists():
        try:
            old = json.loads(ARCHIVE_OUT.read_text(encoding="utf-8")).get("items", [])
        except ValueError:
            old = []
    merged: dict[str, dict] = {i["id"]: i for i in old if isinstance(i, dict) and i.get("id") and i.get("title") and i.get("url")}
    seen = now.isoformat(timespec="minutes")
    for item in items:
        prev = merged.get(item["id"], {})
        merged[item["id"]] = {**prev, **item, "seen": prev.get("seen") or seen}
    cutoff = (now - dt.timedelta(days=ARCHIVE_DAYS)).isoformat()
    kept = []
    for item in merged.values():
        tag_item(item, keys, chip_keys)
        vid = youtube_id(item.get("url"))
        if vid and vid in video_views:
            item["views"] = video_views[vid]
        if not item["devices"] and not item.get("chipsets") and not (ARCHIVE_FLAGS & set(item.get("flags", []))):
            continue
        if (item.get("published") or item.get("seen") or "") < cutoff:
            continue
        kept.append(item)
    kept.sort(key=lambda x: x.get("published") or x.get("seen") or "", reverse=True)
    kept = kept[:ARCHIVE_MAX]
    data = {"updatedAt": now.isoformat(timespec="seconds"), "keepsDays": ARCHIVE_DAYS,
            "note": "Headlines that name a device or chipset (or, from Version 18, a software update, a service offer or a flagship chip), collected automatically from the registered feeds. Titles and links only.",
            "items": kept}
    ARCHIVE_OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = ARCHIVE_OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(ARCHIVE_OUT)
    return data


# Model-like names: a product line followed by a model number ("Galaxy S27 Ultra", "Pixel 11a", "Xiaomi 18T Pro").
SPOT_LINES = (r"iPhone|iPad(?: Pro| Air| mini)?|AirPods(?: Pro| Max)?|Apple Watch(?: Series| Ultra| SE)?|Galaxy(?: Z)?(?: Tab| Watch| Buds| Ring)?|Pixel(?: Watch| Buds| Tablet)?|"
              r"Xiaomi(?: Pad| Watch| Smart Band| Buds)?|Redmi(?: Note| Pad| Watch| Buds| K| Turbo)?|POCO|vivo(?: X| V| Y| Pad)?|iQOO(?: Neo| Z)?|OPPO(?: Find| Reno| Pad| Enco| Watch)?|"
              r"Find(?: X| N)|Reno|OnePlus(?: Nord| Pad| Buds| Watch)?|realme(?: GT| Pad| Buds)?|HONOR(?: Magic| Pad| X)?|HUAWEI(?: Mate| Pura| nova| MatePad| FreeBuds| Watch)?|"
              r"Mate|Pura|Nothing Phone|CMF Phone|Xperia|moto(?: g| edge)?|razr|ROG Phone|RedMagic|Nubia")
SPOT_RE = re.compile(r"\b(?:" + SPOT_LINES + r")\s+\(?[A-Za-z]{0,2}\d{1,4}[A-Za-z]{0,2}\)?(?:\s+(?:Pro\+?|Max|Ultra|Plus|\+|Lite|FE|Edge|Fold|Flip|mini|Air|Neo|Classic|Active|Kids))*",
                     re.I)
SPOT_SKIP = re.compile(r"\b(?:iOS|Android|One UI|HyperOS)\b", re.I)


def spot_new_models(items: list[dict], keys, now: dt.datetime) -> None:
    """live/spotted.json: model names in recent headlines that match no device in the database."""
    found: dict[str, dict] = {}
    for item in items:
        if item.get("lang") == "zh":
            continue
        for m in SPOT_RE.finditer(item["title"]):
            name = re.sub(r"\s+", " ", m.group(0)).strip(" ()")
            norm = normalize(name)
            if SPOT_SKIP.search(name) or match_devices(norm, keys) or len(norm) < 5:
                continue
            entry = found.setdefault(norm, {"name": name, "count": 0, "sources": [], "first": None, "last": None, "examples": []})
            entry["count"] += 1
            if item["source"] not in entry["sources"]:
                entry["sources"].append(item["source"])
            when = item.get("published")
            if when:
                entry["first"] = min(filter(None, [entry["first"], when]))
                entry["last"] = max(filter(None, [entry["last"], when]))
            if len(entry["examples"]) < 3:
                entry["examples"].append({"title": item["title"], "url": item["url"], "source": item["source"]})
    rows = sorted((e for e in found.values() if len(e["sources"]) >= 2 or e["count"] >= 3), key=lambda e: (-len(e["sources"]), -e["count"], e["name"]))
    SPOTTED_OUT.write_text(json.dumps({"updatedAt": now.isoformat(timespec="seconds"),
                                       "note": "Model names that appear in two or more sources' recent headlines but match no device in the hub.",
                                       "models": rows[:60]}, ensure_ascii=False, indent=1), encoding="utf-8")


def write_live_config(cfg: dict, keys: list[tuple[str, str]]) -> None:
    """The feed list and matching rules, for collecting in the browser through the relay (relay/worker.js).
    The relay only fetches addresses listed here, so it cannot be used to reach any other site."""
    out = {
        "relay": (cfg.get("relay") or "").strip(),
        "maxAgeDays": cfg.get("maxAgeDays", 45),
        "perFeed": cfg.get("perFeed", 20),
        "maxItems": cfg.get("maxItems", 240),
        "feeds": [{"source": f["source"], "kind": f["kind"], "url": f["url"], **({"lang": f["lang"]} if f.get("lang") else {}), **({"tz": f["tz"]} if f.get("tz") else {})}
                  for f in cfg["feeds"] if f.get("url")],
        "noImageSources": sorted(NO_IMAGE_SOURCES),
        "reviewWords": REVIEW_WORDS.pattern,
        "topicPatterns": TOPIC_PATTERNS,
        "zhBrands": ZH_BRANDS,
        "topicPatternsZh": TOPIC_PATTERNS_ZH,
        "reviewWordsZh": REVIEW_WORDS_ZH,
        "nextReject": sorted(NEXT_REJECT),
        "keys": keys,
        # Version 17: chipsets and the section each headline belongs to, so a browser collection tags them the same way
        "chipKeys": load_chip_keys(),
        "chipNextReject": sorted(CHIP_NEXT_REJECT),
        "chipPrevReject": sorted(CHIP_PREV_REJECT),
        "topicRules": TOPIC_RULES,
        # Version 18: section flags, so a browser collection tags them the same way
        "flagRules": FLAG_RULES,
        "offerRules": [OFFER_BRAND, OFFER_SERVICE, OFFER_DEAL],
        "offerMy": OFFER_MY,
        "mySources": sorted(MY_SOURCES),
    }
    LIVE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    tmp = LIVE_CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(LIVE_CONFIG)


YT_API = "https://www.googleapis.com/youtube/v3/"


def youtube_videos(channel: str, key: str, per_feed: int) -> list[tuple]:
    """The newest uploads of a channel through the YouTube Data API, as (title, link, date, image, views) like parse_feed.
    Costs 2 quota units per channel (the free daily quota is 10,000)."""
    playlist = "UU" + channel[2:]  # every channel's uploads playlist
    q = urllib.parse.urlencode({"part": "snippet", "playlistId": playlist, "maxResults": min(per_feed, 50), "key": key})
    listing = json.loads(fetch(YT_API + "playlistItems?" + q))
    rows = []
    for it in listing.get("items", []):
        sn = it.get("snippet", {})
        vid = (sn.get("resourceId") or {}).get("videoId")
        if not vid or sn.get("title") in ("Private video", "Deleted video"):
            continue
        thumbs = sn.get("thumbnails") or {}
        image = (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get("url")
        rows.append([sn.get("title"), f"https://www.youtube.com/watch?v={vid}", sn.get("publishedAt"), image, None, vid])
    if rows:
        q = urllib.parse.urlencode({"part": "statistics", "id": ",".join(r[5] for r in rows), "key": key})
        stats = {v["id"]: v.get("statistics", {}) for v in json.loads(fetch(YT_API + "videos?" + q)).get("items", [])}
        for r in rows:
            views = stats.get(r[5], {}).get("viewCount")
            r[4] = int(views) if views and str(views).isdigit() else None
    return [tuple(r[:5]) for r in rows]


def collect() -> dict:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    keys = load_keys()
    chip_keys = load_chip_keys()
    write_live_config(cfg, keys)
    topic = re.compile(r"(?<![a-z0-9])(?:" + "|".join(TOPIC_PATTERNS) + r")(?![a-z0-9])")
    topic_zh = re.compile(TOPIC_PATTERNS_ZH)
    review_zh = re.compile(REVIEW_WORDS_ZH)

    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=cfg.get("maxAgeDays", 45))
    per_feed = cfg.get("perFeed", 20)
    items: dict[str, dict] = {}
    feeds_out = []
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        video_views: dict[str, int] = {}
        yt_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
        futures = {}
        for feed in cfg["feeds"]:
            if feed.get("channel"):
                if yt_key:
                    futures[pool.submit(youtube_videos, feed["channel"], yt_key, per_feed)] = feed
                else:
                    feeds_out.append({"source": feed["source"], "kind": feed["kind"], "ok": False, "kept": 0,
                                      "error": "needs a YouTube Data API key; videos collected earlier are kept"})
            elif feed.get("url"):
                futures[pool.submit(fetch, feed["url"])] = feed
        for future in cf.as_completed(futures):
            feed = futures[future]
            status = {"source": feed["source"], "kind": feed["kind"]}
            try:
                result = future.result()
                parsed = result if feed.get("channel") else parse_feed(result)
            except Exception as exc:
                error = f"{exc.__class__.__name__}: {str(exc)[:120]}"
                status.update(ok=False, kept=0, error=error.replace(yt_key, "…") if yt_key else error)  # never publish the key
                feeds_out.append(status)
                continue
            kept = 0
            for _t, v_link, _d, _i, v_views in parsed:  # every video in the feed, matched or not, for views.json
                vid = youtube_id(v_link)
                if vid and v_views is not None:
                    video_views[vid] = v_views
            for raw_title, raw_link, raw_date, raw_image, raw_views in parsed:
                title = clean_title(raw_title)
                link = (raw_link or "").strip()
                if not title or not link.startswith(("https://", "http://")):
                    continue
                published = parse_date(raw_date, feed.get("tz"))
                if published and published < cutoff:
                    continue
                norm = normalize(title)
                matched = match_devices(norm, keys)
                if not matched and not topic.search(norm) and not topic_zh.search(title) and not flags_of(title, feed["source"]):
                    continue
                item_id = hashlib.sha1(link.encode("utf-8")).hexdigest()[:12]
                if item_id in items:
                    continue
                is_review = REVIEW_WORDS.search(title) or review_zh.search(title)
                kind = "video" if feed["kind"] == "video" else ("review" if is_review else feed["kind"])
                items[item_id] = {
                    "id": item_id,
                    "title": title,
                    "url": link,
                    "source": feed["source"],
                    **({"lang": feed["lang"]} if feed.get("lang") else {}),
                    "kind": kind,
                    "published": published.isoformat(timespec="minutes") if published else None,
                    "devices": matched,
                    "image": None if feed["source"] in NO_IMAGE_SOURCES else raw_image,
                    **({"views": raw_views} if raw_views is not None else {}),
                }
                tag_item(items[item_id], keys, chip_keys)
                kept += 1
                if kept >= per_feed:
                    break
            status.update(ok=True, kept=kept)
            feeds_out.append(status)

    # Channels that could not be read this time (no API key, quota, network) keep the videos collected earlier.
    skipped = {f["source"] for f in feeds_out if not f.get("ok") and f.get("kind") == "video"}
    if skipped and OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8")).get("items", [])
        except ValueError:
            previous = []
        for old in previous:
            when = old.get("published")
            if old.get("source") in skipped and old.get("id") not in items and (not when or when >= cutoff.isoformat()):
                items[old["id"]] = tag_item(dict(old), keys, chip_keys)
    ordered = sorted(items.values(), key=lambda x: x["published"] or "", reverse=True)[: cfg.get("maxItems", 240)]
    return {
        "fetchedAt": now.isoformat(timespec="seconds"),
        "maxAgeDays": cfg.get("maxAgeDays", 45),
        "feeds": sorted(feeds_out, key=lambda s: s["source"]),
        "items": ordered,
        "videoViews": video_views,
    }


def run(quiet: bool = False) -> dict:
    """Collect and save. If every feed fails (offline), keep the last saved headlines."""
    data = collect()
    video_views = data.pop("videoViews", {})
    save_views(video_views, data["fetchedAt"])
    ok = [f for f in data["feeds"] if f["ok"]]
    failed = [f["source"] for f in data["feeds"] if not f["ok"]]
    if not ok and OUT.exists():
        print("[headlines] No feed could be reached; keeping the headlines collected earlier.")
        previous = json.loads(OUT.read_text(encoding="utf-8"))
        previous["lastAttempt"] = {"at": data["fetchedAt"], "ok": False}
        return previous
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(OUT)
    now = dt.datetime.fromisoformat(data["fetchedAt"])
    keys = load_keys()
    archive = update_archive(data["items"], keys, load_chip_keys(), video_views, now)
    spot_new_models(data["items"], keys, now)
    if not quiet or failed:
        print(f"[headlines] {len(data['items'])} headlines from {len(ok)} of {len(data['feeds'])} feeds; archive {len(archive['items'])}"
              + (f"; unreachable: {', '.join(failed)}" if failed else "") + ".")
    return data


def save_views(found: dict[str, int], at: str) -> None:
    """live/views.json: {"videos": {id: [views, counted_at]}}. Counts from earlier runs are kept for videos that have
    left the channel feeds (each keeps its own date), so a saved review video can still show how often it was watched."""
    old = {}
    if VIEWS_OUT.exists():
        try:
            old = json.loads(VIEWS_OUT.read_text(encoding="utf-8")).get("videos", {})
        except ValueError:
            old = {}
    videos = {**old, **{vid: [n, at] for vid, n in found.items()}}
    if not videos:
        return
    VIEWS_OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = VIEWS_OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps({"updatedAt": at, "source": "YouTube channel feeds (media:statistics)", "videos": videos},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(VIEWS_OUT)


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect the latest headlines into live/headlines.json.")
    parser.add_argument("--quiet", action="store_true")
    run(quiet=parser.parse_args().quiet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
