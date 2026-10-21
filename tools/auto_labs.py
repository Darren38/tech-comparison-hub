"""Version 33: Tom's Guide's and Engadget's own test results join the charts by themselves.

    python tools/auto_labs.py            new reviews (daily), every review since 2025 once a month
    python tools/auto_labs.py --force    ignore the schedule (reads every review since 2025)
    python tools/auto_labs.py --dry      print what would change; write nothing

Tom's Guide publishes results tables in its phone and tablet reviews: Geekbench 6, battery life on its web-surfing
test (hours:minutes), peak brightness, charge after 15 and 30 minutes and 3DMark stress-test stability (the tables
the hand-entered records in data/reviews/tomsguide-tests.json were read from). Its monthly sitemaps list every
article (robots.txt allows reading them). Engadget states its video rundown result in the review text; its reviews
are found in the site's own headline archive.

A result is used only when
  - the table row (Tom's Guide) names a phone or tablet in the hub exactly, and that phone is the one the review is
    about: every word of its name is in the review's title (so rival phones in the same table are left out, and
    "Galaxy S26 Ultra" is never read from a "Galaxy S26" review); comparisons ("vs") are skipped;
  - (Engadget) the sentence with "rundown" gives a time, and the title names exactly one phone in the hub;
  - the number is in its test's plausible range; Tom's Guide battery results only from reviews published from 2025
    on (it revised the test in 2025);
  - the phone has no hand-entered result for that test from the same publication (a person's record always wins;
    the build applies this).
A result that moves more than 30% from the one read before is held for a person. Only the numbers, the review's
address, title and date are kept.

Output: live/auto/auto_labs.json (the build turns each review into a document labelled as read automatically).
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
from auto_devices import allowed, fetch, now_iso  # noqa: E402  (same polite fetching and robots.txt checks)
from devices_all import all_devices  # noqa: E402

OUT = ROOT / "live" / "auto" / "auto_labs.json"
TG_SITEMAP = "https://www.tomsguide.com/sitemap-{}.xml"
TG_REVIEW = re.compile(r"^https://www\.tomsguide\.com/(?:phones|computing/(?:android-tablets|tablets|ipads?))/[a-z0-9/-]*review[a-z0-9-]*$")
EG_REVIEW = re.compile(r"^https://www\.engadget\.com/(?:[a-z-]+/)?\d+/[a-z0-9-]*review[a-z0-9-]*/?$")
SCHEDULE_HOURS = {"recent": 20, "all": 700}
FIRST_MONTH = (2025, 1)
TODAY = dt.date.today().isoformat()
RANGES = {"gb6_single": (400, 5000), "gb6_multi": (800, 16000), "tg_web": (4, 30), "nits_peak": (300, 6000),
          "charge_15": (3, 100), "charge_30": (5, 100), "wle_stability": (20, 100), "engadget_video": (5, 60)}


# ------------------------------------------------------------------------------------------------ names
def words(text: str) -> list[str]:
    t = text.lower().replace("+", " plus ").replace("&", " and ")
    t = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", t)
    return re.findall(r"[a-z0-9]+", t)


def name_index() -> tuple[dict, dict, dict]:
    """compact name -> device id (phones and tablets, with and without the brand), id -> name word sets, id -> names."""
    brands = {b["id"]: b["name"] for b in json.loads((ROOT / "data" / "brands" / "brands.json").read_text(encoding="utf-8"))}
    by_name, word_sets, all_names = {}, {}, {}
    for d in all_devices(("smartphone", "tablet")):
        names = {d["name"], *d.get("aliases", [])}
        brand = brands.get(d.get("brand"), "")
        names |= {f"{brand} {n}" for n in list(names) if brand and not n.lower().startswith(brand.lower())}
        for n in names:
            by_name.setdefault("".join(words(n)), d["id"])
        word_sets[d["id"]] = [set(words(n)) for n in names]
        all_names[d["id"]] = sorted(names)
    return by_name, word_sets, all_names


# a name followed by one of these words names a different model ("Galaxy S25" in "Galaxy S25 Ultra review")
VARIANT = {"plus", "ultra", "pro", "max", "mini", "lite", "fe", "edge", "fold", "flip", "air", "neo", "se", "s", "e", "a",
           "r", "t", "xl", "power", "prime", "turbo", "5g"}


def about(dev_id: str, title: str, word_sets: dict, names: dict) -> bool:
    """Is the review about this device? Its name must be in the title, and either no longer hub name is also in the
    title, or its name stands on its own there ("iPhone 18 Pro and Pro Max": the 18 Pro, then "and")."""
    tw = set(words(title))
    if not any(ws and ws <= tw for ws in word_sets.get(dev_id, [])):
        return False
    mine = [ws for ws in word_sets[dev_id] if ws and ws <= tw]
    longer = [d for d, sets in word_sets.items() if d != dev_id and any(ws <= tw and any(ws > m for m in mine) for ws in sets if ws)]
    if not longer:
        return True
    seq = words(title)
    for name in names.get(dev_id, []):
        n = words(name)
        for i in range(len(seq) - len(n) + 1):
            if seq[i:i + len(n)] == n and (i + len(n) == len(seq) or seq[i + len(n)] not in VARIANT):
                return True
    return False


# ------------------------------------------------------------------------------------------------ Tom's Guide
def cells(row: str) -> list[str]:
    return [re.sub(r"\s+", " ", html.unescape(re.sub(r"(?s)<[^>]+>", " ", c))).strip()
            for c in re.findall(r"(?is)<t[hd][^>]*>(.*?)</t[hd]>", row)]


def num(text: str) -> float | None:
    m = re.search(r"\d[\d,]*(?:\.\d+)?", text or "")
    return float(m.group(0).replace(",", "")) if m else None


def hours(text: str) -> float | None:
    m = re.search(r"(\d{1,2}):(\d{2})", text or "")
    return round(int(m.group(1)) + int(m.group(2)) / 60, 3) if m else None


def column_metric(head: str) -> str | None:
    h = head.lower()
    if "geekbench 6" in h and "ai" not in h.split():
        if "single" in h and "multi" in h:
            return "gb6_both"
        return "gb6_single" if "single" in h else "gb6_multi" if "multi" in h else None
    if "hrs:mins" in h or "battery life" in h:
        return "tg_web"
    if "stability" in h and "wild life extreme" in h:
        return "wle_stability"
    if re.search(r"\b30\s*min", h):
        return "charge_30"
    if re.search(r"\b15\s*min", h):
        return "charge_15"
    if "brightness" in h and ("max" in h or "peak" in h):
        return "nits_peak"
    return None


def value_of(metric: str, text: str):
    if metric == "gb6_both":
        nums = [float(x.replace(",", "")) for x in re.findall(r"\d[\d,]*", text or "")]
        return (nums[0], nums[1]) if len(nums) >= 2 else None
    if metric == "tg_web":
        return hours(text)
    return num(text)


def tg_tables(page: str, by_name: dict) -> dict[str, dict]:
    """device id -> {metric: value} from every results table (both layouts: phones as rows, or phones as columns)."""
    out: dict[str, dict] = {}
    for table in re.findall(r"(?is)<table.*?</table>", page):
        rows = [cells(r) for r in re.findall(r"(?is)<tr.*?</tr>", table)]
        rows = [r for r in rows if r]
        if len(rows) < 2:
            continue
        head = rows[0]
        col_devices = {i: by_name.get("".join(words(c))) for i, c in enumerate(head) if i}
        if any(col_devices.values()):                       # phones as columns: one metric per row
            for r in rows[1:]:
                metric = column_metric(r[0]) if r else None
                if metric == "nits_peak" and "sdr" in r[0].lower():
                    continue                                  # the HDR / max row is the small-window peak used here
                if not metric:
                    continue
                for i, dev in col_devices.items():
                    if dev and i < len(r):
                        put(out, dev, metric, value_of(metric, r[i]))
        else:                                                 # phones as rows: one metric per column
            metrics = {i: column_metric(h) for i, h in enumerate(head) if i}
            if not any(metrics.values()):
                continue
            for r in rows[1:]:
                dev = by_name.get("".join(words(r[0]))) if r else None
                if not dev:
                    continue
                for i, metric in metrics.items():
                    if metric and i < len(r):
                        put(out, dev, metric, value_of(metric, r[i]))
    return out


def put(out: dict, dev: str, metric: str, value) -> None:
    if value is None:
        return
    if metric == "gb6_both":
        put(out, dev, "gb6_single", value[0])
        put(out, dev, "gb6_multi", value[1])
        return
    lo, hi = RANGES[metric]
    if lo <= value <= hi:
        out.setdefault(dev, {}).setdefault(metric, value if metric in ("tg_web", "wle_stability") else int(value))


def published_of(page: str) -> str | None:
    m = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})', page) or re.search(r'article:published_time"\s+content="(\d{4}-\d{2}-\d{2})', page)
    return m.group(1) if m else None


def title_of(page: str) -> str:
    m = re.search(r"<title[^>]*>([^<]*)", page)
    t = html.unescape(m.group(1)) if m else ""
    return re.sub(r"\s*[|｜]\s*(Tom's Guide|Engadget).*$", "", t).strip()


def read_tg(url: str, by_name: dict, word_sets: dict, names: dict) -> tuple[dict, str]:
    if not allowed(url):
        return {}, "robots.txt does not allow the review"
    status, final, page = fetch(url)
    if status != 200:
        return {}, f"HTTP {status}"
    title = title_of(page)
    if re.search(r"\bvs\.?\b|\bversus\b", title, re.I):
        return {}, "a comparison, not a review"
    published = published_of(page)
    got = {}
    for dev, values in tg_tables(page, by_name).items():
        if not about(dev, title, word_sets, names):
            continue                                          # a rival phone in the table, not the one reviewed
        if "tg_web" in values and (not published or published < "2025-01-01"):
            values.pop("tg_web")                              # the battery test was revised in 2025
        if values:
            got[dev] = {"values": values, "url": final, "title": title[:120], "published": published, "checked": TODAY}
    return got, "ok" if got else "no results for the reviewed phone"


def tg_candidates(job: str) -> list[str]:
    today = dt.date.today()
    months = []
    y, m = (FIRST_MONTH if job == "all" else ((today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)))
    while (y, m) <= (today.year, today.month):
        months.append(f"{y}-{m:02d}")
        y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    urls = []
    for month in months:
        sm = TG_SITEMAP.format(month)
        if not allowed(sm):
            continue
        status, _, text = fetch(sm)
        if status != 200:
            continue
        for u in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", text):
            u = html.unescape(u).strip()
            if TG_REVIEW.match(u) and "preview" not in u:
                urls.append(u)
    return urls


# ------------------------------------------------------------------------------------------------ Engadget
DURATION = re.compile(r"(\d{1,2})\s*hours?(?:,?\s*(?:and\s*)?(\d{1,2})\s*minutes?)?|(\d{1,2}):(\d{2})\b", re.I)


def read_engadget(url: str, by_name: dict, word_sets: dict, names: dict) -> tuple[dict, str]:
    if not allowed(url):
        return {}, "robots.txt does not allow the review"
    status, final, page = fetch(url)
    if status != 200:
        return {}, f"HTTP {status}"
    title = title_of(page)
    if re.search(r"\bvs\.?\b|\bversus\b", title, re.I):
        return {}, "a comparison, not a review"
    tw = set(words(title))
    named = {d for d in word_sets if about(d, title, word_sets, names)}
    if len(named) != 1:
        return {}, "the title names no single phone in the hub" if not named else "the title names several phones"
    dev = named.pop()
    text = " ".join(re.sub(r"\s+", " ", html.unescape(re.sub(r"(?s)<[^>]+>", " ", p))) for p in re.findall(r"(?is)<p[^>]*>(.*?)</p>", page))
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if "rundown" not in sentence.lower():
            continue
        m = DURATION.search(sentence)
        if not m:
            continue
        h = int(m.group(1) or m.group(3)); mins = int(m.group(2) or m.group(4) or 0)
        value = round(h + mins / 60, 3)
        lo, hi = RANGES["engadget_video"]
        if lo <= value <= hi:
            return {dev: {"values": {"engadget_video": value}, "url": final, "title": title[:120],
                          "published": published_of(page), "checked": TODAY, "sentence": sentence.strip()[:240]}}, "ok"
    return {}, "no video rundown result in the text"


def eg_candidates() -> list[str]:
    urls = []
    for f in ("archive.json", "headlines.json"):
        p = ROOT / "live" / f
        try:
            items = json.loads(p.read_text(encoding="utf-8")).get("items", [])
        except (OSError, ValueError):
            continue
        for i in items:
            u = (i.get("url") or "").split("?")[0]
            if i.get("source") == "engadget" and EG_REVIEW.match(u) and "review" in (i.get("title") or "").lower():
                urls.append(u)
    return sorted(set(urls))


# ------------------------------------------------------------------------------------------------ main
def merge(store: dict, got: dict) -> list[str]:
    """Results from several reviews of one phone are combined test by test; for each test the newest review wins."""
    changed = []
    for dev, r in got.items():
        rec = store.setdefault(dev, {"values": {}, "from": {}})
        rec.setdefault("from", {})
        held = []
        for m, v in r["values"].items():
            prev_date = (rec["from"].get(m) or {}).get("published") or ""
            if m in rec["values"] and (r.get("published") or "") < prev_date:
                continue                                       # an older review: keep the newer result
            old = rec["values"].get(m)
            if old and abs(v - old) / old > 0.3 and rec["from"].get(m, {}).get("url") != r["url"]:
                held.append(m)
            rec["values"][m] = v
            rec["from"][m] = {"url": r["url"], "published": r.get("published")}
        for k in ("url", "title", "published", "checked", "sentence"):
            if r.get(k) and (k != "published" or (r.get("published") or "") >= (rec.get("published") or "")):
                rec[k] = r[k]
        rec["held"] = sorted(set(rec.get("held", [])) | set(held)) or None
        if not rec["held"]:
            rec.pop("held")
        changed.append(f"{dev}: {rec['values']}{' (held: ' + ', '.join(held) + ')' if held else ''}")
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--limit", type=int, default=40, help="most reviews to read from each publication in one run")
    args = ap.parse_args()
    try:
        state = json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    runs = state.setdefault("runs", {})
    results = state.setdefault("results", {})
    seen = state.setdefault("seen", {})                      # review address -> date read (a review is read once,
    misses = state.setdefault("misses", {})                  # again only in the monthly full pass)
    now = dt.datetime.now(dt.timezone.utc)
    age = lambda job: (now - dt.datetime.fromisoformat(runs[job])).total_seconds() / 3600 if runs.get(job) else 1e9
    job = "all" if (args.force or age("all") >= SCHEDULE_HOURS["all"]) else "recent" if age("recent") >= SCHEDULE_HOURS["recent"] else None
    if not job:
        print("[labs] read recently; skipping")
        return 0
    by_name, word_sets, names = name_index()
    for source, candidates, reader in (("tomsguide", tg_candidates, read_tg), ("engadget", lambda job: eg_candidates(), read_engadget)):
        store = results.setdefault(source, {})
        try:
            urls = candidates(job)
        except Exception as e:  # noqa: BLE001
            print(f"[labs] {source}: list not read ({e})")
            continue
        read = 0
        for url in urls:
            if job == "recent" and url in seen:
                continue
            if read >= args.limit:
                break
            read += 1
            try:
                got, why = reader(url, by_name, word_sets, names)
            except Exception as e:  # noqa: BLE001
                got, why = {}, type(e).__name__
            seen[url] = TODAY
            if got:
                for line in merge(store, got):
                    print(f"[labs] {source} {line}")
                misses.pop(url, None)
            else:
                misses[url] = {"reason": why, "at": TODAY}
        print(f"[labs] {source}: {len(urls)} reviews listed, {read} read; {len(store)} devices have automatic results")
    # devices that left the hub drop their results
    known = {d["id"] for d in all_devices(("smartphone", "tablet"))}
    for store in results.values():
        for dev in [d for d in store if d not in known]:
            store.pop(dev)
    runs[job] = now_iso()
    if job == "all":
        runs["recent"] = runs["all"]
    state["updatedAt"] = now_iso()
    if len(misses) > 400:                                   # keep the file small: the oldest misses go first
        for u in sorted(misses, key=lambda u: misses[u]["at"])[: len(misses) - 400]:
            misses.pop(u)
    if not args.dry:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
