#!/usr/bin/env python3
"""
confluxcon — turn guests.csv into the site's public data.

  python3 build.py             # fill blank hashes, write data/roster.json, print links
  python3 build.py --numbers   # pull the open Numbers document down into guests.csv first
  python3 build.py --links     # just print the invite links
  python3 build.py --report    # private headcount / arrival report (never published)
  python3 build.py --seed      # JSON to paste into the Apps Script backend, once

Numbers never writes back to a .csv — opening one makes a separate Numbers
document, and saving writes a .numbers file. So either edit guests.csv in a
plain text editor or Google Sheets, or keep using Numbers and run --numbers,
which exports the front document back down over guests.csv.

Column headers are matched loosely, so name them however you like in the
spreadsheet — "Where we met" and "how_i_know_them" both land in the same place.
guests.csv is gitignored, because this repo is public. Only name / org / link
and any column marked public ever reach data/roster.json.
"""

import csv, hashlib, json, os, re, sys, urllib.request
from datetime import datetime, timezone

HERE     = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "guests.csv")
DATA_DIR = os.path.join(HERE, "data")
SITE     = "https://confluxcon.com"

# Canonical fields, and the header fragments that map onto them. First match
# wins, so the order here matters — "arrival" is tested before "attend"
# because "median arrival time, conditional on attending" contains both.
ALIASES = [
    ("password",        ("password", "pass", "word", "code")),
    ("invited",         ("invit", "send", "asked")),
    ("name",            ("name", "guest", "who")),
    ("how_i_know_them", ("met", "know", "how i")),
    ("org",             ("affiliation", "org", "company", "lab", "badge", "works")),
    ("median_arrival",  ("arriv", "turn up", "shows up", "eta")),
    ("p_attend",        ("probab", "attend", "likel", "odds", "p(")),
    ("link",            ("website", "link", "profile", "url", "site", "twitter")),
    ("notes",           ("note", "comment")),
]
# Public unless it is one of these. Everything else in the sheet stays local.
PRIVATE_FIELDS = ("how_i_know_them", "p_attend", "median_arrival", "notes", "invited", "password")


# ---------- column matching -------------------------------------------------

def resolve(cols):
    """Map each canonical field onto whichever header the sheet actually uses."""
    field, used = {}, set()
    for canon, frags in ALIASES:
        for c in cols:
            if c in used or not c:
                continue
            low = c.strip().lower()
            if low == canon or any(f in low for f in frags):
                field[canon] = c
                used.add(c)
                break
    return field


def is_public_extra(header):
    """Extra columns are private unless you say otherwise in the header."""
    low = header.strip().lower()
    return low.startswith("pub_") or low.endswith("(public)") or low.endswith("[public]")


def pretty_extra(header):
    return re.sub(r"\s*[\(\[]public[\)\]]\s*$", "", header.strip(), flags=re.I) \
             .replace("pub_", "").replace("_", " ").strip()


# ---------- value helpers ---------------------------------------------------

def norm_link(v):
    v = (v or "").strip()
    if not v:
        return ""
    if not re.match(r"^[a-z][a-z0-9+.-]*://", v, re.I):
        v = "https://" + v
    return v


def truthy(v):
    return (v or "").strip().lower() in ("yes", "y", "true", "1", "x", "✓", "sent")


def pct(v):
    """'70%' / '0.7' / '70' -> 0.70, or None."""
    v = (v or "").strip().rstrip("%").strip()
    if not v:
        return None
    try:
        n = float(v)
    except ValueError:
        return None
    if n > 1:
        n /= 100.0
    return max(0.0, min(1.0, n))


# Words you can say down the phone without spelling them. A password names a
# person, so these must stay unique across the whole guest list.
WORDS = """
neutrality lantern meridian saffron quorum thicket halcyon cobalt ferment alcove
tessera plumbline garnet wick harbour solstice marrow cadence aperture kiln
bellwether cinder driftwood ember fathom girder hearth ingot jetty keystone
lodestar mantle nectar obelisk parapet quiver rampart sextant tallow undertow
vellum wainscot xenon yardarm zenith almanac bramble copse dovetail escarpment
foxglove gantry hollow inkwell juniper knoll limestone millrace nightjar oakum
pergola quarry rookery sandbar tinder umbra verdigris windlass yarrow zephyr
anvil bastion cairn dell estuary fenland grotto heathland isthmus
""".split()


def make_password(name, taken):
    """Stable word for a guest, picked from WORDS and nudged on collision."""
    for salt in range(len(WORDS) * 4):
        seed = f"{name.strip().lower()}#{salt}" if salt else name.strip().lower()
        h = int(hashlib.sha256(seed.encode()).hexdigest(), 16)
        cand = WORDS[h % len(WORDS)]
        if cand not in taken:
            return cand
    raise SystemExit("ran out of unused words — add more to WORDS")


def slugify(name, taken):
    """confluxcon.com/audrey, falling back to the full name on a collision."""
    parts = re.sub(r"[^a-z ]", "", name.lower()).split()
    if not parts:
        return ""
    for cand in (parts[0], "".join(parts)):
        if cand not in taken:
            return cand
    n = 2
    while f"{parts[0]}{n}" in taken:
        n += 1
    return f"{parts[0]}{n}"


# ---------- the sheet -------------------------------------------------------

class Sheet:
    def __init__(self, rows, cols, field):
        self.rows, self.cols, self.field = rows, cols, field

    def get(self, row, canon):
        col = self.field.get(canon)
        return (row.get(col) or "").strip() if col else ""

    def set(self, row, canon, value):
        col = self.field.get(canon)
        if not col:                       # the sheet has no such column yet — add one
            col = canon
            self.field[canon] = col
            if col not in self.cols:
                self.cols.append(col)
        row[col] = value

    def extras(self, row):
        out = {}
        for c in self.cols:
            if not c or c in self.field.values() or not is_public_extra(c):
                continue
            v = (row.get(c) or "").strip()
            if v:
                out[pretty_extra(c)] = v
        return out

    def invited(self, row):
        # No "invited" column at all? Then everyone on the sheet is invited.
        return truthy(self.get(row, "invited")) if "invited" in self.field else True


def load():
    if not os.path.exists(CSV_PATH):
        raise SystemExit(f"no {CSV_PATH} — copy guests.example.csv to guests.csv to start")
    # utf-8-sig: Numbers and Excel both like to leave a byte-order mark
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        rdr = csv.DictReader(f)
        cols = [c for c in (rdr.fieldnames or [])]
        field = resolve(cols)
        namecol = field.get("name")
        if not namecol:
            raise SystemExit(f"  no name column in guests.csv — headers were: {', '.join(cols)}")
        rows = [r for r in rdr if (r.get(namecol) or "").strip()]

    sheet = Sheet(rows, cols, field)
    return sheet


def fill_passwords(sheet):
    taken = {sheet.get(r, "password").lower() for r in sheet.rows if sheet.get(r, "password")}
    added = 0
    for r in sheet.rows:
        if not sheet.get(r, "password"):
            w = make_password(sheet.get(r, "name"), taken)
            sheet.set(r, "password", w)
            taken.add(w)
            added += 1
    if added:
        with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=sheet.cols, extrasaction="ignore")
            w.writeheader()
            for r in sheet.rows:
                w.writerow({c: r.get(c, "") for c in sheet.cols})
        print(f"  wrote {added} new password{'s' if added != 1 else ''} into guests.csv")


# ---------- outputs ---------------------------------------------------------

def build_roster(sheet):
    """Two files. roster.json is public and holds no credentials; secrets.json
    maps password -> slug for the backend, and never leaves this machine."""
    slugs, guests, secrets = set(), {}, {}
    for r in sheet.rows:
        if not sheet.invited(r):
            continue
        name = sheet.get(r, "name")
        slug = slugify(name, slugs)
        slugs.add(slug)
        first, _, last = name.partition(" ")
        guests[slug] = {
            "first":  first,
            "last":   last,
            "met":    sheet.get(r, "how_i_know_them"),
            "org":    sheet.get(r, "org"),
            "link":   norm_link(sheet.get(r, "link")),
            "extras": sheet.extras(r),
        }
        secrets[sheet.get(r, "password").lower()] = slug

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "roster.json"), "w", encoding="utf-8") as f:
        json.dump({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "guests": guests}, f, ensure_ascii=False, indent=1, sort_keys=True)
    with open(os.path.join(DATA_DIR, "secrets.json"), "w", encoding="utf-8") as f:
        json.dump({"passwords": secrets}, f, ensure_ascii=False, indent=1, sort_keys=True)

    dupes = len(guests) - len(set(secrets.values()))
    print(f"  data/roster.json  — {len(guests)} invited guest{'s' if len(guests) != 1 else ''} (public, no passwords)")
    print(f"  data/secrets.json — {len(secrets)} password{'s' if len(secrets) != 1 else ''} (gitignored)")
    if dupes:
        print(f"  !! {dupes} guests share a password — fix guests.csv before sending anything")


def print_links(sheet):
    """The messages you actually send, ready to paste one at a time."""
    invited = [r for r in sheet.rows if sheet.invited(r)]
    if not invited:
        print("\n  nobody marked invited yet")
        return
    w = max(len(sheet.get(r, "name")) for r in invited)
    print(f"\n  {'GUEST'.ljust(w)}  WHAT TO TEXT THEM")
    for r in sorted(invited, key=lambda r: sheet.get(r, "name").lower()):
        print(f"  {sheet.get(r, 'name').ljust(w)}  confluxcon.com — your password is {sheet.get(r, 'password')}")


def report(sheet):
    invited = [r for r in sheet.rows if sheet.invited(r)]
    known = [p for p in (pct(sheet.get(r, "p_attend")) for r in invited) if p is not None]
    print("\n  PRIVATE REPORT — never published")
    print(f"  on the sheet       {len(sheet.rows)}")
    print(f"  invited            {len(invited)}")
    print(f"  expected headcount {sum(known):.1f}"
          f"  (from {len(known)} of {len(invited)} with a probability)")

    def tally(canon, title):
        buckets = {}
        for r in invited:
            buckets.setdefault(sheet.get(r, canon) or "—", []).append(sheet.get(r, "name"))
        if len(buckets) == 1 and "—" in buckets:
            return
        print(f"\n  {title}")
        for k, names in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
            print(f"  {str(len(names)).rjust(3)}  {k.ljust(24)} {', '.join(sorted(names))[:70]}")

    tally("median_arrival", "ARRIVES")
    tally("how_i_know_them", "HOW YOU KNOW THEM")


def pull_profiles():
    """Bake whatever the backend has, so the site still works if it is down."""
    url = ""
    idx = os.path.join(HERE, "index.html")
    if os.path.exists(idx):
        with open(idx, encoding="utf-8") as f:
            m = re.search(r'const\s+BACKEND_URL\s*=\s*"([^"]*)"', f.read())
            if m:
                url = m.group(1)
    if not url:
        print("  --pull skipped: BACKEND_URL is empty in index.html")
        return
    try:
        with urllib.request.urlopen(url + "?action=profiles", timeout=20) as r:
            payload = json.load(r)
    except Exception as e:
        print(f"  --pull failed: {e}")
        return
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "profiles.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1, sort_keys=True)
    n = len(payload.get("profiles", {}))
    print(f"  data/profiles.json — {n} submitted profile{'s' if n != 1 else ''}")


# ---------- seed for the backend --------------------------------------------

def build_seed(sheet):
    """A JSON blob to paste into SEED_JSON in apps-script.gs. Holds passwords,
    so it is written locally and gitignored — never committed."""
    slugs, guests = set(), []
    for r in sorted(sheet.rows, key=lambda r: sheet.get(r, "name").lower()):
        name = sheet.get(r, "name")
        slug = slugify(name, slugs)
        slugs.add(slug)
        first, _, last = name.partition(" ")
        guests.append({
            "slug": slug, "first": first, "last": last,
            "password": sheet.get(r, "password").lower(),
            "admin": slug == "jacob",
            "met": sheet.get(r, "how_i_know_them"),
            "org": sheet.get(r, "org"),
            "link": norm_link(sheet.get(r, "link")),
            "lane": "invited" if sheet.invited(r) else "prospect",
        })
    blob = {"guests": guests,
            "sessions": ["AI Safety Trivia", "Lightning Talks", "Cuddle Puddle"]}
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, "seed.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(blob, f, ensure_ascii=False, indent=1)
    print(f"\n  wrote data/seed.json — {len(guests)} guests, {len(blob['sessions'])} sessions")
    print("  Paste its contents between the backticks of SEED_JSON in")
    print("  apps-script.gs (in the Apps Script editor, not the repo), then run seed().")


# ---------- Numbers ---------------------------------------------------------

NUMBERS_SCRIPT = """
tell application "Numbers"
  if (count of documents) is 0 then error "no document open in Numbers"
  export front document to file (POSIX file "%s") as CSV
end tell
"""


def from_numbers():
    """Export the front Numbers document back down over guests.csv."""
    import shutil, subprocess, tempfile

    tmp = os.path.join(tempfile.mkdtemp(), "guests.csv")
    r = subprocess.run(["osascript", "-e", NUMBERS_SCRIPT % tmp],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("  Numbers export failed: " + (r.stderr.strip() or "unknown error"))

    # A multi-table document exports as a folder of CSVs; take the biggest.
    src = tmp
    if os.path.isdir(tmp):
        found = [os.path.join(tmp, f) for f in os.listdir(tmp) if f.lower().endswith(".csv")]
        if not found:
            raise SystemExit("  Numbers exported nothing that looks like a CSV")
        src = max(found, key=os.path.getsize)

    with open(src, encoding="utf-8-sig") as f:
        head = (f.readline() or "").lower()
    if "name" not in head:
        raise SystemExit(f"  that document has no name column — headers were: {head.strip()[:90]}")

    backed_up = os.path.exists(CSV_PATH)
    if backed_up:
        shutil.copy2(CSV_PATH, CSV_PATH + ".bak")
    shutil.copy2(src, CSV_PATH)
    print("  pulled the front Numbers document into guests.csv"
          + (" (old one kept as guests.csv.bak)" if backed_up else ""))


# ---------- main ------------------------------------------------------------

def main():
    args = set(sys.argv[1:])
    if args & {"--numbers", "--from-numbers"}:
        print()
        from_numbers()

    sheet = load()
    print(f"\nconfluxcon · {len(sheet.rows)} rows in guests.csv")
    unmatched = [c for c in sheet.cols if c and c not in sheet.field.values()]
    if unmatched:
        print("  extra columns: " + ", ".join(
            f"{c}{' (published)' if is_public_extra(c) else ''}" for c in unmatched))
    fill_passwords(sheet)

    if "--seed" in args:
        build_seed(sheet)
        return
    if "--report" in args:
        report(sheet)
        return
    if "--links" in args:
        print_links(sheet)
        return

    build_roster(sheet)
    if "--pull" in args:
        pull_profiles()
    print_links(sheet)
    print()


if __name__ == "__main__":
    main()
