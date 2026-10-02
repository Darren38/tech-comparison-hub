"""Version 24: start every download a page needs at once, instead of one after another.

The site's code is plain ES modules: the browser only finds out about a file when it has downloaded the file that imports
it, so a first visit used to wait for about eight downloads in a row before anything showed (measured on the live site:
the home page's first paint at 2.8 s on a desktop, the data starting only at 2.1 s). This script writes two generated lists:

  - index.html, between <!-- preload:start --> and <!-- preload:end -->: a <link rel="modulepreload"> for every module the
    app always needs (src/main.js and everything it imports, followed to the end), so they all download in parallel;
  - assets/js/prepaint.js, between /* routes:start */ and /* routes:end */: for each route in src/main.js, its page module
    and the modules only that page needs, so the page being opened is fetched straight away too.

prepaint.js also starts the four core data files at once (see there); src/core/store.js picks those requests up.
Run by the workflow before the site is assembled, and after any change to the imports:  python tools/preload.py [--check]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
IMPORT = re.compile(r"""(?:^|[;\n])\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.{1,2}/[^'"]+\.js)['"]""")
ROUTE = re.compile(r"""\{\s*pattern:\s*(/.+?/[a-z]*),\s*load:\s*\(\)\s*=>\s*import\(['"](\./pages/[^'"]+\.js)['"]\)""")


def static_imports(path: Path) -> list[Path]:
    text = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
    text = re.sub(r"(?m)^\s*//.*$", "", text)
    return [(path.parent / m).resolve() for m in IMPORT.findall(text)]


def closure(start: Path) -> list[Path]:
    seen, order, stack = set(), [], [start.resolve()]
    while stack:
        p = stack.pop()
        if p in seen or not p.exists():
            continue
        seen.add(p)
        order.append(p)
        stack.extend(reversed(static_imports(p)))
    return order


def rel(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


def replace_between(text: str, start: str, end: str, body: str) -> str:
    a, b = text.index(start) + len(start), text.index(end)
    return text[:a] + body + text[b:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if the generated lists are out of date (write nothing)")
    args = ap.parse_args()
    core = closure(SRC / "main.js")
    core_set = set(core)
    links = "\n" + "".join(f'    <link rel="modulepreload" href="{rel(p)}" />\n' for p in core) + "    "
    routes = []
    main_text = (SRC / "main.js").read_text(encoding="utf-8")
    for pattern, module in ROUTE.findall(main_text):
        page = (SRC / module).resolve()
        own = [rel(p) for p in closure(page) if p not in core_set]
        routes.append(f"[{pattern}, {json.dumps(own)}]")
    route_js = "\nvar ROUTE_MODULES = [\n  " + ",\n  ".join(routes) + "\n];\n"
    index = ROOT / "index.html"
    prepaint = ROOT / "assets" / "js" / "prepaint.js"
    new_index = replace_between(index.read_text(encoding="utf-8"), "<!-- preload:start -->", "<!-- preload:end -->", links)
    new_prepaint = replace_between(prepaint.read_text(encoding="utf-8"), "/* routes:start */", "/* routes:end */", route_js)
    stale = new_index != index.read_text(encoding="utf-8") or new_prepaint != prepaint.read_text(encoding="utf-8")
    if args.check:
        print("[preload] out of date: run python tools/preload.py" if stale else "[preload] up to date")
        return 1 if stale else 0
    index.write_text(new_index, encoding="utf-8", newline="\n")
    prepaint.write_text(new_prepaint, encoding="utf-8", newline="\n")
    print(f"[preload] {len(core)} modules preloaded on every page; {len(routes)} routes with their own modules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
