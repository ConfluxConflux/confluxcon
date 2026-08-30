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

## Personal invites

Each guest gets a password. They go to `confluxcon.com`, type it, and land on
their own page at `confluxcon.com/<firstname>` — the password *is* the identity,
so there is nothing else to remember. What you text is one line:

    confluxcon.com — your password is neutrality

`python3 build.py --links` prints that line for every invited guest, ready to
paste one at a time.

### The guest list

`guests.csv` is the source of truth and is **gitignored** — this repo is public
and the sheet holds your notes and everybody's password. Headers are matched
loosely, so name the columns whatever reads well:

| Field | Headers that match |
|---|---|
| name | `Name`, `Guest name`, `who` |
| password | `Password`, `pass`, `word`, `code` |
| where we met | `Where we met`, `how i know them` |
| affiliation | `Current affiliation (for their badge)`, `org`, `company`, `lab` |
| invited | `Invited`, `sent` — omit the column and everyone counts as invited |
| probability *(private)* | `Your probability they attend`, `odds` |
| notes *(private)* | `Notes`, `comments` |

Leave a password blank and `build.py` picks an unused word from `WORDS` and
writes it back. **Passwords must be unique** — one names a person, so a
duplicate would log someone into the wrong RSVP; the build refuses to stay quiet
about a clash.

Numbers can't save back to a `.csv`, so edit it there and run
`python3 build.py --numbers` to pull the front document down over it.

### What gets built

    data/roster.json    public  — slug, name, badge fields. No passwords, ever.
    data/secrets.json   local   — password -> slug, gitignored

Because auth is a password check, it cannot happen in a page served off GitHub
Pages — the check has to live in the backend. `apps-script.gs` is where it goes.

## The guest page

Two tabs behind the password:

**Event** — the party itself: date, Lighthaven with a maps link, what's planned
so far, a *Who's coming* grid that fills itself in from people's answers, and
the theory of impact.

**Profile** — their badge at the top (first name bold, last italic, where you
met • where they are now, all editable), then: are you coming, on a four-point
scale wired to a probability slider; median time of arrival; which sessions they
want to attend; anything they'd run. Everything optional, everything autosaving.
No submit button, so there is never a half-finished form to agonise over.
