"""Fetch a page and turn it into compact text lines (for reading official spec pages)."""
import re, sys, html, urllib.request, gzip, json
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", "Accept-Language": "en-MY,en;q=0.9"}
def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        b = r.read()
        if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
        return r.status, r.geturl(), b.decode("utf-8", "replace")
def to_text(h):
    h = re.sub(r"(?is)<(script|style|noscript|svg|template)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r"(?i)<br\s*/?>", "\n", h)
    h = re.sub(r"(?i)</?(p|div|li|tr|td|th|h\d|dt|dd|section|ul|ol|table|span)[^>]*>", "\n", h)
    h = re.sub(r"<[^>]+>", " ", h)
    h = html.unescape(h)
    lines = [re.sub(r"[ \t ]+", " ", l).strip() for l in h.split("\n")]
    out = []
    for l in lines:
        if l and (not out or out[-1] != l):
            out.append(l)
    return out
def meta(h, prop):
    m = re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]+content=["\']([^"\']+)' % re.escape(prop), h, re.I) or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']%s["\']' % re.escape(prop), h, re.I)
    return html.unescape(m.group(1)) if m else None
if __name__ == "__main__":
    url = sys.argv[1]; start = sys.argv[2] if len(sys.argv) > 2 else None; n = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    s, final, h = fetch(url)
    lines = to_text(h)
    print(f"[{s}] {final} html={len(h)} lines={len(lines)} og:image={meta(h, 'og:image')}")
    i = 0
    if start:
        idx = [k for k, l in enumerate(lines) if start.lower() in l.lower()]
        i = idx[0] if idx else 0
    print(" | ".join(lines[i:i + n]))
