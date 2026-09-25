"""Measure where the product sits inside each device picture, so the site can show it large (Version 17).

    python tools/image_boxes.py                      measure pictures not measured yet, write live/auto/image_boxes.json
    python tools/image_boxes.py --save-data          write the results into data/image_boxes.json instead (kept in git)
    python tools/image_boxes.py --max-age-hours 160  do nothing if the last run is newer than that

Makers' product pictures are renders on a white, light-grey or transparent canvas, often with wide margins, so the
phone looked small on the page. Each picture is read once (in memory only; nothing is saved or copied) and the
rectangle that holds the product is recorded as fractions of the picture, with the canvas type. The site then shows
the picture cropped to that rectangle; the picture itself still loads from the maker's server, unchanged.
Pictures with a real background (photos) get no rectangle and are shown as before.

Needs Pillow (pip install pillow).
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:  # the scheduled build keeps working without it; pictures are then shown uncropped
    print("[boxes] Pillow is not installed; skipping")
    sys.exit(0)

ROOT = Path(__file__).resolve().parent.parent
DATA_OUT = ROOT / "data" / "image_boxes.json"
AUTO_OUT = ROOT / "live" / "auto" / "image_boxes.json"
FOUND = ROOT / "live" / "auto" / "found_images.json"
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0; +https://darren38.github.io/tech-comparison-hub/)"
MAX_BYTES = 12_000_000


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load(url: str) -> Image.Image | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "image/*"})
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            return None
        img = Image.open(io.BytesIO(raw))
        img.load()
        return img
    except Exception:  # noqa: BLE001 - unreadable pictures are simply not measured
        return None


def measure(img: Image.Image) -> dict | None:
    w, h = img.size
    if w < 40 or h < 40:
        return None
    small = img.convert("RGBA")
    scale = min(1.0, 600 / max(w, h))
    if scale < 1:
        small = small.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.BILINEAR)
    sw, sh = small.size
    px = small.load()
    corners = [px[x, y] for x, y in ((1, 1), (sw - 2, 1), (1, sh - 2), (sw - 2, sh - 2))]
    if all(c[3] < 24 for c in corners):
        kind, ref = "clear", None
    else:
        solid = [c for c in corners if c[3] >= 24]
        ref = tuple(sum(c[i] for c in solid) / len(solid) for i in range(3))
        if any(max(abs(c[i] - ref[i]) for i in range(3)) > 14 for c in solid):
            return {"bg": "photo"}  # corners differ: a real background, keep the whole picture
        kind = "light" if min(ref) >= 222 else "photo"
        if kind == "photo":
            return {"bg": "photo"}

    def is_bg(p) -> bool:
        if p[3] < 24:
            return True
        return ref is not None and max(abs(p[i] - ref[i]) for i in range(3)) <= 18

    mask = Image.new("L", (sw, sh), 0)
    mp = mask.load()
    for y in range(sh):
        for x in range(sw):
            if not is_bg(px[x, y]):
                mp[x, y] = 255
    solid = mask.filter(ImageFilter.MinFilter(3))  # erode first so stray specks don't widen the box
    box = solid.getbbox()
    if not box:
        return {"bg": kind}
    pad = 0.012 * max(sw, sh)

    def frac(b):
        x0, y0, x1, y1 = b
        x0, y0 = max(0, x0 - 1 - pad), max(0, y0 - 1 - pad)
        x1, y1 = min(sw, x1 + 1 + pad), min(sh, y1 + 1 + pad)
        f = [round(x0 / sw, 4), round(y0 / sh, 4), round(x1 / sw, 4), round(y1 / sh, 4)]
        return f, round(((f[2] - f[0]) * w) / ((f[3] - f[1]) * h), 4)

    fx, ar = frac(box)
    out = {"bg": kind, "ar": ar}
    if (fx[2] - fx[0]) * (fx[3] - fx[1]) < 0.92:
        out["box"] = fx
    # Several products side by side with clear space between them (front and back, or colours): also record the
    # largest one on its own, so a to-scale outline can show one device instead of the whole row.
    x0, y0, x1, y1 = box
    filled = [solid.crop((x, y0, x + 1, y1)).getbbox() is not None for x in range(x0, x1)]
    runs, start = [], None
    for i, f in enumerate(filled + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            runs.append((x0 + start, x0 + i))
            start = None
    gap = max(2, 0.01 * sw)
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < gap:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    merged = [r for r in merged if r[1] - r[0] >= 0.06 * (x1 - x0)]
    if len(merged) > 1:
        parts = [solid.crop((a, 0, b, sh)).getbbox() for a, b in merged]
        parts = [(a + p[0], p[1], a + p[2], p[3]) for (a, _), p in zip(merged, parts) if p]
        big = max(parts, key=lambda p: (p[2] - p[0]) * (p[3] - p[1]))
        out["one"], out["oneAr"] = frac(big)
        out["parts"] = len(parts)
    return out


def device_pictures() -> list[str]:
    srcs = []
    for path in sorted((ROOT / "data" / "devices").glob("*/*.json")):
        src = (json.loads(path.read_text(encoding="utf-8")).get("image") or {}).get("src")
        if src:
            srcs.append(src)
    for image in (read_json(FOUND).get("found") or {}).values():
        if isinstance(image, dict) and image.get("src"):
            srcs.append(image["src"])
    return list(dict.fromkeys(srcs))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--save-data", action="store_true")
    ap.add_argument("--max-age-hours", type=float, default=0)
    ap.add_argument("--limit", type=int, default=800)
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    out_path = DATA_OUT if args.save_data else AUTO_OUT
    saved = read_json(out_path)
    if args.max_age_hours and saved.get("measuredAt"):
        age = (now - dt.datetime.fromisoformat(saved["measuredAt"])).total_seconds() / 3600
        if age < args.max_age_hours:
            print(f"[boxes] last run {age:.0f} h ago; skipping")
            return
    known = dict((read_json(DATA_OUT).get("boxes") or {}))
    if not args.save_data:
        known.update(saved.get("boxes") or {})
    boxes = dict(saved.get("boxes") or {})
    todo = [s for s in device_pictures() if s not in known][: args.limit]
    for i, src in enumerate(todo, 1):
        img = load(src)
        time.sleep(0.4)  # one request at a time
        result = measure(img) if img else None
        if result:
            boxes[src] = result
        print(f"[boxes] {i}/{len(todo)} {'ok ' if result else 'n/a'} {json.dumps(result) if result else ''} {src[-70:]}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"measuredAt": now.isoformat(timespec="seconds"), "boxes": boxes}, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"[boxes] {len(boxes)} pictures measured in {out_path.relative_to(ROOT)} ({len(todo)} read now)")


if __name__ == "__main__":
    main()
