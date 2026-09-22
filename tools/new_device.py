"""Scaffold a new device file with the right structure for its category.

    python tools/new_device.py --id vivo-x300-ultra --name "vivo X300 Ultra" --brand vivo \
        --category smartphone --chipset snapdragon-8-elite-gen-5 --announced 2026-03-30

Checks that the brand, category and chipset exist and that the id is free, then writes
data/devices/<category>/<id>.json with an empty spec block for every section the category
shows. Fill in only the values you can source; delete keys you cannot. Then run
`python tools/build.py --check`.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def spec_skeleton(category: dict) -> dict:
    """One empty object per spec group the category displays (e.g. display, battery, camera)."""
    groups: dict[str, dict] = {}
    for section in category.get("specSections", []):
        for field in section["fields"]:
            if "." in field["key"] and not field["key"].startswith("@"):  # "@announced" is a top-level field; "sensors" is text
                groups.setdefault(field["key"].split(".")[0], {})
    return groups


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--id", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--brand", required=True)
    parser.add_argument("--category", required=True)
    parser.add_argument("--chipset", required=True)
    parser.add_argument("--announced", help="YYYY-MM-DD, YYYY-MM or YYYY")
    parser.add_argument("--status", default="announced", choices=["rumored", "announced", "pre-order", "released", "discontinued"])
    parser.add_argument("--url", help="manufacturer specification page")
    args = parser.parse_args()

    problems = []
    if not ID_RE.match(args.id):
        problems.append(f"id '{args.id}' must be lower-case words joined by hyphens")
    brands = {b["id"] for b in load(DATA / "brands" / "brands.json")}
    if args.brand not in brands:
        problems.append(f"unknown brand '{args.brand}' (add it to data/brands/brands.json first)")
    category_file = DATA / "categories" / f"{args.category}.json"
    if not category_file.exists():
        problems.append(f"unknown category '{args.category}'")
    if not (DATA / "chipsets" / f"{args.chipset}.json").exists():
        problems.append(f"unknown chipset '{args.chipset}' (create data/chipsets/{args.chipset}.json first)")
    existing = {p.stem for p in (DATA / "devices").rglob("*.json")} | {p.stem for p in (DATA / "chipsets").glob("*.json")}
    if args.id in existing:
        problems.append(f"id '{args.id}' is already used by a device or chipset")
    if problems:
        for p in problems:
            print(f"  ERROR  {p}")
        return 1

    category = load(category_file)
    specs = spec_skeleton(category)
    specs.setdefault("platform", {})["chipset"] = args.chipset
    form = {"tablet": "tablet", "smartwatch": "watch"}.get(args.category, "bar")
    doc = {
        "id": args.id,
        "name": args.name,
        "brand": args.brand,
        "category": args.category,
        "form": form,
        "status": args.status,
        "announced": args.announced,
        "aliases": [],
        "summary": "",
        "highlights": [],
        "prices": [],
        "specs": specs,
        "provenance": {
            "default": {"class": "official", "source": args.brand, "url": args.url, "note": "Fill in from the manufacturer's specification page."},
            "fields": {},
        },
        "dataStatus": "compiled",
    }
    doc = {k: v for k, v in doc.items() if v is not None}
    doc["provenance"]["default"] = {k: v for k, v in doc["provenance"]["default"].items() if v is not None}
    target = DATA / "devices" / args.category / f"{args.id}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Created {target.relative_to(ROOT)}")
    print("Next: fill in the specs you can source, add evidence documents, then run  python tools/build.py --check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
