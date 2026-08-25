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

import json, os, re, sys, time, threading, argparse, subprocess, signal, socket
import urllib.request, urllib.error, urllib.parse, urllib.robotparser
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW, CAND, OUT = (os.path.join(ROOT, d) for d in ("raw", "candidates", "out"))
for d in (RAW, CAND, OUT):
    os.makedirs(d, exist_ok=True)
LOG = os.path.join(OUT, "overnight.log")
# Which (area, type) searches have already been run, EVER. Without this the
# discovery loop restarts from the top every run: hourly would fire ~1,484
# paid searches an hour, nearly all returning businesses already on disk.
# That is a quota fire with no data to show for it.
DONE_Q = os.path.join(CAND, "_searched.json")

# THE SPEND GATE. --max-searches was documented as the cap but was only ever
# checked inside discover_round(), which runs solely under --also-web. The three
# sources that actually run -- ig, realestate, localbiz -- had NO cap at all.
# An uncapped paid loop is the Apify failure mode with a different logo.
# MAX_SEARCHES[0] == 0 means "make no paid calls whatsoever".
MAX_SEARCHES = [900]

# Set when a paid provider proves unusable. Disables further PAID discovery
# without touching _stop, so free sources and the fetch chain carry on.
PAID_DEAD = [False]


def paid_budget_left():
    return MAX_SEARCHES[0] - _counts["searches"]


def paid_exhausted(where):
    if PAID_DEAD[0]:
        return True
    if paid_budget_left() > 0:
        return False
    log(f"  [{where}] paid-search cap {MAX_SEARCHES[0]} reached — "
        f"no further paid calls this run")
    return True

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
SERP = "https://serpapi.com/search.json"

# No socket in this process may block forever. urllib.robotparser.read()
# takes no timeout argument at all, so a single hung robots.txt used to
# park a worker thread permanently -- and ThreadPoolExecutor's shutdown
# waits for every worker, so one dead host could stall a whole shard past
# its deadline and leave the rest of the businesses unfetched.
socket.setdefaulttimeout(25)

# ---------------------------------------------------------------- PROVIDER --
# Discovery used to be hard-wired to SerpApi. That single dependency took the
# whole crawler down when its 250-search free allowance ran out: 5,045 failed
# calls, zero records, a week lost. Provider is now chosen at runtime by which
# key is present, and every provider is normalised to SerpApi's response shape
# so nothing downstream changes.
#
#   SERPER_API_KEY  -> serper.dev   ~$0.30/1k, 2,500 free on signup
#   SERPAPI_KEY     -> serpapi.com  ~$25/1k
#
# Serper is preferred when both exist: same results, roughly 80x cheaper.
SERPER_PLACES = "https://google.serper.dev/places"
SERPER_SEARCH = "https://google.serper.dev/search"


def provider():
    if os.environ.get("SERPER_API_KEY"):
        return "serper"
    if os.environ.get("SERPAPI_KEY"):
        return "serpapi"
    return None


def _serper(url, payload):
    return serp_fetch(url, post=json.dumps(payload).encode(), headers={
        "X-API-KEY": os.environ["SERPER_API_KEY"],
        "Content-Type": "application/json"})


def search_local(term, area, key):
    """Local-business search. Returns SerpApi's {"local_results": [...]} shape."""
    if provider() == "serper":
        body = _serper(SERPER_PLACES, {"q": f"{term} {area}", "num": 20})
        d = json.loads(body)
        return {"local_results": [
            {"title": r.get("title"), "website": r.get("website"),
             "phone": r.get("phoneNumber"), "address": r.get("address")}
            for r in (d.get("places") or [])],
            "_raw": body}          # verbatim provider bytes — this is the evidence
    q = {"engine": "google_local", "q": f"{term} {area}", "location": area,
         "api_key": key, "num": 20}
    return json.loads(serp_fetch(SERP + "?" + urllib.parse.urlencode(q)))


def search_web(query, key):
    """Plain web search. Returns SerpApi's {"organic_results": [...]} shape."""
    if provider() == "serper":
        body = _serper(SERPER_SEARCH, {"q": query, "num": 20})
        d = json.loads(body)
        return {"organic_results": [
            {"title": r.get("title"), "link": r.get("link")}
            for r in (d.get("organic") or [])],
            "_raw": body}          # verbatim provider bytes — this is the evidence
    q = {"engine": "google", "num": 20, "api_key": key, "q": query}
    return json.loads(serp_fetch(SERP + "?" + urllib.parse.urlencode(q)))
CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/services"]

_stop = threading.Event()
_lock = threading.Lock()
_robots = {}
_counts = {"fetched": 0, "skipped": 0, "blocked": 0, "unfetched": 0,
           "discovered": 0, "searches": 0, "search_errors": 0}
_fetch_fail = {}          # why -> count, printed at the end of the run


def log(msg):
    line = f"{time.strftime('%H:%M:%S')}  {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


# ------------------------------------------------------------------ FETCH ---
ROBOTS_TIMEOUT = 8


def _read_robots(base):
    """
    Fetch and parse one robots.txt. Returns a parser, "open" or "closed".

    THE SILENT BLOCKER. This used to be urllib.robotparser's own .read(), and
    that method has two defects that together stopped most of the crawl:

      1. It requests robots.txt with Python's DEFAULT User-Agent
         ("Python-urllib/3.x"). Cloudflare and most WAFs answer that with 403.
      2. On a 403 the stdlib parser sets disallow_all = True -- so every page
         on the host is then treated as forbidden.

    So a host that is perfectly happy to be read, but sits behind a bot shield,
    was recorded as robots-blocked and never fetched. Run 177: 405 businesses
    discovered, 39 fetched. Nothing in the log said why.

    RFC 9309 s2.3.1.3 is explicit: for ANY 4xx the crawler "MAY access any
    resources" -- 403 on robots.txt is a challenge page, not a directive.
    5xx still means back off, and that is honoured below.
    """
    try:
        req = urllib.request.Request(base + "/robots.txt",
                                     headers={"User-Agent": UA, "Accept": "text/plain,*/*"})
        with urllib.request.urlopen(req, timeout=ROBOTS_TIMEOUT) as r:
            body = r.read(500_000).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if 400 <= e.code < 500:
            return "open"        # RFC 9309: 4xx = no restrictions
        return "closed"          # RFC 9309: 5xx = assume complete disallow
    except Exception:
        # Unreachable robots.txt on an unreachable host. The page fetch that
        # follows will fail on its own merits and be counted as an error; it
        # must not be mislabelled as a robots block.
        return "open"
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(body.splitlines())
    return rp


def allowed(url):
    """Respect robots.txt. A blocked page is skipped, never routed around."""
    try:
        p = urllib.parse.urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        with _lock:
            rp = _robots.get(base)
        if rp is None:
            rp = _read_robots(base)
            with _lock:
                _robots[base] = rp
        if rp == "open":
            return True
        if rp == "closed":
            return False
        return rp.can_fetch(UA, url)
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


# ---------------------------------------------------------- SERPAPI GATE ---
# THE SCALE BUG. Fourteen shards x 24 workers meant ~336 concurrent callers
# hammering SerpApi, and it answered every single one with HTTP 429. The old
# code caught the error, slept 2s and moved to the next query -- so a run
# burned the entire grid collecting nothing. 5,045 consecutive 429s in the
# last local log, zero successful searches, zero candidates, empty publish.
#
# Two changes: retry the SAME query with exponential backoff instead of
# abandoning it, and serialise paid calls behind one process-wide lock with a
# minimum gap, so shards cannot stampede. Throughput now comes from parallel
# FETCHING (which is free and unmetered), not parallel SEARCHING.
_serp_lock = threading.Lock()
_serp_last = [0.0]
SERP_MIN_GAP = float(os.environ.get("SERP_MIN_GAP", "1.2"))   # seconds between paid calls


def serp_fetch(url, tries=5, post=None, headers=None):
    """One paid discovery call, rate-limited and retried on 429."""
    delay = 4.0
    for attempt in range(tries):
        with _serp_lock:
            gap = SERP_MIN_GAP - (time.time() - _serp_last[0])
            if gap > 0:
                time.sleep(gap)
            _serp_last[0] = time.time()
        try:
            if post is not None:
                req = urllib.request.Request(url, data=post, headers={
                    "User-Agent": UA, **(headers or {})})
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.read().decode("utf-8", errors="replace")
            return fetch(url, timeout=60)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            if attempt == tries - 1:
                raise
            log(f"  serpapi 429 - backing off {delay:.0f}s "
                f"(attempt {attempt + 1}/{tries})")
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


TAG_RE = re.compile(r"<(script|style|noscript)[^>]*>.*?</\1>", re.S | re.I)

# JSON-LD is where Squarespace, Wix, Webflow, Shopify and every WordPress SEO
# plugin put the phone, the email and the postal address. It lives inside
# <script type="application/ld+json">, so TAG_RE above deleted all of it before
# extract.py ever saw the page. On a template site the contact block is often
# rendered client-side and JSON-LD is the ONLY place the number appears in the
# bytes we store. Proven in the harness: a Squarespace-shaped page whose phone,
# email and city existed only in JSON-LD came out of to_text() with all three
# gone, and the record was published as "no contact".
LD_RE = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)

# Open Graph / business meta tags carry the same values on many themes.
META_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\']([^"\']*(?:phone|email|contact|street|locality|region|postal)[^"\']*)["\'][^>]*content=["\']([^"\']+)["\']',
    re.I)

# Keys worth surfacing verbatim. Everything else in the graph is noise.
LD_KEYS = ("telephone", "phone", "email", "streetaddress", "addresslocality",
           "addressregion", "postalcode", "addresscountry", "name", "url",
           "sameas", "legalname", "contacttype", "faxnumber")


def _ld_flatten(node, out, depth=0):
    """Walk a decoded JSON-LD graph and emit 'key: value' for contact fields.

    This is a faithful decode of bytes we fetched, in the same spirit as the
    HTML-entity decoding below it -- no value is invented, reformatted or
    inferred, so SPEC-280 R-B still holds: every published field remains a
    byte-level substring of the artifact this function produces.
    """
    if depth > 8 or len(out) > 400:
        return
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, (dict, list)):
                _ld_flatten(v, out, depth + 1)
            elif v is not None and not isinstance(v, bool):
                s = str(v).strip()
                if s and str(k).lower() in LD_KEYS:
                    out.append(f"{k}: {s}")
    elif isinstance(node, list):
        for v in node:
            _ld_flatten(v, out, depth + 1)


def structured(html):
    """Contact-bearing structured data, as text, before any tag stripping."""
    out = []
    for raw in LD_RE.findall(html)[:12]:
        block = raw.strip()
        if not block:
            continue
        try:
            _ld_flatten(json.loads(block), out)
        except Exception:
            # Unparseable (template placeholders, trailing commas). Keep the
            # raw bytes anyway -- a regex in extract.py can still prove a phone
            # or an email out of them, and they are verbatim page content.
            out.append(block[:4000])
    for name, content in META_RE.findall(html)[:40]:
        c = content.strip()
        if c:
            out.append(f"{name}: {c}")
    return "\n".join(out)[:40_000]


def to_text(html):
    """
    Strip markup, KEEP mailto/tel/instagram hrefs — those carry the contacts.
    The visible text alone loses the very values we are here for.
    """
    hrefs = re.findall(r'href=["\'](mailto:[^"\']+|tel:[^"\']+|[^"\']*instagram\.com/[^"\']*)["\']',
                       html, re.I)
    struct = structured(html)                      # BEFORE TAG_RE deletes it
    body = TAG_RE.sub(" ", html)
    body = re.sub(r"<[^>]+>", " ", body)
    body = (body.replace("&amp;", "&").replace("&nbsp;", " ").replace("&#64;", "@")
                .replace("&quot;", '"').replace("&#39;", "'").replace("&lt;", "<")
                .replace("&gt;", ">"))
    body = re.sub(r"[ \t\r\f\v]+", " ", body)
    body = re.sub(r"\n\s*\n+", "\n", body)
    links = "\n".join(urllib.parse.unquote(h) for h in hrefs)
    return (body.strip()[:200_000]
            + "\n\n--- LINKS ---\n" + links[:20_000]
            + "\n\n--- STRUCTURED ---\n" + struct)


def host_variants(site):
    """The same site with and without www, https first.

    Small-business hosting is inconsistent: half these domains serve only on
    www, half only on the apex, and a plain redirect is not guaranteed. Trying
    the other spelling costs one request and recovers businesses that would
    otherwise be recorded as unreachable.
    """
    out = [site]
    p = urllib.parse.urlparse(site)
    if p.netloc.startswith("www."):
        out.append(urllib.parse.urlunparse(p._replace(netloc=p.netloc[4:])))
    else:
        out.append(urllib.parse.urlunparse(p._replace(netloc="www." + p.netloc)))
    if p.scheme == "http":
        out.insert(1, urllib.parse.urlunparse(p._replace(scheme="https")))
    return out


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
        _note(rid, c, cp, "no_website")
        return 0

    # Settle on a base that actually answers before spending five more requests
    # on paths under a hostname that does not resolve or does not serve.
    base, why = None, "unreachable"
    for cand in host_variants(site):
        if not allowed(cand + "/"):
            why = "robots_blocked"
            continue
        try:
            root = fetch(cand)
        except urllib.error.HTTPError as e:
            why = f"http_{e.code}"
            continue
        except Exception as e:
            why = type(e).__name__.lower()
            continue
        if len(root) < 200:
            why = "page_too_short"
            continue
        base, first_html = cand, root
        break

    if base is None:
        _note(rid, c, cp, why)
        return 0

    written = []
    for i, path in enumerate(CONTACT_PATHS, 1):
        if _stop.is_set() or len(written) >= 3:
            break
        url = base + path
        if path == "":
            html = first_html                      # already fetched above
        else:
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
        c.pop("fetch_failed", None)
        # the IG handle comes out of the business's own page in extract.py —
        # strongest possible proof, and nothing is guessed here
        json.dump(c, open(cp, "w", encoding="utf-8"), indent=2)
        with _lock:
            _counts["fetched"] += 1
    return len(written)


def _note(rid, c, cp, why):
    """Record WHY a business was never read, on the business itself.

    Run 177 published 405 businesses and 0 contacts, and the only thing the
    logs could say was "no contact". Whether those sites were robots-blocked,
    dead, or simply had no phone on the page was unknowable without re-running
    the whole crawl. Now every failure names itself, survives into the merge
    artifact, and is counted in the end-of-run summary.
    """
    with _lock:
        _counts["blocked" if why == "robots_blocked" else "unfetched"] += 1
        _fetch_fail[why] = _fetch_fail.get(why, 0) + 1
    try:
        c["fetch_failed"] = {"why": why,
                             "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        json.dump(c, open(cp, "w", encoding="utf-8"), indent=2)
    except Exception:
        pass


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
# ---- SOURCE 9: REAL ESTATE AGENTS ---------------------------------------
# Individual agents and small brokerages. Instagram is OPTIONAL here and is
# recorded either way — founder, 2026-08-13: "mark which have an IG account".
REALESTATE_TYPES = [
    "real estate agent", "realtor", "real estate broker", "buyers agent",
    "listing agent", "luxury real estate agent", "condo specialist realtor",
    "rental agent", "property manager", "real estate brokerage",
]

# ---- SOURCE 10: LOCAL BUSINESSES ----------------------------------------
# Physical, bricks-and-mortar businesses. Food and drink are excluded on
# purpose: restaurants, bars and cafes are a different buyer with different
# economics, and they would swamp every other category by sheer count.
LOCALBIZ_TYPES = [
    "dry cleaner", "laundromat", "tailor", "shoe repair", "florist",
    "hardware store", "locksmith shop", "print shop", "framing shop",
    "bike shop", "phone repair shop", "computer repair shop", "furniture store",
    "pet store", "veterinary clinic", "pharmacy", "optician", "dentist",
    "chiropractor clinic", "physical therapy clinic", "dance studio",
    "music school", "art studio", "photography studio", "bookstore",
    "toy store", "gift shop", "jewelry store", "watch repair", "auto repair shop",
    "tire shop", "car wash", "driving school", "daycare center", "preschool",
    "tutoring center", "gym", "boxing gym", "climbing gym", "salon suite",
    "barbershop", "spa", "medical spa", "urgent care clinic", "eye clinic",
    "hearing center", "appliance store", "flooring store", "paint store",
    "garden center", "nursery plants", "sewing shop", "party supply store",
    "costume shop", "storage facility", "moving company office", "tax office",
    "insurance agency", "travel agency", "notary office", "shipping store",
]
FOOD_WORDS = ("restaurant", "bar ", " bar", "cafe", "coffee", "pizzeria",
              "bakery", "brewery", "deli", "diner", "bistro", "pub", "tavern",
              "grill", "eatery", "sushi", "taqueria", "juice", "smoothie",
              "ice cream", "food", "kitchen", "wine", "liquor", "cocktail")

# Founder, 2026-08-13: "miami targets are always 20% of nyc".
CITY_TARGETS = {"realestate": {"NYC": 2000, "MIA": 400},
                "localbiz":   {"NYC": 2000, "MIA": 400}}

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


def load_done():
    try:
        return set(json.load(open(DONE_Q, encoding="utf-8")))
    except Exception:
        return set()


def save_done(done):
    json.dump(sorted(done), open(DONE_Q, "w", encoding="utf-8"))


# Aggregators, socials and booking platforms. A link to one of these is not the
# business's own domain, so the own-domain rule in extract.py would reject any
# contact found there anyway (SPEC-280 test #280.5).
NOT_OWN_SITE = (
    "instagram.", "facebook.", "twitter.", "x.com", "tiktok.", "linkedin.",
    "youtube.", "pinterest.", "yelp.", "google.", "goo.gl", "maps.app",
    "tripadvisor.", "booksy.", "vagaro.", "styleseat.", "square.site",
    "linktr.ee", "beacons.ai", "thumbtack.", "angi.", "homeadvisor.",
    "nextdoor.", "groupon.", "eventbrite.", "wa.me", "bit.ly",
)

def discover_ig(city, api_key, seen_hosts, counter, budget):
    """
    IG-FIRST discovery. This is the one that matters.

    Finding businesses on Google and then hoping they link Instagram only
    surfaces the ~35% who bother to. Searching Instagram directly for the same
    service types returns accounts that have Instagram BY CONSTRUCTION — which
    is the whole point, because an IG-having service provider is exactly what
    becomes a creator.

    Still fetch-only. Handles come from real instagram.com URLs in the search
    output; every contact detail is proven later, offline, by extract.py.
    """
    new = []
    market, state = MARKET[city]
    done = load_done()
    fresh = 0
    for area in AREAS[city]:
        for t in SERVICE_TYPES:
            if _stop.is_set() or len(new) >= budget:
                save_done(done)
                return new
            qkey = f"IG|{city}|{area}|{t}"
            if qkey in done:
                continue
            if paid_exhausted("ig"):
                save_done(done)
                return new
            place = area.replace(" NY", "").replace(" NJ", "").replace(" FL", "")
            try:
                # NOT site:instagram.com — that returns instagram URLs with no
                # website, which produced rows that could never be contacted.
                data = search_web('"' + t + '" ' + place + ' instagram', api_key)
            except Exception as e:
                log("  ig search failed '" + t + " " + place + "': " + str(e)[:70])
                _counts["search_errors"] += 1
                if _counts["search_errors"] >= 25 and _counts["searches"] == 0:
                    log("  25 search errors, zero successes — the paid provider is "
                        "refusing this key. Disabling PAID discovery only; free "
                        "sources and website fetching continue.")
                    PAID_DEAD[0] = True
                    save_done(done)
                    return new
                time.sleep(2)
                continue
            _counts["searches"] += 1
            done.add(qkey)
            fresh += 1
            if fresh % 25 == 0:
                save_done(done)
            slug = re.sub(r"[^a-z]", "", t)[:12]
            aid = "igdisc-" + city + "-" + slug + "-" + re.sub(r"[^a-z]", "", area.lower())[:10]
            json.dump({"artifact_id": aid,
                       "url": "serpapi:google:site:instagram.com " + t + " " + place,
                       "kind": "discovery",
                       "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "content": (data.get("_raw")
                                   or json.dumps(data, ensure_ascii=False))[:300_000]},
                      open(os.path.join(RAW, aid + ".json"), "w", encoding="utf-8"))
            for r in (data.get("organic_results") or []):
                link = (r.get("link") or "").split("?")[0]
                if not link.startswith("http"):
                    continue
                host = urllib.parse.urlparse(link).netloc.lower().replace("www.", "")
                # A social or directory page is not the business's own site, and
                # it is not something the fetch layer can prove contacts from.
                if not host or any(b in host for b in NOT_OWN_SITE):
                    continue
                if host in seen_hosts:
                    continue
                seen_hosts.add(host)
                rid = "ig-" + city + "-" + slug + "-" + str(counter[0]).zfill(5)
                counter[0] += 1
                json.dump({
                    "record_id": rid, "audience": "service", "city": city,
                    "market": market, "state": state, "category": None,
                    "service_type": t.title(),
                    "display_name": (r.get("title") or "").split("(")[0].strip()[:120],
                    # ig_handle stays NULL here on purpose. extract.py proves it
                    # from the business's own fetched page — A_own_site_url, the
                    # strongest evidence grade. Never guessed at discovery time.
                    "ig_handle": None, "website_url": link, "area": area,
                    "source": "search:web:instagram-biased",
                    "discovery_artifacts": [aid], "site_artifacts": [],
                }, open(os.path.join(CAND, rid + ".json"), "w", encoding="utf-8"), indent=2)
                new.append(rid)
                with _lock:
                    _counts["discovered"] += 1
            time.sleep(0.3)
    save_done(done)
    if fresh == 0:
        log("  [" + city + "] IG grid fully searched — widen SERVICE_TYPES or AREAS")
    return new


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


def discover_places(city, api_key, seen, counter, audience, types, target,
                    label_prefix, exclude_food=False):
    """
    Google Local discovery for an arbitrary audience. Shared by real estate
    (source 9) and local businesses (source 10).

    Instagram is NOT required for these two. Their websites are fetched the same
    way, extract.py records whether a handle was found, and the dashboard shows
    the split. A physical business without Instagram is still a lead; it just is
    not a creator-conversion candidate.
    """
    new = []
    market, state = MARKET[city]
    done = load_done()
    fresh = 0
    have = sum(1 for fn in os.listdir(CAND)
               if fn.startswith(label_prefix + "-" + city + "-"))
    if have >= target:
        log(f"  [{city}] {audience}: target {target} already met ({have} on disk)")
        return new
    for area in AREAS[city]:
        for t in types:
            if _stop.is_set() or have + len(new) >= target:
                save_done(done)
                return new
            qkey = f"{audience}|{city}|{area}|{t}"
            if qkey in done:
                continue
            if paid_exhausted(audience):
                save_done(done)
                return new
            try:
                data = search_local(t, area, api_key)
            except Exception as e:
                log(f"  {audience} search failed '{t} {area}': {str(e)[:70]}")
                _counts["search_errors"] += 1
                if _counts["search_errors"] >= 25 and _counts["searches"] == 0:
                    log("  25 search errors, zero successes — the paid provider is "
                        "refusing this key. Disabling PAID discovery only; free "
                        "sources and website fetching continue.")
                    PAID_DEAD[0] = True
                    save_done(done)
                    return new
                time.sleep(2)
                continue
            _counts["searches"] += 1
            done.add(qkey)
            fresh += 1
            if fresh % 25 == 0:
                save_done(done)
            slug = re.sub(r"[^a-z]", "", t)[:12]
            aid = (label_prefix + "disc-" + city + "-" + slug + "-"
                   + re.sub(r"[^a-z]", "", area.lower())[:10])
            json.dump({"artifact_id": aid, "url": f"serpapi:google_local:{t} {area}",
                       "kind": "discovery",
                       "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                       "content": (data.get("_raw")
                                   or json.dumps(data, ensure_ascii=False))[:300_000]},
                      open(os.path.join(RAW, aid + ".json"), "w", encoding="utf-8"))
            for r in (data.get("local_results") or []):
                title = (r.get("title") or "")
                blob = (title + " " + str(r.get("type") or "")).lower()
                if exclude_food and any(w in blob for w in FOOD_WORDS):
                    continue                      # food and drink are out of scope
                site = (r.get("website") or "").split("?")[0]
                h = urllib.parse.urlparse(site).netloc.lower().replace("www.", "")
                if not h or h in seen:
                    continue
                seen.add(h)
                rid = f"{label_prefix}-{city}-{slug}-{counter[0]:05d}"
                counter[0] += 1
                json.dump({
                    "record_id": rid, "audience": audience, "city": city,
                    "market": market, "state": state, "category": None,
                    "service_type": t.title(), "display_name": title,
                    "ig_handle": None, "website_url": site, "area": area,
                    "source": f"serpapi:google_local:{audience}",
                    "discovery_artifacts": [aid], "site_artifacts": [],
                }, open(os.path.join(CAND, rid + ".json"), "w", encoding="utf-8"), indent=2)
                new.append(rid)
            time.sleep(0.3)
    save_done(done)
    return new


def discover_round(city, k, seen, made_prefix, budget, max_searches=900):
    """One pass over areas x types. Returns new candidate ids."""
    new = []
    market, state = MARKET[city]
    done = load_done()
    fresh = 0
    for area in AREAS[city]:
        for t in SERVICE_TYPES:
            qkey = f"{city}|{area}|{t}"
            if qkey in done:
                continue                 # already searched in an earlier run
            if _stop.is_set() or len(new) >= budget:
                return new
            if _counts["searches"] >= max_searches or paid_exhausted("also-web"):
                log(f"  search cap reached — stopping discovery, "
                    f"no further paid calls")
                return new
            try:
                data = search_local(t, area, k)
            except Exception as e:
                log(f"  serpapi problem on '{t} {area}': {str(e)[:80]}")
                time.sleep(2)
                continue
            _counts["searches"] += 1
            done.add(qkey)
            fresh += 1
            if fresh % 25 == 0:
                save_done(done)          # checkpoint, so a kill never re-buys
            results = data.get("local_results") or []
            slug = re.sub(r"[^a-z]", "", t)[:12]
            aid = f"disc-{city}-{slug}-{re.sub(r'[^a-z]', '', area.lower())[:10]}"
            with open(os.path.join(RAW, f"{aid}.json"), "w", encoding="utf-8") as f:
                json.dump({"artifact_id": aid, "url": f"serpapi:{t} {area}",
                           "kind": "discovery",
                           "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                           "content": (data.get("_raw")
                                       or json.dumps(data, ensure_ascii=False))[:300_000]}, f)
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
    save_done(done)
    if fresh == 0:
        log(f"  [{city}] every query in the grid has been searched already — "
            f"no paid calls made. Widen SERVICE_TYPES or AREAS to find more.")
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
    ap.add_argument("--shard", type=int, default=0,
                    help="this shard's index (0-based). Shards split the AREA list "
                         "so N jobs crawl N disjoint slices with zero overlap.")
    ap.add_argument("--of", type=int, default=1, help="total number of shards")
    ap.add_argument("--sources", default="ig,realestate,localbiz",
                    help="comma list: ig, realestate, localbiz")
    ap.add_argument("--also-web", action="store_true",
                    help="additionally sweep Google Local for businesses that may "
                         "not surface on Instagram (lower IG yield, more contacts)")
    ap.add_argument("--city", "--cities", dest="cities", default="NYC,MIA")
    ap.add_argument("--max-searches", dest="max_searches", type=int, default=900,
                    help="HARD CAP on paid SerpApi calls, enforced at every call site. "
                         "0 disables all metered discovery. This is the spend gate — "
                         "an uncapped crawl is the Apify failure mode with a new logo.")
    args = ap.parse_args()

    MAX_SEARCHES[0] = args.max_searches
    if args.max_searches <= 0:
        args.sources = ",".join(x for x in args.sources.split(",")
                                if x.strip() not in ("ig", "realestate", "localbiz"))
        log("paid-search budget is 0 — every metered source disabled for this run")

    signal.signal(signal.SIGINT, lambda *_: (_stop.set(), log("\nstopping cleanly...")))
    deadline = time.time() + args.hours * 3600
    prov = provider()
    if prov is None and args.max_searches > 0:
        sys.exit("Neither SERPER_API_KEY nor SERPAPI_KEY is set — "
                 "no discovery provider available.")
    k = os.environ.get("SERPAPI_KEY", "")
    log(f"discovery provider: {prov or 'none (free sources only)'}")
    seen = known_domains()
    counter = [len(seen) + 1]

    log("=" * 62)
    log(f"OVERNIGHT RUN — target {args.target}, stopping after {args.hours}h, "
        f"paid-search cap {args.max_searches}")
    log(f"starting from {len(seen)} businesses already on disk")
    log("Ctrl-C is safe at any point; progress is never lost")
    log("=" * 62)

    # SHARDING. Each shard takes every Nth neighbourhood, so twenty parallel
    # jobs cover the same grid in a twentieth of the time and never fetch the
    # same business twice. Splitting by AREA (not by type) keeps each shard's
    # dedupe set meaningful — businesses cluster by neighbourhood, not by trade.
    if args.of > 1:
        for city in AREAS:
            AREAS[city] = AREAS[city][args.shard::args.of]
        log(f"shard {args.shard + 1} of {args.of}: "
            + ", ".join(f"{c}={len(v)} areas" for c, v in AREAS.items()))
        if not any(AREAS.values()):
            log("no areas in this shard — nothing to do")
            return

    cities = [c.strip() for c in args.cities.split(",")]
    rounds = 0
    while not _stop.is_set() and time.time() < deadline:
        rounds += 1
        for city in cities:
            if _stop.is_set() or time.time() > deadline:
                break

            new = []
            if "ig" in args.sources:
                log(f"\n[round {rounds}] {city} — finding Instagram service accounts")
                new = discover_ig(city, k, seen, counter, budget=1500)
                log(f"[round {rounds}] {city} — {len(new)} new businesses from "
                    f"Instagram-biased web search (own domains, fetchable)")

            if "realestate" in args.sources:
                tgt = CITY_TARGETS["realestate"][city]
                got = discover_places(city, k, seen, counter, "realestate",
                                      REALESTATE_TYPES, tgt, "re")
                log(f"[round {rounds}] {city} — {len(got)} real estate agents "
                    f"(target {tgt})")
                new += got

            if "localbiz" in args.sources:
                tgt = CITY_TARGETS["localbiz"][city]
                got = discover_places(city, k, seen, counter, "localbiz",
                                      LOCALBIZ_TYPES, tgt, "lb", exclude_food=True)
                log(f"[round {rounds}] {city} — {len(got)} local businesses "
                    f"(target {tgt}, food and drink excluded)")
                new += got

            if args.also_web:
                log(f"[round {rounds}] {city} — also sweeping Google Local")
                new += discover_round(city, k, seen, counter, budget=800,
                                      max_searches=args.max_searches)

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
    log(f"PAID SEARCHES USED THIS RUN: {_counts['searches']} of {MAX_SEARCHES[0]} allowed "
        f"({_counts['search_errors']} failed)")
    if PAID_DEAD[0]:
        log("PAID DISCOVERY WAS DISABLED MID-RUN — the key was refused. "
            "Free sources still ran and every candidate on disk was still fetched.")
    log(f"FINISHED — {_counts['fetched']} sites read, "
        f"{_counts['blocked']} skipped for robots.txt, "
        f"{_counts['unfetched']} could not be read at all")
    if _fetch_fail:
        log("WHY BUSINESSES WERE NEVER READ (this is the yield ceiling):")
        for why, n in sorted(_fetch_fail.items(), key=lambda kv: -kv[1]):
            log(f"    {n:>6}  {why}")
    log(f"spreadsheet: out/CERGIO_crawl_v2_audit_200.xlsx")
    log("=" * 62)


if __name__ == "__main__":
    main()
