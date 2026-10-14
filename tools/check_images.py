"""Check every device picture still loads (Version 16), once a day.

    python tools/check_images.py                     check now, write live/auto/images.json
    python tools/check_images.py --max-age-hours 20  do nothing if the saved check is newer than that

A picture that no longer loads (a maker moved it, a file was deleted) is listed; the build then shows the device's
outline drawing instead of a broken image until the picture is fixed in data/. Nothing in data/ is changed.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from devices_all import all_devices, auto_chipsets  # noqa: E402  (Version 20: devices added automatically count too)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "live" / "auto" / "images.json"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0)"  # Version 25: no author name or address in requests (user)


BUSY = {429, 502, 503, 504}  # Version 28: "too many requests" / server busy is not a broken picture


def check(url: str) -> str | None:
    """None when the picture loads (or the server is only busy); otherwise a short reason. Only the first bytes are read."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Range": "bytes=0-2047", "Accept": "image/*"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                kind = r.headers.get("Content-Type", "")
                head = r.read(2048)
                if not kind.startswith("image/") and not head[:4] in (b"\x89PNG", b"RIFF", b"GIF8") and not head[:2] == b"\xff\xd8":
                    return f"not an image ({kind or 'no type'})"
                return None
        except urllib.error.HTTPError as e:
            if e.code not in BUSY:
                return f"HTTP {e.code}"
            if attempt == 2:
                # Version 28: on 14 Oct Wikimedia answered 429 for 9 pictures and the site hid them for a day.
                # A busy server says nothing about the picture, so it stays.
                print(f"[images] {url} still busy (HTTP {e.code}); kept.")
                return None
            try:
                wait = int(e.headers.get("Retry-After") or 0)
            except ValueError:
                wait = 0
            time.sleep(min(max(wait, 5 * (attempt + 1)), 30))
        except Exception as e:  # timeouts, DNS, TLS
            if attempt == 2:
                return type(e).__name__
            time.sleep(3)
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-age-hours", type=float, default=0)
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    if args.max_age_hours and OUT.exists():
        try:
            last = dt.datetime.fromisoformat(json.loads(OUT.read_text(encoding="utf-8"))["checkedAt"])
            if now - last < dt.timedelta(hours=args.max_age_hours):
                print(f"[images] Checked {last:%Y-%m-%d %H:%M} UTC; nothing to do.")
                return 0
        except (ValueError, KeyError):
            pass
    targets = {}
    for dev in all_devices():
        src = (dev.get("image") or {}).get("src")
        if src:
            targets[dev["id"]] = src
    broken = {}
    # Version 28: Wikimedia limits how fast one visitor may ask, so its pictures are checked one at a time
    commons = {d: u for d, u in targets.items() if "wikimedia.org" in u}
    others = {d: u for d, u in targets.items() if d not in commons}
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(check, url): dev_id for dev_id, url in others.items()}
        for fut in cf.as_completed(futures):
            reason = fut.result()
            if reason:
                broken[futures[fut]] = reason
    for dev_id, url in commons.items():
        reason = check(url)
        if reason:
            broken[dev_id] = reason
        time.sleep(0.5)
    # a network outage on the checking machine would mark everything broken: then keep the previous check
    if targets and len(broken) > len(targets) * 0.5:
        print(f"[images] {len(broken)} of {len(targets)} failed; looks like a connection problem, keeping the previous check.")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"checkedAt": now.isoformat(timespec="seconds"), "checked": len(targets),
                               "broken": dict(sorted(broken.items()))}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[images] {len(targets)} pictures checked, {len(broken)} not loading" + (f": {', '.join(sorted(broken))}" if broken else "."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
