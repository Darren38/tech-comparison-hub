"""Write the reviewed Version 7 official images (images_v7.json + images_arch_*.json) into the device files.
Only devices without an image get one; rejected ids are skipped."""
import json, sys
from pathlib import Path

HERE = Path(__file__).parent
V7 = Path(__file__).resolve().parents[2]
REJECT = set(sys.argv[1:])  # ids whose candidate failed the visual check

found = json.loads((HERE / "images_v7.json").read_text(encoding="utf-8"))
for f in sorted(HERE.glob("images_arch_*.json")):
    found.update(json.loads(f.read_text(encoding="utf-8")))

n = 0
for i, img in sorted(found.items()):
    if i in REJECT or not img:
        continue
    path = next((V7 / "data/devices").glob(f"*/{i}.json"), None)
    if not path:
        print("no device", i)
        continue
    dev = json.loads(path.read_text(encoding="utf-8"))
    if dev.get("image"):
        continue
    dev["image"] = {k: img[k] for k in ("kind", "src", "page", "credit", "checked")}
    path.write_text(json.dumps(dev, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    n += 1
print("images added:", n)
