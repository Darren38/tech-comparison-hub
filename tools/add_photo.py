"""Attach a freely licensed Wikimedia Commons photo (or drawing) to a device.

Looks the file up on Wikimedia Commons, checks that its licence can be reused (CC0, public domain,
CC BY or CC BY-SA), and writes the image block (500 px thumbnail URL, file page, author, licence)
into the device file. The site shows the thumbnail straight from Wikimedia and credits the author;
nothing is downloaded into this project.

Only use a file you have looked at: it must show this exact model, and it must be the uploader's own
photo or drawing (not a manufacturer press image re-uploaded under a free licence).

Usage:
    python tools/add_photo.py samsung-galaxy-s26 "File:Galaxy S26.jpg"
    python tools/add_photo.py google-pixel-10 "File:Pixel 10 front (Frost).svg" --drawing
    python tools/add_photo.py nothing-phone-3 "File:….png" --focus "30% 50%"
    python tools/add_photo.py --batch photos.json        {"device-id": "File:…", …}; add "|drawing" for drawings,
                                                         "|focus=30% 50%" to set the crop centre
    python tools/add_photo.py samsung-galaxy-s26 --remove

--focus sets which point of a wide photo stays visible when it is cropped into the small portrait
thumbnail on device cards (CSS object-position: horizontal% vertical%; the default is the centre).
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
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEVICES = ROOT / "data" / "devices"
API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "TechComparisonHub/5.0 (device photo credits)"}
FREE = re.compile(r"CC0|Public domain|CC BY(-SA)? \d\.\d")
FOCUS = re.compile(r"\d{1,3}% \d{1,3}%")


def strip_tags(value: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value or ""))).strip()


def device_path(device_id: str) -> Path:
    matches = list(DEVICES.glob(f"*/{device_id}.json"))
    if not matches:
        raise SystemExit(f"No device file for '{device_id}' in data/devices/")
    return matches[0]


def lookup(titles: list[str]) -> dict[str, dict]:
    query = urllib.parse.urlencode({"action": "query", "titles": "|".join(titles), "prop": "imageinfo",
                                    "iiprop": "url|extmetadata", "iiurlwidth": 500, "format": "json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{API}?{query}", headers=UA), timeout=30) as response:
                data = json.loads(response.read())
            break
        except urllib.error.HTTPError as exc:  # Commons rate limit: wait as asked, then retry
            if exc.code != 429 or attempt == 4:
                raise
            time.sleep(int(exc.headers.get("Retry-After") or 20))
    renamed = {n["from"]: n["to"] for n in data["query"].get("normalized", [])}
    pages = {p.get("title"): p for p in data["query"]["pages"].values()}
    out = {}
    for title in titles:
        page = pages.get(renamed.get(title, title), {})
        info = (page.get("imageinfo") or [None])[0]
        if not info:
            raise SystemExit(f"'{title}' was not found on Wikimedia Commons")
        meta = info.get("extmetadata", {})
        out[title] = {
            "thumb": re.sub(r"^https://thumb\.wikimedia\.org/", "https://upload.wikimedia.org/", info["thumburl"].split("?")[0]),
            "page": info["descriptionurl"],
            "license": strip_tags(meta.get("LicenseShortName", {}).get("value")),
            "licenseUrl": strip_tags(meta.get("LicenseUrl", {}).get("value")) or None,
            "author": strip_tags(meta.get("Artist", {}).get("value"))[:120] or None,
        }
    return out


def write_image(device_id: str, image: dict | None) -> None:
    path = device_path(device_id)
    dev = json.loads(path.read_text(encoding="utf-8"))
    dev.pop("image", None)
    out = {}
    for key, value in dev.items():
        out[key] = value
        if image and key == ("availability" if "availability" in dev else "prices"):
            out["image"] = image
    if image and "image" not in out:
        out["image"] = image
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def attach(pairs: list[tuple[str, str, bool, str | None]]) -> None:
    found = lookup([title for _, title, _, _ in pairs])
    today = dt.date.today().isoformat()
    for device_id, title, drawing, focus in pairs:
        info = found[title]
        if focus and not FOCUS.fullmatch(focus):
            raise SystemExit(f"{device_id}: focus must look like '30% 50%', not '{focus}'")
        if not FREE.fullmatch(info["license"]):
            raise SystemExit(f"{device_id}: licence '{info['license']}' of '{title}' cannot be reused here")
        if info["license"].startswith("CC BY") and not info["author"]:
            raise SystemExit(f"{device_id}: '{title}' has no author to credit")
        write_image(device_id, {
            "kind": "drawing" if drawing else "photo",
            "src": info["thumb"],
            "page": info["page"],
            "title": re.sub(r"\.(jpe?g|png|webp|svg)$", "", title.removeprefix("File:"), flags=re.I),
            "author": info["author"],
            "license": info["license"],
            "licenseUrl": info["licenseUrl"],
            **({"focus": focus} if focus else {}),
            "checked": today,
        })
        print(f"[photo] {device_id}: {title} ({info['license']}, {info['author']})")


def main() -> int:
    parser = argparse.ArgumentParser(description="Attach a Wikimedia Commons photo to a device.")
    parser.add_argument("device", nargs="?")
    parser.add_argument("file", nargs="?", help='Commons file title, e.g. "File:Galaxy S26.jpg"')
    parser.add_argument("--drawing", action="store_true", help="the file is a drawing, not a photo")
    parser.add_argument("--focus", help='crop centre for card thumbnails, e.g. "30%% 50%%"')
    parser.add_argument("--batch", type=Path, help='JSON object {"device-id": "File:…" or "File:…|drawing|focus=30%% 50%%"}')
    parser.add_argument("--remove", action="store_true", help="remove the device's image")
    args = parser.parse_args()
    if args.batch:
        mapping = json.loads(args.batch.read_text(encoding="utf-8"))
        pairs = []
        for dev, value in mapping.items():
            title, *options = value.split("|")
            focus = next((o.removeprefix("focus=") for o in options if o.startswith("focus=")), None)
            pairs.append((dev, title, "drawing" in options, focus))
        for i in range(0, len(pairs), 40):
            attach(pairs[i:i + 40])
        return 0
    if not args.device:
        parser.error("give a device id and a Commons file, or --batch")
    if args.remove:
        write_image(args.device, None)
        print(f"[photo] {args.device}: image removed")
        return 0
    if not args.file:
        parser.error("give the Commons file title")
    attach([(args.device, args.file, args.drawing, args.focus)])
    return 0


if __name__ == "__main__":
    sys.exit(main())
