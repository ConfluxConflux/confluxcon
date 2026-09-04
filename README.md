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

and `www` a CNAME to `confluxconflux.github.io`, and nothing else on the apex.
Once those resolve, turn on **Enforce HTTPS** in the repo's Pages settings — the
certificate can't be issued before the domain points at GitHub, and won't issue
at all if any other record answers for the apex.

---

## How it works now

`confluxcon.com` is one page behind one password field. The password *is* the
identity — the word you type decides whose RSVP you land on — so there is
nothing else for a guest to remember. What you text is one line:

    confluxcon.com — your password is neutrality

Signed in, a guest gets two tabs (**Event** and **Profile**); you get a third,
**Console**. Everything anyone types saves itself to the backend as they go.
There is no submit button anywhere.

### The backend

`backend.ts` runs on [Val Town](https://val.town): sign in with GitHub, New ▸
HTTP val, paste the file, copy the val's URL. Then load the guest list into it,
once:

    python3 build.py --seed https://<your-val>.web.val.run

Seeding is self-locking — it works while the table is empty, and afterwards
demands the admin password and an explicit `force`, so a stray request can't
wipe live RSVPs.

Put that same URL in `BACKEND_URL` at the top of `index.html`'s script, then
commit and push. Until it is filled in, the door shows a setup notice instead
of the password field and nobody can sign in.

It used to run on Google Apps Script. That died on Google's Advanced Protection
Program, which blocks unverified apps — including your own — from touching your
account, with no way through short of OAuth review. Val Town needs no consent
screen at all.

### HTTPS

The apex used to carry a stale Namecheap **URL Redirect Record** — an apex-to-www
forward, served from `162.255.119.130` — alongside GitHub's four A records.
GitHub will not issue a certificate while a fifth address answers for the apex.
It was deleted on 2026-09-02 and DNS is clean. If the certificate has still not
issued, clear the custom domain in the repo's Pages settings and re-enter it to
force a retry, then tick **Enforce HTTPS**.

Note that a URL Redirect Record hides behind **SHOW MORE** in Namecheap's host
records table, and is not listed as an A record even though it publishes one.

### After that, the backend is the database

`guests.csv` and `build.py` are only for seeding and for working offline. Once
the backend is live, add and edit people in the **Console** tab — a new guest
gets a slug and an unused password word, and can sign in immediately. Nothing
needs a redeploy, and `--seed` must never run again.

    python3 build.py            # fill blank passwords, rebuild data/, print the texts
    python3 build.py --numbers  # pull the open Numbers document down into guests.csv
    python3 build.py --seed URL # load the guest list into the backend, once
    python3 build.py --links    # just the messages to send
    python3 build.py --report   # private headcount and arrival breakdown

`guests.csv` goes stale the moment you add someone in the Console, so `--links`
only knows the people it seeded. Read a later guest's password off the Console.

**Download CSV**, above the table, writes the whole roster — both lanes, every
column, under whatever you've renamed the headers to — straight from what the
table is showing. That is the way to get a spreadsheet out once the backend is
the database; `guests.csv` is not it.

### The wordmark is the vote

The header mark plays once per visit: a `con` leaps off the front of *conflux*
and lands italic on the end — `flux` never moves. The `con` it left behind then
flickers down to whatever share of the vote still wants **confluxcon** over
**fluxcon**, floored at 0.12 so a trace always remains. Everyone picks fluxcon
and it fades until the mark reads *fluxcon* by itself. Hovering it says who's
winning. Guests vote on their Profile; you can override anyone in the Console's
Name column.

With no votes cast the incumbent stands at full strength. The reading is
independent of the animation, so it still paints correctly under
reduced-motion, or if the mark ever wraps.

### Rules the code enforces

- **Passwords are unique.** One names a person, so the backend refuses a word
  another guest already has.
- **Only invited guests can write.** A password not in the sheet is refused.
- **Guests edit only themselves.** The `admin` column marks the one account that
  can edit the roster; everyone else can only save their own row.
- **Nothing public carries a credential.** `data/roster.json` holds no
  passwords; `data/secrets.json` and `data/seed.json` are gitignored.
