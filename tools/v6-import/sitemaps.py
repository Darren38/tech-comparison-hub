import urllib.request, re, gzip, json, time
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
                if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
                return b.decode("utf-8", "replace")
        except Exception as e:
            err = e; time.sleep(5)
    print("FAIL", url, err); return ""
def locs(url): return re.findall(r"<loc>\s*([^<]+?)\s*</loc>", get(url))
res = {}
res["samsung"] = [u for u in locs("https://www.samsung.com/my/b2c-sitemap.xml")]
res["oppo"] = locs("https://www.oppo.com/my/sitemap.xml")
res["vivo"] = locs("https://www.vivo.com/my/sitemap.xml")
res["honor"] = locs("https://www.honor.com/my/sitemap.xml")
res["huawei"] = locs("https://consumer.huawei.com/my/sitemap.xml")
mi = get("https://www.mi.com/my/sitemap.xml")
res["xiaomi_raw_head"] = [mi[:600]]
json.dump(res, open("sitemaps.json", "w", encoding="utf-8"), indent=0)
for k, v in res.items(): print(k, len(v))
