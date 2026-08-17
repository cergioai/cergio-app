#!/usr/bin/env python3
"""
SOURCE BAKE-OFF — measure discovery providers head to head, on the same queries.

    python3 source_bakeoff.py

Runs an identical set of (business type x neighbourhood) queries against every
provider whose key is present in the environment, and reports what each one
actually delivered. Providers with no key are skipped, so you can add keys one
at a time and re-run.

WHY THIS EXISTS
  Vendor pricing pages quote dollars per 1,000 CALLS. That number is close to
  meaningless here. What matters is dollars per USABLE RECORD — a business with
  a real website, because a website is the only thing the fetch layer can prove
  contacts from. A provider at $0.30/1k that returns 4 usable rows per call
  beats one at $0.06/1k that returns none.

WHAT IT MEASURES
  calls          how many API calls were spent
  rows           raw results returned
  with_site      rows carrying a usable http(s) website  <-- the one that counts
  uniq_domains   distinct domains, after deduping within the run
  $/1k           the provider's list rate
  $ per usable   the honest unit cost

IT WRITES NOTHING INTO THE PIPELINE. No candidates, no artifacts, no records.
This is a measurement tool; it cannot contaminate a crawl or fabricate a field.
Sample rows are printed so you can eyeball quality, not just counts.
"""
import json, os, sys, time, urllib.parse, urllib.request, base64

UA = "cergio-bakeoff/1.0 (+https://cergio.ai)"

# The same probe set for every provider. Deliberately mixes a dense urban
# category with a sparse one, and NYC with Miami, so a provider cannot look
# good by being strong in only one niche.
PROBES = [
    ("hair salon",        "Park Slope Brooklyn NY"),
    ("dog groomer",       "Astoria Queens NY"),
    ("physical therapy",  "Upper East Side New York NY"),
    ("dry cleaner",       "Brickell Miami FL"),
    ("pet store",         "Coral Gables FL"),
]

# List rates, US dollars per 1,000 calls. Update if a vendor changes terms.
RATES = {
    "serpapi":    25.00,   # Starter 1,000/mo — the current, exhausted account
    "serper":      0.30,   # from $0.30/1k, 2,500 free on signup
    "dataforseo":  0.60,
    "overpass":    0.00,   # OpenStreetMap, free and keyless
}


def get(url, headers=None, data=None, timeout=60):
    req = urllib.request.Request(url, data=data,
                                 headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def clean_site(u):
    u = (u or "").split("?")[0].strip()
    if not u.startswith("http"):
        return ""
    host = urllib.parse.urlparse(u).netloc.lower().replace("www.", "")
    # A link to the aggregator itself is not the business's own site.
    if any(b in host for b in ("google.", "facebook.", "instagram.", "yelp.",
                               "tripadvisor.", "booksy.", "vagaro.", "linktr.ee")):
        return ""
    return u


# ------------------------------------------------------------- providers ---
def p_serpapi(t, area, key):
    q = {"engine": "google_local", "q": f"{t} {area}", "location": area,
         "api_key": key, "num": 20}
    d = json.loads(get("https://serpapi.com/search.json?" + urllib.parse.urlencode(q)))
    return [{"name": r.get("title"), "site": r.get("website"),
             "phone": r.get("phone")} for r in (d.get("local_results") or [])]


def p_serper(t, area, key):
    d = json.loads(get("https://google.serper.dev/places",
                       headers={"X-API-KEY": key, "Content-Type": "application/json"},
                       data=json.dumps({"q": f"{t} {area}", "num": 20}).encode()))
    return [{"name": r.get("title"), "site": r.get("website"),
             "phone": r.get("phoneNumber")} for r in (d.get("places") or [])]


def p_dataforseo(t, area, cred):
    body = json.dumps([{"keyword": f"{t} {area}", "location_name": "United States",
                        "language_code": "en", "depth": 20}]).encode()
    auth = base64.b64encode(cred.encode()).decode()
    d = json.loads(get(
        "https://api.dataforseo.com/v3/serp/google/maps/live/advanced",
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
        data=body))
    out = []
    for task in (d.get("tasks") or []):
        for res in (task.get("result") or []):
            for r in (res.get("items") or []):
                out.append({"name": r.get("title"), "site": r.get("url"),
                            "phone": r.get("phone")})
    return out


OSM_TAG = {"hair salon": '["shop"="hairdresser"]', "dog groomer": '["shop"="pet_grooming"]',
           "physical therapy": '["healthcare"="physiotherapist"]',
           "dry cleaner": '["shop"="dry_cleaning"]', "pet store": '["shop"="pet"]'}
OSM_AREA = {"Park Slope Brooklyn NY": "Brooklyn", "Astoria Queens NY": "Queens",
            "Upper East Side New York NY": "Manhattan",
            "Brickell Miami FL": "Miami", "Coral Gables FL": "Coral Gables"}


def p_overpass(t, area, _key):
    q = (f'[out:json][timeout:90];area["name"="{OSM_AREA[area]}"]'
         f'["boundary"="administrative"]->.a;'
         f'nwr(area.a){OSM_TAG[t]}["website"];out center tags 200;')
    d = json.loads(get("https://overpass-api.de/api/interpreter",
                       data=urllib.parse.urlencode({"data": q}).encode(), timeout=120))
    return [{"name": (e.get("tags") or {}).get("name"),
             "site": (e.get("tags") or {}).get("website"),
             "phone": (e.get("tags") or {}).get("phone")}
            for e in d.get("elements", [])]


PROVIDERS = [
    ("overpass",   None,                    p_overpass),     # free, no key
    ("serpapi",    "SERPAPI_KEY",           p_serpapi),
    ("serper",     "SERPER_API_KEY",        p_serper),
    ("dataforseo", "DATAFORSEO_CREDENTIALS", p_dataforseo),  # "login:password"
]


def main():
    results, samples = {}, {}
    for name, envvar, fn in PROVIDERS:
        key = os.environ.get(envvar) if envvar else "-"
        if envvar and not key:
            print(f"SKIP {name}: {envvar} not set")
            continue
        calls = rows = sited = 0
        domains, seen_samples = set(), []
        errs = []
        for t, area in PROBES:
            try:
                out = fn(t, area, key)
            except Exception as e:
                errs.append(f"{t}@{area}: {str(e)[:70]}")
                calls += 1
                continue
            calls += 1
            rows += len(out)
            for r in out:
                s = clean_site(r.get("site"))
                if not s:
                    continue
                sited += 1
                domains.add(urllib.parse.urlparse(s).netloc.lower().replace("www.", ""))
                if len(seen_samples) < 4:
                    seen_samples.append((r.get("name") or "?", s))
            time.sleep(1.2)
        rate = RATES.get(name, 0.0)
        per_usable = (rate / 1000 * calls / len(domains)) if domains else None
        results[name] = dict(calls=calls, rows=rows, sited=sited,
                             uniq=len(domains), rate=rate,
                             per_usable=per_usable, errs=errs)
        samples[name] = seen_samples
        print(f"{name}: {calls} calls, {rows} rows, {sited} with site, "
              f"{len(domains)} unique domains")
        for e in errs[:3]:
            print(f"   ! {e}")

    if not results:
        sys.exit("No provider ran. Set at least one key.")

    lines = ["", "| provider | calls | rows | with site | uniq domains | $/1k | $ per usable |",
             "|---|---:|---:|---:|---:|---:|---:|"]
    for n, r in sorted(results.items(),
                       key=lambda kv: (kv[1]["per_usable"] is None,
                                       kv[1]["per_usable"] or 0)):
        pu = "free" if r["rate"] == 0 else (
            f"${r['per_usable']:.5f}" if r["per_usable"] else "n/a")
        lines.append(f"| {n} | {r['calls']} | {r['rows']} | {r['sited']} | "
                     f"{r['uniq']} | ${r['rate']:.2f} | {pu} |")
    lines += ["", "Sample rows (name -> website), to judge quality not just count:"]
    for n, s in samples.items():
        for nm, st in s:
            lines.append(f"- **{n}** · {nm[:40]} -> {st[:60]}")
    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        open(summary, "a", encoding="utf-8").write(report + "\n")
    json.dump(results, open("bakeoff.json", "w"), indent=2)


if __name__ == "__main__":
    main()
