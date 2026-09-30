"""Version 23: an open-source AI model checks every automatically found device before it joins the site.

tools/auto_devices.py finds a new phone or tablet on its maker's own page and checks it with fixed rules; a model that
passes waits in live/auto/new_devices.json under "awaitingAi". This script asks Qwen3.5 9B (run by llama.cpp on the build
server's CPU, pinned by checksum in the workflow) which year that exact model was first announced or released, from its
own knowledge and the collected headlines that name it.

  - The model says a year before 2023 and is sure: the device is not added; it waits for a person (listed as held, with
    the model's answer). The AI can only stop a device, never add one the rules didn't pass.
  - Otherwise (2023 or later, "unknown" - usually a model newer than the AI's knowledge - or not sure): the device is added,
    labelled with the check.
  - The AI can't run (no model server): the device keeps waiting; after 3 days it is held for a person. Nothing is added
    unchecked.

Tested before release on 540 cases (488 real 2023-2026 phones and tablets from the hub, 52 well-known pre-2023 models), with
this exact code on 4 CPU threads like GitHub's server: with the rules alone 25 old models would have been added, with this
check 17; real models held for a person went from 5 to 6 (Galaxy Tab A11, read as 2022). Correct decisions 510 -> 517 of 540.
Gemma 4 12B, tested the same way, stopped no more than the rules alone and is not used.

  python tools/ai_device_check.py --pending    how many devices wait (prints a number)
  python tools/ai_device_check.py              check them (needs the model server on LLM_URL, default 127.0.0.1:8766)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from devices_all import AUTO_DEVICES, read_auto  # noqa: E402

LLM_URL = os.environ.get("LLM_URL", "http://127.0.0.1:8766").rstrip("/")
MODEL_NAME = os.environ.get("LLM_NAME", "Qwen3.5 9B (Q4_K_M, llama.cpp)")
START_YEAR = 2023
WAIT_DAYS = 3
TODAY = dt.date.today().isoformat()

# The wording was chosen by testing: asked instead "before 2023 / 2023 or later / not sure", the same model answered "before
# 2023" for 30 real 2025-2026 phones it had never heard of. Asked for a year with "unknown" allowed, it says "unknown" for them.
SYSTEM = (
    "You check a phone or tablet before a comparison website adds it automatically. The website only covers models first "
    "released in 2023 or later. You get the maker, the model name, the kind of device and recent news headlines that name it "
    "(there may be none). Say the year this exact model was first announced or released, from your own knowledge or the "
    "headlines. Model names are close to each other: \"Reno8 T\" is not \"Reno8\", \"Galaxy A54\" is not \"Galaxy A53\". "
    "If you do not know this exact model, answer \"unknown\" and sure=false; never guess from a similar name. A model you "
    "have not heard of is probably newer than your knowledge: answer \"unknown\". Answer only with JSON."
)
SCHEMA = {"type": "object", "properties": {"first_year": {"type": "string"}, "sure": {"type": "boolean"}},
          "required": ["first_year", "sure"]}


def chat(user: str) -> dict:
    body = {"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
            "temperature": 0, "max_tokens": 60, "chat_template_kwargs": {"enable_thinking": False},
            "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "schema": SCHEMA}}}
    req = urllib.request.Request(f"{LLM_URL}/v1/chat/completions", data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        text = json.load(r)["choices"][0]["message"]["content"]
    return json.loads(text[text.find("{"): text.rfind("}") + 1])


def server_up() -> bool:
    try:
        with urllib.request.urlopen(f"{LLM_URL}/health", timeout=5) as r:
            return json.load(r).get("status") == "ok"
    except Exception:  # noqa: BLE001
        return False


def headlines_for(name: str) -> list[str]:
    """The newest collected headlines that name this exact model (the name standing alone)."""
    import fetch_headlines as fh  # noqa: PLC0415
    words = fh.normalize(re.sub(r"^(Apple|Samsung) ", "", name))
    pat = re.compile(r"(?<![a-z0-9])" + re.escape(words) + r"(?! (?:pro|max|ultra|plus|lite|fe|mini|neo|turbo|edge|s|e|a|x|t|r|\d))(?![a-z0-9])")
    items = {}
    for f in (ROOT / "live" / "archive.json", ROOT / "live" / "headlines.json"):
        try:
            for i in json.loads(f.read_text(encoding="utf-8")).get("items", []):
                if i.get("title") and pat.search(fh.normalize(i["title"])):
                    items[i.get("id") or i["title"]] = i
        except (OSError, ValueError):
            pass
    return [i["title"] for i in sorted(items.values(), key=lambda i: i.get("published") or "", reverse=True)[:4]]


def question(rec: dict, maker: str) -> str:
    lines = headlines_for(rec["name"])
    full = rec["name"] if rec["name"].lower().startswith(maker.lower()) or not maker else f"{maker} {rec['name']}"
    return (f"Maker: {maker or rec.get('brand', '')}\nModel: {full}\nKind: {'tablet' if rec.get('category') == 'tablet' else 'phone'}\n"
            "Headlines naming it:\n" + ("\n".join(f"- {t}" for t in lines) if lines else "(none)"))


def decide(answer: dict) -> tuple[bool, str]:
    year = str(answer.get("first_year", "")).strip()
    if year.isdigit() and int(year) < START_YEAR and answer.get("sure") is True:
        return False, f"an open-source AI model ({MODEL_NAME}) says it was first released in {year}; left for a person to check"
    return True, ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pending", action="store_true")
    a = ap.parse_args()
    state = read_auto()
    waiting = state.get("awaitingAi") or {}
    if a.pending:
        print(len(waiting))
        return 0
    if not waiting:
        print("[ai-devices] nothing waiting")
        return 0
    try:
        brands = {b["id"]: b["name"] for b in json.loads((ROOT / "data" / "brands" / "brands.json").read_text(encoding="utf-8"))}
    except (OSError, ValueError):
        brands = {}
    up = server_up()
    devices = state.setdefault("devices", {})
    held = state.setdefault("held", {})
    for dev_id, w in list(waiting.items()):
        rec, url = w["record"], w["url"]
        if not up:
            if (dt.date.today() - dt.date.fromisoformat(w["since"])).days >= WAIT_DAYS:
                held[url] = {"brand": rec.get("brand"), "name": rec["name"], "at": TODAY,
                             "reason": f"the AI check could not run for {WAIT_DAYS} days; not added unchecked"}
                waiting.pop(dev_id)
                print(f"[ai-devices] {dev_id}: held (no AI check for {WAIT_DAYS} days)")
            continue
        try:
            answer = chat(question(rec, brands.get(rec.get("brand"), "")))
        except Exception as e:  # noqa: BLE001  (a failed answer: try again next run)
            print(f"[ai-devices] {dev_id}: no answer ({type(e).__name__}); still waiting")
            continue
        ok, why = decide(answer)
        check = {"model": MODEL_NAME, "firstYear": str(answer.get("first_year", ""))[:20], "sure": bool(answer.get("sure")), "checked": TODAY}
        waiting.pop(dev_id)
        if ok:
            rec.setdefault("auto", {})["aiCheck"] = check
            devices[dev_id] = rec
            if w.get("chip"):
                state.setdefault("chipsets", {}).setdefault(w["chip"]["id"], w["chip"])
            held.pop(url, None)
            print(f"[ai-devices] ADDED {dev_id} ({rec['name']}): AI says first year {check['firstYear']} (sure: {check['sure']})")
        else:
            held[url] = {"brand": rec.get("brand"), "name": rec["name"], "reason": why, "at": TODAY, "aiCheck": check}
            print(f"[ai-devices] {dev_id} ({rec['name']}) NOT ADDED: {why}")
    state["awaitingAi"] = waiting
    state["updatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    AUTO_DEVICES.write_text(json.dumps(state, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
