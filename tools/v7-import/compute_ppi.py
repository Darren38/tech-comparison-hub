"""Pixel density for phones that don't state it: calculated from the recorded resolution and diagonal, labelled as platform analysis."""
import json, math, re
from pathlib import Path
V7 = Path(__file__).resolve().parents[2]
n = 0
for p in sorted((V7 / "data/devices/smartphone").glob("*.json")):
    d = json.loads(p.read_text(encoding="utf-8"))
    disp = d.get("specs", {}).get("display", {})
    if disp.get("ppi") or not disp.get("size_in") or not disp.get("resolution"):
        continue
    m = re.match(r"\s*(\d{3,4})\s*[x×*]\s*(\d{3,4})", str(disp["resolution"]))
    if not m:
        continue
    w, h = int(m.group(1)), int(m.group(2))
    ppi = round(math.hypot(w, h) / float(disp["size_in"]))
    if not 150 <= ppi <= 700:
        print("skip implausible", d["id"], ppi)
        continue
    disp["ppi"] = ppi
    d["provenance"].setdefault("fields", {})["specs.display.ppi"] = {"class": "platform", "source": "platform", "note": "Calculated from resolution and screen size."}
    p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    n += 1
print("pixel density calculated for", n, "phones")
