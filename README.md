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

Static, so anything works — Cloudflare Pages, Netlify drop, GitHub Pages, S3.
Point `confluxcon.com` at whichever you pick.
