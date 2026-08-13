#!/usr/bin/env python3
"""
CERGIO WATERFALL EXTRACTOR  —  anti-fabrication core.

THE ONE RULE
------------
A field value may only be written if that exact string is present, byte-for-byte,
inside a stored raw artifact. The writer proves it:

        artifact_content[offset : offset + len(value)] == value

Nothing in this file can invent a value. There is no model in this path, no
inference, no "info@ + domain" guessing, no follower estimation. If the bytes
do not contain it, the field is NULL and the reason is recorded.

SEPARATION OF POWERS
--------------------
  FETCH  (agents / vendor)  -> writes raw/*.json   (immutable, hashed)
  EXTRACT (this file)       -> reads raw/*.json    (never fetches)
  AUDIT  (audit.py)         -> re-derives independently and compares

No component both fetches and emits a field value. That is what makes the
2026-08 "crawler faked its own input" failure structurally unrepeatable.
"""

import json, re, os, hashlib, sys, glob
from datetime import datetime, timezone

ROOT = os.environ.get("CRAWL_ROOT") or os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, "raw")
CAND = os.path.join(ROOT, "candidates")
OUT = os.path.join(ROOT, "out")

# --------------------------------------------------------------------------
# PATTERNS  (deterministic, no inference)
# --------------------------------------------------------------------------
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# US phone: (212) 555-1234 | 212-555-1234 | 212.555.1234 | +1 212 555 1234
PHONE_RE = re.compile(
    r"(?:\+?1[\s\-.])?\(?([2-9]\d{2})\)?[\s\-.]?([2-9]\d{2})[\s\-.]?(\d{4})(?!\d)"
)
IG_URL_RE = re.compile(r"instagram\.com/([A-Za-z0-9_.]{1,30})", re.I)

# Emails that are never a lead: platform boilerplate, tracking, placeholders.
EMAIL_DENY_SUBSTR = (
    "example.com", "example.org", "yourdomain", "your-email", "youremail",
    "email@", "name@", "sentry.io", "wixpress", "godaddy", "squarespace",
    "schema.org", "w3.org", "sentry-next", "@2x.png", ".png", ".jpg", ".jpeg",
    ".gif", ".webp", ".svg", ".css", ".js", "domain.com", "test@test",
    "no-reply", "noreply", "donotreply", "abuse@", "postmaster@",
    "wordpress.com", "wpengine", "cloudflare", "shopify.com", "@sentry",
)
# Assigned US NANP area codes. Structure alone is not enough: "(698) 552-4693"
# and "(792) 469-6567" satisfy every structural rule ([2-9]NN-NXX-XXXX) and are
# not phone numbers at all — the regex had matched arbitrary digit runs. Both
# shipped in the first drop with perfect provenance. A value can be provably
# from the page and still be junk, so structure gates and validity gates are
# different jobs.
NANP_AREA = set("""
201 202 203 205 206 207 208 209 210 212 213 214 215 216 217 218 219 220 223 224
225 227 228 229 231 234 235 239 240 248 251 252 253 254 256 260 262 267 269 270
272 274 276 279 281 301 302 303 304 305 307 308 309 310 312 313 314 315 316 317
318 319 320 321 323 325 326 330 331 332 334 335 336 337 339 341 346 347 350 351
352 360 361 364 369 380 385 386 401 402 404 405 406 407 408 409 410 412 413 414
415 417 419 423 424 425 430 432 434 435 436 440 442 443 445 447 448 458 463 464
469 470 472 475 478 479 480 484 501 502 503 504 505 507 508 509 510 512 513 515
516 517 518 520 530 531 534 539 540 541 551 557 559 561 562 563 564 567 570 571
572 573 574 575 580 582 585 586 601 602 603 605 606 607 608 609 610 612 614 615
616 617 618 619 620 623 626 628 629 630 631 636 640 641 646 650 651 656 657 659
660 661 662 667 669 678 680 681 682 686 689 701 702 703 704 706 707 708 712 713
714 715 716 717 718 719 720 724 725 726 727 731 732 734 737 740 743 747 754 757
760 762 763 765 769 770 772 773 774 775 779 781 785 786 787 801 802 803 804 805
806 808 810 812 813 814 815 816 817 818 820 826 828 830 831 832 835 838 839 840
843 845 847 848 850 854 856 857 858 859 860 862 863 864 865 870 872 878 901 903
904 906 907 908 909 910 912 913 914 915 916 917 918 919 920 925 928 929 930 931
934 935 936 937 938 940 941 945 947 949 951 952 954 956 959 970 971 972 973 975
978 979 980 984 985 986 989
""".split())

# Area codes that actually belong to each metro. A mismatch is NOT a rejection —
# a Miami cleaner may legitimately publish a Boston mobile — but it is a flag the
# audit can filter on, and it is how a scraped-from-the-wrong-page number shows up.
METRO_AREA = {
    "NYC": {"212", "646", "332", "917", "718", "347", "929", "516", "631", "914",
            "845", "201", "551", "973", "862", "908", "732", "848"},
    "MIA": {"305", "786", "954", "754", "561", "772", "239"},
}

# Founder decision, 2026-08-12: a 2,500-follower floor applies to CREATORS ONLY,
# and it NEVER deletes a row. Small creators are kept and targeted later.
CREATOR_FOLLOWER_FLOOR = 2500


def follower_tier(audience, followers):
    """A label for sorting. Never a reason to drop a record."""
    if audience != "creator":
        return "n/a_service"          # the floor does not apply to services
    if not followers:
        return "unknown_pending_l3"
    return "2500_plus" if followers["value"] >= CREATOR_FOLLOWER_FLOOR else "under_2500_keep"


FREE_MAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
             "aol.com", "me.com", "proton.me", "protonmail.com", "msn.com", "live.com"}

# Phone strings that are structurally valid but are never a business line.
PHONE_DENY = {
    "0000000000", "1111111111", "1234567890", "5555555555", "8005551212",
    "9999999999", "2125551234", "1231231234",
}

# Geo tokens that prove a record belongs to the city it is filed under.
CITY_TOKENS = {
    "NYC": [
        "new york", "nyc", "manhattan", "brooklyn", "queens", "bronx",
        "staten island", "harlem", "soho", "tribeca", "chelsea nyc",
        "williamsburg", "astoria", "upper east side", "upper west side",
        "long island city", "park slope", "greenwich village", "ny 1",
        ", ny", "new york, ny", "jersey city", "hoboken", "newark, nj",
    ],
    "MIA": [
        "miami", "miami beach", "south beach", "brickell", "coral gables",
        "wynwood", "coconut grove", "doral", "hialeah", "aventura",
        "fort lauderdale", "ft lauderdale", "kendall", "little havana",
        "key biscayne", "sunny isles", ", fl", "miami, fl", "broward",
        "pinecrest", "midtown miami", "edgewater miami",
    ],
}
# Tokens that prove a record is NOT in the filed city (contamination trap).
CITY_ANTI = {
    "NYC": ["manchester", "london", "uk", "toronto", "sydney", "dublin"],
    "MIA": ["manchester", "london", "ohio", "oklahoma"],
}

# Word-boundary regexes, not substrings. "adult" as a bare substring quarantined
# martial-arts gyms for offering "adult classes" — a filter that fires on the wrong
# thing is as damaging as one that never fires.
BLOCKED_PATTERNS = [
    r"\bmassages?\b", r"\btattoos?\b", r"\bmakeup artists?\b",
    r"\b(?:personal|private) chefs?\b", r"\bcosmetic surgery\b",
    r"\bcannabis\b", r"\bdispensar(?:y|ies)\b", r"\bvape\b", r"\bcasinos?\b",
    r"\bgambling\b", r"\bslots?\b", r"\bfirearms?\b", r"\bgun range\b",
    r"\bescorts?\b", r"\badult (?:content|entertainment|film|video|only)\b",
    r"\bnightclubs?\b", r"\bhookah\b", r"\bliquor store\b", r"\bsmoke shop\b",
]
BLOCKED_RE = [(p, re.compile(p, re.I)) for p in BLOCKED_PATTERNS]


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def load_artifacts():
    """Load every stored artifact and verify its integrity hash."""
    arts, bad = {}, []
    for p in sorted(glob.glob(os.path.join(RAW, "*.json"))):
        try:
            a = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            bad.append((os.path.basename(p), f"unparseable: {e}"))
            continue
        if not a.get("content") or not a.get("url"):
            bad.append((os.path.basename(p), "missing content or url"))
            continue
        a["sha256"] = sha256(a["content"])
        a["artifact_id"] = a.get("artifact_id") or os.path.basename(p)[:-5]
        arts[a["artifact_id"]] = a
    return arts, bad


def host_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url or "", re.I)
    if not m:
        return ""
    h = m.group(1).lower()
    return h[4:] if h.startswith("www.") else h


def registrable(host: str) -> str:
    """Crude eTLD+1. Enough to catch cross-entity contamination."""
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def prove(artifact, value):
    """
    THE SUBSTRING PROOF. Returns a provenance dict or None.
    A value that is not literally in the stored bytes cannot be returned.
    """
    content = artifact["content"]
    idx = content.find(value)
    if idx < 0:
        return None
    if content[idx:idx + len(value)] != value:      # belt and braces
        return None
    lo, hi = max(0, idx - 70), min(len(content), idx + len(value) + 70)
    return {
        "value": value,
        "source_url": artifact["url"],
        "artifact_id": artifact["artifact_id"],
        "artifact_sha256": artifact["sha256"],
        "offset": idx,
        "verbatim_snippet": content[lo:hi].replace("\n", " ").strip(),
        "fetched_at": artifact.get("fetched_at"),
    }


def norm_phone(m) -> str:
    return f"({m.group(1)}) {m.group(2)}-{m.group(3)}"


def extract_email(artifacts):
    """First acceptable email, with proof. Never constructed."""
    for a in artifacts:
        for m in EMAIL_RE.finditer(a["content"]):
            raw = m.group(0)
            # A mailto: href can drag percent-encoding into the local part
            # ("%20Austinmorelltraining@gmail.com"). Re-anchor after the last
            # encoded byte rather than shipping an address that will hard-bounce.
            # The trimmed string is still proven against the bytes below.
            if "%" in raw.split("@")[0]:
                raw = re.sub(r"^.*%[0-9A-Fa-f]{2}", "", raw)
            low = raw.lower()
            if any(d in low for d in EMAIL_DENY_SUBSTR):
                continue
            if low.count("@") != 1 or len(low) > 100 or not low.split("@")[0]:
                continue
            p = prove(a, raw)
            if p:
                p["value"] = low
                p["as_printed"] = raw
                p["method"] = "regex/email/RFC-lite"
                return p
    return None


def extract_phone(artifacts):
    for a in artifacts:
        for m in PHONE_RE.finditer(a["content"]):
            digits = m.group(1) + m.group(2) + m.group(3)
            if digits in PHONE_DENY:
                continue
            if m.group(1) not in NANP_AREA:      # unassigned area code = not a phone
                continue
            if m.group(2).endswith("11"):        # N11 exchange is never a subscriber line
                continue
            p = prove(a, m.group(0))
            if p:
                p["value"] = norm_phone(m)
                p["as_printed"] = m.group(0)
                p["digits"] = digits
                p["method"] = "regex/phone/NANP"
                return p
    return None


FOLLOWER_KEYS = (
    "followers_count", "follower_count", "followers", "edge_followed_by",
)


def extract_followers(ig_artifacts, handle):
    """
    L3 follower count — held to exactly the same proof as every other field.

    A vendor is not more trusted than a web page. The number must be printed in
    the stored response, the response must be about THIS handle, and the digits
    must survive the substring proof. Anything else stays NULL.
    """
    if not handle:
        return None
    for a in ig_artifacts:
        content = a["content"]
        # contamination guard: the response must name this handle
        if handle.lower() not in content.lower():
            continue
        for k in FOLLOWER_KEYS:
            for m in re.finditer(
                    rf'"{k}"\s*:\s*(?:\{{\s*"count"\s*:\s*)?(\d{{1,12}})', content):
                digits = m.group(1)
                p = prove(a, digits)
                if p:
                    p["value"] = int(digits)
                    p["as_printed"] = digits
                    p["method"] = f"json/{k}"
                    return p
    return None


# First names. "Infer" is the one word that has to be handled carefully here —
# inferring a name from an email local part (sarah@ -> Sarah) or from a handle
# is exactly the guessing that produced the original mess. So: a first name is
# taken only from a person INTRODUCING THEMSELVES in their own page text, or
# from a display name whose first token also appears capitalised in that text.
# Businesses get NULL. Better an empty column than "Dear Doggie,".
INTRO_RE = re.compile(
    r"(?:I'?m|I am|My name is|Meet|Hi,?\s*I'?m|Hello,?\s*I'?m|owner,?\s+)"
    r"\s+([A-Z][a-z]{1,14})(?=[\s,.!—\-])")
NOT_A_NAME = {
    "the", "a", "an", "our", "your", "we", "us", "and", "for", "with", "here",
    "welcome", "hello", "hi", "about", "contact", "home", "new", "york", "miami",
    "brooklyn", "manhattan", "queens", "bronx", "dog", "pet", "pets", "puppy",
    "cat", "nail", "nails", "lash", "lashes", "brow", "skin", "hair", "salon",
    "spa", "studio", "fitness", "gym", "clean", "cleaning", "maid", "walker",
    "walking", "groom", "grooming", "daycare", "training", "trainer", "coach",
    "mom", "mama", "mommy", "dad", "baby", "kids", "family", "best", "top",
    "premier", "elite", "pro", "professional", "happy", "lucky", "little",
    "big", "city", "urban", "local", "mobile", "luxury", "glow", "beauty",
    "wellness", "health", "care", "services", "service", "co", "llc", "inc",
    "company", "group", "team", "house", "casa", "bar", "club", "shop", "store",
}


def extract_first_name(owned, display_name):
    """A proven given name, or NULL. Never derived from an email or a handle."""
    for a in owned:
        m = INTRO_RE.search(a["content"])
        if m and m.group(1).lower() not in NOT_A_NAME:
            p = prove(a, m.group(1))
            if p:
                p["method"] = "text/self-introduction"
                return p
    # Fall back to the display name ONLY when it is a person's name and nothing
    # else: exactly two title-case words, neither of them a business word.
    # The looser version of this rule produced "Dogtown", "Woof", "WYNWOOD" and
    # "Boujee" as first names — every one provable, every one useless in a
    # greeting. Two capitalised words is the narrowest rule that still catches
    # "Isabel Klee" and rejects "Robert Caro Hair" and "Curly by Yulia".
    name = (display_name or "").strip()
    m = re.fullmatch(r"([A-Z][a-z]{1,14})\s+([A-Z][a-z]{1,19})", name)
    if m and m.group(1).lower() not in NOT_A_NAME and m.group(2).lower() not in NOT_A_NAME:
        for a in owned:
            p = prove(a, m.group(1))
            if p:
                p["method"] = "display-name/person-shaped"
                return p
    return None


def verify_city(city, artifacts, extra_text=""):
    """Geo must be PROVEN from text, never inferred from the search query."""
    toks = CITY_TOKENS.get(city, [])
    anti = CITY_ANTI.get(city, [])
    for a in artifacts:
        low = a["content"].lower()
        for t in toks:
            i = low.find(t)
            if i >= 0:
                # a competing-city token nearby means ambiguous -> reject
                window = low[max(0, i - 200): i + 200]
                if any(x in window for x in anti):
                    continue
                p = prove(a, a["content"][i:i + len(t)])
                if p:
                    p["as_printed"] = a["content"][i:i + len(t)]
                    p["method"] = "geo/token-match"
                    p["token"] = t
                    return p
    low = (extra_text or "").lower()
    for t in toks:
        if t.replace(" ", "") in low.replace(" ", ""):
            return {
                "value": t, "source_url": "handle_or_display_name",
                "artifact_id": None, "artifact_sha256": None, "offset": None,
                "verbatim_snippet": extra_text, "method": "geo/handle-token",
                "token": t,
            }
    return None


# Human-readable source names. The old dashboard showed raw keys like
# "se:web-harvest" and "ig-scraper-user-search", which nobody can read at a
# glance and which hid that two different things were both called "IG".
SOURCE_LABELS = [
    ("google_local:realestate",       "Real Estate Agents"),
    ("google_local:localbiz",         "Local Businesses"),
    ("serpapi:google:site-instagram", "IG Service Creators"),
    ("serpapi:google_local",          "Google Local"),
    ("ig-scraper-user-search",        "IG Creators"),
    ("se:web-harvest",                "Web Creators"),
    ("google_lsa",                    "Google Ads (Sponsored)"),
    ("gmaps_apify",                   "Google Maps"),
    ("yellowpages",                   "Yellow Pages"),
    ("craigslist",                    "Craigslist"),
    ("yelp",                          "Yelp"),
    ("osm",                           "OpenStreetMap"),
]


def source_label(c):
    raw = (c.get("source") or "").lower()
    for key, label in SOURCE_LABELS:
        if key in raw:
            return label
    rid = c.get("record_id") or ""
    if rid.startswith("re-"):
        return "Real Estate Agents"
    if rid.startswith("lb-"):
        return "Local Businesses"
    if rid.startswith("ig-"):
        return "IG Service Creators"
    if rid.startswith("c-"):
        return "Web Creators"
    if rid.startswith("s-"):
        return "Web IG Service Creators"
    return "Unlabelled"


def blocked(text: str):
    for label, rx in BLOCKED_RE:
        m = rx.search(text or "")
        if m:
            return m.group(0).lower()
    return None


REASON_TEXT = {
    "no_contact": "No email or phone printed on their own pages",
    "geo_unverified": "City not provable from their own text",
    "geo_unverified,no_contact": "No contact, and city not provable",
    "service_without_ig": "No Instagram handle found",
    "no_contact,service_without_ig": "No contact and no Instagram found",
}


def main():
    artifacts, bad_artifacts = load_artifacts()
    records, rejects = [], []

    for p in sorted(glob.glob(os.path.join(CAND, "*.json"))):
        # Files starting with "_" are bookkeeping, not leads. _searched.json is
        # a LIST of completed queries; parsing it as a candidate crashed the whole
        # extract step, which would have failed every run once dedupe was on.
        if os.path.basename(p).startswith("_"):
            continue
        try:
            c = json.load(open(p, encoding="utf-8"))
            if not isinstance(c, dict):
                rejects.append({"file": os.path.basename(p), "reason": "not a candidate object"})
                continue
        except Exception as e:
            rejects.append({"file": os.path.basename(p), "reason": f"unparseable candidate: {e}"})
            continue

        rid = c.get("record_id") or os.path.basename(p)[:-5]
        site_arts = [artifacts[a] for a in c.get("site_artifacts", []) if a in artifacts]
        disc_arts = [artifacts[a] for a in c.get("discovery_artifacts", []) if a in artifacts]

        # ---- CONTAMINATION GUARD -------------------------------------------
        # A contact may only be taken from an artifact belonging to THIS entity.
        site_host = registrable(host_of(c.get("website_url", "")))
        owned, foreign = [], []
        for a in site_arts:
            ah = registrable(host_of(a["url"]))
            (owned if (site_host and ah == site_host) else foreign).append(a)

        email = None
        phone = None

        # ---- IG HANDLE: proven from the instagram.com URL itself ------------
        handle = (c.get("ig_handle") or "").lstrip("@").lower()

        ig_arts = [artifacts[a] for a in c.get("ig_artifacts", []) if a in artifacts]
        # An IG-first record has no website at all — its contact lives in the
        # Instagram bio. Treat that profile as belonging to this entity ONLY if
        # the response actually names this handle: the same contamination guard
        # used for followers. Without this, IG-first records could never carry a
        # contact, and the whole services-become-creators path yields nothing.
        ig_owned = [a for a in ig_arts if handle and handle in a["content"].lower()]
        contact_src = owned + ig_owned

        def prove_ig(arts, mode):
            """Prove the handle appears verbatim. Two accepted printed forms."""
            if not handle:
                return None
            for a in arts:
                if mode == "url":
                    for m in IG_URL_RE.finditer(a["content"]):
                        if m.group(1).lower() == handle:
                            pr = prove(a, m.group(0))
                            if pr:
                                pr["as_printed"] = m.group(0)
                                pr["value"] = handle
                                pr["method"] = "url/instagram-path"
                                return pr
                elif mode == "bare":
                    # The artifact IS this account's own profile response: its
                    # URL is instagram.com/<handle> and its body names the
                    # handle. Proving the bare handle here is sound because
                    # ig_owned already required both. This is the strongest
                    # tier — it is the account speaking for itself.
                    pr = prove(a, handle)
                    if pr:
                        pr["as_printed"] = handle
                        pr["method"] = "ig-profile/self"
                        return pr
                else:  # literal @handle printed on the page
                    for m in re.finditer(r"@([A-Za-z0-9_.]{1,30})", a["content"]):
                        if m.group(1).lower() == handle:
                            pr = prove(a, m.group(0))
                            if pr:
                                pr["as_printed"] = m.group(0)
                                pr["value"] = handle
                                pr["method"] = "text/at-handle"
                                return pr
            return None

        # Strength order. Own domain beats third party; a URL beats an @mention.
        # Every tier is still a byte-level substring proof — none of them infers.
        ig, strength = None, None
        for arts, mode, label in (
            (ig_owned, "bare", "A_ig_profile_itself"),
            (owned, "url", "A_own_site_url"),
            (owned, "at", "B_own_site_at_handle"),
            (disc_arts, "url", "C_search_result_url"),
            (disc_arts, "at", "D_search_result_at_handle"),
        ):
            ig = prove_ig(arts, mode)
            if ig:
                strength = label
                break

        email = extract_email(contact_src)
        phone = extract_phone(contact_src)
        first_name = extract_first_name(contact_src, c.get("display_name"))
        followers = extract_followers(ig_arts, ig["value"] if ig else handle)

        # Geo is proven from THIS entity's own pages or its own IG profile.
        # A shared search-results blob holds twenty other businesses, so a city
        # token in it proves nothing about this row — that is how a whole city
        # column silently goes wrong.
        geo = verify_city(c.get("city", ""), contact_src,
                          f"{handle} {c.get('display_name','')}")

        blk = blocked(f"{c.get('display_name','')} {c.get('category','')} "
                      f"{c.get('service_type','')} {''.join(a['content'][:400] for a in owned[:1])}")

        rec = {
            "record_id": rid,
            "audience": c.get("audience"),
            "source": source_label(c),
            "source_raw": c.get("source"),
            "city": c.get("city"),
            "market": c.get("market"),
            "state": c.get("state"),
            "category": c.get("category"),
            "service_type": c.get("service_type"),
            "display_name": c.get("display_name"),
            "first_name": first_name["value"] if first_name else None,
            "first_name_source": first_name["method"] if first_name else None,
            "ig_handle": ig["value"] if ig else None,
            "ig_profile_url": f"https://www.instagram.com/{ig['value']}/" if ig else None,
            "ig_proof_strength": strength,
            # Founder, 2026-08-13: real estate and local businesses are wanted
            # "with and without IG account", so the handle is RECORDED for every
            # audience and REQUIRED only for services. A physical business with
            # no Instagram is still a lead — it just is not a conversion
            # candidate, and the dashboard splits on exactly this field.
            "has_instagram": bool(ig),
            "website_url": c.get("website_url") or None,
            # followers is NULL until an L3 vendor response proves it. Never estimated.
            "followers": followers["value"] if followers else None,
            "followers_status": "VERIFIED_L3" if followers else "PENDING_L3_VENDOR",
            # THE FLOOR IS A VIEW, NOT A GATE (founder, 2026-08-12: "2500 for
            # creators only .. also keep all profiles (we can target them later
            # .. even with smaller follower bases)"). It never appears in
            # gate_failures below, so a small creator is delivered, sorted and
            # targeted later — never deleted. It does not apply to services at
            # all: a groomer's Instagram is a shopfront, not a media channel.
            "follower_tier": follower_tier(c.get("audience"), followers),
            "meets_creator_floor": (
                None if (c.get("audience") != "creator" or not followers)
                else followers["value"] >= CREATOR_FOLLOWER_FLOOR),
            "email": email["value"] if email else None,
            "phone": phone["value"] if phone else None,
            "geo_verified": bool(geo),
            # ---- REVIEW FLAGS: not gates. A flagged row is publishable but is
            # where a human should look first. Both of these caught real defects
            # on the first drop (a Shopify theme vendor's address shipped as a
            # lead; a Connecticut parent-company number filed under Miami).
            "flag_phone_out_of_metro": bool(
                phone and phone["value"][1:4] not in METRO_AREA.get(c.get("city", ""), set())),
            "flag_email_offsite_domain": bool(
                email and site_host
                and email["value"].split("@")[1] not in FREE_MAIL
                and registrable(email["value"].split("@")[1]) != site_host),
            "blocked_term": blk,
            "provenance": {
                "email": email, "phone": phone, "ig_handle": ig, "geo": geo,
                "followers": followers, "first_name": first_name,
            },
            "artifact_count": len(owned) + len(disc_arts),
            "foreign_artifacts_ignored": [a["artifact_id"] for a in foreign],
            "extracted_at": datetime.now(timezone.utc).isoformat(),
        }

        # ---- GATES ----------------------------------------------------------
        fails = []
        if blk:
            fails.append(f"blocked_category:{blk}")
        if not geo:
            fails.append("geo_unverified")
        if not (email or phone):
            fails.append("no_contact")           # R4: without it the lead is useless
        if rec["audience"] == "service" and not ig:
            fails.append("service_without_ig")   # founder rule, 2026-08-12
        # NOTHING IS DROPPED. Founder, 2026-08-13: "don't drop shit without my
        # consent". Every crawled entity is delivered in ONE list with plain
        # labels, and the filtering decision belongs to the founder, not to this
        # file. A gate that deletes rows makes the pipeline look like it found
        # less than it did, and the deletion is invisible in the output.
        rec["gate_failures"] = fails
        rec["contactable"] = bool(email or phone)
        rec["hold_reason"] = REASON_TEXT.get(",".join(fails), ", ".join(fails)) if fails else ""
        rec["status"] = "ready" if not fails else "incomplete"
        records.append(rec)
        if fails:
            rejects.append({**rec, "reason": ",".join(fails)})

    os.makedirs(OUT, exist_ok=True)
    json.dump(records, open(os.path.join(OUT, "records.json"), "w"), indent=2)
    json.dump(rejects, open(os.path.join(OUT, "quarantine.json"), "w"), indent=2)
    json.dump({"bad_artifacts": bad_artifacts, "artifacts_loaded": len(artifacts)},
              open(os.path.join(OUT, "artifact_report.json"), "w"), indent=2)

    print(f"artifacts loaded : {len(artifacts)}  (bad: {len(bad_artifacts)})")
    ready = [r for r in records if r["contactable"]]
    print(f"records TOTAL    : {len(records)}  (nothing dropped)")
    print(f"  contactable    : {len(ready)}   <- email and/or phone")
    print(f"  incomplete     : {len(records) - len(ready)}  (kept, labelled)")
    if rejects:
        from collections import Counter
        cnt = Counter(r.get("reason", "?") for r in rejects)
        for k, v in cnt.most_common():
            print(f"   {v:4d}  {k}")


if __name__ == "__main__":
    main()
