"""Version 36: weekly check of the home page's "Latest flagships" cards (owner, 1 Nov 2026: "make sure this section is
updated during the weekly maintenance").

Lists the phones the home page shows there (the same rule as src/pages/home.js: flagships, newest announcement first) plus
the next few, and flags what may be out of date. It changes nothing: each flag is checked against a source by a person,
who then updates the record by hand.

  - "pre-order" for more than 14 days after the announcement (it has probably gone on sale)
  - "announced" with a collected headline saying it launches, goes on sale or is available
  - no Malaysian price while a Malaysian source has written about the phone since it was announced
  - no collected headline about it for 30 days (worth a look for news that wasn't matched)

Version 39 (owner, 3 Nov 2026, after the OnePlus 16, Mate 90 and Magic9 phones were found missing from the cards): it
also lists flagships that may be missing from the hub altogether - model names spotted in the news (live/spotted.json
and the AI's list in live/auto/news_ai.json) that the hub doesn't have, look like a flagship, and have a headline in the
last 45 days saying they launched, went on sale or were announced. The AI's own launched/rumoured word is not trusted
here (it called the OnePlus 16 "rumoured" after its launch); the headlines decide.

    python tools/build.py                       (first, so generated/ is current)
    python tools/latest_flagships_check.py      uses live/archive.json; --archive FILE for a fresher copy
                                                (--spotted / --news-ai FILE for fresher copies of those lists)
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
# a headline saying a model now exists (for the missing-flagship list)
NEW_WORDS = re.compile(r"(?i)\blaunch(?:es|ed)?\b|\bofficial(?:ly)?\b|\bdebuts?\b|\bunveil(?:s|ed)?\b|\bannounced\b|\bgoes? on sale\b|\bon sale\b|发布|开售|首销|上市|发售")
# ...but not one that only expects it ("Mate X8 tipped to launch next month")
RUMOUR_WORDS = re.compile(r"(?i)\b(tipped|rumou?r\w*|leak\w*|expected|could|may|will|set to|to launch|launch date|teas\w*|coming|upcoming|ahead of|reportedly)\b|曝光|爆料|预计|将于|即将|官宣")
LOOKS_FLAGSHIP = re.compile(r"(?i)\b(pro max|pro\+|pro plus|ultra)\b")
MISSING_DAYS = 45

sys.path.insert(0, str(ROOT / "tools"))
from build import FLAGSHIP_NAMES  # noqa: E402  (the site's own flagship rule)


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9+]", "", name.lower().replace("+", "plus"))


def looks_flagship(name: str) -> bool:
    variants = {name, re.sub(r"(?<=[A-Za-z]) (?=\d)", "", name)}  # "Magic 9 Pro" and "Magic9 Pro"
    return bool(LOOKS_FLAGSHIP.search(name)) or any(re.compile(p.pattern, re.I).match(v) for p in FLAGSHIP_NAMES for v in variants)


def name_in_title(name: str):
    """The model name as words, spaces optional ("Magic 9" = "Magic9"), not followed by another model word, so
    "Xiaomi 18" doesn't match a "Xiaomi 18 Pro" headline."""
    tokens = re.findall(r"[A-Za-z]+|\d+|\+", name)
    body = r"\s*".join(re.escape(t) for t in tokens)
    return re.compile(r"(?i)(?<![A-Za-z0-9])" + body + r"(?![A-Za-z0-9])(?!\s*\+)(?!\s*(?:pro|max|ultra|plus|mini|lite|fold|flip|super|se|s|e|r)\b)")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def missing_flagships(devices: list, items: list, spotted: dict, news_ai: dict, today: dt.date) -> list[tuple[str, list]]:
    """Flagship-looking names in the news that the hub doesn't have, with the headlines saying they exist."""
    have = set()
    for d in devices:
        brand = norm(d.get("brand") or "")
        for n in [d.get("name") or ""] + list(d.get("aliases") or []):
            have.add(norm(n))
            if brand and norm(n).startswith(brand):
                have.add(norm(n)[len(brand):])
    names = {m.get("name") for m in spotted.get("models") or []} | {v.get("name") for v in (news_ai.get("spotted") or {}).values()}
    since = (today - dt.timedelta(days=MISSING_DAYS)).isoformat()
    recent = [i for i in items if (i.get("published") or "")[:10] >= since]
    out = []
    for name in sorted(n for n in names if n):
        key = norm(name)
        if not key or key in have or not looks_flagship(name):
            continue
        pattern = name_in_title(name)
        heads = [i for i in recent if pattern.search(i.get("title") or "") and NEW_WORDS.search(i.get("title") or "")
                 and not RUMOUR_WORDS.search(i.get("title") or "")]
        if heads:
            out.append((name, sorted(heads, key=lambda i: i.get("published") or "")))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument("--archive", default=str(ROOT / "live" / "archive.json"))
    ap.add_argument("--spotted", default=str(ROOT / "live" / "spotted.json"))
    ap.add_argument("--news-ai", default=str(ROOT / "live" / "auto" / "news_ai.json"))
    ap.add_argument("--index", default=str(ROOT / "generated" / "index" / "devices.json"), help=argparse.SUPPRESS)  # for testing
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    today = dt.date.today()
    devices = json.loads(Path(args.index).read_text(encoding="utf-8"))
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
    missing = missing_flagships(devices, items, read_json(Path(args.spotted), {}), read_json(Path(args.news_ai), {}), today)
    print(f"\nPossibly missing flagships (named in the news, not in the hub; last {MISSING_DAYS} days):")
    for name, heads in missing:
        first, last = heads[0], heads[-1]
        print(f"[missing] {name}  ({len(heads)} headline(s), {(first.get('published') or '')[:10]} to {(last.get('published') or '')[:10]})")
        print(f"        ! {first.get('source')}: {(first.get('title') or '')[:100]}")
    if not missing:
        print("  none")
    flags_total += len(missing)
    print(f"\n{flags_total} thing(s) to check by hand" if flags_total else "\nNothing looks out of date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
