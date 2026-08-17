#!/usr/bin/env python3
"""
OSM DISCOVERY — find local businesses for £0, with no API key and no quota.

    python3 osm_discover.py --cities NYC,MIA --shard 0 --of 4 --max-queries 200

WHY THIS EXISTS
  Discovery was the only metered step in the pipeline. Fetching websites and
  extracting fields are already free and run on the GitHub runner. When the
  SerpApi key ran dry the WHOLE crawler stopped, because one paid dependency
  sat in front of everything else. 5,045 consecutive HTTP 429s, zero records.

  OpenStreetMap's Overpass API is free, keyless, unmetered and open-licensed
  (ODbL). CERGIO-CRAWL-LISTS.md already says it: "osm first — free."

WHAT IT DOES AND DOES NOT DO
  It writes exactly what SerpApi discovery wrote — a raw/ artifact holding the
  verbatim API response, and candidates/ entries carrying record_id, city,
  service_type, display_name and website_url. Nothing else changes: overnight.py
  still fetches those sites, extract.py still proves every field against stored
  bytes, qa.py still gates.

  THE SEPARATION HOLDS. OSM tags often contain phone and email. This script
  deliberately does NOT copy them into a candidate as field values — that would
  make a fetcher decide a value, which is the exact 2026-08 fabrication bug.
  The raw response is stored, and extract.py derives contacts from the fetched
  site with the substring proof, same as every other source.

COVERAGE, HONESTLY
  OSM is strong on bricks-and-mortar (shops, clinics, gyms, salons, studios) —
  the `localbiz` audience. It is weak on Instagram-first creators and on
  home-based service providers with no premises, because those have no map
  presence. Those still need paid search. This removes roughly the localbiz
  half of the grid from the paid path, permanently.
"""
import argparse, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW, CAND = os.path.join(ROOT, "raw"), os.path.join(ROOT, "candidates")
for d in (RAW, CAND):
    os.makedirs(d, exist_ok=True)
DONE_Q = os.path.join(CAND, "_searched.json")

# Public Overpass instances. Tried in order; a busy one returns 429 and we
# move on rather than hammering it. No key, no account, no bill.
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]
UA = "cergio-crawl/1.0 (+https://cergio.ai; contact t@cergio.ai)"

# OSM areas. Names must match an administrative boundary or place in OSM.
AREAS = {
    "NYC": ["Manhattan", "Brooklyn", "Queens", "The Bronx", "Staten Island",
            "Jersey City", "Hoboken"],
    "MIA": ["Miami", "Miami Beach", "Coral Gables", "Hialeah",
            "Fort Lauderdale", "Hollywood"],
}
MARKET = {"NYC": ("New York", "NY"), "MIA": ("Miami-Ft. Lauderdale", "FL")}

# (label, OSM selector). Every selector requires a website tag, because a
# business with no site gives the fetch layer nothing to prove contacts from.
# BLOCKED verticals from CERGIO-CRAWL-LISTS.md are absent by construction:
# no massage, tattoo, makeup, personal chef, alcohol, tobacco, gambling,
# firearms, adult or nightclub selectors appear here.
TYPES = [
    ("Hair Salon",            '["shop"="hairdresser"]'),
    ("Barber Shop",           '["shop"="hairdresser"]["hairdresser"="barber"]'),
    ("Nail Salon",            '["shop"="beauty"]["beauty"="nails"]'),
    ("Dry Cleaner",           '["shop"="dry_cleaning"]'),
    ("Laundromat",            '["shop"="laundry"]'),
    ("Tailor",                '["craft"="tailor"]'),
    ("Shoe Repair",           '["craft"="shoemaker"]'),
    ("Pet Store",             '["shop"="pet"]'),
    ("Pet Groomer",           '["shop"="pet_grooming"]'),
    ("Veterinary Clinic",     '["amenity"="veterinary"]'),
    ("Gym",                   '["leisure"="fitness_centre"]'),
    ("Dance Studio",          '["leisure"="dance"]'),
    ("Music School",          '["amenity"="music_school"]'),
    ("Driving School",        '["amenity"="driving_school"]'),
    ("Language School",       '["amenity"="language_school"]'),
    ("Tutoring Center",       '["amenity"="prep_school"]'),
    ("Daycare Center",        '["amenity"="childcare"]'),
    ("Preschool",             '["amenity"="kindergarten"]'),
    ("Dentist",               '["amenity"="dentist"]'),
    ("Optician",              '["shop"="optician"]'),
    ("Pharmacy",              '["amenity"="pharmacy"]'),
    ("Physical Therapy",      '["healthcare"="physiotherapist"]'),
    ("Chiropractor",          '["healthcare"="chiropractor"]'),
    ("Hardware Store",        '["shop"="hardware"]'),
    ("Doityourself Store",    '["shop"="doityourself"]'),
    ("Florist",               '["shop"="florist"]'),
    ("Bookstore",             '["shop"="books"]'),
    ("Toy Store",             '["shop"="toys"]'),
    ("Gift Shop",             '["shop"="gift"]'),
    ("Jewelry Store",         '["shop"="jewelry"]'),
    ("Watch Repair",          '["shop"="watches"]'),
    ("Bike Shop",             '["shop"="bicycle"]'),
    ("Phone Repair Shop",     '["shop"="mobile_phone"]'),
    ("Computer Repair Shop",  '["shop"="computer"]'),
    ("Furniture Store",       '["shop"="furniture"]'),
    ("Flooring Store",        '["shop"="flooring"]'),
    ("Paint Store",           '["shop"="paint"]'),
    ("Garden Center",         '["shop"="garden_centre"]'),
    ("Auto Repair Shop",      '["shop"="car_repair"]'),
    ("Tire Shop",             '["shop"="tyres"]'),
    ("Car Wash",              '["amenity"="car_wash"]'),
    ("Photography Studio",    '["craft"="photographer"]'),
    ("Print Shop",            '["shop"="copyshop"]'),
    ("Framing Shop",          '["shop"="frame"]'),
    ("Storage Facility",      '["shop"="storage_rental"]'),
    ("Travel Agency",         '["shop"="travel_agency"]'),
    ("Insurance Agency",      '["office"="insurance"]'),
    ("Tax Office",            '["office"="tax_advisor"]'),
    ("Notary Office",         '["office"="notary"]'),
    ("Real Estate Brokerage", '["office"="estate_agent"]'),
    ("Locksmith Shop",        '["craft"="locksmith"]'),
    ("Electrician",           '["craft"="electrician"]'),
    ("Plumber",               '["craft"="plumber"]'),
    ("Handyman",              '["craft"="handyman"]'),
    ("Painter",               '["craft"="painter"]'),
    ("Carpenter",             '["craft"="carpenter"]'),
]

# Food and drink are out of scope — a different buyer, different economics,
# and they would swamp every other category by sheer count.
FOOD = ("restaurant", "bar", "cafe", "coffee", "pizzeria", "bakery", "brewery",
        "deli", "diner", "bistro", "pub", "tavern", "grill", "sushi", "juice",
        "ice cream", "kitchen", "wine", "liquor", "cocktail")


def log(m):
    print(f"{time.strftime('%H:%M:%S')}  {m}", flush=True)


def load_done():
    try:
        return set(json.load(open(DONE_Q, encoding="utf-8")))
    except Exception:
        return set()


def save_done(d):
    json.dump(sorted(d), open(DONE_Q, "w", encoding="utf-8"))


def overpass(query, tries=None):
    """One free Overpass call. Rotates endpoints; never retries forever."""
    last = None
    for url in (tries or ENDPOINTS):
        try:
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": query}).encode(),
                headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:
            last = e
            log(f"  {urllib.parse.urlparse(url).netloc} unavailable: {str(e)[:60]}")
            time.sleep(3)
    raise RuntimeError(f"every Overpass endpoint failed: {last}")


def known_domains():
    d = set()
    for fn in os.listdir(CAND):
        if fn.startswith("_"):
            continue
        try:
            u = json.load(open(os.path.join(CAND, fn), encoding="utf-8")).get("website_url") or ""
            h = urllib.parse.urlparse(u).netloc.lower().replace("www.", "")
            if h:
                d.add(h)
        except Exception:
            pass
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities", default="NYC,MIA")
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--of", type=int, default=1)
    ap.add_argument("--max-queries", dest="max_queries", type=int, default=400,
                    help="hard cap on Overpass calls. Free, but still bounded — "
                         "an unbounded loop is bad manners on a donated service.")
    args = ap.parse_args()

    areas = dict(AREAS)
    if args.of > 1:
        for c in areas:
            areas[c] = areas[c][args.shard::args.of]
        log(f"shard {args.shard + 1} of {args.of}: "
            + ", ".join(f"{c}={len(v)}" for c, v in areas.items()))

    seen = known_domains()
    done = load_done()
    counter = [len(seen) + 1]
    made = queries = 0
    log(f"starting from {len(seen)} known domains — cost of this run: $0.00")

    for city in [c.strip() for c in args.cities.split(",")]:
        market, state = MARKET[city]
        for area in areas.get(city, []):
            for label, sel in TYPES:
                if queries >= args.max_queries:
                    log(f"query cap {args.max_queries} reached — stopping")
                    save_done(done)
                    log(f"DONE — {made} candidates written, {queries} free queries")
                    return
                qkey = f"OSM|{city}|{area}|{label}"
                if qkey in done:
                    continue
                q = (f'[out:json][timeout:90];'
                     f'area["name"="{area}"]["boundary"="administrative"]->.a;'
                     f'nwr(area.a){sel}["website"];'
                     f'out center tags 200;')
                try:
                    body = overpass(q)
                    data = json.loads(body)
                except Exception as e:
                    log(f"  {label} @ {area}: {str(e)[:70]}")
                    continue
                queries += 1
                done.add(qkey)
                if queries % 20 == 0:
                    save_done(done)

                slug = re.sub(r"[^a-z]", "", label.lower())[:12]
                aid = f"osmdisc-{city}-{slug}-{re.sub(r'[^a-z]', '', area.lower())[:10]}"
                # The verbatim response is stored. Provenance for anything the
                # extractor later derives lives here, not in this script.
                json.dump({"artifact_id": aid,
                           "url": f"overpass:{sel} in {area}",
                           "kind": "discovery",
                           "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                           "content": body[:300_000]},
                          open(os.path.join(RAW, aid + ".json"), "w", encoding="utf-8"))

                n = 0
                for el in data.get("elements", []):
                    tags = el.get("tags") or {}
                    name = (tags.get("name") or "").strip()
                    site = (tags.get("website") or tags.get("contact:website") or "").split("?")[0]
                    if not name or not site.startswith("http"):
                        continue
                    if any(w in (name + " " + str(tags.get("cuisine", ""))).lower() for w in FOOD):
                        continue
                    host = urllib.parse.urlparse(site).netloc.lower().replace("www.", "")
                    if not host or host in seen:
                        continue
                    seen.add(host)
                    rid = f"osm-{city}-{slug}-{counter[0]:05d}"
                    counter[0] += 1
                    # website_url is DISCOVERY metadata, exactly as the SerpApi
                    # path treats it. Phone and email are deliberately NOT copied
                    # from OSM tags — extract.py proves those from the fetched page.
                    json.dump({
                        "record_id": rid, "audience": "localbiz", "city": city,
                        "market": market, "state": state, "category": None,
                        "service_type": label, "display_name": name[:120],
                        "ig_handle": None, "website_url": site, "area": area,
                        "source": "openstreetmap:overpass",
                        "discovery_artifacts": [aid], "site_artifacts": [],
                    }, open(os.path.join(CAND, rid + ".json"), "w", encoding="utf-8"), indent=2)
                    n += 1
                    made += 1
                log(f"  {label:22} @ {area:16} {n:4} new  (total {made})")
                time.sleep(1.5)          # courteous to a free, donated service

    save_done(done)
    log(f"DONE — {made} candidates written from {queries} free queries. Cost: $0.00")


if __name__ == "__main__":
    main()
