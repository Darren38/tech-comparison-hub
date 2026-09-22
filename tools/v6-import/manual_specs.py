"""Hand-written specs, each value read from the named source (reviewed; see spec_show.py output)."""
import json
from extract import extract

N_SOYA, N_LOWY, N_NASI = "soyacincau", "lowyat", "nasilemaktech"
ART = "The maker no longer publishes a specification page for this model. Key specs were taken from this Malaysian launch report, which gives the maker's figures."
M = {}


def art(did, site, url, specs):
    M[did] = {"specs": specs, "source": {"class": "news", "source": site, "url": url, "note": ART}}


def off(did, src, url, note, specs):
    M[did] = {"specs": specs, "source": {"class": "official", "source": src, "url": url, "note": note}}


def cam(*mps, roles=None):
    roles = roles or ["main", "ultrawide", "macro"]
    return [{"role": r, "mp": m} for r, m in zip(roles, mps)]


# ---- Huawei phones (Huawei Malaysia removed these pages; the English global pages are gone too)
art("huawei-p60-pro", N_SOYA, "https://soyacincau.com/2023/05/11/huawei-p60-pro-malaysia-official-price-specs/", {
    "display": {"size_in": 6.67, "type": "LTPO OLED", "resolution": "2700 × 1220", "refresh_hz": 120},
    "platform": {"chipset_name": "Snapdragon 8+ Gen 1"}, "memory": {"ram_gb": [8, 12], "storage_gb": [256, 512]},
    "battery": {"capacity_mah": 4815}, "charging": {"wired_w": 88, "wireless_w": 50},
    "camera": {"rear": cam(48, 13, 48, roles=["main", "ultrawide", "periscope"]), "zoom_optical_x": 3.5, "front": "13 MP"},
    "build": {"ip": "IP68"}, "connectivity": {"cellular": "4G"}, "software": {"launch_os": "EMUI 13.1 (Android 13 base)"}})
art("huawei-mate-x3", N_LOWY, "https://www.lowyat.net/2023/300044/huawei-mate-x3-malaysia/", {
    "display": {"size_in": 7.85, "type": "OLED", "refresh_hz": 120}, "platform": {"chipset_name": "Snapdragon 8+ Gen 1"},
    "memory": {"ram_gb": [12], "storage_gb": [512]}, "battery": {"capacity_mah": 4800}, "charging": {"wired_w": 66, "wireless_w": 50},
    "camera": {"rear": cam(50, 13, 12, roles=["main", "ultrawide", "periscope"]), "front": "8 MP"},
    "build": {"ip": "IPX8"}, "connectivity": {"cellular": "4G", "nfc": True}})
N11 = "https://www.lowyat.net/2023/303228/huawei-nova-11-series-malaysia-launch/"
art("huawei-nova-11", N_LOWY, N11, {
    "display": {"size_in": 6.7, "type": "OLED", "resolution": "2412 × 1084", "refresh_hz": 120}, "platform": {"chipset_name": "Snapdragon 778G 4G"},
    "memory": {"ram_gb": [8], "storage_gb": [256]}, "battery": {"capacity_mah": 4500}, "charging": {"wired_w": 66},
    "camera": {"rear": cam(50, 8), "front": "60 MP"}, "build": {"dimensions": {"height_mm": 161.29, "width_mm": 74.96, "depth_mm": 6.88}, "weight_g": 168},
    "connectivity": {"cellular": "4G", "nfc": True}})
art("huawei-nova-11-pro", N_SOYA, "https://soyacincau.com/2023/07/06/huawei-nova-11-pro-malaysia-60mp-ultra-wide-selfie-camera-snapdragon-778g-wrapped-in-vegan-leather/", {
    "display": {"size_in": 6.78, "type": "OLED", "resolution": "2652 × 1200", "refresh_hz": 120}, "platform": {"chipset_name": "Snapdragon 778G 4G"},
    "memory": {"ram_gb": [8], "storage_gb": [256]}, "battery": {"capacity_mah": 4500}, "charging": {"wired_w": 100},
    "camera": {"rear": cam(50, 8), "front": "60 MP + 8 MP"}, "build": {"dimensions": {"height_mm": 164.24, "width_mm": 74.35, "depth_mm": 7.88}, "weight_g": 188},
    "connectivity": {"cellular": "4G"}, "software": {"launch_os": "EMUI 13"}})
M["huawei-nova-11-pro"]["field_sources"] = {"specs.build": {"class": "news", "source": N_LOWY, "url": N11}}
art("huawei-nova-11i", N_LOWY, N11, {
    "display": {"size_in": 6.8, "type": "LCD", "resolution": "2388 × 1080", "refresh_hz": 90}, "platform": {"chipset_name": "Snapdragon 680"},
    "memory": {"ram_gb": [8], "storage_gb": [256]}, "battery": {"capacity_mah": 5000}, "charging": {"wired_w": 40},
    "camera": {"rear": cam(48, 2, roles=["main", "depth"]), "front": "16 MP"}, "build": {"dimensions": {"height_mm": 164.6, "width_mm": 75.55, "depth_mm": 8.55}, "weight_g": 193},
    "connectivity": {"cellular": "4G", "nfc": False}})
art("huawei-nova-y72", N_LOWY, "https://www.lowyat.net/2024/316448/huawei-nova-y72-rm899-malaysia/", {
    "display": {"size_in": 6.75, "type": "LCD", "refresh_hz": 60}, "memory": {"ram_gb": [8], "storage_gb": [128]},
    "battery": {"capacity_mah": 6000}, "charging": {"wired_w": 22.5}, "camera": {"rear": cam(50, 2, roles=["main", "macro"]), "front": "8 MP"}})
art("huawei-nova-12i", N_NASI, "https://nasilemaktech.com/huawei-nova-12i-launch-malaysia-price/", {
    "display": {"size_in": 6.7, "refresh_hz": 90}, "platform": {"chipset_name": "Snapdragon 680"}, "memory": {"ram_gb": [8], "storage_gb": [256]},
    "battery": {"capacity_mah": 5000}, "charging": {"wired_w": 40}, "camera": {"rear": cam(108, 2, roles=["main", "depth"]), "front": "8 MP"}})
N12 = "https://www.lowyat.net/2024/318963/huawei-nova-12s-12-se-12i/"
art("huawei-nova-12s", N_LOWY, N12, {
    "display": {"size_in": 6.7, "type": "OLED", "refresh_hz": 120}, "platform": {"chipset_name": "Snapdragon 778G 4G"}, "memory": {"ram_gb": [8]},
    "battery": {"capacity_mah": 4500}, "charging": {"wired_w": 66}, "camera": {"rear": cam(50, 8), "front": "60 MP"}, "connectivity": {"cellular": "4G"}})
art("huawei-nova-12-se", N_LOWY, N12, {
    "display": {"size_in": 6.67, "type": "OLED", "refresh_hz": 90}, "platform": {"chipset_name": "Snapdragon 680"},
    "battery": {"capacity_mah": 4500}, "charging": {"wired_w": 66}, "camera": {"rear": cam(108, 8, 2), "front": "32 MP"}, "connectivity": {"cellular": "4G"}})
P70 = "https://www.lowyat.net/2024/321475/huawei-pura-70-series-malaysia/"
art("huawei-pura-70", N_LOWY, P70, {
    "display": {"size_in": 6.6, "type": "LTPO OLED", "refresh_hz": 120}, "platform": {"chipset_name": "Kirin 9010"}, "memory": {"ram_gb": [12], "storage_gb": [256]},
    "battery": {"capacity_mah": 4900}, "charging": {"wired_w": 66, "wireless_w": 50},
    "camera": {"rear": cam(50, 13, 12, roles=["main", "ultrawide", "periscope"]), "zoom_optical_x": 5}, "build": {"ip": "IP68"}})
art("huawei-pura-70-pro", N_LOWY, P70, {
    "display": {"size_in": 6.8, "type": "LTPO OLED", "refresh_hz": 120, "peak_nits": 2500}, "platform": {"chipset_name": "Kirin 9010"}, "memory": {"ram_gb": [12], "storage_gb": [512]},
    "battery": {"capacity_mah": 5050}, "charging": {"wired_w": 100, "wireless_w": 80},
    "camera": {"rear": cam(50, 12.5, 48, roles=["main", "ultrawide", "telephoto"]), "zoom_optical_x": 3.5}, "build": {"ip": "IP68"}})
art("huawei-pura-70-ultra", N_LOWY, P70, {
    "display": {"size_in": 6.8, "type": "LTPO OLED", "refresh_hz": 120, "peak_nits": 2500}, "platform": {"chipset_name": "Kirin 9010"}, "memory": {"ram_gb": [16], "storage_gb": [512]},
    "battery": {"capacity_mah": 5200}, "charging": {"wired_w": 100, "wireless_w": 80},
    "camera": {"rear": cam(50, 40, 50, roles=["main", "ultrawide", "telephoto"]), "zoom_optical_x": 3.5}, "build": {"ip": "IP68"}})
art("huawei-nova-14i", N_LOWY, "https://www.lowyat.net/2025/371944/huawei-nova-14-series-pre-orders-available-in-malaysia/", {
    "display": {"size_in": 6.95, "type": "LCD", "refresh_hz": 90}, "platform": {"chipset_name": "Snapdragon 680"}, "memory": {"ram_gb": [8], "storage_gb": [256]},
    "battery": {"capacity_mah": 7000}, "camera": {"rear": cam(50, 2, roles=["main", "depth"]), "front": "8 MP"}})

# ---- Huawei wearables
art("huawei-watch-gt-cyber", N_SOYA, "https://soyacincau.com/2023/04/07/huawei-watch-gt-cyber-malaysia-smartwatch-with-interchangeable-case-costs-rm999/", {
    "display": {"size_in": 1.32, "type": "AMOLED", "resolution": "466 × 466"}, "battery": {"life_h": 168, "claim": "Up to 7 days typical use, 4 days heavy use"},
    "build": {"weight_g": 58}})
art("huawei-band-9", N_LOWY, "https://www.lowyat.net/2024/319440/huawei-band-9-malaysia/", {
    "display": {"size_in": 1.47, "type": "AMOLED"}, "battery": {"life_h": 336, "claim": "9 to 14 days"}, "build": {"water": "Water resistant to 50 m", "water_m": 50}})
HW_ALT = "Read from Huawei's {region} specification page, because Huawei Malaysia no longer lists this model; it is the same hardware. Values are for the {size} model."
off("huawei-watch-gt-4", "huawei", "https://consumer.huawei.com/ph/wearables/watch-gt4/specs/", HW_ALT.format(region="Philippines", size="46 mm"), {
    "display": {"size_mm": "46 mm", "size_in": 1.43, "type": "AMOLED", "resolution": "466 × 466"}, "battery": {"life_h": 336, "claim": "Up to 14 days"},
    "build": {"dimensions": {"height_mm": 46.0, "width_mm": 46.0, "depth_mm": 10.9}, "weight_g": 48, "case": "Stainless steel", "water": "5 ATM", "water_m": 50},
    "connectivity": {"gps": "Built-in GNSS", "nfc": True}})
off("huawei-watch-gt-5", "huawei", "https://consumer.huawei.com/ph/wearables/watch-gt5/specs/", HW_ALT.format(region="Philippines", size="46 mm"), {
    "display": {"size_mm": "46 mm", "size_in": 1.43, "type": "AMOLED", "resolution": "466 × 466"}, "battery": {"life_h": 336, "claim": "Up to 14 days"},
    "build": {"dimensions": {"height_mm": 45.8, "width_mm": 45.8, "depth_mm": 10.7}, "weight_g": 48, "water": "5 ATM, IP69K", "water_m": 50, "ip": "IP69K"},
    "connectivity": {"gps": "Dual-band GNSS", "nfc": True}})
off("huawei-watch-gt-5-pro", "huawei", "https://consumer.huawei.com/ph/wearables/watch-gt5-pro/specs/", HW_ALT.format(region="Philippines", size="46 mm"), {
    "display": {"size_mm": "46 mm", "size_in": 1.43, "type": "AMOLED", "resolution": "466 × 466"}, "battery": {"life_h": 336, "claim": "Up to 14 days"},
    "build": {"dimensions": {"height_mm": 46.3, "width_mm": 46.3, "depth_mm": 10.9}, "weight_g": 53, "case": "Titanium alloy front, ceramic back",
              "water": "5 ATM, IP69K", "water_m": 50, "ip": "IP69K"},
    "connectivity": {"gps": "Dual-band GNSS", "nfc": True}})
off("huawei-watch-fit-3", "huawei", "https://consumer.huawei.com/uk/wearables/watch-fit3/specs/", HW_ALT.format(region="UK", size="standard"), {
    "display": {"size_in": 1.82, "type": "AMOLED", "resolution": "480 × 408"}, "battery": {"life_h": 240, "claim": "Up to 10 days"},
    "build": {"dimensions": {"height_mm": 43.2, "width_mm": 36.3, "depth_mm": 9.9}, "weight_g": 26, "water": "5 ATM", "water_m": 50},
    "connectivity": {"gps": "Built-in GNSS"}})

# ---- HONOR Porsche Design editions: HONOR Malaysia pages (official), read with the standard extractor
for did in ["honor-magic6-rsr-porsche-design", "honor-magic-v2-rsr-porsche-design", "honor-magic7-rsr-porsche-design"]:
    sp = extract(open(f"cache/spec_alt/{did}.html", encoding="utf-8", errors="replace").read(), "smartphone")
    if did == "honor-magic-v2-rsr-porsche-design": sp.get("build", {}).pop("dimensions", None)
    off(did, "honor", f"https://www.honor.com/my/phones/{did}/spec/", "Read from HONOR Malaysia's specification page. Values were extracted automatically and reviewed.", sp)

# ---- Xiaomi global pages (official)
for did, url in [("xiaomi-mix-flip", "https://www.mi.com/global/product/xiaomi-mix-flip/specs/"), ("redmi-note-12s", "https://www.mi.com/global/product/redmi-note-12s/specs/")]:
    sp = extract(open(f"cache/spec_alt/{did}.html", encoding="utf-8", errors="replace").read(), "smartphone")
    if did == "xiaomi-mix-flip": sp.get("build", {}).pop("dimensions", None)
    off(did, "xiaomi", url, "Read from Xiaomi's global specification page (the Malaysian page is no longer available). Values were extracted automatically and reviewed.", sp)

# ---- OPPO / vivo / iQOO
art("oppo-reno11-f-5g", N_LOWY, "https://www.lowyat.net/2024/318720/oppo-reno11-f-5g-malaysia/", {
    "display": {"size_in": 6.7, "type": "OLED", "refresh_hz": 120, "peak_nits": 1100}, "platform": {"chipset_name": "Dimensity 7050"},
    "memory": {"ram_gb": [8], "storage_gb": [256]}, "battery": {"capacity_mah": 5000}, "charging": {"wired_w": 67},
    "camera": {"rear": cam(64, 8, 2), "front": "32 MP"}, "build": {"ip": "IP65"}, "connectivity": {"cellular": "5G", "nfc": True}})
art("oppo-a7-pro-max", N_SOYA, "https://soyacincau.com/2026/09/14/oppo-a7-pro-a7-pro-max-5g-malaysia-launch-specs-promo/", {
    "display": {"size_in": 6.78, "type": "AMOLED", "resolution": "2772 × 1272", "refresh_hz": 120, "peak_nits": 1800}, "platform": {"chipset_name": "Snapdragon 4 Gen 5"},
    "memory": {"ram_gb": [12], "storage_gb": [512]}, "battery": {"capacity_mah": 10000}, "charging": {"wired_w": 80},
    "camera": {"rear": cam(50, 2, roles=["main", "depth"]), "front": "50 MP"}, "build": {"ip": "IP69K"}, "connectivity": {"cellular": "5G"},
    "software": {"launch_os": "ColorOS 16 (Android 16 base)"}})
art("vivo-y29", N_NASI, "https://nasilemaktech.com/vivo-y29-y39-malaysia-price/", {
    "display": {"size_in": 6.68, "type": "LCD", "refresh_hz": 120}, "platform": {"chipset_name": "Snapdragon 4 Gen 2"}, "connectivity": {"cellular": "4G"}})
art("vivo-watch-gt", N_LOWY, "https://www.lowyat.net/2025/357149/vivo-x200-fe-official-malaysia-for-rm3199/", {
    "battery": {"life_h": 504, "claim": "Up to 21 days"}, "connectivity": {"nfc": True}})
Z9 = "https://soyacincau.com/2024/05/10/iqoo-z9-z9x-malaysia-price-launch-specs-official/"
art("iqoo-z9", N_SOYA, Z9, {
    "display": {"size_in": 6.78, "type": "AMOLED", "resolution": "2800 × 1260", "refresh_hz": 144}, "platform": {"chipset_name": "Snapdragon 7 Gen 3"},
    "memory": {"ram_gb": [8, 12], "storage_gb": [256]}, "battery": {"capacity_mah": 6000}, "charging": {"wired_w": 80},
    "camera": {"rear": cam(50, 2, roles=["main", "depth"]), "front": "16 MP"}, "build": {"ip": "IP64"}, "software": {"launch_os": "Funtouch OS 14 (Android 14 base)"}})
art("iqoo-z9x", N_SOYA, Z9, {
    "display": {"size_in": 6.72, "type": "LCD", "refresh_hz": 120}, "platform": {"chipset_name": "Snapdragon 6 Gen 1"},
    "memory": {"ram_gb": [8, 12]}, "battery": {"capacity_mah": 6000}, "charging": {"wired_w": 44},
    "camera": {"rear": cam(50, 2, roles=["main", "depth"]), "front": "8 MP"}, "software": {"launch_os": "Funtouch OS 14 (Android 14 base)"}})

# ---- Xiaomi / Redmi / POCO
RN12 = "https://soyacincau.com/2023/04/05/redmi-note-12-series-malaysia-everything-you-need-to-know/"
art("redmi-note-12", N_SOYA, RN12, {
    "display": {"size_in": 6.67, "type": "AMOLED", "refresh_hz": 120}, "platform": {"chipset_name": "Snapdragon 685"}, "memory": {"ram_gb": [6, 8], "storage_gb": [128]},
    "battery": {"capacity_mah": 5000}, "charging": {"wired_w": 33}, "camera": {"rear": cam(50, 8, 2), "front": "13 MP"}, "build": {"weight_g": 183.5},
    "connectivity": {"cellular": "4G", "nfc": True}})
art("redmi-note-12-5g", N_SOYA, RN12, {
    "display": {"size_in": 6.67, "type": "AMOLED", "refresh_hz": 120, "peak_nits": 1200}, "platform": {"chipset_name": "Snapdragon 4 Gen 1"}, "memory": {"ram_gb": [8], "storage_gb": [256]},
    "battery": {"capacity_mah": 5000}, "charging": {"wired_w": 33}, "camera": {"rear": cam(48, 8, 2), "front": "13 MP"}, "build": {"weight_g": 189},
    "connectivity": {"cellular": "5G", "nfc": True}})
art("xiaomi-13t", N_SOYA, "https://soyacincau.com/2023/09/26/xiaomi-13t-malaysia-144hz-display-leica-cameras-and-ip68-rating-on-a-budget/", {
    "display": {"size_in": 6.67, "type": "AMOLED", "resolution": "2712 × 1220", "refresh_hz": 144, "peak_nits": 2600}, "platform": {"chipset_name": "Dimensity 8200-Ultra"},
    "memory": {"ram_gb": [8, 12], "storage_gb": [256]}, "battery": {"capacity_mah": 5000}, "charging": {"wired_w": 67},
    "camera": {"rear": cam(50, 12, 50, roles=["main", "ultrawide", "telephoto"])}, "build": {"ip": "IP68"}, "connectivity": {"cellular": "5G", "nfc": True},
    "software": {"launch_os": "MIUI 14 (Android 13 base)"}})
art("xiaomi-13t-pro", N_SOYA, "https://soyacincau.com/2023/09/26/xiaomi-13t-pro-malaysia-leica-cameras-5-years-of-updates-1tb-of-storage-and-ip68-rating/", {
    "display": {"size_in": 6.67, "type": "AMOLED", "resolution": "2712 × 1220", "refresh_hz": 144, "peak_nits": 2600}, "platform": {"chipset_name": "Dimensity 9200+"},
    "memory": {"ram_gb": [12, 16], "storage_gb": [256, 512, 1024]}, "battery": {"capacity_mah": 5000}, "charging": {"wired_w": 120},
    "camera": {"rear": cam(50, 12, 50, roles=["main", "ultrawide", "telephoto"]), "front": "20 MP"}, "build": {"ip": "IP68"}, "connectivity": {"cellular": "5G", "nfc": True},
    "software": {"launch_os": "MIUI 14 (Android 13 base)"}})
X6 = "https://soyacincau.com/2024/01/11/poco-x6-pro-x6-malaysia-xiaomi-hyperos-official-price-specs/"
art("poco-x6-5g", N_SOYA, X6, {
    "display": {"size_in": 6.67, "type": "AMOLED", "refresh_hz": 120}, "platform": {"chipset_name": "Snapdragon 7s Gen 2"}, "memory": {"ram_gb": [8, 12], "storage_gb": [256, 512]},
    "battery": {"capacity_mah": 5100}, "charging": {"wired_w": 67}, "camera": {"rear": cam(64, 8, 2), "front": "16 MP"}, "build": {"ip": "IP54"},
    "connectivity": {"cellular": "5G"}, "software": {"launch_os": "Xiaomi HyperOS (Android 14 base)"}})
art("poco-x6-pro-5g", N_SOYA, X6, {
    "display": {"size_in": 6.67, "type": "AMOLED", "refresh_hz": 120, "peak_nits": 1800}, "platform": {"chipset_name": "Dimensity 8300-Ultra"}, "memory": {"ram_gb": [8, 12], "storage_gb": [256, 512]},
    "battery": {"capacity_mah": 5000}, "charging": {"wired_w": 67}, "camera": {"rear": cam(64, 8, 2), "front": "16 MP"}, "build": {"ip": "IP54"},
    "connectivity": {"cellular": "5G", "nfc": True}, "software": {"launch_os": "Xiaomi HyperOS (Android 14 base)"}})
art("redmi-14c", N_SOYA, "https://soyacincau.com/2024/09/05/redmi-14c-budget-smartphone-with-120hz-screen-and-up-to-256gb-storage-priced-from-rm449/", {
    "display": {"size_in": 6.88, "type": "LCD", "resolution": "1640 × 720", "refresh_hz": 120}, "platform": {"chipset_name": "Helio G81 Ultra"}, "memory": {"ram_gb": [6, 8], "storage_gb": [128, 256]},
    "battery": {"capacity_mah": 5160}, "charging": {"wired_w": 18}, "camera": {"rear": cam(50, 2, roles=["main", "depth"]), "front": "13 MP"},
    "connectivity": {"cellular": "4G", "nfc": True}, "software": {"launch_os": "Xiaomi HyperOS (Android 14 base)"}})
M8 = "https://soyacincau.com/2026/01/08/poco-m8-and-m8-pro-malaysia-launch-price-specs/"
art("poco-m8", N_SOYA, M8, {
    "display": {"size_in": 6.77, "type": "AMOLED", "resolution": "2392 × 1080", "refresh_hz": 120, "peak_nits": 3200}, "platform": {"chipset_name": "Snapdragon 6 Gen 3"},
    "memory": {"ram_gb": [8], "storage_gb": [256, 512]}, "battery": {"capacity_mah": 5520}, "charging": {"wired_w": 45},
    "camera": {"rear": cam(50, 2, roles=["main", "depth"]), "front": "20 MP"}, "build": {"weight_g": 178, "ip": "IP66"}, "connectivity": {"cellular": "5G", "nfc": True}})
art("poco-m8-pro", N_SOYA, M8, {
    "display": {"size_in": 6.83, "type": "AMOLED", "resolution": "2772 × 1280", "refresh_hz": 120, "peak_nits": 3200}, "platform": {"chipset_name": "Snapdragon 7s Gen 4"},
    "memory": {"ram_gb": [8, 12], "storage_gb": [256, 512]}, "camera": {"rear": cam(50, 8, roles=["main", "ultrawide"]), "front": "32 MP"},
    "connectivity": {"cellular": "5G", "nfc": True}})

json.dump(M, open("manual_specs.json", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(len(M), "manual spec records")
