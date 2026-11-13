"""Version 38: read a test script's output and decide whether the site failed.

    python tests/judge.py OUTPUT_FILE [OUTPUT_FILE...]     exit 1 when any real failure is found

The browser tests also log errors that are not the site's: another site's picture server being down (a 5xx, 429 or 403
for a publisher's thumbnail) or a news feed failing behind the headline relay. Those are listed as warnings. Anything
else - a script error, a security-policy block, a layout problem, a broken link, a file of this site failing to load,
a check that found the wrong content - is a real failure.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

SITE_HOSTS = ("127.0.0.1", "127.0.0.2", "localhost", "darren38.github.io/tech-comparison-hub")
# an error line that is only about someone else's server
EXTERNAL = [
    re.compile(r"Failed to load resource: the server responded with a status of (?:5\d\d|429|403|404|410) \(\)\s+https?://(?!(?:" + "|".join(map(re.escape, SITE_HOSTS)) + r"))\S+"),
    re.compile(r"Failed to load resource: net::ERR_(?:BLOCKED_BY_RESPONSE|NAME_NOT_RESOLVED|CONNECTION_\w+|TIMED_OUT)\S*\s+https?://(?!(?:" + "|".join(map(re.escape, SITE_HOSTS)) + r"))\S+"),
    re.compile(r"status of 5\d\d \(\)\s+https://tech-hub-relay\.[^/]+/feed\?url="),
    # the relay only answers the real site's address; a copy under test on 127.0.0.2 is refused (CORS), visitors never are
    # (matched without the end of the sentence: the sweep cuts log lines at 200 characters, often mid-word)
    re.compile(r"Access to fetch at 'https://tech-hub-relay\.[^']+' from origin 'http://127\.0\.0\.2:\d+'"),
    re.compile(r"Failed to load resource: net::ERR_FAILED\s+https://tech-hub-relay\.[^/]+/feed\?url="),
    # a copy served from this computer asks its own serve.py to collect headlines; a plain file server answers 501
    re.compile(r"status of 501 \(Unsupported method \('POST'\)\)\s+http://(?:127\.0\.0\.1|localhost):\d+/api/live/headlines"),
]
NOISE_SPLIT = re.compile(r"\s+\|\s+(?=(?:LOG|ERR|EXC)\b)")


def external(message: str) -> bool:
    message = message.strip()
    return bool(message) and any(p.search(message) for p in EXTERNAL)


def judge(text: str) -> tuple[list[str], list[str]]:
    real, outside = [], []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.startswith("FAIL"):
            i += 1
            continue
        details = []
        j = i + 1
        while j < len(lines) and lines[j].startswith((" ", "\t")) and not lines[j].strip().startswith(("ok ", "FAIL", "PASS")):
            details.append(lines[j].strip())
            j += 1
        # persona-style "FAIL  [x] ... — LOG a | LOG b"; sweep-style "FAIL 390px #/news ..." with indented LOG lines
        head, _, inline = line.partition(" — ")
        messages = [m for m in NOISE_SPLIT.split(inline) if m.strip()] + details
        layout = re.search(r"sw=(\d+) cw=(\d+)", line)
        overflow = layout and int(layout.group(1)) > int(layout.group(2)) + 1
        if messages and not overflow and all(external(m) for m in messages):
            outside.append(line[:160])
        else:
            real.append(line[:200] + (" :: " + " | ".join(details)[:300] if details else ""))
        i = j
    return real, outside


# every test script ends with one of these; without it the test crashed or stopped early, which is never a pass
FINISHED = re.compile(r"^\d+ failed check\(s\)\s*$|^done: \d+ problem page\(s\)|^documents naming devices not in the hub: \d+", re.M)
# Version 40: the link check lists what is missing under count lines instead of FAIL lines; before this every one of
# them was ignored, so a missing link could never turn the run red
LINK_LISTS = re.compile(r"^(missing on device pages|missing in the News/Reviews lists): (\d+)\s*$", re.M)
UNKNOWN_DEVICES = re.compile(r"^documents naming devices not in the hub: (\d+)(.*)$", re.M)


def link_failures(text: str) -> list[str]:
    real = []
    lines = text.splitlines()
    for n, line in enumerate(lines):
        m = LINK_LISTS.match(line)
        if m and int(m.group(2)):
            items = [l.strip() for l in lines[n + 1:n + 1 + int(m.group(2))] if l.startswith("  ")]
            real += [f"{m.group(1)}: {it}" for it in items] or [f"{m.group(1)}: {m.group(2)}"]
    for m in UNKNOWN_DEVICES.finditer(text):
        if int(m.group(1)):
            real.append(f"documents naming devices not in the hub: {m.group(1)}{m.group(2)}")
    return real


def stats(text: str) -> list[tuple[str, str]]:
    """What a test covered, for the summary on the run page."""
    out = []
    passed = len(re.findall(r"^PASS\b", text, re.M))
    if passed:
        out.append(("Checks passed", str(passed)))
    m = re.search(r"^pages checked: (\d+)", text, re.M)
    if m:
        out.append(("Pages checked", m.group(1)))
    m = re.search(r"^device pages opened: (\d+); document links checked: (\d+); headline links checked: (\d+)", text, re.M)
    if m:
        out += [("Device pages opened", m.group(1)), ("Links checked", str(int(m.group(2)) + int(m.group(3))))]
    return out


def step_summary(title: str, real: list[str], outside: list[str], covered: list[tuple[str, str]]) -> str:
    """Markdown for GitHub's run page (GITHUB_STEP_SUMMARY): one small table per test, real failures listed."""
    icon = "❌ failed" if real else "✅ passed"
    rows = covered + [("Real failures", str(len(real))), ("Outside the site's control (warnings)", str(len(outside)))]
    md = [f"### {title} — {icon}", "", "| | |", "|---|---|"] + [f"| {k} | {v} |" for k, v in rows]
    if real:
        md += ["", "Real failures:", ""] + [f"- {r[:300].replace('|', '/')}" for r in real[:15]]
    return "\n".join(md) + "\n\n"


def main() -> int:
    total_real = 0
    for f in sys.argv[1:]:
        text = Path(f).read_text(encoding="utf-8", errors="replace")
        real, outside = judge(text)
        real += link_failures(text)
        if not FINISHED.search(text):
            real.insert(0, "the test did not finish (no summary line) - it crashed, timed out or never started")
        total_real += len(real)
        summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary_file:
            with open(summary_file, "a", encoding="utf-8") as s:
                s.write(step_summary(os.environ.get("JUDGE_TITLE") or Path(f).stem, real, outside, stats(text)))
        print(f"== {Path(f).name}: {len(real)} real failure(s), {len(outside)} outside the site's control")
        for r in real:
            print("   FAIL", r)
        for o in outside:
            print("   warn", o)
        if os.environ.get("GITHUB_ACTIONS"):  # notes on the run that GitHub shows without signing in
            for r in real[:20]:
                print(f"::error title=Test failed::{r[:900]}")
            for o in outside[:10]:
                print(f"::warning title=Outside the site's control::{o[:400]}")
    print("RESULT:", "FAILED" if total_real else "PASSED")
    return 1 if total_real else 0


if __name__ == "__main__":
    sys.exit(main())
