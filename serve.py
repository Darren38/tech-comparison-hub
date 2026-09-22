"""Local development server for the Technology Comparison Hub.

On start-up it refreshes the live data (Bank Negara Malaysia exchange rates and the latest
headlines), runs the data build (validate + compile data/ into generated/), and then serves this
folder over HTTP. ES modules and fetch() need http:// — the site does not work when index.html is
opened directly from disk (file://).

While it runs, the Refresh button on the News and Reviews pages asks this server to collect the
latest headlines again (POST /api/live/headlines). On a static host such as GitHub Pages that
endpoint does not exist; the button then reloads the headlines the scheduled build collected.

Usage:
    python serve.py               refresh live data, build, serve on http://localhost:8080
    python serve.py --port 9000   use another port (the next free port is tried automatically)
    python serve.py --offline     skip the network refresh (use the saved rates and headlines)
    python serve.py --no-build    serve the existing generated/ folder without rebuilding
    python serve.py --open        also open the site in the default browser
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import mimetypes
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))

# The Windows registry sometimes maps .js to text/plain, which browsers refuse
# for module scripts. Register the correct types explicitly.
TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".html": "text/html; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}
for ext, mime in TYPES.items():
    mimetypes.add_type(mime.split(";")[0], ext)

REFRESH_LOCK = threading.Lock()
MIN_REFRESH_SECONDS = 60
_last_refresh = 0.0


def refresh_headlines() -> tuple[dict, bool]:
    """Collect headlines now, at most once a minute. Returns (data, collected_now)."""
    global _last_refresh
    import fetch_headlines  # noqa: E402  (tools/fetch_headlines.py)

    with REFRESH_LOCK:
        if time.monotonic() - _last_refresh < MIN_REFRESH_SECONDS and fetch_headlines.OUT.exists():
            return json.loads(fetch_headlines.OUT.read_text(encoding="utf-8")), False
        data = fetch_headlines.run(quiet=True)
        _last_refresh = time.monotonic()
        return data, True


class DevHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def end_headers(self) -> None:
        # Always serve fresh files while developing (data is rebuilt often).
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:  # noqa: N802 (http.server naming)
        if self.path.split("?")[0].rstrip("/") != "/api/live/headlines":
            self.send_error(404, "Not found")
            return
        try:
            data, collected_now = refresh_headlines()
            body = json.dumps({**data, "collectedNow": collected_now}, ensure_ascii=False).encode("utf-8")
            status = 200
        except Exception as exc:  # report the failure to the page instead of dropping the connection
            body = json.dumps({"error": f"{exc.__class__.__name__}: {exc}"}).encode("utf-8")
            status = 502
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_request(self, code="-", size="-") -> None:
        # Keep the console quiet: only report failed requests.
        if str(code)[:1] in {"4", "5"}:
            super().log_request(code, size)


def refresh_live_data() -> None:
    global _last_refresh
    import fetch_headlines  # noqa: E402
    import update_rates  # noqa: E402

    update_rates.update()
    fetch_headlines.run()
    _last_refresh = time.monotonic()


def run_build() -> bool:
    import build  # noqa: E402  (tools/build.py)

    return build.run(strict=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve the Technology Comparison Hub locally.")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--offline", action="store_true", help="skip refreshing exchange rates and headlines")
    parser.add_argument("--no-build", action="store_true", help="skip the data build")
    parser.add_argument("--open", action="store_true", help="open the site in the default browser")
    args = parser.parse_args()

    if not args.offline:
        refresh_live_data()
    if not args.no_build:
        if not run_build():
            print("\n[serve] The data build reported errors (see above). Serving the last good output.\n")

    handler = functools.partial(DevHandler, directory=str(ROOT))
    httpd = None
    for port in range(args.port, args.port + 20):
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
            break
        except OSError:
            continue
    if httpd is None:
        print(f"[serve] No free port between {args.port} and {args.port + 19}.")
        return 1

    url = f"http://localhost:{httpd.server_address[1]}/"
    print(f"[serve] Technology Comparison Hub running at {url}  (Ctrl+C to stop)")
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] Stopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
