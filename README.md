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

## How it works now

`confluxcon.com` is one page behind one password field. The password *is* the
identity — the word you type decides whose RSVP you land on — so there is
nothing else for a guest to remember. What you text is one line:

    confluxcon.com — your password is neutrality

Signed in, a guest gets two tabs (**Event** and **Profile**); you get a third,
**Console**. Everything anyone types saves itself to a Google Sheet as they go.
There is no submit button anywhere.

### The two things only you can do

**1. Deploy the backend.** `apps-script.gs` has the steps at the top: new Google
Sheet ▸ Extensions ▸ Apps Script ▸ paste ▸ paste the output of
`python3 build.py --seed` into `SEED_JSON` ▸ run `seed()` ▸ Deploy as a web app
("Execute as: Me", "Who has access: Anyone") ▸ copy the `/exec` URL into
`BACKEND_URL` at the top of `index.html`'s script ▸ commit and push.

Until that URL is filled in, the door shows a setup notice instead of the
password field and nobody can sign in.

**2. Fix HTTPS.** DNS now points at GitHub, but `confluxcon.com` still has a
stale Namecheap A record — `162.255.119.130` — alongside the four GitHub ones.
GitHub will not issue a certificate while it is there, so the site is HTTP-only
and browsers warn on the password field. Delete that one A record, leave
`185.199.108–111.153`, wait for the certificate, then tick **Enforce HTTPS** in
the repo's Pages settings.

### After that, the sheet is the database

`guests.csv` and `build.py` are only for seeding and for working offline. Once
the backend is live, edit people in the Console — or in the Google Sheet
directly, which the site reads on every load.

    python3 build.py            # fill blank passwords, rebuild data/, print the texts
    python3 build.py --numbers  # pull the open Numbers document down into guests.csv
    python3 build.py --seed     # the JSON to paste into the backend, once
    python3 build.py --links    # just the messages to send
    python3 build.py --report   # private headcount and arrival breakdown

### Rules the code enforces

- **Passwords are unique.** One names a person, so the backend refuses a word
  another guest already has.
- **Only invited guests can write.** A password not in the sheet is refused.
- **Guests edit only themselves.** The `admin` column marks the one account that
  can edit the roster; everyone else can only save their own row.
- **Nothing public carries a credential.** `data/roster.json` holds no
  passwords; `data/secrets.json` and `data/seed.json` are gitignored.
