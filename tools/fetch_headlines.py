"""Collect the latest headlines and videos from registered sources into live/headlines.json.

Reads the feed list in data/meta/live-feeds.json (RSS 2.0 or Atom, including YouTube channel
feeds), keeps only items about phones, tablets, watches, their chips and their makers, tags the
devices each headline names, and stores the title, link, source, kind and date, plus the address of
the thumbnail the publisher put in its own feed (shown from the publisher's server, never copied).
No article text is copied. GSMArena's thumbnails are not kept (its robots.txt disallows Claude's crawlers).

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
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = DATA / "meta" / "live-feeds.json"
OUT = ROOT / "live" / "headlines.json"
# Published next to the headlines so a browser (through the relay in relay/) collects with the same feeds and rules.
LIVE_CONFIG = ROOT / "live" / "config.json"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/5.0; headline collector)"
ATOM = "{http://www.w3.org/2005/Atom}"
MEDIA = "{http://search.yahoo.com/mrss/}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"
NO_IMAGE_SOURCES = {"gsmarena"}  # headlines stay text-only for these sources
KINDS = {"news", "review", "video"}

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


def parse_feed(raw: bytes) -> list[tuple[str | None, str | None, str | None, str | None]]:
    root = ET.fromstring(raw)
    items = []
    for item in root.iter("item"):
        date = item.findtext("pubDate") or item.findtext("{http://purl.org/dc/elements/1.1/}date")
        items.append((item.findtext("title"), item.findtext("link"), date, feed_image(item)))
    for entry in root.iter(f"{ATOM}entry"):
        link = next((l.get("href") for l in entry.findall(f"{ATOM}link") if l.get("rel", "alternate") == "alternate"), None)
        date = entry.findtext(f"{ATOM}published") or entry.findtext(f"{ATOM}updated")
        items.append((entry.findtext(f"{ATOM}title"), link, date, feed_image(entry)))
    return items


def fetch(url: str, timeout: int = 20) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(4_000_000)


def device_keys(devices: list[dict], brand_names: dict[str, str]) -> list[tuple[str, str]]:
    keys: dict[str, str] = {}
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
            if len(key) >= 4 and has_model_number and has_identity:
                keys.setdefault(key, dev["id"])
    return sorted(keys.items(), key=lambda kv: -len(kv[0]))


def match_devices(title_norm: str, keys: list[tuple[str, str]]) -> list[str]:
    taken: list[tuple[int, int]] = []
    found: list[str] = []
    for key, device_id in keys:
        for m in re.finditer(r"(?<![a-z0-9])" + re.escape(key) + r"(?![a-z0-9])", title_norm):
            start, end = m.span()
            following = title_norm[end:].split()[:1]
            if following and following[0] in NEXT_REJECT:
                continue
            if any(start < t_end and end > t_start for t_start, t_end in taken):
                continue
            taken.append((start, end))
            if device_id not in found:
                found.append(device_id)
    return found


def load_keys() -> list[tuple[str, str]]:
    brands = json.loads((DATA / "brands" / "brands.json").read_text(encoding="utf-8"))
    devices = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((DATA / "devices").glob("*/*.json"))]
    return device_keys(devices, {b["id"]: b["name"] for b in brands})


def write_live_config(cfg: dict, keys: list[tuple[str, str]]) -> None:
    """The feed list and matching rules, for collecting in the browser through the relay (relay/worker.js).
    The relay only fetches addresses listed here, so it cannot be used to reach any other site."""
    out = {
        "relay": (cfg.get("relay") or "").strip(),
        "maxAgeDays": cfg.get("maxAgeDays", 45),
        "perFeed": cfg.get("perFeed", 20),
        "maxItems": cfg.get("maxItems", 240),
        "feeds": [{"source": f["source"], "kind": f["kind"], "url": f["url"], **({"lang": f["lang"]} if f.get("lang") else {}), **({"tz": f["tz"]} if f.get("tz") else {})}
                  for f in cfg["feeds"]],
        "noImageSources": sorted(NO_IMAGE_SOURCES),
        "reviewWords": REVIEW_WORDS.pattern,
        "topicPatterns": TOPIC_PATTERNS,
        "zhBrands": ZH_BRANDS,
        "topicPatternsZh": TOPIC_PATTERNS_ZH,
        "reviewWordsZh": REVIEW_WORDS_ZH,
        "nextReject": sorted(NEXT_REJECT),
        "keys": keys,
    }
    LIVE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    tmp = LIVE_CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(LIVE_CONFIG)


def collect() -> dict:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    keys = load_keys()
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
        futures = {pool.submit(fetch, feed["url"]): feed for feed in cfg["feeds"]}
        for future in cf.as_completed(futures):
            feed = futures[future]
            status = {"source": feed["source"], "kind": feed["kind"]}
            try:
                parsed = parse_feed(future.result())
            except Exception as exc:
                status.update(ok=False, kept=0, error=f"{exc.__class__.__name__}: {str(exc)[:120]}")
                feeds_out.append(status)
                continue
            kept = 0
            for raw_title, raw_link, raw_date, raw_image in parsed:
                title = clean_title(raw_title)
                link = (raw_link or "").strip()
                if not title or not link.startswith(("https://", "http://")):
                    continue
                published = parse_date(raw_date, feed.get("tz"))
                if published and published < cutoff:
                    continue
                norm = normalize(title)
                matched = match_devices(norm, keys)
                if not matched and not topic.search(norm) and not topic_zh.search(title):
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
                }
                kept += 1
                if kept >= per_feed:
                    break
            status.update(ok=True, kept=kept)
            feeds_out.append(status)

    ordered = sorted(items.values(), key=lambda x: x["published"] or "", reverse=True)[: cfg.get("maxItems", 240)]
    return {
        "fetchedAt": now.isoformat(timespec="seconds"),
        "maxAgeDays": cfg.get("maxAgeDays", 45),
        "feeds": sorted(feeds_out, key=lambda s: s["source"]),
        "items": ordered,
    }


def run(quiet: bool = False) -> dict:
    """Collect and save. If every feed fails (offline), keep the last saved headlines."""
    data = collect()
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
    if not quiet or failed:
        print(f"[headlines] {len(data['items'])} headlines from {len(ok)} of {len(data['feeds'])} feeds"
              + (f"; unreachable: {', '.join(failed)}" if failed else "") + ".")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect the latest headlines into live/headlines.json.")
    parser.add_argument("--quiet", action="store_true")
    run(quiet=parser.parse_args().quiet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
