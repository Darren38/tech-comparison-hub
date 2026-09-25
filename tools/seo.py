"""Search-engine pages for the hub (Version 17).

The hub itself is a single-page app whose addresses look like  #/device/<id> . Search engines ignore everything after
"#", so on their own they only ever see the home page. This script writes, next to the app:

  d/<device-id>/index.html    a real, readable page per device: summary, key specifications, Malaysian launch price and
                              the sources, with a button that opens the full interactive page
  c/<chip-id>/index.html      the same for each chipset
  sitemap.xml                 every page above, so Google can find them
  robots.txt                  allows everything and names the sitemap

Everything comes from generated/ (run tools/build.py first). Nothing is invented: values are the same ones the app shows.
No ratings, reviews or offers are claimed in the structured data.

  python tools/seo.py --out _site [--base https://darren38.github.io/tech-comparison-hub/]
The base URL can also come from the SITE_URL environment variable.
"""
from __future__ import annotations

import argparse
import html
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "generated"
DEFAULT_BASE = "https://darren38.github.io/tech-comparison-hub/"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def get(obj, dotted: str):
    cur = obj
    for part in dotted.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def num(v, digits=None):
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, (int, float)):
        if digits is None:
            digits = 0 if float(v).is_integer() else 2
        text = f"{v:,.{digits}f}"
        return text.rstrip("0").rstrip(".") if "." in text else text
    return str(v)


def fmt(field: dict, value) -> str | None:
    """Plain-text version of components.js fmtSpec for the static pages."""
    if value is None or value == "" or value == [] or value == {}:
        return None
    kind = field.get("type")
    unit = field.get("unit")
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if kind == "dimensions" and isinstance(value, dict):
        dims = [value.get("height_mm"), value.get("width_mm"), value.get("depth_mm")]
        if not all(dims[:2]):
            return None
        return " × ".join(num(x) for x in dims if x) + " mm"
    if kind == "storage":
        vals = value if isinstance(value, list) else [value]
        return " / ".join(f"{int(v / 1024)} TB" if isinstance(v, (int, float)) and v >= 1024 else f"{num(v)} GB" for v in vals)
    if kind == "cameras" and isinstance(value, list):
        return "; ".join(f"{num(c['mp'])} MP {c.get('role', '')}".strip() if c.get("mp") else c.get("role", "") for c in value if isinstance(c, dict))
    if isinstance(value, list):
        text = " / ".join(num(v) if not isinstance(v, dict) else json.dumps(v, ensure_ascii=False) for v in value)
        return f"{text} {unit}" if unit and unit != "x" else text
    if isinstance(value, dict):
        return None
    if kind == "number" or isinstance(value, (int, float)):
        text = num(value)
        return f"{text}×" if unit == "x" else f"{text} {unit}" if unit else text
    return str(value)


def page(base: str, path: str, title: str, description: str, body: str, jsonld: dict, image: str | None = None) -> str:
    url = base + path
    og_image = f'<meta property="og:image" content="{esc(image)}" />' if image else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}" />
<link rel="canonical" href="{esc(url)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Tech Comparison Hub" />
<meta property="og:title" content="{esc(title)}" />
<meta property="og:description" content="{esc(description)}" />
<meta property="og:url" content="{esc(url)}" />
{og_image}
<meta name="color-scheme" content="light dark" />
<link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="../../assets/css/tokens.css" />
<link rel="stylesheet" href="../../assets/css/base.css" />
<style>
  body {{ margin: 0; }}
  .seo {{ max-width: 920px; margin: 0 auto; padding: 24px 16px 56px; }}
  .seo header {{ display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }}
  .seo img {{ width: 150px; height: 150px; object-fit: contain; background: var(--surface-2, #f6f5f1); border-radius: 12px; }}
  .seo h1 {{ margin: 6px 0; font-size: clamp(26px, 5vw, 40px); line-height: 1.1; }}
  .seo .crumbs, .seo .muted {{ color: var(--muted, #666); font-size: 14px; }}
  .seo .cta {{ display: inline-block; margin: 14px 0; padding: 10px 16px; border-radius: 10px; background: var(--ink, #111); color: var(--bg, #fff); text-decoration: none; font-weight: 700; }}
  .seo table {{ width: 100%; border-collapse: collapse; margin: 8px 0 20px; font-size: 15px; }}
  .seo th, .seo td {{ text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--rule, #e5e2da); vertical-align: top; }}
  .seo th {{ width: 36%; font-weight: 600; color: var(--ink-2, #333); }}
  .seo h2 {{ margin-top: 28px; font-size: 20px; }}
  .seo ul {{ padding-left: 18px; }}
  .seo li {{ margin: 4px 0; }}
</style>
<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>
</head>
<body>
<main class="seo">
{body}
<p class="muted">Tech Comparison Hub is an independent, evidence-first comparison site for devices sold in Malaysia. Every value is
attributed to its source; the interactive page adds tests, reviewer findings, news, scores and a to-scale size view.</p>
</main>
</body>
</html>
"""


def device_page(base: str, core: dict, row: dict, full: dict, brands: dict, sources: dict, categories: dict) -> tuple[str, str]:
    dev = full["device"]
    cat = categories.get(dev["category"], {})
    brand = brands.get(dev["brand"], {}).get("name", dev["brand"])
    name = dev["name"] if brand.lower() in dev["name"].lower() else f"{brand} {dev['name']}"
    summary = row.get("summary") or dev.get("summary") or ""
    year = (dev.get("announced") or "")[:4]
    my_prices = [p for p in (dev.get("prices") or []) if p.get("currency") == "MYR"]
    lowest = min((p["amount"] for p in my_prices), default=None)
    desc_bits = [summary] if summary else []
    if lowest:
        desc_bits.append(f"Malaysian launch price from RM{lowest:,.0f}.")
    desc_bits.append("Specifications, tests and sources, compared side by side.")
    description = " ".join(desc_bits)[:300]
    title = f"{name}: specs, price in Malaysia and tests | Tech Comparison Hub"

    rows = []
    for section in cat.get("specSections", []):
        cells = []
        for field in section.get("fields", []):
            text = fmt(field, get(dev.get("specs", {}), field["key"]) if not field["key"].startswith("@") else dev.get(field["key"][1:]))
            if text:
                cells.append(f"<tr><th scope=\"row\">{esc(field['label'])}</th><td>{esc(text)}</td></tr>")
        if cells:
            rows.append(f"<h2>{esc(section['label'])}</h2><table><tbody>{''.join(cells)}</tbody></table>")

    price_html = ""
    if my_prices:
        items = "".join(
            f"<li>RM{p['amount']:,.0f}{' · ' + esc(p['config']) if p.get('config') else ''} ({esc(p.get('date', ''))}){' · ' + esc(sources.get(p.get('source'), {}).get('name', p.get('source', ''))) if p.get('source') else ''}</li>"
            for p in my_prices)
        price_html = f"<h2>Price in Malaysia</h2><ul>{items}</ul>"

    src_items = []
    seen = set()
    default = (dev.get("provenance") or {}).get("default") or {}
    for p in [default, *((dev.get("provenance") or {}).get("fields") or {}).values()]:
        if p.get("url") and p["url"] not in seen:
            seen.add(p["url"])
            src_items.append(f"<li><a href=\"{esc(p['url'])}\" rel=\"nofollow noopener\">{esc(sources.get(p.get('source'), {}).get('name', p.get('source', 'Source')))}</a>{' · ' + esc(p['note']) if p.get('note') else ''}</li>")
    for doc in full.get("documents", [])[:12]:
        if doc.get("url") and doc["url"] not in seen:
            seen.add(doc["url"])
            src_items.append(f"<li><a href=\"{esc(doc['url'])}\" rel=\"nofollow noopener\">{esc(doc.get('title', 'Document'))}</a> · {esc(sources.get(doc.get('source'), {}).get('name', doc.get('source', '')))}</li>")
    sources_html = f"<h2>Sources</h2><ul>{''.join(src_items)}</ul>" if src_items else ""

    image = (dev.get("image") or {}).get("src")
    img_html = f'<img src="{esc(image)}" alt="Product image of the {esc(name)}" referrerpolicy="no-referrer" loading="lazy" />' if image else ""
    app_link = f"../../#/device/{dev['id']}"
    body = f"""<p class="crumbs"><a href="../../">Tech Comparison Hub</a> › <a href="../../#/devices/{esc(dev['category'])}">{esc(cat.get('name', 'Devices'))}</a> › {esc(name)}</p>
<header>{img_html}<div>
<p class="crumbs">{esc(brand)}{' · ' + esc(cat.get('singular', '')) if cat.get('singular') else ''}{' · ' + esc(year) if year else ''}</p>
<h1>{esc(name)}</h1>
<p>{esc(summary)}</p>
<a class="cta" href="{esc(app_link)}">Open the full interactive page →</a>
</div></header>
{price_html}
{''.join(rows)}
{sources_html}
<p><a class="cta" href="{esc(app_link)}">Compare the {esc(name)} with its rivals →</a></p>"""
    jsonld = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": name,
        "brand": {"@type": "Brand", "name": brand},
        "category": cat.get("singular") or dev["category"],
        "description": summary or description,
        "url": base + f"d/{dev['id']}/",
    }
    if image:
        jsonld["image"] = image
    return page(base, f"d/{dev['id']}/", title, description, body, jsonld, image), f"d/{dev['id']}/"


def chip_page(base: str, chip_row: dict, full: dict, device_rows: dict, brands: dict) -> tuple[str, str]:
    chip = full["chipset"]
    name = chip["name"]
    summary = chip.get("summary") or f"The {name} chipset and the devices that use it."
    devs = [device_rows[d] for d in full.get("devices", []) if d in device_rows]
    def dev_name(r):
        b = brands.get(r["brand"], {}).get("name", r["brand"])
        return r["name"] if b.lower() in r["name"].lower() else f"{b} {r['name']}"
    items = "".join(f"<li><a href=\"../../d/{esc(r['id'])}/\">{esc(dev_name(r))}</a></li>" for r in devs)
    description = f"{summary} Benchmarks from independent sources and {len(devs)} devices using it."[:300]
    body = f"""<p class="crumbs"><a href="../../">Tech Comparison Hub</a> › <a href="../../#/chipsets">Chipsets</a> › {esc(name)}</p>
<h1>{esc(name)}</h1>
<p>{esc(summary)}</p>
<a class="cta" href="../../#/chipset/{esc(chip['id'])}">Open benchmarks and details →</a>
{f'<h2>Devices with the {esc(name)}</h2><ul>{items}</ul>' if items else ''}"""
    jsonld = {"@context": "https://schema.org", "@type": "Thing", "name": name, "description": summary, "url": base + f"c/{chip['id']}/"}
    return page(base, f"c/{chip['id']}/", f"{name}: benchmarks and phones | Tech Comparison Hub", description, body, jsonld), f"c/{chip['id']}/"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT), help="site folder to write into (the deploy folder, or the project root locally)")
    ap.add_argument("--base", default=os.environ.get("SITE_URL") or DEFAULT_BASE)
    args = ap.parse_args()
    base = args.base.rstrip("/") + "/"
    out = Path(args.out)
    core = load(GEN / "core.json")
    brands = {b["id"]: b for b in core["brands"]}
    sources = {s["id"]: s for s in core["sources"]}
    categories = {c["id"]: c for c in core["categories"]}
    device_rows = {r["id"]: r for r in load(GEN / "index" / "devices.json")}
    chip_rows = {r["id"]: r for r in load(GEN / "index" / "chipsets.json")}
    build_day = (core.get("build", {}).get("time") or "")[:10]

    urls = [(base, "daily", "1.0")]
    written = 0
    for dev_id, row in device_rows.items():
        full_path = GEN / "devices" / f"{dev_id}.json"
        if not full_path.exists():
            continue
        text, rel = device_page(base, core, row, load(full_path), brands, sources, categories)
        target = out / rel / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        urls.append((base + rel, "weekly", "0.8"))
        written += 1
    for chip_id, row in chip_rows.items():
        full_path = GEN / "chipsets" / f"{chip_id}.json"
        if not full_path.exists():
            continue
        text, rel = chip_page(base, row, load(full_path), device_rows, brands)
        target = out / rel / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        urls.append((base + rel, "weekly", "0.6"))
        written += 1

    # one plain index of every device, grouped by category, linking the pages above (a crawlable entry point)
    groups = []
    for cat in sorted(categories.values(), key=lambda c: c.get("order", 99)):
        rows = sorted((r for r in device_rows.values() if r["category"] == cat["id"]), key=lambda r: (brands.get(r["brand"], {}).get("name", r["brand"]), r["name"]))
        if not rows:
            continue
        def label(r):
            b = brands.get(r["brand"], {}).get("name", r["brand"])
            return r["name"] if b.lower() in r["name"].lower() else f"{b} {r['name']}"
        items = "".join(f'<li><a href="{esc(r["id"])}/">{esc(label(r))}</a></li>' for r in rows)
        groups.append(f"<h2>{esc(cat['name'])} ({len(rows)})</h2><ul class=\"cols\">{items}</ul>")
    body = f"""<p class="crumbs"><a href="../">Tech Comparison Hub</a> › All devices</p>
<h1>Every device in the hub</h1>
<p>Phones, tablets, smartwatches, fitness bands and earbuds from 2023 to today, with specifications, Malaysian prices and sources.</p>
<a class="cta" href="../#/devices">Open the interactive device finder →</a>
<style>.cols {{ columns: 3 220px; }}</style>
{''.join(groups)}"""
    index_html = page(base, "d/", "All phones, tablets, watches and earbuds | Tech Comparison Hub", "Every device in Tech Comparison Hub: specifications, Malaysian launch prices, tests and sources for phones, tablets, smartwatches, fitness bands and earbuds.", body, {"@context": "https://schema.org", "@type": "CollectionPage", "name": "All devices", "url": base + "d/"})
    (out / "d").mkdir(parents=True, exist_ok=True)
    (out / "d" / "index.html").write_text(index_html.replace('href="../../assets', 'href="../assets'), encoding="utf-8")
    urls.insert(1, (base + "d/", "daily", "0.9"))

    lastmod = f"<lastmod>{build_day}</lastmod>" if build_day else ""
    sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sitemap += [f"  <url><loc>{esc(u)}</loc>{lastmod}<changefreq>{f}</changefreq><priority>{p}</priority></url>" for u, f, p in urls]
    sitemap.append("</urlset>")
    (out / "sitemap.xml").write_text("\n".join(sitemap) + "\n", encoding="utf-8")
    (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {base}sitemap.xml\n", encoding="utf-8")
    print(f"[seo] {written} pages, sitemap with {len(urls)} addresses, base {base}")


if __name__ == "__main__":
    main()
