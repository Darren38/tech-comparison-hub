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
NOT_PRODUCT = re.compile(r"(?<![a-z])(logo|favicon|icon|share-?default|home-share\w*|placeholder|sprite)(?![a-z])", re.I)
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0; +https://darren38.github.io/tech-comparison-hub/)"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import OFFICIAL_IMAGE_HOSTS, OFFICIAL_IMAGE_PREFIXES  # noqa: E402  (same allow-list as the validator)

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


def fetch(url: str, limit: int = 600_000) -> str | None:
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


def model_matches(dev_id: str, src: str) -> bool:
    """Makers file product pictures by model ("product-series/honor-x7e-plus-5g/..."). When the picture sits in such a
    folder, the model's number must be in it too, so a page that shares another model's picture is not used."""
    folder = re.search(r"product-(?:series|list)/(?:[^/]+/)*?([a-z0-9-]*\d[a-z0-9-]*)/", src, re.I)
    if not folder:
        return True
    numbered = [t for t in dev_id.split("-")[1:] if re.search(r"\d", t) and t not in ("5g", "4g")]
    return not numbered or any(t in folder.group(1).lower() for t in numbered)


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
    for path in sorted((ROOT / "data" / "devices").glob("*/*.json")):
        dev = json.loads(path.read_text(encoding="utf-8"))
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
            time.sleep(1.5)  # be gentle: one request at a time
            src = og_image(text or "")
            if not src:
                continue
            src = urllib.parse.urljoin(live_page, src).split("#")[0]
            if src.startswith("//"):
                src = "https:" + src
            if m and not src.startswith("https://web.archive.org/"):
                src = f"https://web.archive.org/web/{m.group(1)}im_/{src}"
            if not src.startswith("https://") or not official(src) or NOT_PRODUCT.search(src.rsplit("/", 1)[-1] + src):
                continue
            if src in rejected.get(dev["id"], []) or not model_matches(dev["id"], src) or not loads_as_image(src):
                continue
            maker = next((v for k, v in CREDIT.items() if re.search(rf"(^|\.){k}\.(com|gg|tech)", urllib.parse.urlsplit(ARCHIVE.sub(r'\2', page)).netloc)), "Manufacturer")
            found[dev["id"]] = {"kind": "official", "src": src, "page": page, "credit": maker, "checked": now.date().isoformat(), "auto": True}
            print(f"[images] {dev['id']}: {src[:100]}")
            break
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"searchedAt": now.isoformat(timespec="seconds"), "found": found}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[images] {len(found)} pictures found automatically ({tried} pages read)")


if __name__ == "__main__":
    main()
