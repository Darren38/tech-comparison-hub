"""Last pass: hand-picked official pages (other regions, product pages) for phones still without an image.
Writes images_last.json = {id: [{src, page}]} candidates for visual review; nothing is applied here."""
import json, re, time, urllib.request, urllib.error, html as H
from pathlib import Path

HERE = Path(__file__).parent
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept-Language": "en-MY,en;q=0.9"}

X = lambda slug: [f"https://www.mi.com/{r}/product/{slug}/" for r in ("my", "global", "sg", "ph", "id", "th", "uk")]
O = lambda path: [f"https://www.oppo.com/{r}/smartphones/{path}/" for r in ("my", "sg", "ph", "id", "th", "uk", "au")]
PAGES = {
    "samsung-galaxy-a07-5g": ["https://www.samsung.com/my/smartphones/galaxy-a/galaxy-a07-5g-black-128gb-sm-a076bzkcxme/"],
    "poco-x8": X("poco-x8"),
    "poco-f7-ultra": X("poco-f7-ultra") + ["https://www.po.co/global/product/poco-f7-ultra/"],
    "poco-m8": X("poco-m8") + X("poco-m8-5g"),
    "poco-m8-pro": X("poco-m8-pro") + X("poco-m8-pro-5g"),
    "poco-x6-5g": X("poco-x6-5g") + X("poco-x6"),
    "poco-x6-pro-5g": X("poco-x6-pro-5g") + X("poco-x6-pro"),
    "xiaomi-13t-pro": X("xiaomi-13t-pro"),
    "oppo-reno11-f-5g": O("series-reno/reno11-f-5g"),
    "oppo-a7-pro-max": O("series-a/a7-pro-max") + O("series-a/a7-pro-max-5g"),
    "oppo-a5i-pro-5g": O("series-a/a5i-pro-5g"),
    "vivo-y29": ["https://www.vivo.com/my/products/y29", "https://www.vivo.com/my/products/param/y29"],
    "iqoo-z9": ["https://www.iqoo.com/my/products/z9", "https://www.vivo.com/my/products/iqoo-z9"],
    "iqoo-z9x": ["https://www.iqoo.com/my/products/z9x", "https://www.vivo.com/my/products/iqoo-z9x"],
    "realme-gt-8-pro": ["https://www.realme.com/my/realme-gt-8-pro", "https://www.realme.com/global/realme-gt-8-pro"],
    "sony-xperia-1-vii": ["https://www.sony.com.my/electronics/smartphones/xperia-1m7", "https://www.sony.com/en/articles/product-specifications-xperia-1-vii"],
    "asus-rog-phone-9-pro": ["https://rog.asus.com/phones/rog-phone-9-pro/", "https://rog.asus.com/my/phones/rog-phone-9-pro/"],
    "redmagic-11-pro": ["https://global.redmagic.gg/products/redmagic-11-pro", "https://global.redmagic.gg/pages/redmagic-11-pro"],
}


def get(url):
    time.sleep(2)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as r:
            return r.status, r.geturl(), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception as e:
        return type(e).__name__, url, ""


def cands(h, base, slug_hint):
    out = []
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        if '"Product"' in m.group(1):
            for im in re.findall(r'"image"\s*:\s*\[?\s*"((?:https?:)?//[^"]+)"', m.group(1)):
                out.append(im)
    for pat in (r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image'):
        out += re.findall(pat, h)
    out += re.findall(r'"(https://images\.samsung\.com/is/image/samsung/p6pim/my/[^"]+)"', h)[:2]
    out += [u for u in re.findall(r'(/content/dam/oppo/[^"\'\s)]+?listpage[^"\'\s)]+?\.png)', h)][:2]
    out += [u for u in re.findall(r'(https://asia-exstatic-vivofs\.vivo\.com/[^"\'\s)]+?\.png)', h) if slug_hint in u.lower()][:2]
    res = []
    for u in out:
        u = H.unescape(u)
        u = "https:" + u if u.startswith("//") else (re.match(r"https?://[^/]+", base).group(0) + u if u.startswith("/") else u)
        if not re.search(r"logo|favicon|share[-_]?default|/icon", u, re.I) and u not in res:
            res.append(u)
    return res[:3]


found = {}
for i, pages in PAGES.items():
    hint = re.sub(r"^(poco|oppo|vivo|iqoo|xiaomi|samsung-galaxy|realme|sony|asus|redmagic)-", "", i).split("-")[0]
    for p in pages:
        s, final, h = get(p)
        if s != 200 or re.search(r"/errors?/|404|/global/?$|/my/?$", final):
            continue
        c = cands(h, final, hint)
        if c:
            found[i] = [{"src": u, "page": final} for u in c]
            print("ok  ", i, final, c[0][:120], flush=True)
            break
    else:
        print("none", i, flush=True)
(HERE / "images_last.json").write_text(json.dumps(found, indent=1, ensure_ascii=False), encoding="utf-8")
