"""Turn the reviewed dec_<brand>.txt files into decisions.json for build_new.py.

Line format:  id | CFG=RM[@site], ... [@site] | opt; opt
  CFG   8/256 (RAM/storage GB), 12/1T, 256 (storage only), - (no configuration), or "free text" (watch sizes etc.)
  site  soya | lowy | nasi. Each price is tied to the earliest article from that site whose text states that RM figure
        next to this model (the article list from the price finder first, then every cached article from the site).
  opts  ann=YYYY-MM-DD  status=...  pnote=note for every price  set:dotted.path=JSON  drop_fields=a,b
  A middle part starting with "drop:" drops the device, with the reason recorded.
"""
import json, re, sys, urllib.parse
from pathlib import Path

ABBR = {"soya": "soyacincau", "lowy": "lowyat", "nasi": "nasilemaktech"}
TITLES = {"soyacincau": "soya_titles.json", "lowyat": "lowyat_titles.json", "nasilemaktech": "nlt_titles.json"}
src = open("price_find2.py", encoding="utf-8").read().split("titles = {")[0]
exec(src)  # sentence_re, tok_re
CAT = {}
for b in ["samsung", "apple", "oppo", "honor", "huawei", "vivo", "xiaomi"]:
    for d in json.load(open(f"catalog_{b}.json", encoding="utf-8")): CAT[d["id"]] = d
NAMES = {d["name"].lower() for d in CAT.values()}
_titles = {}


def slug_of(link):
    return [p for p in urllib.parse.urlparse(link).path.split("/") if p][-1]


def body_text(site, link):
    f = Path(f"cache/bodies/{site}-{slug_of(link)[:120]}.txt")
    return f.read_text(encoding="utf-8") if f.exists() else ""


def rm_re(v):
    s = f"{v:,}"
    return re.compile(r"RM\s?(?:" + re.escape(s) + "|" + str(v) + r")(?!\d|,\d)")


def near(text, sre, pat):
    L = text.split("\n")
    for i, l in enumerate(L):
        if pat.search(l) and (sre.search(l) or any(sre.search(x) for x in L[max(0, i - 6):i])):
            return True
    return False


def find_article(did, site, rm):
    sre = sentence_re(CAT[did]["name"], NAMES)
    pat = rm_re(rm)
    P = json.load(open(f"cache/prices3/{did}.json", encoding="utf-8"))
    arts = sorted([a for a in P["articles"] if a["site"] == site], key=lambda a: a["date"])
    for a in arts:
        if near(body_text(site, a["link"]), sre, pat): return a["link"], a["date"], a["title"]
    # fall back to every cached article from this site that mentions the model next to the price
    if site not in _titles:
        _titles[site] = {slug_of(p["link"])[:120]: p for p in json.load(open(TITLES[site], encoding="utf-8"))}
    hits = []
    for f in Path("cache/bodies").glob(f"{site}-*.txt"):
        p = _titles[site].get(f.stem[len(site) + 1:])
        if p and near(f.read_text(encoding="utf-8"), sre, pat): hits.append(p)
    if hits:
        p = min(hits, key=lambda p: p["date"])
        return p["link"], p["date"], p["title"]
    return None


def cfg_text(c):
    if c.startswith('"'): return c.strip('"')
    if c == "-": return None
    def gb(x): return f"{x[:-1]} TB" if x.endswith("T") else f"{x} GB"
    if "/" in c:
        r, s = c.split("/")
        return f"{r} GB / {gb(s)}"
    return gb(c)


def parse(path):
    out, problems = {}, []
    for ln in Path(path).read_text(encoding="utf-8").splitlines():
        if not ln.strip() or ln.startswith("#"): continue
        parts = [p.strip() for p in ln.split("|")]
        did, mid, opts = parts[0], parts[1] if len(parts) > 1 else "", parts[2] if len(parts) > 2 else ""
        if did not in CAT: problems.append(f"{did}: not in catalog"); continue
        dec = {}
        if mid.startswith("drop:"):
            out[did] = {"drop": True, "reason": mid[5:].strip()}; continue
        default_site = None
        m = re.search(r"\s@(\w+)\s*$", mid)
        if m: default_site = ABBR[m.group(1)]; mid = mid[:m.start()]
        prices = []
        msrc = re.search(r"(?:^|;)\s*src=([^\s;]+)", opts)
        forced = None
        if msrc:
            url = msrc.group(1)
            for st, f in TITLES.items():
                for tp in json.load(open(f, encoding="utf-8")):
                    if tp["link"].rstrip("/") == url.rstrip("/"): forced = (tp["link"], tp["date"], tp["title"], st)
            if not forced: problems.append(f"{did}: src not in title lists")
        for item in re.findall(r'("[^"]+"|[^,\s][^,=]*)=(\d+)(?:@(\w+))?', mid):
            cfg, rm, st = item[0].strip(), int(item[1]), ABBR[item[2]] if item[2] else default_site
            hit = forced[:3] if forced else find_article(did, st, rm)
            if forced: st = forced[3]
            if not hit: problems.append(f"{did}: RM{rm} not found on {st}"); continue
            link, date, title = hit
            p = {"rm": rm, "date": date, "site": st, "url": link}
            if cfg_text(cfg): p["config"] = cfg_text(cfg)
            prices.append(p)
        for o in [o.strip() for o in re.split(r";\s*(?=(?:ann|annsrc|annnote|status|pnote|src|set:[\w.]+|drop_fields)=)", opts) if o.strip()]:
            k, _, v = o.partition("=")
            if k == "ann": dec["announced"] = v
            elif k == "status": dec["status"] = v
            elif k == "pnote":
                for p in prices: p["note"] = v
            elif k.startswith("set:"): dec.setdefault("set", {})[k[4:]] = json.loads(v)
            elif k == "drop_fields": dec["drop_fields"] = v.split(",")
            elif k == "src": pass
            elif k == "annsrc":
                st = next((x for x, f in TITLES.items() if any(tp["link"].rstrip("/") == v.rstrip("/") for tp in json.load(open(f, encoding="utf-8")))), None)
                if not st: problems.append(f"{did}: annsrc not in title lists")
                dec["announced_source"] = {"site": st, "url": v}
            elif k == "annnote": dec["announced_note"] = v
            else: problems.append(f"{did}: unknown option {k}")
        if prices:
            dec["prices"] = prices
            first = min(prices, key=lambda p: p["date"])
            if "announced" not in dec:
                dec["announced"] = first["date"]
                dec["announced_source"] = {"site": first["site"], "url": first["url"]}
        out[did] = dec
    return out, problems


if __name__ == "__main__":
    allout, allprob = {}, []
    for f in sys.argv[1:]:
        o, p = parse(f)
        allout.update(o); allprob += p
    Path("decisions_prices.json").write_text(json.dumps(allout, indent=1, ensure_ascii=False), encoding="utf-8")
    print(len(allout), "devices;", sum(len(d.get("prices", [])) for d in allout.values()), "prices;", sum(1 for d in allout.values() if d.get("drop")), "dropped")
    for p in allprob: print("PROBLEM", p)
