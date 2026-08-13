#!/usr/bin/env python3
"""
SPEC-280 — ANTI-FABRICATION QA GATE.   Run: python3 qa.py

Pure Python so it runs on a stock Mac with nothing installed.

The creator crawl once shipped emails, phones and follower counts that were
never on any page. Filtering sources does not fix that, because the bad values
did not come from a source — the crawler produced them itself.

So this does not test "is the data good". It tests the one property that makes
the failure impossible: every value is a byte-level substring of a stored page,
and anything else is blank.

The tests that matter most are the NEGATIVE CANARIES: a page containing nothing
is fed in, and nothing must come out. A crawler that invents data passes every
positive test ever written and fails only there.
"""

import json, os, sys, shutil, tempfile, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
EXTRACT = os.path.join(HERE, "extract.py")

GREEN, RED, DIM, BOLD, OFF = "\033[32m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"
_pass, _fail, _failed = 0, 0, []


def test(name, spec, why, fn):
    global _pass, _fail
    try:
        fn()
        _pass += 1
        print(f"  {GREEN}ok{OFF}   {spec}  {name}")
    except Exception as e:
        _fail += 1
        _failed.append((spec, name, str(e), why))
        print(f"  {RED}FAIL{OFF} {spec}  {name}\n       {e}\n       {DIM}why it matters: {why}{OFF}")


def assert_(cond, msg):
    if not cond:
        raise AssertionError(msg)


def run_extractor(artifacts, candidates):
    """Build a throwaway crawl root, run the REAL extractor, return its output."""
    root = tempfile.mkdtemp(prefix="qa-crawl-")
    try:
        for d in ("raw", "candidates", "out"):
            os.makedirs(os.path.join(root, d))
        for a in artifacts:
            json.dump(a, open(os.path.join(root, "raw", a["artifact_id"] + ".json"),
                              "w", encoding="utf-8"))
        for c in candidates:
            json.dump(c, open(os.path.join(root, "candidates", c["record_id"] + ".json"),
                              "w", encoding="utf-8"))
        env = {**os.environ, "CRAWL_ROOT": root}
        r = subprocess.run([sys.executable, EXTRACT], env=env, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"extractor crashed: {r.stderr[-500:]}")
        return (json.load(open(os.path.join(root, "out", "records.json"), encoding="utf-8")),
                json.load(open(os.path.join(root, "out", "quarantine.json"), encoding="utf-8")))
    finally:
        shutil.rmtree(root, ignore_errors=True)


def art(aid, url, content, kind="site"):
    return {"artifact_id": aid, "url": url, "kind": kind,
            "fetched_at": "2026-08-12T00:00:00Z", "content": content}


def cand(**over):
    base = {"record_id": "x-01", "audience": "service", "city": "NYC",
            "market": "New York", "state": "NY", "category": "Pets",
            "service_type": "Dog Walker", "display_name": "Test Co",
            "ig_handle": "testco", "website_url": "https://testco.com",
            "discovery_artifacts": [], "site_artifacts": ["x-01__1"]}
    base.update(over)
    return base


SITE = "https://testco.com/"
print(f"\n{BOLD}SPEC-280 — anti-fabrication gate{OFF}\n")

# ---------------------------------------------------------------------------
# NEGATIVE CANARIES — the tests the old suite was missing
# ---------------------------------------------------------------------------

def t1():
    recs, quar = run_extractor(
        [art("x-01__1", SITE, "Test Co. Dog walking in Brooklyn, New York. Book online. "
                              "Instagram: https://instagram.com/testco NO_CONTACT_INFO_PRESENT")],
        [cand()])
    assert_(len(recs) == 0, "a contactless page produced a PASSING record")
    assert_(quar[0]["email"] is None, f"email was invented: {quar[0]['email']}")
    assert_(quar[0]["phone"] is None, f"phone was invented: {quar[0]['phone']}")
test("a page with no contact info yields no contact", "#280.1",
     "This is the whole bug. If it ever goes red, values are being produced that no page "
     "contained — stop the pipeline.", t1)


def t2():
    _, quar = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn NY. 50k followers on our socials! "
                              "https://instagram.com/testco")], [cand()])
    assert_(quar[0]["followers"] is None, f"followers taken from marketing copy: {quar[0]['followers']}")
test("an unknown follower count is never filled in", "#280.2",
     "The old pipeline wrote counts it could not see. A plausible number is worse than none, "
     "because nobody audits it.", t2)


def t3():
    _, quar = run_extractor(
        [art("x-01__1", "https://testco.com/contact",
             "Contact Test Co. We serve Brooklyn, New York. Use the form below.")], [cand()])
    assert_(quar[0]["email"] is None, f"an email was synthesised: {quar[0]['email']}")
test("an email is never constructed from the domain name", "#280.3",
     "info@<their-domain> is the commonest fabricated field: plausible, often deliverable, "
     "still a guess.", t3)


# ---------------------------------------------------------------------------
# THE SUBSTRING PROOF
# ---------------------------------------------------------------------------

def t4():
    content = ("Test Co — Brooklyn, New York. Email: hello@testco.com or call "
               "(718) 555-0142. https://instagram.com/testco")
    recs, _ = run_extractor([art("x-01__1", SITE, content)], [cand()])
    assert_(len(recs) == 1, "a fully contactable record did not pass")
    for f in ("email", "phone"):
        p = recs[0]["provenance"][f]
        assert_(p, f"{f} has no provenance")
        needle = p.get("as_printed") or p["value"]
        assert_(content[p["offset"]:p["offset"] + len(needle)] == needle,
                f"{f} does not round-trip at offset {p['offset']}")
        assert_(len(p["artifact_sha256"]) == 64, f"{f} has no artifact hash")
test("every emitted value is a byte-level substring of its page", "#280.4",
     "This is the mechanism that makes fabrication impossible rather than discouraged.", t4)


def t5():
    _, quar = run_extractor(
        [art("x-01__1", SITE, "Test Co. Brooklyn, New York. Book online."),
         art("x-01__2", "https://some-directory.com/testco",
             "Test Co — Brooklyn NY — email: scraped@directory.com — (718) 555-0199")],
        [cand(site_artifacts=["x-01__1", "x-01__2"])])
    assert_(quar[0]["email"] is None, f"a foreign-domain email was adopted: {quar[0]['email']}")
    assert_(quar[0]["phone"] is None, f"a foreign-domain phone was adopted: {quar[0]['phone']}")
test("a contact on someone else's domain is discarded", "#280.5",
     "Never scrape a phone from an unrelated page — that is how a number lands on the wrong lead.", t5)


# ---------------------------------------------------------------------------
# GEO — the Manchester / Manhattan trap
# ---------------------------------------------------------------------------

def t6():
    recs, quar = run_extractor(
        [art("x-01__1", SITE, "THE MANCHESTER DOG WALKER. Serving Manchester city centre, "
                              "United Kingdom. Email: hi@testco.com https://instagram.com/testco")],
        [cand()])
    assert_(len(recs) == 0, "a Manchester business passed as NYC")
    assert_("geo_unverified" in quar[0]["gate_failures"], "geo gate did not fire")
test("geo is proven from the page, never inherited from the search", "#280.6",
     "A live search for a Manhattan dog walker returned a MANCHESTER, UK one.", t6)


def t7():
    recs, _ = run_extractor(
        [art("x-01__1", SITE, "Test Co, based in Brooklyn, New York. Email: hi@testco.com. "
                              "https://instagram.com/testco")], [cand()])
    assert_(len(recs) == 1, "a genuinely NYC record failed the geo gate")
    assert_(recs[0]["provenance"]["geo"]["token"], "the matched geo token was not recorded")
test("a real city match passes and records which word matched", "#280.7",
     "The gate must admit true positives, and an unexplained boolean is not auditable.", t7)


# ---------------------------------------------------------------------------
# FOUNDER RULES
# ---------------------------------------------------------------------------

def t8():
    recs, quar = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn, New York. Email: hi@testco.com. "
                              "Follow us on social media!")], [cand()])
    assert_(len(recs) == 0, "a service with no provable handle passed")
    assert_("service_without_ig" in quar[0]["gate_failures"], "the IG gate did not fire")
test("a service without a proven Instagram cannot pass", "#280.8",
     "Founder rule 2026-08-12: services only count with a real Instagram account.", t8)


def t9():
    _, quar = run_extractor(
        [art("x-01__1", SITE, "Test Co. Brooklyn, New York. Email: hi@testco.com")], [cand()])
    assert_(quar[0]["ig_handle"] is None, "the handle was inferred from the business name")
test("a handle is not accepted because it matches the business name", "#280.9",
     "Guessing @testco from 'Test Co' is the same failure as guessing info@.", t9)


def t10():
    own = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn, New York. hi@testco.com "
                              "https://instagram.com/testco")], [cand()])[0][0]
    assert_(own["ig_proof_strength"] == "A_own_site_url", f"got {own['ig_proof_strength']}")
    third = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn, New York. hi@testco.com"),
         art("x-01__2", "websearch:test co nyc",
             "Test Co (@testco) https://instagram.com/testco", "discovery")],
        [cand(discovery_artifacts=["x-01__2"])])[0][0]
    assert_(third["ig_proof_strength"] == "C_search_result_url", f"got {third['ig_proof_strength']}")
test("Instagram proof strength is recorded, own-site beating third-party", "#280.10",
     "A handle on the business's own site is far stronger evidence than one in a search result.", t10)


def t11():
    blocked, _ = run_extractor(
        [art("x-01__1", SITE, "Test Spa, Brooklyn, New York. Massage and facials. "
                              "hi@testco.com https://instagram.com/testco")],
        [cand(service_type="Esthetician")])
    assert_(len(blocked) == 0, "a massage provider passed the blocked-vertical gate")
    ok, _ = run_extractor(
        [art("x-01__1", SITE, "Test Dojo, Brooklyn, New York. Adult classes and kids classes. "
                              "hi@testco.com https://instagram.com/testco")],
        [cand(service_type="Martial Arts Instructor")])
    assert_(len(ok) == 1, "'adult classes' was wrongly treated as adult content")
test("blocked verticals match whole words, not substrings", "#280.11",
     "A substring blocklist quarantined martial-arts gyms for offering 'adult classes'.", t11)


def t12():
    _, quar = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn NY. https://instagram.com/testco "
                              "a1b2@sentry.wixpress.com no-reply@testco.com you@example.com")],
        [cand()])
    assert_(quar[0]["email"] is None, f"boilerplate shipped as a lead: {quar[0]['email']}")
test("website boilerplate never becomes a lead", "#280.12",
     "sentry/wix/no-reply addresses appear on a large share of small-business sites.", t12)


def t13():
    recs, _ = run_extractor(
        [{"artifact_id": "x-01__1", "url": SITE, "fetched_at": "x", "kind": "site"}], [cand()])
    assert_(len(recs) == 0, "a record was built on a page with no content")
test("a corrupt page is refused, not half-read", "#280.13",
     "Failing closed costs nothing; a half-parsed page becomes confident bad data.", t13)


def t14():
    src = open(EXTRACT, encoding="utf-8").read()
    import re as _re
    for bad in ("requests", "urllib", "httpx", "socket", "aiohttp", "subprocess"):
        assert_(not _re.search(rf"^\s*(import|from)\s+{bad}\b", src, _re.M),
                f"extract.py imports {bad} — it must never be able to fetch")
test("the extractor cannot reach the network", "#280.14",
     "The guarantee rests on fetch and extract being separate. If extract can fetch, "
     "every other proof is theatre.", t14)


def t15():
    src = open(EXTRACT, encoding="utf-8").read()
    assert_("content[idx:idx + len(value)] != value" in src,
            "the byte-level substring check has been removed")
test("the substring proof still exists in the writer", "#280.15",
     "Every guarantee here reduces to that one assertion.", t15)


def t16():
    content = ("Coach A, Brickell, Miami FL. Email me: mailto:%20Austinmorelltraining@gmail.com "
               "https://instagram.com/testco")
    recs, _ = run_extractor([art("x-01__1", SITE, content)],
                            [cand(city="MIA", market="Miami-Ft. Lauderdale", state="FL")])
    assert_(recs[0]["email"] == "austinmorelltraining@gmail.com",
            f"percent-encoding leaked into the address: {recs[0]['email']}")
test("mailto encoding never leaks into an address", "#280.16",
     "Found in the first real drop: a fully-provenanced address that would hard-bounce. "
     "Proof of origin is not proof of validity.", t16)


def t17():
    site = art("x-01__1", SITE, "Test Co, Brooklyn, New York. hi@testco.com "
                                "https://instagram.com/testco")
    good = run_extractor([site, art("x-01__ig1", "https://www.instagram.com/testco/",
                                    '{"account":"testco","followers_count":48210}', "ig_profile")],
                         [cand(ig_artifacts=["x-01__ig1"])])[0][0]
    assert_(good["followers"] == 48210, f"followers not extracted: {good['followers']}")
    bad = run_extractor([site, art("x-01__ig1", "https://www.instagram.com/someoneelse/",
                                   '{"account":"someoneelse","followers_count":999999}', "ig_profile")],
                        [cand(ig_artifacts=["x-01__ig1"])])[0][0]
    assert_(bad["followers"] is None, f"another account's count was adopted: {bad['followers']}")
test("a paid vendor gets no more trust than a web page", "#280.17",
     "'Bright Data said so' is exactly the unverified assertion that caused the original mess.", t17)


def t18():
    bad, _ = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn, New York. Order #698 552-4693 ref "
                              "792 469-6567. hi@testco.com https://instagram.com/testco")], [cand()])
    assert_(bad[0]["phone"] is None, f"an unassigned area code shipped: {bad[0]['phone']}")
    good, _ = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn, New York. Call (718) 555-0142. "
                              "hi@testco.com https://instagram.com/testco")], [cand()])
    assert_(good[0]["phone"] == "(718) 555-0142", f"a valid number was rejected: {good[0]['phone']}")
test("a digit run that is not a phone number is not a phone number", "#280.18",
     "'(698) 552-4693' shipped in the first drop with perfect provenance. 698 is not an "
     "area code. Structure and validity are different gates.", t18)


def t19():
    r = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn, New York. Call (857) 210-8929. "
                              "Email us@sometheme-vendor.com https://instagram.com/testco")],
        [cand()])[0][0]
    assert_(r["flag_phone_out_of_metro"], "an out-of-metro area code was not flagged")
    assert_(r["flag_email_offsite_domain"], "an off-domain business email was not flagged")
    clean = run_extractor(
        [art("x-01__1", SITE, "Test Co, Brooklyn, New York. Call (718) 555-0142. "
                              "Email hi@testco.com https://instagram.com/testco")], [cand()])[0][0]
    assert_(not clean["flag_phone_out_of_metro"] and not clean["flag_email_offsite_domain"],
            "a clean record was flagged — a flag that fires on everything is not a signal")
test("odd-looking rows are flagged for review, not silently kept or dropped", "#280.19",
     "A Miami cleaner with a Boston mobile is plausible; a web designer's address on a "
     "groomer's site is not. Neither is decidable by rule.", t19)


def t20():
    site_txt = "Creator, Brooklyn, New York. hi@testco.com https://instagram.com/testco"
    small = run_extractor(
        [art("x-01__1", SITE, site_txt),
         art("x-01__ig1", "https://www.instagram.com/testco/",
             '{"account":"testco","followers_count":412}', "ig_profile")],
        [cand(audience="creator", ig_artifacts=["x-01__ig1"])])[0]
    assert_(len(small) == 1, "a creator under 2,500 was dropped — the floor became a gate")
    assert_(small[0]["followers"] == 412, "the small follower count was not kept")
    assert_(small[0]["follower_tier"] == "under_2500_keep", f"wrong tier: {small[0]['follower_tier']}")
    assert_(not any("follow" in f for f in small[0]["gate_failures"]),
            "a follower rule leaked into the gates — that is a deletion, not a view")
    svc = run_extractor(
        [art("x-01__1", SITE, "Dog groomer, Brooklyn, New York. hi@testco.com "
                              "https://instagram.com/testco"),
         art("x-01__ig1", "https://www.instagram.com/testco/",
             '{"account":"testco","followers_count":600}', "ig_profile")],
        [cand(audience="service", ig_artifacts=["x-01__ig1"])])[0][0]
    assert_(svc["follower_tier"] == "n/a_service", "the creator floor was applied to a service")
test("the 2,500 floor sorts creators and deletes nobody", "#280.20",
     "Founder decision 2026-08-12: keep all profiles, target the smaller ones later. "
     "A floor built as a gate destroys reachable audience and cannot be undone.", t20)


print(f"\n{_pass} passed, {_fail} failed\n")
if _fail:
    print(f"{RED}{BOLD}BLOCKING — do not ship this crawl.{OFF}\n")
    sys.exit(1)
