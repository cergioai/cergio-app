#!/usr/bin/env python3
"""
Publish the crawl to the web and to a machine-readable status file.

Writes three things into the repo's public/ folder, which Vercel serves at the
site root:

    public/leads.html          the dashboard, live at  <your-domain>/leads.html
    public/leads.csv           every row, downloadable
    public/crawl-status.json   small, structured, readable by anyone (or anything)
                               without downloading a workflow artifact

The status file exists so progress can be checked WITHOUT opening the Actions
tab or unzipping an artifact — a URL and a git path both work. That is what makes
the run observable from outside GitHub.
"""
import json, os, csv, shutil, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
# repo root is two levels up when this lives at tools/crawl/
REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))
PUB = os.path.join(REPO, "public")
OUT = os.path.join(ROOT, "out")

if not os.path.isdir(PUB):
    PUB = os.path.join(ROOT, "public")
    os.makedirs(PUB, exist_ok=True)

recs = json.load(open(os.path.join(OUT, "records.json"), encoding="utf-8"))
now = datetime.now(timezone.utc)


def n(f):
    return sum(1 for r in recs if f(r))


by_source = {}
for r in recs:
    s = by_source.setdefault(r.get("source") or "Unlabelled",
                             {"total": 0, "contactable": 0, "email": 0,
                              "phone": 0, "instagram": 0, "nyc": 0, "mia": 0})
    s["total"] += 1
    s["contactable"] += bool(r.get("contactable"))
    s["email"] += bool(r.get("email"))
    s["phone"] += bool(r.get("phone"))
    s["instagram"] += bool(r.get("has_instagram"))
    s["nyc" if r.get("city") == "NYC" else "mia"] += 1

creators = [r for r in recs if r["audience"] == "creator"]
status = {
    "generated_at": now.isoformat(timespec="seconds"),
    "generated_human": now.strftime("%d %b %Y %H:%M UTC"),
    "totals": {
        "crawled": len(recs),
        "contactable": n(lambda r: r.get("contactable")),
        "with_email": n(lambda r: r.get("email")),
        "with_phone": n(lambda r: r.get("phone")),
        "with_both": n(lambda r: r.get("email") and r.get("phone")),
        "with_instagram": n(lambda r: r.get("has_instagram")),
        "incomplete": n(lambda r: not r.get("contactable")),
    },
    "by_city": {"NYC": n(lambda r: r["city"] == "NYC"),
                "MIA": n(lambda r: r["city"] == "MIA")},
    "by_audience": {a: n(lambda r, a=a: r["audience"] == a)
                    for a in sorted({r["audience"] for r in recs})},
    "creators": {
        "total": len(creators),
        "with_follower_count": sum(1 for r in creators if r.get("followers") is not None),
        "over_2500": sum(1 for r in creators if (r.get("followers") or 0) >= 2500),
    },
    "by_source": by_source,
    "targets": {"realestate": {"NYC": 2000, "MIA": 400},
                "localbiz": {"NYC": 2000, "MIA": 400}},
    "run": {
        "number": os.environ.get("GITHUB_RUN_NUMBER"),
        "id": os.environ.get("GITHUB_RUN_ID"),
        "sha": (os.environ.get("GITHUB_SHA") or "")[:8],
    },
}
json.dump(status, open(os.path.join(PUB, "crawl-status.json"), "w", encoding="utf-8"), indent=2)

src = os.path.join(OUT, "cergio-dashboard.html")
if os.path.exists(src):
    shutil.copy(src, os.path.join(PUB, "leads.html"))


def prov(r, f, k):
    return ((r.get("provenance") or {}).get(f) or {}).get(k)


COLS = [("record_id", lambda r: r["record_id"]), ("source", lambda r: r.get("source")),
        ("audience", lambda r: r["audience"]), ("city", lambda r: r["city"]),
        ("type", lambda r: r.get("service_type") or r.get("category")),
        ("name", lambda r: r.get("display_name")), ("first_name", lambda r: r.get("first_name")),
        ("instagram", lambda r: r.get("ig_handle")), ("has_instagram", lambda r: r.get("has_instagram")),
        ("followers", lambda r: r.get("followers")),
        ("email", lambda r: r.get("email")), ("email_found_on", lambda r: prov(r, "email", "source_url")),
        ("phone", lambda r: r.get("phone")), ("phone_found_on", lambda r: prov(r, "phone", "source_url")),
        ("website", lambda r: r.get("website_url")),
        ("contactable", lambda r: "yes" if r.get("contactable") else "no"),
        ("incomplete_because", lambda r: r.get("hold_reason"))]
with open(os.path.join(PUB, "leads.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow([c[0] for c in COLS])
    for r in sorted(recs, key=lambda r: (not r.get("contactable"), r["record_id"])):
        w.writerow([c[1](r) for c in COLS])

t = status["totals"]
print(f"published -> {PUB}")
print(f"  leads.html · leads.csv · crawl-status.json")
print(f"  {t['crawled']} crawled, {t['contactable']} contactable, "
      f"{t['with_instagram']} on Instagram")
