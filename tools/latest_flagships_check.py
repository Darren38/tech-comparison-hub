"""Version 36: weekly check of the home page's "Latest flagships" cards (owner, 1 Nov 2026: "make sure this section is
updated during the weekly maintenance").

Lists the phones the home page shows there (the same rule as src/pages/home.js: flagships, newest announcement first) plus
the next few, and flags what may be out of date. It changes nothing: each flag is checked against a source by a person,
who then updates the record by hand.

  - "pre-order" for more than 14 days after the announcement (it has probably gone on sale)
  - "announced" with a collected headline saying it launches, goes on sale or is available
  - no Malaysian price while a Malaysian source has written about the phone since it was announced
  - no collected headline about it for 30 days (worth a look for news that wasn't matched)

    python tools/build.py                       (first, so generated/ is current)
    python tools/latest_flagships_check.py      uses live/archive.json; --archive FILE for a fresher copy
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOWN = 6     # cards on the home page (src/pages/home.js, latest())
EXTRA = 4     # the next ones, which move up as soon as a newer flagship is added
MY_SOURCES = {"soyacincau", "technave", "technave-zh", "zinggadget", "malaymail", "samsung-newsroom-my", "lowyat"}
LAUNCH_WORDS = re.compile(r"(?i)on sale|goes on sale|now available|available now|launch(?:es|ed)? in|officially launch|开售|首销|上市|发售|正式发布")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument("--archive", default=str(ROOT / "live" / "archive.json"))
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    today = dt.date.today()
    devices = json.loads((ROOT / "generated" / "index" / "devices.json").read_text(encoding="utf-8"))
    try:
        items = json.loads(Path(args.archive).read_text(encoding="utf-8")).get("items", [])
    except (OSError, ValueError):
        items = []
    rows = sorted((d for d in devices if d.get("flagship")), key=lambda d: d.get("announced") or "", reverse=True)[: SHOWN + EXTRA]
    flags_total = 0
    for n, d in enumerate(rows):
        heads = sorted((i for i in items if d["id"] in (i.get("devices") or [])), key=lambda i: i.get("published") or "", reverse=True)
        my_price = [p for p in d.get("prices") or [] if p.get("region") == "MY"]
        announced = d.get("announced") or ""
        flags = []
        if d.get("status") == "pre-order" and announced and (today - dt.date.fromisoformat(announced[:10])).days > 14:
            flags.append(f"pre-order for {(today - dt.date.fromisoformat(announced[:10])).days} days - has it gone on sale?")
        if d.get("status") == "announced":
            sale = [i for i in heads if LAUNCH_WORDS.search(i.get("title") or "")]
            if sale:
                flags.append(f"announced, but a headline says: {sale[0]['title'][:90]} ({(sale[0].get('published') or '')[:10]})")
        if not my_price:
            # a Malaysian site's report of a China launch is not a Malaysian launch: only headlines naming Malaysia or ringgit
            my_news = [i for i in heads if i.get("source") in MY_SOURCES and (i.get("published") or "") >= announced
                       and re.search(r"(?i)malaysia|大马|马来西亚|\bRM\s?\d", i.get("title") or "")]
            if my_news:
                flags.append(f"no Malaysian price, but {my_news[0]['source']} wrote: {my_news[0]['title'][:80]} ({(my_news[0].get('published') or '')[:10]})")
        if not heads or (heads[0].get("published") or "")[:10] < (today - dt.timedelta(days=30)).isoformat():
            flags.append("no collected headline for 30 days")
        flags_total += len(flags)
        where = "card" if n < SHOWN else "next"
        avail = (d.get("availability") or {}).get("MY")
        avail = avail.get("status") if isinstance(avail, dict) else avail  # the generated index keeps just the status word
        price = f"RM{min(p['amount'] for p in my_price):,}" if my_price else (avail or "no MY price")
        print(f"[{where}] {d['name']:28} {d.get('status', ''):10} announced {announced[:10]:10} released {str(d.get('released') or '-')[:10]:10} MY: {price}")
        for f in flags:
            print(f"        ! {f}")
    print(f"\n{flags_total} thing(s) to check by hand" if flags_total else "\nNothing looks out of date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
