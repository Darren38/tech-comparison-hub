"""Version 41: monthly check of every device's Malaysian status (owner, 14 Nov 2026: "yes, add it next time", after
several phones moved from "coming soon" to "on sale" in one week).

Lists the devices whose Malaysian status may be out of date, each with the Malaysian headlines about it since it was last
checked, so a person can read them and update the record. It changes nothing.

  - marked "not launched in Malaysia" or "no Malaysian price found"
  - still "announced" or "pre-order" more than 14 days after the announcement
Only devices announced in the last 12 months are listed (older ones rarely change). A device with Malaysian news since
its last check is listed first.

    python tools/build.py                     (first, so generated/ is current)
    python tools/my_status_check.py           uses live/archive.json; --archive FILE for a fresher copy
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from latest_flagships_check import MY_SOURCES  # noqa: E402  (the same Malaysian publications)

MY_TITLE = re.compile(r"(?i)malaysia|大马|马来西亚|\bRM\s?\d")
NOT_MY = re.compile(r"(?i)\bchina\b|中国|~\s?RM")  # a China launch with a converted ringgit price is not Malaysian news


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument("--archive", default=str(ROOT / "live" / "archive.json"))
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    today = dt.date.today()
    devices = {}
    for f in (ROOT / "data" / "devices").glob("*/*.json"):
        d = json.loads(f.read_text(encoding="utf-8"))
        devices[d["id"]] = d
    try:
        items = json.loads(Path(args.archive).read_text(encoding="utf-8")).get("items", [])
    except (OSError, ValueError):
        items = []
    since_year = (today - dt.timedelta(days=365)).isoformat()
    rows = []
    for d in devices.values():
        announced = str(d.get("announced") or "")
        if announced < since_year:
            continue
        my = (d.get("availability") or {}).get("MY") or {}
        has_my_price = any(p.get("region") == "MY" for p in d.get("prices") or [])
        reasons = []
        if my.get("status") in ("not-launched", "price-not-found") and not has_my_price:
            reasons.append("not in Malaysia yet" if my["status"] == "not-launched" else "no Malaysian price")
        if d.get("status") in ("announced", "pre-order") and announced and (today - dt.date.fromisoformat(announced[:10])).days > 14:
            reasons.append(f"still {d['status']}")
        if not reasons:
            continue
        checked = str(my.get("checked") or announced)
        news = sorted((i for i in items if d["id"] in (i.get("devices") or []) and i.get("source") in MY_SOURCES
                       and (i.get("published") or "")[:10] >= checked[:10]
                       and MY_TITLE.search(i.get("title") or "") and not NOT_MY.search(i.get("title") or "")),
                      key=lambda i: i.get("published") or "", reverse=True)
        rows.append((bool(news), d, reasons, checked, news))
    rows.sort(key=lambda r: (not r[0], r[1].get("announced") or ""), reverse=False)
    with_news = sum(1 for r in rows if r[0])
    print(f"{len(rows)} device(s) to check, {with_news} with Malaysian news since their last check\n")
    for has_news, d, reasons, checked, news in rows:
        print(f"{'!' if has_news else ' '} {d['name']:34} {', '.join(reasons):34} last checked {checked[:10]}")
        for i in news[:3]:
            print(f"      {(i.get('published') or '')[:10]} {i.get('source')}: {(i.get('title') or '')[:95]}")
            print(f"      {i.get('url')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
