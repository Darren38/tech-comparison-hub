"""Find each device's Malaysian launch coverage in SoyaCincau / Lowyat.NET / Nasi Lemak Tech titles, read those articles
(via the sites' public WordPress APIs) and pull out the price sentences and parsed (RAM, storage, RM) candidates.

Output: cache/prices/<id>.json = {"id", "name", "articles": [{site, date, title, link}], "candidates": [{ram, storage_gb, rm, site, date, link, text}],
                                   "sentences": [...]} -- reviewed before anything is written to data/.
"""
import json, re, sys, time, html, urllib.request, urllib.error, urllib.parse
from pathlib import Path

UA = {"User-Agent": "TechComparisonHub/6.0 (research; launch prices)"}
SITES = {"soyacincau": ("soyacincau.com", "soya_titles.json"), "lowyat": ("www.lowyat.net", "lowyat_titles.json"),
         "nasilemaktech": ("nasilemaktech.com", "nlt_titles.json")}
OUT = Path("cache/prices3"); OUT.mkdir(parents=True, exist_ok=True)
BODY = Path("cache/bodies"); BODY.mkdir(parents=True, exist_ok=True)
last = {}


def norm(s):
    s = s.lower().replace("+", "plus").replace("’", "'")
    return re.sub(r"[^a-z0-9]", "", s)


def keys(dv):
    n = re.sub(r"^(samsung|apple|oppo|honor|huawei|vivo|xiaomi)\s+", "", dv["name"], flags=re.I)
    full = norm(n)
    base = re.sub(r"(5g|4g)$", "", full)
    return full, base


VARIANT = {"pro", "plus", "+", "ultra", "lite", "fe", "max", "mini", "5g", "4g", "edge", "classic", "active", "s", "e", "x", "t", "c", "smart", "go"}


def tok_re(tokens):
    parts = []
    for t in tokens:
        if t == "+": parts.append(r"(?:\+|\s?Plus)")
        elif t.endswith("+"): parts.append(re.escape(t[:-1]) + r"\s*(?:\+|Plus)")
        else: parts.append(re.escape(t))
    # tokens may be written with or without spaces ("Reno12" / "Reno 12", "Z Fold5" / "Z Fold 5")
    body = r"\s*".join(parts)
    body = re.sub(r"([A-Za-z])(\d)", r"\1\\s*\2", body)
    return body


def title_patterns(name):
    n = re.sub(r"^(samsung|apple|oppo|honor|huawei|vivo|xiaomi)\s+", "", name, flags=re.I)
    toks = n.replace("+", " +").split()
    model = re.compile(r"(?<![A-Za-z0-9])" + tok_re(toks) + r"(?![A-Za-z0-9]|\s*\+|\s+(?:Pro|Plus|Ultra|Lite|FE|Max|Mini|Edge|Classic|Active)\b)", re.I)
    root = list(toks)
    while len(root) > 1 and root[-1].lower() in VARIANT: root.pop()
    series = None
    if root != toks or True:
        series = re.compile(r"(?<![A-Za-z0-9])" + tok_re(root) + r"(?![0-9])[^|:]{0,30}?(?:series|lineup|family|\band\b|&|,)", re.I)
    return model, series


def fetch_json(host, path):
    wait = 1.3 - (time.time() - last.get(host, 0))
    if wait > 0: time.sleep(wait)
    last[host] = time.time()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"https://{host}/wp-json/wp/v2/{path}", headers=UA), timeout=45) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (400, 404): return None
            time.sleep(8 * (attempt + 1))
        except Exception:
            time.sleep(8 * (attempt + 1))
    return None


def body(site, link):
    host = SITES[site][0]
    slug = [p for p in urllib.parse.urlparse(link).path.split("/") if p][-1]
    f = BODY / f"{site}-{slug[:120]}.txt"
    if f.exists(): return f.read_text(encoding="utf-8")
    res = fetch_json(host, f"posts?slug={urllib.parse.quote(slug)}&_fields=content")
    c = (res[0]["content"]["rendered"] if res else "") or ""
    c = re.sub(r"(?i)</(p|li|h\d|tr|div|td|th)>|<br\s*/?>", "\n", c)
    t = html.unescape(re.sub(r"<[^>]+>", " ", c))
    t = "\n".join(re.sub(r"[ \t ]+", " ", l).strip() for l in t.split("\n") if l.strip())
    f.write_text(t, encoding="utf-8")
    return t


# "RM1,399 (12GB + 256GB)" first, then "8GB + 256GB ... RM1,399" with no other price in between
PRICE_B = re.compile(r"RM\s?([\d,]{3,6})\s*(?:for\s*(?:the\s*)?)?\(?\s*(\d{1,2})\s*GB\s*(?:of\s*)?(?:RAM)?\s*(?:\+|and|/|,)\s*(\d{2,4}|1|2)\s*(GB|TB)", re.I)
PRICE_A = re.compile(r"(\d{1,2})\s*GB\s*(?:of\s*)?(?:RAM)?\s*(?:\+|and|with|/|,)\s*(\d{2,4}|1|2)\s*(GB|TB)\s*(?:of\s*)?(?:storage|ROM)?(?:(?!RM|\d\s*GB)[^.;\n]){0,60}?RM\s?([\d,]{3,6})", re.I)
PRICE_S1 = re.compile(r"RM\s?([\d,]{3,6})\s*for\s*(?:the\s*)?(?<!\+)(?<!\+\s)(\d{2,4}|1|2)\s*(GB|TB)\b(?!\s*(?:\+|RAM))", re.I)
PRICE_S2 = re.compile(r"(?<![+\d]\s)(?<![+\d])(\d{3,4}|1|2)\s*(GB|TB)\s*(?:storage\s*)?(?:model|variant|version|option)\s*(?:is|costs|goes for|retails (?:at|for)|priced at|at|for|:|–|-)?\s*RM\s?([\d,]{3,6})", re.I)
NOT_PRICE = re.compile(r"~\s?RM|\(~|INR|about RM|approx|worth RM|rebate|RM\s?[\d,]+\s*off|discount|voucher|gift|save RM|savings|cashback|instal|/month|per month|trade-?in|freebies|bundle", re.I)
PRICE_C = re.compile(r"(\d{2,4}|1|2)\s*(GB|TB)(?:\s*(?:storage|model|variant|version))?[^.;\n]{0,40}?RM\s?([\d,]{3,6})", re.I)


def sentence_re(name, names):
    """Regex for this exact model in running text; sibling-aware for 4G/5G twins and Pro/Plus/Ultra variants."""
    n = re.sub(r"^(samsung|apple|oppo|honor|huawei|vivo|xiaomi)\s+", "", name, flags=re.I)
    has5 = re.search(r"\s(5G|4G)$", n, re.I)
    core = re.sub(r"\s(5G|4G)$", "", n, flags=re.I)
    body = tok_re(core.replace("+", " +").split())
    if has5:
        twin = re.sub(r"\s(5G|4G)$", "", name, flags=re.I).lower() in names
        body += (r"\s*" + has5.group(1)) if twin else (r"(?:\s*" + has5.group(1) + r")?")
    elif (name + " 5G").lower() in names:
        body += r"(?!\s*5G)"
    return re.compile(r"(?<![A-Za-z0-9])" + body + r"(?![A-Za-z0-9]|\s*\+|\s+(?:Pro|Plus|Ultra|Lite|FE|Max|Mini|Edge|Classic|Active|Prime|Smart|Play|Neo|Turbo|Explorer|Flip|Fold|Slim|Air)\b)", re.I)


ANY_MODEL = re.compile(r"(?:Galaxy|iPhone|Reno|Find|OPPO|vivo|iQOO|HONOR|Magic|nova|Pura|Mate|Redmi|POCO|Xiaomi|Watch|Band)\s*[A-Z]?\d", re.I)


def candidates(text, sre):
    out, sents = [], []
    lines = text.split("\n")
    for li, line in enumerate(lines):
        for sent in re.split(r"(?<=[.!?])\s+", line):
            if not re.search(r"RM\s?\d", sent): continue
            ctx = " ".join(lines[max(0, li - 2):li])
            if sre.search(sent):
                how = "named"
            elif ANY_MODEL.search(sent):
                continue  # names some other model
            elif sre.search(ctx):
                how = "context"
            else:
                continue
            sents.append(f"({how}) " + sent.strip()[:320])
            seen = set()
            for m in PRICE_B.finditer(sent):
                seen.add(m.group(1))
                out.append({"ram": int(m.group(2)), "storage_gb": int(m.group(3)) * (1024 if m.group(4).upper() == "TB" else 1), "rm": int(m.group(1).replace(",", "")), "how": how, "text": sent.strip()[:260]})
            for m in PRICE_A.finditer(sent):
                if m.group(4) in seen: continue
                seen.add(m.group(4))
                out.append({"ram": int(m.group(1)), "storage_gb": int(m.group(2)) * (1024 if m.group(3).upper() == "TB" else 1), "rm": int(m.group(4).replace(",", "")), "how": how, "text": sent.strip()[:260]})
            # storage-only configurations: "RM6,799 for the 256GB model" / "the 512GB model costs RM7,299"
            if not NOT_PRICE.search(sent):
                for m in PRICE_S1.finditer(sent):
                    if m.group(1) in seen: continue
                    seen.add(m.group(1))
                    out.append({"ram": None, "storage_gb": int(m.group(2)) * (1024 if m.group(3).upper() == "TB" else 1), "rm": int(m.group(1).replace(",", "")), "how": how, "text": sent.strip()[:260]})
                for m in PRICE_S2.finditer(sent):
                    if m.group(3) in seen: continue
                    seen.add(m.group(3))
                    out.append({"ram": None, "storage_gb": int(m.group(1)) * (1024 if m.group(2).upper() == "TB" else 1), "rm": int(m.group(3).replace(",", "")), "how": how, "text": sent.strip()[:260]})
            if not re.search(r"\d\s*GB", sent) and not NOT_PRICE.search(sent):
                for m in re.finditer(r"RM\s?([\d,]{3,6})", sent):
                    out.append({"ram": None, "storage_gb": None, "rm": int(m.group(1).replace(",", "")), "how": how, "text": sent.strip()[:260]})
    return out, sents


PRICEY = re.compile(r"malaysia|\bRM\s?\d|price|launch|pre-?order|now available|official", re.I)
RUMOUR = re.compile(r"\b(may|might|could|reportedly|rumou?r|leaks?|leaked|tipped|expected|spotted|teases?|certif\w*|renders?|coming soon|to launch|will launch|set to)\b", re.I)
titles = {s: json.loads(Path(f).read_text(encoding="utf-8")) for s, (_, f) in SITES.items() if Path(f).exists()}
cat = []
for f in sys.argv[1:]:
    cat += json.loads(Path(f).read_text(encoding="utf-8"))
NAMES = {d["name"].lower() for d in cat}
for dv in cat:
    out = OUT / f"{dv['id']}.json"
    if out.exists(): continue
    sre = sentence_re(dv["name"], NAMES)
    model_re, series_re = title_patterns(dv["name"])
    arts = []
    for site, posts in titles.items():
        exact, series = [], []
        for p in posts:
            t = p["title"]
            if model_re.search(t):
                exact.append(p)
            elif series_re and series_re.search(t) and re.search(r"malaysia|\bRM\s?\d|launch|price|official|available|pre-?order", t, re.I):
                series.append(p)
        launchy = lambda p: PRICEY.search(p["title"]) and not RUMOUR.search(p["title"])
        by_date = lambda ps: sorted(ps, key=lambda p: p["date"])
        hits = [(p, 0) for p in by_date([p for p in exact if launchy(p)])[:3]] + [(p, 1) for p in by_date([p for p in series if launchy(p)])[:3]] \
             + [(p, 2) for p in by_date([p for p in exact if not launchy(p)])[:1]]
        for p, pri in hits:
            arts.append({"site": site, "date": p["date"], "title": p["title"], "link": p["link"], "match": "model" if p in exact else "series", "pri": pri})
    cands, sents = [], []
    arts.sort(key=lambda a: (a["pri"], a["date"]))
    for a in arts[:10]:
        c, s = candidates(body(a["site"], a["link"]), sre)
        for x in c: x.update({"site": a["site"], "date": a["date"], "link": a["link"]})
        cands += c; sents += [f"[{a['site']} {a['date']}] {x}" for x in s]
    out.write_text(json.dumps({"id": dv["id"], "name": dv["name"], "articles": arts, "candidates": cands, "sentences": sents[:25]}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(dv["id"], len(arts), len(cands), flush=True)
