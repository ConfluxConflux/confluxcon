/**
 * confluxcon backend — Google Apps Script.
 *
 * Setup (about five minutes, once):
 *   1. Make a new Google Sheet. Extensions > Apps Script.
 *   2. Delete whatever is there, paste this whole file in, Save.
 *   3. Deploy > New deployment > type "Web app".
 *        Execute as:        Me
 *        Who has access:    Anyone
 *      Deploy, authorise, copy the /exec URL it gives you.
 *   4. Paste that URL into BACKEND_URL near the bottom of index.html, and push.
 *
 * Writes are only accepted for hashes that appear in the site's roster.json,
 * so only people you invited can post a profile.
 */

var ROSTER_URL = 'https://confluxcon.com/data/roster.json';
var SHEET      = 'profiles';

var COLS = ['updated', 'hash', 'name', 'org', 'link', 'arrival',
            'bringing', 'bio', 'knows_jacob', 'name_vote', 'name_suggestion'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(COLS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function roster_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('roster');
  if (hit) return JSON.parse(hit);
  var txt = UrlFetchApp.fetch(ROSTER_URL, { muteHttpExceptions: true }).getContentText();
  cache.put('roster', txt, 300);          // five minutes
  return JSON.parse(txt);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 300);
}

/* ---- read ---------------------------------------------------------------- */

function doGet(e) {
  var rows = sheet_().getDataRange().getValues();
  var profiles = {}, votes = { confluxcon: 0, fluxcon: 0, other: 0 }, suggestions = [];

  for (var i = 1; i < rows.length; i++) {
    var r = {}, j;
    for (j = 0; j < COLS.length; j++) r[COLS[j]] = String(rows[i][j] == null ? '' : rows[i][j]);
    if (!r.hash) continue;
    profiles[r.hash] = r;                                    // last write wins
  }
  Object.keys(profiles).forEach(function (h) {
    var p = profiles[h];
    if (votes[p.name_vote] !== undefined) votes[p.name_vote]++;
    if (p.name_vote === 'other' && p.name_suggestion) {
      suggestions.push({ name: p.name, suggestion: p.name_suggestion });
    }
  });

  return json_({
    ok: true,
    generated: new Date().toISOString(),
    profiles: profiles,
    votes: votes,
    suggestions: suggestions
  });
}

/* ---- write --------------------------------------------------------------- */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    var body = JSON.parse(e.postData.contents);
    var hash = clean_(body.hash, 12);

    var roster = roster_();
    if (!roster.guests || !roster.guests[hash]) {
      return json_({ ok: false, error: 'unknown guest' });
    }

    var vote = ['confluxcon', 'fluxcon', 'other'].indexOf(body.name_vote) >= 0
             ? body.name_vote : '';

    var rec = {
      updated:         new Date().toISOString(),
      hash:            hash,
      name:            clean_(body.name, 80)   || roster.guests[hash].name,
      org:             clean_(body.org, 80),
      link:            clean_(body.link, 200),
      arrival:         clean_(body.arrival, 40),
      bringing:        clean_(body.bringing, 200),
      bio:             clean_(body.bio, 400),
      knows_jacob:     clean_(body.knows_jacob, 200),
      name_vote:       vote,
      name_suggestion: vote === 'other' ? clean_(body.name_suggestion, 60) : ''
    };

    var sh = sheet_();
    var hashes = sh.getRange(1, 2, Math.max(sh.getLastRow(), 1), 1).getValues();
    var row = 0;
    for (var i = 1; i < hashes.length; i++) {
      if (String(hashes[i][0]) === hash) { row = i + 1; break; }
    }

    var line = COLS.map(function (c) { return rec[c]; });
    if (row) sh.getRange(row, 1, 1, COLS.length).setValues([line]);
    else     sh.appendRow(line);

    return json_({ ok: true, profile: rec });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
