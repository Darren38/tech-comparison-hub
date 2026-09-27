"""Version 21: older headlines for the device pages, so a phone launched months ago still shows its reviews, tests,
videos and news, not only what the feeds carried in the last few days.

Feeds only list a site's newest items. This reads further back, from two kinds of source:

- the publishers' own sitemaps (listed in data/meta/backfill.json). An article's address names its subject
  ("…/samsung-galaxy-s26-ultra-review/"), so the address is matched against the device names first; only a matching
  page is then read, for its real headline, date and picture, and it is kept only when the real headline names the
  device too. Every address is checked against the site's robots.txt with this collector's user agent, and requests
  to a site are spaced out (at least the site's Crawl-delay, or BACKFILL_DELAY seconds).
- the registered YouTube channels' upload lists, through the official YouTube Data API (YOUTUBE_API_KEY; about 1 quota
  unit per 50 videos, plus 1 per 50 for view counts). Without a key this part is skipped.

Flagships and Apple and Samsung models are read first; each device gets at most PER_DEVICE backfilled items, newest
first, so one popular phone can't crowd out the rest. What was found is merged into live/archive.json exactly like a
feed item (re-tagged by tools/fetch_headlines.py on every run); addresses already read are remembered in
live/auto/backfill_state.json so a later run only reads new ones.

    python tools/backfill_news.py                  # every source, within the time and page limits
    python tools/backfill_news.py --source 9to5mac --pages 20 --dry-run
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import html
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_headlines as fh  # noqa: E402  (the same names, matching rules and archive)
from devices_all import all_devices  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "meta" / "backfill.json"
STATE = ROOT / "live" / "auto" / "backfill_state.json"
SM = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
PER_DEVICE = 24          # backfilled items kept per device (the feeds add more on top)
DEFAULT_DELAY = float(os.environ.get("BACKFILL_DELAY", "3"))
REVIEWISH = re.compile(r"\b(review|hands on|hands-on|tested|test|vs|versus|camera|battery|benchmark|teardown|durability|compared?|comparison)\b", re.I)
FLAGSHIP_NAME = re.compile(r"\b(ultra|pro max|pro\+?|fold|flip|duo|air)\b", re.I)


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Polite:
    """robots.txt checks and spacing per host."""

    def __init__(self, delay: float):
        self.delay = delay
        self.robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.last: dict[str, float] = {}

    def _robots(self, url: str):
        host = urllib.parse.urlsplit(url).netloc
        if host not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                raw = fh.fetch(f"https://{host}/robots.txt", timeout=20).decode("utf-8", "replace")
                rp.parse(raw.splitlines())
            except Exception:  # no readable robots.txt: treat as not allowed, to be safe
                rp = None
            self.robots[host] = rp
        return self.robots[host]

    def allowed(self, url: str) -> bool:
        rp = self._robots(url)
        return bool(rp and rp.can_fetch(fh.UA, url))

    def get(self, url: str, timeout: int = 30) -> bytes:
        host = urllib.parse.urlsplit(url).netloc
        rp = self._robots(url)
        wait = max(self.delay, float((rp.crawl_delay(fh.UA) if rp else None) or 0))
        gap = time.time() - self.last.get(host, 0)
        if gap < wait:
            time.sleep(wait - gap)
        try:
            return fh.fetch(url, timeout=timeout)
        finally:
            self.last[host] = time.time()


def read_sitemap(raw: bytes) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """(child sitemaps, pages) as (address, lastmod) pairs."""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    root = ET.fromstring(raw)
    kids = [((s.findtext(f"{SM}loc") or "").strip(), (s.findtext(f"{SM}lastmod") or "").strip()) for s in root.iter(f"{SM}sitemap")]
    pages = [((u.findtext(f"{SM}loc") or "").strip(), (u.findtext(f"{SM}lastmod") or "").strip()) for u in root.iter(f"{SM}url")]
    return [k for k in kids if k[0]], [p for p in pages if p[0]]


def slug_words(url: str) -> str:
    """The words an article's address uses for its subject ("…/2026/02/25/galaxy-s26-ultra-review/" -> "galaxy s26 ultra review")."""
    path = urllib.parse.unquote(urllib.parse.urlsplit(url).path)
    parts = [p for p in path.split("/") if p]
    parts = [re.sub(r"\.(html?|php)$", "", p) for p in parts]
    parts = [p for p in parts if re.search(r"[a-z]", p, re.I) and not re.fullmatch(r"[0-9a-f-]{16,}|\d+", p)]
    if not parts:
        return ""
    slug = max(parts, key=len)
    slug = re.sub(r"[-_]\d{5,}$", "", slug)  # a trailing article number
    return re.sub(r"[-_]+", " ", slug)


def url_date(url: str) -> str | None:
    m = re.search(r"/(20\d{2})/(\d{2})/(?:(\d{2})/)?", url)
    if not m:
        return None
    return f"{m[1]}-{m[2]}-{m[3] or '01'}"


META = {
    "title": [r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)', r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title', r"<title[^>]*>([^<]+)</title>"],
    "published": [r'<meta[^>]+property=["\']article:published_time["\'][^>]+content=["\']([^"\']+)', r'"datePublished"\s*:\s*"([^"]+)"',
                  r'<meta[^>]+name=["\'](?:pubdate|publishdate|date)["\'][^>]+content=["\']([^"\']+)', r'<time[^>]+datetime=["\']([^"\']+)'],
    "image": [r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image'],
}


def page_meta(raw: bytes) -> dict:
    text = raw[:400_000].decode("utf-8", "replace")
    out = {}
    for field, patterns in META.items():
        for p in patterns:
            m = re.search(p, text, re.I)
            if m:
                out[field] = html.unescape(m[1]).strip()
                break
    return out


def clean_site_suffix(title: str, site: str) -> str:
    """"Galaxy S26 Ultra review | 9to5Google" -> "Galaxy S26 Ultra review"."""
    for sep in (" | ", " - ", " – ", " — "):
        if sep in title:
            head, tail = title.rsplit(sep, 1)
            if tail and len(tail) <= 40 and (site.lower().replace(" ", "") in tail.lower().replace(" ", "") or len(tail.split()) <= 3):
                return head.strip()
    return title.strip()


def iso(value: str | None) -> str | None:
    if not value:
        return None
    d = fh.parse_date(value)
    if d is None:
        m = re.match(r"(\d{4}-\d{2}-\d{2})", value)
        d = fh.parse_date(m[1] + "T00:00:00+00:00") if m else None
    return d.astimezone(dt.timezone.utc).isoformat(timespec="minutes") if d else None


def priority(dev: dict) -> int:
    """0 = flagship, Apple or Samsung (read first); 1 = everything else."""
    if dev.get("brand") in ("apple", "samsung"):
        return 0
    if dev.get("segment") == "flagship" or (dev.get("category") == "smartphone" and FLAGSHIP_NAME.search(dev.get("name", ""))):
        return 0
    return 1


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(STATE)


def sitemap_candidates(src: dict, polite: Polite, state: dict, keys, cutoff: str, deadline: float, log) -> list[dict]:
    """Addresses from a publisher's sitemaps whose words name a device, newest first."""
    seen_maps = state.setdefault("sitemaps", {})
    out = []
    todo = [(src["sitemap"], "")]
    kids_read = 0
    child_re = re.compile(src.get("children", "."), re.I)
    url_re = re.compile(src["urlFilter"], re.I) if src.get("urlFilter") else None
    while todo and time.time() < deadline:
        url, lastmod = todo.pop(0)
        if not polite.allowed(url):
            log(f"  robots.txt does not allow {url}")
            continue
        try:
            kids, pages = read_sitemap(polite.get(url))
        except Exception as e:  # noqa: BLE001  (one unreadable sitemap never stops the run)
            log(f"  could not read {url}: {e}")
            continue
        if kids:
            fresh = [k for k in kids if child_re.search(k[0]) and (not k[1] or k[1][:10] >= cutoff[:10])]
            # newest first; many sites give every file the same date, so the higher file number breaks the tie
            num = lambda u: int(m[1]) if (m := re.search(r"(\d+)\.xml(?:\.gz)?$", u)) else 0  # noqa: E731
            fresh.sort(key=lambda k: (k[1][:10] if k[1] else "", num(k[0])), reverse=True)
            # a child sitemap already read with the same date holds nothing new
            fresh = [k for k in fresh if seen_maps.get(k[0]) != (k[1] or "?")]
            todo.extend(fresh[: src.get("maxSitemaps", 6)])
            continue
        kids_read += 1
        for page, mod in pages:
            if url_re and not url_re.search(page):
                continue
            when = url_date(page) or (mod[:10] if mod else None)
            if when and when < cutoff[:10]:
                continue
            words = slug_words(page)
            if not words:
                continue
            ids = fh.match_devices(fh.normalize(words), keys)
            if ids:
                out.append({"url": page, "ids": ids, "when": when or "", "words": words})
        if lastmod or url != src["sitemap"]:
            seen_maps[url] = lastmod or "?"
    log(f"  {src['source']}: {kids_read} sitemap(s) read, {len(out)} addresses name a device")
    return out


def youtube_candidates(feeds: list[dict], key: str, keys, cutoff: str, log, pages_per_channel: int = 10) -> list[dict]:
    """Older uploads of the registered channels that name a device (YouTube Data API)."""
    out = []
    for f in feeds:
        if f.get("kind") != "video" or not (f.get("channel") or f.get("username")):
            continue
        try:
            channel = fh.youtube_channel(f, key)
        except Exception as e:  # noqa: BLE001
            log(f"  YouTube {f['source']}: {e}")
            continue
        token, rows = None, []
        for _ in range(pages_per_channel):
            q = {"part": "snippet", "playlistId": "UU" + channel[2:], "maxResults": 50, "key": key}
            if token:
                q["pageToken"] = token
            try:
                listing = json.loads(fh.fetch(fh.YT_API + "playlistItems?" + urllib.parse.urlencode(q)))
            except Exception as e:  # noqa: BLE001
                log(f"  YouTube {f['source']}: {e}")
                break
            old = False
            for it in listing.get("items", []):
                sn = it.get("snippet", {})
                vid = (sn.get("resourceId") or {}).get("videoId")
                when = iso(sn.get("publishedAt"))
                if not vid or not when or sn.get("title") in ("Private video", "Deleted video"):
                    continue
                if when < cutoff:
                    old = True
                    continue
                title = fh.clean_title(sn.get("title"))
                ids = fh.match_devices(fh.normalize(title), keys)
                if ids:
                    thumbs = sn.get("thumbnails") or {}
                    image = (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get("url")
                    rows.append({"title": title, "url": f"https://www.youtube.com/watch?v={vid}", "vid": vid, "published": when,
                                 "image": image, "source": f["source"], "ids": ids, **({"lang": f["lang"]} if f.get("lang") else {})})
            token = listing.get("nextPageToken")
            if old or not token:
                break
        for i in range(0, len(rows), 50):
            chunk = rows[i:i + 50]
            try:
                stats = json.loads(fh.fetch(fh.YT_API + "videos?" + urllib.parse.urlencode({"part": "statistics", "id": ",".join(r["vid"] for r in chunk), "key": key})))
                views = {v["id"]: v.get("statistics", {}).get("viewCount") for v in stats.get("items", [])}
                for r in chunk:
                    v = views.get(r["vid"])
                    if v and str(v).isdigit():
                        r["views"] = int(v)
            except Exception as e:  # noqa: BLE001
                log(f"  YouTube views {f['source']}: {e}")
        log(f"  YouTube {f['source']}: {len(rows)} older videos name a device")
        out += rows
    return out


def run(only: str | None = None, pages: int | None = None, minutes: float | None = None, dry_run: bool = False, log=print) -> dict:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    state = load_state()
    now = now_utc()
    cutoff = (now - dt.timedelta(days=cfg.get("maxAgeDays", fh.ARCHIVE_DAYS))).isoformat(timespec="minutes")
    deadline = time.time() + 60 * (minutes if minutes is not None else cfg.get("minutesPerRun", 12))
    budget = pages if pages is not None else cfg.get("pagesPerRun", 160)
    keys = fh.load_keys()
    devices = {d["id"]: d for d in all_devices()}
    polite = Polite(DEFAULT_DELAY)
    registry = json.loads((fh.DATA / "sources" / "sources.json").read_text(encoding="utf-8"))
    names = {s["id"]: s["name"] for s in (registry.get("sources", []) if isinstance(registry, dict) else registry)}

    # how many items each device already has in the archive (backfill fills the gaps first)
    try:
        archive = json.loads(fh.ARCHIVE_OUT.read_text(encoding="utf-8")).get("items", [])
    except (OSError, ValueError):
        archive = []
    have: dict[str, int] = {}
    known_urls = {i.get("url") for i in archive}
    for i in archive:
        for d in i.get("devices", []):
            have[d] = have.get(d, 0) + 1

    found: list[dict] = []
    stats = {"sources": {}, "pagesRead": 0, "added": 0}
    lock = threading.Lock()

    def one_source(src: dict) -> None:
        """One publisher, read by its own thread: requests to one site stay spaced out, and sites are read side by side."""
        sstate = state.setdefault("sources", {}).setdefault(src["source"], {})
        done = sstate.setdefault("read", {})  # address -> "kept" / "skipped" / "failed"
        # addresses found earlier but not read yet (the page limit ran out) wait in a queue for the next run
        queue = {c["url"]: c for c in sstate.get("queue", [])}
        for c in sitemap_candidates(src, polite, sstate, keys, cutoff, deadline, log):
            queue.setdefault(c["url"], c)
        cands = [c for c in queue.values() if c["url"] not in done and c["url"] not in known_urls and (c["when"] or "9999") >= cutoff[:10]]
        # flagships, Apple and Samsung first; then devices with the fewest items; reviews and tests before other news; newest first
        with lock:
            cands.sort(key=lambda c: (min(priority(devices.get(i, {})) for i in c["ids"]), min(have.get(i, 0) for i in c["ids"]),
                                      0 if REVIEWISH.search(c["words"]) else 1, "".join(chr(255 - ord(ch)) for ch in c["when"])))
        per_src = min(src.get("pagesPerRun", budget), budget)
        read = kept = 0
        for c in cands:
            if read >= per_src or time.time() > deadline:
                break
            with lock:
                if all(have.get(i, 0) >= PER_DEVICE for i in c["ids"]):
                    continue
            if not polite.allowed(c["url"]):
                done[c["url"]] = "robots"
                continue
            read += 1
            try:
                meta = page_meta(polite.get(c["url"]))
            except Exception:  # noqa: BLE001
                done[c["url"]] = "failed"
                continue
            title = fh.clean_title(clean_site_suffix(meta.get("title", ""), names.get(src["source"], src["source"])))
            ids = fh.match_devices(fh.normalize(title), keys) if title else []
            published = iso(meta.get("published")) or (c["when"] + "T00:00+00:00" if c["when"] else None)
            if not ids or not published or published < cutoff:
                done[c["url"]] = "skipped"
                continue
            image = meta.get("image") if (meta.get("image") or "").startswith("https://") and src["source"] not in fh.NO_IMAGE_SOURCES else None
            item = {"id": hashlib.sha1(c["url"].encode("utf-8")).hexdigest()[:12], "title": title, "url": c["url"], "source": src["source"],
                    "kind": "review" if fh.REVIEW_WORDS.search(title) else "news", "published": published,
                    **({"image": image[:500]} if image else {}), **({"lang": src["lang"]} if src.get("lang") else {}), "backfill": True}
            done[c["url"]] = "kept"
            kept += 1
            with lock:
                found.append(item)
                for i in ids:
                    have[i] = have.get(i, 0) + 1
        sstate["queue"] = [c for c in cands if c["url"] not in done][:600]
        with lock:
            stats["sources"][src["source"]] = {"candidates": len(cands), "read": read, "kept": kept, "waiting": len(sstate["queue"])}
            stats["pagesRead"] += read
        log(f"  {src['source']}: read {read} page(s), kept {kept}")

    chosen = [src for src in cfg.get("sources", []) if not only or src["source"] == only]
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(chosen))) as pool:
        for fut in [pool.submit(one_source, src) for src in chosen]:
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001  (one site failing never stops the others)
                log(f"  a source failed: {e}")

    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if key and cfg.get("youtube", True) and (not only or only == "youtube") and time.time() < deadline:
        feeds = json.loads(fh.CONFIG.read_text(encoding="utf-8"))["feeds"]
        last = state.get("youtubeAt")
        # the whole upload history once a week is plenty (new uploads come in through the 3-hourly feed read)
        if dry_run or not last or last < (now - dt.timedelta(days=cfg.get("youtubeEveryDays", 7))).isoformat():
            vids = youtube_candidates(feeds, key, keys, cutoff, log)
            for v in sorted(vids, key=lambda r: r["published"], reverse=True):
                if v["url"] in known_urls or all(have.get(i, 0) >= PER_DEVICE for i in v["ids"]):
                    continue
                found.append({"id": hashlib.sha1(v["url"].encode("utf-8")).hexdigest()[:12], "title": v["title"], "url": v["url"], "source": v["source"],
                              "kind": "video", "published": v["published"], **({"image": v["image"]} if v.get("image") else {}),
                              **({"views": v["views"]} if v.get("views") else {}), **({"lang": v["lang"]} if v.get("lang") else {}), "backfill": True})
                for i in v["ids"]:
                    have[i] = have.get(i, 0) + 1
            state["youtubeAt"] = now.isoformat(timespec="minutes")
            stats["sources"]["youtube"] = {"kept": sum(1 for f in found if f["kind"] == "video")}

    # forget addresses older than the archive keeps, so the state file stays small
    for s in state.get("sources", {}).values():
        s["read"] = {u: v for u, v in s.get("read", {}).items() if (url_date(u) or "9999") >= cutoff[:10]}
    stats["added"] = len(found)
    if dry_run:
        for f in found[:40]:
            log(f"    + {f['published'][:10]} {f['source']:12} {f['title'][:90]}")
        return stats
    if found:
        fh.update_archive(found, keys, fh.load_chip_keys(), {}, now)
    state["updatedAt"] = now.isoformat(timespec="seconds")
    state["lastRun"] = stats
    save_state(state)
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", help="only this source id (or 'youtube')")
    ap.add_argument("--pages", type=int, help="most article pages to read this run")
    ap.add_argument("--minutes", type=float, help="time limit for this run")
    ap.add_argument("--dry-run", action="store_true", help="show what would be added; change nothing")
    ap.add_argument("--max-age-hours", type=float, help="skip the run when the last one finished less than this long ago")
    a = ap.parse_args()
    if a.max_age_hours and not a.dry_run:
        last = load_state().get("updatedAt")
        if last and fh.parse_date(last) and (now_utc() - fh.parse_date(last)).total_seconds() < a.max_age_hours * 3600:
            print(f"backfill ran at {last}; next run after {a.max_age_hours} hours")
            return 0
    stats = run(a.source, a.pages, a.minutes, a.dry_run)
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
