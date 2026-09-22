"""Assemble reviewed Version 6 device records.

Inputs (all in this folder):
  catalog_<brand>.json          what to build
  extract_<brand>.json          specs read from the official Malaysian spec page (cache/spec_<brand>/_index.json has the URL)
  samsung_api_extract.json      Samsung specs from Samsung's spec service for Malaysian model codes (pages that render in the browser)
  manual_specs.json             reviewed specs from other official regional pages or Malaysian launch reports
  decisions_prices.json         reviewed launch prices, dates, statuses and drops (from dec_<brand>.txt via apply_decisions.py)
  extra_decisions.json          reviewed corrections (set/drop_fields/field_sources) and extra drops
  images.json                   official product image per device
Output: Version 6/data/devices/<category>/<id>.json and new data/chipsets/<id>.json. Existing files are never overwritten.
"""
import json, sys, datetime as dt
from pathlib import Path
from chips import clean_name, chip_id, vendor_of, family_of

V6 = Path(__file__).resolve().parents[2]
TODAY = dt.date.today().isoformat()
BRAND_SOURCE = {"samsung": "samsung", "apple": "apple", "oppo": "oppo", "honor": "honor", "huawei": "huawei", "vivo": "vivo", "iqoo": "iqoo",
                "xiaomi": "xiaomi", "redmi": "redmi", "poco": "poco"}
SITE_NAME = {"samsung": "Samsung Malaysia", "apple": "Apple Malaysia", "oppo": "OPPO Malaysia", "honor": "HONOR Malaysia", "huawei": "Huawei Malaysia",
             "vivo": "vivo Malaysia", "iqoo": "iQOO Malaysia", "xiaomi": "Xiaomi Malaysia", "redmi": "Xiaomi Malaysia", "poco": "Xiaomi Malaysia"}
NEWS_NAME = {"soyacincau": "SoyaCincau", "lowyat": "Lowyat.NET", "nasilemaktech": "Nasi Lemak Tech"}


def display_name(dv):
    # Same convention as the existing records: "Galaxy A56", "iPhone 17", "Apple Watch Series 11", "OPPO Find X9 Pro", "Huawei Pura 80 Ultra".
    n = dv["name"]
    if dv["brand"] == "apple" and n.startswith("Apple iPhone"): return n.replace("Apple ", "", 1)
    if dv["brand"] == "samsung": return n.replace("Samsung ", "", 1)
    for a, b in (("HUAWEI ", "Huawei "), ("REDMI ", "Redmi "), ("Poco ", "POCO "), ("Iqoo ", "iQOO "), ("Vivo ", "vivo "), ("Oppo ", "OPPO "), ("Honor ", "HONOR ")):
        if n.startswith(a): n = b + n[len(a):]
    return n


def load(name, default=None):
    p = Path(name)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def apply_path(specs, path, val):
    node = specs; parts = path.split(".")
    for p in parts[:-1]: node = node.setdefault(p, {})
    if val is None: node.pop(parts[-1], None)
    else: node[parts[-1]] = val


def main():
    dec_prices = load("decisions_prices.json", {})
    extra = load("extra_decisions.json", {})
    manual = load("manual_specs.json", {})
    sam = load("samsung_api_extract.json", {})
    images = load("images.json", {})
    existing_chips = {p.stem for p in (V6 / "data" / "chipsets").glob("*.json")}
    existing_devices = {p.stem for p in (V6 / "data" / "devices").rglob("*.json")}
    new_chips, written, skipped = {}, 0, []
    for brand in ["samsung", "apple", "oppo", "honor", "huawei", "vivo", "xiaomi"]:
        cat = load(f"catalog_{brand}.json")
        ext = load(f"extract_{brand}.json", {})
        idx = load(f"spec_index_{brand}.json", None) or load(f"cache/spec_{brand}/_index.json", {})
        for dv in cat:
            did = dv["id"]
            dec = {**dec_prices.get(did, {}), **extra.get(did, {})}
            if dec.get("drop") or did in existing_devices: continue
            official = idx.get(did, {}) if idx.get(did, {}).get("ok") and did in ext else {}
            src_name = SITE_NAME[dv["brand"]]
            # ---- specs and their default provenance
            if did in manual:
                specs = json.loads(json.dumps(manual[did]["specs"]))
                default = {**manual[did]["source"], "checked": TODAY}
            elif official:
                specs = json.loads(json.dumps(ext[did]))
                default = {"class": "official", "source": BRAND_SOURCE[dv["brand"]], "url": official["final"], "checked": TODAY,
                           "note": f"Read from {src_name}'s specification page on {TODAY}. Values were extracted automatically and reviewed; anything the page does not state is left out."}
            elif did in sam:
                specs = json.loads(json.dumps(sam[did]["specs"]))
                code = sam[did]["codes"][0]
                page = next((u for u in dv["spec"] if "/specs/" in u and idx.get(did, {}).get("status") == 200 and idx[did].get("final", "").rstrip("/") == u.rstrip("/")), None)
                default = {"class": "official", "source": "samsung", "url": page or f"https://www.samsung.com/my/support/model/{code}/", "checked": TODAY,
                           "note": f"Read from Samsung's own specification data for the Malaysian model {code} (the data samsung.com/my shows on its spec pages); "
                                   "the link goes to Samsung Malaysia's page for that model. Values were extracted automatically and reviewed."}
            else:
                skipped.append(did); continue
            fields_prov = {}
            for path, val in (dec.get("set") or {}).items(): apply_path(specs, path.removeprefix("specs."), val)
            for path in (dec.get("drop_fields") or []): apply_path(specs, path.removeprefix("specs."), None)
            for path, src in {**(manual.get(did, {}).get("field_sources") or {}), **(dec.get("field_sources") or {})}.items():
                fields_prov[path] = {**src, "checked": TODAY}
            # ---- chipset name -> id (+ minimal record for chips new to the database)
            plat = specs.get("platform", {})
            if plat.get("chipset_name"):
                name = clean_name(plat.pop("chipset_name")); cid = chip_id(name)
                chip_src = fields_prov.get("specs.platform") or default
                if cid not in existing_chips and cid not in new_chips and vendor_of(name):
                    new_chips[cid] = {"id": cid, "name": name, "vendor": vendor_of(name), **({"family": family_of(name)} if family_of(name) else {}),
                                      "summary": "Name recorded from phone makers' specification pages and launch reports. Chip details have not been compiled yet.",
                                      "provenance": {"default": {"class": chip_src["class"], "source": chip_src["source"], "url": chip_src["url"], "checked": TODAY,
                                                                 "note": f"Chip name as given for the {display_name(dv)}."}}}
                if cid in existing_chips or cid in new_chips: plat["chipset"] = cid
            if not plat: specs.pop("platform", None)
            for k in [k for k, v in specs.items() if not v]: specs.pop(k)
            rec = {"id": did, "name": dec.get("name", display_name(dv)), "brand": dv["brand"], "category": dv["category"],
                   "series": dv.get("series"), "form": dv["form"], "status": dec.get("status", "released")}
            if not rec["series"]: rec.pop("series")
            if dec.get("announced"):
                rec["announced"] = dec["announced"]
                a = dec.get("announced_source")
                if a:
                    fields_prov["announced"] = {"class": "news", "source": a["site"], "url": a["url"], "checked": TODAY,
                                                "note": dec.get("announced_note") or f"Date of the first Malaysian launch report found ({NEWS_NAME[a['site']]}). The global announcement can be earlier."}
            prices = [{"region": "MY", "currency": "MYR", "amount": p["rm"], **({"config": p["config"]} if p.get("config") else {}),
                       "date": p["date"], "type": "launch", "source": p["site"], "url": p["url"], "class": "news", "accessed": TODAY,
                       **({"note": p["note"]} if p.get("note") else {})} for p in dec.get("prices", [])]
            if prices: rec["prices"] = prices
            elif rec["status"] in ("announced", "pre-order"):
                pass
            else:
                url = official.get("final") if official else default["url"]
                src = BRAND_SOURCE[dv["brand"]] if default["class"] == "official" else default["source"]
                rec["availability"] = {"MY": {"status": "price-not-found", "checked": TODAY, "source": src, "url": url,
                                              "note": "Sold in Malaysia, but no launch price was found in Malaysian launch coverage."}}
            if images.get(did): rec["image"] = images[did]
            rec["specs"] = specs
            rec["provenance"] = {"default": default, "fields": fields_prov}
            rec["dataStatus"] = "compiled"
            out = V6 / "data" / "devices" / dv["category"] / f"{did}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(rec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            written += 1
    for cid, ch in new_chips.items():
        (V6 / "data" / "chipsets" / f"{cid}.json").write_text(json.dumps(ch, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {written} devices, {len(new_chips)} new chipsets; no specs for: {' '.join(skipped) or 'none'}")


if __name__ == "__main__":
    main()
