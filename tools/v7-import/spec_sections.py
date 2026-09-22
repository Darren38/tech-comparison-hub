"""Version 7: GSMArena-style spec sheet order for phones, plus the new full-sheet fields for watches and bands."""
import json
from pathlib import Path

CAT = (Path(__file__).resolve().parents[2] / "data" / "categories")


def F(key, label, type_="text", **kw):
    return {"key": key, "label": label, "type": type_, **kw}


PHONE = [
    {"id": "network", "label": "Network", "facet": "connectivity", "fields": [
        F("connectivity.technology", "Technology"),
        F("connectivity.cellular", "Fastest network"),
        F("connectivity.bands_2g", "2G bands"),
        F("connectivity.bands_3g", "3G bands"),
        F("connectivity.bands_4g", "4G bands"),
        F("connectivity.bands_5g", "5G bands"),
        F("connectivity.modem", "Modem"),
    ]},
    {"id": "launch", "label": "Launch", "facet": "software", "fields": [
        F("@announced", "Announced", "date"),
        F("@released", "On sale", "date"),
    ]},
    {"id": "body", "label": "Body", "facet": "build", "fields": [
        F("build.dimensions", "Dimensions", "dimensions"),
        F("build.weight_g", "Weight", "number", unit="g", better="lower"),
        F("build.front", "Front"),
        F("build.back", "Back"),
        F("build.frame", "Frame"),
        F("build.ip", "Ingress protection"),
        F("build.durability", "Durability"),
        F("build.stylus", "Stylus"),
        F("connectivity.sim", "SIM"),
    ]},
    {"id": "display", "label": "Display", "facet": "display", "fields": [
        F("display.type", "Type"),
        F("display.size_in", "Size", "number", unit="in", digits=2),
        F("display.resolution", "Resolution"),
        F("display.ppi", "Pixel density", "number", unit="ppi", better="higher"),
        F("display.refresh_hz", "Max refresh rate", "number", unit="Hz", better="higher"),
        F("display.peak_nits", "Peak brightness (claimed)", "number", unit="nits", better="higher"),
        F("display.pwm", "Dimming"),
        F("display.protection", "Protection"),
        F("display.secondary", "Second display"),
    ]},
    {"id": "platform", "label": "Platform", "facet": "performance", "fields": [
        F("software.launch_os", "OS at launch"),
        F("platform.chipset", "Chipset", "chipset"),
        F("platform.chipset_note", "Chipset variant"),
        F("platform.process", "Process"),
        F("platform.cpu", "CPU"),
        F("platform.gpu", "GPU"),
    ]},
    {"id": "memory", "label": "Memory", "facet": "performance", "fields": [
        F("memory.ram_gb", "RAM", "list", unit="GB", better="higher"),
        F("memory.storage_gb", "Storage", "storage", better="higher"),
        F("memory.ram_type", "RAM type"),
        F("memory.storage_type", "Storage type"),
        F("memory.card", "Card slot"),
        F("memory.expandable", "Card slot", "bool"),
    ]},
    {"id": "camera", "label": "Main camera", "facet": "camera", "fields": [
        F("camera.rear", "Cameras", "cameras"),
        F("camera.rear_detail", "Module details", "lines"),
        F("camera.zoom_optical_x", "Longest optical zoom", "number", unit="x", digits=1, better="higher"),
        F("camera.features", "Features"),
        F("camera.video", "Video"),
    ]},
    {"id": "selfie", "label": "Selfie camera", "facet": "camera", "fields": [
        F("camera.front", "Camera"),
        F("camera.front_detail", "Module details", "lines"),
        F("camera.front_video", "Video"),
    ]},
    {"id": "sound", "label": "Sound", "facet": "build", "fields": [
        F("audio.speakers", "Loudspeaker"),
        F("audio.jack", "3.5 mm jack", "bool"),
    ]},
    {"id": "comms", "label": "Comms", "facet": "connectivity", "fields": [
        F("connectivity.wifi", "Wi-Fi"),
        F("connectivity.bluetooth", "Bluetooth"),
        F("connectivity.positioning", "Positioning"),
        F("connectivity.nfc", "NFC", "bool"),
        F("connectivity.uwb", "UWB", "bool"),
        F("connectivity.satellite", "Satellite messaging", "bool"),
        F("connectivity.radio", "Radio"),
        F("connectivity.usb", "USB"),
    ]},
    {"id": "features", "label": "Features", "facet": "build", "fields": [
        F("sensors", "Sensors"),
        F("biometrics.fingerprint", "Fingerprint"),
        F("biometrics.face", "Face unlock"),
    ]},
    {"id": "battery", "label": "Battery", "facet": "battery", "fields": [
        F("battery.capacity_mah", "Capacity", "number", unit="mAh", better="higher"),
        F("battery.rated_mah", "Rated capacity", "number", unit="mAh", better="higher"),
        F("battery.chemistry", "Type"),
        F("battery.variants", "Regional variants"),
        F("battery.video_h", "Video playback (claimed)", "number", unit="h", better="higher"),
        F("charging.wired_w", "Wired charging", "number", unit="W", better="higher"),
        F("charging.wireless_w", "Wireless charging", "number", unit="W", better="higher"),
        F("charging.reverse_w", "Reverse charging", "number", unit="W", better="higher"),
        F("charging.claim", "Charging (maker's wording)"),
    ]},
    {"id": "misc", "label": "Misc", "facet": "software", "fields": [
        F("misc.colors", "Colours"),
        F("misc.models", "Models"),
        F("software.os_updates_years", "OS upgrade commitment", "number", unit="years", better="higher"),
        F("software.security_updates_years", "Security update commitment", "number", unit="years", better="higher"),
        F("software.policy_note", "Support note"),
    ]},
]

p = CAT / "smartphone.json"
d = json.loads(p.read_text(encoding="utf-8"))
old = {f["key"] for s in d["specSections"] for f in s["fields"]}
new = {f["key"] for s in PHONE for f in s["fields"]}
assert old <= new, old - new  # every field shown before is still shown
d["specSections"] = PHONE
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("smartphone:", len(PHONE), "sections,", len(new), "fields")

# Watches and bands: add the launch rows and the connectivity/sensor rows the official sheets now provide.
for cat in ("smartwatch", "band"):
    p = CAT / f"{cat}.json"
    d = json.loads(p.read_text(encoding="utf-8"))
    secs = d["specSections"]
    ids = [s["id"] for s in secs]
    if "launch" not in ids:
        secs.insert(0, {"id": "launch", "label": "Launch", "facet": "software", "fields": [F("@announced", "Announced", "date"), F("@released", "On sale", "date")]})
    conn = next(s for s in secs if s["id"] == "connectivity")
    have = {f["key"] for s in secs for f in s["fields"]}
    for f in (F("connectivity.wifi", "Wi-Fi"), F("connectivity.bluetooth", "Bluetooth"), F("connectivity.positioning", "Positioning"), F("connectivity.nfc", "NFC", "bool")):
        if f["key"] not in have:
            conn["fields"].append(f)
    health = next((s for s in secs if s["id"] == "health"), None)
    if health and "sensors" not in have:
        health["fields"].append(F("sensors", "All sensors"))
    build = next(s for s in secs if s["id"] == "build")
    if "build.durability" not in have:
        build["fields"].append(F("build.durability", "Durability"))
    p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(cat, [s["id"] for s in secs])
