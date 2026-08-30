# confluxcon.com

One file: `index.html`. No build step, no dependencies. Open it in a browser to preview;
upload it anywhere to deploy.

## Editing

Everything you'd want to change is in the marked block at the top of the `<script>`
tag, near the bottom of the file. Five numbered sections:

1. **EVENT_DATE** — the day itself: Tuesday, September 8, 2026.
2. **FORM_URL / RSVP_EMAIL** — where RSVPs go (see below).
3. **ROOMS** — name, capacity, colour bar.
4. **START_HOUR / END_HOUR** — the span of the grid, 24h clock.
5. **SESSIONS** — starts empty; add one object per session.

### Claiming sessions by clicking

Open the site with `?edit` on the end of the URL — `confluxcon.com/?edit`, or
`index.html?edit` locally. The grid becomes clickable:

- Click any empty square to claim it. Room and start time are prefilled from the
  square you clicked; set an end time, title, optional host and capacity.
- Click one of your own sessions to edit it, or **Release** to drop it.
- Overlaps within a room are refused, as are untitled sessions.

Claims are saved in **that browser only** — they are not on the site for anyone
else yet, and they show with a dashed border to mark that. To publish them, hit
**Copy code** and paste the result over the `SESSIONS` block in `index.html`,
then redeploy. After that they render as normal solid sessions for everyone.

Two caveats worth knowing:

- Browsers block local storage on `file://` URLs, so claims won't persist if you
  double-click the file. Run `python3 -m http.server` in this folder and use
  `http://localhost:8000/?edit` instead — or just edit `SESSIONS` by hand.
- A private window, or clearing site data, wipes unpublished claims. Copy the
  code out before you close the tab.

Without `?edit` the schedule is plain read-only, so visitors don't see a grid
that looks clickable but only saves to their own machine.

### Adding a session by hand

    const SESSIONS = [
      { room:"Bayes Ground", start:"18:30", end:"20:30",
        title:"Poker Tournament: Final Table", host:"@jim", cap:7 },
    ];

- `room` must match a `ROOMS` name exactly.
- `start` / `end` are `"HH:MM"`, 24-hour, on the hour or half hour.
- `host` and `cap` are optional.
- Two sessions in the same room shouldn't overlap in time — they'd draw on top
  of each other.

Anything malformed is skipped with a warning in the browser console rather than
breaking the page. While `SESSIONS` is empty the grid still draws, with a note
underneath.

## Hooking up the Google Form

While `FORM_URL` is empty, the RSVP button opens a pre-filled email to
`RSVP_EMAIL` instead. Once the form exists, paste its `/viewform` URL into
`FORM_URL`.

## Odds and ends

- The **Donate** button sits at the end of the Theory of impact panel and points
  at `https://venmo.com/jacobcohen4761` — a plain `<a class="donate">`, not part
  of the config block.
- The **Theory of impact** section is the last one in `<main>`, plain markup.

## Deploying

GitHub Pages, off `main` at the repo root: <https://github.com/ConfluxConflux/confluxcon>.
`git push` and it rebuilds in about a minute. `CNAME` holds the custom domain —
leave it in place, Pages reads it on every build.

DNS lives at Namecheap. The apex needs GitHub's four A records:

    185.199.108.153
    185.199.109.153
    185.199.110.153
    185.199.111.153

and `www` a CNAME to `confluxconflux.github.io`. Once those resolve, turn on
**Enforce HTTPS** in the repo's Pages settings — the certificate can't be issued
before the domain points at GitHub.

---

## Personal invite links

Every guest gets their own URL — `confluxcon.com/?g=328509`. Open it and the site
greets them by name and unlocks a **Your profile** tab. What they write there
lands on the front page under *The room*, for everyone to see.

### The guest list

`guests.csv` is the source of truth. It is **gitignored** — this repo is public,
and the sheet holds your own notes (how you know them, how likely they are to
show). Only name, org and link ever leave your machine.

Column headers are matched loosely, so call them whatever reads well in the
spreadsheet. These all land in the same place:

| Field | Headers that match |
|---|---|
| name | `Name`, `Guest name`, `who` |
| org | `Current organizational affiliation (for your badge)`, `org`, `company`, `lab` |
| link | `Personal website (or another link)`, `link`, `profile`, `url` |
| hash | `Hash`, `id`, `code` |
| how you know them *(private)* | `Where we met`, `how i know them` |
| probability *(private)* | `Your probability of attendance`, `odds`, `likelihood` |
| arrival *(private)* | `Your median arrival time…`, `arrives`, `eta` |
| notes *(private)* | `Notes`, `comments` |
| invited | `Invited`, `sent` — **leave the column out entirely and everyone counts as invited** |

Add any other column you like. It stays private unless the header ends in
`(public)` or starts with `pub_`, in which case it shows on the guest's card —
so `House (public)` puts `House · Andesite` on their card.

**Hashes fill themselves in.** Leave the cell blank; `build.py` derives a stable
six-digit number from the name and writes it back. The same name always produces
the same number, so you never have to keep the hashes anywhere — but if you
rename someone, their link changes.

`guests.example.csv` is a committed sample of the shape.

### Numbers doesn't save back to CSV

Opening `guests.csv` in Numbers makes a *separate* Numbers document. Editing it
and hitting save writes a `.numbers` file; `guests.csv` never changes. That is
Numbers, not a bug here.

So either edit `guests.csv` in a text editor or Google Sheets, or keep the
spreadsheet in Numbers and pull it down when you're done:

    python3 build.py --numbers

That exports the front Numbers document over `guests.csv` (keeping the old one
as `guests.csv.bak`), then rebuilds. Leave the document open in Numbers and run
it whenever you've made changes.

### Building

    python3 build.py             # fill hashes, write data/roster.json, print every link
    python3 build.py --numbers   # pull from Numbers first, then all of the above
    python3 build.py --links     # just the links, to paste into messages
    python3 build.py --report    # private headcount and arrival breakdown — never published
    python3 build.py --pull      # bake submitted profiles into data/profiles.json

`data/roster.json` is committed and world-readable. **The invite list is
therefore public** — anyone can fetch it and see who was invited, and try
another guest's link. For a party that is probably fine; if it isn't, the fix is
to stop committing it and read the roster from the backend instead.

## Profiles

Guests fill in name, org, link, arrival time, a line about themselves, what
they're bringing, how they know you — and vote on whether the thing is called
**confluxcon**, **fluxcon**, or something they suggest. The tally shows under
the form.

Two ways it can work:

**Now, with no setup.** `BACKEND_URL` in `index.html` is empty. Saving a profile
opens the guest's mail app with the answers filled in, and keeps a copy in their
browser so their own card shows on the page. You add them by hand.

**Live.** Deploy `apps-script.gs` as a Google Apps Script web app — the setup
steps are in the top of that file, about five minutes — and paste the `/exec`
URL into `BACKEND_URL`. Profiles then save straight to a Google Sheet and appear
on everyone's front page. Writes are only accepted for hashes that appear in
`roster.json`, so only people you invited can post.

Either way `data/profiles.json` is the fallback the page reads if the backend is
unreachable; `build.py --pull` refreshes it.
