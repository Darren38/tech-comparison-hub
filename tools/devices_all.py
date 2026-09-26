"""Version 20: every device the site shows. The checked records in data/devices plus the ones added automatically from
makers' own specification pages (live/auto/new_devices.json, written by tools/auto_devices.py). Tools that read device
files (headline matching, benchmark matching, picture search and checks) use this so a new phone is treated like any
other from the moment it is added. A hand-made record with the same id always wins."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
AUTO_DEVICES = ROOT / "live" / "auto" / "new_devices.json"


def read_auto() -> dict:
    try:
        return json.loads(AUTO_DEVICES.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def data_devices(categories: tuple[str, ...] | None = None) -> list[dict]:
    out = []
    for path in sorted((DATA / "devices").glob("*/*.json")):
        if categories and path.parent.name not in categories:
            continue
        out.append(json.loads(path.read_text(encoding="utf-8")))
    return out


def auto_devices(known_ids: set[str] | None = None, categories: tuple[str, ...] | None = None) -> list[dict]:
    if known_ids is None:
        known_ids = {p.stem for p in (DATA / "devices").glob("*/*.json")}
    out = []
    for dev_id, rec in sorted((read_auto().get("devices") or {}).items()):
        if not isinstance(rec, dict) or dev_id in known_ids or rec.get("id") != dev_id:
            continue
        if categories and rec.get("category") not in categories:
            continue
        out.append(json.loads(json.dumps(rec)))
    return out


def all_devices(categories: tuple[str, ...] | None = None) -> list[dict]:
    checked = data_devices(categories)
    known = {p.stem for p in (DATA / "devices").glob("*/*.json")}
    return checked + auto_devices(known, categories)


def auto_chipsets(known_ids: set[str] | None = None) -> list[dict]:
    if known_ids is None:
        known_ids = {p.stem for p in (DATA / "chipsets").glob("*.json")}
    return [json.loads(json.dumps(c)) for cid, c in sorted((read_auto().get("chipsets") or {}).items())
            if isinstance(c, dict) and cid not in known_ids and c.get("id") == cid]
