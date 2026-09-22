"""Version 6 catalogue: every phone, watch and band from the seven brands with evidence of a Malaysian launch
from January 2023 (SoyaCincau launch coverage and/or the brand's official Malaysian product pages).

Each entry: id, brand, name, category (smartphone | smartwatch | band), series, form, spec (official spec page
URL candidates, Malaysian site first), q (SoyaCincau search phrase). Existing Version 5 devices are skipped by id.
Run: python catalog.py  -> catalog_<brand>.json
"""
import json

OPPO = "https://www.oppo.com/my/smartphones/{}/specs/"
OPPO_ACC = "https://www.oppo.com/my/accessories/{}/specs/"
HONOR = "https://www.honor.com/my/phones/{}/spec/"
HONOR_W = "https://www.honor.com/my/wearables/{}/spec/"
HW = "https://consumer.huawei.com/my/phones/{}/specs/"
HW_G = "https://consumer.huawei.com/en/phones/{}/specs/"
HW_W = "https://consumer.huawei.com/my/wearables/{}/specs/"
HW_WG = "https://consumer.huawei.com/en/wearables/{}/specs/"
VIVO = "https://www.vivo.com/my/products/param/{}"
IQOO = "https://www.iqoo.com/my/products/param/{}"
MI = "https://www.mi.com/my/product/{}/specs/"
MI_G = "https://www.mi.com/global/product/{}/specs/"


def d(brand, id_, name, cat="smartphone", series=None, form=None, spec=(), q=None):
    form = form or {"smartphone": "bar", "smartwatch": "watch", "band": "band"}[cat]
    return {"id": id_, "brand": brand, "name": name, "category": cat, "series": series, "form": form,
            "spec": [s for s in spec if s], "q": q or name}


C = []

# ------------------------------------------------------------------ OPPO (official MY pages for all)
for slug, name, series, form in [
    ("series-reno/reno8-t-5g", "Reno8 T 5G", "Reno", None), ("series-reno/reno8-t", "Reno8 T", "Reno", None),
    ("series-find-n/find-n2-flip", "Find N2 Flip", "Find N", "foldable"),
    ("series-a/a78-5g", "A78 5G", "A", None), ("series-a/a78", "A78", "A", None), ("series-a/a98-5g", "A98 5G", "A", None),
    ("series-a/a58", "A58", "A", None), ("series-a/a38", "A38", "A", None), ("series-a/a18", "A18", "A", None),
    ("series-a/a79-5g", "A79 5G", "A", None), ("series-a/a60", "A60", "A", None),
    ("series-reno/reno10", "Reno10 5G", "Reno", None), ("series-reno/reno10-pro", "Reno10 Pro 5G", "Reno", None),
    ("series-reno/reno10-pro-plus", "Reno10 Pro+ 5G", "Reno", None),
    ("series-find-n/find-n3", "Find N3", "Find N", "foldable"), ("series-find-n/find-n3-flip", "Find N3 Flip", "Find N", "foldable"),
    ("series-reno/reno11", "Reno11 5G", "Reno", None), ("series-reno/reno11-pro", "Reno11 Pro 5G", "Reno", None),
    ("series-reno/reno11-f-5g", "Reno11 F 5G", "Reno", None),
    ("series-a/a3-pro-5g", "A3 Pro 5G", "A", None), ("series-a/a3", "A3", "A", None), ("series-a/a3x", "A3x", "A", None),
    ("series-a/a3-5g", "A3 5G", "A", None),
    ("series-reno/reno12", "Reno12 5G", "Reno", None), ("series-reno/reno12-pro", "Reno12 Pro 5G", "Reno", None),
    ("series-reno/reno12-f-5g", "Reno12 F 5G", "Reno", None),
    ("series-find-x/find-x8", "Find X8", "Find X", None), ("series-find-x/find-x8-pro", "Find X8 Pro", "Find X", None),
    ("series-reno/reno13", "Reno13 5G", "Reno", None), ("series-reno/reno13-pro", "Reno13 Pro 5G", "Reno", None),
    ("series-reno/reno13-f-5g", "Reno13 F 5G", "Reno", None),
    ("series-find-n/find-n5", "Find N5", "Find N", "foldable"),
    ("series-a/a5-pro", "A5 Pro", "A", None), ("series-a/a5-pro-5g", "A5 Pro 5G", "A", None),
    ("series-a/a5", "A5", "A", None), ("series-a/a5-5g", "A5 5G", "A", None), ("series-a/a5i", "A5i", "A", None),
    ("series-a/a5i-pro-5g", "A5i Pro 5G", "A", None),
    ("series-reno/reno14", "Reno14 5G", "Reno", None), ("series-reno/reno14-pro", "Reno14 Pro 5G", "Reno", None),
    ("series-reno/reno14-f-5g", "Reno14 F 5G", "Reno", None),
    ("series-find-x/find-x9", "Find X9", "Find X", None),
    ("series-a/a6-pro-5g", "A6 Pro 5G", "A", None), ("series-a/a6x", "A6x", "A", None), ("series-a/a6x-5g", "A6x 5G", "A", None),
    ("series-a/a6t-5g", "A6t 5G", "A", None), ("series-a/a6-5g", "A6 5G", "A", None), ("series-a/a6c", "A6c", "A", None),
    ("series-reno/reno15", "Reno15 5G", "Reno", None), ("series-reno/reno15-pro", "Reno15 Pro 5G", "Reno", None),
    ("series-reno/reno15-f", "Reno15 F 5G", "Reno", None),
    ("series-find-n/find-n6", "Find N6", "Find N", "foldable"),
    ("series-find-x/find-x9-ultra", "Find X9 Ultra", "Find X", None), ("series-find-x/find-x9s", "Find X9s", "Find X", None),
    ("series-reno/reno16", "Reno16 5G", "Reno", None), ("series-reno/reno16-pro", "Reno16 Pro 5G", "Reno", None),
    ("series-reno/reno16-f", "Reno16 F 5G", "Reno", None),
    ("series-a/a7-pro-max", "A7 Pro Max", "A", None),
]:
    base = slug.split("/")[1]
    C.append(d("oppo", "oppo-" + base, "OPPO " + name, series=series, form=form, spec=[OPPO.format(slug)], q="Oppo " + name))
for slug, name in [("watch-x", "Watch X"), ("watch-x2", "Watch X2"), ("watch-x2-mini", "Watch X2 Mini"), ("watch-s", "Watch S"), ("watch-x3", "Watch X3")]:
    C.append(d("oppo", "oppo-" + slug, "OPPO " + name, "smartwatch", "Watch", spec=[OPPO_ACC.format(slug)], q="Oppo " + name))
C.append(d("oppo", "oppo-band-2", "OPPO Band 2", "band", "Band", spec=[OPPO_ACC.format("band2")], q="Oppo Band 2"))

# ------------------------------------------------------------------ HONOR (official MY pages; 30 s crawl delay)
for slug, name, series, form in [
    ("honor-x7a", "X7a", "X", None), ("honor-x8a", "X8a", "X", None), ("honor-x8a-5g", "X8a 5G", "X", None), ("honor-x9a", "X9a", "X", None),
    ("honor-magic5-pro", "Magic5 Pro", "Magic", None), ("honor-magic5", "Magic5", "Magic", None),
    ("honor-magic-vs", "Magic Vs", "Magic V", "foldable"),
    ("honor-90", "90", "Number", None), ("honor-90-lite", "90 Lite", "Number", None),
    ("honor-x6a", "X6a", "X", None), ("honor-x5-plus", "X5 Plus", "X", None), ("honor-x9b", "X9b", "X", None),
    ("honor-x8b", "X8b", "X", None), ("honor-x7b", "X7b", "X", None), ("honor-x7b-5g", "X7b 5G", "X", None),
    ("honor-x6b", "X6b", "X", None), ("honor-x5b-plus", "X5b Plus", "X", None),
    ("honor-magic-v2", "Magic V2", "Magic V", "foldable"), ("honor-magic6-pro", "Magic6 Pro", "Magic", None),
    ("honor-magic6-rsr-porsche-design", "Magic6 RSR Porsche Design", "Magic", None),
    ("honor-magic-v2-rsr-porsche-design", "Magic V2 RSR Porsche Design", "Magic V", "foldable"),
    ("honor-200", "200", "Number", None), ("honor-200-pro", "200 Pro", "Number", None), ("honor-200-lite", "200 Lite", "Number", None),
    ("honor-200-smart", "200 Smart", "Number", None), ("honor-magic-v3", "Magic V3", "Magic V", "foldable"),
    ("honor-x9c", "X9c", "X", None), ("honor-x7c", "X7c", "X", None), ("honor-x9c-smart", "X9c Smart", "X", None),
    ("honor-magic7-pro", "Magic7 Pro", "Magic", None), ("honor-magic7-rsr-porsche-design", "Magic7 RSR Porsche Design", "Magic", None),
    ("honor-400-lite", "400 Lite", "Number", None), ("honor-400", "400", "Number", None), ("honor-400-pro", "400 Pro", "Number", None),
    ("honor-x6c", "X6c", "X", None), ("honor-magic-v5", "Magic V5", "Magic V", "foldable"), ("honor-x9d", "X9d", "X", None),
    ("honor-x7d", "X7d", "X", None), ("honor-x7d-5g", "X7d 5G", "X", None), ("honor-x5d", "X5d", "X", None),
    ("honor-x5d-plus", "X5d Plus", "X", None), ("honor-400-smart-5g", "400 Smart 5G", "Number", None),
    ("honor-x7e", "X7e", "X", None), ("honor-x6e", "X6e", "X", None), ("honor-500-smart-5g", "500 Smart 5G", "Number", None),
    ("honor-600", "600", "Number", None), ("honor-600-pro", "600 Pro", "Number", None), ("honor-600-lite", "600 Lite", "Number", None),
    ("honor-magic-v6", "Magic V6", "Magic V", "foldable"), ("honor-play10", "Play10", "Play", None), ("honor-x9e-pro", "X9e Pro", "X", None),
]:
    C.append(d("honor", slug, "HONOR " + name, series=series, form=form, spec=[HONOR.format(slug)], q="Honor " + name))
for slug, name, cat in [("honor-watch-4", "Watch 4", "smartwatch"), ("honor-band-9", "Band 9", "band"), ("honor-watch-5", "Watch 5", "smartwatch"),
                        ("honor-band-10", "Band 10", "band"), ("honor-watch-5-ultra", "Watch 5 Ultra", "smartwatch"),
                        ("honor-watch-x5i", "Watch X5i", "smartwatch"), ("honor-watch-fit", "Watch Fit", "smartwatch"),
                        ("honor-watch-6", "Watch 6", "smartwatch"), ("honor-watch-x5-play", "Watch X5 Play", "smartwatch")]:
    C.append(d("honor", slug, "HONOR " + name, cat, "Watch" if cat == "smartwatch" else "Band", spec=[HONOR_W.format(slug)], q="Honor " + name))

# ------------------------------------------------------------------ HUAWEI (MY page, else global page)
for slug, name, series, form in [
    ("p60-pro", "P60 Pro", "P", None), ("mate-x3", "Mate X3", "Mate X", "foldable"), ("nova11", "nova 11", "nova", None),
    ("nova11-pro", "nova 11 Pro", "nova", None), ("nova-11i", "nova 11i", "nova", None), ("nova-y72", "nova Y72", "nova Y", None),
    ("nova-12i", "nova 12i", "nova", None), ("nova-12s", "nova 12s", "nova", None), ("nova12-se", "nova 12 SE", "nova", None),
    ("pura70", "Pura 70", "Pura", None), ("pura70-pro", "Pura 70 Pro", "Pura", None), ("pura70-ultra", "Pura 70 Ultra", "Pura", None),
    ("mate-x6", "Mate X6", "Mate X", "foldable"), ("mate-xt-ultimate-design", "Mate XT Ultimate Design", "Mate X", "foldable"),
    ("nova13", "nova 13", "nova", None), ("nova13-pro", "nova 13 Pro", "nova", None),
    ("pura80", "Pura 80", "Pura", None), ("pura80-pro", "Pura 80 Pro", "Pura", None),
    ("nova14", "nova 14", "nova", None), ("nova14-pro", "nova 14 Pro", "nova", None), ("nova-14i", "nova 14i", "nova", None),
    ("mate-x7", "Mate X7", "Mate X", "foldable"), ("mate80-pro", "Mate 80 Pro", "Mate", None), ("nova15-max", "nova 15 Max", "nova", None),
    ("pura90s-pro", "Pura 90s Pro", "Pura", None), ("pura90s-pro-max", "Pura 90s Pro Max", "Pura", None),
]:
    C.append(d("huawei", "huawei-" + slug.replace("nova", "nova-").replace("--", "-").replace("pura", "pura-").replace("mate80", "mate-80").replace("p60", "p60"),
               "HUAWEI " + name, series=series, form=form, spec=[HW.format(slug), HW_G.format(slug)], q="Huawei " + name))
for slug, name, cat in [
    ("watch-gt-cyber", "Watch GT Cyber", "smartwatch"), ("watch-gt4", "Watch GT 4", "smartwatch"), ("watch-4-series", "Watch 4 Pro", "smartwatch"),
    ("band8", "Band 8", "band"), ("watch-fit3", "Watch Fit 3", "smartwatch"), ("watch-gt5", "Watch GT 5", "smartwatch"),
    ("watch-gt5-pro", "Watch GT 5 Pro", "smartwatch"), ("watch-d2", "Watch D2", "smartwatch"), ("band9", "Band 9", "band"),
    ("band10", "Band 10", "band"), ("watch-fit4", "Watch Fit 4", "smartwatch"), ("watch-fit4-pro", "Watch Fit 4 Pro", "smartwatch"),
    ("watch-5", "Watch 5", "smartwatch"), ("watch-gt6", "Watch GT 6", "smartwatch"), ("watch-gt6-pro", "Watch GT 6 Pro", "smartwatch"),
    ("watch-ultimate-2", "Watch Ultimate 2", "smartwatch"), ("watch-fit5", "Watch Fit 5", "smartwatch"), ("watch-fit5-pro", "Watch Fit 5 Pro", "smartwatch"),
    ("band11", "Band 11", "band"), ("band11-pro", "Band 11 Pro", "band"), ("watch-gt-runner-2", "Watch GT Runner 2", "smartwatch"),
]:
    C.append(d("huawei", "huawei-" + slug.replace("band", "band-").replace("gt4", "gt-4").replace("gt5", "gt-5").replace("gt6", "gt-6").replace("fit3", "fit-3").replace("fit4", "fit-4").replace("fit5", "fit-5").replace("--", "-"),
               "HUAWEI " + name, cat, "Watch" if cat == "smartwatch" else "Band", spec=[HW_W.format(slug), HW_WG.format(slug)], q="Huawei " + name))

# ------------------------------------------------------------------ vivo and iQOO (param pages)
for slug, name, series, form in [
    ("x90", "X90", "X", None), ("x90-pro", "X90 Pro", "X", None), ("v27e", "V27e", "V", None), ("v27", "V27", "V", None),
    ("y02t", "Y02t", "Y", None), ("y36", "Y36", "Y", None), ("y36-5g", "Y36 5G", "Y", None), ("y27", "Y27", "Y", None),
    ("y27-5g", "Y27 5G", "Y", None), ("y78-5g", "Y78 5G", "Y", None), ("y17s", "Y17s", "Y", None), ("v29", "V29", "V", None),
    ("v29e", "V29e", "V", None), ("y27s", "Y27s", "Y", None), ("y03", "Y03", "Y", None),
    ("x100", "X100", "X", None), ("x100pro", "X100 Pro", "X", None), ("y100-5g", "Y100 5G", "Y", None),
    ("v30", "V30", "V", None), ("v30pro", "V30 Pro", "V", None), ("v30e", "V30e", "V", None), ("y18", "Y18", "Y", None),
    ("y28", "Y28", "Y", None), ("y38-5g", "Y38 5G", "Y", None), ("v40", "V40", "V", None), ("v40-pro", "V40 Pro", "V", None),
    ("v40e", "V40e", "V", None), ("v40-lite", "V40 Lite", "V", None), ("y19s", "Y19s", "Y", None), ("y28s-5g", "Y28s 5G", "Y", None),
    ("x200", "X200", "X", None), ("v50", "V50", "V", None), ("v50-lite-5g", "V50 Lite 5G", "V", None), ("v50-lite", "V50 Lite", "V", None),
    ("y04", "Y04", "Y", None), ("y29", "Y29", "Y", None), ("y39-5g", "Y39 5G", "Y", None), ("y19e", "Y19e", "Y", None),
    ("x200-fe", "X200 FE", "X", None), ("x-fold5", "X Fold5", "X Fold", "foldable"), ("v60", "V60", "V", None),
    ("v60-lite-5g", "V60 Lite 5G", "V", None), ("v60-lite", "V60 Lite", "V", None), ("y29s", "Y29s", "Y", None),
    ("y21d", "Y21d", "Y", None), ("v70", "V70", "V", None), ("v70-fe", "V70 FE", "V", None), ("x300-ultra", "X300 Ultra", "X", None),
    ("x300-fe", "X300 FE", "X", None), ("y31s-5g", "Y31s 5G", "Y", None), ("v80-lite-5g", "V80 Lite 5G", "V", None),
]:
    C.append(d("vivo", "vivo-" + slug.replace("pro", "-pro").replace("--", "-"), "vivo " + name, series=series, form=form, spec=[VIVO.format(slug)], q="vivo " + name))
for slug, name in [("watch-gt", "Watch GT"), ("watch-gt-2", "Watch GT 2")]:
    C.append(d("vivo", "vivo-" + slug, "vivo " + name, "smartwatch", "Watch", spec=[VIVO.format(slug)], q="vivo " + name))
for slug, name in [("iqoo-11", "iQOO 11"), ("z7", "iQOO Z7"), ("z7x", "iQOO Z7x"), ("iqoo-12", "iQOO 12"), ("z9", "iQOO Z9"),
                   ("z9x", "iQOO Z9x"), ("iqoo-13", "iQOO 13"), ("neo-10", "iQOO Neo 10"), ("z10-5g", "iQOO Z10"), ("z10x", "iQOO Z10x"),
                   ("z11", "iQOO Z11"), ("z11x", "iQOO Z11x"), ("iqoo-15r", "iQOO 15R")]:
    C.append(d("iqoo", "iqoo-" + slug.replace("iqoo-", "").replace("-5g", ""), name, series="iQOO", spec=[IQOO.format(slug)], q=name))

# ------------------------------------------------------------------ Xiaomi, Redmi, POCO (mi.com MY, else global)
for slug, name, brand, series, form in [
    ("poco-x5-5g", "POCO X5 5G", "poco", "X", None), ("poco-x5-pro-5g", "POCO X5 Pro 5G", "poco", "X", None),
    ("xiaomi-13", "Xiaomi 13", "xiaomi", "Number", None), ("xiaomi-13-pro", "Xiaomi 13 Pro", "xiaomi", "Number", None),
    ("redmi-12c", "Redmi 12C", "redmi", "Redmi", None), ("redmi-note-12", "Redmi Note 12", "redmi", "Redmi Note", None),
    ("redmi-note-12-5g", "Redmi Note 12 5G", "redmi", "Redmi Note", None), ("redmi-note-12-pro-5g", "Redmi Note 12 Pro 5G", "redmi", "Redmi Note", None),
    ("redmi-note-12-pro-plus-5g", "Redmi Note 12 Pro+ 5G", "redmi", "Redmi Note", None), ("redmi-a2-plus", "Redmi A2+", "redmi", "Redmi A", None),
    ("poco-f5", "POCO F5", "poco", "F", None), ("poco-f5-pro", "POCO F5 Pro", "poco", "F", None),
    ("redmi-note-12s", "Redmi Note 12S", "redmi", "Redmi Note", None), ("redmi-note-12-pro", "Redmi Note 12 Pro", "redmi", "Redmi Note", None),
    ("xiaomi-13-ultra", "Xiaomi 13 Ultra", "xiaomi", "Number", None), ("redmi-12", "Redmi 12", "redmi", "Redmi", None),
    ("redmi-12-5g", "Redmi 12 5G", "redmi", "Redmi", None),
    ("xiaomi-13t", "Xiaomi 13T", "xiaomi", "T", None), ("xiaomi-13t-pro", "Xiaomi 13T Pro", "xiaomi", "T", None),
    ("poco-c65", "POCO C65", "poco", "C", None), ("redmi-13c", "Redmi 13C", "redmi", "Redmi", None),
    ("poco-m6-pro", "POCO M6 Pro", "poco", "M", None), ("redmi-note-13", "Redmi Note 13", "redmi", "Redmi Note", None),
    ("redmi-note-13-5g", "Redmi Note 13 5G", "redmi", "Redmi Note", None), ("redmi-note-13-pro", "Redmi Note 13 Pro", "redmi", "Redmi Note", None),
    ("redmi-note-13-pro-5g", "Redmi Note 13 Pro 5G", "redmi", "Redmi Note", None), ("redmi-note-13-pro-plus-5g", "Redmi Note 13 Pro+ 5G", "redmi", "Redmi Note", None),
    ("poco-x6-5g", "POCO X6 5G", "poco", "X", None), ("poco-x6-pro-5g", "POCO X6 Pro 5G", "poco", "X", None),
    ("xiaomi-14", "Xiaomi 14", "xiaomi", "Number", None), ("xiaomi-14-ultra", "Xiaomi 14 Ultra", "xiaomi", "Number", None),
    ("redmi-a3", "Redmi A3", "redmi", "Redmi A", None), ("redmi-13c-5g", "Redmi 13C 5G", "redmi", "Redmi", None),
    ("poco-f6", "POCO F6", "poco", "F", None), ("poco-f6-pro", "POCO F6 Pro", "poco", "F", None), ("poco-m6", "POCO M6", "poco", "M", None),
    ("redmi-13", "Redmi 13", "redmi", "Redmi", None), ("redmi-14c", "Redmi 14C", "redmi", "Redmi", None),
    ("xiaomi-14t", "Xiaomi 14T", "xiaomi", "T", None), ("xiaomi-14t-pro", "Xiaomi 14T Pro", "xiaomi", "T", None),
    ("xiaomi-mix-flip", "Xiaomi Mix Flip", "xiaomi", "Mix", "foldable"), ("poco-c75", "POCO C75", "poco", "C", None),
    ("poco-x7", "POCO X7", "poco", "X", None), ("poco-x7-pro", "POCO X7 Pro", "poco", "X", None),
    ("redmi-note-14", "Redmi Note 14", "redmi", "Redmi Note", None), ("redmi-note-14-5g", "Redmi Note 14 5G", "redmi", "Redmi Note", None),
    ("redmi-note-14-pro", "Redmi Note 14 Pro", "redmi", "Redmi Note", None), ("redmi-note-14-pro-5g", "Redmi Note 14 Pro 5G", "redmi", "Redmi Note", None),
    ("xiaomi-15", "Xiaomi 15", "xiaomi", "Number", None), ("poco-f7-pro", "POCO F7 Pro", "poco", "F", None),
    ("redmi-a5", "Redmi A5", "redmi", "Redmi A", None), ("poco-f7", "POCO F7", "poco", "F", None),
    ("redmi-15-5g", "Redmi 15 5G", "redmi", "Redmi", None), ("redmi-15", "Redmi 15", "redmi", "Redmi", None),
    ("poco-m7", "POCO M7", "poco", "M", None), ("poco-c85", "POCO C85", "poco", "C", None),
    ("xiaomi-15t", "Xiaomi 15T", "xiaomi", "T", None), ("xiaomi-15t-pro", "Xiaomi 15T Pro", "xiaomi", "T", None),
    ("poco-f8-pro", "POCO F8 Pro", "poco", "F", None), ("poco-f8-ultra", "POCO F8 Ultra", "poco", "F", None),
    ("poco-m8", "POCO M8", "poco", "M", None), ("poco-m8-pro", "POCO M8 Pro", "poco", "M", None),
    ("redmi-note-15", "Redmi Note 15", "redmi", "Redmi Note", None), ("redmi-note-15-5g", "Redmi Note 15 5G", "redmi", "Redmi Note", None),
    ("redmi-note-15-pro", "Redmi Note 15 Pro", "redmi", "Redmi Note", None), ("redmi-note-15-pro-5g", "Redmi Note 15 Pro 5G", "redmi", "Redmi Note", None),
    ("redmi-note-15-pro-plus-5g", "Redmi Note 15 Pro+ 5G", "redmi", "Redmi Note", None),
    ("xiaomi-17", "Xiaomi 17", "xiaomi", "Number", None), ("poco-x8-pro", "POCO X8 Pro", "poco", "X", None),
    ("poco-x8-pro-max", "POCO X8 Pro Max", "poco", "X", None), ("redmi-a7-pro", "Redmi A7 Pro", "redmi", "Redmi A", None),
    ("poco-c81-pro", "POCO C81 Pro", "poco", "C", None), ("xiaomi-17t", "Xiaomi 17T", "xiaomi", "T", None),
    ("xiaomi-17t-pro", "Xiaomi 17T Pro", "xiaomi", "T", None), ("redmi-17", "Redmi 17", "redmi", "Redmi", None),
    ("redmi-17-5g", "Redmi 17 5G", "redmi", "Redmi", None), ("redmi-a7", "Redmi A7", "redmi", "Redmi A", None),
    ("redmi-note-17", "Redmi Note 17", "redmi", "Redmi Note", None), ("redmi-note-17-5g", "Redmi Note 17 5G", "redmi", "Redmi Note", None),
    ("redmi-note-17-pro-5g", "Redmi Note 17 Pro 5G", "redmi", "Redmi Note", None), ("redmi-note-17-pro-max-5g", "Redmi Note 17 Pro Max 5G", "redmi", "Redmi Note", None),
    ("poco-f9-pro", "POCO F9 Pro", "poco", "F", None), ("poco-f9-ultra", "POCO F9 Ultra", "poco", "F", None),
    ("poco-x8", "POCO X8", "poco", "X", None), ("poco-m8s-5g", "POCO M8s 5G", "poco", "M", None),
    ("leica-leitzphone-powered-by-xiaomi", "Leica Leitzphone powered by Xiaomi", "xiaomi", "Leica", None),
]:
    C.append(d(brand, slug, name, series=series, form=form, spec=[MI.format(slug), MI_G.format(slug)], q=name))
for slug, name, cat in [
    ("redmi-watch-3", "Redmi Watch 3", "smartwatch"), ("redmi-watch-3-active", "Redmi Watch 3 Active", "smartwatch"),
    ("xiaomi-smart-band-8", "Xiaomi Smart Band 8", "band"), ("xiaomi-smart-band-8-active", "Xiaomi Smart Band 8 Active", "band"),
    ("xiaomi-smart-band-8-pro", "Xiaomi Smart Band 8 Pro", "band"), ("xiaomi-watch-2-pro", "Xiaomi Watch 2 Pro", "smartwatch"),
    ("redmi-watch-4", "Redmi Watch 4", "smartwatch"), ("xiaomi-watch-s3", "Xiaomi Watch S3", "smartwatch"),
    ("xiaomi-smart-band-9", "Xiaomi Smart Band 9", "band"), ("xiaomi-smart-band-9-active", "Xiaomi Smart Band 9 Active", "band"),
    ("xiaomi-smart-band-9-pro", "Xiaomi Smart Band 9 Pro", "band"), ("redmi-watch-5-active", "Redmi Watch 5 Active", "smartwatch"),
    ("redmi-watch-5-lite", "Redmi Watch 5 Lite", "smartwatch"), ("redmi-watch-5", "Redmi Watch 5", "smartwatch"),
    ("xiaomi-watch-s4", "Xiaomi Watch S4", "smartwatch"), ("xiaomi-smart-band-10", "Xiaomi Smart Band 10", "band"),
    ("xiaomi-watch-2", "Xiaomi Watch 2", "smartwatch"), ("xiaomi-smart-band-11-active", "Xiaomi Smart Band 11 Active", "band"),
    ("redmi-watch-6", "Redmi Watch 6", "smartwatch"), ("redmi-watch-6-active", "Redmi Watch 6 Active", "smartwatch"),
    ("redmi-watch-6-lite", "Redmi Watch 6 Lite", "smartwatch"), ("xiaomi-smart-band-10-pro", "Xiaomi Smart Band 10 Pro", "band"),
    ("xiaomi-watch-s4-41mm", "Xiaomi Watch S4 41mm", "smartwatch"), ("xiaomi-watch-5", "Xiaomi Watch 5", "smartwatch"),
    ("xiaomi-smart-band-11", "Xiaomi Smart Band 11", "band"),
]:
    brand = "redmi" if slug.startswith("redmi") else "xiaomi"
    C.append(d(brand, slug, name, cat, "Watch" if cat == "smartwatch" else "Band", spec=[MI.format(slug), MI_G.format(slug)], q=name))

# ------------------------------------------------------------------ Samsung (current MY SKU page; older ones fall back to launch coverage)
SAM = [
    ("galaxy-s23", "Galaxy S23", "Galaxy S", None), ("galaxy-s23-plus", "Galaxy S23+", "Galaxy S", None), ("galaxy-s23-ultra", "Galaxy S23 Ultra", "Galaxy S", None),
    ("galaxy-a14", "Galaxy A14", "Galaxy A", None), ("galaxy-a14-5g", "Galaxy A14 5G", "Galaxy A", None), ("galaxy-a34-5g", "Galaxy A34 5G", "Galaxy A", None),
    ("galaxy-a54-5g", "Galaxy A54 5G", "Galaxy A", None), ("galaxy-a24", "Galaxy A24", "Galaxy A", None), ("galaxy-m14-5g", "Galaxy M14 5G", "Galaxy M", None),
    ("galaxy-z-flip5", "Galaxy Z Flip5", "Galaxy Z", "foldable"), ("galaxy-z-fold5", "Galaxy Z Fold5", "Galaxy Z", "foldable"),
    ("galaxy-s23-fe", "Galaxy S23 FE", "Galaxy S", None), ("galaxy-m34-5g", "Galaxy M34 5G", "Galaxy M", None),
    ("galaxy-a05", "Galaxy A05", "Galaxy A", None), ("galaxy-a05s", "Galaxy A05s", "Galaxy A", None), ("galaxy-m54-5g", "Galaxy M54 5G", "Galaxy M", None),
    ("galaxy-a15", "Galaxy A15", "Galaxy A", None), ("galaxy-a15-5g", "Galaxy A15 5G", "Galaxy A", None), ("galaxy-a25-5g", "Galaxy A25 5G", "Galaxy A", None),
    ("galaxy-s24", "Galaxy S24", "Galaxy S", None), ("galaxy-s24-plus", "Galaxy S24+", "Galaxy S", None), ("galaxy-s24-ultra", "Galaxy S24 Ultra", "Galaxy S", None),
    ("galaxy-a35-5g", "Galaxy A35 5G", "Galaxy A", None), ("galaxy-a55-5g", "Galaxy A55 5G", "Galaxy A", None),
    ("galaxy-z-fold6", "Galaxy Z Fold6", "Galaxy Z", "foldable"), ("galaxy-z-flip6", "Galaxy Z Flip6", "Galaxy Z", "foldable"),
    ("galaxy-s24-fe", "Galaxy S24 FE", "Galaxy S", None), ("galaxy-a06", "Galaxy A06", "Galaxy A", None), ("galaxy-a16-5g", "Galaxy A16 5G", "Galaxy A", None),
    ("galaxy-a16", "Galaxy A16", "Galaxy A", None),
    ("galaxy-s25", "Galaxy S25", "Galaxy S", None), ("galaxy-s25-plus", "Galaxy S25+", "Galaxy S", None), ("galaxy-s25-edge", "Galaxy S25 Edge", "Galaxy S", None),
    ("galaxy-a36-5g", "Galaxy A36 5G", "Galaxy A", None), ("galaxy-a26-5g", "Galaxy A26 5G", "Galaxy A", None),
    ("galaxy-z-fold7", "Galaxy Z Fold7", "Galaxy Z", "foldable"), ("galaxy-z-flip7", "Galaxy Z Flip7", "Galaxy Z", "foldable"),
    ("galaxy-z-flip7-fe", "Galaxy Z Flip7 FE", "Galaxy Z", "foldable"), ("galaxy-s25-fe", "Galaxy S25 FE", "Galaxy S", None),
    ("galaxy-a06-5g", "Galaxy A06 5G", "Galaxy A", None), ("galaxy-a07", "Galaxy A07", "Galaxy A", None), ("galaxy-a07-5g", "Galaxy A07 5G", "Galaxy A", None),
    ("galaxy-a17", "Galaxy A17", "Galaxy A", None), ("galaxy-a17-5g", "Galaxy A17 5G", "Galaxy A", None),
    ("galaxy-s26-plus", "Galaxy S26+", "Galaxy S", None), ("galaxy-a57-5g", "Galaxy A57 5G", "Galaxy A", None), ("galaxy-a37-5g", "Galaxy A37 5G", "Galaxy A", None),
    ("galaxy-a27-5g", "Galaxy A27 5G", "Galaxy A", None), ("galaxy-z-fold8-ultra", "Galaxy Z Fold8 Ultra", "Galaxy Z", "foldable"),
    ("galaxy-z-flip8", "Galaxy Z Flip8", "Galaxy Z", "foldable"), ("galaxy-s26-fe", "Galaxy S26 FE", "Galaxy S", None),
    ("galaxy-a08", "Galaxy A08", "Galaxy A", None), ("galaxy-a07s", "Galaxy A07s", "Galaxy A", None),
]
for slug, name, series, form in SAM:
    C.append(d("samsung", "samsung-" + slug, "Samsung " + name, series=series, form=form, spec=[], q="Samsung " + name))
for slug, name, cat in [("galaxy-watch6", "Galaxy Watch6", "smartwatch"), ("galaxy-watch6-classic", "Galaxy Watch6 Classic", "smartwatch"),
                        ("galaxy-fit3", "Galaxy Fit3", "band"), ("galaxy-watch7", "Galaxy Watch7", "smartwatch"), ("galaxy-watch-ultra", "Galaxy Watch Ultra", "smartwatch"),
                        ("galaxy-watch-fe", "Galaxy Watch FE", "smartwatch"), ("galaxy-watch8", "Galaxy Watch8", "smartwatch"),
                        ("galaxy-watch-ultra-2025", "Galaxy Watch Ultra (2025)", "smartwatch"), ("galaxy-watch9", "Galaxy Watch9", "smartwatch"),
                        ("galaxy-watch-ultra2", "Galaxy Watch Ultra 2", "smartwatch")]:
    C.append(d("samsung", "samsung-" + slug, "Samsung " + name, cat, "Galaxy Watch" if cat == "smartwatch" else "Galaxy Fit", spec=[], q="Samsung " + name))

# ------------------------------------------------------------------ Apple (apple.com/my specs for current models, support tech specs for older)
for slug, name, form in [("iphone-15", "iPhone 15", None), ("iphone-15-plus", "iPhone 15 Plus", None), ("iphone-15-pro", "iPhone 15 Pro", None),
                         ("iphone-15-pro-max", "iPhone 15 Pro Max", None), ("iphone-16", "iPhone 16", None), ("iphone-16-plus", "iPhone 16 Plus", None),
                         ("iphone-16-pro", "iPhone 16 Pro", None), ("iphone-16e", "iPhone 16e", None), ("iphone-air", "iPhone Air", None),
                         ("iphone-17e", "iPhone 17e", None), ("iphone-18-pro", "iPhone 18 Pro", None), ("iphone-duo", "iPhone Duo", "foldable")]:
    C.append(d("apple", "apple-" + slug, "Apple " + name, series="iPhone", form=form, spec=[], q=name))
for slug, name in [("watch-series-9", "Apple Watch Series 9"), ("watch-ultra-2", "Apple Watch Ultra 2"), ("watch-series-10", "Apple Watch Series 10"),
                   ("watch-se-3", "Apple Watch SE 3"), ("watch-series-12", "Apple Watch Series 12"), ("watch-ultra-4", "Apple Watch Ultra 4")]:
    C.append(d("apple", "apple-" + slug, name, "smartwatch", "Apple Watch", spec=[], q=name))

if __name__ == "__main__":
    import collections, pathlib
    existing = {p.stem for p in pathlib.Path(__file__).resolve().parents[2] / "data" / "devices".rglob("*.json")}
    ids = collections.Counter(x["id"] for x in C)
    dup = [k for k, v in ids.items() if v > 1]
    assert not dup, dup
    by = collections.defaultdict(list)
    for x in C:
        if x["id"] in existing:
            print("skip existing", x["id"]); continue
        by["xiaomi" if x["brand"] in ("redmi", "poco") else "vivo" if x["brand"] == "iqoo" else x["brand"]].append(x)
    for b, xs in by.items():
        pathlib.Path(f"catalog_{b}.json").write_text(json.dumps(xs, indent=1), encoding="utf-8")
        print(b, len(xs), collections.Counter(x["category"] for x in xs))
    print("total", sum(len(v) for v in by.values()))
