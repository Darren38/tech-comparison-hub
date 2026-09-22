"""Refresh data/meta/currencies.json with Bank Negara Malaysia's latest middle rates.

serve.py runs this at start-up, and the scheduled GitHub Actions build runs it before every
deploy, so ringgit conversions use the rates of the day. If Bank Negara Malaysia cannot be
reached, the existing snapshot is kept and the site says which date its rates are from.

Usage:
    python tools/update_rates.py          fetch and update the snapshot
    python tools/update_rates.py --quiet  print nothing unless something fails
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "data" / "meta" / "currencies.json"
API = "https://api.bnm.gov.my/public/exchange-rate"
HEADERS = {"Accept": "application/vnd.BNM.API.v1+json", "User-Agent": "TechComparisonHub/5.0 (exchange-rate snapshot)"}


def dumps(cfg: dict) -> str:
    """Keep the hand-edited layout: settings first, one line per currency."""
    head = json.dumps({k: v for k, v in cfg.items() if k != "currencies"}, indent=2, ensure_ascii=False)[:-2]
    rows = ",\n".join("    " + json.dumps(c, ensure_ascii=False) for c in cfg["currencies"])
    return f'{head},\n  "currencies": [\n{rows}\n  ]\n}}\n'


def fetch_bnm(timeout: int = 15) -> dict:
    request = urllib.request.Request(API, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def update(quiet: bool = False) -> bool:
    """Return True when the snapshot was refreshed from Bank Negara Malaysia."""
    cfg = json.loads(FILE.read_text(encoding="utf-8"))
    try:
        payload = fetch_bnm()
    except Exception as exc:  # offline, timeout or an API change: keep the last good snapshot
        print(f"[rates] Bank Negara Malaysia rates unavailable ({exc.__class__.__name__}); keeping the rates of {cfg.get('asOf')}.")
        return False

    rows = {row.get("currency_code"): row for row in payload.get("data", [])}
    base = cfg.get("base", "MYR")
    dates, missing = set(), []
    for cur in cfg["currencies"]:
        if cur["code"] == base:
            continue
        row = rows.get(cur["code"])
        middle = (row or {}).get("rate", {}).get("middle_rate")
        if not row or not middle:
            missing.append(cur["code"])
            continue
        unit = row.get("unit") or 1  # BNM quotes some currencies (INR, JPY) per 100 units
        cur["toMYR"] = round(middle / unit, 6)
        dates.add(row["rate"].get("date"))
    if missing or not dates:
        print(f"[rates] Bank Negara Malaysia returned no rate for {', '.join(missing) or 'any currency'}; keeping the rates of {cfg.get('asOf')}.")
        return False

    session = (payload.get("meta") or {}).get("session")
    cfg["asOf"] = max(d for d in dates if d)
    cfg["session"] = f"{session[:2]}:{session[2:]}" if session and len(session) == 4 else session
    cfg["fetchedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    cfg["source"]["note"] = "Middle rates published by Bank Negara Malaysia. BNM quotes the rupee per 100 units; it is stored here per 1 unit."
    FILE.write_text(dumps(cfg), encoding="utf-8")
    if not quiet:
        usd = next((c["toMYR"] for c in cfg["currencies"] if c["code"] == "USD"), None)
        print(f"[rates] Bank Negara Malaysia middle rates of {cfg['asOf']} ({cfg['session']} session) saved. 1 USD = {usd} MYR.")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh the exchange-rate snapshot from Bank Negara Malaysia.")
    parser.add_argument("--quiet", action="store_true")
    update(quiet=parser.parse_args().quiet)
    return 0  # never fail a build because the network is down; the snapshot stays valid


if __name__ == "__main__":
    sys.exit(main())
