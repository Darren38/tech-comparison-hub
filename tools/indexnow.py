"""Tell search engines which pages changed, through IndexNow (Version 32).

    python tools/indexnow.py prepare --site _site   during the build: compare every search-engine page with the
                                                    previous run, write the key file and the list of changed pages
    python tools/indexnow.py submit                 after deployment: send that list to IndexNow

IndexNow (https://www.indexnow.org) is a free, open protocol used by Bing, Yandex, Seznam, Naver and others: a site
lists the addresses that changed and the search engines fetch those pages soon after. Google does not take part.

Only real changes are sent. The device, chip and index pages hold the site's data (specifications, Malaysian prices,
sources) and no build date, so a page's fingerprint changes only when its content does. The fingerprints of the last
run are read back from the live site (live/auto/indexnow.json), like the other automatic state. The first run sends
every page once.

The key (data/meta/indexnow.json) is public by design: it is served at <site>/indexnow.txt so the search engines can
check that a submission for this site comes from its owner. It grants no access to anything.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://darren38.github.io/tech-comparison-hub/"
STATE = "live/auto/indexnow.json"
KEY_FILE = "indexnow.txt"
ENDPOINT = "https://api.indexnow.org/indexnow"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0)"  # no author name or address in requests (user rule)
MAX_URLS = 10000  # IndexNow's limit per request


def key() -> str:
    return json.loads((ROOT / "data" / "meta" / "indexnow.json").read_text(encoding="utf-8"))["key"]


def get(url: str, timeout: int = 30) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def pages(site: Path) -> dict[str, str]:
    """Address -> fingerprint of every page the sitemap lists (the home page is the app itself and rarely changes)."""
    out = {}
    for path in [site / "d" / "index.html", *sorted((site / "d").glob("*/index.html")), *sorted((site / "c").glob("*/index.html"))]:
        if path.is_file():
            rel = path.parent.relative_to(site).as_posix() + "/"
            out[BASE + rel] = hashlib.sha256(path.read_bytes()).hexdigest()[:20]
    return out


def prepare(site: Path) -> int:
    k = key()
    (site / KEY_FILE).write_text(k, encoding="utf-8")
    now = pages(site)
    previous, first = None, False
    try:
        req = urllib.request.Request(BASE + STATE, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=30) as r:
            previous = json.loads(r.read()).get("hashes")
    except urllib.error.HTTPError as e:
        first = e.code == 404  # never sent before
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        pass
    if previous is None and not first:
        # the live site could not be read: keep quiet this run rather than send every page again
        changed, reason = [], "previous list unreadable; nothing to send this run"
    elif previous is None:
        changed = [BASE] + sorted(now)  # first run: every page once
        reason = "first run: every page"
    else:
        changed = sorted(u for u, h in now.items() if previous.get(u) != h)
        reason = f"{len(changed)} changed of {len(now)}"
    state = {"updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "pages": len(now),
             "pending": changed[:MAX_URLS], "hashes": now}
    target = site / STATE
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(state, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[indexnow] {reason}; {len(state['pending'])} address(es) to send after deployment")
    return 0


def submit() -> int:
    raw = get(BASE + STATE)
    if not raw:
        print("::warning::IndexNow: the list of changed pages could not be read from the live site; nothing sent.")
        return 0
    state = json.loads(raw)
    urls = [u for u in state.get("pending", []) if u.startswith(BASE)]
    if not urls:
        print("[indexnow] no page changed in this run; nothing to send.")
        return 0
    k = key()
    served = (get(BASE + KEY_FILE) or b"").decode("utf-8", "replace").strip()
    if served != k:
        print("::warning::IndexNow: the key file on the live site does not match the key; nothing sent.")
        return 0
    body = json.dumps({"host": "darren38.github.io", "key": k, "keyLocation": BASE + KEY_FILE, "urlList": urls}).encode("utf-8")
    meaning = {400: "bad request", 403: "key not accepted", 422: "addresses do not belong to the key's location",
               429: "too many requests"}
    # Version 33: a passing refusal is tried again. IndexNow can answer 403 while it is still checking a key it has not
    # seen before, and 429 or a server error clears by itself; 400 and 422 would not change, so they are not repeated.
    waits = [120, 300]
    for attempt in range(len(waits) + 1):
        req = urllib.request.Request(ENDPOINT, data=body, method="POST",
                                     headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print(f"[indexnow] sent {len(urls)} address(es): HTTP {r.status}" + (f" (attempt {attempt + 1})" if attempt else ""))
            return 0
        except urllib.error.HTTPError as e:
            problem, again = f"HTTP {e.code} {meaning.get(e.code, '')}".strip(), e.code in (403, 429) or e.code >= 500
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            problem, again = f"could not be reached ({type(e).__name__})", True
        if not again or attempt == len(waits):
            break
        print(f"[indexnow] {problem}; trying again in {waits[attempt] // 60} minutes")
        time.sleep(waits[attempt])
    print(f"::warning::IndexNow: {problem} after {attempt + 1} attempt(s) ({len(urls)} address(es)); "
          "the search engines still find these pages through the sitemap.")
    return 0  # telling search engines is a courtesy: it never fails the site's check-up


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["prepare", "submit"])
    ap.add_argument("--site", default="_site", help="the assembled site folder (prepare)")
    args = ap.parse_args()
    return prepare(Path(args.site)) if args.action == "prepare" else submit()


if __name__ == "__main__":
    sys.exit(main())
