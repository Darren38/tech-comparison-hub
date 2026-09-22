"""Chipset names as written on spec pages -> chipset ids/records (existing ids reused; new ones get minimal records)."""
import re

VENDOR = [(r"^Snapdragon", "qualcomm"), (r"^(Dimensity|Helio|MediaTek)", "mediatek"), (r"^Exynos", "samsung"), (r"^Kirin", "hisilicon"),
          (r"^Tensor", "google"), (r"^Apple", "apple"), (r"^Unisoc", "unisoc")]


def clean_name(raw):
    s = re.sub(r"[™®]", "", raw or "").strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^(Qualcomm|MediaTek)\s+(?=Snapdragon|Dimensity|Helio)", "", s, flags=re.I)
    s = re.sub(r"\s*(Mobile Platform|Processor|Octa-core)$", "", s, flags=re.I)
    s = re.sub(r"(Gen)(\d)", r"\1 \2", s)                                     # "Gen3" -> "Gen 3"
    s = re.sub(r"(Snapdragon|Dimensity|Helio|Exynos|Kirin)(\d)", r"\1 \2", s)   # "Snapdragon685"
    s = re.sub(r"(Snapdragon \d)(s?) (4G )?(Gen)", lambda m: f"{m.group(1)}{m.group(2)} {m.group(3) or ''}{m.group(4)}", s)
    m = re.match(r"(?:Apple\s*)?(A\d{2})(?:\s*(Pro|Bionic))?\s*chip", s, re.I)
    if m:
        s = "Apple " + m.group(1) + (" Pro" if (m.group(2) or "").lower() == "pro" else " Bionic" if (m.group(2) or "").lower() == "bionic" else "")
    if re.match(r"^MT\d{4}$", s): s = "MediaTek " + s
    if re.match(r"^UNISOC", s, re.I): s = "Unisoc " + s.split()[-1].upper()
    s = s.replace("Snapdragon 685", "Snapdragon 685").strip()
    return s


def chip_id(name):
    n = name.lower().replace("+", "-plus").replace(" ", "-")
    n = re.sub(r"[^a-z0-9-]", "", n)
    n = re.sub(r"-+", "-", n).strip("-")
    n = n.replace("apple-a16-bionic", "apple-a16").replace("apple-a15-bionic", "apple-a15")
    return n


def vendor_of(name):
    for p, v in VENDOR:
        if re.search(p, name, re.I): return v
    return None


def family_of(name):
    m = re.match(r"(Snapdragon \d|Dimensity \d|Helio [A-Z]|Exynos \d|Kirin \d)", name)
    if not m: return None
    base = m.group(1)
    return {"Snapdragon": lambda b: f"Snapdragon {b[-1]} series", "Dimensity": lambda b: f"Dimensity {b[-1]}000",
            "Helio": lambda b: f"Helio {b[-1]}", "Exynos": lambda b: "Exynos", "Kirin": lambda b: "Kirin"}[base.split()[0]](base)


if __name__ == "__main__":
    for s in ["Snapdragon 8+ Gen 1", "Snapdragon 6s 4G Gen1", "Snapdragon 7 Gen3", "Snapdragon685", "A16 Bionic chip", "A18 Pro chip", "A19 chip", "MT6833",
              "UNISOC T7250", "Dimensity 7300-Ultra", "Helio G99", "Kirin 9010S", "Exynos 2400", "Snapdragon 8 Elite Gen 5"]:
        n = clean_name(s); print(f"{s:28} -> {n:28} {chip_id(n):28} {vendor_of(n)} {family_of(n)}")
