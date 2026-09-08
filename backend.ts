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
const BUILD = "2026-09-08 · trivia";

/* Stamps older than this were guessed from a last-edit time, not recorded when
   someone actually answered. They are cleared once and never written again. */
const BACKFILL_CUTOFF = "2026-09-04T06:44:21Z";

const G = "confluxcon_guests_v1";
const S = "confluxcon_sessions_v1";
const L = "confluxcon_log_v1";

/* trivia: a key/value state doc, the teams, the questions, the answers */
const T  = "confluxcon_trivia_v1";
const TT = "confluxcon_teams_v1";
const TQ = "confluxcon_tquestions_v1";
const TA = "confluxcon_tanswers_v1";

const GCOLS = ["ord","slug","first","last","password","admin","met","org","lane","tier",
               "going","prob","arrive","link","run","sessions","namevote","note","msg",
               "pay","seen","updated","rsvped","diet","team"];

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
  for (const col of ["tier", "note", "msg", "pay", "rsvped", "diet", "team"]) {
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

  /* Trivia. The state doc is key/value so one setting can be written without
     reading the rest back first. Everything else is a plain row per thing. */
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${T} (k TEXT PRIMARY KEY, v TEXT)`);
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${TT} (
    id TEXT PRIMARY KEY, name TEXT, captain TEXT, created TEXT)`);
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${TQ} (
    id TEXT PRIMARY KEY, rnd INTEGER, ord INTEGER, prompt TEXT, answer TEXT,
    points TEXT, state TEXT, note TEXT)`);
  /* One answer per team per question — the id is both together, so a second
     member of the same team overwrites rather than adding a second row. */
  await sqlite.execute(`CREATE TABLE IF NOT EXISTS ${TA} (
    id TEXT PRIMARY KEY, qid TEXT, team TEXT, text TEXT, by TEXT, at TEXT, mark TEXT)`);
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
    /* The board hides an answer from someone who turns up after the thing has
       finished, so every browser needs the arrival time to do that sum. */
    arrive: g.arrive || "",
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
  c.diet = g.diet || "";               // nor does this
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
  /* Two values, so the browser knows whether to draw the trivia tab at all
     before it has polled for anything. */
  const st = await tstate();
  out.trivia = { phase: st.phase, visible: canSeeTrivia(st, me), title: st.title };
  return out;
}

const byPassword = (all: any[], pw: any) => {
  const p = String(pw || "").trim().toLowerCase();
  if (!p) return null;
  return all.find(g => String(g.password || "").trim().toLowerCase() === p) || null;
};


/* ---------- trivia --------------------------------------------------------
   A question, a team, a typed answer, right or wrong, one point unless said
   otherwise. Questions sit in numbered rounds; the host opens one at a time
   and closes it when the room has had long enough. Closing is what puts the
   points on the board, so nothing scores until the host says it does. */

const TSTATE_DEFAULTS: Record<string, string> = {
  phase: "off",      // off | teams | play | done
  visible: "",       // "yes" once every guest may see the tab
  preview: "",       // slugs who may see it before that — for trying it out
  active: "",        // the question currently taking answers
  last: "",          // the one most recently closed, for the reveal
  title: "AI safety trivia",
};

async function tstate() {
  const rows = objs(await sqlite.execute(`SELECT k, v FROM ${T}`));
  const o: Record<string, string> = { ...TSTATE_DEFAULTS };
  for (const r of rows) o[String(r.k)] = String(r.v ?? "");
  return o;
}

async function tset(k: string, v: any) {
  await sqlite.execute({
    sql: `INSERT INTO ${T} (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    args: [k, clean(v, 300)],
  });
}

const teamsAll = async () => objs(await sqlite.execute(`SELECT * FROM ${TT} ORDER BY created`));
const questAll = async () => objs(await sqlite.execute(`SELECT * FROM ${TQ} ORDER BY rnd, ord`));
const answAll  = async () => objs(await sqlite.execute(`SELECT * FROM ${TA}`));

/* An id nobody has to type, short enough to read in a log line. */
const newId = (p: string) =>
  p + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5);

/* Marking is generous about the things that are never the point: case,
   punctuation, accents, leading articles, doubled spaces. It is strict about
   everything else — the host has the last word on anything it gets wrong. */
const tnorm = (v: any) =>
  String(v == null ? "" : v)
    .toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|a|an|of)\b/g, " ")
    .replace(/\s+/g, " ").trim();

/** Everything the key will take, one per line or split on a pipe. */
const accepted = (q: any) =>
  String(q?.answer || "").split(/[\n|]+/).map(tnorm).filter(Boolean);

/** Right or wrong: the host's mark if there is one, otherwise the key. */
function correct(q: any, a: any) {
  if (!a) return false;
  if (a.mark === "yes") return true;
  if (a.mark === "no") return false;
  const t = tnorm(a.text);
  return !!t && accepted(q).includes(t);
}

const points = (q: any) => {
  const n = Number(q?.points);
  return isNaN(n) || n <= 0 ? 1 : Math.min(99, Math.round(n));
};

/** Round names live in the state doc under rnd:1, rnd:2, … */
function roundsOf(st: Record<string, string>, qs: any[]) {
  const ns = new Set<number>();
  for (const k in st) if (/^rnd:\d+$/.test(k)) ns.add(Number(k.slice(4)));
  for (const q of qs) ns.add(Number(q.rnd) || 1);
  if (!ns.size) ns.add(1);
  return [...ns].sort((a, b) => a - b)
    .map(n => ({ n, name: st["rnd:" + n] || `Round ${n}` }));
}

/** A question as a guest may see it — no key until the question is closed. */
function askCard(q: any, reveal: boolean) {
  return {
    id: q.id, rnd: Number(q.rnd) || 1, ord: Number(q.ord) || 0,
    prompt: q.prompt || "", points: points(q), state: q.state || "todo",
    answer: reveal ? (q.answer || "") : "",
    note: reveal ? (q.note || "") : "",
  };
}

/* Who may see the tab at all: everyone once it is switched on, and before
   that only the accounts named for a preview. */
const previewers = (st: Record<string, string>) =>
  new Set(String(st.preview || "").split(",").map(x => x.trim()).filter(Boolean));

const canSeeTrivia = (st: Record<string, string>, me: any) =>
  isYes(me?.admin) || st.visible === "yes" || previewers(st).has(String(me?.slug || ""));

async function triviaPayload(me: any, isAdmin: boolean) {
  const st = await tstate();
  const teams = await teamsAll();
  const qs = await questAll();
  const ans = await answAll();
  const all = await guests();

  const byQ: Record<string, any[]> = {};
  for (const a of ans) (byQ[String(a.qid)] ||= []).push(a);
  const answerFor = (qid: string, team: string) =>
    (byQ[qid] || []).find(a => String(a.team) === String(team));

  /* Only closed questions count, which is what makes "close it" the host's
     scoring gesture rather than a separate step to forget. */
  const scored = qs.filter(q => q.state === "done");
  const table = teams.map(t => {
    let score = 0, right = 0;
    for (const q of scored) {
      if (correct(q, answerFor(String(q.id), String(t.id)))) { score += points(q); right++; }
    }
    const members = all.filter(g => String(g.team || "") === String(t.id));
    return {
      id: t.id, name: t.name || "Unnamed team", captain: t.captain || "",
      members: members.map(g => ({ slug: g.slug, name: full(g) })),
      score, right, of: scored.length,
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const mine = String(me?.team || "");
  const active = qs.find(q => String(q.id) === st.active && q.state === "open") || null;

  const out: any = {
    ok: true,
    trivia: {
      phase: st.phase,
      /* What this viewer may see, which is not the same as the switch. */
      visible: canSeeTrivia(st, me),
      live: st.visible === "yes",
      title: st.title,
      rounds: roundsOf(st, qs),
      teams: table,
      team: mine,
      /* Guests get the open question with the key withheld, plus whatever
         their team has typed so far — every member sees the same box. */
      active: active ? askCard(active, false) : null,
      answer: active && mine
        ? (a => a ? { text: a.text || "", by: a.by || "", at: a.at || "" } : null)(
            answerFor(String(active.id), mine))
        : null,
      /* The one most recently closed, so the room can see what it should have
         said. Recorded when it closes, because the host does not always work
         straight down the list. */
      last: (r => r ? {
        ...askCard(r, true),
        rows: teams.map(t => {
          const a = answerFor(String(r.id), String(t.id));
          return { team: t.id, text: a?.text || "", right: correct(r, a) };
        }),
      } : null)(scored.find(q => String(q.id) === st.last) || [...scored].pop()),
    },
  };

  if (isAdmin) {
    out.trivia.questions = qs.map(q => ({
      ...askCard(q, true),
      answers: teams.map(t => {
        const a = answerFor(String(q.id), String(t.id));
        return {
          team: t.id, text: a?.text || "", by: a?.by || "",
          mark: a?.mark || "", right: correct(q, a), has: !!a,
        };
      }),
    }));
    out.trivia.preview = [...previewers(st)]
      .map(sl => { const g = all.find(x => x.slug === sl); return g ? { slug: sl, name: full(g) } : null; })
      .filter(Boolean);
    out.trivia.roster = all
      .filter(g => (g.lane || "invited") === "invited" || (g.lane || "") === "prospect")
      .map(g => ({ slug: g.slug, name: full(g), lane: g.lane || "invited" }));
    out.trivia.unteamed = all
      .filter(g => (g.lane || "invited") === "invited" && !String(g.team || ""))
      .map(g => ({ slug: g.slug, name: full(g) }));
  }
  return out;
}

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
        diet: clean(p.diet, 200),
        msg: cleanLines(p.msg, 2000),
        pay: money(p.pay),
      };
      const LABEL: Record<string, string> = {
        first: "first name", last: "last name", met: "how they know Jacob",
        org: "affiliation", arrive: "arrival", link: "link", going: "answer",
        prob: "probability", namevote: "name vote", note: "public comment",
        diet: "dietary restrictions",
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
                VALUES (?,?,?,?,?,'',?,?,'prospect',?,'','','','','','{}','','','','','','')`,
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


    /* ---------- trivia, for everyone signed in ---------- */

    case "trivia":
      return json(await triviaPayload(me0, isAdmin));

    /* forming teams: start one and name it, or join one that exists */
    case "triviaTeam": {
      const st = await tstate();
      if (st.phase === "off" && !isAdmin) return json({ ok: false, error: "not_open" });
      const list = await teamsAll();
      const op = body.op;

      if (op === "create") {
        const name = clean(body.name, 40);
        if (!name) return json({ ok: false, error: "no_name" });
        if (list.some(t => tnorm(t.name) === tnorm(name))) {
          return json({ ok: false, error: "name_taken" });
        }
        if (list.length >= 20) return json({ ok: false, error: "too_many_teams" });
        const id = newId("t");
        await sqlite.execute({
          sql: `INSERT INTO ${TT} (id, name, captain, created) VALUES (?, ?, ?, ?)`,
          args: [id, name, slug, new Date().toISOString()],
        });
        await setField(slug, "team", id);
        await log(full(me0), `started the trivia team “${name}”`);
      }

      if (op === "join") {
        const t = list.find(x => String(x.id) === String(body.id));
        if (!t) return json({ ok: false, error: "no_team" });
        await setField(slug, "team", t.id);
        await log(full(me0), `joined the trivia team “${t.name}”`);
      }

      if (op === "leave") {
        const t = list.find(x => String(x.id) === String(me0.team || ""));
        await setField(slug, "team", "");
        if (t) await log(full(me0), `left the trivia team “${t.name}”`);
      }

      /* The captain owns the name. The host can fix any of them. */
      if (op === "rename") {
        const t = list.find(x => String(x.id) === String(body.id || me0.team || ""));
        if (!t) return json({ ok: false, error: "no_team" });
        if (!isAdmin && String(t.captain) !== slug) return json({ ok: false, error: "not_captain" });
        const name = clean(body.name, 40);
        if (!name) return json({ ok: false, error: "no_name" });
        if (list.some(x => x.id !== t.id && tnorm(x.name) === tnorm(name))) {
          return json({ ok: false, error: "name_taken" });
        }
        await sqlite.execute({ sql: `UPDATE ${TT} SET name = ? WHERE id = ?`, args: [name, t.id] });
        await log(full(me0), `renamed a trivia team: ${brief(t.name)} → ${brief(name)}`);
      }

      const me = await reread();
      return json(await triviaPayload(me, isAdmin));
    }

    /* one answer per team — whoever types last speaks for the team */
    case "triviaAnswer": {
      const st = await tstate();
      if (st.phase !== "play") return json({ ok: false, error: "not_playing" });
      const team = String(me0.team || "");
      if (!team) return json({ ok: false, error: "no_team" });
      const qs = await questAll();
      const q = qs.find(x => String(x.id) === String(body.qid));
      if (!q) return json({ ok: false, error: "no_question" });
      if (q.state !== "open" || String(q.id) !== st.active) {
        return json({ ok: false, error: "closed" });
      }
      const text = clean(body.text, 200);
      const id = `${q.id}::${team}`;
      await sqlite.execute({
        sql: `INSERT INTO ${TA} (id, qid, team, text, by, at, mark)
              VALUES (?, ?, ?, ?, ?, ?, '')
              ON CONFLICT(id) DO UPDATE SET text = excluded.text, by = excluded.by,
                                            at = excluded.at, mark = ''`,
        args: [id, q.id, team, text, full(me0), new Date().toISOString()],
      });
      const t = (await teamsAll()).find(x => String(x.id) === team);
      await log(full(me0), `answered for ${brief(t?.name || "a team")}: ${brief(text)}`);
      return json(await triviaPayload(me0, isAdmin));
    }

    /* ---------- trivia, host only ---------- */
    case "triviaAdmin": {
      if (!isAdmin) return json({ ok: false, error: "not_admin" });
      const op = String(body.op || "");

      /* how far along the evening is, and whether guests can see any of it */
      if (op === "phase") {
        const v = ["off", "teams", "play", "done"].includes(body.value) ? body.value : "off";
        await tset("phase", v);
        await log(full(me0), `trivia phase → ${v}`);
      }
      if (op === "visible") {
        await tset("visible", body.value ? "yes" : "");
        await log(full(me0), `trivia is ${body.value ? "visible to guests" : "hidden again"}`);
      }
      if (op === "title") await tset("title", clean(body.value, 60) || "AI safety trivia");

      /* Letting one account in early, to walk through it as a guest would
         while the tab stays hidden from everybody else. */
      if (op === "preview") {
        const st = await tstate();
        const set = previewers(st);
        const who = clean(body.slug, 40);
        const g = all.find(x => x.slug === who);
        if (!g) return json({ ok: false, error: "no_guest" });
        if (body.on) set.add(who); else set.delete(who);
        await tset("preview", [...set].join(","));
        await log(full(me0), `${body.on ? "gave" : "took"} ${full(g)} ` +
          `${body.on ? "an early look at" : "off"} the trivia tab`);
      }

      /* rounds are numbered; only the name is stored */
      if (op === "roundName") {
        const n = Math.max(1, Math.min(99, Math.round(Number(body.n) || 1)));
        await tset("rnd:" + n, clean(body.value, 60));
      }
      if (op === "roundAdd") {
        const st = await tstate();
        const qs = await questAll();
        const next = roundsOf(st, qs).reduce((m, r) => Math.max(m, r.n), 0) + 1;
        await tset("rnd:" + next, clean(body.name, 60) || `Round ${next}`);
      }
      if (op === "roundDrop") {
        const n = Math.round(Number(body.n) || 0);
        const doomed = (await questAll()).filter(q => (Number(q.rnd) || 1) === n);
        for (const q of doomed) {
          await sqlite.execute({ sql: `DELETE FROM ${TA} WHERE qid = ?`, args: [q.id] });
        }
        await sqlite.execute({ sql: `DELETE FROM ${TQ} WHERE rnd = ?`, args: [n] });
        await sqlite.execute({ sql: `DELETE FROM ${T} WHERE k = ?`, args: ["rnd:" + n] });
        await log(full(me0), `dropped trivia round ${n} and its ${doomed.length} question(s)`);
      }

      /* the editor */
      if (op === "qAdd" || op === "qBulk") {
        const rnd = Math.max(1, Math.round(Number(body.rnd) || 1));
        const qs = await questAll();
        let ord = qs.filter(q => (Number(q.rnd) || 1) === rnd)
                    .reduce((m, q) => Math.max(m, Number(q.ord) || 0), 0);
        /* Bulk entry: one question per line, "prompt | answer | also accepted". */
        const lines = op === "qBulk"
          ? String(body.text || "").split("\n").map((l: string) => l.trim()).filter(Boolean)
          : [null];
        let n = 0;
        for (const line of lines) {
          const parts = line === null ? null : line.split("|").map((x: string) => x.trim());
          const prompt = clean(parts ? parts[0] : body.prompt, 400);
          if (!prompt) continue;
          const answer = cleanLines(parts ? parts.slice(1).join("\n") : body.answer, 400);
          await sqlite.execute({
            sql: `INSERT INTO ${TQ} (id, rnd, ord, prompt, answer, points, state, note)
                  VALUES (?, ?, ?, ?, ?, ?, 'todo', ?)`,
            args: [newId("q"), rnd, ++ord, prompt, answer,
                   String(points({ points: parts ? 1 : body.points })), clean(body.note, 300)],
          });
          n++;
        }
        await log(full(me0), `added ${n} trivia question${n === 1 ? "" : "s"} to round ${rnd}`);
      }

      if (op === "qSet") {
        const field = String(body.field || "");
        if (!["prompt", "answer", "points", "note", "rnd"].includes(field)) {
          return json({ ok: false, error: "bad_field" });
        }
        const value = field === "answer" || field === "prompt" ? cleanLines(body.value, 400)
                    : field === "points" ? String(points({ points: body.value }))
                    : field === "rnd"    ? String(Math.max(1, Math.round(Number(body.value) || 1)))
                    : clean(body.value, 300);
        await sqlite.execute({
          sql: `UPDATE ${TQ} SET ${field} = ? WHERE id = ?`, args: [value, body.id],
        });
      }

      if (op === "qDrop") {
        await sqlite.execute({ sql: `DELETE FROM ${TA} WHERE qid = ?`, args: [body.id] });
        await sqlite.execute({ sql: `DELETE FROM ${TQ} WHERE id = ?`, args: [body.id] });
        const st = await tstate();
        if (st.active === String(body.id)) await tset("active", "");
        await log(full(me0), `deleted a trivia question`);
      }

      if (op === "qMove") {
        const qs = await questAll();
        const q = qs.find(x => String(x.id) === String(body.id));
        if (q) {
          const lane = qs.filter(x => (Number(x.rnd) || 1) === (Number(q.rnd) || 1));
          const at = lane.findIndex(x => x.id === q.id);
          const to = body.dir === "up" ? at - 1 : at + 1;
          if (to >= 0 && to < lane.length) {
            const b = lane[to];
            await sqlite.execute({ sql: `UPDATE ${TQ} SET ord = ? WHERE id = ?`, args: [Number(b.ord) || 0, q.id] });
            await sqlite.execute({ sql: `UPDATE ${TQ} SET ord = ? WHERE id = ?`, args: [Number(q.ord) || 0, b.id] });
          }
        }
      }

      /* running it: ask one, close it, and closing is what scores it */
      if (op === "ask") {
        const qs = await questAll();
        const q = qs.find(x => String(x.id) === String(body.id));
        if (!q) return json({ ok: false, error: "no_question" });
        await sqlite.execute({ sql: `UPDATE ${TQ} SET state = 'todo' WHERE state = 'open'` });
        await sqlite.execute({ sql: `UPDATE ${TQ} SET state = 'open' WHERE id = ?`, args: [q.id] });
        await tset("active", String(q.id));
        await tset("phase", "play");
        await log(full(me0), `asked: ${brief(q.prompt)}`);
      }
      if (op === "close") {
        const qs = await questAll();
        const q = qs.find(x => String(x.id) === String(body.id));
        if (!q) return json({ ok: false, error: "no_question" });
        await sqlite.execute({ sql: `UPDATE ${TQ} SET state = 'done' WHERE id = ?`, args: [q.id] });
        const st = await tstate();
        if (st.active === String(q.id)) await tset("active", "");
        await tset("last", String(q.id));
        await log(full(me0), `closed: ${brief(q.prompt)}`);
      }
      /* Back to unasked — the points come off the board with it. */
      if (op === "reopen") {
        await sqlite.execute({ sql: `UPDATE ${TQ} SET state = 'todo' WHERE id = ?`, args: [body.id] });
        const st = await tstate();
        if (st.active === String(body.id)) await tset("active", "");
      }

      /* the host's last word on any answer */
      if (op === "mark") {
        const value = ["yes", "no", ""].includes(body.value) ? body.value : "";
        const id = `${body.qid}::${body.team}`;
        await sqlite.execute({
          sql: `INSERT INTO ${TA} (id, qid, team, text, by, at, mark)
                VALUES (?, ?, ?, '', '', ?, ?)
                ON CONFLICT(id) DO UPDATE SET mark = excluded.mark`,
          args: [id, body.qid, body.team, new Date().toISOString(), value],
        });
        await log(full(me0), `marked an answer ${value === "yes" ? "right" : value === "no" ? "wrong" : "back to auto"}`);
      }

      if (op === "teamDrop") {
        const t = (await teamsAll()).find(x => String(x.id) === String(body.id));
        if (t) {
          for (const g of all.filter(g => String(g.team || "") === String(t.id))) {
            await setField(g.slug, "team", "");
          }
          await sqlite.execute({ sql: `DELETE FROM ${TA} WHERE team = ?`, args: [t.id] });
          await sqlite.execute({ sql: `DELETE FROM ${TT} WHERE id = ?`, args: [t.id] });
          await log(full(me0), `disbanded the trivia team “${t.name}”`);
        }
      }
      /* Moving someone by hand, for whoever never got round to picking. */
      if (op === "put") {
        const g = all.find(x => x.slug === String(body.slug));
        if (!g) return json({ ok: false, error: "no_guest" });
        await setField(g.slug, "team", clean(body.team, 40));
        await log(full(me0), `put ${full(g)} on a trivia team`);
      }

      /* Wipes every typed answer but keeps the questions, for a second run. */
      if (op === "clearAnswers") {
        await sqlite.execute(`DELETE FROM ${TA}`);
        await sqlite.execute(`UPDATE ${TQ} SET state = 'todo'`);
        await tset("active", "");
        await log(full(me0), `cleared every trivia answer`);
      }

      const me = await reread();
      return json(await triviaPayload(me, isAdmin));
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
