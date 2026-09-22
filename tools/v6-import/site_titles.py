"""Collect post titles (title, date, link) since 2023-01-01 from a WordPress news site's public REST API."""
import json, sys, time, urllib.request, urllib.error, html
site, out_file = sys.argv[1], sys.argv[2]
UA = {"User-Agent": "TechComparisonHub/6.0 (research; titles only)"}
BASE = f"https://{site}/wp-json/wp/v2/posts?after=2023-01-01T00:00:00&per_page=100&orderby=date&order=asc&_fields=id,date,link,title&page={{}}"
out, page, total = [], 1, None
while True:
    data = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE.format(page), headers=UA), timeout=60) as r:
                total = int(r.headers.get("X-WP-TotalPages", "0")); data = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code == 400: break
            time.sleep(10 * (attempt + 1))
        except Exception:
            time.sleep(10 * (attempt + 1))
    if not data: break
    out += [{"id": p["id"], "date": p["date"][:10], "title": html.unescape(p["title"]["rendered"]), "link": p["link"]} for p in data]
    if page % 20 == 0: print(site, "page", page, "/", total, len(out), flush=True)
    if total and page >= total: break
    page += 1; time.sleep(1.5)
json.dump(out, open(out_file, "w", encoding="utf-8"), ensure_ascii=False)
print("done", site, len(out))
