"""Fetch official spec pages into cache/spec/<id>.html (polite: per-host delay), recording status in cache/spec/_index.json.

Usage: python fetchcache.py catalog_<brand>.json   (entries: {"id":..., "spec": url or [urls...]})
"""
import json, sys, time, urllib.request, urllib.error, gzip, re
from pathlib import Path
from urllib.parse import urlparse
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept-Language": "en-MY,en;q=0.9"}
DELAY = {"www.honor.com": 30}
CACHE = Path("cache/spec"); IDX = CACHE / "_index.json"
idx = json.loads(IDX.read_text()) if IDX.exists() else {}
last = {}
def fetch(url):
    host = urlparse(url).netloc
    wait = DELAY.get(host, 2) - (time.time() - last.get(host, 0))
    if wait > 0: time.sleep(wait)
    last[host] = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            b = r.read()
            if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
            return r.status, r.geturl(), b.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception as e:
        return type(e).__name__, url, ""
cat = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
force = "--force" in sys.argv
for d in cat:
    urls = d.get("spec") or []
    urls = [urls] if isinstance(urls, str) else urls
    if not urls: continue
    if d["id"] in idx and idx[d["id"]].get("ok") and not force: continue
    for u in urls:
        s, final, h = fetch(u)
        title = re.search(r"<title[^>]*>(.*?)</title>", h, re.S | re.I)
        title = re.sub(r"\s+", " ", title.group(1)).strip() if title else ""
        ok = s == 200 and (not d.get("must") or d["must"] in final) and "404" not in title and len(h) > 20000 and not re.search(r"/errors?/404|page-not-found", final)
        idx[d["id"]] = {"url": u, "final": final, "status": s, "title": title[:120], "ok": ok, "bytes": len(h)}
        if ok:
            (CACHE / f"{d['id']}.html").write_text(h, encoding="utf-8")
            break
    print(("OK  " if idx[d["id"]]["ok"] else "BAD ") + d["id"], idx[d["id"]]["status"], idx[d["id"]]["title"][:70], flush=True)
    IDX.write_text(json.dumps(idx, indent=1))
