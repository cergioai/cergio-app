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
    # WHY THESE. Every name here must resolve to an OSM administrative
    # boundary, and every business found inside it must be able to PROVE its
    # city from its own page -- extract.py accepts ", NY" and ", FL" as proof,
    # so staying inside those two states keeps the geo gate satisfiable. New
    # Jersey is deliberately limited to the three towns extract.py already
    # names; adding Bayonne or Weehawken would discover businesses that could
    # never pass the geo gate, which reads as "no contact" and wastes fetches.
    #
    # The old grid was 13 areas x 56 types = 728 possible queries, and it ran
    # dry at 405 businesses. This grid is roughly eight times larger.
    "NYC": [
        # five boroughs
        "Manhattan", "Brooklyn", "Queens", "The Bronx", "Staten Island",
        # northern New Jersey, only where extract.py can prove the city
        "Jersey City", "Hoboken", "Newark",
        # Westchester
        "Yonkers", "New Rochelle", "Mount Vernon", "White Plains", "Scarsdale",
        "Rye", "Port Chester", "Mamaroneck", "Harrison", "Tarrytown",
        "Ossining", "Peekskill", "Eastchester", "Greenburgh",
        # Nassau
        "Hempstead", "Long Beach", "Freeport", "Valley Stream", "Garden City",
        "Mineola", "Great Neck", "Glen Cove", "Rockville Centre", "Oceanside",
        "Levittown", "Baldwin", "Massapequa", "Westbury", "Lynbrook",
        # Suffolk
        "Huntington", "Babylon", "Islip", "Smithtown", "Riverhead",
        "Patchogue", "Bay Shore",
        # Rockland
        "New City", "Nyack", "Spring Valley", "Suffern",
    ],
    "MIA": [
        # Miami-Dade
        "Miami", "Miami Beach", "Coral Gables", "Hialeah", "Doral",
        "Aventura", "North Miami", "North Miami Beach", "Homestead",
        "Pinecrest", "Key Biscayne", "Sunny Isles Beach", "Miami Gardens",
        "Cutler Bay", "Palmetto Bay", "South Miami", "Sweetwater",
        "Miami Lakes", "Hialeah Gardens", "Miami Springs", "Opa-locka",
        "Coral Terrace", "Kendall", "Westchester", "Richmond West",
        # Broward
        "Fort Lauderdale", "Hollywood", "Pembroke Pines", "Miramar",
        "Coral Springs", "Pompano Beach", "Plantation", "Sunrise", "Davie",
        "Weston", "Deerfield Beach", "Tamarac", "Lauderhill", "Margate",
        "Coconut Creek", "Oakland Park", "Wilton Manors", "Dania Beach",
        "Hallandale Beach", "Cooper City",
    ],
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

    # ---- added 2026-08-25: the original 56 selectors ran the grid dry at
    # 405 businesses. These are all bricks-and-mortar or small-practice
    # categories. Blocked verticals stay absent by construction: no massage,
    # tattoo, makeup, cannabis, vape, gambling, firearms, adult or nightlife
    # selector appears here, and shop=beauty explicitly excludes massage and
    # tattoo rather than relying on a downstream text filter.
    ("Beauty Salon",          '["shop"="beauty"]["beauty"!="massage"]["beauty"!="tattoo"]'),
    ("Cosmetics Store",       '["shop"="cosmetics"]'),
    ("Perfumery",             '["shop"="perfumery"]'),
    ("Clothing Store",        '["shop"="clothes"]'),
    ("Shoe Store",            '["shop"="shoes"]'),
    ("Bag Store",             '["shop"="bag"]'),
    ("Bridal Shop",           '["shop"="bridal"]'),
    ("Baby Goods",            '["shop"="baby_goods"]'),
    ("Second Hand Store",     '["shop"="second_hand"]'),
    ("Antiques Dealer",       '["shop"="antiques"]'),
    ("Interior Decoration",   '["shop"="interior_decoration"]'),
    ("Bed Store",             '["shop"="bed"]'),
    ("Lighting Store",        '["shop"="lighting"]'),
    ("Electronics Store",     '["shop"="electronics"]'),
    ("Hifi Store",            '["shop"="hifi"]'),
    ("Video Game Store",      '["shop"="video_games"]'),
    ("Hobby Game Store",      '["shop"="games"]'),
    ("Model Shop",            '["shop"="model"]'),
    ("Party Supplies",        '["shop"="party"]'),
    ("Craft Store",           '["shop"="craft"]'),
    ("Fabric Store",          '["shop"="fabric"]'),
    ("Stationery Store",      '["shop"="stationery"]'),
    ("Art Shop",              '["shop"="art"]'),
    ("Musical Instruments",   '["shop"="musical_instrument"]'),
    ("Sports Store",          '["shop"="sports"]'),
    ("Outdoor Store",         '["shop"="outdoor"]'),
    ("Photo Shop",            '["shop"="photo"]'),
    ("Car Dealer",            '["shop"="car"]'),
    ("Car Parts Store",       '["shop"="car_parts"]'),
    ("Motorcycle Shop",       '["shop"="motorcycle"]'),
    ("Boat Dealer",           '["shop"="boat"]'),
    ("Equipment Rental",      '["shop"="rental"]'),
    ("Funeral Director",      '["shop"="funeral_directors"]'),
    ("Car Rental",            '["amenity"="car_rental"]'),
    ("Coworking Space",       '["amenity"="coworking_space"]'),
    ("Events Venue",          '["amenity"="events_venue"]'),
    ("Animal Boarding",       '["amenity"="animal_boarding"]'),
    ("Dog Training",          '["amenity"="animal_training"]'),
    ("Doctors Office",        '["amenity"="doctors"]'),
    ("Medical Clinic",        '["amenity"="clinic"]'),
    ("Optometrist",           '["healthcare"="optometrist"]'),
    ("Podiatrist",            '["healthcare"="podiatrist"]'),
    ("Psychotherapist",       '["healthcare"="psychotherapist"]'),
    ("Speech Therapist",      '["healthcare"="speech_therapist"]'),
    ("Occupational Therapy",  '["healthcare"="occupational_therapist"]'),
    ("Nutrition Counselling", '["healthcare"="nutrition_counselling"]'),
    ("Midwife",               '["healthcare"="midwife"]'),
    ("Accountant",            '["office"="accountant"]'),
    ("Lawyer",                '["office"="lawyer"]'),
    ("Architect",             '["office"="architect"]'),
    ("Advertising Agency",    '["office"="advertising_agency"]'),
    ("Financial Advisor",     '["office"="financial_advisor"]'),
    ("Employment Agency",     '["office"="employment_agency"]'),
    ("Property Management",   '["office"="property_management"]'),
    ("Moving Company",        '["office"="moving_company"]'),
    ("IT Services",           '["office"="it"]'),
    ("Yoga Studio",           '["sport"="yoga"]["website"]'),
    ("Martial Arts School",   '["sport"="martial_arts"]'),
    ("Boxing Gym",            '["sport"="boxing"]'),
    ("Climbing Gym",          '["leisure"="sports_centre"]["sport"="climbing"]'),
    ("Sports Centre",         '["leisure"="sports_centre"]'),
    ("Roofer",                '["craft"="roofer"]'),
    ("HVAC Contractor",       '["craft"="hvac"]'),
    ("Gardener",              '["craft"="gardener"]'),
    ("Cleaning Service",      '["craft"="cleaning"]'),
    ("Window Fitter",         '["craft"="window_construction"]'),
    ("Metal Fabricator",      '["craft"="metal_construction"]'),
    ("Upholsterer",           '["craft"="upholsterer"]'),
    ("Jeweller",              '["craft"="jeweller"]'),
    ("Sign Maker",            '["craft"="signmaker"]'),
    ("Dressmaker",            '["craft"="dressmaker"]'),
    ("Blacksmith",            '["craft"="blacksmith"]'),
    ("Glazier",               '["craft"="glaziery"]'),
    ("Stonemason",            '["craft"="stonemason"]'),
    ("Pest Control",          '["craft"="pest_control"]'),
    ("Piano Tuner",           '["craft"="piano_tuner"]'),
    ("Insulation Contractor", '["craft"="insulation"]'),
    ("Floorer",               '["craft"="floorer"]'),
    ("Plasterer",             '["craft"="plasterer"]'),
    ("Tiler",                 '["craft"="tiler"]'),
    ("Scaffolder",            '["craft"="scaffolder"]'),
]

# Food and drink are out of scope — a different buyer, different economics,
# and they would swamp every other category by sheer count.
#
# THIS USED TO BE A SUBSTRING TEST, and it quietly deleted good businesses:
# "bar" matched every Barber, Barbara and Barclay; "pub" matched Public and
# Republic; "deli" matched Delia. Whole words only, exactly the lesson already
# learned in extract.py when "adult" quarantined martial-arts gyms for
# offering adult classes. "kitchen" and "grill" are gone entirely — a kitchen
# showroom and a grill-repair shop are both real targets.
FOOD_WORDS = ("restaurant", "restaurants", "bar", "bars", "cafe", "cafes",
              "coffee", "pizzeria", "pizza", "bakery", "brewery", "deli",
              "diner", "bistro", "pub", "tavern", "sushi", "juice",
              "wine", "winery", "liquor", "cocktail", "cocktails", "taqueria",
              "eatery", "catering", "caterer")
FOOD_RE = re.compile(r"\b(?:" + "|".join(FOOD_WORDS) + r")\b", re.I)


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


_AREA_OK = {}


def area_exists(area):
    """True if this name resolves to an OSM administrative boundary."""
    if area in _AREA_OK:
        return _AREA_OK[area]
    q = (f'[out:json][timeout:25];'
         f'rel["name"="{area}"]["boundary"="administrative"];out ids 1;')
    try:
        ok = bool(json.loads(overpass(q)).get("elements"))
    except Exception as e:
        log(f"  area probe for '{area}' failed ({str(e)[:50]}) — assuming it exists")
        ok = True                     # never let a flaky probe delete the grid
    _AREA_OK[area] = ok
    time.sleep(1.0)
    return ok


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

    per_area = {}
    dead_areas = []

    for city in [c.strip() for c in args.cities.split(",")]:
        market, state = MARKET[city]
        for area in areas.get(city, []):
            # ONE cheap probe before spending a hundred queries on this area.
            # An area name that does not resolve to an OSM boundary returns an
            # empty element list for EVERY type -- no error, no warning, and
            # each of those empty queries gets marked done forever. That is how
            # a typo silently eats an eighth of the grid. Now it says so.
            if not area_exists(area):
                log(f"  !! area '{area}' does not resolve to an OSM boundary — skipped")
                dead_areas.append(area)
                continue
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
                    if FOOD_RE.search(name + " " + str(tags.get("cuisine", ""))):
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
                per_area[area] = per_area.get(area, 0) + n
                log(f"  {label:22} @ {area:16} {n:4} new  (total {made})")
                time.sleep(1.5)          # courteous to a free, donated service

    save_done(done)
    if dead_areas:
        log(f"AREAS THAT DO NOT EXIST IN OSM ({len(dead_areas)}): "
            + ", ".join(dead_areas))
    empty = [a for a, n in per_area.items() if n == 0]
    if empty:
        log(f"areas that resolved but yielded nothing this run: {', '.join(empty)}")
    log(f"DONE — {made} candidates written from {queries} free queries. Cost: $0.00")


if __name__ == "__main__":
    main()
