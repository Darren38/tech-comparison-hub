import json, re, urllib.parse
from pathlib import Path
dp = json.load(open("decisions_prices.json", encoding="utf-8"))
def slug(l): return [p for p in urllib.parse.urlparse(l).path.split("/") if p][-1]
CH = [  # (device, chip name to record, regex the source sentence must match)
 ("samsung-galaxy-s23", "Snapdragon 8 Gen 2", r"S23 series.*Snapdragon 8 Gen 2|Snapdragon 8 Gen 2.*S23"),
 ("samsung-galaxy-s23-plus", "Snapdragon 8 Gen 2", r"S23\+?.*Snapdragon 8 Gen 2"),
 ("samsung-galaxy-s23-ultra", "Snapdragon 8 Gen 2", r"S23 Ultra.*Snapdragon 8 Gen 2|Snapdragon 8 Gen 2 for Galaxy"),
 ("samsung-galaxy-s24", "Exynos 2400", r"S24\+? and (the )?(Galaxy )?S24 are using the Exynos 2400|S24 and S24\+ sport the Exynos 2400"),
 ("samsung-galaxy-s24-plus", "Exynos 2400", r"S24\+? and (the )?(Galaxy )?S24 are using the Exynos 2400|S24 and S24\+ sport the Exynos 2400"),
 ("samsung-galaxy-s24-ultra", "Snapdragon 8 Gen 3", r"S24 Ultra (is using|runs on).*Snapdragon 8 Gen 3"),
 ("samsung-galaxy-s25-plus", "Snapdragon 8 Elite", r"two S25 models are equipped with .*Snapdragon 8 Elite"),
 ("samsung-galaxy-s26-plus", "Exynos 2600", r"S26 and S26\+ both pack the Exynos 2600"),
 ("samsung-galaxy-z-flip5", "Snapdragon 8 Gen 2", r"Snapdragon 8 Gen 2"),
 ("samsung-galaxy-z-fold5", "Snapdragon 8 Gen 2", r"Snapdragon 8 Gen ?2"),
 ("samsung-galaxy-z-flip6", "Snapdragon 8 Gen 3", r"Z Flip6 is a 5G-enabled Snapdragon 8 Gen 3"),
 ("samsung-galaxy-z-fold6", "Snapdragon 8 Gen 3", r"chipset is a Snapdragon 8 Gen 3 for Galaxy"),
 ("samsung-galaxy-z-flip7", "Exynos 2500", r"Exynos 2500 chipset"),
 ("samsung-galaxy-z-fold7", "Snapdragon 8 Elite", r"Powering the Fold 7 is .*Snapdragon 8 Elite"),
 ("samsung-galaxy-z-flip7-fe", "Exynos 2400", r"Fan Edition is running on an Exynos 2400"),
 ("samsung-galaxy-z-flip8", "Exynos 2600", r"Powering the Galaxy Z Flip 8 is .*Exynos 2600"),
 ("samsung-galaxy-z-fold8-ultra", "Snapdragon 8 Elite Gen 5", r"shared with the Ultra model, which is the Qualcomm Snapdragon 8 Elite Gen 5|Z Fold8 Ultra is powered by the Snapdragon 8"),
 ("samsung-galaxy-a05", "Helio G85", r"Galaxy A05 sports .*Helio G85"),
 ("samsung-galaxy-a05s", "Snapdragon 680", r"runs on a Qualcomm Snapdragon 680"),
 ("samsung-galaxy-a06-5g", "Dimensity 6300", r"Dimensity 6300 processor, the new Galaxy A06 5G"),
 ("samsung-galaxy-a06", "Helio G85", r"Helio G85"),
 ("samsung-galaxy-a07-5g", "Dimensity 6300", r"Galaxy A07 5G packs a MediaTek Dimensity 6300"),
 ("samsung-galaxy-a07", "Helio G99", r"LTE version runs on a Media(Tek)? Helio G99"),
 ("samsung-galaxy-a14-5g", "Dimensity 700", r"Galaxy A14 5G runs on .*Dimensity 700"),
 ("samsung-galaxy-a14", "Exynos 850", r"runs on an Exynos 850 processor"),
 ("samsung-galaxy-a16-5g", "Dimensity 6300", r"it is powered by a MediaTek Dimensity 6300 processor, 8GB"),
 ("samsung-galaxy-a24", "Helio G99", r"Galaxy A24 runs on the MediaTek Helio G99"),
 ("samsung-galaxy-a27-5g", "Snapdragon 6 Gen 3", r"Snapdragon 6 Gen 3"),
 ("samsung-galaxy-a34-5g", "Dimensity 1080", r"Galaxy A34 runs on a MediaTek Dimensity 1080"),
 ("samsung-galaxy-a35-5g", "Exynos 1380", r"Galaxy A35 is running on an Exynos 1380"),
 ("samsung-galaxy-a36-5g", "Snapdragon 6 Gen 3", r"Galaxy A36 features the Snapdragon 6 Gen 3"),
 ("samsung-galaxy-a54-5g", "Exynos 1380", r"Galaxy A54 5G is powered by Samsung.s own Exynos 1380"),
 ("samsung-galaxy-a55-5g", "Exynos 1480", r"Exynos 1480 chipset is featured on the Galaxy A55"),
 ("samsung-galaxy-a57-5g", "Exynos 1680", r"A57 runs on a 4nm Exynos 1680"),
 ("samsung-galaxy-m34-5g", "Exynos 1280", r"Galaxy M34 5G is running on a 5nm-based Exynos 1280"),
 ("huawei-mate-80-pro", "Kirin 9030", r"Mate ?80 Pro packs a Kirin 9030"),
 ("huawei-mate-x7", "Kirin 9030 Pro", r"Mate X7 is running on Huawei.s own Kirin 9030 Pro"),
 ("huawei-nova-13", "Kirin 8000", r"Both phones run on a Kirin 8000"),
 ("huawei-nova-13-pro", "Kirin 8000", r"Both phones run on a Kirin 8000"),
 ("redmi-12", "Helio G88", r"Redmi 12 models will also be sporting .*Helio G88"),
 ("vivo-y04", "Unisoc T7225", r"Y04 runs on a Unisoc T7225"),
 ("vivo-y19s", "Unisoc T612", r"runs on a Unisoc T612"),
]
out, miss = {}, []
TITLES = {"soyacincau": "soya_titles.json", "lowyat": "lowyat_titles.json", "nasilemaktech": "nlt_titles.json"}
bylink = {}
for s, f in TITLES.items():
    for p in json.load(open(f, encoding="utf-8")): bylink[(s, slug(p["link"])[:120])] = p
for did, name, rx in CH:
    P = json.load(open(f"cache/prices3/{did}.json", encoding="utf-8"))
    links = [(p["site"], p["url"]) for p in dp.get(did, {}).get("prices", [])] + [(a["site"], a["link"]) for a in P["articles"]]
    # also the Nova 13 article covers the 13 Pro
    if did == "huawei-nova-13-pro":
        links += [(p["site"], p["url"]) for p in dp.get("huawei-nova-13", {}).get("prices", [])] + [(a["site"], a["link"]) for a in json.load(open("cache/prices3/huawei-nova-13.json", encoding="utf-8"))["articles"]]
    hit = None
    for site, l in dict.fromkeys(links):
        f = Path(f"cache/bodies/{site}-{slug(l)[:120]}.txt")
        if f.exists() and re.search(rx, f.read_text(encoding="utf-8"), re.I): hit = (site, l); break
    if not hit: miss.append(did); continue
    out[did] = {"name": name, "site": hit[0], "url": hit[1]}
json.dump(out, open("chip_sources.json", "w", encoding="utf-8"), indent=1)
print(len(out), "chips sourced; missing:", miss)
