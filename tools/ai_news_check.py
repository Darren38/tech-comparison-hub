"""Version 21: an open-source AI model (Qwen3.5 2B, run by llama.cpp on the build server's own CPU) reads the
automatically collected headlines before they reach the device pages, in two places where word-matching alone can
go wrong:

1. A headline whose words may mean another maker's product ("Xiaomi made an iPhone Duo"; not "Galaxy Z Fold8 and Z Flip8 deals, Pixel 11
   series also discounted"). For each model the rules found, the AI says whose product the headline means by those
   words. A model is taken off the headline only when the AI names another maker AND that maker's name is in the
   headline, so a slip of the model alone can never remove a correct match, and the AI can never add a device (it only
   judges the ones the rules found).
2. New model names spotted in the news (live/spotted.json, "OnePlus 16"). The AI reads the headlines that mention each
   one and says whether it is launched, announced, teased, rumoured or not a product. The Coverage page shows this,
   labelled as the AI's reading of the headlines, and a model it calls rumoured or not a product is not looked up on
   the makers' sites (tools/auto_devices.py).

Results are kept in live/auto/news_ai.json (by headline and by spotted name) so each is read once, and the removals
are applied to live/archive.json and live/headlines.json here and again in the browser (engine/live.js).

The model must already be running as an OpenAI-compatible server (llama.cpp's llama-server) at LLM_URL
(default http://127.0.0.1:8765); the workflow starts it. Without it nothing changes and the site uses the rules alone.

    python tools/ai_news_check.py --pending      # how many headlines and names are waiting (no model needed)
    python tools/ai_news_check.py                # check them (at most --limit, within --minutes) and apply
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_headlines as fh  # noqa: E402
from devices_all import all_devices  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "live" / "auto" / "news_ai.json"
LLM_URL = os.environ.get("LLM_URL", "http://127.0.0.1:8765").rstrip("/")
MODEL_NAME = os.environ.get("LLM_NAME", "Qwen3.5 2B (Q4_K_M, llama.cpp)")
STATUSES = ["launched", "announced", "teased", "rumoured", "not a product"]

MAKER_SYSTEM = (
    "You read one technology headline and one product name found in it. Say which company's product the headline "
    "means by those words, judging by the words around them (\"Xiaomi Pad 9\" -> Xiaomi, even if another company also "
    "sells a \"Pad 9\"; \"iPhone 18 Pro\" -> Apple; \"Galaxy Z Fold8\" -> Samsung; \"Xiaomi made its own iPhone Duo\" -> "
    "Xiaomi). If the words are software or a version number rather than a product (\"iOS 27\"), answer \"none\". "
    "Answer only with JSON."
)
MAKER_SCHEMA = {"type": "object", "properties": {"maker": {"type": "string"}}, "required": ["maker"]}
SPOT_SYSTEM = (
    "You read a few recent technology headlines that mention one product name, and say what they report about that "
    "product. Choose one status:\n"
    "- launched: it is on sale or released somewhere.\n"
    "- announced: the maker has officially announced or unveiled it (date, price or launch event given), not yet on sale.\n"
    "- teased: the maker itself has shown or confirmed parts of it (a teaser, a confirmed spec), not announced.\n"
    "- rumoured: only leaks, reports or rumours.\n"
    "- not a product: the words are not a device (software, a version number, part of another name).\n"
    "Judge only from the headlines. Answer only with JSON."
)
SPOT_SCHEMA = {"type": "object", "properties": {"status": {"type": "string", "enum": STATUSES}}, "required": ["status"]}
# Version 22: the model's status is capped by what the headlines' own words support (seen: "OnePlus 16 gets an official
# launch date" read as "launched"). The model may pick a lower status than the words allow, never a higher one.
LEVEL = {"rumoured": 0, "teased": 1, "announced": 2, "launched": 3}
SAID_LAUNCHED = re.compile(r"\b(launched\b(?!\s+(?:date|event))|launches\b(?!\s+(?:date|event|timeline|soon|on\b))(?![^|]{0,30}?\bon\s+(?:[a-z]+\s+)?\d)|goes on sale|on sale now|now (?:on sale|available)|"
                           r"available now|released\b|debuts?\b|arrives?\b|hits (?:stores|shelves)|goes official)|(?<!将)(?<!即将)(?:手机)?发布(?![会前])|上市|开售|首销", re.I)
SAID_ANNOUNCED = re.compile(r"\b(announc(?:es|ed|ement)|unveil(?:s|ed)?|official(?:ly)?|launch (?:date|event)|launch(?:es)?\b[^|]{0,30}?\bon\s+(?:[a-z]+\s+)?\d|pre-?orders?|priced?\b|prices?\b)|"
                            r"官宣|定档|发布会|将发布|预售|预约|起售|元起", re.I)
SAID_TEASED = re.compile(r"\b(teas(?:es|ed|er)|confirm(?:s|ed)?|shows? off|previews?)|预热|官方确认", re.I)


def supported(titles: list[str]) -> int:
    """The highest status the headlines' words support (0 rumoured … 3 launched)."""
    text = " | ".join(titles)
    return 3 if SAID_LAUNCHED.search(text) else 2 if SAID_ANNOUNCED.search(text) else 1 if SAID_TEASED.search(text) else 0


def capped(status: str | None, titles: list[str]) -> str | None:
    if status not in LEVEL:
        return status
    top = supported(titles)
    return status if LEVEL[status] <= top else next(k for k, v in LEVEL.items() if v == top)


def chat(system: str, user: str, schema: dict, max_tokens: int = 40) -> dict:
    body = {
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0, "max_tokens": max_tokens,
        "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "schema": schema}},
        "chat_template_kwargs": {"enable_thinking": False},
    }
    req = urllib.request.Request(LLM_URL + "/v1/chat/completions", data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.load(r)
    return json.loads(res["choices"][0]["message"]["content"])


def server_up() -> bool:
    try:
        with urllib.request.urlopen(LLM_URL + "/health", timeout=5) as r:
            return json.load(r).get("status") == "ok"
    except Exception:  # noqa: BLE001
        return False


def load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def signature(item: dict) -> str:
    """Changes when the headline or the devices the rules found change, so the check is done again."""
    ids = set(item.get("devices", [])) | set(item.get("aiRemoved", []))  # the rules' matches, before any removal
    return hashlib.sha1((item["title"] + "|" + ",".join(sorted(ids))).encode("utf-8")).hexdigest()[:10]


def families() -> tuple[dict[str, str], dict[str, str]]:
    """device id -> brand family; every brand word (and brand name) -> family."""
    brands = {b["id"]: b["name"] for b in json.loads((fh.DATA / "brands" / "brands.json").read_text(encoding="utf-8"))}
    fam = {}
    for d in all_devices():
        word = fh.normalize(brands.get(d["brand"], d["brand"])).split(" ")[0]
        fam[d["id"]] = fh.BRAND_WORDS.get(word, d["brand"])
    words = dict(fh.BRAND_WORDS)
    for bid, name in brands.items():
        words.setdefault(fh.normalize(name).split(" ")[0], fh.BRAND_WORDS.get(bid, bid))
    return fam, words


# Words that separate two products in a headline: "Xiaomi 17T Pro vs iPhone 17" names both, it doesn't make the
# iPhone a Xiaomi product.
SEPARATORS = {"vs", "versus", "and", "or", "with", "plus", "than", "against", "to", "from", "over", "beats", "beat", "like", "nor"}
NEAR = 4  # another maker's name at most this many words before a device's name makes the match doubtful
# product lines only one maker uses: "Huawei copies Galaxy Z Fold8 hinge" is still about Samsung's Fold8
ONE_MAKER = {"galaxy": "samsung", "iphone": "apple", "ipad": "apple", "airpods": "apple", "macbook": "apple", "pixel": "google",
             "xperia": "sony", "razr": "motorola", "pura": "huawei", "matepad": "huawei", "freebuds": "huawei", "rog": "asus"}


def suspects(item: dict, keys, fam: dict, words: dict) -> list[tuple[str, str, str]]:
    """(device, the words the rules matched, the other maker named just before them) for each doubtful match.

    Tested on 190 headlines naming several models: asked about every device, Qwen3.5 2B gave the first maker of a
    comparison for both sides ("Xiaomi 17T Pro vs iPhone 17": iPhone -> Xiaomi) and 33 of 33 removals were wrong. So the
    rules decide what is doubtful (another maker's name right before the name, nothing like "vs" or "and" between) and
    the AI decides only those, and only by agreeing with that maker."""
    tokens = fh.normalize(item["title"]).split()
    out = []
    for dev, start, end, _key in fh.match_spans(" ".join(tokens), keys):
        if dev not in item.get("devices", []) or words.get(tokens[start]) == fam.get(dev) or ONE_MAKER.get(tokens[start]) == fam.get(dev):
            continue  # not a device of this headline, or its name says whose it is ("Motorola Signature 27", "Galaxy Z Fold8")
        for j in range(start - 1, max(-1, start - 1 - NEAR), -1):
            w = tokens[j]
            if w in SEPARATORS:
                break
            family = words.get(w)
            if family:
                if family != fam.get(dev):
                    out.append((dev, " ".join(tokens[start:end]), w))
                break
    return out


def needs_check(item: dict, keys, fam: dict, words: dict) -> bool:
    return bool(suspects(item, keys, fam, words))


def check_item(item: dict, keys, fam: dict, words: dict) -> dict:
    verdicts, drop = {}, []
    for dev, said, near in suspects(item, keys, fam, words):
        maker = str(chat(MAKER_SYSTEM, f"Headline: {item['title']}\nName: {said}", MAKER_SCHEMA).get("maker", "")).strip()
        m = fh.normalize(maker).split(" ")[0] if maker else ""
        # the AI takes a device off only when it says the words mean the product of the maker named just before them
        remove = bool(m) and words.get(m) is not None and words.get(m) == words.get(near)
        verdicts[dev] = {"words": said, "near": near, "maker": maker[:40], "keep": not remove}
        if remove:
            drop.append(dev)
    return {"sig": signature(item), "checked": now_iso(), "devices": verdicts, **({"drop": drop} if drop else {})}


def check_spotted(model: dict) -> dict:
    lines = "\n".join(f"- {e['title']}" for e in model.get("examples", [])[:4])
    said = chat(SPOT_SYSTEM, f"Product name: {model['name']}\nHeadlines:\n{lines}", SPOT_SCHEMA).get("status")
    said = said if said in STATUSES else None
    status = capped(said, [e["title"] for e in model.get("examples", [])[:4]])
    return {"name": model["name"], "status": status, **({"aiSaid": said} if said != status else {}), "checked": now_iso(),
            "sig": hashlib.sha1((model["name"] + "|" + lines).encode("utf-8")).hexdigest()[:10]}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")


def apply_to(path: Path, ai: dict) -> int:
    """Take the AI's removals off a headlines file (archive or latest). Returns how many devices were removed."""
    data = load(path, None)
    if not isinstance(data, dict):
        return 0
    removed = 0
    for item in data.get("items", []):
        entry = ai.get("items", {}).get(item.get("id"))
        if not entry or entry.get("sig") != signature(item):
            continue
        gone = [d for d in item.get("devices", []) if d in entry.get("drop", [])]
        if gone:
            item["devices"] = [d for d in item["devices"] if d not in gone]
            item["aiRemoved"] = sorted(set(item.get("aiRemoved", [])) | set(gone))
            removed += len(gone)
    if removed:
        save(path, data)
    return removed


def pending(ai: dict, keys, fam: dict, words: dict) -> tuple[list[dict], list[dict]]:
    items = []
    for path in (fh.ARCHIVE_OUT, fh.OUT):
        for item in load(path, {}).get("items", []):
            if item.get("id") and ai.get("items", {}).get(item["id"], {}).get("sig") != signature(item) and needs_check(item, keys, fam, words):
                items.append(item)
    uniq = list({i["id"]: i for i in items}.values())
    uniq.sort(key=lambda i: i.get("published") or "", reverse=True)
    spotted = []
    for m in load(fh.SPOTTED_OUT, {}).get("models", []):
        key = fh.normalize(m["name"])
        lines = "\n".join(f"- {e['title']}" for e in m.get("examples", [])[:4])
        if ai.get("spotted", {}).get(key, {}).get("sig") != hashlib.sha1((m["name"] + "|" + lines).encode("utf-8")).hexdigest()[:10]:
            spotted.append(m)
    return uniq, spotted


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pending", action="store_true", help="print how many headlines and names wait for a check, then stop")
    ap.add_argument("--limit", type=int, default=80, help="most headlines to check this run")
    ap.add_argument("--minutes", type=float, default=10, help="time limit")
    a = ap.parse_args()
    ai = load(OUT, {})
    ai.setdefault("items", {})
    ai.setdefault("spotted", {})
    keys = fh.load_keys()
    fam, words = families()
    items, spotted = pending(ai, keys, fam, words)
    # statuses given before the word check existed are capped the same way (no model needed)
    recapped = 0
    for m in load(fh.SPOTTED_OUT, {}).get("models", []):
        entry = ai["spotted"].get(fh.normalize(m["name"]))
        if entry and entry.get("status") in LEVEL:
            new = capped(entry["status"], [e["title"] for e in m.get("examples", [])[:4]])
            if new != entry["status"]:
                entry["aiSaid"], entry["status"] = entry["status"], new
                recapped += 1
    if recapped and not a.pending:
        save(OUT, ai)
        print(f"{recapped} spotted status(es) capped to what the headlines' words support")
    if a.pending:
        print(json.dumps({"headlines": len(items), "spotted": len(spotted)}))
        return 0
    if not items and not spotted:
        print("nothing waiting")
    elif not server_up():
        print(f"no AI model server at {LLM_URL}: headlines keep the rule-based matches")
    else:
        deadline = time.time() + 60 * a.minutes
        done = removed = 0
        for item in items[: a.limit]:
            if time.time() > deadline:
                break
            try:
                ai["items"][item["id"]] = check_item(item, keys, fam, words)
                done += 1
                removed += len(ai["items"][item["id"]].get("drop", []))
            except Exception as e:  # noqa: BLE001  (one failed answer never stops the rest)
                print(f"  skipped {item['title'][:60]}: {e}")
        named = 0
        for m in spotted:
            if time.time() > deadline:
                break
            try:
                ai["spotted"][fh.normalize(m["name"])] = check_spotted(m)
                named += 1
            except Exception as e:  # noqa: BLE001
                print(f"  skipped {m['name']}: {e}")
        # forget checks for headlines no longer collected
        live_ids = {i.get("id") for p in (fh.ARCHIVE_OUT, fh.OUT) for i in load(p, {}).get("items", [])}
        ai["items"] = {k: v for k, v in ai["items"].items() if k in live_ids}
        ai.update(model=MODEL_NAME, updatedAt=now_iso(),
                  note="An open-source AI model's reading of the automatically collected headlines (tools/ai_news_check.py). "
                       "It never adds a device; it can take one off a headline only when the maker it names is in the headline.")
        save(OUT, ai)
        print(f"checked {done} headline(s) ({removed} device match(es) taken off) and {named} spotted name(s)")
    applied = apply_to(fh.ARCHIVE_OUT, ai) + apply_to(fh.OUT, ai)
    if applied:
        print(f"applied: {applied} device match(es) removed from the headline files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
