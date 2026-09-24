"""Refresh the benchmark databases automatically (Version 16): UL 3DMark device pages, AnTuTu's ranking and DXOMARK's
public score list.

    python tools/refresh_benchmarks.py                     refresh now, write live/auto/benchmarks.json
    python tools/refresh_benchmarks.py --max-age-hours 20  do nothing if the saved refresh is newer than that
    python tools/refresh_benchmarks.py --only dxomark      one source (ul, antutu or dxomark)

Only phones that are already matched in data/benchmarks/ are refreshed, through the link or listed name recorded
there, so a new match is never guessed automatically. A value that moves by more than MAX_CHANGE is held back and
listed for a person to check, not applied. A source that can't be read leaves its saved values as they are.
The build (tools/build.py) applies the result on top of the checked data; data/ itself is never rewritten.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "data" / "benchmarks"
OUT = ROOT / "live" / "auto" / "benchmarks.json"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0; +https://darren38.github.io/tech-comparison-hub/)"
MAX_CHANGE = 0.30   # a larger jump is held for a person to check (a misread page, a renamed model, a new test version)
UL_DELAY = 1.2      # seconds between UL page requests: one visit per phone, once a day

UL_TESTS = {"3DMark Wild Life Extreme": "wle", "3DMark Solar Bay": "solar_bay", "3DMark Steel Nomad Light": "steel_nomad_light"}
# DXOMARK's public list (flat fields) -> the site's metrics, as recorded in data/benchmarks/dxomark-scores.json
DXO_FIELDS = {"dxomark_camera_v5": "camerav5", "dxomark_camera": "camerav6", "dxomark_display": "displayv2",
              "dxomark_battery": "batteryv1_5", "dxomark_audio": "audiov2"}
DXO_LIST = "https://www.dxomark.com/dakdata/webservices/public/smartphones"
ANTUTU = "https://www.antutu.com/web/en/ranking"


def fetch(url: str, timeout: int = 40) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(8_000_000).decode("utf-8", "replace")


def text_lines(page: str) -> list[str]:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    return [l.strip() for l in t.split("\n") if l.strip()]


def load(name: str) -> list[dict]:
    return json.loads((BENCH / name).read_text(encoding="utf-8"))


def consider(out: dict, doc: dict, rec: dict, value, source: str) -> None:
    """Record an update, or hold it back when it moves too far."""
    if not isinstance(value, (int, float)) or value <= 0:
        return
    old = rec["value"]
    if value == old:
        out["unchanged"] += 1
        return
    change = abs(value - old) / old if old else 1.0
    row = {"doc": doc["id"], "subject": rec["subject"], "metric": rec["metric"], "value": value, "previous": old,
           "changePct": round(change * 100, 1), "source": source}
    (out["held"] if change > MAX_CHANGE else out["updates"]).append(row)


# ------------------------------------------------------------------ UL 3DMark device pages
def refresh_ul(out: dict) -> dict:
    docs = load("ul-3dmark.json")
    read = failed = 0
    for doc in docs:
        try:
            lines = text_lines(fetch(doc["url"]))
        except Exception:
            failed += 1
            continue
        finally:
            time.sleep(UL_DELAY)
        scores = {}
        for j, l in enumerate(lines):
            if l in UL_TESTS and j + 2 < len(lines) and lines[j + 1] == "Score" and re.fullmatch(r"\d+", lines[j + 2]):
                scores[UL_TESTS[l]] = int(lines[j + 2])
        if not scores:
            failed += 1
            continue
        read += 1
        out["confirmed"].append(doc["id"])
        for rec in doc["records"]:
            if rec["metric"] in scores:
                consider(out, doc, rec, scores[rec["metric"]], "ul-benchmarks")
    return {"ok": read > 0 and read >= failed, "read": read, "failed": failed}


# ------------------------------------------------------------------ AnTuTu ranking (one page)
def antutu_rows(page: str) -> list[dict]:
    L = [re.sub(r"^\|\s*", "", l) for l in text_lines(page)]
    rows = []
    for i in range(len(L) - 8):
        if not re.fullmatch(r"\d{1,3}", L[i]):
            continue
        k = next((k for k in (i + 3, i + 4) if re.fullmatch(r"\d+\+\d+", L[k])), None)
        if k:
            vals = L[k + 1:k + 6]
            if all(re.fullmatch(r"[\d,]+", v) for v in vals):
                rows.append({"name": L[i + 1], "chip": L[i + 2], "mem": L[k], "total": int(vals[4].replace(",", ""))})
    return rows


def refresh_antutu(out: dict) -> dict:
    try:
        rows = antutu_rows(fetch(ANTUTU))
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:120]}
    if len(rows) < 20:
        return {"ok": False, "error": f"only {len(rows)} rows read"}
    by_key = {(r["name"], r["chip"], r["mem"]): r for r in rows}
    matched = 0
    for doc in load("antutu-ranking.json"):
        for rec in doc["records"]:
            # the note records exactly what was matched: Listed as "NAME" (CHIP, MEM GB): ...
            m = re.match(r'Listed as "([^"]+)" \(([^,]+), ([\d+]+) GB\)', rec.get("note", ""))
            row = by_key.get((m.group(1), m.group(2), m.group(3))) if m else None
            if row:
                matched += 1
                consider(out, doc, rec, row["total"], "antutu")
        if matched:
            out["confirmed"].append(doc["id"])
    return {"ok": True, "rows": len(rows), "matched": matched}


# ------------------------------------------------------------------ DXOMARK public list (one request)
def refresh_dxomark(out: dict) -> dict:
    try:
        phones = json.loads(fetch(DXO_LIST))
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:120]}
    by_path = {p.get("productReviewURL", "").rstrip("/"): p for p in phones if isinstance(p, dict)}
    matched = 0
    for doc in load("dxomark-scores.json"):
        path = re.sub(r"^https://www\.dxomark\.com", "", doc["url"]).rstrip("/")
        phone = by_path.get(path)
        if not phone:
            continue
        matched += 1
        out["confirmed"].append(doc["id"])
        for rec in doc["records"]:
            field = DXO_FIELDS.get(rec["metric"])
            if field and phone.get(field) is not None:
                consider(out, doc, rec, phone[field], "dxomark")
    return {"ok": matched > 0, "phones": len(phones), "matched": matched}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-age-hours", type=float, default=0)
    ap.add_argument("--only", choices=["ul", "antutu", "dxomark"])
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    if args.max_age_hours and OUT.exists():
        try:
            last = dt.datetime.fromisoformat(json.loads(OUT.read_text(encoding="utf-8"))["refreshedAt"])
            if now - last < dt.timedelta(hours=args.max_age_hours):
                print(f"[benchmarks] Refreshed {last:%Y-%m-%d %H:%M} UTC; nothing to do.")
                return 0
        except (ValueError, KeyError):
            pass
    out = {"refreshedAt": now.isoformat(timespec="seconds"), "maxChangePct": MAX_CHANGE * 100, "sources": {},
           "updates": [], "held": [], "unchanged": 0, "confirmed": []}
    runners = {"dxomark": refresh_dxomark, "antutu": refresh_antutu, "ul": refresh_ul}
    for name, fn in runners.items():
        if args.only and args.only != name:
            continue
        out["sources"][name] = fn(out)
        print(f"[benchmarks] {name}: {out['sources'][name]}", flush=True)
    if not any(s.get("ok") for s in out["sources"].values()):
        print("[benchmarks] No source could be read; keeping the previous refresh.")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(OUT)
    print(f"[benchmarks] {len(out['updates'])} values updated, {out['unchanged']} unchanged, {len(out['held'])} held for checking.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
