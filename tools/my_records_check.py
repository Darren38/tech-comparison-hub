"""Version 42: weekly check that a record with a Malaysian price describes the Malaysian model (owner, 22 Nov 2026, after
the Xiaomi 18 Pro and 18 Pro Max showed Malaysian prices beside the Chinese batteries and "not yet sold in Malaysia").

Lists, for a person to check on the maker's Malaysian page or a Malaysian launch report (it changes nothing):
  - china-specs: launched at a Chinese price in the last 12 months, has a Malaysian price, and its battery capacity isn't
                 cited as checked for Malaysia (a field note on specs.battery.capacity_mah that names Malaysia)
  - old-text:    a summary or highlight still says the device isn't in Malaysia, or is only coming or on pre-order, while
                 the record has a Malaysian price (or is released)
  - typed-tests: a summary says there are no independent tests. It goes out of date when a result is collected, and the
                 page's own tag says it automatically
  - text-number: a summary or highlight gives a phone's or tablet's battery capacity that differs from the recorded one

    python tools/my_records_check.py          --root FOLDER to check another copy
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOT_HERE = re.compile(r"(?i)\bnot (?:yet )?(?:sold |launched |available |on sale )?in Malaysia|\bnot (?:yet )?announced for Malaysia"
                      r"|\bno Malaysian (?:launch|price)|\bexpects? (?:it|the series) here|\bcoming to Malaysia"
                      r"|\bprice not announced")
OVER = re.compile(r"(?i)\bpre-orders? until|\bpriced at (?:the )?launch|\breservations? open|\blaunching in Malaysia")
MAH = re.compile(r"(\d{1,2},?\d{3})\s*mAh")


def problems(d: dict, year_ago: str) -> list[tuple[str, str]]:
    out = []
    prices = d.get("prices") or []
    my = any(p.get("region") == "MY" for p in prices)
    texts = [d.get("summary") or "", *(d.get("highlights") or [])]
    battery = (d.get("specs") or {}).get("battery") or {}
    mah = battery.get("capacity_mah")
    for text in texts:
        if "no independent tests yet" in text.lower():
            out.append(("typed-tests", "says there are no independent tests; leave that to the page's own tag"))
        hit = (NOT_HERE.search(text) if my else None) or (OVER.search(text) if d.get("status") == "released" else None)
        if hit:
            out.append(("old-text", f'says "{hit.group(0)}"'))
        if mah and d.get("category") in ("smartphone", "tablet"):
            known = {mah, battery.get("rated_mah")} | {int(n.replace(",", "")) for n in MAH.findall(str(battery.get("variants") or ""))}
            for n in MAH.findall(text):
                if int(n.replace(",", "")) not in known:
                    out.append(("text-number", f"text says {n} mAh, the record {mah:,} mAh"))
    if my and mah and str(d.get("announced") or "") >= year_ago and any(p.get("region") == "CN" for p in prices):
        field = ((d.get("provenance") or {}).get("fields") or {}).get("specs.battery.capacity_mah") or {}
        if "malaysia" not in str(field.get("note") or "").lower():
            out.append(("china-specs", f"{mah:,} mAh is not cited as checked for Malaysia; compare battery, charging, weight, water rating and memory"))
    return list(dict.fromkeys(out))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument("--root", default=str(ROOT))
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    year_ago = (dt.date.today() - dt.timedelta(days=365)).isoformat()
    count = devices = 0
    for f in sorted((Path(args.root) / "data" / "devices").glob("*/*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        found = problems(d, year_ago)
        devices += bool(found)
        for kind, what in found:
            count += 1
            print(f"[{kind}] {d['id']}: {what}")
    print(f"\n{count} thing(s) to check on {devices} device(s)" if count else "\nEvery Malaysian record looks consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
