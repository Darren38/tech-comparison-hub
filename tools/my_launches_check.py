"""Version 37: weekly check for devices launched in Malaysia that the hub doesn't have yet (owner, 1 Nov 2026: "next time
have to do this also during weekly maintenance").

Lists two kinds of evidence and flags what looks missing. It changes nothing: each flag is read on its source and on the
maker's own page by a person before a record is added or a price is filled.

  1. Malaysian-source headlines in live/headlines.json that talk about a launch, a price or a pre-order but are matched to
     no device in the hub (the device is probably missing).
  2. SoyaCincau's newest articles (its own sitemap, robots.txt respected) whose address mentions Malaysia, a price or a
     launch; each is shown with the hub devices its words match, or "no match".

    python tools/build.py                     (first, so generated/ is current)
    python tools/my_launches_check.py         --headlines FILE for a fresher live/headlines.json; --days N (default 14)
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
import auto_chips as net  # noqa: E402  (robots.txt check, neutral bot name, a pause between requests)

MY_SOURCES = {"soyacincau", "technave", "technave-zh", "zinggadget", "malaymail", "samsung-newsroom-my", "lowyat"}
LAUNCH = re.compile(r"(?i)malaysia|大马|马来西亚|\bRM\s?\d|launch|pre-?order|now available|on sale|发布|开售|上市|售价|开卖")
DEVICE_WORDS = re.compile(r"(?i)phone|galaxy|iphone|ipad|pixel|xiaomi|redmi|poco|oppo|vivo|iqoo|honor|huawei|realme|oneplus|nothing|cmf|"
                          r"motorola|redmagic|nubia|zte|asus|rog|tablet|pad|watch|buds|band|fold|flip")


FILLER = {"by", "the", "with", "and", "series", "edition"}


def words(s: str) -> set[str]:
    """Lower-case words without filler and without a trailing "+" (an address has no "+": "galaxy-tab-s12")."""
    return {w.rstrip("+") for w in re.findall(r"[a-z0-9+]+", s.lower())} - FILLER


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument("--headlines", default=str(ROOT / "live" / "headlines.json"))
    ap.add_argument("--days", type=int, default=14)
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    since = (dt.date.today() - dt.timedelta(days=args.days)).isoformat()
    devices = json.loads((ROOT / "generated" / "index" / "devices.json").read_text(encoding="utf-8"))
    # a device's name without its brand word ("CMF by Nothing Buds Neo" -> "cmf buds neo"), as articles often leave it out
    names = [(d["id"], (words(d["name"]) - {"nothing", "samsung", "huawei", "apple", "google"}) or words(d["name"])) for d in devices]

    def matches(text: str) -> list[str]:
        w = words(text)
        hits = [i for i, n in names if n and n <= w and len(n) >= 2]
        return sorted(hits, key=lambda i: -len(dict(names)[i]))[:3]

    print(f"1. Malaysian launch headlines since {since} not matched to a hub device")
    try:
        items = json.loads(Path(args.headlines).read_text(encoding="utf-8")).get("items", [])
    except (OSError, ValueError):
        items = []
    n1 = 0
    for i in sorted(items, key=lambda i: i.get("published") or "", reverse=True):
        if i.get("source") in MY_SOURCES and (i.get("published") or "") >= since and not i.get("devices") and LAUNCH.search(i.get("title") or "") \
                and DEVICE_WORDS.search(i.get("title") or ""):
            n1 += 1
            hits = matches(i.get("title") or "")
            note = f"now matches {', '.join(hits)}" if hits else "NO MATCH - check whether the hub has it"
            print(f"   {(i.get('published') or '')[:10]} {i['source']:12} {i['title'][:100]}\n      {note} | {i['url']}")
    if not n1:
        print("   none")

    print(f"\n2. SoyaCincau articles since {since} about a Malaysian launch or price")
    idx = net.fetch("https://soyacincau.com/sitemap_index.xml", timeout=60) or ""
    first = next((u for u in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", idx) if u.endswith("post-sitemap1.xml")), None)
    body = net.fetch(first, timeout=60) if first else None
    if not body:
        print("   SoyaCincau's sitemap could not be read this time (robots.txt, a bot check or the network); check by hand")
    else:
        y, m, d = since.split("-")
        urls = sorted({u for u in re.findall(r"<loc>\s*(https://soyacincau\.com/(\d{4})/(\d{2})/(\d{2})/[^<]+?)\s*</loc>", body)
                       if f"{u[1]}-{u[2]}-{u[3]}" >= since}, reverse=True)
        n2 = 0
        for u, *_ in urls:
            slug = u.rstrip("/").split("/")[-1].replace("-", " ")
            if re.search(r"(?i)malaysia|price|launch|pre order|available|rm\d", slug) and DEVICE_WORDS.search(slug):
                n2 += 1
                hits = matches(slug)
                print(f"   {u.split('.com/')[1][:10]} {'matches ' + ', '.join(hits) if hits else 'NO MATCH - check whether the hub has it'}\n      {u}")
        if not n2:
            print("   none")
    print("\nFor every item: read the report and the maker's own page; add or update the record only with what they state.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
