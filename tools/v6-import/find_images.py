"""Pick the official product image for each device from the manufacturer's own pages (cached spec pages, plus the OPPO/vivo
product pages). Output image_candidates.json = {id: {"src", "page", "how"}} for visual review; nothing is downloaded or stored."""
import json, re, time, urllib.request, html as H
from pathlib import Path
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
OUT = Path("image_candidates.json")
res = json.loads(OUT.read_text()) if OUT.exists() else {}


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as r:
            return r.read().decode("utf-8", "replace"), r.geturl()
    except Exception:
        return "", url


def og(h):
    m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', h) or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image', h)
    return H.unescape(m.group(1)) if m else None


def absu(u, base):
    if u.startswith("//"): return "https:" + u
    if u.startswith("/"): return base + u
    return u


for brand in ["samsung", "apple", "honor", "huawei", "xiaomi", "oppo", "vivo"]:
    cat = json.loads(Path(f"catalog_{brand}.json").read_text(encoding="utf-8"))
    idx = json.loads(Path(f"cache/spec_{brand}/_index.json").read_text())
    for dv in cat:
        i = dv["id"]
        if i in res: continue
        v = idx.get(i, {})
        p = Path(f"cache/spec_{brand}/{i}.html")
        if not v.get("ok") or not p.exists(): continue
        h = p.read_text(encoding="utf-8"); page = v["final"]; src = how = None
        if brand == "samsung":
            m = re.search(r'"image":"(https://images\.samsung\.com/is/image/samsung/p6pim/my/[^"]+)"', h)
            if m: src, how = m.group(1) + "?$650_519_PNG$", "product gallery (structured data)"
        elif brand == "apple":
            m = re.search(r'(https://cdsassets\.apple\.com/live/[^"\'\s]+/tech-specs/[^"\'\s]*hero[^"\'\s]*\.png)', h) or re.search(r'(https://cdsassets\.apple\.com/live/[^"\'\s]+/tech-specs/[^"\'\s]+\.(?:png|jpg))', h)
            if m: src, how = m.group(1), "tech specs image"
        elif brand == "honor":
            o = og(h)
            if o and "product" in o: src, how = absu(o, "https://www.honor.com"), "og:image"
        elif brand == "huawei":
            m = re.search(r'(/dam/content/dam/huawei-cbg-site/[^"\'\s]+/specs[^"\'\s]*\.(?:png|jpg))', h) or re.search(r'(https://consumer\.huawei\.com/[^"\'\s]+/specs[^"\'\s]*\.(?:png|jpg))', h)
            if m: src, how = absu(m.group(1), "https://consumer.huawei.com"), "specs page image"
        elif brand == "xiaomi":
            o = og(h)
            if o and "appmifile" in o and "logo" not in o: src, how = absu(o, "https://www.mi.com"), "og:image"
        elif brand == "oppo":
            prod = page.replace("/specs/", "/")
            ph, _ = get(prod); time.sleep(1)
            o = og(ph)
            if o and "/content/dam/" in o: src, how, page = absu(o, "https://www.oppo.com"), "product page og:image", prod
        elif brand == "vivo":
            slug = page.rstrip("/").split("/")[-1]
            prod = page.replace("/param/", "/")
            ph, _ = get(prod); time.sleep(1)
            imgs = re.findall(r'(https://asia-exstatic-vivofs\.vivo\.com/[^"\'\s]+\.(?:png|jpg|webp))', ph)
            key = re.sub(r"[^a-z0-9]", "", slug)
            named = [u for u in imgs if key in re.sub(r"[^a-z0-9]", "", u.lower().split("/")[-1]) and not re.search(r"mobile|icon|logo", u, re.I)]
            if named: src, how, page = named[0], "product page image", prod
        if src:
            res[i] = {"src": src, "page": page, "how": how}
    OUT.write_text(json.dumps(res, indent=1))
    print(brand, sum(1 for d in cat if d["id"] in res), "/", len(cat), flush=True)
