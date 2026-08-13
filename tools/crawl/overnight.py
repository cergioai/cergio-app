#!/usr/bin/env python3
"""
OVERNIGHT — discover, fetch, extract, repeat. Runs unattended for hours.

    python3 overnight.py --target 15000 --hours 10

WHAT IT DOES, ON LOOP
  1. DISCOVER  SerpApi -> business listings with their own website URLs
  2. FETCH     each site's homepage + contact page, straight from this Mac
  3. EXTRACT   deterministic, offline, provenance-proofed
  4. BUILD     a spreadsheet, refreshed every few hundred records

Stop it any time with Ctrl-C. Everything already fetched is on disk, and the
next run picks up exactly where it left off. There is no such thing as losing
progress here.

WHY IT FETCHES DIRECTLY INSTEAD OF THROUGH A PAID PROXY
  Small-business sites are Squarespace, Wix and WordPress. A normal machine on
  a normal home connection reads them fine. That makes the website layer free,
  removes a vendor from the critical path, and means an overnight run cannot
  produce a surprise invoice. Bright Data is used for Instagram only, where it
  is genuinely needed.

  robots.txt is respected. Disallowed pages are skipped, not worked around.

THE SEPARATION STILL HOLDS
  Everything here is a FETCH step: it writes pages to raw/ and never decides a
  field value. extract.py reads those pages offline. If you ever put a lead
  value in this file, the fabrication bug is back.
"""

import json, os, re, sys, time, threading, argparse, subprocess, signal
import urllib.request, urllib.error, urllib.parse, urllib.robotparser
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW, CAND, OUT = (os.path.join(ROOT, d) for d in ("raw", "candidates", "out"))
for d in (RAW, CAND, OUT):
    os.makedirs(d, exist_ok=True)
LOG = os.path.join(OUT, "overnight.log")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
SERP = "https://serpapi.com/search.json"
CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/services"]

_stop = threading.Event()
_lock = threading.Lock()
_robots = {}
_counts = {"fetched": 0, "skipped": 0, "blocked": 0, "discovered": 0}


def log(msg):
    line = f"{time.strftime('%H:%M:%S')}  {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def key(name):
    v = os.environ.get(name)
    if not v:
        sys.exit(f"{name} is not set — run START HERE.command first, it saves your keys.")
    return v


# ------------------------------------------------------------------ FETCH ---
def allowed(url):
    """Respect robots.txt. A blocked page is skipped, never routed around."""
    try:
        p = urllib.parse.urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        with _lock:
            rp = _robots.get(base)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            rp.set_url(base + "/robots.txt")
            try:
                rp.read()
            except Exception:
                rp = "open"          # no robots file = nothing disallowed
            with _lock:
                _robots[base] = rp
        return True if rp == "open" else rp.can_fetch(UA, url)
    except Exception:
        return False


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(3_000_000)
        enc = r.headers.get_content_charset() or "utf-8"
        return raw.decode(enc, errors="replace")


TAG_RE = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.S | re.I)


def to_text(html):
    """
    Strip markup, KEEP mailto/tel/instagram hrefs — those carry the contacts.
    The visible text alone loses the very values we are here for.
    """
    hrefs = re.findall(r'href=["\'](mailto:[^"\']+|tel:[^"\']+|[^"\']*instagram\.com/[^"\']*)["\']',
                       html, re.I)
    body = TAG_RE.sub(" ", html)
    body = re.sub(r"<[^>]+>", " ", body)
    body = (body.replace("&amp;", "&").replace("&nbsp;", " ").replace("&#64;", "@")
                .replace("&quot;", '"').replace("&#39;", "'").replace("&lt;", "<")
                .replace("&gt;", ">"))
    body = re.sub(r"[ \t\r\f\v]+", " ", body)
    body = re.sub(r"\n\s*\n+", "\n", body)
    links = "\n".join(urllib.parse.unquote(h) for h in hrefs)
    return (body.strip()[:200_000] + "\n\n--- LINKS ---\n" + links[:20_000])


def fetch_candidate(rid):
    """Fetch one business's pages. Returns how many artifacts were written."""
    if _stop.is_set():
        return 0
    cp = os.path.join(CAND, f"{rid}.json")
    try:
        c = json.load(open(cp, encoding="utf-8"))
    except Exception:
        return 0
    if c.get("site_artifacts"):
        with _lock:
            _counts["skipped"] += 1
        return 0                                   # already done, resume-safe
    site = (c.get("website_url") or "").rstrip("/")
    if not site.startswith("http"):
        return 0

    written = []
    for i, path in enumerate(CONTACT_PATHS, 1):
        if _stop.is_set() or len(written) >= 3:
            break
        url = site + path
        if not allowed(url):
            with _lock:
                _counts["blocked"] += 1
            continue
        try:
            html = fetch(url)
        except Exception:
            continue
        if len(html) < 200:
            continue
        aid = f"{rid}__s{i}"
        with open(os.path.join(RAW, f"{aid}.json"), "w", encoding="utf-8") as f:
            json.dump({"artifact_id": aid, "url": url, "kind": "site",
                       "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "content": to_text(html)}, f)
        written.append(aid)
        time.sleep(0.4)                            # polite, per-site

    if written:
        c["site_artifacts"] = written
        # the IG handle comes out of the business's own page in extract.py —
        # strongest possible proof, and nothing is guessed here
        json.dump(c, open(cp, "w", encoding="utf-8"), indent=2)
        with _lock:
            _counts["fetched"] += 1
    return len(written)


# -------------------------------------------------------------- DISCOVERY ---
SERVICE_TYPES = [
    "dog walker", "dog groomer", "doggy daycare", "pet sitter", "personal trainer",
    "group fitness", "martial arts school", "yoga studio", "pilates studio",
    "nail salon", "esthetician", "lash studio", "hair salon", "barber shop",
    "house cleaning", "maid service", "carpet cleaning", "window cleaning",
    "handyman", "plumber", "electrician", "hvac contractor", "locksmith",
    "pest control", "landscaping", "lawn care", "junk removal", "moving company",
    "pressure washing", "appliance repair", "garage door repair", "roofing",
    "tutor", "test prep tutor", "math tutor", "music teacher", "swim instructor",
    "tennis coach", "home organizer", "interior designer", "photographer",
    "event planner", "florist", "auto detailing", "mobile mechanic",
    "physical therapy", "chiropractor", "nutritionist", "babysitter agency",
    "nanny agency", "senior care", "home health aide", "dog trainer",
]
AREAS = {
    "NYC": ["Manhattan NY", "Brooklyn NY", "Queens NY", "Bronx NY",
            "Staten Island NY", "Jersey City NJ", "Hoboken NJ", "Astoria NY",
            "Williamsburg Brooklyn NY", "Harlem NY", "Upper East Side NY",
            "Park Slope Brooklyn NY", "Long Island City NY", "Flushing NY"],
    "MIA": ["Miami FL", "Miami Beach FL", "Brickell Miami FL", "Wynwood Miami FL",
            "Coral Gables FL", "Coconut Grove FL", "Doral FL", "Aventura FL",
            "Hialeah FL", "Kendall FL", "Fort Lauderdale FL", "Hollywood FL"],
}
MARKET = {"NYC": ("New York", "NY"), "MIA": ("Miami-Ft. Lauderdale", "FL")}


def known_domains():
    d = set()
    for fn in os.listdir(CAND):
        try:
            u = json.load(open(os.path.join(CAND, fn), encoding="utf-8")).get("website_url") or ""
            host = urllib.parse.urlparse(u).netloc.lower().replace("www.", "")
            if host:
                d.add(host)
        except Exception:
            pass
    return d


def discover_round(city, k, seen, made_prefix, budget):
    """One pass over areas x types. Returns new candidate ids."""
    new = []
    market, state = MARKET[city]
    for area in AREAS[city]:
        for t in SERVICE_TYPES:
            if _stop.is_set() or len(new) >= budget:
                return new
            q = {"engine": "google_local", "q": f"{t} {area}",
                 "location": area, "api_key": k, "num": 20}
            try:
                data = json.loads(fetch(f"{SERP}?{urllib.parse.urlencode(q)}", timeout=60))
            except Exception as e:
                log(f"  serpapi problem on '{t} {area}': {str(e)[:80]}")
                time.sleep(2)
                continue
            results = data.get("local_results") or []
            slug = re.sub(r"[^a-z]", "", t)[:12]
            aid = f"disc-{city}-{slug}-{re.sub(r'[^a-z]', '', area.lower())[:10]}"
            with open(os.path.join(RAW, f"{aid}.json"), "w", encoding="utf-8") as f:
                json.dump({"artifact_id": aid, "url": f"serpapi:{t} {area}",
                           "kind": "discovery",
                           "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                           "content": json.dumps(data, ensure_ascii=False)[:300_000]}, f)
            for r in results:
                site = (r.get("website") or "").split("?")[0]
                host = urllib.parse.urlparse(site).netloc.lower().replace("www.", "")
                if not host or host in seen:
                    continue
                seen.add(host)
                rid = f"s-{city}-{slug}-{made_prefix[0]:05d}"
                made_prefix[0] += 1
                json.dump({
                    "record_id": rid, "audience": "service", "city": city,
                    "market": market, "state": state, "category": None,
                    "service_type": t.title(), "display_name": r.get("title"),
                    "ig_handle": None, "website_url": site,
                    "source": "serpapi:google_local", "area": area,
                    "discovery_artifacts": [aid], "site_artifacts": [],
                }, open(os.path.join(CAND, f"{rid}.json"), "w", encoding="utf-8"), indent=2)
                new.append(rid)
            with _lock:
                _counts["discovered"] += len(results)
            time.sleep(0.3)
    return new


# ----------------------------------------------------------------- BUILD ----
def rebuild(quiet=True):
    for script in ("extract.py", "build_xlsx.py"):
        r = subprocess.run([sys.executable, os.path.join(ROOT, script)],
                           cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            log(f"  {script} failed: {r.stderr[-300:]}")
            return
    try:
        recs = json.load(open(os.path.join(OUT, "records.json"), encoding="utf-8"))
        log(f"  >> spreadsheet refreshed: {len(recs)} usable leads "
            f"({sum(1 for x in recs if x['email'])} email, "
            f"{sum(1 for x in recs if x['phone'])} phone)")
    except Exception:
        pass


# ------------------------------------------------------------------ MAIN ----
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=15000, help="usable leads to aim for")
    ap.add_argument("--hours", type=float, default=10.0, help="stop after this long")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--cities", default="NYC,MIA")
    args = ap.parse_args()

    signal.signal(signal.SIGINT, lambda *_: (_stop.set(), log("\nstopping cleanly...")))
    deadline = time.time() + args.hours * 3600
    k = key("SERPAPI_KEY")
    seen = known_domains()
    counter = [len(seen) + 1]

    log("=" * 62)
    log(f"OVERNIGHT RUN — target {args.target}, stopping after {args.hours}h")
    log(f"starting from {len(seen)} businesses already on disk")
    log("Ctrl-C is safe at any point; progress is never lost")
    log("=" * 62)

    cities = [c.strip() for c in args.cities.split(",")]
    rounds = 0
    while not _stop.is_set() and time.time() < deadline:
        rounds += 1
        for city in cities:
            if _stop.is_set() or time.time() > deadline:
                break

            log(f"\n[round {rounds}] {city} — finding businesses")
            new = discover_round(city, k, seen, counter, budget=1200)
            log(f"[round {rounds}] {city} — {len(new)} new businesses found")

            todo = [f[:-5] for f in os.listdir(CAND) if f.endswith(".json")]
            todo = [r for r in todo if not json.load(
                open(os.path.join(CAND, r + ".json"), encoding="utf-8")).get("site_artifacts")]
            if not todo:
                continue

            log(f"[round {rounds}] {city} — reading {len(todo)} websites "
                f"({args.workers} at a time)")
            done = 0
            with ThreadPoolExecutor(max_workers=args.workers) as ex:
                futs = {ex.submit(fetch_candidate, r): r for r in todo}
                for fu in as_completed(futs):
                    if _stop.is_set() or time.time() > deadline:
                        _stop.set()
                        break
                    done += 1
                    if done % 100 == 0:
                        log(f"    {done}/{len(todo)} sites  "
                            f"[{_counts['fetched']} with pages, "
                            f"{_counts['blocked']} robots-blocked]")
                    if done % 500 == 0:
                        rebuild()

            rebuild()
            try:
                n = len(json.load(open(os.path.join(OUT, "records.json"), encoding="utf-8")))
                if n >= args.target:
                    log(f"\nTARGET REACHED — {n} usable leads")
                    _stop.set()
            except Exception:
                pass

        if not _stop.is_set() and not new:
            log("\nno new businesses left to find in these areas — stopping")
            break

    rebuild()
    log("\n" + "=" * 62)
    log(f"FINISHED — {_counts['fetched']} sites read, "
        f"{_counts['blocked']} skipped for robots.txt")
    log(f"spreadsheet: out/CERGIO_crawl_v2_audit_200.xlsx")
    log("=" * 62)


if __name__ == "__main__":
    main()
