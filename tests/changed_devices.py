"""Version 38: the device pages a release changes, for the quick link check (tests/linkcheck.mjs, LINKCHECK_DEVICES).

    python tests/changed_devices.py [base]      base defaults to origin/main; prints id,id,... (empty = nothing changed)

A device counts as changed when its own file changed, when a news/review/video entry naming it was added or edited, or
when the chipset it uses changed. The full link check (every device) still runs once a week.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True).stdout


def load(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return None


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
    changed = [p for p in git("diff", "--name-only", f"{base}...HEAD", "--", "data").splitlines() if p.endswith(".json")]
    ids: set[str] = set()
    chips: set[str] = set()
    for path in changed:
        parts = Path(path).parts
        if parts[1] == "devices":
            ids.add(Path(path).stem)
        elif parts[1] == "chipsets":
            chips.add(Path(path).stem)
        elif parts[1] in ("news", "reviews", "videos"):
            try:
                old = load(git("show", f"{base}:{path}")) or []
            except subprocess.CalledProcessError:
                old = []
            new = load((ROOT / path).read_text(encoding="utf-8")) if (ROOT / path).exists() else []
            before = {d.get("id"): d for d in old if isinstance(d, dict)}
            for d in new or []:
                if isinstance(d, dict) and before.get(d.get("id")) != d:
                    ids.update(d.get("devices") or [])
    if chips:
        for f in (ROOT / "data" / "devices").glob("*/*.json"):
            d = load(f.read_text(encoding="utf-8")) or {}
            if ((d.get("specs") or {}).get("platform") or {}).get("chipset") in chips:
                ids.add(d.get("id"))
    print(",".join(sorted(i for i in ids if i)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
