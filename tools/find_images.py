"""Find official pictures for devices that have none (Version 17), every 3 days.

    python tools/find_images.py                      look now, write live/auto/found_images.json
    python tools/find_images.py --max-age-hours 160  do nothing if the saved search is newer than that

For each device with no picture in data/, the maker's own page that its specifications were read from is opened (only
where that site's robots.txt allows it) and the picture the page itself declares for sharing (og:image) is taken, but
only when it is served from that maker's own image server and actually loads as an image. Nothing is copied: the site
shows the picture from the maker's server with a credit, exactly like the hand-picked ones. Pictures found this way are
labelled "found automatically" and a hand-picked picture in data/ always wins. The build validates them with the same
rules as every other picture (tools/build.py), and tools/check_images.py re-checks they still load.
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
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "live" / "auto" / "found_images.json"
REJECTS = ROOT / "data" / "image_rejects.json"   # pictures a person rejected after checking the found ones
NOT_PRODUCT = re.compile(r"(?<![a-z])(logo|favicon|icon|share-?default|home-share\w*|placeholder|sprite|kv|banner|bg|background|lifestyle|scene)(?![a-z])", re.I)
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0; +https://darren38.github.io/tech-comparison-hub/)"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import OFFICIAL_IMAGE_HOSTS, OFFICIAL_IMAGE_PREFIXES  # noqa: E402  (same allow-list as the validator)
from devices_all import all_devices  # noqa: E402  (Version 20: devices added automatically count too)

MAKER_PAGE = re.compile(r"^https?://[^/]*((samsung|apple|honor|huawei|mi|oppo|vivo|iqoo|asus|realme|oneplus)\.com(\.cn)?|redmagic\.gg|nothing\.tech)/")
ARCHIVE = re.compile(r"^https://web\.archive\.org/web/(\d{14})/(.+)$")
CREDIT = {"samsung": "Samsung", "apple": "Apple", "honor": "HONOR", "huawei": "Huawei", "mi": "Xiaomi", "oppo": "OPPO", "vivo": "vivo",
          "iqoo": "iQOO", "asus": "ASUS", "realme": "realme", "oneplus": "OnePlus", "redmagic": "REDMAGIC", "nothing": "Nothing"}
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def allowed(url: str) -> bool:
    parts = urllib.parse.urlsplit(url)
    key = f"{parts.scheme}://{parts.netloc}"
    if key not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(key + "/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                rp.parse(r.read().decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError as e:
            rp = None if e.code >= 500 else rp  # a missing robots.txt allows everything
            if rp is not None:
                rp.parse([])
        except Exception:
            rp = None  # unreachable: don't fetch
        _robots[key] = rp
    rp = _robots[key]
    return bool(rp and rp.can_fetch(UA, url))


_last_hit: dict[str, float] = {}
_slow_pages: dict[str, int] = {}
SLOW_SITE_PAGES = 10   # pages per run from a site that asks for a long delay between requests


def polite_wait(url: str) -> bool:
    """Wait as long as the site's robots.txt asks (at least 1.5 s). False when a slow site's quota for this run is used."""
    parts = urllib.parse.urlsplit(url)
    key = f"{parts.scheme}://{parts.netloc}"
    rp = _robots.get(key)
    delay = max(1.5, float((rp.crawl_delay(UA) if rp else None) or 0))
    if delay >= 10:
        if _slow_pages.get(key, 0) >= SLOW_SITE_PAGES:
            return False
        _slow_pages[key] = _slow_pages.get(key, 0) + 1
    wait = delay - (time.time() - _last_hit.get(key, 0))
    if wait > 0:
        time.sleep(wait)
    _last_hit[key] = time.time()
    return True


def fetch(url: str, limit: int = 600_000) -> str | None:
    if not polite_wait(url):
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read(limit).decode("utf-8", "replace")
    except Exception:
        return None


def loads_as_image(url: str) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-2047", "Accept": "image/*"})
        with urllib.request.urlopen(req, timeout=25) as r:
            kind = r.headers.get("Content-Type", "")
            head = r.read(2048)
            return kind.startswith("image/") or head[:4] in (b"\x89PNG", b"RIFF", b"GIF8") or head[:2] == b"\xff\xd8"
    except Exception:
        return False


def official(src: str) -> bool:
    plain = re.sub(r"^https://web\.archive\.org/web/\d{14}im_/", "", src)
    host = re.sub(r"^https?://([^/]+)/.*$", r"\1", plain)
    return host in OFFICIAL_IMAGE_HOSTS or plain.startswith(OFFICIAL_IMAGE_PREFIXES)


def og_image(page_html: str) -> str | None:
    for pattern in (r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)["\']',
                    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']'):
        m = re.search(pattern, page_html, re.I)
        if m:
            return html.unescape(m.group(1).strip())
    return None


def ld_image(page_html: str) -> str | None:
    """Version 20: the picture in the page's own product data (JSON-LD "image"), e.g. Huawei's product list picture."""
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page_html, re.I | re.S):
        m = re.search(r'"image"\s*:\s*\[?\s*"([^"]+)"', block)
        if m:
            return html.unescape(m.group(1).strip())
    return None


def page_pictures(page_html: str) -> list[str]:
    """Pictures a maker's page declares for itself: the sharing picture first, then its product data picture."""
    return [x for x in (og_image(page_html), ld_image(page_html)) if x]


def overview_pages(url: str) -> list[str]:
    """Version 20: the product page that goes with a specification page (OPPO and Xiaomi put their product picture there).
    '.../reno14/specs/' -> '.../reno14/'; vivo '.../products/param/x300' -> '.../products/x300'."""
    plain = ARCHIVE.sub(r"\2", url)
    out = []
    m = re.match(r"^(https://[^?#]+?)/(?:specs?|tech-?specs?|techspec|param)/?(?:[?#].*)?$", plain)
    if m:
        out.append(m.group(1) + "/")
    m = re.match(r"^(https://www\.(?:vivo|iqoo)\.com/[a-z]{2}/products)/param/([a-z0-9-]+)", plain)
    if m:
        out.append(f"{m.group(1)}/{m.group(2)}")
    return [u for u in out if u.rstrip("/") != plain.rstrip("/")]


def model_matches(dev_id: str, src: str) -> bool:
    """Makers file product pictures by model ("product-series/honor-x7e-plus-5g/..."). When the picture sits in such a
    folder, the model's number must be in it too, so a page that shares another model's picture is not used."""
    folder = re.search(r"product-(?:series|list)/(?:[^/]+/)*?([a-z0-9-]*\d[a-z0-9-]*)/", src, re.I)
    if not folder:
        return True
    numbered = [t for t in dev_id.split("-")[1:] if re.search(r"\d", t) and t not in ("5g", "4g")]
    return not numbered or any(t in folder.group(1).lower() for t in numbered)


# Version 20: makers whose pages declare marketing photos (people, animals, banners) rather than the product. Checked on a
# contact sheet of every picture found: all twelve from realme were lifestyle shots or banners. Their devices keep the
# outline drawing until a picture is added by hand.
NO_AUTO_PICTURE = re.compile(r"(^|\.)realme\.(com|net)$|^news\.samsung\.com$", re.I)   # newsroom: key visuals, not product shots


def pick_picture(page: str, text: str, dev_id: str, rejected: list[str], today: str) -> dict | None:
    """The first picture the page declares that passes every rule: maker's own image server, not a logo or banner,
    filed under this model when filed by model, not rejected by a person, and it loads as an image."""
    m = ARCHIVE.match(page)
    live_page = m.group(2) if m else page
    if NO_AUTO_PICTURE.search(urllib.parse.urlsplit(live_page).netloc):
        return None
    for src in page_pictures(text):
        src = urllib.parse.urljoin(live_page, src).split("#")[0]
        if src.startswith("//"):
            src = "https:" + src
        if m and not src.startswith("https://web.archive.org/"):
            src = f"https://web.archive.org/web/{m.group(1)}im_/{src}"
        if not src.startswith("https://") or not official(src) or NOT_PRODUCT.search(src.rsplit("/", 1)[-1] + src):
            continue
        if src in rejected or not model_matches(dev_id, src) or not loads_as_image(src):
            continue
        maker = next((v for k, v in CREDIT.items() if re.search(rf"(^|\.){k}\.(com|gg|tech)", urllib.parse.urlsplit(live_page).netloc)), "Manufacturer")
        return {"kind": "official", "src": src, "page": page, "credit": maker, "checked": today, "auto": True}
    return None


def candidate_pages(dev: dict) -> list[str]:
    prov = dev.get("provenance") or {}
    urls = [prov.get("default", {}).get("url")] + [p.get("url") for p in (prov.get("fields") or {}).values()]
    out = []
    for u in urls:
        if not u or u in out:
            continue
        plain = ARCHIVE.sub(r"\2", u)
        if MAKER_PAGE.match(plain):
            out.append(u)
    # Version 20: then the product page that goes with each specification page
    for u in list(out):
        for extra in overview_pages(u):
            if extra not in out and MAKER_PAGE.match(extra):
                out.append(extra)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-age-hours", type=float, default=0)
    ap.add_argument("--limit", type=int, default=400, help="most devices to look up in one run")
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    previous = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    if args.max_age_hours and previous.get("searchedAt"):
        age = (now - dt.datetime.fromisoformat(previous["searchedAt"])).total_seconds() / 3600
        if age < args.max_age_hours:
            print(f"[images] last search {age:.0f} h ago; skipping")
            return
    found = dict(previous.get("found") or {})
    rejected = (json.loads(REJECTS.read_text(encoding="utf-8")).get("rejected") or {}) if REJECTS.exists() else {}
    for dev_id, srcs in rejected.items():
        if dev_id in found and found[dev_id].get("src") in srcs:
            found.pop(dev_id)
    tried = 0
    for dev in all_devices():
        if (dev.get("image") or {}).get("src"):
            found.pop(dev["id"], None)  # a hand-picked picture now exists
            continue
        if dev["id"] in found and loads_as_image(found[dev["id"]]["src"]):
            continue
        if tried >= args.limit:
            break
        for page in candidate_pages(dev):
            tried += 1
            m = ARCHIVE.match(page)
            live_page = m.group(2) if m else page
            fetch_url = page if m else live_page
            if not m and not allowed(live_page):
                continue
            text = fetch(fetch_url)
            picture = pick_picture(page, text or "", dev["id"], rejected.get(dev["id"], []), now.date().isoformat())
            if not picture:
                continue
            found[dev["id"]] = picture
            print(f"[images] {dev['id']}: {picture['src'][:100]}")
            break
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"searchedAt": now.isoformat(timespec="seconds"), "found": found}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[images] {len(found)} pictures found automatically ({tried} pages read)")


if __name__ == "__main__":
    main()
