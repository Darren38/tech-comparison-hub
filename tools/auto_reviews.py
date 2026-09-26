"""Version 20: Trusted Reviews' own test results join the charts by themselves.

    python tools/auto_reviews.py            new reviews (daily), all older reviews once a month
    python tools/auto_reviews.py --force    ignore the schedule
    python tools/auto_reviews.py --dry      print what would change; write nothing

Trusted Reviews publishes a "Test Data" table in every phone review: Geekbench 6, the battery used by an hour of Netflix
HDR playback, and charging times (the same table the hand-entered records in data/reviews/trustedreviews-tests.json were
read from). Its sitemap lists every review (robots.txt allows reading it). A review is used when
  - its address names a phone or tablet in the hub (the review slugs follow the hub's own ids), and the table's heading
    names the same model exactly;
  - the phone has no hand-entered Trusted Reviews result (a person's record always wins);
  - the phone's chip can't differ from the UK review unit: Samsung models the hub records with an Exynos chip are left out
    (Trusted Reviews tests UK models and doesn't name the chip), as are phones with no chip recorded.
Each number must be in its test's plausible range. Charging results measured without the maker's charger ("no charger
included") are left out, as in the hand-entered records. Only the numbers and the review's address are kept.

Output: live/auto/auto_reviews.json (the build turns each review into a document labelled as read automatically).
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from auto_devices import allowed, fetch, now_iso, key  # noqa: E402  (same polite fetching and robots.txt checks)
from devices_all import all_devices  # noqa: E402

OUT = ROOT / "live" / "auto" / "auto_reviews.json"
INDEX = "https://www.trustedreviews.com/sitemap_index.xml"
REVIEW = re.compile(r"^https://www\.trustedreviews\.com/reviews/([a-z0-9-]+)/?$")
SCHEDULE_HOURS = {"recent": 20, "all": 700}   # the newest sitemaps daily, every sitemap about once a month
TODAY = dt.date.today().isoformat()
# Test Data row -> (metric, unit pattern, low, high)
ROWS = [
    (re.compile(r"^Geekbench 6 single core$", re.I), "gb6_single", r"^(\d{3,5})$", 400, 5000),
    (re.compile(r"^Geekbench 6 multi core$", re.I), "gb6_multi", r"^(\d{3,5})$", 800, 16000),
    (re.compile(r"^1 hour video playback \(Netflix, HDR\)$", re.I), "tr_video_drain", r"^(\d{1,2})\s*%$", 1, 30),
    (re.compile(r"^Time from 0-100% charge$", re.I), "charge_full", r"^(\d{2,3})\s*min$", 10, 300),
    (re.compile(r"^30-min recharge \(included charger\)$", re.I), "charge_30", r"^(\d{1,3})\s*%$", 5, 100),
    (re.compile(r"^15-min recharge \(included charger\)$", re.I), "charge_15", r"^(\d{1,3})\s*%$", 3, 100),
]
NOTES = {"tr_video_drain": "Share of a full battery used by one hour of Netflix HDR video", "charge_full": "Minutes from empty to full",
         "charge_30": "Charge level after 30 minutes, from empty", "charge_15": "Charge level after 15 minutes, from empty"}


def locs(url: str) -> list[str]:
    if not allowed(url):
        raise PermissionError("robots.txt does not allow " + url)
    status, _, text = fetch(url)
    if status != 200:
        raise OSError(f"{url}: HTTP {status}")
    return [html.unescape(u) for u in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", text)]


def table(page: str) -> tuple[str | None, list[tuple[str, str]]]:
    from extract import text_of  # noqa: PLC0415  (tools/v6-import, on the path through auto_devices)
    lines = text_of(page)
    if "Test Data" not in lines:
        return None, []
    i = lines.index("Test Data")
    name = lines[i + 1] if i + 1 < len(lines) else None
    rows, j = [], i + 2
    while j + 1 < len(lines) and lines[j] != "Full Specs" and j < i + 60:
        rows.append((lines[j], lines[j + 1]))
        j += 2
    return name, rows


def targets() -> dict[str, dict]:
    """Hub phones/tablets a Trusted Reviews result could be added to, by id (review slugs follow the same form)."""
    hand = set()
    for f in (ROOT / "data" / "reviews").glob("*.json"):
        for d in json.loads(f.read_text(encoding="utf-8")):
            if d.get("source") == "trustedreviews":
                hand.update(d.get("devices", []))
    out = {}
    for d in all_devices(("smartphone", "tablet")):
        chip = ((d.get("specs") or {}).get("platform") or {}).get("chipset") or ""
        if d["id"] in hand or not chip or (d.get("brand") == "samsung" and chip.startswith("exynos")):
            continue
        out[d["id"]] = d
    return out


CHIP_METRICS = ("gb6_single", "gb6_multi")


def chip_medians(devices: dict) -> dict:
    """Median Geekbench result of the hand-entered records for phones with each chip (a test run in a power-saving mode,
    or a typo, shows up as far from what the same chip scores in other phones)."""
    chip_of = {d["id"]: ((d.get("specs") or {}).get("platform") or {}).get("chipset") for d in devices}
    vals: dict = {}
    for folder in ("benchmarks", "reviews"):
        for f in (ROOT / "data" / folder).glob("*.json"):
            for doc in json.loads(f.read_text(encoding="utf-8")):
                for r in doc.get("records", []):
                    chip = r.get("chip") or chip_of.get(r.get("subject"))
                    if r.get("metric") in CHIP_METRICS and chip and isinstance(r.get("value"), (int, float)):
                        vals.setdefault((chip, r["metric"]), []).append(r["value"])
    out = {}
    for k, v in vals.items():
        if len(v) >= 2:
            v = sorted(v)
            out[k] = v[len(v) // 2]
    return out


def read_review(url: str, dev: dict, brands: dict) -> tuple[dict | None, str]:
    if not allowed(url):
        return None, "robots.txt does not allow the review"
    status, final, page = fetch(url)
    if status != 200:
        return None, f"HTTP {status}"
    name, rows = table(page)
    if not name:
        return None, "no Test Data table"
    brand = brands.get(dev.get("brand"), "")
    names = {key(dev["name"]), key(f"{brand} {dev['name']}")}
    if key(name) not in names and key(name).removesuffix("5g") not in {n.removesuffix("5g") for n in names}:
        return None, f"the table is for {name}, not {dev['name']}"
    values = {}
    for label, value in rows:
        for pattern, metric, unit, lo, hi in ROWS:
            if pattern.match(label.strip()):
                m = re.match(unit, value.strip(), re.I)
                if m and lo <= int(m.group(1)) <= hi:
                    values[metric] = int(m.group(1))
    if not values:
        return None, "no usable results in the table"
    published = None
    m = re.search(r"First Reviewed Date \| (\d{2})/(\d{2})/(\d{4})", " | ".join(__import__("extract").text_of(page)))
    if m:
        published = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    title = re.sub(r"\s*[|｜–-]\s*Trusted Reviews.*$", "", re.search(r"<title[^>]*>([^<]*)", page).group(1)).strip() if re.search(r"<title", page) else f"{name} review"
    return {"device": dev["id"], "name": name, "values": values, "url": final, "title": html.unescape(title)[:120],
            "published": published, "checked": TODAY}, "ok"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--limit", type=int, default=60, help="most reviews to read in one run")
    args = ap.parse_args()
    try:
        state = json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    runs = state.setdefault("runs", {})
    reviews = state.setdefault("reviews", {})
    misses = state.setdefault("misses", {})
    now = dt.datetime.now(dt.timezone.utc)
    age = lambda job: (now - dt.datetime.fromisoformat(runs[job])).total_seconds() / 3600 if runs.get(job) else 1e9
    job = "all" if (args.force or age("all") >= SCHEDULE_HOURS["all"]) else "recent" if age("recent") >= SCHEDULE_HOURS["recent"] else None
    if not job:
        print("[reviews] read recently; skipping")
        return 0
    brands = {b["id"]: b["name"] for b in json.loads((ROOT / "data" / "brands" / "brands.json").read_text(encoding="utf-8"))}
    want = targets()
    medians = chip_medians(all_devices(("smartphone", "tablet")))
    try:
        maps = [u for u in locs(INDEX) if "/post-sitemap" in u]
        maps.sort(key=lambda u: int(re.search(r"post-sitemap(\d*)", u).group(1) or 1))
        if job == "recent":
            maps = maps[-2:]                          # new posts land in the last sitemaps
        found, failed = {}, []
        for sm in maps:
            urls = None
            for _ in range(2):                            # one retry; a sitemap that still fails is skipped this time
                try:
                    urls = locs(sm)
                    break
                except Exception:  # noqa: BLE001
                    urls = None
            if urls is None:
                failed.append(sm.rsplit("/", 1)[-1])
                continue
            for u in urls:
                m = REVIEW.match(u.strip())
                if m and m.group(1) in want:
                    found[m.group(1)] = u.strip()
        if failed:
            state["skippedSitemaps"] = failed
            print(f"[reviews] sitemaps skipped this run: {', '.join(failed)}")
    except Exception as e:  # noqa: BLE001
        state["error"] = str(e)[:160]
        print(f"[reviews] sitemap not read: {e}")
        found = {}
    read = 0
    for dev_id, url in sorted(found.items()):
        if dev_id in reviews and reviews[dev_id].get("url") == url and job == "recent":
            continue
        last_miss = (misses.get(dev_id) or {}).get("at")
        if last_miss and (dt.date.today() - dt.date.fromisoformat(last_miss)).days < 30:
            continue
        if read >= args.limit:
            break
        read += 1
        got, why = read_review(url, want[dev_id], brands)
        if got:
            old = reviews.get(dev_id, {}).get("values") or {}
            jumps = [m for m, v in got["values"].items() if old.get(m) and abs(v - old[m]) / old[m] > 0.3]
            chip = ((want[dev_id].get("specs") or {}).get("platform") or {}).get("chipset")
            jumps += [m for m in CHIP_METRICS if m in got["values"] and (chip, m) in medians
                      and abs(got["values"][m] - medians[(chip, m)]) / medians[(chip, m)] > 0.25]
            if any(m in jumps for m in CHIP_METRICS):   # one odd Geekbench run makes the other score from it suspect too
                jumps += [m for m in CHIP_METRICS if m in got["values"]]
            jumps = sorted(set(jumps))
            if jumps:
                got["held"] = jumps                   # a change of more than 30% waits for a person
            reviews[dev_id] = got
            misses.pop(dev_id, None)
            print(f"[reviews] {dev_id}: {got['values']}")
        else:
            misses[dev_id] = {"url": url, "reason": why, "at": TODAY}
            print(f"[reviews] {dev_id}: not used ({why})")
    # a device that now has a hand-entered Trusted Reviews result, or left the hub, drops its automatic one
    for dev_id in [d for d in reviews if d not in want]:
        reviews.pop(dev_id)
    runs[job] = now_iso()
    if job == "all":
        runs["recent"] = runs["all"]
    state["updatedAt"] = now_iso()
    state.pop("error", None) if found else None
    print(f"[reviews] {read} reviews read; {len(reviews)} phones have automatic Trusted Reviews results")
    if not args.dry:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
