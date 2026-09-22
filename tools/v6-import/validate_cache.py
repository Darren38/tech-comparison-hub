"""Check every cached spec page names its model and contains spec content; drop the ones that don't.
Prints a summary; failing ids are removed from the brand index so a re-run of fetchcache tries the next URL."""
import json, re, sys
from pathlib import Path
sys.path.insert(0, ".")
from pagetext import to_text
def norm(s): return re.sub(r"[^a-z0-9]", "", s.lower().replace("+", "plus").replace(" ", ""))
def key(name):
    n = re.sub(r"^(samsung|apple|oppo|honor|huawei|vivo|xiaomi)\s+", "", name, flags=re.I)
    return norm(n)
for b in sys.argv[1:]:
    d = Path(f"cache/spec_{b}"); idx = json.loads((d / "_index.json").read_text())
    cat = {x["id"]: x for x in json.loads(Path(f"catalog_{b}.json").read_text(encoding="utf-8"))}
    bad = []
    for i, v in list(idx.items()):
        f = d / f"{i}.html"
        if not v.get("ok") or not f.exists():
            bad.append((i, "not fetched")); continue
        text = " ".join(to_text(f.read_text(encoding="utf-8")))
        k = key(cat[i]["name"]); nt = norm(text)
        # accept "Galaxy S25" as "galaxys25"; accept iQOO "Z10 5G" etc.
        named = k in nt or k.replace("5g", "") in nt
        specs = bool(re.search(r"mAh|Battery|battery", text)) and bool(re.search(r"\bmm\b|Dimension|Weight|weight", text))
        if not (named and specs):
            bad.append((i, f"named={named} specs={specs} final={v['final'][-50:]}"))
            v["ok"] = False; f.unlink()
    (d / "_index.json").write_text(json.dumps(idx, indent=1))
    print(f"== {b}: {len(idx) - len(bad)} valid, {len(bad)} invalid")
    for i, why in bad: print("   ", i, why)
