/**
 * confluxcon — the backend.
 *
 * SETUP (once, about five minutes)
 *   1. Make a new Google Sheet. Extensions ▸ Apps Script.
 *   2. Delete what's there, paste this whole file in, Save.
 *   3. Run `seed` once from the dropdown (authorise it when asked). That fills
 *      the sheet from SEED_JSON below — paste that in first, from
 *      `python3 build.py --seed`.
 *   4. Deploy ▸ New deployment ▸ Web app.
 *        Execute as:     Me
 *        Who has access: Anyone
 *      Deploy, copy the /exec URL.
 *   5. Put that URL in BACKEND_URL in index.html, commit, push.
 *
 * After that the sheet is the live database. You can edit it by hand any time;
 * the site reads it on every load.
 */

// Paste the output of `python3 build.py --seed` between the backticks.
var SEED_JSON = ``;

var GUESTS   = 'guests';
var SESSIONS = 'sessions';

var GCOLS = ['order','slug','first','last','password','admin','met','org','lane',
             'going','prob','arrive','link','run','sessions','seen','updated'];
var SCOLS = ['name','by','host'];

/* ---------- sheet plumbing ------------------------------------------------ */

function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(cols);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(name, cols) {
  var sh = sheet_(name, cols);
  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = { _row: i + 1 };
    for (var j = 0; j < head.length; j++) r[head[j]] = vals[i][j];
    if (String(r.slug || r.name || '').trim()) out.push(r);
  }
  return out;
}

function writeCell_(name, cols, row, col, value) {
  var sh = sheet_(name, cols);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
               .map(function (h) { return String(h).trim(); });
  var at = head.indexOf(col);
  if (at < 0) {
    at = head.length;
    sh.getRange(1, at + 1).setValue(col);
  }
  sh.getRange(row, at + 1).setValue(value);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
                       .setMimeType(ContentService.MimeType.JSON);
}

var clean = function (v, max) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max || 300);
};
var num = function (v) {
  if (v === '' || v == null) return '';
  var n = Math.round(Number(v));
  return isNaN(n) ? '' : Math.max(0, Math.min(100, n));
};

/* ---------- shaping ------------------------------------------------------- */

function parseSessions_(v) {
  try { return JSON.parse(v || '{}') || {}; } catch (e) { return {}; }
}

/** What every signed-in guest may see about everyone else. No passwords. */
function publicCard_(g) {
  return {
    slug: g.slug, first: g.first, last: g.last,
    met: g.met, org: g.org, link: g.link,
    going: g.going, prob: g.prob === '' ? null : Number(g.prob),
    run: g.run, sessions: parseSessions_(g.sessions),
    seen: g.seen === true || g.seen === 'yes'
  };
}

/** Everything, for the one admin. */
function adminRow_(g) {
  var c = publicCard_(g);
  c.password = g.password;
  c.lane     = g.lane || 'invited';
  c.arrive   = g.arrive;
  c.order    = Number(g.order) || 0;
  c.admin    = g.admin === true || g.admin === 'yes';
  return c;
}

function payload_(me, all, isAdmin) {
  var sessions = rows_(SESSIONS, SCOLS).map(function (s) {
    return { name: s.name, by: s.by, host: s.host === true || s.host === 'yes' };
  });
  var out = {
    ok: true,
    slug: me.slug,
    admin: isAdmin,
    me: adminRow_(me),
    sessions: sessions,
    guests: all.filter(function (g) { return (g.lane || 'invited') === 'invited'; })
               .map(publicCard_)
  };
  if (isAdmin) {
    out.roster = all.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); })
                    .map(adminRow_);
  }
  return out;
}

function findByPassword_(all, pw) {
  pw = String(pw || '').trim().toLowerCase();
  if (!pw) return null;
  for (var i = 0; i < all.length; i++) {
    if (String(all[i].password || '').trim().toLowerCase() === pw) return all[i];
  }
  return null;
}

/* ---------- entry points -------------------------------------------------- */

function doGet() {
  return json_({ ok: true, hello: 'confluxcon' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse(e.postData.contents || '{}');
    var all  = rows_(GUESTS, GCOLS);
    var me   = findByPassword_(all, body.password);

    if (!me) return json_({ ok: false, error: 'bad_password' });
    var isAdmin = me.admin === true || me.admin === 'yes';

    switch (body.action) {

      case 'auth':
        return json_(payload_(me, all, isAdmin));

      /* a guest editing their own RSVP */
      case 'save': {
        var p = body.patch || {};
        var fields = {
          first:  clean(p.first, 40),   last:   clean(p.last, 40),
          met:    clean(p.met, 60),     org:    clean(p.org, 60),
          arrive: clean(p.arrive, 40),  link:   clean(p.link, 200),
          going:  ['yes','likely','maybe','no',''].indexOf(p.going) >= 0 ? p.going : me.going,
          prob:   num(p.prob)
        };
        for (var k in fields) writeCell_(GUESTS, GCOLS, me._row, k, fields[k]);
        if (p.sessions) {
          writeCell_(GUESTS, GCOLS, me._row, 'sessions', JSON.stringify(p.sessions).slice(0, 4000));
        }
        writeCell_(GUESTS, GCOLS, me._row, 'seen', 'yes');
        writeCell_(GUESTS, GCOLS, me._row, 'updated', new Date().toISOString());
        all = rows_(GUESTS, GCOLS);
        me  = findByPassword_(all, body.password);
        return json_(payload_(me, all, isAdmin));
      }

      /* proposing a session — it joins the one shared list */
      case 'addSession': {
        var name = clean(body.name, 60);
        if (!name) return json_({ ok: false, error: 'no_name' });
        var existing = rows_(SESSIONS, SCOLS);
        for (var s = 0; s < existing.length; s++) {
          if (String(existing[s].name).toLowerCase() === name.toLowerCase()) {
            return json_(payload_(me, all, isAdmin));
          }
        }
        sheet_(SESSIONS, SCOLS).appendRow([name, me.first, body.host ? 'yes' : '']);
        return json_(payload_(me, all, isAdmin));
      }

      case 'dropSession': {
        var target = clean(body.name, 60).toLowerCase();
        var list = rows_(SESSIONS, SCOLS);
        for (var t = 0; t < list.length; t++) {
          var mine = String(list[t].by || '') === String(me.first) || isAdmin;
          if (String(list[t].name).toLowerCase() === target && mine) {
            sheet_(SESSIONS, SCOLS).deleteRow(list[t]._row);
            break;
          }
        }
        return json_(payload_(me, all, isAdmin));
      }

      /* everything below here is Jacob only */
      case 'admin': {
        if (!isAdmin) return json_({ ok: false, error: 'not_admin' });
        var sh = sheet_(GUESTS, GCOLS);

        if (body.op === 'set') {
          var g = null;
          for (var i = 0; i < all.length; i++) if (all[i].slug === body.slug) g = all[i];
          if (!g) return json_({ ok: false, error: 'no_guest' });
          // 'pw' is accepted as an alias so an older page keeps working
          if (body.field === 'pw') body.field = 'password';
          var allowed = ['first','last','password','met','org','lane','going',
                         'prob','arrive','link','run'];
          if (allowed.indexOf(body.field) < 0) return json_({ ok: false, error: 'bad_field' });

          // A password names a person, so two guests may never share one.
          if (body.field === 'password') {
            var want = clean(body.value, 60).toLowerCase();
            if (!want) return json_({ ok: false, error: 'password_empty' });
            for (var q = 0; q < all.length; q++) {
              if (all[q].slug !== g.slug &&
                  String(all[q].password || '').trim().toLowerCase() === want) {
                return json_({ ok: false, error: 'password_taken' });
              }
            }
          }

          writeCell_(GUESTS, GCOLS, g._row, body.field,
                     body.field === 'prob' ? num(body.value) : clean(body.value, 200));
        }

        if (body.op === 'add') {
          var nm = clean(body.name, 80);
          if (!nm) return json_({ ok: false, error: 'no_name' });
          var parts = nm.split(/\s+/);
          var slug  = parts[0].toLowerCase().replace(/[^a-z]/g, '');
          var taken = {}, maxOrder = 0, pwTaken = {};
          all.forEach(function (x) {
            taken[x.slug] = 1;
            pwTaken[String(x.password).toLowerCase()] = 1;
            maxOrder = Math.max(maxOrder, Number(x.order) || 0);
          });
          if (taken[slug]) slug = nm.toLowerCase().replace(/[^a-z]+/g, '');
          var n = 2;
          while (taken[slug]) slug = parts[0].toLowerCase().replace(/[^a-z]/g, '') + (n++);
          var pw = '';
          for (var w = 0; w < WORDS.length; w++) if (!pwTaken[WORDS[w]]) { pw = WORDS[w]; break; }
          if (!pw) pw = 'spare' + (all.length + 1);
          sh.appendRow([maxOrder + 1, slug, parts[0], parts.slice(1).join(' '), pw, '',
                        clean(body.met, 60), clean(body.org, 60), 'prospect',
                        '', '', '', '', '', '{}', '', '']);
        }

        if (body.op === 'move') {
          var lane = all.filter(function (x) { return (x.lane || 'invited') === body.lane; })
                        .sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
          var at = -1;
          for (var m = 0; m < lane.length; m++) if (lane[m].slug === body.slug) at = m;
          var to = body.dir === 'up' ? at - 1 : at + 1;
          if (at >= 0 && to >= 0 && to < lane.length) {
            var a = lane[at], b = lane[to];
            var ao = Number(a.order) || 0, bo = Number(b.order) || 0;
            writeCell_(GUESTS, GCOLS, a._row, 'order', bo);
            writeCell_(GUESTS, GCOLS, b._row, 'order', ao);
          }
        }

        all = rows_(GUESTS, GCOLS);
        me  = findByPassword_(all, body.password);
        return json_(payload_(me, all, isAdmin));
      }
    }

    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- one-time seed ------------------------------------------------- */

var WORDS = ('bellwether cinder driftwood ember fathom girder hearth ingot jetty keystone ' +
  'lodestar mantle nectar obelisk parapet quiver rampart sextant tallow undertow vellum ' +
  'wainscot xenon yardarm zenith almanac bramble copse dovetail escarpment foxglove gantry')
  .split(' ');

function seed() {
  var data = JSON.parse(SEED_JSON);
  var sh = sheet_(GUESTS, GCOLS);
  sh.clear();
  sh.appendRow(GCOLS);
  sh.setFrozenRows(1);
  data.guests.forEach(function (g, i) {
    sh.appendRow([i + 1, g.slug, g.first, g.last, g.password, g.admin ? 'yes' : '',
                  g.met || '', g.org || '', g.lane || 'invited',
                  '', '', '', g.link || '', '', '{}', '', '']);
  });
  var ss = sheet_(SESSIONS, SCOLS);
  ss.clear();
  ss.appendRow(SCOLS);
  ss.setFrozenRows(1);
  (data.sessions || []).forEach(function (n) { ss.appendRow([n, '', '']); });
  SpreadsheetApp.getActiveSpreadsheet().toast('Seeded ' + data.guests.length + ' guests');
}
