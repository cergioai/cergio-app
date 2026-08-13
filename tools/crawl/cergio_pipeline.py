#!/usr/bin/env python3
"""
CERGIO PIPELINE — one command, start to finished spreadsheet. No round trips.

    pip install openpyxl                      # the only dependency
    export BRIGHTDATA_API_KEY=...             # followers
    export SERPAPI_KEY=...                    # discovery + google_lsa

    python3 cergio_pipeline.py followers      # fill follower counts on existing rows
    python3 cergio_pipeline.py discover --source lsa   --city NYC --limit 500
    python3 cergio_pipeline.py discover --source local --city MIA --limit 200
    python3 cergio_pipeline.py build          # extract + QA + spreadsheet
    python3 cergio_pipeline.py all            # everything, in order

Run it on your laptop or in CI. It only ever reads keys from the environment.

WHY IT IS SPLIT THIS WAY
------------------------
Every subcommand except `build` is a FETCH step: it writes raw responses to
raw/ and emits no field values. `build` is the EXTRACT step: it reads only
stored files and never touches the network. That separation is the thing that
makes the 2026-08 fabricated-data failure impossible, so keep it — if you ever
find yourself writing a lead value inside a fetch function, that is the bug
coming back.

Rate: discovery is capped and resumable. Re-running skips work already on disk,
so an interrupted run costs nothing.
"""

import json, os, sys, time, argparse, subprocess, urllib.request, urllib.error, urllib.parse, re

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW, CAND, OUT = (os.path.join(ROOT, d) for d in ("raw", "candidates", "out"))
for d in (RAW, CAND, OUT):
    os.makedirs(d, exist_ok=True)

BD_TRIGGER = "https://api.brightdata.com/datasets/v3/trigger"
BD_SNAPSHOT = "https://api.brightdata.com/datasets/v3/snapshot"
BD_DATASET = "gd_l1vikfch901nx3by4"
SERP = "https://serpapi.com/search.json"


def key(name):
    v = os.environ.get(name)
    if not v:
        sys.exit(f"\n{name} is not set.\n    export {name}='...'\n"
                 f"Never commit it and never paste it into a chat.\n")
    return v


def http(url, headers=None, data=None, timeout=180):
    r = urllib.request.Request(
        url, data=json.dumps(data).encode() if data is not None else None,
        method="POST" if data is not None else "GET",
        headers={**({"Content-Type": "application/json"} if data is not None else {}),
                 **(headers or {})})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return resp.read().decode()


def put_artifact(aid, url, body, kind="site"):
    with open(os.path.join(RAW, f"{aid}.json"), "w", encoding="utf-8") as f:
        json.dump({"artifact_id": aid, "url": url, "kind": kind,
                   "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "content": body}, f)
    return aid


def load_candidate(rid):
    p = os.path.join(CAND, f"{rid}.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


def save_candidate(c):
    json.dump(c, open(os.path.join(CAND, f"{c['record_id']}.json"), "w",
                      encoding="utf-8"), indent=2)


# ---------------------------------------------------------------- FOLLOWERS --
def cmd_followers(a):
    """Bright Data -> raw IG profile artifacts. Writes no field values."""
    # Enrich CANDIDATES, not finished records. An IG-first candidate has no
    # website, so its only possible contact is the Instagram bio — it can never
    # pass the gates until after this runs. Reading records.json here was a
    # chicken-and-egg that would have returned "nothing to enrich" forever.
    todo = []
    for fn in sorted(os.listdir(CAND)):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        try:
            c = json.load(open(os.path.join(CAND, fn), encoding="utf-8"))
        except Exception:
            continue
        if c.get("ig_handle") and not c.get("ig_artifacts"):
            todo.append((c["record_id"], c["ig_handle"]))
    if a.limit:
        todo = todo[:a.limit]
    if not todo:
        print("nothing to enrich — every handle already has a follower count")
        return
    print(f"{len(todo)} handles need follower counts")

    hdr = {"Authorization": f"Bearer {key('BRIGHTDATA_API_KEY')}"}
    payload = [{"url": f"https://www.instagram.com/{h}/"} for _, h in todo]
    try:
        resp = json.loads(http(f"{BD_TRIGGER}?dataset_id={BD_DATASET}&include_errors=true",
                               hdr, payload))
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:300]}\n"
                 f"A 401/403 means the value is not the API token. The token is under "
                 f"Account settings -> API tokens.")
    sid = resp.get("snapshot_id") or sys.exit(f"no snapshot_id: {resp}")
    print(f"snapshot {sid} — polling (1-4 min typical)")
    for i in range(90):
        time.sleep(10)
        body = http(f"{BD_SNAPSHOT}/{sid}?format=json", hdr)
        if body.lstrip()[:1] == "{" and '"status"' in body[:200]:
            print(f"  ...running ({(i + 1) * 10}s)")
            continue
        by_handle = {}
        for it in json.loads(body):
            h = str(it.get("account") or it.get("username") or "").lower().lstrip("@")
            if h:
                by_handle[h] = it
        n = 0
        for rid, handle in todo:
            it = by_handle.get(handle.lower())
            if not it:
                continue
            aid = put_artifact(f"{rid}__ig1", f"https://www.instagram.com/{handle}/",
                               json.dumps(it, ensure_ascii=False), "ig_profile")
            c = load_candidate(rid)
            if c:
                c.setdefault("ig_artifacts", [])
                if aid not in c["ig_artifacts"]:
                    c["ig_artifacts"].append(aid)
                save_candidate(c)
            n += 1
        print(f"stored {n} profile artifacts ({len(todo) - n} handles returned nothing)")
        return
    print("snapshot never completed — nothing written, counts stay NULL")


# ---------------------------------------------------------------- DISCOVERY --
LSA_TYPES = ["house cleaning", "plumber", "electrician", "hvac", "locksmith",
             "pest control", "handyman", "landscaping", "junk removal",
             "carpet cleaning", "window cleaning", "pressure washing",
             "appliance repair", "garage door repair", "roofing", "moving"]
LOCAL_TYPES = ["dog walker", "dog groomer", "personal trainer", "nail salon",
               "esthetician", "house cleaning", "swim instructor", "tutor",
               "martial arts", "pet sitter", "doggy daycare", "home organizer"]
CITY_Q = {"NYC": ("New York, NY", "NY", "New York"),
          "MIA": ("Miami, FL", "FL", "Miami-Ft. Lauderdale")}


def serp(params):
    return json.loads(http(f"{SERP}?{urllib.parse.urlencode(params)}"))


def cmd_discover(a):
    """SerpApi -> candidates + raw artifacts. Writes no contact values."""
    k = key("SERPAPI_KEY")
    where, state, market = CITY_Q[a.city]
    types = LSA_TYPES if a.source == "lsa" else LOCAL_TYPES
    made, seen_domains = 0, set()
    for c in os.listdir(CAND):                       # resume: never re-add a domain
        try:
            seen_domains.add((json.load(open(os.path.join(CAND, c), encoding="utf-8"))
                              .get("website_url") or "").lower())
        except Exception:
            pass

    for t in types:
        if made >= a.limit:
            break
        slug = re.sub(r"[^a-z]", "", t)[:14]
        try:
            data = serp({"engine": "google_local", "q": f"{t} {where}",
                         "location": where, "api_key": k, "num": 20})
        except urllib.error.HTTPError as e:
            print(f"  serpapi HTTP {e.code} on '{t}' — skipping")
            continue
        results = data.get("local_results") or []
        aid = put_artifact(f"disc-{a.city}-{slug}", f"serpapi:google_local:{t} {where}",
                           json.dumps(data, ensure_ascii=False)[:400000], "discovery")
        for i, r in enumerate(results, 1):
            if made >= a.limit:
                break
            site = (r.get("website") or "").split("?")[0]
            if not site or site.lower() in seen_domains:
                continue
            seen_domains.add(site.lower())
            made += 1
            rid = f"s-{a.city}-{slug}-{made:04d}"
            save_candidate({
                "record_id": rid, "audience": "service", "city": a.city,
                "market": market, "state": state,
                "category": None, "service_type": t.title(),
                "display_name": r.get("title"), "ig_handle": None,
                "website_url": site, "source": f"serpapi:{a.source}",
                "discovery_artifacts": [aid], "site_artifacts": [],
            })
        print(f"  {t:22s} {len(results):3d} results  running total {made}")
        time.sleep(0.5)
    print(f"\n{made} new candidates. Now fetch their sites, then run `build`.")
    print("Site fetching is the next step — point it at Decodo or ScrapingBee; "
          "each page becomes a raw artifact exactly like the ones already in raw/.")


# -------------------------------------------------------------------- BUILD --
def cmd_build(a):
    for step, cmd in (("extract", [sys.executable, os.path.join(ROOT, "extract.py")]),
                      ("qa", [sys.executable, os.path.join(ROOT, "qa.py")]),
                      ("spreadsheet", [sys.executable, os.path.join(ROOT, "build_xlsx.py")])):
        print(f"\n=== {step} ===")
        r = subprocess.run(cmd, cwd=ROOT)
        if r.returncode != 0:
            if step == "qa":
                sys.exit("\nQA FAILED — not building a spreadsheet from a failing crawl.\n"
                         "Canary #280.1 going red means values are being produced that no "
                         "page contained. Stop and fix before shipping anything.")
            sys.exit(f"{step} failed")
    print(f"\nDone -> {os.path.join(OUT, 'CERGIO_crawl_v2_audit_200.xlsx')}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="CERGIO crawl pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("followers"); f.add_argument("--limit", type=int, default=0)
    d = sub.add_parser("discover")
    d.add_argument("--source", choices=["lsa", "local"], default="local")
    d.add_argument("--city", choices=["NYC", "MIA"], required=True)
    d.add_argument("--limit", type=int, default=200)
    sub.add_parser("build")
    sub.add_parser("all")
    a = ap.parse_args()

    if a.cmd == "all":
        cmd_build(a); a.limit = 0; cmd_followers(a); cmd_build(a)
    else:
        {"followers": cmd_followers, "discover": cmd_discover, "build": cmd_build}[a.cmd](a)
