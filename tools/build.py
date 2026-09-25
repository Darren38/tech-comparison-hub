"""Data build for the Technology Comparison Hub.

Reads the human-edited source of truth in data/, validates it, aggregates the
evidence and writes compact, app-ready JSON into generated/.

    python tools/build.py            validate + compile
    python tools/build.py --check    validate only (no output written)
    python tools/build.py --strict   treat warnings as errors (use in CI)

Pipeline
    load -> validate -> derive spec records -> collect evidence records
         -> aggregate (consensus + confidence) -> stats -> compile outputs

All consensus and confidence logic lives here, in one place. The web app only
formats, scores and explains the aggregated results. See docs/METHODOLOGY.md.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "generated"
SCHEMA_VERSION = 1
NOMINAL_CELL_VOLTAGE = 3.85  # used to convert mAh to Wh when a maker lists only mAh

DOC_FOLDERS = ("reviews", "videos", "benchmarks", "news")
DOC_KINDS = {"review", "video", "benchmark", "news", "analysis", "official"}
DEVICE_STATUSES = {"rumored", "announced", "pre-order", "released", "discontinued"}
SPECIAL_SOURCES = {"platform"}  # evidence produced by this platform itself
DATE_RE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
# Manufacturer image servers an "official" device image may be shown from (hotlinked, never stored here).
OFFICIAL_IMAGE_HOSTS = {"images.samsung.com", "cdsassets.apple.com", "www.apple.com", "www.honor.com", "www-file.honor.com",
                        "consumer.huawei.com", "consumer-img.huawei.com", "i02.appmifile.com", "i01.appmifile.com", "cdn.cnbj1.fds.api.mi-img.com",
                        "www.oppo.com", "image01.oppo.com", "asia-exstatic-vivofs.vivo.com", "asia-exstatic.vivo.com", "www.iqoo.com",
                        "dlcdnwebimgs.asus.com", "global.redmagic.gg", "static2.realme.net", "image01.realme.net", "static.realme.net",
                        "www.oneplus.com", "cn-exstatic-vivofs.iqoo.com", "oasis.opstatics.com", "img.global.news.samsung.com", "static.realme.net"}
# Makers whose store runs on a shared CDN: only that maker's own folder counts (Nothing's Shopify store).
OFFICIAL_IMAGE_PREFIXES = ("https://cdn.shopify.com/s/files/1/0585/2479/5086/",)


# ----------------------------------------------------------------------------- reporting
class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.notes: list[str] = []

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def note(self, message: str) -> None:
        """Expected gaps worth knowing about; never fails a strict build."""
        self.notes.append(message)


def load_json(path: Path, report: Report):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        report.error(f"{path.relative_to(ROOT)}: invalid JSON ({exc})")
    except OSError as exc:
        report.error(f"{path.relative_to(ROOT)}: cannot read ({exc})")
    return None


def load_folder(folder: Path, report: Report) -> list[dict]:
    """Every *.json file below folder; a file may hold one object or an array of objects."""
    items: list[dict] = []
    if not folder.exists():
        return items
    for path in sorted(folder.rglob("*.json")):
        data = load_json(path, report)
        if data is None:
            continue
        for obj in data if isinstance(data, list) else [data]:
            if isinstance(obj, dict):
                obj["_file"] = str(path.relative_to(ROOT)).replace("\\", "/")
                items.append(obj)
            else:
                report.error(f"{path.relative_to(ROOT)}: expected objects, found {type(obj).__name__}")
    return items


def get_path(obj, dotted: str):
    for part in dotted.split("."):
        if not isinstance(obj, dict) or part not in obj:
            return None
        obj = obj[part]
    return obj


def strip_private(obj):
    if isinstance(obj, dict):
        return {k: strip_private(v) for k, v in obj.items() if not k.startswith("_")}
    if isinstance(obj, list):
        return [strip_private(v) for v in obj]
    return obj


def year_of(date: str | None) -> int | None:
    return int(date[:4]) if date and DATE_RE.match(date) else None


# ----------------------------------------------------------------------------- loading
class Dataset:
    def __init__(self, report: Report) -> None:
        self.report = report
        self.taxonomy = load_json(DATA / "meta" / "taxonomy.json", report) or {}
        self.currencies = load_json(DATA / "meta" / "currencies.json", report) or {}
        self.categories = {c["id"]: c for c in load_folder(DATA / "categories", report)}
        self.brands = {b["id"]: b for b in (load_json(DATA / "brands" / "brands.json", report) or [])}
        self.sources = {s["id"]: s for s in (load_json(DATA / "sources" / "sources.json", report) or [])}
        self.metrics = {m["id"]: m for m in (load_json(DATA / "metrics" / "metrics.json", report) or [])}
        self.scoring = load_json(DATA / "metrics" / "scoring.json", report) or {}
        self.chipsets = {c["id"]: c for c in load_folder(DATA / "chipsets", report)}
        self.devices = {d["id"]: d for d in load_folder(DATA / "devices", report)}
        self.documents: dict[str, dict] = {}
        for folder in DOC_FOLDERS:
            for doc in load_folder(DATA / folder, report):
                doc["_folder"] = folder
                if doc.get("id") in self.documents:
                    report.error(f"{doc['_file']}: duplicate document id '{doc.get('id')}'")
                self.documents[doc.get("id")] = doc
        self.featured = load_json(DATA / "comparisons" / "featured.json", report) or []
        self.auto = apply_auto(self)
        self.classes = {c["id"]: c for c in self.taxonomy.get("evidenceClasses", [])}
        self.facets = {f["id"] for f in self.taxonomy.get("facets", [])}

    def subject_kind(self, subject_id: str) -> str | None:
        if subject_id in self.devices:
            return "device"
        if subject_id in self.chipsets:
            return "chipset"
        return None

    def tier(self, source_id: str) -> str:
        if source_id in SPECIAL_SOURCES:
            return "A"
        return self.sources.get(source_id, {}).get("tier", "C")

    def source_name(self, source_id: str) -> str:
        if source_id == "platform":
            return "Platform analysis"
        return self.sources.get(source_id, {}).get("name", source_id)


# ----------------------------------------------------------------------------- daily automatic refresh (Version 16)
AUTO = ROOT / "live" / "auto"


_FITS: dict | None = None


def image_fit(src: str | None) -> dict | None:
    """Version 17: where the product sits inside its picture (tools/image_boxes.py), so pages can show it large."""
    global _FITS
    if _FITS is None:
        _FITS = {}
        for path in (DATA / "image_boxes.json", ROOT / "live" / "auto" / "image_boxes.json"):
            try:
                _FITS.update(json.loads(path.read_text(encoding="utf-8")).get("boxes") or {})
            except (OSError, ValueError):
                pass
    fit = _FITS.get(src or "")
    if not fit or not fit.get("ar"):
        return None
    return {k: fit[k] for k in ("bg", "ar", "box", "one", "oneAr") if fit.get(k) is not None}


AUTO_BENCH_DOCS = {
    "ul": {"source": "ul-benchmarks", "class": "database", "facets": ["gaming"], "url": "https://benchmarks.ul.com/compare/best-smartphones",
           "title": "UL 3DMark results for phones matched automatically",
           "method": "Median of all results users have submitted, read from each phone's official UL device page. The phone was found on UL's smartphone list by its exact model name and the same chip, without a person matching it."},
    "dxomark": {"source": "dxomark", "class": "measured", "facets": ["camera", "display", "battery", "audio"], "url": "https://www.dxomark.com/smartphones/",
                "title": "DXOMARK scores for phones matched automatically",
                "method": "DXOMARK's lab and field test scores from its public list, matched by the exact model name (DXOMARK names no chip, so 4G and 5G versions are never mixed). Camera protocol 5 and 6 scores are kept apart."},
    "antutu": {"source": "antutu", "class": "database", "facets": ["performance"], "url": "https://www.antutu.com/web/ranking",
               "title": "AnTuTu V11 scores for phones matched automatically",
               "method": "AnTuTu's own V11 ranking (the average of all results for each model), matched by model name and the same chip."},
    "nanoreview": {"source": "nanoreview", "class": "database", "facets": ["performance"], "url": "https://nanoreview.net",
                   "title": "Geekbench 6 averages (NanoReview) for phones matched automatically",
                   "method": "Geekbench 6 single- and multi-core averages as listed on each phone's NanoReview page, matched by the exact model name and the same chip. Read about once a week."},
}


def read_auto(name: str) -> dict | None:
    path = AUTO / name
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return None


def apply_auto(ds: "Dataset") -> dict:
    """Apply tools/refresh_benchmarks.py and tools/check_images.py results before validation, so refreshed values go
    through the same checks as hand-entered ones. An update is used only while the checked value it replaces is still
    the one in data/ (a later hand edit wins). Documents re-read successfully count as checked on the refresh day."""
    info: dict = {}
    bench = read_auto("benchmarks.json")
    if bench and bench.get("refreshedAt"):
        day = bench["refreshedAt"][:10]
        applied = 0
        for u in bench.get("updates", []):
            doc = ds.documents.get(u.get("doc"))
            rec = next((r for r in (doc or {}).get("records", []) if r.get("subject") == u.get("subject")
                        and r.get("metric") == u.get("metric") and r.get("value") == u.get("previous")), None)
            if rec is not None:
                rec["value"] = u["value"]
                rec["note"] = (rec.get("note", "") + f" Refreshed automatically on {day} (previously {u['previous']}).").strip()
                applied += 1
        confirmed = 0
        for doc_id in bench.get("confirmed", []):
            doc = ds.documents.get(doc_id)
            if doc:
                doc["accessed"] = max(doc.get("accessed") or "", day)
                doc["autoRefreshed"] = bench["refreshedAt"]
                confirmed += 1
        info["benchmarks"] = {"at": bench["refreshedAt"], "updated": applied, "held": len(bench.get("held", [])),
                              "confirmed": confirmed,
                              "sources": {k: bool(v.get("ok")) for k, v in (bench.get("sources") or {}).items()}}
    images = read_auto("images.json")
    if images and images.get("checkedAt"):
        hidden = 0
        for dev_id in (images.get("broken") or {}):
            dev = ds.devices.get(dev_id)
            if dev and dev.get("image"):
                dev["image"] = None   # the page shows the outline drawing until the picture is fixed in data/
                hidden += 1
        info["images"] = {"at": images["checkedAt"], "checked": images.get("checked", 0), "hidden": hidden}
    # Version 19: benchmark results for phones nobody matched by hand yet (tools/auto_benchmarks.py): one document per
    # source, labelled as matched automatically (exact model name and, where the source names it, the same chip).
    auto_bench = read_auto("auto_bench.json")
    if auto_bench and auto_bench.get("matches"):
        added = {}
        for source_key, matches in auto_bench["matches"].items():
            spec = AUTO_BENCH_DOCS.get(source_key)
            if not spec or not matches:
                continue
            records, devices = [], []
            for dev_id, m in sorted(matches.items()):
                if dev_id not in ds.devices:
                    continue
                listing = f'Listed as "{m.get("name")}"' + (f' ({m["chip"]}' + (f', {m["memory"]} GB' if m.get("memory") else "") + ")" if m.get("chip") else "")
                for metric, value in (m.get("values") or {}).items():
                    if metric in ds.metrics and isinstance(value, (int, float)):
                        records.append({"subject": dev_id, "metric": metric, "value": value,
                                        "note": f"{listing}. Matched automatically on {m.get('matchedAt')}; checked {m.get('checkedAt')}. {m.get('url', '')}".strip()})
                devices.append(dev_id)
            if not records:
                continue
            day = (auto_bench["sources"].get(source_key) or {}).get("at", auto_bench.get("updatedAt") or "")[:10]
            doc = {"id": f"auto-{source_key}", "kind": "benchmark", "source": spec["source"], "title": spec["title"],
                   "url": spec["url"], "accessed": day, "class": spec["class"], "devices": sorted(set(devices)),
                   "facets": spec["facets"], "method": spec["method"], "records": records, "extraction": "complete",
                   "auto": True, "_folder": "benchmarks", "_file": f"live/auto/auto_bench.json ({source_key})"}
            ds.documents[doc["id"]] = doc
            added[source_key] = len(set(devices))
        info["autoBench"] = {"at": auto_bench.get("updatedAt"), "phones": added}
    # Version 17: official pictures found automatically (tools/find_images.py) for devices with none in data/.
    # A picture the daily check lists as broken is not used; the usual picture rules are validated afterwards.
    found = read_auto("found_images.json")
    if found and found.get("found"):
        broken = set((images or {}).get("broken") or {})
        used = 0
        for dev_id, image in found["found"].items():
            dev = ds.devices.get(dev_id)
            if dev and not dev.get("image") and dev_id not in broken and isinstance(image, dict) and image.get("src"):
                dev["image"] = {k: image[k] for k in ("kind", "src", "page", "credit", "checked") if image.get(k)}
                dev["image"]["auto"] = True
                used += 1
        info["foundImages"] = {"at": found.get("searchedAt"), "used": used}
    return info


# ----------------------------------------------------------------------------- validation
def check_date(report: Report, where: str, value) -> None:
    if value is not None and not (isinstance(value, str) and DATE_RE.match(value)):
        report.error(f"{where}: date '{value}' is not YYYY, YYYY-MM or YYYY-MM-DD")


def check_source(ds: Dataset, where: str, source_id) -> None:
    if source_id and source_id not in ds.sources and source_id not in SPECIAL_SOURCES:
        ds.report.error(f"{where}: unknown source '{source_id}' (add it to data/sources/sources.json)")


def check_class(ds: Dataset, where: str, cls) -> None:
    if cls and cls not in ds.classes:
        ds.report.error(f"{where}: unknown evidence class '{cls}'")


def validate(ds: Dataset) -> None:
    r = ds.report
    rates = {c.get("code"): c.get("toMYR") for c in ds.currencies.get("currencies", [])}
    for code, rate in rates.items():
        if not isinstance(rate, (int, float)) or rate <= 0:
            r.error(f"data/meta/currencies.json: currency '{code}' needs a positive toMYR rate")
    if ds.currencies and ds.currencies.get("default") not in rates:
        r.error("data/meta/currencies.json: the default currency has no rate")
    check_date(r, "data/meta/currencies.json", ds.currencies.get("asOf"))
    feeds_file = DATA / "meta" / "live-feeds.json"
    for feed in ((load_json(feeds_file, r) or {}) if feeds_file.exists() else {}).get("feeds", []):
        label = f"data/meta/live-feeds.json feed '{feed.get('source')}'"
        check_source(ds, label, feed.get("source"))
        if feed.get("kind") not in {"news", "review", "video"}:
            r.error(f"{label}: kind must be news, review or video")
        if feed.get("channel"):  # Version 18: YouTube channels are read through the YouTube Data API by channel id
            if feed.get("kind") != "video" or not re.fullmatch(r"UC[\w-]{22}", str(feed["channel"])):
                r.error(f"{label}: channel must be a YouTube channel id (UC…) on a video feed")
        elif not str(feed.get("url", "")).startswith("https://"):
            r.error(f"{label}: url must use https")
    shared = set(ds.devices) & set(ds.chipsets)
    for dup in shared:
        r.error(f"id '{dup}' is used by both a device and a chipset; subject ids must be unique")

    for cid, chip in ds.chipsets.items():
        where = chip["_file"]
        for key in ("id", "name", "vendor"):
            if not chip.get(key):
                r.error(f"{where}: missing '{key}'")
        check_source(ds, where, chip.get("vendor"))
        check_date(r, where, chip.get("announced"))
        prov = chip.get("provenance", {})
        check_source(ds, where, (prov.get("default") or {}).get("source"))

    no_chip: list[str] = []
    for did, dev in ds.devices.items():
        where = dev["_file"]
        for key in ("id", "name", "brand", "category", "status"):
            if not dev.get(key):
                r.error(f"{where}: missing '{key}'")
        if dev.get("brand") not in ds.brands:
            r.error(f"{where}: unknown brand '{dev.get('brand')}'")
        if dev.get("category") not in ds.categories:
            r.error(f"{where}: unknown category '{dev.get('category')}'")
        if dev.get("status") not in DEVICE_STATUSES:
            r.error(f"{where}: status must be one of {sorted(DEVICE_STATUSES)}")
        chip = get_path(dev, "specs.platform.chipset")
        if chip and chip not in ds.chipsets:
            r.error(f"{where}: unknown chipset '{chip}'")
        if not chip and dev.get("category") in ("smartphone", "tablet"):
            no_chip.append(dev["id"])
        for key in ("announced", "released"):
            check_date(r, where, dev.get(key))
        prov = dev.get("provenance") or {}
        default = prov.get("default")
        if not default:
            r.error(f"{where}: missing provenance.default")
        else:
            check_source(ds, where, default.get("source"))
            check_class(ds, where, default.get("class"))
            checked = default.get("checked")
            if dev.get("dataStatus") == "checked" and not checked:
                r.warn(f"{where}: dataStatus is 'checked' but provenance.default.checked has no date")
            if checked and DATE_RE.match(checked) and len(checked) == 10:
                age = (dt.date.today() - dt.date.fromisoformat(checked)).days
                if age > STALE_AFTER_DAYS:
                    r.warn(f"{where}: specs last checked {age} days ago; re-verify against the source")
        for path, fprov in (prov.get("fields") or {}).items():
            check_source(ds, f"{where} provenance '{path}'", fprov.get("source"))
            check_class(ds, f"{where} provenance '{path}'", fprov.get("class"))
            if path == "specs.camera.rear.main.sensor":  # Version 12: the main camera's sensor size, sourced on its own
                main = next((c for c in get_path(dev, "specs.camera.rear") or [] if c.get("role") == "main"), {})
                if not main.get("sensor"):
                    r.warn(f"{where}: provenance override '{path}' points at a field with no value")
            elif path.startswith("specs.") and get_path(dev, path) is None:
                r.warn(f"{where}: provenance override '{path}' points at a field with no value")
        for p in dev.get("prices", []):
            check_source(ds, f"{where} price", p.get("source"))
            check_date(r, f"{where} price", p.get("date"))
            if p.get("accessed"):
                check_date(r, f"{where} price accessed", p.get("accessed"))
            if not isinstance(p.get("amount"), (int, float)):
                r.error(f"{where}: price amount must be a number")
            if rates and p.get("currency") not in rates:
                r.error(f"{where}: no exchange rate for currency '{p.get('currency')}' (add it to data/meta/currencies.json)")
        image = dev.get("image")
        if image:
            label = f"{where} image"
            if image.get("focus") is not None and not re.fullmatch(r"\d{1,3}% \d{1,3}%", str(image["focus"])):
                r.error(f"{label}: focus must look like '30% 50%'")
            kind = image.get("kind")
            if kind not in {"photo", "drawing", "official"}:
                r.error(f"{label}: kind must be 'photo', 'drawing' or 'official'")
            if kind == "official":
                # The maker's own product image, shown from the maker's own server and credited (never copied here).
                # A removed maker page may be cited through its Internet Archive copy; the archived URL must still be the maker's.
                src = re.sub(r"^https://web\.archive\.org/web/\d{14}im_/", "", str(image.get("src", "")))
                page = re.sub(r"^https://web\.archive\.org/web/\d{14}/", "", str(image.get("page", "")))
                host = re.sub(r"^https?://([^/]+)/.*$", r"\1", src)
                if host not in OFFICIAL_IMAGE_HOSTS and not src.startswith(OFFICIAL_IMAGE_PREFIXES):
                    r.error(f"{label}: official images must come from a manufacturer server ({', '.join(sorted(OFFICIAL_IMAGE_HOSTS))}), not '{host}'")
                if not re.match(r"https?://[^/]*((samsung|apple|honor|huawei|mi|oppo|vivo|iqoo|asus|realme|oneplus)\.com(\.cn)?|redmagic\.gg|nothing\.tech)/", page):
                    r.error(f"{label}: page must link to the manufacturer page the image was taken from")
                if not image.get("credit"):
                    r.error(f"{label}: official images need a 'credit' (the manufacturer site)")
            else:
                if not str(image.get("src", "")).startswith("https://upload.wikimedia.org/"):
                    r.error(f"{label}: src must be a Wikimedia Commons file (https://upload.wikimedia.org/...)")
                if not str(image.get("page", "")).startswith("https://commons.wikimedia.org/wiki/File:"):
                    r.error(f"{label}: page must link to the Wikimedia Commons file page")
                licence = image.get("license", "")
                if not re.fullmatch(r"CC0|Public domain|CC BY(-SA)? \d\.\d", licence):
                    r.error(f"{label}: licence '{licence}' is not one this site can reuse (CC0, public domain, CC BY, CC BY-SA)")
                if licence.startswith("CC BY") and not image.get("author"):
                    r.error(f"{label}: {licence} requires the author's name for attribution")
            if not image.get("checked"):
                r.error(f"{label}: needs a 'checked' date")
            else:
                check_date(r, label, image["checked"])
        price_regions = {p.get("region") for p in dev.get("prices", [])}
        for region, entry in (dev.get("availability") or {}).items():
            label = f"{where} availability '{region}'"
            if entry.get("status") not in AVAILABILITY_STATUSES:
                r.error(f"{label}: status must be one of {sorted(AVAILABILITY_STATUSES)}")
            if not entry.get("checked"):
                r.error(f"{label}: needs a 'checked' date")
            else:
                check_date(r, label, entry["checked"])
            check_source(ds, label, entry.get("source"))
            if region in price_regions:
                r.error(f"{label}: the device has a launch price in {region}, which contradicts an availability status")

    for doc_id, doc in ds.documents.items():
        where = f"{doc['_file']} [{doc_id}]"
        if not doc_id:
            r.error(f"{doc['_file']}: document without id")
            continue
        if doc.get("kind") not in DOC_KINDS:
            r.error(f"{where}: kind must be one of {sorted(DOC_KINDS)}")
        for key in ("title", "url", "source"):
            if not doc.get(key):
                r.error(f"{where}: missing '{key}'")
        check_source(ds, where, doc.get("source"))
        check_source(ds, where, doc.get("testedBy"))
        check_class(ds, where, doc.get("class"))
        check_date(r, where, doc.get("published"))
        for dev_id in doc.get("devices", []):
            if dev_id not in ds.devices:
                r.error(f"{where}: unknown device '{dev_id}'")
        for chip_id in doc.get("chipsets", []):
            if chip_id not in ds.chipsets:
                r.error(f"{where}: unknown chipset '{chip_id}'")
        for facet in doc.get("facets", []):
            if facet not in ds.facets:
                r.warn(f"{where}: unknown facet '{facet}'")
        for i, rec in enumerate(doc.get("records", [])):
            rwhere = f"{where} record {i + 1}"
            metric = ds.metrics.get(rec.get("metric"))
            if not metric:
                r.error(f"{rwhere}: unknown metric '{rec.get('metric')}'")
                continue
            kind = ds.subject_kind(rec.get("subject", ""))
            if not kind:
                r.error(f"{rwhere}: unknown subject '{rec.get('subject')}'")
                continue
            if not isinstance(rec.get("value"), (int, float)):
                r.error(f"{rwhere}: value must be a number")
                continue
            check_class(ds, rwhere, rec.get("class"))
            if rec.get("chip") and rec["chip"] not in ds.chipsets:
                r.error(f"{rwhere}: unknown chip '{rec['chip']}' (the chipset of the tested variant)")
            lo, hi = metric.get("plausible", [None, None])
            if lo is not None and not (lo <= rec["value"] <= hi):
                r.warn(f"{rwhere}: {metric['id']} = {rec['value']} is outside the plausible range {lo}–{hi}")
            if kind == "chipset" and metric.get("level") == "device":
                pass  # allowed: chip-level stress results from reviewers who do not name the phone
            if kind == "device" and metric.get("categories"):
                cat = ds.devices[rec["subject"]]["category"]
                if cat not in metric["categories"]:
                    r.warn(f"{rwhere}: metric '{metric['id']}' is not defined for category '{cat}'")
        for i, finding in enumerate(doc.get("findings", [])):
            if ds.subject_kind(finding.get("subject", "")) is None:
                r.error(f"{where} finding {i + 1}: unknown subject '{finding.get('subject')}'")
            if finding.get("facet") not in ds.facets:
                r.warn(f"{where} finding {i + 1}: unknown facet '{finding.get('facet')}'")
            if finding.get("stance") not in {"positive", "negative", "neutral"}:
                r.error(f"{where} finding {i + 1}: stance must be positive, negative or neutral")

    profiles = {p["id"] for p in ds.scoring.get("profiles", [])}
    for comp in ds.featured:
        for dev_id in comp.get("devices", []):
            if dev_id not in ds.devices:
                r.error(f"data/comparisons/featured.json [{comp.get('id')}]: unknown device '{dev_id}'")
        if comp.get("profile") and comp["profile"] not in profiles:
            r.error(f"data/comparisons/featured.json [{comp.get('id')}]: unknown profile '{comp['profile']}'")

    score_metric_ids = set()
    for cat in ds.scoring.get("categories", []):
        for items in cat.get("metrics", {}).values():
            for item in items:
                score_metric_ids.update(item.get("alt", [item.get("id")]))
    for mid in score_metric_ids:
        if mid not in ds.metrics:
            r.error(f"data/metrics/scoring.json: unknown metric '{mid}'")
    # Makers do not always name the chip (Samsung's Malaysian spec data rarely does); a gap, not a data error.
    # Wearables are not listed: their makers seldom publish the chip at all.
    if no_chip:
        r.note(f"{len(no_chip)} phone(s)/tablet(s) have no chipset recorded: {', '.join(sorted(no_chip))}")


# ----------------------------------------------------------------------------- spec-derived records
def field_provenance(entity: dict, path: str) -> dict:
    """Most specific provenance override for a dotted path, falling back to the default."""
    prov = entity.get("provenance") or {}
    fields = prov.get("fields") or {}
    parts = path.split(".")
    for end in range(len(parts), 0, -1):
        key = ".".join(parts[:end])
        if key in fields:
            return {**(prov.get("default") or {}), **fields[key]}
    return prov.get("default") or {}


IP_LEVELS = [("IP69", 100), ("IP68", 90), ("IPX8", 70), ("IP67", 75), ("IP66", 60), ("IP65", 60), ("IP54", 40), ("IP53", 35)]


def transform_ip(value) -> float | None:
    if not isinstance(value, str):
        return None
    text = value.upper()
    if "IP69" in text and "IP68" in text:
        return 100.0
    for code, level in IP_LEVELS:
        if code in text:
            return float(level)
    return None


def transform_main_sensor(rear) -> float | None:
    if not isinstance(rear, list):
        return None
    main = next((c for c in rear if c.get("role") == "main"), None)
    sensor = (main or {}).get("sensor")
    if not sensor:
        return None
    match = re.match(r'^\s*1\s*/\s*([\d.]+)', sensor)
    if match:
        return round(1 / float(match.group(1)), 3)
    if re.match(r'^\s*1\s*"', sensor) or sensor.strip() in {"1-inch", "1 inch"}:
        return 1.0
    return None


TRANSFORMS = {"ip_level": transform_ip, "main_sensor": transform_main_sensor}


def derive_spec_records(ds: Dataset) -> list[dict]:
    records = []
    for dev in ds.devices.values():
        for metric in ds.metrics.values():
            derive = metric.get("derive")
            if not derive:
                continue
            if metric.get("categories") and dev["category"] not in metric["categories"]:
                continue
            path = "specs." + derive["path"]
            raw = get_path(dev, path)
            value = TRANSFORMS[derive["transform"]](raw) if derive.get("transform") else raw
            # the main camera's sensor size can come from a different source than the rest of the camera list
            # (Version 12: "specs.camera.rear.main.sensor", e.g. DXOMARK where the maker states none)
            prov = field_provenance(dev, path + ".main.sensor" if derive.get("transform") == "main_sensor" else path)
            cls = prov.get("class", "official")
            note = prov.get("note")
            if derive.get("transform"):
                cls = "platform" if cls == "official" else cls
                note = f"Platform scale derived from '{raw}'." if raw is not None else note
            if value is None and derive.get("fallback") == "mah_to_wh":
                mah = get_path(dev, "specs.battery.capacity_mah")
                if mah:
                    value = round(mah * NOMINAL_CELL_VOLTAGE / 1000, 1)
                    cls = "platform"
                    note = f"Converted from {mah:,} mAh at a {NOMINAL_CELL_VOLTAGE} V nominal cell voltage."
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                continue
            records.append({
                "subject": dev["id"],
                "metric": metric["id"],
                "value": value,
                "class": cls,
                "source": prov.get("source") or dev["brand"],
                "origin": prov.get("source") or dev["brand"],
                "doc": f"spec:{dev['id']}",
                "url": prov.get("url"),
                "date": dev.get("announced"),
                "note": note,
                "spec": True,
            })
    return records


# ----------------------------------------------------------------------------- evidence collection
def collect_records(ds: Dataset) -> list[dict]:
    records = derive_spec_records(ds)
    for doc in ds.documents.values():
        for rec in doc.get("records", []):
            if rec.get("metric") not in ds.metrics or ds.subject_kind(rec.get("subject", "")) is None:
                continue
            origin = rec.get("testedBy") or doc.get("testedBy") or doc["source"]
            if rec.get("class") == "platform":
                origin = f"{origin}"  # derived from this origin's own measurements
            records.append({
                "subject": rec["subject"],
                "metric": rec["metric"],
                "value": rec["value"],
                "class": rec.get("class") or doc.get("class") or "database",
                "source": doc["source"],
                "origin": origin,
                "doc": doc["id"],
                "url": rec.get("url") or doc.get("url"),
                "date": doc.get("published"),
                "dateApprox": doc.get("publishedApprox", False),
                "note": rec.get("note"),
                "variant": rec.get("variant"),
                "chip": rec.get("chip"),
                "flags": rec.get("flags", []),
                "derived": rec.get("derived"),
                "excerpt": doc.get("verification") == "excerpt",
            })
    return records


# ----------------------------------------------------------------------------- aggregation
CLASS_RANK = {"measured": 6, "database": 5, "platform": 4, "official": 3, "reviewer": 2, "news": 2, "community": 1, "estimated": 0}
LEVEL_RANK = {"low": 0, "medium": 1, "high": 2}


def cap(level: str, ceiling: str) -> str:
    return level if LEVEL_RANK[level] <= LEVEL_RANK[ceiling] else ceiling


def confidence_for(ds: Dataset, origins: list[dict], records: list[dict]) -> tuple[str, str]:
    classes = {r["class"] for r in records}
    if classes <= {"official"}:
        return "high", "Official specification"
    if classes <= {"official", "platform"} and all(r.get("spec") for r in records):
        return "high", "Calculated from official specifications"
    if classes <= {"estimated"}:
        return "low", "Estimate: no manufacturer commitment or independent measurement"
    independent = [o for o in origins if o["class"] not in {"estimated", "community"}]
    n = len(independent)
    values = [o["value"] for o in independent] or [o["value"] for o in origins]
    mid = statistics.median(values)
    spread = (max(values) - min(values)) / mid if mid else 0.0
    strong = [o for o in independent
              if ds.tier(o["origin"]) == "A" and o["class"] in {"measured", "database", "platform"} and not o["excerpt"]]
    names = ", ".join(ds.source_name(o["origin"]) for o in independent[:3])
    if all("pre-release" in r.get("flags", []) for r in records):
        return "low", f"Pre-release listings only ({names})"
    if n >= 3 and spread <= 0.10:
        level, why = "high", f"{n} independent sources agree within {spread:.0%}"
    elif n >= 2 and spread <= 0.12 and strong:
        level, why = "high", f"{n} independent sources agree within {spread:.0%} ({names})"
    elif n >= 2 and spread <= 0.25:
        level, why = "medium", f"{n} sources, values differ by up to {spread:.0%} ({names})"
    elif n >= 2:
        level, why = "low", f"Sources disagree by {spread:.0%} ({names})"
    elif n == 1 and strong:
        level, why = "medium", f"Single lab measurement ({names})"
    else:
        level, why = "low", f"Single secondary source ({names or 'unrated'})"
    if any("early-software" in r.get("flags", []) for r in records):
        level, why = cap(level, "medium"), why + "; early software"
    return level, why


def summarise(ds: Dataset, records: list[dict]) -> dict:
    """Group records by independent origin and compute the consensus value."""
    by_origin: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        by_origin[rec["origin"]].append(rec)
    origins = []
    for origin, recs in by_origin.items():
        best_class = max((r["class"] for r in recs), key=lambda c: CLASS_RANK.get(c, 0))
        origins.append({
            "origin": origin,
            "name": ds.source_name(origin),
            "tier": ds.tier(origin),
            "class": best_class,
            "value": statistics.median(r["value"] for r in recs),
            "excerpt": all(r.get("excerpt") for r in recs),
            "records": [public_record(r) for r in sorted(recs, key=lambda r: r.get("date") or "", reverse=True)],
        })
    origins.sort(key=lambda o: (-CLASS_RANK.get(o["class"], 0), o["name"]))
    counted = [o for o in origins if o["class"] not in {"estimated", "community"}] or origins
    values = [o["value"] for o in counted]
    consensus = statistics.median(values)
    level, why = confidence_for(ds, origins, records)
    return {
        "value": round(consensus, 3),
        "range": [min(values), max(values)],
        "n": len(counted),
        "spread": round((max(values) - min(values)) / consensus, 3) if consensus else 0,
        "confidence": level,
        "why": why,
        "classes": sorted({o["class"] for o in origins}),
        "origins": origins,
    }


def public_record(rec: dict) -> dict:
    keep = ("doc", "value", "class", "source", "url", "date", "dateApprox", "note", "variant", "chip", "flags", "derived", "excerpt", "subject", "spec")
    return {k: rec[k] for k in keep if rec.get(k) not in (None, [], False)}


def aggregate(ds: Dataset, records: list[dict]):
    """Return (device_metrics, chipset_metrics, implementations, document_tests)."""
    global_recs: dict[tuple[str, str], list[dict]] = defaultdict(list)
    doc_tests: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        metric = ds.metrics[rec["metric"]]
        if metric.get("comparability") == "document":
            doc_tests[rec["doc"]].append(rec)
        else:
            global_recs[(rec["subject"], rec["metric"])].append(rec)

    chipset_of = {d["id"]: get_path(d, "specs.platform.chipset") for d in ds.devices.values()}

    # A result from another chip variant of a phone (a Snapdragon Galaxy where the site records the Malaysian Exynos
    # model) is kept apart: it is shown on the phone's page under its own chip and counts towards that chip's
    # consensus, never towards the phone's own value.
    # A published result that contradicts every other test of the same hardware is flagged "disputed", with a note that
    # says why (Version 15). It stays in its document for readers but counts towards no consensus and no chipset
    # stand-in, so one misprint can't set a phone's or a chip's value.
    disputed: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for key in list(global_recs):
        kept = [r for r in global_recs[key] if "disputed" not in r.get("flags", [])]
        if len(kept) != len(global_recs[key]):
            disputed[key] = [r for r in global_recs[key] if r not in kept]
            if kept:
                global_recs[key] = kept
            else:
                del global_recs[key]

    other_variant: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for key in list(global_recs):
        subject = key[0]
        if ds.subject_kind(subject) != "device":
            continue
        own_chip = chipset_of.get(subject)
        other = [r for r in global_recs[key] if r.get("chip") and r["chip"] != own_chip]
        if other:
            other_variant[key] = other
            global_recs[key] = [r for r in global_recs[key] if r not in other]
            if not global_recs[key]:
                del global_recs[key]

    device_metrics: dict[str, dict] = defaultdict(dict)
    chipset_metrics: dict[str, dict] = defaultdict(dict)
    implementations: dict[str, dict] = defaultdict(lambda: defaultdict(list))

    for (subject, metric_id), recs in global_recs.items():
        kind = ds.subject_kind(subject)
        if kind == "device":
            device_metrics[subject][metric_id] = summarise(ds, recs)
            chip = chipset_of.get(subject)
            if chip and ds.metrics[metric_id].get("level") in {"chipset", "device"} and not recs[0].get("spec"):
                for rec in recs:
                    implementations[chip][metric_id].append({**public_record(rec), "device": subject, "origin": rec["origin"]})

    for (subject, metric_id), other in other_variant.items():
        for rec in other:
            implementations[rec["chip"]][metric_id].append({**public_record(rec), "device": subject, "origin": rec["origin"]})

    # Chipset consensus: chip-level records plus device results for phones using the chip.
    for chip_id in ds.chipsets:
        metric_ids = {m for (s, m) in global_recs if s == chip_id} | set(implementations[chip_id])
        for metric_id in metric_ids:
            if ds.metrics[metric_id].get("derive"):
                continue
            recs = list(global_recs.get((chip_id, metric_id), []))
            for dev_id, chip in chipset_of.items():
                if chip == chip_id:
                    recs += [r for r in global_recs.get((dev_id, metric_id), []) if not r.get("spec")]
            for (dev_id, m_id), other in other_variant.items():
                if m_id == metric_id:
                    recs += [r for r in other if r["chip"] == chip_id]
            if recs:
                chipset_metrics[chip_id][metric_id] = summarise(ds, recs)

    # Devices without their own result inherit chip-level metrics, flagged and capped at medium.
    for dev_id, chip in chipset_of.items():
        for metric_id, summary in chipset_metrics.get(chip, {}).items():
            metric = ds.metrics[metric_id]
            if metric.get("level") != "chipset" or metric_id in device_metrics.get(dev_id, {}):
                continue
            inherited = {k: v for k, v in summary.items() if k != "origins"}
            inherited["inherited"] = chip
            inherited["confidence"] = cap(summary["confidence"], "medium")
            inherited["why"] = f"Chipset result ({ds.chipsets[chip]['name']}); this phone's own result may differ. {summary['why']}"
            inherited["origins"] = []
            device_metrics[dev_id][metric_id] = inherited

    # disputed results are listed under the value they were left out of, with the reason
    for (subject, metric_id), recs in disputed.items():
        target = (device_metrics if ds.subject_kind(subject) == "device" else chipset_metrics).get(subject, {}).get(metric_id)
        if target is not None:
            target["disputed"] = [{**public_record(r), "origin": r["origin"]} for r in recs]

    for (subject, metric_id), other in other_variant.items():
        target = device_metrics[subject].get(metric_id)
        if target is None:
            continue   # nothing to attach to; the result still counts for its own chip
        groups = defaultdict(list)
        for rec in other:
            groups[rec["chip"]].append(rec)
        target["otherVariants"] = [{"chip": chip, "chipName": ds.chipsets[chip]["name"], **summarise(ds, recs)}
                                   for chip, recs in sorted(groups.items())]

    return device_metrics, chipset_metrics, implementations, doc_tests


def metric_stats(ds: Dataset, device_metrics: dict, chipset_metrics: dict) -> dict:
    stats: dict[str, dict] = defaultdict(dict)
    buckets: dict[tuple[str, str], list[float]] = defaultdict(list)
    for dev_id, metrics in device_metrics.items():
        cat = ds.devices[dev_id]["category"]
        for metric_id, summary in metrics.items():
            buckets[(cat, metric_id)].append(summary["value"])
    for metric_ids in chipset_metrics.values():
        for metric_id, summary in metric_ids.items():
            buckets[("chipset", metric_id)].append(summary["value"])
    for (group, metric_id), values in buckets.items():
        stats[group][metric_id] = {"max": max(values), "min": min(values), "median": statistics.median(values), "n": len(values)}
    return stats


# ----------------------------------------------------------------------------- compile helpers
def os_family(dev: dict) -> str | None:
    text = (get_path(dev, "specs.software.launch_os") or "").lower()
    # Android skins (ColorOS, Funtouch, OriginOS, MagicOS, HyperOS, MIUI, One UI) count as Android. Huawei's EMUI is
    # Android-based but ships without Google services, so it is its own family.
    for needle, family in (("ipados", "iPadOS"), ("watchos", "watchOS"), ("wear os", "Wear OS"), ("ios", "iOS"),
                           ("harmonyos", "HarmonyOS"), ("emui", "EMUI"), ("android", "Android"), ("coloros", "Android"),
                           ("funtouch", "Android"), ("originos", "Android"), ("origin os", "Android"), ("magicos", "Android"),
                           ("hyperos", "Android"), ("miui", "Android"), ("one ui", "Android")):
        if needle in text:
            return family
    return None


def max_of(value):
    if isinstance(value, list):
        nums = [v for v in value if isinstance(v, (int, float))]
        return max(nums) if nums else None
    return value if isinstance(value, (int, float)) else None


def price_myr(ds: Dataset, dev: dict) -> float | None:
    """Lowest launch price in ringgit: a Malaysian price if recorded, otherwise a conversion.
    Used only to find similar devices ("closest rivals"), never shown or scored."""
    prices = dev.get("prices", [])
    local = [p["amount"] for p in prices if p.get("currency") == "MYR"]
    if local:
        return min(local)
    rates = {c["code"]: c["toMYR"] for c in (ds.currencies or {}).get("currencies", [])}
    converted = [p["amount"] * rates[p["currency"]] for p in prices if p.get("currency") in rates]
    return min(converted) if converted else None


# Why a device has no launch price in a region: a source says it isn't sold there, no launch was
# found, or the brand lists it there but no verified price was found.
AVAILABILITY_STATUSES = {"not-launched", "not-found", "price-not-found"}


def sold_in(dev: dict, region: str) -> bool:
    """A launch price is recorded for the region, or the brand lists the device there without one."""
    status = ((dev.get("availability") or {}).get(region) or {}).get("status")
    return any(p.get("region") == region for p in dev.get("prices", [])) or status == "price-not-found"


# Flagship models (Version 14): each brand's top line, by model name. The site's rankings, charts and home page lead
# with these; the Devices filter "Flagship models" uses the same rule.
FLAGSHIP_NAMES = [re.compile(p) for p in (
    r'^Galaxy S\d+( Ultra| Plus|\+)?$', r'^Galaxy Z (Fold|Flip)\d+( Ultra)?$',
    r'^iPhone \d+( Plus| Pro| Pro Max)?$', r'^iPhone (Air|Duo)$',
    r'^(Xiaomi )?\d+( Ultra| Pro| Pro Max)?$', r'^(Xiaomi )?\d+T Pro$', r'^Leica Leitzphone',
    r'^(OPPO )?Find (X\d+( Pro| Ultra|s)?|N\d+)$', r'^(vivo )?X\d+( Pro| Ultra)?$', r'^(vivo )?X Fold\d*',
    r'^(HONOR )?Magic\d+( Pro| Ultra| RSR Porsche Design)?$', r'^(HONOR )?Magic V\d+', r'^(HONOR )?Magic\d+ RSR',
    r'^(Huawei )?Mate \d+( Pro| Pro\+| RS)?', r'^(Huawei )?Mate X', r'^(Huawei )?Pura \d+s?( Pro| Ultra| Pro Max)?$',
    r'^(OnePlus )?\d+( Pro)?$', r'^(Google )?Pixel \d+( Pro| Pro XL| Pro Fold)?$',
    r'^iQOO \d+( Pro)?$', r'^REDMAGIC \d+ Pro', r'^(realme )?GT \d+ Pro$', r'^POCO F\d+ (Pro|Ultra)$',
    r'^(Sony )?Xperia 1 ', r'^(Motorola )?(razr ultra|Signature)', r'^(Nothing )?Phone \(\d\)$', r'^(ASUS )?ROG Phone \d+ Pro',
)]


def is_flagship(dev: dict) -> bool:
    if dev.get("category") != "smartphone":
        return False
    if dev.get("segment") == "flagship":
        return True
    name = dev.get("name", "")
    return any(p.match(name) for p in FLAGSHIP_NAMES)


def anc_of(value) -> bool | None:
    """Earbuds' noise cancelling field: text such as "Yes, adaptive" / "No" (or a boolean)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    return not str(value).strip().lower().startswith(("no", "none", "not"))


def wireless_case(value) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    return not str(value).strip().lower().startswith(("no", "none", "not"))


def filter_fields(ds: Dataset, dev: dict, has_tests: bool) -> dict:
    s = dev.get("specs", {})
    rear = get_path(s, "camera.rear") or []
    ip_text = get_path(s, "build.ip") or ""
    chip = ds.chipsets.get(get_path(s, "platform.chipset") or "", {})
    cellular = get_path(s, "connectivity.cellular") or ""
    fields = {
        "brand": dev["brand"],
        "year": year_of(dev.get("released")) or year_of(dev.get("announced")),
        "form": dev.get("form"),
        "chipset": chip.get("id"),
        "chipsetVendor": ds.source_name(chip["vendor"]) if chip else None,
        "osFamily": os_family(dev),
        "ramMax": max_of(get_path(s, "memory.ram_gb")),
        "storageMax": max_of(get_path(s, "memory.storage_gb")),
        "displayIn": get_path(s, "display.size_in"),
        "refreshHz": get_path(s, "display.refresh_hz"),
        "batteryMah": get_path(s, "battery.capacity_mah"),
        "batteryWh": get_path(s, "battery.capacity_wh"),
        "batteryLifeH": get_path(s, "battery.life_h"),
        "wiredW": get_path(s, "charging.wired_w"),
        "wireless": (get_path(s, "charging.wireless_w") or 0) > 0 if get_path(s, "charging.wireless_w") is not None else None,
        "mainMp": next((c.get("mp") for c in rear if c.get("role") == "main"), None),
        "telephoto": any(c.get("role") in {"telephoto", "periscope"} for c in rear) if rear else None,
        "zoomX": get_path(s, "camera.zoom_optical_x"),
        "ip": sorted(set(re.findall(r"IP[0-9X]{2}K?", ip_text.upper()))) or None,
        "g5": "5G" in cellular if cellular else None,
        "cellular": bool(cellular) if dev["category"] == "smartwatch" else None,
        "satellite": get_path(s, "connectivity.satellite"),
        "waterM": get_path(s, "build.water_m"),
        "weightG": get_path(s, "build.weight_g"),
        "stylus": bool(get_path(s, "input.stylus")) if dev["category"] == "tablet" else None,
        "keyboard": bool(get_path(s, "input.keyboard")) if dev["category"] == "tablet" else None,
        # Version 17: earbuds
        "anc": anc_of(get_path(s, "audio.anc")) if dev["category"] == "earbuds" else None,
        "wirelessCase": wireless_case(get_path(s, "charging.wireless")) if dev["category"] == "earbuds" else None,
        "totalLifeH": get_path(s, "battery.total_h"),
        "soldMY": sold_in(dev, "MY"),
        "hasTests": has_tests,
        "flagship": is_flagship(dev) if dev["category"] == "smartphone" else None,
    }
    return {k: v for k, v in fields.items() if v is not None}


def doc_meta(doc: dict) -> dict:
    keep = ("id", "kind", "type", "source", "testedBy", "title", "url", "published", "publishedApprox", "accessed", "author",
            "class", "category", "platform", "devices", "chipsets", "facets", "summary", "region", "extraction",
            "verification", "verified", "method", "related", "auto")
    meta = {k: doc[k] for k in keep if doc.get(k) not in (None, [], "")}
    meta["folder"] = doc["_folder"]
    meta["recordCount"] = len(doc.get("records", []))
    meta["findingCount"] = len(doc.get("findings", []))
    subjects = sorted({r.get("subject") for r in doc.get("records", [])} | {f.get("subject") for f in doc.get("findings", [])})
    meta["subjects"] = [s for s in subjects if s]
    return meta


def doc_mentions(doc: dict) -> set[str]:
    ids = set(doc.get("devices", [])) | set(doc.get("chipsets", []))
    ids |= {r.get("subject") for r in doc.get("records", [])}
    ids |= {f.get("subject") for f in doc.get("findings", [])}
    return {i for i in ids if i}


def head_to_head(ds: Dataset, doc_tests: dict) -> list[dict]:
    """Document-comparable tests (e.g. one reviewer's battery rundown) with 2+ subjects."""
    tables = []
    for doc_id, recs in doc_tests.items():
        by_metric: dict[str, list[dict]] = defaultdict(list)
        for rec in recs:
            by_metric[rec["metric"]].append(rec)
        for metric_id, mrecs in by_metric.items():
            tables.append({
                "doc": doc_id,
                "metric": metric_id,
                "entries": sorted(({"subject": r["subject"], "value": r["value"], "note": r.get("note")} for r in mrecs),
                                  key=lambda e: e["value"], reverse=ds.metrics[metric_id]["better"] == "higher"),
            })
    return tables


def related_devices(ds: Dataset, dev: dict, limit: int = 4) -> list[str]:
    price = price_myr(ds, dev)
    chip = get_path(dev, "specs.platform.chipset")
    scored = []
    for other in ds.devices.values():
        if other["id"] == dev["id"] or other["category"] != dev["category"]:
            continue
        score = 0.0
        if other.get("segment") == dev.get("segment"):
            score += 2
        if get_path(other, "specs.platform.chipset") == chip:
            score += 1.5
        oprice = price_myr(ds, other)
        if price and oprice:
            score += max(0.0, 2 - abs(oprice - price) / 1000)  # RM1,000 apart costs 1 point
        score += max(0.0, 1 - abs((year_of(other.get("announced")) or 0) - (year_of(dev.get("announced")) or 0)) * 0.5)
        scored.append((score, other["id"]))
    return [i for _, i in sorted(scored, reverse=True)[:limit]]


# ----------------------------------------------------------------------------- compile
def compile_outputs(ds: Dataset, records: list[dict]) -> dict:
    device_metrics, chipset_metrics, implementations, doc_tests = aggregate(ds, records)
    stats = metric_stats(ds, device_metrics, chipset_metrics)
    h2h = head_to_head(ds, doc_tests)
    docs_by_subject: dict[str, list[str]] = defaultdict(list)
    for doc in ds.documents.values():
        for subject in doc_mentions(doc):
            docs_by_subject[subject].append(doc["id"])
    doc_index = {doc_id: doc_meta(doc) for doc_id, doc in ds.documents.items()}

    def docs_for(subject: str) -> list[dict]:
        out = []
        for doc_id in docs_by_subject.get(subject, []):
            doc = ds.documents[doc_id]
            meta = dict(doc_index[doc_id])
            meta["records"] = [r for r in doc.get("records", []) if r.get("subject") == subject]
            meta["findings"] = [f for f in doc.get("findings", []) if f.get("subject") == subject]
            out.append(meta)
        return sorted(out, key=lambda d: d.get("published") or "", reverse=True)

    devices_out, device_index = {}, []
    for dev_id, dev in ds.devices.items():
        metrics = device_metrics.get(dev_id, {})
        independent = [m for m in metrics.values() if m.get("origins") and any(o["class"] in {"measured", "database"} for o in m["origins"])]
        chip_id = get_path(dev, "specs.platform.chipset")
        chip = ds.chipsets.get(chip_id)
        tests = [t for t in h2h if any(e["subject"] == dev_id for e in t["entries"])]
        own_docs = docs_for(dev_id)
        devices_out[dev_id] = {
            "device": strip_private(dev),
            "chipset": strip_private(chip) if chip else None,
            "metrics": metrics,
            "documents": own_docs,
            "chipsetDocuments": [doc_index[d] for d in docs_by_subject.get(chip_id, []) if dev_id not in doc_mentions(ds.documents[d])] if chip_id else [],
            "headToHead": tests,
            "related": related_devices(ds, dev),
        }
        latest = max((d.get("published") or "" for d in own_docs), default="") or None
        device_index.append({
            "id": dev_id,
            "name": dev["name"],
            "brand": dev["brand"],
            "category": dev["category"],
            "series": dev.get("series"),
            "status": dev["status"],
            "segment": dev.get("segment"),
            "form": dev.get("form"),
            "announced": dev.get("announced"),
            "released": dev.get("released"),
            "aliases": dev.get("aliases", []),
            "summary": dev.get("summary"),
            "highlights": dev.get("highlights", [])[:3],
            "chipset": chip_id,
            "chipsetName": chip["name"] if chip else None,
            "prices": [{k: p[k] for k in ("currency", "amount", "region", "config", "source", "type", "date") if p.get(k) is not None} for p in dev.get("prices", [])],
            "availability": {k: v.get("status") for k, v in (dev.get("availability") or {}).items()} or None,
            "image": {k: dev["image"].get(k) for k in ("kind", "src", "page", "title", "author", "license", "licenseUrl", "credit", "focus", "auto")} | ({"fit": image_fit(dev["image"].get("src"))} if image_fit(dev["image"].get("src")) else {}) if dev.get("image") else None,
            "specs": {k: get_path(dev, "specs." + k) for k in ("display.size_in", "display.size_mm", "display.refresh_hz", "battery.capacity_mah",
                                                             "battery.capacity_wh", "battery.life_h", "charging.wired_w", "build.weight_g",
                                                             "build.water", "build.dimensions", "build.case_dimensions", "build.case_weight_g",
                                                             "battery.total_h", "audio.anc", "build.ip")
                      if get_path(dev, "specs." + k) is not None},
            "f": filter_fields(ds, dev, bool(independent)),
            "m": {mid: [s["value"], s["confidence"][0], 1 if s.get("inherited") else 0] for mid, s in metrics.items()},
            # Version 14: who measured each result (charts and rankings name their sources), and results for another
            # chip version of the phone ([chip id, value, sources]), kept apart from its own value
            "ms": {mid: [o["origin"] for o in s["origins"]] for mid, s in metrics.items()
                   if s.get("origins") and not s.get("inherited") and not ds.metrics[mid].get("derive")},
            "mv": {mid: [[v["chip"], v["value"], [o["origin"] for o in v["origins"]]] for v in s["otherVariants"]]
                   for mid, s in metrics.items() if s.get("otherVariants")},
            "flagship": is_flagship(dev),
            "docCount": len(own_docs),
            "latestEvidence": latest,
            "dataStatus": dev.get("dataStatus", "compiled"),
        })

    chipsets_out, chipset_index = {}, []
    for chip_id, chip in ds.chipsets.items():
        users = sorted([d for d in ds.devices.values() if get_path(d, "specs.platform.chipset") == chip_id],
                       key=lambda d: d.get("announced") or "", reverse=True)
        chipsets_out[chip_id] = {
            "chipset": strip_private(chip),
            "metrics": chipset_metrics.get(chip_id, {}),
            "implementations": {m: v for m, v in implementations.get(chip_id, {}).items()},
            "devices": [d["id"] for d in users],
            "documents": docs_for(chip_id),
        }
        chipset_index.append({
            "id": chip_id,
            "name": chip["name"],
            "vendor": chip["vendor"],
            "vendorName": ds.source_name(chip["vendor"]),
            "family": chip.get("family"),
            "tier": chip.get("tier"),
            "announced": chip.get("announced"),
            "aliases": chip.get("aliases", []),
            "process": (chip.get("process") or {}).get("node"),
            "cores": (chip.get("cpu") or {}).get("cores"),
            "gpu": (chip.get("gpu") or {}).get("name"),
            "summary": chip.get("summary"),
            "deviceCount": len(users),
            "m": {mid: [s["value"], s["confidence"][0], s["n"]] for mid, s in chipset_metrics.get(chip_id, {}).items()},
        })

    sources_out = {}
    record_counts: dict[str, int] = defaultdict(int)
    for rec in records:
        if not rec.get("spec"):
            record_counts[rec["origin"]] += 1
            if rec["source"] != rec["origin"]:
                record_counts[rec["source"]] += 0
    for source_id, source in ds.sources.items():
        docs = [doc_index[d["id"]] for d in ds.documents.values() if source_id in {d["source"], d.get("testedBy")}]
        spec_devices = [d["id"] for d in ds.devices.values() if (d.get("provenance", {}).get("default") or {}).get("source") == source_id]
        sources_out[source_id] = {
            "source": source,
            "documents": sorted(docs, key=lambda d: d.get("published") or "", reverse=True),
            "recordCount": record_counts.get(source_id, 0),
            "specDevices": spec_devices,
        }

    search = []
    for row in device_index:
        brand = ds.brands[row["brand"]]["name"]
        search.append({"type": "device", "id": row["id"], "title": f"{brand} {row['name']}" if not row["name"].lower().startswith(brand.lower()) else row["name"],
                       "sub": " · ".join(x for x in [ds.categories[row["category"]]["singular"], row.get("chipsetName"), (row.get("announced") or "")[:4]] if x),
                       "keys": row["aliases"] + [brand, row["name"], row.get("series") or "", row.get("chipsetName") or ""],
                       "date": row.get("announced")})
    for row in chipset_index:
        search.append({"type": "chipset", "id": row["id"], "title": row["name"],
                       "sub": " · ".join(x for x in [row["vendorName"], row.get("process"), f"{row['deviceCount']} device{'' if row['deviceCount'] == 1 else 's'}"] if x),
                       "keys": row["aliases"] + [row["vendorName"], row.get("family") or ""], "date": row.get("announced")})
    for brand in ds.brands.values():
        count = sum(1 for d in device_index if d["brand"] == brand["id"])
        search.append({"type": "brand", "id": brand["id"], "title": brand["name"], "sub": " · ".join(x for x in [f"{count} device{'' if count == 1 else 's'}", brand.get("country")] if x),
                       "keys": [brand.get("parent") or ""]})
    for meta in doc_index.values():
        typ = {"video": "video", "news": "news", "official": "news", "review": "review", "analysis": "review", "benchmark": "review"}[meta["kind"]]
        search.append({"type": typ, "id": meta["id"], "title": meta["title"], "sub": ds.source_name(meta.get("testedBy") or meta["source"]),
                       "keys": meta.get("subjects", []), "date": meta.get("published")})
    for source in ds.sources.values():
        if source.get("type") != "manufacturer":
            search.append({"type": "source", "id": source["id"], "title": source["name"], "sub": f"Source · Tier {source['tier']}", "keys": []})

    counts = {
        "devices": len(ds.devices),
        "chipsets": len(ds.chipsets),
        "brands": len(ds.brands),
        "sources": len(ds.sources),
        "documents": len(ds.documents),
        "records": sum(1 for r in records if not r.get("spec")),
        "specRecords": sum(1 for r in records if r.get("spec")),
        "findings": sum(len(d.get("findings", [])) for d in ds.documents.values()),
        "videos": sum(1 for d in ds.documents.values() if d.get("kind") == "video"),
        "news": sum(1 for d in ds.documents.values() if d.get("kind") in {"news", "official"}),
        "byCategory": {c: sum(1 for d in ds.devices.values() if d["category"] == c) for c in ds.categories},
    }
    # How current the data is: the newest date anything was read from a source, and the launch window covered.
    checked = [d.get("accessed") for d in ds.documents.values()]
    checked += [((dev.get("provenance") or {}).get("default") or {}).get("checked") for dev in ds.devices.values()]
    checked += [p.get("checked") for dev in ds.devices.values() for p in ((dev.get("provenance") or {}).get("fields") or {}).values()]
    checked += [(dev.get("image") or {}).get("checked") for dev in ds.devices.values()]
    checked += [p.get("accessed") for dev in ds.devices.values() for p in dev.get("prices", [])]
    checked += [e.get("checked") for dev in ds.devices.values() for e in (dev.get("availability") or {}).values()]
    announced = sorted(d["announced"] for d in ds.devices.values() if d.get("announced"))
    feeds_file = DATA / "meta" / "live-feeds.json"
    live_feeds = (load_json(feeds_file, ds.report) or {}) if feeds_file.exists() else {}
    data_window = {
        "asOf": max((c for c in checked if c), default=None),
        "announcedFrom": announced[0] if announced else None,
        "announcedTo": announced[-1] if announced else None,
        "ratesAsOf": (ds.currencies or {}).get("asOf"),
    }
    core = {
        "schemaVersion": SCHEMA_VERSION,
        "build": {"time": dt.datetime.now().isoformat(timespec="seconds"), "counts": counts, "warnings": len(ds.report.warnings),
                  "data": data_window, "auto": ds.auto},
        "taxonomy": ds.taxonomy,
        "currencies": ds.currencies,
        "categories": sorted((strip_private(c) for c in ds.categories.values()), key=lambda c: c.get("order", 99)),
        "brands": list(ds.brands.values()),
        "sources": list(ds.sources.values()),
        "metrics": list(ds.metrics.values()),
        "scoring": ds.scoring,
        "stats": stats,
        "featured": ds.featured,
        # Publications whose RSS headlines tools/fetch_headlines.py collects into live/headlines.json.
        "liveFeeds": [{"source": f["source"], "kind": f["kind"]} for f in live_feeds.get("feeds", [])],
    }
    return {
        "core": core,
        "coverage": coverage_report(ds, device_metrics, records),
        "devices": devices_out,
        "deviceIndex": sorted(device_index, key=lambda d: d.get("announced") or "", reverse=True),
        "chipsets": chipsets_out,
        "chipsetIndex": sorted(chipset_index, key=lambda c: c.get("announced") or "", reverse=True),
        "documents": sorted(doc_index.values(), key=lambda d: d.get("published") or "", reverse=True),
        "sources": sources_out,
        "search": search,
        "headToHead": h2h,
    }


# ----------------------------------------------------------------------------- coverage report
# The measurements buyers ask about most, per category. A device missing them is a testing gap.
KEY_METRICS = {
    "smartphone": ["gsma_active_use", "charge_full", "nits_auto", "wle_stability", "gb6_single", "gb6_multi"],
    "tablet": ["gb6_single", "gb6_multi"],
    "smartwatch": [],
    "band": [],
    "earbuds": [],
}
STALE_AFTER_DAYS = 365


def coverage_report(ds: Dataset, device_metrics: dict, records: list[dict]) -> dict:
    """What the database knows and what it does not: evidence per metric, testing gaps, source contributions."""
    measured_ids = [m["id"] for m in ds.metrics.values() if not m.get("derive") and m.get("comparability") != "document"]
    doc_counts: dict[str, dict] = defaultdict(lambda: {"documents": 0, "videos": 0, "findings": 0})
    for doc in ds.documents.values():
        for subject in doc_mentions(doc):
            counts = doc_counts[subject]
            counts["documents"] += 1
            counts["videos"] += 1 if doc.get("kind") == "video" else 0
            counts["findings"] += sum(1 for f in doc.get("findings", []) if f.get("subject") == subject)

    def split(dev_id: str) -> tuple[list[str], list[str]]:
        metrics = device_metrics.get(dev_id, {})
        direct = [m for m in measured_ids if m in metrics and not metrics[m].get("inherited")]
        inherited = [m for m in measured_ids if m in metrics and metrics[m].get("inherited")]
        return direct, inherited

    devices = []
    for dev in ds.devices.values():
        direct, inherited = split(dev["id"])
        counts = doc_counts[dev["id"]]
        devices.append({
            "id": dev["id"],
            "category": dev["category"],
            "direct": len(direct),
            "inherited": len(inherited),
            "documents": counts["documents"],
            "videos": counts["videos"],
            "findings": counts["findings"],
            "dataStatus": dev.get("dataStatus", "compiled"),
            "checked": (dev.get("provenance", {}).get("default") or {}).get("checked"),
            "keyMissing": [m for m in KEY_METRICS.get(dev["category"], []) if m not in direct],
        })

    categories = {}
    for cat_id in ds.categories:
        cat_devices = [d for d in ds.devices.values() if d["category"] == cat_id]
        rows = []
        for metric_id in measured_ids:
            metric = ds.metrics[metric_id]
            if metric.get("categories") and cat_id not in metric["categories"]:
                continue
            direct = sum(1 for d in cat_devices if metric_id in split(d["id"])[0])
            inherited = sum(1 for d in cat_devices if metric_id in split(d["id"])[1])
            if direct or inherited:
                rows.append({"id": metric_id, "direct": direct, "inherited": inherited, "none": len(cat_devices) - direct - inherited})
        rows.sort(key=lambda r: (-r["direct"], -r["inherited"]))
        categories[cat_id] = {
            "devices": len(cat_devices),
            "tested": sum(1 for d in devices if d["category"] == cat_id and d["direct"]),
            "metrics": rows,
        }

    source_records: dict[str, int] = defaultdict(int)
    for rec in records:
        if not rec.get("spec"):
            source_records[rec["origin"]] += 1
    extraction: dict[str, int] = defaultdict(int)
    for doc in ds.documents.values():
        extraction[doc.get("extraction", "unspecified")] += 1
    return {
        "categories": categories,
        "devices": sorted(devices, key=lambda d: (d["direct"], d["documents"])),
        "sources": sorted(({"id": k, "records": v} for k, v in source_records.items()), key=lambda s: -s["records"]),
        "extraction": dict(extraction),
        "excerptDocuments": sum(1 for d in ds.documents.values() if d.get("verification") == "excerpt"),
        "planned": [s["id"] for s in ds.sources.values() if s.get("status") == "planned"],
        "keyMetrics": KEY_METRICS,
        # Every device should have a Malaysian launch price or an availability.MY status saying why not.
        "malaysia": {
            "priced": sum(1 for d in ds.devices.values() if any(p.get("region") == "MY" for p in d.get("prices", []))),
            "withStatus": sorted(d["id"] for d in ds.devices.values() if (d.get("availability") or {}).get("MY")),
            "missing": sorted(d["id"] for d in ds.devices.values()
                              if not any(p.get("region") == "MY" for p in d.get("prices", []))
                              and not (d.get("availability") or {}).get("MY")),
        },
    }


def print_report(cov: dict) -> None:
    print("\n[report] Evidence coverage")
    for cat_id, cat in cov["categories"].items():
        print(f"  {cat_id:<11} {cat['tested']}/{cat['devices']} devices have independent test data")
        for row in cat["metrics"][:6]:
            print(f"      {row['id']:<18} direct {row['direct']:>3}  chipset stand-in {row['inherited']:>3}  none {row['none']:>3}")
    untested = [d["id"] for d in cov["devices"] if not d["direct"]]
    print(f"  Devices with no independent measurement ({len(untested)}): {', '.join(untested) or 'none'}")
    compiled = [d["id"] for d in cov["devices"] if d["dataStatus"] != "checked"]
    print(f"  Spec sheets pending verification ({len(compiled)}): {', '.join(compiled) or 'none'}")
    print(f"  Extraction status: {cov['extraction']}")
    my = cov.get("malaysia", {})
    missing = my.get("missing", [])
    print(f"  Malaysian prices: {my.get('priced', 0)} devices priced, {len(my.get('withStatus', []))} with an availability status; "
          f"missing both ({len(missing)}): {', '.join(missing) or 'none'}")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_outputs(out: dict) -> None:
    staging = OUT.with_name("generated.tmp")
    if staging.exists():
        shutil.rmtree(staging)
    write_json(staging / "core.json", out["core"])
    write_json(staging / "index" / "devices.json", out["deviceIndex"])
    write_json(staging / "index" / "chipsets.json", out["chipsetIndex"])
    write_json(staging / "index" / "documents.json", out["documents"])
    write_json(staging / "index" / "search.json", out["search"])
    write_json(staging / "index" / "head-to-head.json", out["headToHead"])
    write_json(staging / "index" / "coverage.json", out["coverage"])
    for dev_id, data in out["devices"].items():
        write_json(staging / "devices" / f"{dev_id}.json", data)
    for chip_id, data in out["chipsets"].items():
        write_json(staging / "chipsets" / f"{chip_id}.json", data)
    for source_id, data in out["sources"].items():
        write_json(staging / "sources" / f"{source_id}.json", data)
    # Swap in the new output only after everything was written successfully.
    if OUT.exists():
        shutil.rmtree(OUT)
    staging.rename(OUT)


# ----------------------------------------------------------------------------- entry points
def run(strict: bool = False, check_only: bool = False, quiet: bool = False, report: bool = False) -> bool:
    messages = Report()
    ds = Dataset(messages)
    validate(ds)
    ok = not messages.errors and not (strict and messages.warnings)
    if not quiet or not ok:
        for message in messages.errors:
            print(f"  ERROR    {message}")
        for message in messages.warnings:
            print(f"  warning  {message}")
        for message in messages.notes:
            print(f"  note     {message}")
    if not ok:
        print(f"[build] {len(messages.errors)} error(s), {len(messages.warnings)} warning(s). Output not written.")
        return False
    records = collect_records(ds)
    out = compile_outputs(ds, records)
    if not check_only:
        write_outputs(out)
    c = out["core"]["build"]["counts"]
    verb = "Validated" if check_only else "Built"
    print(f"[build] {verb}: {c['devices']} devices, {c['chipsets']} chipsets, {c['documents']} documents, "
          f"{c['records']} evidence records (+{c['specRecords']} from specs), {len(messages.warnings)} warning(s).")
    if report:
        print_report(out["coverage"])
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="validate only; do not write generated/")
    parser.add_argument("--strict", action="store_true", help="fail on warnings too")
    parser.add_argument("--report", action="store_true", help="print an evidence-coverage report (testing gaps)")
    args = parser.parse_args()
    return 0 if run(strict=args.strict, check_only=args.check, report=args.report) else 1


if __name__ == "__main__":
    sys.exit(main())
