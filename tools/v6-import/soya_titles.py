"""Collect SoyaCincau post titles (title, date, link) since 2023-01-01 via the public WordPress REST API."""
import json, time, urllib.request, urllib.error, html
UA = {"User-Agent": "TechComparisonHub/6.0 (research; titles only)"}
BASE = "https://soyacincau.com/wp-json/wp/v2/posts?after=2023-01-01T00:00:00&per_page=100&orderby=date&order=asc&_fields=id,date,link,title,categories&page={}"
out, page, total = [], 1, None
while True:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE.format(page), headers=UA), timeout=40) as r:
                total = int(r.headers.get("X-WP-TotalPages", "0"))
                data = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code == 400:  # past the last page
                data = None; break
            time.sleep(10 * (attempt + 1))
        except Exception:
            time.sleep(10 * (attempt + 1))
    else:
        print("giving up at page", page); break
    if not data:
        break
    out += [{"date": p["date"][:10], "title": html.unescape(p["title"]["rendered"]), "link": p["link"], "cats": p.get("categories", [])} for p in data]
    if page % 10 == 0: print("page", page, "/", total, len(out), flush=True)
    if total and page >= total: break
    page += 1
    time.sleep(1.5)
json.dump(out, open("soya_titles.json", "w", encoding="utf-8"), ensure_ascii=False)
print("done", len(out), "posts", out[0]["date"] if out else "", out[-1]["date"] if out else "")
