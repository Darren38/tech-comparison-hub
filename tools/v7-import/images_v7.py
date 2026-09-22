"""Version 7: official product images for devices that still have none. Only makers' own pages and image CDNs
(nothing is downloaded or re-hosted; the site shows the maker's image with a credit and a link to the page).
Results go to images_v7.json = {id: {kind, src, page, credit, checked, how}}; candidates are reviewed visually before use.

Usage: python images_v7.py samsung|vivo|huawei|xiaomi|honor|oppo|other
"""
import json, re, sys, time, urllib.request, urllib.error, urllib.parse, html as H
from pathlib import Path

HERE = Path(__file__).parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept-Language": "en-MY,en;q=0.9"}
OUT = HERE / "images_v7.json"
res = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
SHARD = [int(x) for x in sys.argv[2].split("/")] if len(sys.argv) > 2 else None  # "k/n": this worker's share of the devices
if SHARD:
    DONE = set(res)
    OUT = HERE / f"images_arch_{SHARD[0]}.json"
    res = {k: None for k in DONE}  # skip devices that already have an image; only new finds are written
    res.update(json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {})
missing = json.loads((HERE / "img_missing.json").read_text(encoding="utf-8"))
TODAY = "2026-09-19"
LOG = []


def get(url, delay=2.0, timeout=45):
    time.sleep(delay)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception as e:
        return type(e).__name__, url, ""


def og(h):
    m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', h) or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image', h)
    return H.unescape(m.group(1)) if m else None


def save(i, src, page, credit, how, kind="official"):
    res[i] = {"kind": kind, "src": src, "page": page, "credit": credit, "checked": TODAY, "how": how}
    OUT.write_text(json.dumps({k: v for k, v in res.items() if v}, indent=1, ensure_ascii=False), encoding="utf-8")
    print("  ok", i, src[:110], flush=True)


def samsung():
    codes = json.loads((HERE / "samsung_support_codes.json").read_text(encoding="utf-8"))
    for i in missing.get("samsung", []):
        if i in res:
            continue
        for code in (codes.get(i) or [])[:4]:
            page = f"https://www.samsung.com/my/support/model/{code}/"
            s, final, h = get(page)
            m = re.search(r"(p6pim/my/[^\"'\s)]+?" + code.lower() + r"[^\"'\s)?]*)", h)
            if m:
                save(i, f"https://images.samsung.com/is/image/samsung/{m.group(1)}?$624_624_PNG$", page, "Samsung Malaysia", "support page product image")
                break
        else:
            print("  none", i, (codes.get(i) or ["no code"])[0], flush=True)


COLOR_IMG = re.compile(r'color-image-item[^>]*>\s*<img[^>]+src="(https://[^"]+\.(?:png|jpg|webp))"[^>]*alt="([^"]*)"')


def catalog(brand):
    return {d["id"]: d for d in json.loads((HERE / f"catalog_{brand}.json").read_text(encoding="utf-8"))}


def vivo():
    """vivo / iQOO: the first 'Product Color' image on the maker's own specification (param) page."""
    idx = json.loads((HERE / "cache/spec_vivo/_index.json").read_text(encoding="utf-8"))
    cat = catalog("vivo")
    for i in missing.get("vivo", []) + missing.get("iqoo", []):
        if i in res:
            continue
        info = idx.get(i, {})
        page = info.get("final") or info.get("url")
        f = HERE / f"cache/spec_vivo/{i}.html"
        h = f.read_text(encoding="utf-8", errors="replace") if f.exists() and info.get("ok") else ""
        if not h:
            urls = cat.get(i, {}).get("spec") or []
            for u in [urls] if isinstance(urls, str) else urls:
                s, final, h = get(u)
                if s == 200 and COLOR_IMG.search(h):
                    page = final
                    break
        m = COLOR_IMG.search(h or "")
        if m:
            save(i, m.group(1), page, "vivo Malaysia", f"spec page product colour image ({m.group(2)})")
        else:
            print("  none", i, page, flush=True)


def ld_product_image(h):
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        blob = m.group(1)
        if '"Product"' not in blob:
            continue
        im = re.search(r'"image"\s*:\s*\[?\s*"(https?:)?(//[^"]+\.(?:png|jpg|webp))', blob)
        if im and "logo" not in im.group(2):
            return "https:" + im.group(2)
    return None


def xiaomi():
    """Xiaomi / POCO / Redmi: the product image in the page's structured data (schema.org Product), else the spec page hero."""
    idx = json.loads((HERE / "cache/spec_xiaomi/_index.json").read_text(encoding="utf-8"))
    cat = catalog("xiaomi")
    for i in missing.get("xiaomi", []) + missing.get("poco", []) + missing.get("redmi", []):
        if i in res:
            continue
        info = idx.get(i, {})
        page = info.get("final") or info.get("url")
        f = HERE / f"cache/spec_xiaomi/{i}.html"
        pages = []
        if f.exists() and info.get("ok"):
            pages.append((page, f.read_text(encoding="utf-8", errors="replace")))
        urls = cat.get(i, {}).get("spec") or []
        for u in ([urls] if isinstance(urls, str) else urls):
            for v in (u, u.replace("/specs/", "/").replace("/specs", "/"), u.replace("/my/", "/global/")):
                if not pages or v != page:
                    pages.append((v, None))
        found = False
        for u, h in pages:
            if h is None:
                s, final, h = get(u)
                if s != 200:
                    continue
                u = final
            src = ld_product_image(h)
            how = "product image (structured data)"
            if not src:
                name = re.escape(cat.get(i, {}).get("name", "@@"))
                m = re.search(r'srcSet="(//i0\d\.appmifile\.com/[^"?]+\.(?:png|jpg))[^"]*"\s*/>\s*<img alt="' + name + r'"[^>]*height:(\d+)px', h)
                if m and int(m.group(2)) >= 300:
                    src, how = "https:" + m.group(1), "spec page hero image"
            if src:
                save(i, src, u, "Xiaomi", how)
                found = True
                break
        if not found:
            print("  none", i, page, flush=True)


def live(url):
    try:
        req = urllib.request.Request(url, headers=UA, method="GET")
        with urllib.request.urlopen(req, timeout=30) as r:
            ok = r.status == 200 and (r.headers.get("Content-Type", "").startswith("image/"))
            r.read(512)
            return ok
    except Exception:
        return False


HW_IMG = re.compile(r"(/dam/content/dam/huawei-cbg-site/[^\"'\s)]+?\.(?:png|jpg|webp))")


def slug_key(s):
    return "".join(ch for ch in s.lower() if ch.isalnum())


def huawei_pick(h, slugs):
    cands = list(dict.fromkeys(HW_IMG.findall(h)))
    keys = [slug_key(x) for x in slugs if x]
    cands = [c for c in cands if any(k and k in slug_key(c) for k in keys)]  # the page menus show other products too
    cands = [c for c in cands if not re.search(r"logo|icon|pay/|banner|badge|award", c, re.I)]
    for pref in (r"/specs/[^/]+$|/specs?[-_][^/]*$", r"/list/[^/]+$|/list[-_]?[^/]*$", r"/(kv|hero|product)[^/]*$"):
        for c in cands:
            if re.search(pref, c, re.I):
                return c
    return None


def huawei():
    """Huawei: the product image on the maker's spec page (live page, or the archived copy of a removed page)."""
    idx = json.loads((HERE / "cache/spec_huawei/_index.json").read_text(encoding="utf-8"))
    wb = json.loads((HERE / "cache/wayback/_index.json").read_text(encoding="utf-8"))
    cat = catalog("huawei")
    for i in missing.get("huawei", []):
        if i in res:
            continue
        tries = []
        if idx.get(i, {}).get("ok") and (HERE / f"cache/spec_huawei/{i}.html").exists():
            tries.append((idx[i]["final"], (HERE / f"cache/spec_huawei/{i}.html").read_text(encoding="utf-8", errors="replace"), None))
        if wb.get(i, {}).get("ok") and (HERE / f"cache/wayback/{i}.html").exists():
            tries.append((wb[i]["original"], (HERE / f"cache/wayback/{i}.html").read_text(encoding="utf-8", errors="replace"), wb[i]))
        urls = cat.get(i, {}).get("spec") or []
        for u in ([urls] if isinstance(urls, str) else urls):
            tries.append((u, None, None))
            tries.append((u.replace("/specs/", "/"), None, None))
        done = False
        for page, h, arch in tries:
            if h is None:
                s, final, h = get(page)
                if s != 200 or "/errors" in final or final.rstrip("/").endswith(("/phones", "/wearables")):
                    continue
                page = final
            m = re.search(r"/(?:phones|wearables|tablets)/([^/]+)/", page or "")
            pick = huawei_pick(h, [m.group(1) if m else None, i.replace("huawei-", "")])
            if not pick:
                continue
            src = "https://consumer.huawei.com" + pick
            if live(src):
                save(i, src, arch["capture"] if arch else page, "Huawei", "spec page product image" + (" (page archived; image still on Huawei's site)" if arch else ""))
            elif arch:
                src = f"https://web.archive.org/web/{arch['timestamp']}im_/{src}"
                save(i, src, arch["capture"], "Huawei (archived page)", "spec page product image, archived copy")
            else:
                continue
            done = True
            break
        if not done:
            print("  none", i, flush=True)


def huawei_regions():
    """Huawei devices whose Malaysian page is gone: the same product image from another Huawei regional site."""
    cat = catalog("huawei")
    for i in missing.get("huawei", []):
        if i in res:
            continue
        slugs = []
        urls = cat.get(i, {}).get("spec") or []
        for u in ([urls] if isinstance(urls, str) else urls):
            m = re.search(r"/(phones|wearables|tablets)/([^/]+)/", u)
            if m and (m.group(1), m.group(2)) not in slugs:
                slugs.append((m.group(1), m.group(2)))
        if not slugs:
            print("  none (no slug)", i, flush=True)
            continue
        done = False
        for kind, slug in slugs:
            for region in ("sg", "ph", "ae-en", "uk", "eu", "au", "za", "en"):
                for tail in ("specs/", ""):
                    page = f"https://consumer.huawei.com/{region}/{kind}/{slug}/{tail}"
                    s, final, h = get(page, 1.5)
                    if s != 200 or f"/{slug}/" not in final:
                        continue
                    pick = huawei_pick(h, [slug])
                    if pick and live("https://consumer.huawei.com" + pick):
                        save(i, "https://consumer.huawei.com" + pick, final, "Huawei", f"product image from Huawei's {region.upper()} site (the Malaysian page is no longer online)")
                        done = True
                        break
                if done:
                    break
            if done:
                break
        if not done:
            print("  none", i, slugs, flush=True)


V7 = Path(__file__).resolve().parents[2]
CREDIT = {"honor": "HONOR", "oppo": "OPPO", "apple": "Apple", "asus": "ASUS", "google": "Google", "oneplus": "OnePlus", "realme": "realme",
          "redmagic": "REDMAGIC", "sony": "Sony", "xiaomi": "Xiaomi", "poco": "Xiaomi", "redmi": "Xiaomi", "huawei": "Huawei", "vivo": "vivo", "iqoo": "iQOO"}


def generic(brands=None):
    """Any remaining device: the product image named in the structured data or og:image of its own official page
    (the page its specifications cite, and the product page next to it). Candidates are checked visually before use."""
    idxs = {b: json.loads((HERE / f"cache/spec_{b}/_index.json").read_text(encoding="utf-8")) for b in ("samsung", "apple", "oppo", "honor", "huawei", "vivo", "xiaomi")}
    todo = [(b, i) for b, ids in missing.items() for i in ids if (brands is None or b in brands) and i not in res]
    for b, i in todo:
        dev = json.loads(next((V7 / "data/devices").glob(f"*/{i}.json")).read_text(encoding="utf-8"))
        pages = []
        for idx in idxs.values():
            if idx.get(i, {}).get("ok"):
                pages.append(idx[i]["final"])
        d = dev["provenance"]["default"]
        if d.get("class") == "official" and d.get("url"):
            pages.append(d["url"])
        for u in list(pages):
            for v in (re.sub(r"/specs?/?$", "/", u), re.sub(r"/(specs|param)/", "/", u)):
                if v not in pages:
                    pages.append(v)
        found = False
        for u in pages:
            s, final, h = get(u, 3 if "honor.com" not in u else 20)
            if s != 200:
                continue
            src = ld_product_image(h) or og(h)
            if not src or re.search(r"logo|favicon|share[-_]?default|default[-_]?share|/icon", src, re.I):
                continue
            if src.startswith("//"):
                src = "https:" + src
            elif src.startswith("/"):
                src = re.match(r"https?://[^/]+", final).group(0) + src
            save(i, src, final, CREDIT.get(b, b), "official page product image (structured data / og:image)")
            found = True
            break
        if not found:
            print("  none", i, pages[:2], flush=True)


def honor():
    generic({"honor"})


def rest():
    generic({"oppo", "apple", "asus", "google", "oneplus", "realme", "redmagic", "sony"})


def cdx(url):
    q = f"https://web.archive.org/cdx/search/cdx?url={urllib.parse.quote(url, safe='')}&output=json&filter=statuscode:200&fl=timestamp,original&limit=-3"
    s, _, h = get(q, 3, timeout=150)  # the archive index often takes 30-60 s to answer
    try:
        rows = json.loads(h)[1:] if s == 200 and h.strip() else []
    except ValueError:
        rows = []
    return rows[::-1]  # newest first


def pick_any(h, brand, i, slug):
    if brand in ("vivo", "iqoo"):
        m = COLOR_IMG.search(h)
        if m:
            return m.group(1)
    if brand == "huawei":
        p = huawei_pick(h, [slug, i.replace("huawei-", "")])
        return "https://consumer.huawei.com" + p if p else None
    src = ld_product_image(h) or og(h)
    if src and not re.search(r"logo|favicon|share|/icon", src, re.I):
        return "https:" + src if src.startswith("//") else src
    return None


def archived():
    """Removed pages: the maker's own product image, taken from an Internet Archive copy of the maker's page."""
    import urllib.parse  # noqa: F401  (used by cdx)
    cats = {}
    for b in ("samsung", "apple", "oppo", "honor", "huawei", "vivo", "xiaomi"):
        cats.update(catalog(b))
    todo = [(b, i) for b, ids in missing.items() for i in ids if i not in res]
    if SHARD:
        todo = todo[SHARD[0]::SHARD[1]]
    print("todo", len(todo), flush=True)
    for b, i in todo:
        if True:
            urls = cats.get(i, {}).get("spec") or []
            urls = [urls] if isinstance(urls, str) else list(urls)
            dev = json.loads(next((V7 / "data/devices").glob(f"*/{i}.json")).read_text(encoding="utf-8"))
            if dev["provenance"]["default"].get("class") == "official":
                urls.append(dev["provenance"]["default"]["url"])
            origs = []
            for u in urls:
                for base in (u.replace("/en/", "/my/"), u):  # the Malaysian page first; many were archived before removal
                    for v in (re.sub(r"/specs?/?$", "/", base), base, re.sub(r"/(specs|param)/", "/", base)):
                        if v not in origs and not re.search(r"\.com/(en|my|global)/?$", v):
                            origs.append(v)
            done = False
            for o in origs[:5]:
                for ts, orig in cdx(o):
                    s, _, h = get(f"https://web.archive.org/web/{ts}id_/{orig}", 3, timeout=120)
                    if s != 200:
                        continue
                    m = re.search(r"/(?:phones|wearables|product|products|param)/([^/]+)/?", orig)
                    src = pick_any(h, b, i, m.group(1) if m else "")
                    if not src:
                        continue
                    capture = f"https://web.archive.org/web/{ts}/{orig}"
                    if live(src):
                        save(i, src, capture, CREDIT.get(b, b), f"product image named on the maker's page (page archived {ts[:8]}; image still on the maker's site)")
                    else:
                        save(i, f"https://web.archive.org/web/{ts}im_/{src}", capture, f"{CREDIT.get(b, b)} (archived page)", f"product image from the archived maker page ({ts[:8]})")
                    done = True
                    break
                if done:
                    break
            if not done:
                print("  none", i, origs[:2], flush=True)


if __name__ == "__main__":
    globals()[sys.argv[1]]()
