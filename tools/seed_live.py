"""Carry the growing files over from the live site before a scheduled build (Version 17).

Each GitHub Actions run starts from the repository, where live/archive.json (about 400 days of matched headlines),
live/views.json (YouTube view counts) and live/spotted.json only change when someone pushes. Without this step every run
would start the archive again from the pushed copy and it could never grow past it. This script downloads the deployed
copies and keeps them when they are newer than the repository's, so fetch_headlines.py adds to the real archive.

It never fails the build: if the site can't be reached (first deploy, network trouble) the repository copies are used.

  python tools/seed_live.py [--base https://darren38.github.io/tech-comparison-hub/]
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIVE = ROOT / "live"
FILES = ["archive.json", "views.json", "spotted.json", "official.json"]  # official.json: Version 18
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0; +https://darren38.github.io/tech-comparison-hub/)"


def stamp(data) -> str:
    if isinstance(data, dict):
        return str(data.get("updatedAt") or data.get("fetchedAt") or "")
    return ""


def size(data) -> int:
    if isinstance(data, dict):
        for key in ("items", "models"):
            if isinstance(data.get(key), list):
                return len(data[key])
        return len(data)
    return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("SITE_URL") or "https://darren38.github.io/tech-comparison-hub/")
    base = ap.parse_args().base.rstrip("/") + "/"
    for name in FILES:
        local_path = LIVE / name
        try:
            local = json.loads(local_path.read_text(encoding="utf-8")) if local_path.exists() else None
        except ValueError:
            local = None
        try:
            req = urllib.request.Request(f"{base}live/{name}", headers={"User-Agent": UA, "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=30) as res:
                remote = json.loads(res.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - any failure keeps the repository copy
            print(f"[seed] {name}: live copy not available ({exc}); using the repository copy")
            continue
        newer = stamp(remote) > stamp(local) if local is not None else True
        # the archive only grows, so a smaller remote copy with a newer stamp still wins (old items age out)
        if newer:
            local_path.write_text(json.dumps(remote, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"[seed] {name}: using the live copy ({size(remote)} entries, {stamp(remote) or 'no date'})")
        else:
            print(f"[seed] {name}: repository copy is as new or newer; kept")


if __name__ == "__main__":
    main()
