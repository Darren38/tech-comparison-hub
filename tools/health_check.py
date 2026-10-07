"""Check-up of the live site after each deployment (Version 26).

    python tools/health_check.py [--base https://darren38.github.io/tech-comparison-hub/] [--browser PATH]

Problems that break the site for visitors are FAILURES: the job fails, GitHub marks the run red and emails the owner.
Smaller things (a news feed that couldn't be read, devices waiting for a person) are WARNINGS: listed, nothing fails.

  1. Pages and data files load: home, sitemap.xml, robots.txt, the Search Console ownership file, the data indexes.
  2. sitemap.xml is valid, lists the site's pages under its own address, and robots.txt points to it.
  3. Real pages work in a headless browser (home, a device, a comparison, News, Charts): the page draws its content, and
     the browser reports no script error and nothing blocked by the security policy.
  4. The security policy (Content-Security-Policy) is still in the page.
  5. The automatic updates are recent: headlines, Apple's and Samsung's official pages, new devices, benchmarks.
  6. The automatic readers don't send the author's name or address (user rule, Version 25).

The results go to the run's summary page on GitHub and to the log. Only this site is read; nothing is changed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; TechComparisonHub/1.0; health check)"
DEFAULT_BASE = "https://darren38.github.io/tech-comparison-hub/"
NOW = dt.datetime.now(dt.timezone.utc)

# pages drawn in the browser, with words that must appear once the page's code has run
PAGES = [
    ("Home", "", ["Compare"]),
    ("Device page", "#/device/samsung-galaxy-s26-ultra", ["Galaxy S26 Ultra", "Specifications"]),
    ("Comparison", "#/compare/samsung-galaxy-s26-ultra,apple-iphone-18-pro-max", ["Galaxy S26 Ultra", "iPhone 18 Pro Max"]),
    ("News", "#/news", ["News"]),
    ("Charts", "#/charts", ["Charts"]),
]
# how old each automatic update may be before it is reported (hours); runs are every 3 hours, GitHub may start one late
FRESH = [
    ("Headlines", "live/headlines.json", "fetchedAt", 9, "fail"),
    ("Apple and Samsung official pages", "live/official.json", "updatedAt", 30, "warn"),
    ("New devices (makers' pages)", "live/auto/new_devices.json", "updatedAt", 50, "warn"),
    ("Benchmark databases", "live/auto/benchmarks.json", "refreshedAt", 50, "warn"),
]

failures: list[str] = []
warnings: list[str] = []
passed: list[str] = []


def annotate(level: str, msg: str) -> None:
    """On GitHub, also an annotation on the run (shown on its page; the local dashboard reads them)."""
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::{level} title=Site check-up::{msg.replace('%', '%25').replace(chr(10), ' ')}", flush=True)


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"FAIL  {msg}", flush=True)
    annotate("error", msg)


def warn(msg: str) -> None:
    warnings.append(msg)
    print(f"warn  {msg}", flush=True)
    annotate("warning", msg)


def ok(msg: str) -> None:
    passed.append(msg)
    print(f"ok    {msg}", flush=True)


def get(url: str, tries: int = 3) -> tuple[int, dict, bytes]:
    """(status, headers, body). A fresh deployment can take a minute to reach every server, so errors are retried."""
    last = (0, {}, b"")
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            last = (e.code, dict(e.headers or {}), b"")
        except Exception as e:  # noqa: BLE001
            last = (0, {}, str(e).encode()[:200])
        if i < tries - 1:
            time.sleep(20)
    return last


def age_hours(stamp: str | None) -> float | None:
    if not stamp:
        return None
    try:
        t = dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return (NOW - t).total_seconds() / 3600


def check_files(base: str) -> dict:
    data = {}
    files = ["", "sitemap.xml", "robots.txt", "generated/core.json", "generated/index/devices.json", "live/headlines.json",
             "live/official.json", "live/auto/new_devices.json", "live/auto/benchmarks.json", "sw.js"]
    files += [p.name for p in ROOT.glob("google*.html")]          # Search Console ownership file
    for rel in files:
        status, headers, body = get(base + rel)
        if status != 200:
            fail(f"{'/' + rel if rel else 'Home page'} answered HTTP {status or 'error'}")
            continue
        data[rel] = (headers, body)
        if rel.endswith(".json"):
            try:
                data[rel] = (headers, json.loads(body))
            except ValueError:
                fail(f"/{rel} is not valid JSON")
    ok(f"{len(data)} of {len(files)} pages and data files load")
    return data


def check_sitemap(base: str, data: dict) -> None:
    if "sitemap.xml" not in data:
        return
    headers, body = data["sitemap.xml"]
    if "xml" not in (headers.get("Content-Type") or headers.get("content-type") or ""):
        warn(f"sitemap.xml is served as {headers.get('Content-Type')!r}, not XML")
    if body[:3] == b"\xef\xbb\xbf":
        fail("sitemap.xml starts with a byte-order mark, which search engines may reject")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        fail(f"sitemap.xml is not valid XML ({e})")
        return
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    urls = [u.findtext(f"{ns}loc") or "" for u in root.findall(f"{ns}url")]
    outside = [u for u in urls if not u.startswith(base)]
    if root.tag != f"{ns}urlset" or len(urls) < 300:
        fail(f"sitemap.xml lists {len(urls)} pages (expected several hundred)")
    elif outside:
        fail(f"sitemap.xml lists {len(outside)} addresses outside {base}, e.g. {outside[0]}")
    elif len(set(urls)) != len(urls):
        warn(f"sitemap.xml lists {len(urls) - len(set(urls))} pages twice")
    else:
        ok(f"sitemap.xml is valid: {len(urls)} pages, all under the site's address")
    if "robots.txt" in data:
        robots = data["robots.txt"][1].decode("utf-8", "replace")
        if re.search(r"(?im)^disallow:\s*/\s*$", robots):
            fail("robots.txt blocks the whole site from search engines")
        elif f"Sitemap: {base}sitemap.xml" not in robots:
            warn("robots.txt doesn't point to sitemap.xml")
        else:
            ok("robots.txt allows search engines and points to sitemap.xml")


def check_csp(data: dict) -> None:
    if "" not in data:
        return
    page = data[""][1].decode("utf-8", "replace")
    m = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', page)
    if not m:
        fail("the home page no longer carries its Content-Security-Policy")
        return
    policy = m.group(1)
    missing = [d for d in ("default-src 'self'", "object-src 'none'", "base-uri") if d not in policy]
    if "'unsafe-eval'" in policy:
        fail("the Content-Security-Policy allows 'unsafe-eval'")
    elif missing:
        fail(f"the Content-Security-Policy lost: {', '.join(missing)}")
    else:
        ok("the Content-Security-Policy is in place")


def find_browser(arg: str | None) -> str | None:
    if arg:
        return arg
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "msedge"):
        path = shutil.which(name)
        if path:
            return path
    return None


def check_pages(base: str, browser: str | None) -> None:
    if not browser:
        warn("no headless browser found; pages were not drawn")
        return
    for label, route, words in PAGES:
        with tempfile.TemporaryDirectory() as profile:
            # GitHub's Ubuntu servers don't allow Chrome's own sandbox; only this site is opened there
            sandbox = ["--no-sandbox"] if sys.platform.startswith("linux") else []
            cmd = [browser, *sandbox, "--headless=new", "--no-first-run", "--disable-gpu", "--disable-extensions", "--disable-sync",
                   f"--user-data-dir={profile}", "--window-size=1366,900", "--virtual-time-budget=20000",
                   "--enable-logging=stderr", "--v=0", "--dump-dom", base + route]
            try:
                run = subprocess.run(cmd, capture_output=True, timeout=120, text=True, encoding="utf-8", errors="replace")
            except subprocess.TimeoutExpired:
                fail(f"{label}: the browser didn't finish drawing the page within 2 minutes")
                continue
        dom, log = run.stdout, run.stderr
        text = re.sub(r"<[^>]+>", " ", re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", dom))
        console = [l for l in log.splitlines() if "CONSOLE" in l or "Content Security Policy" in l or "Refused to" in l]
        broken = [l for l in console if re.search(r"Uncaught|Refused to|Content Security Policy", l)]
        missing = [w for w in words if w not in text]
        if broken:
            fail(f"{label}: {re.sub(r'^.*?CONSOLE', 'CONSOLE', broken[0])[:220]}")
        elif missing or len(text.split()) < 80:
            fail(f"{label}: the page didn't draw its content (missing {missing or 'text'})")
        else:
            ok(f"{label} draws its content ({len(text.split())} words), no script errors")


def check_fresh(data: dict) -> None:
    for label, rel, key, limit, level in FRESH:
        doc = data.get(rel, (None, None))[1]
        if not isinstance(doc, dict):
            continue
        stamp = doc.get(key) or doc.get("fetchedAt") or doc.get("updatedAt")
        hours = age_hours(stamp)
        if hours is None:
            warn(f"{label}: no update time recorded")
        elif hours > limit:
            (fail if level == "fail" else warn)(f"{label}: last updated {hours:.0f} h ago (expected within {limit} h)")
        else:
            ok(f"{label}: updated {hours:.1f} h ago")
    heads = data.get("live/headlines.json", (None, None))[1]
    if isinstance(heads, dict):
        feeds = heads.get("feeds") or []
        down = [f.get("source") for f in feeds if not f.get("ok")]
        if feeds and len(down) > len(feeds) / 2:
            fail(f"{len(down)} of {len(feeds)} news and video sources couldn't be read")
        elif down:
            warn(f"{len(down)} of {len(feeds)} news and video sources couldn't be read this run: {', '.join(map(str, down[:8]))}")
        else:
            ok(f"all {len(feeds)} news and video sources were read")
    dev = data.get("live/auto/new_devices.json", (None, None))[1]
    if isinstance(dev, dict):
        held = dev.get("held") or {}
        waiting = dev.get("awaitingAi") or {}
        old = [w for w in waiting.values() if (age_hours(w.get("since")) or 0) > 72]
        if held:
            warn(f"{len(held)} new device page(s) wait for a person (see the dashboard)")
        if old:
            warn(f"{len(old)} new device(s) have waited over 3 days for the AI check")


def check_privacy() -> None:
    names = [p.name for p in (ROOT / "tools").glob("*.py") if re.search(r'^UA = .*darren38', p.read_text(encoding="utf-8"), re.M | re.I)]
    if names:
        fail(f"these tools send the author's name in their user agent: {', '.join(names)}")
    else:
        ok("no tool sends the author's name or address in its user agent")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=os.environ.get("SITE_URL") or DEFAULT_BASE)
    ap.add_argument("--browser")
    args = ap.parse_args()
    base = args.base if args.base.endswith("/") else args.base + "/"
    print(f"Check-up of {base} at {NOW:%Y-%m-%d %H:%M} UTC", flush=True)
    data = check_files(base)
    check_sitemap(base, data)
    check_csp(data)
    check_pages(base, find_browser(args.browser))
    check_fresh(data)
    check_privacy()
    verdict = "FAILED" if failures else "passed"
    summary = [f"## Site check-up {verdict}", f"{len(passed)} passed, {len(warnings)} warning(s), {len(failures)} failure(s) - {NOW:%Y-%m-%d %H:%M} UTC", ""]
    summary += [f"- ❌ {m}" for m in failures] + [f"- ⚠️ {m}" for m in warnings] + [f"- ✅ {m}" for m in passed]
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("\n".join(summary) + "\n")
    print("\n".join(summary[:2]), flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
