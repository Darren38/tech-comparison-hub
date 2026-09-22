"""Archived copies (Internet Archive Wayback Machine) of official spec pages that the makers have since removed.

For each device: try the Malaysian page first, then the global one; take the latest capture that returned 200,
fetch it raw (id_), keep it in cache/wayback/<id>.html with the capture URL and date in cache/wayback/_index.json.
Usage: python wayback.py targets.json   (targets: {id: [official URL, ...]})
"""
import json, sys, time, urllib.request, urllib.parse
from pathlib import Path

UA = {"User-Agent": "Mozilla/5.0 TechComparisonHub/7.0 (research; archived official spec pages)"}
OUT = Path("cache/wayback"); OUT.mkdir(parents=True, exist_ok=True)
IDX = OUT / "_index.json"
index = json.loads(IDX.read_text(encoding="utf-8")) if IDX.exists() else {}
last = [0.0]


def get(url, timeout=60):
    wait = 4 - (time.time() - last[0])
    if wait > 0: time.sleep(wait)
    last[0] = time.time()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 403): return e.code, b""
            time.sleep(15 * (attempt + 1))
        except Exception:
            time.sleep(15 * (attempt + 1))
    return 0, b""


targets = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
for did, urls in targets.items():
    if index.get(did, {}).get("ok"): continue
    done = False
    for u in urls:
        q = "https://web.archive.org/cdx/search/cdx?" + urllib.parse.urlencode({"url": u, "output": "json", "filter": "statuscode:200", "fl": "timestamp,original", "limit": "-5"})
        st, body = get(q)
        rows = json.loads(body)[1:] if st == 200 and body.strip().startswith(b"[") else []
        for ts, orig in reversed(rows):
            st2, html = get(f"https://web.archive.org/web/{ts}id_/{orig}", timeout=90)
            if st2 == 200 and len(html) > 20000:
                (OUT / f"{did}.html").write_bytes(html)
                index[did] = {"ok": True, "original": orig, "timestamp": ts, "capture": f"https://web.archive.org/web/{ts}/{orig}", "bytes": len(html)}
                done = True
                break
        if done: break
    if not done: index[did] = {"ok": False, "tried": urls}
    IDX.write_text(json.dumps(index, indent=1), encoding="utf-8")
    print(did, index[did].get("timestamp", "none"), index[did].get("original", ""), flush=True)
