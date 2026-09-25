"""Official software-update and service-programme facts, read from Apple's and Samsung's own pages (Version 18).

    python tools/fetch_official.py                    read now, write live/official.json
    python tools/fetch_official.py --max-age-hours 5  do nothing if the saved copy is newer than that

- Apple security releases (support.apple.com/en-us/100100): every iOS, iPadOS and watchOS release with its date, the
  devices it is for and Apple's own notes page.
- Apple developer releases feed: the newest iOS / iPadOS / watchOS betas and release candidates with build numbers.
- Samsung Mobile Security bulletin: the newest monthly security maintenance release (SMR) and how many Samsung fixes it has.
- Apple service programmes for Malaysia (support.apple.com/en-my/service-programs): current replacement, repair and
  recall programmes, matched to the devices in the hub by name, with any part of Malaysia each programme page names
  (East / West Malaysia or a state).
- Service offers the headline collector found on Samsung's and Apple's own Malaysian pages: the page is read for the
  parts of Malaysia it names, so the site can say where an offer applies.

Only facts are stored (version, date, title, link); no text is copied. Each page is read only where its robots.txt allows
it. A page that can't be read keeps its previously saved part, so one failure never empties the section.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "live" / "official.json"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0; +https://darren38.github.io/tech-comparison-hub/)"
APPLE_SECURITY = "https://support.apple.com/en-us/100100"
APPLE_DEV_FEED = "https://developer.apple.com/news/releases/rss/releases.rss"
SAMSUNG_SECURITY = "https://security.samsungmobile.com/securityUpdate.smsb"
APPLE_PROGRAMS = "https://support.apple.com/en-my/service-programs"
# Parts of Malaysia a programme or offer page may name (the same list as MY_REGIONS in src/ui/newsdesk.js)
MY_REGIONS = [
    ("East Malaysia", r"\beast malaysia\b|malaysia timur|东马"), ("West Malaysia", r"\bwest malaysia\b|peninsular malaysia|semenanjung|西马"),
    ("Sabah", r"\bsabah\b|沙巴"), ("Sarawak", r"\bsarawak\b|砂拉越|砂州"), ("Labuan", r"\blabuan\b|纳闽"), ("Johor", r"\bjohor\b|柔佛"),
    ("Kedah", r"\bkedah\b|吉打"), ("Kelantan", r"\bkelantan\b|吉兰丹"), ("Melaka", r"\bmelaka\b|\bmalacca\b|马六甲"),
    ("Negeri Sembilan", r"\bnegeri sembilan\b|森美兰"), ("Pahang", r"\bpahang\b|彭亨"), ("Penang", r"\bpenang\b|pulau pinang|槟城"),
    ("Perak", r"\bperak\b|霹雳"), ("Perlis", r"\bperlis\b|玻璃市"), ("Selangor", r"\bselangor\b|雪兰莪"), ("Terengganu", r"\bterengganu\b|登嘉楼"),
    ("Kuala Lumpur", r"\bkuala lumpur\b|吉隆坡"), ("Putrajaya", r"\bputrajaya\b|布城"), ("Klang Valley", r"\bklang valley\b|巴生谷"),
]
MY_REGION_RES = [(name, re.compile(pattern, re.I)) for name, pattern in MY_REGIONS]
OFFICIAL_OFFER_SOURCES = {"samsung-newsroom-my", "apple-newsroom", "samsung-newsroom"}


def regions_in(text: str) -> list[str]:
    return [name for name, pattern in MY_REGION_RES if pattern.search(text)]


def main_text(page: str) -> str:
    """The page's own text, without navigation, header and footer (where country and store lists live)."""
    body = re.sub(r"<(script|style|nav|header|footer)\b.*?</\1>", " ", page, flags=re.S | re.I)
    m = re.search(r"<main\b.*?</main>", body, re.S | re.I) or re.search(r"<article\b.*?</article>", body, re.S | re.I)
    return text_of(m.group(0) if m else body)


APPLE_OS = re.compile(r"^(iOS|iPadOS|watchOS)\s+(\d+(?:\.\d+)*)", re.I)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_headlines import load_keys, match_devices, normalize  # noqa: E402  (same device matching as the headlines)

_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def allowed(url: str) -> bool:
    parts = urllib.parse.urlsplit(url)
    key = f"{parts.scheme}://{parts.netloc}"
    if key not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            with urllib.request.urlopen(urllib.request.Request(key + "/robots.txt", headers={"User-Agent": UA}), timeout=20) as r:
                rp.parse(r.read().decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError as e:
            if e.code >= 500:
                rp = None
            else:
                rp.parse([])  # no robots.txt: everything allowed
        except Exception:  # noqa: BLE001
            rp = None
        _robots[key] = rp
    rp = _robots[key]
    return bool(rp and rp.can_fetch(UA, url))


def fetch(url: str) -> str:
    if not allowed(url):
        raise PermissionError("robots.txt does not allow it")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"}), timeout=40) as r:
        return r.read(3_000_000).decode("utf-8", "replace")


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def parse_day(text: str) -> str | None:
    for fmt in ("%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            return dt.datetime.strptime(text.strip(), fmt).date().isoformat()
        except ValueError:
            pass
    return None


def apple_releases() -> list[dict]:
    """iOS, iPadOS and watchOS releases from Apple's security releases table, newest first."""
    page = fetch(APPLE_SECURITY)
    out = []
    for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
        if len(cells) < 3:
            continue
        name = text_of(cells[0])
        m = APPLE_OS.match(name)
        date = parse_day(text_of(cells[2]))
        if not m or not date:
            continue
        link = re.search(r'href="(https://support\.apple\.com/[^"]+)"', cells[0])
        out.append({"os": m.group(1).replace("ios", "iOS"), "version": m.group(2), "name": re.sub(r"\s*This update has no published CVE entries\.?", "", name),
                     "date": date, "for": text_of(cells[1])[:300], "url": link.group(1) if link else APPLE_SECURITY,
                     "noCves": "no published CVE entries" in name})
        if len(out) >= 40:
            break
    return out


def apple_betas() -> list[dict]:
    """Newest iOS / iPadOS / watchOS betas and release candidates from Apple's developer releases feed."""
    feed = fetch(APPLE_DEV_FEED)
    out = []
    for item in re.findall(r"<item>(.*?)</item>", feed, re.S):
        title = text_of((re.search(r"<title>(.*?)</title>", item, re.S) or [None, ""])[1])
        m = re.match(r"^(iOS|iPadOS|watchOS)\s+(\d+(?:\.\d+)*)\s*(beta\s*\d*|RC\s*\d*)?\s*\(([^)]+)\)", title, re.I)
        if not m:
            continue
        when = re.search(r"<pubDate>(.*?)</pubDate>", item, re.S)
        date = None
        if when:
            try:
                date = dt.datetime.strptime(when.group(1).strip()[:25], "%a, %d %b %Y %H:%M:%S").date().isoformat()
            except ValueError:
                pass
        link = re.search(r"<link>(.*?)</link>", item, re.S)
        out.append({"os": m.group(1), "version": m.group(2), "stage": (m.group(3) or "release").strip(), "build": m.group(4),
                    "title": title, "date": date, "url": (link.group(1).strip() if link else APPLE_DEV_FEED)})
    return out[:12]


def samsung_security() -> dict | None:
    page = text_of(fetch(SAMSUNG_SECURITY))
    month = re.search(r"SMR ([A-Z][a-z]{2}-20\d\d)", page)
    if not month:
        return None
    fixes = re.search(r"Samsung Mobile provides (\d+) Samsung Vulnerabilities", page)
    critical = len(re.findall(r"\bCritical SVE-", page))
    return {"release": f"SMR {month.group(1)}", "month": month.group(1), "samsungFixes": int(fixes.group(1)) if fixes else None,
            "url": SAMSUNG_SECURITY, **({"criticalFirst": True} if critical else {})}


def apple_programs(keys) -> list[dict]:
    page = fetch(APPLE_PROGRAMS)
    out = []
    for href, label in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', page, re.S):
        title = text_of(label)
        if not re.search(r"programme|program|recall", title, re.I) or len(title) > 160:
            continue
        url = urllib.parse.urljoin(APPLE_PROGRAMS, href)
        if not url.startswith("https://support.apple.com/") or any(p["url"] == url for p in out):
            continue
        entry = {"title": title, "url": url, "devices": match_devices(normalize(title), keys),
                 "kind": "recall" if re.search(r"recall", title, re.I) else "programme"}
        try:
            entry["regions"] = regions_in(main_text(fetch(url)))  # East / West Malaysia or states the page names
        except Exception:  # noqa: BLE001 - the title and link are still useful
            pass
        out.append(entry)
    return out


def offer_page_regions(saved: dict) -> dict:
    """Parts of Malaysia named on the official pages behind collected service-offer headlines."""
    known = dict(saved.get("offerPageRegions") or {})
    items = []
    for name in ("headlines.json", "archive.json"):
        path = ROOT / "live" / name
        if path.exists():
            try:
                items += json.loads(path.read_text(encoding="utf-8")).get("items", [])
            except ValueError:
                pass
    for item in items:
        url = item.get("url") or ""
        if "offer" not in (item.get("flags") or []) or item.get("source") not in OFFICIAL_OFFER_SOURCES or url in known:
            continue
        try:
            known[url] = regions_in(main_text(fetch(url)))
        except Exception:  # noqa: BLE001
            continue
    return known


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-age-hours", type=float, default=0)
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    saved = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    if args.max_age_hours and saved.get("updatedAt"):
        age = (now - dt.datetime.fromisoformat(saved["updatedAt"])).total_seconds() / 3600
        if age < args.max_age_hours:
            print(f"[official] read {age:.1f} h ago; skipping")
            return
    keys = load_keys()
    data = dict(saved)
    status = {}
    for name, job in (("appleReleases", apple_releases), ("appleBetas", apple_betas), ("samsungSecurity", samsung_security),
                      ("appleServicePrograms", lambda: apple_programs(keys)), ("offerPageRegions", lambda: offer_page_regions(saved))):
        try:
            value = job()
            if value or name == "offerPageRegions":
                data[name] = value
                status[name] = {"ok": True, "at": now.isoformat(timespec="seconds")}
            else:
                status[name] = {"ok": False, "error": "nothing found on the page", "kept": name in saved}
        except Exception as exc:  # noqa: BLE001 - keep the saved part
            status[name] = {"ok": False, "error": f"{exc.__class__.__name__}: {str(exc)[:100]}", "kept": name in saved}
    data["updatedAt"] = now.isoformat(timespec="seconds")
    data["status"] = status
    data["note"] = "Facts read automatically from Apple's and Samsung's own pages; titles, versions, dates and links only."
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("[official] " + ", ".join(f"{k}: {'ok' if v['ok'] else 'failed (' + v['error'] + ')'}" for k, v in status.items()))


if __name__ == "__main__":
    main()
