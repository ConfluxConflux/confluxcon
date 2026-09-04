/**
 * confluxcon — the backend, on Val Town.
 *
 * SETUP (once, about two minutes)
 *   1. val.town ▸ sign in with GitHub ▸ New ▸ HTTP val.
 *   2. Delete what's there, paste this whole file in. It saves as you type.
 *   3. Copy the val's URL (the .web.val.run one, top right).
 *   4. Hand that URL over; seeding happens over HTTP, no pasting.
 *
 * The database is Val Town's SQLite. Guests are rows; a save writes one row,
 * so two people RSVPing at the same moment can't overwrite each other.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";

/* Bumped whenever this file changes, so a plain GET on the val says which
   version is actually pasted in. */
const BUILD = "2026-09-04 · wall order 2";

/* Stamps older than this were guessed from a last-edit time, not recorded when
   someone actually answered. They are cleared once and never written again. */
const BACKFILL_CUTOFF = "2026-09-04T06:44:21Z";

const G = "confluxcon_guests_v1";
const S = "confluxcon_sessions_v1";
const L = "confluxcon_log_v1";

const GCOLS = ["ord","slug","first","last","password","admin","met","org","lane","tier",
               "going","prob","arrive","link","run","sessions","namevote","note","msg",
               "pay","seen","updated","rsvped"];

const WORDS = ("bellwether cinder driftwood ember fathom girder hearth ingot jetty keystone " +
  "lodestar mantle nectar obelisk parapet quiver rampart sextant tallow undertow vellum " +
  "wainscot xenon yardarm zenith almanac bramble copse dovetail escarpment foxglove gantry " +
  "harrow inglenook kestrel limber mordant nutmeg oriel pallet quarry ridgeline")
  .split(" ");

/* ---------- plumbing ------------------------------------------------------ */

async function init() {
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${G} (
    ord INTEGER, slug TEXT PRIMARY KEY, first TEXT, last TEXT, password TEXT,
    admin TEXT, met TEXT, org TEXT, lane TEXT, tier TEXT, going TEXT, prob TEXT,
    arrive TEXT, link TEXT, run TEXT, sessions TEXT, namevote TEXT,
    note TEXT, msg TEXT, pay TEXT, seen TEXT, updated TEXT)`);
  // Older tables predate these columns; adding one that exists throws, harmlessly.
  for (const col of ["tier", "note", "msg", "pay", "rsvped"]) {
    try { await sqlite.execute(`ALTER TABLE ${G} ADD COLUMN ${col} TEXT`); } catch (_) {}
  }
  /* "rsvped" is when someone first answered, which is the order the guest wall
     reads in. Nobody who answered before the column existed has one, and the
     wall shows those people first, in the order the console lists them — a
     last-edit time was tried and it put people in the wrong order. Anything
     stamped before this build is one of those guesses, so it goes. */
  try {
    await sqlite.execute({
      sql: `UPDATE ${G} SET rsvped = '' WHERE rsvped <> '' AND rsvped < ?`,
      args: [BACKFILL_CUTOFF],
    });
  } catch (_) {}
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${S} (
    name TEXT PRIMARY KEY, by TEXT, host TEXT, descr TEXT, sched TEXT)`);
  // Same story as the guest table: older session tables predate these two.
  // "descr", not "desc" — DESC is a keyword SQLite won't take bare.
  for (const col of ["descr", "sched"]) {
    try { await sqlite.execute(`ALTER TABLE ${S} ADD COLUMN ${col} TEXT`); } catch (_) {}
  }
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${L} (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, who TEXT, what TEXT)`);
}

/* ---------- the log -------------------------------------------------------
   Every write leaves one line behind, so the console can show what everyone
   has been doing. Read by the admin only; nothing here is shown to guests. */

const full = (g: any) => `${g.first || ""} ${g.last || ""}`.trim() || g.slug;

async function log(who: string, what: string) {
  if (!what) return;
  try {
    await sqlite.execute({
      sql: `INSERT INTO ${L} (at, who, what) VALUES (?, ?, ?)`,
      args: [new Date().toISOString(), clean(who, 60), clean(what, 400)],
    });
  } catch (_) { /* a log that fails must never fail the write it describes */ }
}

const VISIT = "opened the site";

/** Opening the site writes one line, not one per refresh. */
async function logVisit(who: string) {
  try {
    const res = await sqlite.execute({
      sql: `SELECT at, what FROM ${L} WHERE who = ? ORDER BY id DESC LIMIT 1`,
      args: [clean(who, 60)],
    });
    const last: any = (res.rows as any[][])[0];
    if (last && String(last[1]) === VISIT &&
        Date.now() - Date.parse(String(last[0])) < 30 * 60 * 1000) return;
  } catch (_) {}
  await log(who, VISIT);
}

/** Values go in the log short, whatever their length in the sheet. */
const brief = (v: any) => {
  const t = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return !t ? "\u2014" : t.length > 44 ? t.slice(0, 43) + "\u2026" : t;
};

function objs(res: any) {
  const cols = res.columns as string[];
  return (res.rows as any[][]).map(r => {
    const o: any = {};
    cols.forEach((c, i) => { o[c] = r[i] === null ? "" : r[i]; });
    return o;
  });
}

const guests = async () => objs(await sqlite.execute(`SELECT * FROM ${G} ORDER BY ord`));
const sessions = async () => objs(await sqlite.execute(`SELECT * FROM ${S} ORDER BY rowid`));

async function setField(slug: string, col: string, value: any) {
  if (!GCOLS.includes(col)) return;
  await sqlite.execute({ sql: `UPDATE ${G} SET ${col} = ? WHERE slug = ?`, args: [value, slug] });
}

const clean = (v: any, max = 300) =>
  String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);

/** Digits and one point, for a dollar figure. */
const money = (v: any) => {
  const t = String(v == null ? "" : v).replace(/[^0-9.]/g, "").slice(0, 9);
  return t === "" || isNaN(Number(t)) ? "" : String(Math.max(0, Number(t)));
};

/** Same as clean, but a message to the host is allowed its paragraphs. */
const cleanLines = (v: any, max = 2000) =>
  String(v == null ? "" : v).replace(/\r/g, "").replace(/\t/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, max);

const num = (v: any) => {
  if (v === "" || v == null) return "";
  const n = Math.round(Number(v));
  return isNaN(n) ? "" : String(Math.max(0, Math.min(100, n)));
};

const isYes = (v: any) => v === true || v === "yes";

/* ---------- shaping ------------------------------------------------------- */

function parseSessions(v: any) {
  try { return JSON.parse(v || "{}") || {}; } catch { return {}; }
}

/** What every signed-in guest may see about everyone else. No passwords. */
function publicCard(g: any) {
  return {
    slug: g.slug, first: g.first, last: g.last,
    met: g.met, org: g.org, link: g.link,
    going: g.going, prob: g.prob === "" ? null : Number(g.prob),
    run: g.run, sessions: parseSessions(g.sessions),
    namevote: g.namevote || "",
    note: g.note || "",
    rsvped: g.rsvped || "",
    seen: isYes(g.seen),
  };
}

/** Everything, for the one admin. */
function adminRow(g: any) {
  const c: any = publicCard(g);
  c.password = g.password;
  c.lane = g.lane || "invited";
  c.tier = g.tier == null ? "" : String(g.tier);
  c.msg = g.msg || "";                 // never leaves adminRow
  c.pay = g.pay || "";                 // nor does this
  c.arrive = g.arrive;
  c.order = Number(g.ord) || 0;
  c.admin = isYes(g.admin);
  return c;
}

async function payload(me: any, all: any[], isAdmin: boolean) {
  /* Whoever put a session up may rewrite its details, and so may the host —
     which is what lets Jacob edit the four that were seeded with no owner. */
  const owns = (s: any) => isAdmin || (!!s.by && String(s.by) === String(me.first));
  const sess = (await sessions()).map(s => ({
    name: s.name, by: s.by, host: isYes(s.host),
    descr: s.descr || "",                       // shown to everyone
    sched: owns(s) ? (s.sched || "") : "",      // only to whoever runs it
    mine: owns(s),
  }));
  const out: any = {
    ok: true,
    slug: me.slug,
    admin: isAdmin,
    me: adminRow(me),
    sessions: sess,
    guests: all.filter(g => (g.lane || "invited") === "invited").map(publicCard),
  };
  if (isAdmin) {
    out.roster = [...all].sort((a, b) => (Number(a.ord) || 0) - (Number(b.ord) || 0)).map(adminRow);
  }
  return out;
}

const byPassword = (all: any[], pw: any) => {
  const p = String(pw || "").trim().toLowerCase();
  if (!p) return null;
  return all.find(g => String(g.password || "").trim().toLowerCase() === p) || null;
};

/* ---------- entry point --------------------------------------------------- */

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (o: any) => new Response(JSON.stringify(o), { headers: HEADERS });

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: HEADERS });
  await init();

  if (req.method !== "POST") return json({ ok: true, hello: "confluxcon", build: BUILD });

  let body: any = {};
  try { body = JSON.parse(await req.text() || "{}"); } catch { return json({ ok: false, error: "bad_json" }); }

  let all = await guests();

  /* Seeding. Open only while the table is empty; after that it takes the admin
     password and an explicit force, because it drops everything. */
  if (body.action === "seed") {
    const data = body.data || {};
    if (!data.guests?.length) return json({ ok: false, error: "no_guests" });
    if (all.length) {
      const who = byPassword(all, body.password);
      if (!who || !isYes(who.admin) || body.force !== true) {
        return json({ ok: false, error: "already_seeded" });
      }
    }
    await sqlite.execute(`DELETE FROM ${G}`);
    await sqlite.execute(`DELETE FROM ${S}`);
    for (const [i, g] of data.guests.entries()) {
      await sqlite.execute({
        sql: `INSERT INTO ${G} (ord,slug,first,last,password,admin,met,org,lane,tier,
              going,prob,arrive,link,run,sessions,namevote,note,msg,pay,seen,updated)
              VALUES (?,?,?,?,?,?,?,?,?,?,'','','',?,'','{}','','','','','','')`,
        args: [i + 1, g.slug, g.first, g.last, g.password, g.admin ? "yes" : "",
               g.met || "", g.org || "", g.lane || "invited",
               String(g.tier ?? ""), g.link || ""],
      });
    }
    for (const n of (data.sessions || [])) {
      await sqlite.execute({ sql: `INSERT OR IGNORE INTO ${S} (name,by,host) VALUES (?,'','')`, args: [n] });
    }
    return json({ ok: true, seeded: data.guests.length, sessions: (data.sessions || []).length });
  }

  const me0 = byPassword(all, body.password);
  if (!me0) return json({ ok: false, error: "bad_password" });
  const isAdmin = isYes(me0.admin);
  const slug = me0.slug;

  const reread = async () => {
    all = await guests();
    return all.find(g => g.slug === slug);
  };

  switch (body.action) {
    case "auth":
      await logVisit(full(me0));
      return json(await payload(me0, all, isAdmin));

    /* a guest editing their own RSVP */
    case "save": {
      const p = body.patch || {};
      const fields: Record<string, any> = {
        first: clean(p.first, 40), last: clean(p.last, 40),
        met: clean(p.met, 60), org: clean(p.org, 60),
        arrive: clean(p.arrive, 40), link: clean(p.link, 200),
        going: ["yes", "likely", "maybe", "no", ""].includes(p.going) ? p.going : me0.going,
        prob: num(p.prob),
        namevote: ["confluxcon", "fluxcon", ""].includes(p.namevote) ? p.namevote : me0.namevote,
        note: clean(p.note, 140),
        msg: cleanLines(p.msg, 2000),
        pay: money(p.pay),
      };
      const LABEL: Record<string, string> = {
        first: "first name", last: "last name", met: "how they know Jacob",
        org: "affiliation", arrive: "arrival", link: "link", going: "answer",
        prob: "probability", namevote: "name vote", note: "public comment",
        msg: "private note", pay: "willingness to pay",
      };
      const changed: string[] = [];
      for (const k in fields) {
        if (String(me0[k] ?? "") === String(fields[k] ?? "")) continue;
        changed.push(`${LABEL[k] || k}: ${brief(me0[k])} \u2192 ${brief(fields[k])}`);
      }
      for (const k in fields) await setField(slug, k, fields[k]);
      if (p.sessions) {
        const was = parseSessions(me0.sessions);
        for (const k of new Set([...Object.keys(was), ...Object.keys(p.sessions)])) {
          if (String(was[k] || "") === String(p.sessions[k] || "")) continue;
          changed.push(`${brief(k)}: ${brief(was[k])} \u2192 ${brief(p.sessions[k])}`);
        }
        await setField(slug, "sessions", JSON.stringify(p.sessions).slice(0, 4000));
      }
      await log(full(me0), changed.join("; "));
      await setField(slug, "seen", "yes");
      const now = new Date().toISOString();
      /* Stamped only as an answer first appears — going from nothing to
         something — never when an existing one is edited. Everyone who
         answered before the column existed stays unstamped for good, which is
         what keeps them in the console's order instead of leaping to the end
         the next time they touch their RSVP. */
      if (fields.going && !String(me0.going || "") && !String(me0.rsvped || "")) {
        await setField(slug, "rsvped", now);
      }
      await setField(slug, "updated", now);
      const me = await reread();
      return json(await payload(me, all, isAdmin));
    }

    /* proposing a session — it joins the one shared list */
    case "addSession": {
      const name = clean(body.name, 60);
      if (!name) return json({ ok: false, error: "no_name" });
      const existing = await sessions();
      if (!existing.some(s => String(s.name).toLowerCase() === name.toLowerCase())) {
        await sqlite.execute({
          sql: `INSERT OR IGNORE INTO ${S} (name,by,host,descr,sched) VALUES (?,?,?,?,?)`,
          args: [name, me0.first, body.host ? "yes" : "",
                 cleanLines(body.descr, 600), cleanLines(body.sched, 600)],
        });
        await log(full(me0), `added the activity \u201c${name}\u201d${body.host ? ", and will run it" : ""}`);
      }
      return json(await payload(me0, all, isAdmin));
    }

    /* the blurb and the scheduling notes, after the fact */
    case "editSession": {
      const target = clean(body.name, 60).toLowerCase();
      const list = await sessions();
      const row = list.find(s => String(s.name).toLowerCase() === target);
      if (!row) return json({ ok: false, error: "no_session" });
      const owns = isAdmin || (!!row.by && String(row.by) === String(me0.first));
      if (!owns) return json({ ok: false, error: "not_yours" });
      for (const col of ["descr", "sched"]) {
        if (!(col in body)) continue;
        const value = cleanLines(body[col], 600);
        if (value === String(row[col] || "")) continue;
        await sqlite.execute({
          sql: `UPDATE ${S} SET ${col} = ? WHERE name = ?`,
          args: [value, row.name],
        });
        await log(full(me0), `${col === "descr" ? "description" : "scheduling notes"} for ` +
          `\u201c${row.name}\u201d: ${brief(row[col])} \u2192 ${brief(value)}`);
      }
      return json(await payload(me0, all, isAdmin));
    }

    case "dropSession": {
      const target = clean(body.name, 60).toLowerCase();
      const list = await sessions();
      const row = list.find(s => String(s.name).toLowerCase() === target);
      if (row && (String(row.by || "") === String(me0.first) || isAdmin)) {
        await sqlite.execute({ sql: `DELETE FROM ${S} WHERE name = ?`, args: [row.name] });
        await log(full(me0), `removed the activity \u201c${row.name}\u201d`);
      }
      return json(await payload(me0, all, isAdmin));
    }

    /* everything below here is Jacob only */
    case "admin": {
      if (!isAdmin) return json({ ok: false, error: "not_admin" });

      if (body.op === "set") {
        const g = all.find(x => x.slug === body.slug);
        if (!g) return json({ ok: false, error: "no_guest" });
        let field = body.field === "pw" ? "password" : body.field;
        const allowed = ["first","last","password","met","org","lane","tier","going",
                         "prob","arrive","link","run","namevote","note","msg","pay"];
        if (!allowed.includes(field)) return json({ ok: false, error: "bad_field" });

        // A password names a person, so two guests may never share one.
        if (field === "password") {
          const want = clean(body.value, 60).toLowerCase();
          if (!want) return json({ ok: false, error: "password_empty" });
          if (all.some(x => x.slug !== g.slug &&
              String(x.password || "").trim().toLowerCase() === want)) {
            return json({ ok: false, error: "password_taken" });
          }
        }
        // The console edits the long fields in a wrapping box now, so a note to
        // the host must not be flattened to one 200-character line on the way in.
        const value = field === "prob" ? num(body.value)
                    : field === "msg"  ? cleanLines(body.value, 2000)
                    : clean(body.value, 200);
        if (value !== String(g[field] ?? "")) {
          await setField(g.slug, field, value);
          await log(full(me0), `set ${field} for ${full(g)}: ${brief(g[field])} \u2192 ${brief(value)}`);
        }
      }

      if (body.op === "add") {
        const nm = clean(body.name, 80);
        if (!nm) return json({ ok: false, error: "no_name" });
        const parts = nm.split(/\s+/);
        const taken = new Set(all.map(x => x.slug));
        const pwTaken = new Set(all.map(x => String(x.password).toLowerCase()));
        const maxOrder = all.reduce((m, x) => Math.max(m, Number(x.ord) || 0), 0);
        let s = parts[0].toLowerCase().replace(/[^a-z]/g, "");
        if (taken.has(s)) s = nm.toLowerCase().replace(/[^a-z]+/g, "");
        let n = 2;
        while (taken.has(s)) s = parts[0].toLowerCase().replace(/[^a-z]/g, "") + n++;
        const pw = WORDS.find(w => !pwTaken.has(w)) || "spare" + (all.length + 1);
        await sqlite.execute({
          sql: `INSERT INTO ${G} (ord,slug,first,last,password,admin,met,org,lane,tier,
                going,prob,arrive,link,run,sessions,namevote,note,msg,pay,seen,updated)
                VALUES (?,?,?,?,?,'',?,?,'prospect',?,'','','','','{}','','','','','','')`,
          args: [maxOrder + 1, s, parts[0], parts.slice(1).join(" "), pw,
                 clean(body.met, 60), clean(body.org, 60), clean(body.tier, 4)],
        });
        await log(full(me0), `added ${nm} to the maybe pile`);
      }

      if (body.op === "remove") {
        const g = all.find(x => x.slug === body.slug);
        if (!g) return json({ ok: false, error: "no_guest" });
        if (g.slug === slug) return json({ ok: false, error: "cannot_remove_self" });
        if (isYes(g.admin)) return json({ ok: false, error: "cannot_remove_admin" });
        await sqlite.execute({ sql: `DELETE FROM ${G} WHERE slug = ?`, args: [g.slug] });
        await log(full(me0), `removed ${full(g)} from the list`);
      }

      if (body.op === "move") {
        const lane = all.filter(x => (x.lane || "invited") === body.lane)
                        .sort((a, b) => (Number(a.ord) || 0) - (Number(b.ord) || 0));
        const at = lane.findIndex(x => x.slug === body.slug);
        const to = body.dir === "up" ? at - 1 : at + 1;
        if (at >= 0 && to >= 0 && to < lane.length) {
          const a = lane[at], b = lane[to];
          await setField(a.slug, "ord", Number(b.ord) || 0);
          await setField(b.slug, "ord", Number(a.ord) || 0);
          await log(full(me0), `moved ${full(a)} ${body.dir === "up" ? "up" : "down"} the list`);
        }
      }

      const me = await reread();
      return json(await payload(me, all, isAdmin));
    }

    /* what everyone has been doing — the console's live log */
    case "log": {
      if (!isAdmin) return json({ ok: false, error: "not_admin" });
      const res = await sqlite.execute(
        `SELECT id, at, who, what FROM ${L} ORDER BY id DESC LIMIT 200`);
      return json({ ok: true, log: objs(res) });
    }
  }

  return json({ ok: false, error: "unknown_action" });
}
