"""When an automatic source started failing, kept across runs (Version 43).

A source that fails on one run and works on the next is normal (a site's short outage). One that keeps failing needs a
person: AnTuTu's ranking changed its layout in autumn 2026 and its reader failed for eight weeks while the files it
writes still looked fresh, because the other sources in them kept working. Each job now stores, per source:
  failingSince  the first failed run in an unbroken row of failures (removed once the source works again)
  lastOk        the last run on which it worked
tools/health_check.py warns when a source has been failing for 7 days or more; the local dashboard lists them.
"""
from __future__ import annotations

FAILING_DAYS = 7


def carry(prev: dict | None, new: dict, now: str) -> dict:
    """The new status of one source, with failingSince / lastOk carried over from its previous status."""
    prev = prev if isinstance(prev, dict) else {}
    new = {k: v for k, v in new.items() if k not in ("failingSince", "lastOk")}
    if new.get("ok"):
        new["lastOk"] = now
    else:
        new["failingSince"] = prev.get("failingSince") if prev.get("ok") is False and prev.get("failingSince") else now
        if prev.get("lastOk"):
            new["lastOk"] = prev["lastOk"]
    return new
