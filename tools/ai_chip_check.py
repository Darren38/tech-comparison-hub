"""Version 35: the open-source AI model checks every chipset found on a chip maker's page before it joins the site.

tools/auto_chips.py finds a chip on Qualcomm's, MediaTek's or Samsung Semiconductor's own product pages; one that is not
on the site yet waits in live/auto/auto_chips.json under "awaitingAi". This script asks the same model that checks new
devices - Qwen3.5 9B, run by llama.cpp on the build server's CPU, pinned by checksum in the workflow - which year that
exact chip was first announced, from its own knowledge and the collected headlines that name it.

The owner's rule (26 Oct 2026): add only what the check is sure of; when it is not sure, hold the chip until the owner
asks Claude to check it, and Claude verifies it before adding it by hand.

  - Sure, and 2023 or later: added, labelled with the check and the maker's page.
  - Sure, and before 2023: not added (the site covers 2023 on); listed as too old.
  - Not sure, or the model does not know the chip ("unknown" - often a chip newer than its knowledge): held for a person.
  - The model can't run: the chip keeps waiting; after 3 days it is held for a person. Nothing is added unchecked.

  python tools/ai_chip_check.py --pending    how many chips wait (prints a number)
  python tools/ai_chip_check.py              check them (needs the model server on LLM_URL, default 127.0.0.1:8766)
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
STATE = ROOT / "live" / "auto" / "auto_chips.json"
LLM_URL = os.environ.get("LLM_URL", "http://127.0.0.1:8766").rstrip("/")
MODEL_NAME = os.environ.get("LLM_NAME", "Qwen3.5 9B (Q4_K_M, llama.cpp)")
START_YEAR = 2023
WAIT_DAYS = 3
TODAY = dt.date.today().isoformat()

SYSTEM = (
    "You check a smartphone chipset (system-on-chip) before a comparison website adds it automatically. The website only "
    "covers chips first announced in 2023 or later. You get the maker, the chip's exact name and recent news headlines that "
    "name it (there may be none). Say the year this exact chip was first announced, from your own knowledge or the "
    "headlines. Chip names are close to each other: \"Dimensity 8300\" is not \"Dimensity 8200\", \"Snapdragon 7s Gen 3\" "
    "is not \"Snapdragon 7 Gen 3\", \"Dimensity 7300X\" is not \"Dimensity 7300\". If you do not know this exact chip, "
    "answer \"unknown\" and sure=false; never guess from a similar name. Answer only with JSON."
)
# Version 36: the first run (1 Nov 2026) answered "none" for nearly every chip. The question ended with "Headlines naming it:
# (none)" and the model most likely copied that word. The answer is now held to a year or "unknown" (the server enforces the
# JSON schema while the model writes), the empty headline list is left out of the question, and each raw answer is kept.
YEARS = [str(y) for y in range(2015, dt.date.today().year + 1)]
SCHEMA = {"type": "object", "properties": {"first_year": {"type": "string", "enum": YEARS + ["unknown"]}, "sure": {"type": "boolean"}},
          "required": ["first_year", "sure"]}
# Before deciding anything, the model must date three well-known chips correctly (at least two of three, each with "sure");
# otherwise nothing is decided this run and the chips keep waiting.
SELF_TEST = [({"vendor": "qualcomm", "name": "Snapdragon 8 Gen 1"}, "2021"),
             ({"vendor": "mediatek", "name": "Dimensity 9300"}, "2023"),
             ({"vendor": "qualcomm", "name": "Snapdragon 8 Elite"}, "2024")]
MAKERS = {"qualcomm": "Qualcomm", "mediatek": "MediaTek", "samsung": "Samsung"}


def chat(user: str) -> dict:
    body = {"messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
            "temperature": 0, "max_tokens": 60, "chat_template_kwargs": {"enable_thinking": False},
            "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "schema": SCHEMA}}}
    req = urllib.request.Request(f"{LLM_URL}/v1/chat/completions", data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        text = json.load(r)["choices"][0]["message"]["content"]
    answer = json.loads(text[text.find("{"): text.rfind("}") + 1])
    answer["_raw"] = text[:200]  # kept with the decision, so a strange answer can be seen on the dashboard
    return answer


def server_up() -> bool:
    try:
        with urllib.request.urlopen(f"{LLM_URL}/health", timeout=5) as r:
            return json.load(r).get("status") == "ok"
    except Exception:  # noqa: BLE001
        return False


def headlines_for(name: str) -> list[str]:
    """The newest collected headlines naming this exact chip (not followed by a longer variant such as "Plus" or "X")."""
    words = re.sub(r"[^a-z0-9+ ]", " ", name.lower())
    words = re.sub(r"\s+", " ", words).strip()
    pat = re.compile(r"(?<![a-z0-9])" + re.escape(words) + r"(?!\s*(?:\+|plus|pro|ultra|max|x\b|e\b|s\b|lite|extreme|elite|\d))(?![a-z0-9])")
    items = {}
    for f in (ROOT / "live" / "archive.json", ROOT / "live" / "headlines.json"):
        try:
            for i in json.loads(f.read_text(encoding="utf-8")).get("items", []):
                title = i.get("title") or ""
                if pat.search(re.sub(r"\s+", " ", re.sub(r"[^a-z0-9+ ]", " ", title.lower()))):
                    items[i.get("id") or title] = i
        except (OSError, ValueError):
            pass
    return [i["title"] for i in sorted(items.values(), key=lambda i: i.get("published") or "", reverse=True)[:4]]


def question(rec: dict, with_headlines: bool = True) -> str:
    lines = headlines_for(rec["name"]) if with_headlines else []
    q = f"Maker: {MAKERS.get(rec.get('vendor'), rec.get('vendor', ''))}\nChip: {rec['name']}"
    if lines:  # no "(none)" line: the first run's answers suggest the model copied it
        q += "\nRecent headlines naming it:\n" + "\n".join(f"- {t}" for t in lines)
    return q + "\nIn which year was this exact chip first announced?"


def self_test() -> dict:
    """Ask about three well-known chips; the model passes when it dates at least two correctly and says it is sure."""
    results, right = [], 0
    for rec, want in SELF_TEST:
        try:
            a = chat(question(rec, with_headlines=False))
        except Exception as e:  # noqa: BLE001
            a = {"first_year": "", "sure": False, "_raw": f"no answer ({type(e).__name__})"}
        ok = str(a.get("first_year")) == want and a.get("sure") is True
        right += ok
        results.append({"chip": rec["name"], "expected": want, "answer": str(a.get("first_year", "")), "sure": bool(a.get("sure")),
                        "raw": str(a.get("_raw", ""))[:120], "ok": ok})
    return {"passed": right >= 2, "right": right, "of": len(SELF_TEST), "results": results, "at": TODAY, "model": MODEL_NAME}


def decide(answer: dict) -> str:
    """'add', 'old' or 'hold'."""
    year = str(answer.get("first_year", "")).strip()
    sure = answer.get("sure") is True
    if not (sure and year.isdigit() and len(year) == 4):
        return "hold"
    if int(year) < START_YEAR:
        return "old"
    if int(year) > dt.date.today().year:
        return "hold"  # a year in the future is not an answer to trust
    return "add"


def settle_reviewed(state: dict) -> None:
    """Version 36: chips a person has checked (data/meta/chip_reviewed.json), or that now have a hand-made record, leave
    the waiting and held lists; the ones found too old are listed as such."""
    try:
        reviewed = json.loads((ROOT / "data" / "meta" / "chip_reviewed.json").read_text(encoding="utf-8")).get("chips") or {}
    except (OSError, ValueError):
        reviewed = {}
    for cid in list(state.get("held") or {}) + list(state.get("awaitingAi") or {}):
        r = reviewed.get(cid)
        if (ROOT / "data" / "chipsets" / f"{cid}.json").exists() or (r and r.get("decision") == "added"):
            state["held"].pop(cid, None)
            state["awaitingAi"].pop(cid, None)
        elif r and r.get("decision") == "too old":
            state["held"].pop(cid, None)
            state["awaitingAi"].pop(cid, None)
            state.setdefault("tooOld", {})[cid] = {"name": r.get("name", cid), "url": r.get("url"), "at": r.get("checked"),
                                                   "reason": f"checked by hand: first announced {r.get('firstSeen')} (before 2023)"}


def save(state: dict) -> None:
    state["updatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(STATE)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[0])
    ap.add_argument("--pending", action="store_true")
    a = ap.parse_args()
    try:
        state = json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    state.setdefault("held", {}); state.setdefault("awaitingAi", {})
    before = len(state["held"]) + len(state["awaitingAi"])
    settle_reviewed(state)
    settled = before - len(state["held"]) - len(state["awaitingAi"])
    waiting = state["awaitingAi"]
    if a.pending:
        print(len(waiting))
        if settled:
            save(state)
        return 0
    if not waiting:
        print("[ai-chips] nothing waiting" + (f"; {settled} chip(s) settled by a person's check" if settled else ""))
        if settled:
            save(state)
        return 0
    up = server_up()
    added, held, old = state.setdefault("added", {}), state["held"], state.setdefault("tooOld", {})
    if up:
        test = self_test()
        state["selfTest"] = test
        print(f"[ai-chips] self-test: {test['right']} of {test['of']} well-known chips dated correctly"
              + ("" if test["passed"] else " - not trusted this run; nothing decided"))
        if not test["passed"]:
            up = False  # treated like a model that could not run: the chips keep waiting (held after 3 days)
    for cid, w in list(waiting.items()):
        rec = w["record"]
        if not up:
            if (dt.date.today() - dt.date.fromisoformat(w["since"])).days >= WAIT_DAYS:
                held[cid] = {"name": rec["name"], "vendor": rec.get("vendor"), "url": w["url"], "at": TODAY, "record": rec,
                             "reason": f"the AI check could not run or did not pass its self-test for {WAIT_DAYS} days; not added unchecked"}
                waiting.pop(cid)
                print(f"[ai-chips] {cid}: held (no trusted AI check for {WAIT_DAYS} days)")
            continue
        try:
            answer = chat(question(rec))
        except Exception as e:  # noqa: BLE001  (a failed answer: try again next run)
            print(f"[ai-chips] {cid}: no answer ({type(e).__name__}); still waiting")
            continue
        check = {"model": MODEL_NAME, "firstYear": str(answer.get("first_year", ""))[:20], "sure": bool(answer.get("sure")),
                 "raw": str(answer.get("_raw", ""))[:200], "checked": TODAY}
        verdict = decide(answer)
        waiting.pop(cid)
        if verdict == "add":
            rec["aiCheck"] = check
            added[cid] = rec
            print(f"[ai-chips] ADDED {cid} ({rec['name']}): AI is sure it was first announced in {check['firstYear']}")
        elif verdict == "old":
            old[cid] = {"name": rec["name"], "url": w["url"], "at": TODAY, "aiCheck": check,
                        "reason": f"an open-source AI model ({MODEL_NAME}) is sure it was first announced in {check['firstYear']}"}
            print(f"[ai-chips] {cid} ({rec['name']}) not added: first announced {check['firstYear']} (before {START_YEAR})")
        else:
            held[cid] = {"name": rec["name"], "vendor": rec.get("vendor"), "url": w["url"], "at": TODAY, "aiCheck": check, "record": rec,
                         "reason": "the AI check was not sure (answer: " + (check["firstYear"] or "none") + "); waiting for a person"}
            print(f"[ai-chips] {cid} ({rec['name']}) HELD for a person: AI answer {check['firstYear']!r}, sure={check['sure']}")
    save(state)
    return 0


if __name__ == "__main__":
    sys.exit(main())
