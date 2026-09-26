"""Add benchmark results for phones nobody has matched by hand yet (Version 19).

    python tools/auto_benchmarks.py                     run every source that is due, write live/auto/auto_bench.json
    python tools/auto_benchmarks.py --only nanoreview   one source (ul, dxomark, antutu or nanoreview)
    python tools/auto_benchmarks.py --force             ignore the schedule

tools/refresh_benchmarks.py keeps the hand-matched phones up to date. This script lets new phones join the charts by
themselves, with the same care as a person would take:

- A match needs the **exact model name** (brand and model, "5G" ignored) and, wherever the source names the chip, the
  **same chip** as the hub records for that phone. A Galaxy whose Malaysian model uses Exynos is never matched to a
  Snapdragon listing, and a phone with no chip recorded is not matched to a chip-bearing listing. Nothing is guessed.
- UL 3DMark: the full smartphone list is read to find the phone, then its own UL device page is read, exactly like the
  hand-matched phones (the list and device pages differ for Wild Life Extreme, so only the device page is used).
- DXOMARK: its public score list. Samsung listings marked "(Exynos)" / "(Snapdragon)" are matched to that chip only.
- AnTuTu: its V11 ranking, which gives each phone's chip.
- NanoReview: each phone's page gives Geekbench 6 single- and multi-core averages and the chip. Read about once a week,
  one page every 1.5 s; a phone NanoReview doesn't list is tried again after 30 days. (Geekbench's own site is behind a
  bot challenge, which this project never bypasses.)
- A value that moves more than 30% from the last automatic reading is held back for a person to check.
- Phones already matched by hand for a source are left to tools/refresh_benchmarks.py.

Only numbers, names and links are stored. The build (tools/build.py) turns the result into one clearly labelled document
per source ("matched automatically").
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "live" / "auto" / "auto_bench.json"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0; +https://darren38.github.io/tech-comparison-hub/)"
MAX_CHANGE = 0.30
UL_LIST = "https://benchmarks.ul.com/compare/best-smartphones?amount=0&test=SOLAR_BAY_PERFORMANCE"
UL_TESTS = {"3DMark Wild Life Extreme": "wle", "3DMark Solar Bay": "solar_bay", "3DMark Steel Nomad Light": "steel_nomad_light"}
DXO_LIST = "https://www.dxomark.com/dakdata/webservices/public/smartphones"
DXO_FIELDS = {"dxomark_camera_v5": "camerav5", "dxomark_camera": "camerav6", "dxomark_display": "displayv2",
              "dxomark_battery": "batteryv1_5", "dxomark_audio": "audiov2"}
ANTUTU = "https://www.antutu.com/web/ranking"  # moved from /web/en/ranking in September 2026
NANO = "https://nanoreview.net/en/{kind}/{slug}"
SCHEDULE_HOURS = {"ul": 20, "dxomark": 20, "antutu": 20, "nanoreview": 160}
NANO_RETRY_DAYS = 30
NANO_LIMIT = 220           # most NanoReview pages read in one run
PAGE_DELAY = {"ul": 1.2, "nanoreview": 1.5}
VENDOR_WORDS = {"qualcomm", "mediatek", "samsung", "apple", "google", "hisilicon", "huawei", "unisoc", "xiaomi"}

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refresh_benchmarks import antutu_rows, text_lines  # noqa: E402  (same page readers as the daily refresh)
from devices_all import all_devices, auto_chipsets  # noqa: E402  (Version 20: devices added automatically count too)

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
                rp.parse([])
        except Exception:  # noqa: BLE001
            rp = None
        _robots[key] = rp
    return bool(_robots[key] and _robots[key].can_fetch(UA, url))


def fetch(url: str, timeout: int = 45) -> str:
    if not allowed(url):
        raise PermissionError("robots.txt does not allow it")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"}), timeout=timeout) as r:
        return r.read(8_000_000).decode("utf-8", "replace")


# ------------------------------------------------------------------ names and chips

def norm(text: str, loose: bool = False) -> str:
    t = re.sub(r"[^a-z0-9+]+", " ", html.unescape(str(text)).lower()).strip()
    if loose:
        # "Galaxy A37 5G" = "Galaxy A37". Only safe where the source also names the chip: 4G and 5G versions of a
        # model are often different phones (Galaxy A15 / A15 5G, HONOR X7b / X7b 5G) and the chip tells them apart.
        t = re.sub(r"\s+5g$", "", t)
    t = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", t)   # "Neo10" = "Neo 10" (applied to both sides)
    return re.sub(r"\s+", " ", t).strip()


def chip_norm(text: str) -> str:
    t = norm(text)
    t = re.sub(r"\bfor galaxy\b", "", t)
    words = [w for w in t.split() if w not in VENDOR_WORDS]
    return " ".join(words).strip()


def load_devices() -> list[dict]:
    brands = {b["id"]: b["name"] for b in json.loads((DATA / "brands" / "brands.json").read_text(encoding="utf-8"))}
    chips = {}
    for c in [json.loads(p.read_text(encoding="utf-8")) for p in (DATA / "chipsets").glob("*.json")] + auto_chipsets():
        chips[c["id"]] = {chip_norm(n) for n in [c["name"], *c.get("aliases", [])] if n}
    raw = [(d["category"], d) for d in all_devices(("smartphone", "tablet"))]
    # a model name without its brand ("Galaxy S26 Ultra", "Neo 10") is only used when no other device shares it
    brandless_count: dict[str, int] = {}
    for _, d in raw:
        brandless_count[norm(d["name"], loose=True)] = brandless_count.get(norm(d["name"], loose=True), 0) + 1
    out = []
    for cat, d in raw:
        brand = brands.get(d.get("brand"), d.get("brand", ""))
        name = d["name"] if re.search(rf"(^|\s){re.escape(brand)}(\s|$)", d["name"], re.I) else f"{brand} {d['name']}"
        names = {norm(name), *(norm(a) for a in d.get("aliases", []) if len(a) > 6)}
        bare = norm(d["name"])
        if brandless_count.get(norm(d["name"], loose=True)) == 1 and len(bare) > 5 and re.search(r"\d", bare):
            names.add(bare)
        if d.get("brand") == "xiaomi" and norm(name).startswith("xiaomi "):
            names.add("mi " + norm(name)[len("xiaomi "):])   # AnTuTu writes "Mi 17" for the Xiaomi 17
        chip_id = (d.get("specs") or {}).get("platform", {}).get("chipset")
        loose = {norm(n, loose=True) for n in [name, *(a for a in d.get("aliases", []) if len(a) > 6)]} | {norm(n, loose=True) for n in names}
        out.append({"id": d["id"], "category": cat, "name": name, "names": names, "loose": loose,
                    "chip": chip_id, "chipNames": chips.get(chip_id, set()), "announced": d.get("announced") or ""})
    return out


def chip_ok(dev: dict, source_chip: str | None) -> bool:
    """The source's chip must be the phone's chip. No chip on either side = no match when the source names one."""
    if source_chip is None:
        return True
    return bool(dev["chipNames"]) and chip_norm(source_chip) in dev["chipNames"]


def hand_matched(source: str) -> set[str]:
    """Phones a person already matched for this source (their documents live in data/benchmarks)."""
    files = {"ul": "ul-3dmark.json", "dxomark": "dxomark-scores.json", "antutu": "antutu-ranking.json"}
    done: set[str] = set()
    if source in files and (DATA / "benchmarks" / files[source]).exists():
        for doc in json.loads((DATA / "benchmarks" / files[source]).read_text(encoding="utf-8")):
            done.update(doc.get("devices", []))
            done.update(r.get("subject") for r in doc.get("records", []))
    return done


# ------------------------------------------------------------------ sources

def ul(devices, prev) -> tuple[dict, dict]:
    page = fetch(UL_LIST)
    rows = []
    for m in re.finditer(r"href='(https://benchmarks\.ul\.com/hardware/phone/[^']+)'>([^<]+)</a>(.*?)</tr>", page, re.S):
        chip = re.search(r"<div class='list-emphasis'>\s*<spin[^>]*>([^<]+)</spin>", m.group(3))
        rows.append({"url": m.group(1), "name": html.unescape(m.group(2)).strip(), "chip": chip.group(1).strip() if chip else None})
    if len(rows) < 100:
        raise RuntimeError(f"only {len(rows)} rows read")
    by_name: dict[str, list[dict]] = {}
    for r in rows:
        base = re.sub(r"\s*\((?:[^)]*)\)\s*$", "", r["name"])   # "Samsung Galaxy S26 (Exynos 2600)"
        by_name.setdefault(norm(base, loose=True), []).append(r)
    done = hand_matched("ul")
    matches, looked = {}, 0
    for dev in devices:
        if dev["id"] in done or dev["category"] != "smartphone":
            continue
        cands = [r for n in dev["loose"] for r in by_name.get(n, [])]
        cand = next((r for r in cands if r["chip"] and chip_ok(dev, r["chip"])), None)
        if not cand:
            continue
        looked += 1
        try:
            lines = text_lines(fetch(cand["url"]))
        except Exception:  # noqa: BLE001
            continue
        finally:
            time.sleep(PAGE_DELAY["ul"])
        values = {}
        for j, l in enumerate(lines):
            if l in UL_TESTS and j + 2 < len(lines) and lines[j + 1] == "Score" and re.fullmatch(r"\d+", lines[j + 2]):
                values[UL_TESTS[l]] = int(lines[j + 2])
        if values:
            matches[dev["id"]] = {"name": cand["name"], "chip": cand["chip"], "url": cand["url"], "values": values}
    return matches, {"rows": len(rows), "pagesRead": looked}


def dxomark(devices, prev) -> tuple[dict, dict]:
    phones = json.loads(fetch(DXO_LIST))
    by_name: dict[str, list[dict]] = {}
    for p in phones:
        full = p.get("fullName") or f"{p.get('brand', '')} {p.get('name', '')}"
        variant = re.search(r"\(([^)]+)\)\s*$", full)
        base = re.sub(r"\s*\([^)]*\)\s*$", "", full)
        by_name.setdefault(norm(base), []).append({**p, "_full": full, "_variant": variant.group(1) if variant else None})
    done = hand_matched("dxomark")
    matches = {}
    for dev in devices:
        if dev["id"] in done or dev["category"] != "smartphone":
            continue
        cands = [p for n in dev["names"] for p in by_name.get(n, [])]
        if not cands:
            continue
        # a listing that names a chip must be this phone's chip; a plain listing is used only when no chip-named
        # sibling exists (then DXOMARK tested the one model sold under that name)
        named = [p for p in cands if p["_variant"]]
        pick = next((p for p in named if chip_ok(dev, p["_variant"]) or chip_norm(p["_variant"]) in {w.split()[0] for w in dev["chipNames"] if w}), None)
        if not pick and not named:
            pick = cands[0]
        if not pick:
            continue
        values = {metric: pick[field] for metric, field in DXO_FIELDS.items() if isinstance(pick.get(field), (int, float))}
        # a phone tested only under camera protocol 5 carries the same number in the v6 field: keep it as v5 only
        if values.get("dxomark_camera") is not None and values.get("dxomark_camera") == values.get("dxomark_camera_v5"):
            values.pop("dxomark_camera")
        if values:
            matches[dev["id"]] = {"name": pick["_full"], "url": "https://www.dxomark.com" + pick.get("productReviewURL", ""), "values": values}
    return matches, {"phones": len(phones)}


def antutu(devices, prev) -> tuple[dict, dict]:
    rows = antutu_rows(fetch(ANTUTU))
    if len(rows) < 20:
        raise RuntimeError(f"only {len(rows)} rows read")
    expand = {"s": "snapdragon", "m": "dimensity", "d": "dimensity", "e": "exynos", "k": "kirin", "t": "tensor"}
    by_name: dict[str, list[dict]] = {}
    for r in rows:
        by_name.setdefault(norm(r["name"], loose=True), []).append(r)
    done = hand_matched("antutu")
    matches = {}
    for dev in devices:
        if dev["id"] in done:
            continue
        for r in (r for n in dev["loose"] for r in by_name.get(n, [])):
            m = re.match(r"([A-Za-z])-(.+)$", r["chip"])
            chip = f"{expand.get(m.group(1).lower(), m.group(1))} {m.group(2)}" if m else r["chip"]
            if re.match(r"dimensity g\d", chip_norm(chip)):  # M-G99 is a Helio chip
                chip = "helio " + chip.split()[-1]
            if chip_ok(dev, chip):
                matches[dev["id"]] = {"name": r["name"], "chip": r["chip"], "memory": r["mem"], "url": ANTUTU, "values": {"antutu_v11": r["total"]}}
                break
    return matches, {"rows": len(rows)}


def nano_page(url: str) -> dict | None:
    page = fetch(url)
    lines = text_lines(page)
    title = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S)
    name = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", title.group(1)))).strip() if title else None
    soc = next((lines[i + 1] for i, l in enumerate(lines) if l == "SoC:" and i + 1 < len(lines)), None)
    def after(label):
        for i, l in enumerate(lines):
            if l == label and i + 1 < len(lines) and re.fullmatch(r"\d{3,6}", lines[i + 1].replace(",", "")):
                return int(lines[i + 1].replace(",", ""))
        return None
    return {"name": name, "chip": soc, "single": after("Geekbench 6 (Single-Core)"), "multi": after("Geekbench 6 (Multi-Core)")}


def nanoreview(devices, prev) -> tuple[dict, dict]:
    now = dt.datetime.now(dt.timezone.utc)
    misses = dict((prev.get("misses") or {}).get("nanoreview") or {})
    old = (prev.get("matches") or {}).get("nanoreview") or {}
    matches, read, skipped = {}, 0, 0
    # newest phones first, so a run that hits the limit covers what people look at most
    for dev in sorted(devices, key=lambda d: d["announced"], reverse=True):
        if read >= NANO_LIMIT:
            matches.update({k: v for k, v in old.items() if k not in matches})
            break
        last_miss = misses.get(dev["id"])
        if last_miss and (now - dt.datetime.fromisoformat(last_miss)).days < NANO_RETRY_DAYS:
            skipped += 1
            continue
        known = old.get(dev["id"], {}).get("url")
        slug = re.sub(r"[^a-z0-9]+", "-", dev["name"].lower()).strip("-")
        url = known or NANO.format(kind="phone" if dev["category"] == "smartphone" else "tablet", slug=slug)
        try:
            info = nano_page(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                misses[dev["id"]] = now.isoformat(timespec="seconds")
            continue
        except Exception:  # noqa: BLE001 - network trouble: try again next time
            continue
        finally:
            read += 1
            time.sleep(PAGE_DELAY["nanoreview"])
        if not info or not info["name"] or not info["chip"] or norm(info["name"], loose=True) not in dev["loose"] or not chip_ok(dev, info["chip"]):
            misses[dev["id"]] = now.isoformat(timespec="seconds")
            continue
        values = {k: v for k, v in (("gb6_single", info["single"]), ("gb6_multi", info["multi"])) if v}
        if values:
            misses.pop(dev["id"], None)
            matches[dev["id"]] = {"name": info["name"], "chip": info["chip"], "url": url, "values": values}
    return matches, {"pagesRead": read, "retryLater": skipped, "misses": misses}


SOURCES = {"ul": ul, "dxomark": dxomark, "antutu": antutu, "nanoreview": nanoreview}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=list(SOURCES))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    prev = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    data = {"updatedAt": prev.get("updatedAt"), "sources": dict(prev.get("sources") or {}), "matches": dict(prev.get("matches") or {}),
            "misses": dict(prev.get("misses") or {}), "held": []}
    devices = load_devices()
    ran = False
    for name, job in SOURCES.items():
        if args.only and args.only != name:
            continue
        last = (data["sources"].get(name) or {}).get("at")
        if not args.force and last and (now - dt.datetime.fromisoformat(last)).total_seconds() < SCHEDULE_HOURS[name] * 3600:
            print(f"[auto-bench] {name}: read {last}; not due")
            continue
        ran = True
        try:
            found, info = job(devices, prev)
        except Exception as exc:  # noqa: BLE001 - keep the previous matches for this source
            data["sources"][name] = {**(data["sources"].get(name) or {}), "ok": False, "error": f"{exc.__class__.__name__}: {str(exc)[:120]}",
                                     "tried": now.isoformat(timespec="seconds")}
            print(f"[auto-bench] {name}: failed ({exc})")
            continue
        if "misses" in info:
            data["misses"][name] = info.pop("misses")
        old = data["matches"].get(name) or {}
        kept = {}
        for dev_id, m in found.items():
            before = (old.get(dev_id) or {}).get("values") or {}
            values = {}
            for metric, value in m["values"].items():
                was = before.get(metric)
                if was and abs(value - was) / was > MAX_CHANGE:
                    data["held"].append({"source": name, "device": dev_id, "metric": metric, "value": value, "previous": was})
                    values[metric] = was
                else:
                    values[metric] = value
            kept[dev_id] = {**m, "values": values, "matchedAt": (old.get(dev_id) or {}).get("matchedAt") or now.date().isoformat(),
                            "checkedAt": now.date().isoformat()}
        data["matches"][name] = kept
        data["sources"][name] = {"ok": True, "at": now.isoformat(timespec="seconds"), "matched": len(kept), **info}
        print(f"[auto-bench] {name}: {len(kept)} phones matched automatically {info}")
    if ran:
        data["updatedAt"] = now.isoformat(timespec="seconds")
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
