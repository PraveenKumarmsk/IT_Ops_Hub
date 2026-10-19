// ════════════════════════════════════════════════════════════════════════════
// CMD Notes — Apps Script backend (Google Sheet = database)
//
// Row 1 header of EVERY tab (Windows, Linux, CCNA_CCNP, Others, Troubleshooting, …):
//
//   cmds | tag | category | purpose | example | id | favorite | created_at | updated_at
//    A     B       C          D         E       F       G           H            I
//
//   (header names are matched by NAME, order does not matter — but the data under
//    each header must be in that same column.  If two columns are both called
//    "category", the first one is treated as the tag.)
//
// IT OPS HUB edition (v3): + PIN login from the "_Users" tab, roles, tokens, changePin, ping.
//   First run: select function  setupUsers  → ▶ Run  (creates the _Users tab: user | pin | role | active)
//   Login is OFF until the _Users tab has at least one active row. Delete the tab to switch login off.
//
// DEPLOY:  Deploy → New deployment → type "Web app"
//          Execute as: Me   ·   Who has access: Anyone
//          After ANY code change:  Deploy → Manage deployments → ✏️ → Version: New version → Deploy
// ════════════════════════════════════════════════════════════════════════════

var SHEET_ID = "1ekY7Oxnt4i1Y-gRgvx09ytQ6y1JCXxOkaDK2UBG_V-w";

// Optional edit password. "" = anyone who has the app link can add/edit/delete.
// Set e.g. "mySecret123" to make the app read-only until the password is entered.
var EDIT_KEY = "";

var APP_NAME = "CMD Notes";
var FIELDS   = ["cmd", "tag", "category", "purpose", "example", "id", "favorite", "created_at", "updated_at"];
var TEXT     = ["cmd", "tag", "category", "purpose", "example"];     // user-editable text columns
var NEEDED   = ["tag", "id", "favorite", "created_at", "updated_at"]; // auto-added to a tab's header if missing
var ALIASES  = {
  cmd:        ["cmds", "cmd", "command", "commands"],
  tag:        ["tag", "tags", "platform", "os"],
  category:   ["category", "categories", "cat"],
  purpose:    ["purpose", "description", "desc", "use", "usage"],
  example:    ["example", "examples", "sample"],
  id:         ["id", "uuid"],
  favorite:   ["favorite", "favourite", "fav", "starred", "star"],
  created_at: ["created_at", "created", "createdat", "created at"],
  updated_at: ["updated_at", "updated", "updatedat", "updated at", "modified_at"]
};
var MAX_LEN = 4000;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Entry points ────────────────────────────────────────────────────────────
function doGet(e) {
  // Health check: open the /exec URL in a browser — you should see {"ok":true,...}
  try {
    return json_({ ok: true, v: 3, app: APP_NAME, auth: authOn_(), tabs: tabs_(open_()).map(function (s) { return s.getName(); }) });
  } catch (err) {
    return json_({ ok: false, error: msg_(err) });
  }
}

function doPost(e) {
  var res;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    res = route_(req);
  } catch (err) {
    res = { ok: false, error: msg_(err) };
  }
  return json_(res);
}

function route_(req) {
  switch (req.action) {
    case "ping":      return { ok: true, v: 3, app: APP_NAME, auth: authOn_() };
    case "login":     return login_(req);
    case "changePin": return changePin_(req);
    case "checkKey":  return { ok: !EDIT_KEY || String(req.key || "") === EDIT_KEY };
    case "list":      { var who = need_(req); var out = list_(); out.v = 3; out.auth = authOn_(); if (who) { out.user = who.user; out.role = who.role; } return out; }
    case "add":       return write_(req, add_);
    case "update":    return write_(req, update_);
    case "favorite":  return write_(req, favorite_);
    case "delete":    return write_(req, delete_);
    case "addTab":    return write_(req, addTab_, true);
    default: throw new Error("Unknown action: " + req.action);
  }
}


// ── Login (users live in the "_Users" tab: user | pin | role | active) ──────
var USERS_TAB = "_Users";
var TOKEN_DAYS = 30, MAX_FAILS = 5, BLOCK_MIN = 10;

// Run this ONCE from the editor: creates the _Users tab with a sample admin (change the PIN!).
function setupUsers() {
  var ss = open_(), sh = findUsers_(ss);
  if (!sh) {
    sh = ss.insertSheet(USERS_TAB);
    sh.getRange(1, 1, 1, 4).setValues([["user", "pin", "role", "active"]]).setFontWeight("bold");
    sh.getRange(2, 1, 1, 4).setValues([["admin", "1234", "admin", "yes"]]);
    sh.getRange(2, 2, 200, 1).setNumberFormat("@");          // plain text: keeps 0456
    sh.setFrozenRows(1);
  }
  return "OK — open the _Users tab, change the admin PIN, add users.";
}

function findUsers_(ss) {
  var all = (ss || open_()).getSheets();
  for (var i = 0; i < all.length; i++) if (all[i].getName().toLowerCase() === USERS_TAB.toLowerCase()) return all[i];
  return null;
}

function users_() {
  var sh = findUsers_(), out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(1, 1, sh.getLastRow(), Math.max(4, sh.getLastColumn())).getDisplayValues();
  var h = v[0].map(norm_), cu = h.indexOf("user"), cp = h.indexOf("pin"), cr = h.indexOf("role"), ca = h.indexOf("active");
  if (cu < 0) cu = 0; if (cp < 0) cp = 1; if (cr < 0) cr = 2; if (ca < 0) ca = 3;
  for (var i = 1; i < v.length; i++) {
    var u = String(v[i][cu] || "").trim(), p = String(v[i][cp] || "").trim();
    if (!u || !p) continue;
    var act = norm_(v[i][ca]);
    if (act === "no" || act === "false" || act === "0" || act === "n") continue;
    var r = norm_(v[i][cr]); if (r !== "admin" && r !== "viewer") r = "editor";
    out.push({ user: u, pin: p, role: r, row: i + 1 });
  }
  return out;
}

function authOn_() { try { return users_().length > 0; } catch (e) { return false; } }

function secret_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty("TOKEN_SECRET");
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty("TOKEN_SECRET", s); }
  return s;
}
function sign_(txt) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(txt, secret_())); }

function makeToken_(user) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({ u: user, e: Date.now() + TOKEN_DAYS * 86400000 }));
  return body + "." + sign_(body);
}
function readToken_(tok) {
  tok = String(tok || ""); var p = tok.split(".");
  if (p.length !== 2 || sign_(p[0]) !== p[1]) return null;
  try {
    var d = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0])).getDataAsString());
    if (!d.u || d.e < Date.now()) return null;
    return d;
  } catch (e) { return null; }
}

// Returns null when login is off, otherwise {user, role}. Throws AUTH_REQUIRED.
function need_(req) {
  var us = users_();
  if (!us.length) return null;
  var t = readToken_(req.token);
  if (!t) throw new Error("AUTH_REQUIRED");
  for (var i = 0; i < us.length; i++) if (us[i].user.toLowerCase() === String(t.u).toLowerCase()) return { user: us[i].user, role: us[i].role, row: us[i].row, pin: us[i].pin };
  throw new Error("AUTH_REQUIRED");
}

function login_(req) {
  var us = users_();
  if (!us.length) return { ok: true, auth: false };
  var name = String(req.user || "").trim().toLowerCase(), pin = String(req.pin || "").trim();
  var cache = CacheService.getScriptCache(), fk = "fail_" + Utilities.base64EncodeWebSafe(name).slice(0, 40);
  var fails = Number(cache.get(fk) || 0);
  if (fails >= MAX_FAILS) throw new Error("Too many wrong PINs — try again in " + BLOCK_MIN + " minutes.");
  for (var i = 0; i < us.length; i++) {
    if (us[i].user.toLowerCase() === name && us[i].pin === pin) {
      cache.remove(fk);
      return { ok: true, token: makeToken_(us[i].user), user: us[i].user, role: us[i].role };
    }
  }
  cache.put(fk, String(fails + 1), BLOCK_MIN * 60);
  throw new Error("Wrong user name or PIN.");
}

function changePin_(req) {
  var who = need_(req);
  if (!who) throw new Error("Login is off.");
  var o = String(req.oldPin || "").trim(), n = String(req.newPin || "").trim();
  if (o !== who.pin) throw new Error("The current PIN is wrong.");
  if (!/^[0-9]{4,8}$/.test(n)) throw new Error("The new PIN must be 4 to 8 digits.");
  var sh = findUsers_(), h = sh.getRange(1, 1, 1, Math.max(4, sh.getLastColumn())).getDisplayValues()[0].map(norm_);
  var cp = h.indexOf("pin"); if (cp < 0) cp = 1;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { sh.getRange(who.row, cp + 1).setNumberFormat("@").setValue(n); } finally { lock.releaseLock(); }
  return { ok: true };
}

// Every write goes through here: login → role check → (optional) EDIT_KEY → lock.
function write_(req, fn, adminOnly) {
  var who = need_(req);
  if (who) {
    if (who.role === "viewer") throw new Error("READ_ONLY");
    if (adminOnly && who.role !== "admin") throw new Error("ADMIN_ONLY");
  }
  return locked_(req, fn);
}

// ── Reading ─────────────────────────────────────────────────────────────────
function list_() {
  var ss = open_(), items = [], tabs = [], warnings = [];
  tabs_(ss).forEach(function (sheet) {
    var data = read_(sheet), n = 0;
    data.rows.forEach(function (r) { r.tab = sheet.getName(); items.push(r); n++; });
    tabs.push({ name: sheet.getName(), count: n });
    data.warnings.forEach(function (w) { warnings.push("[" + sheet.getName() + "] " + w); });
  });
  return { ok: true, app: APP_NAME, locked: !!EDIT_KEY, sheetUrl: ss.getUrl(), tabs: tabs, items: items, warnings: warnings, ts: Date.now() };
}

// ── Writing ─────────────────────────────────────────────────────────────────
function add_(req) {
  var sheet = sheet_(req.tab);
  var d = clean_(req);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  var map = ensureColumns_(sheet, columns_(sheet));
  guard_(sheet, map);
  var row = sheet.getLastRow() + 1, now = new Date().toISOString();
  writeText_(sheet, map, row, d);
  put_(sheet, map, row, "id", Utilities.getUuid());
  put_(sheet, map, row, "favorite", !!req.favorite, true);
  put_(sheet, map, row, "created_at", now);
  put_(sheet, map, row, "updated_at", now);
  return { ok: true, row: row };
}

function update_(req) {
  var sheet = sheet_(req.tab);
  var d = clean_(req);
  var map = ensureColumns_(sheet, columns_(sheet));
  guard_(sheet, map);
  var row = locate_(sheet, map, req);
  if (!row) throw new Error("Ye entry sheet me badal chuki hai ya hat gayi — Refresh karo.");
  writeText_(sheet, map, row, d);
  if (req.favorite !== undefined) put_(sheet, map, row, "favorite", !!req.favorite, true);
  put_(sheet, map, row, "updated_at", new Date().toISOString());
  ensureId_(sheet, map, row);
  return { ok: true, row: row };
}

function favorite_(req) {
  var sheet = sheet_(req.tab);
  var map = ensureColumns_(sheet, columns_(sheet));
  guard_(sheet, map);
  var row = locate_(sheet, map, req);
  if (!row) throw new Error("Ye entry sheet me badal chuki hai ya hat gayi — Refresh karo.");
  put_(sheet, map, row, "favorite", !!req.favorite, true);   // star toggle does not change updated_at
  ensureId_(sheet, map, row);
  return { ok: true, row: row };
}

function delete_(req) {
  var sheet = sheet_(req.tab);
  var map = columns_(sheet);
  guard_(sheet, map);
  var row = locate_(sheet, map, req);
  if (!row) throw new Error("Ye entry pehle hi hat chuki hai — Refresh karo.");
  sheet.deleteRow(row);
  return { ok: true };
}

function addTab_(req) {
  var name = String(req.name || "").trim();
  if (!name || name.length > 60 || /[\[\]\*\?:\/\\]/.test(name)) throw new Error("Tab ka naam galat hai (max 60 chars, [ ] * ? : / \\ allowed nahi).");
  var ss = open_();
  if (ss.getSheetByName(name)) throw new Error("Is naam ka tab pehle se hai.");
  var sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS]).setFontWeight("bold");
  sh.setFrozenRows(1);
  return { ok: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function locked_(req, fn) {
  if (EDIT_KEY && String(req.key || "") !== EDIT_KEY) throw new Error("EDIT_KEY_REQUIRED");
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(req); } finally { lock.releaseLock(); }
}

function open_() { return SpreadsheetApp.openById(SHEET_ID); }

function tabs_(ss) {
  return ss.getSheets().filter(function (s) {
    return !s.isSheetHidden() && s.getName().charAt(0) !== "_";
  });
}

function sheet_(name) {
  var s = open_().getSheetByName(String(name || ""));
  if (!s) throw new Error("Tab nahi mila: " + name);
  return s;
}

function norm_(s) { return String(s || "").trim().toLowerCase(); }

function colLetter_(i) {
  var s = "";
  for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

// Which column holds which field (by header text).
function columns_(sheet) {
  var map = { start: 1, dups: [] };
  FIELDS.forEach(function (f) { map[f] = -1; });
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) { map.empty = true; return map; }
  var head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(norm_);
  var catIdx = [], i;
  head.forEach(function (h, k) { if (ALIASES.category.indexOf(h) >= 0) catIdx.push(k); });
  FIELDS.forEach(function (f) {
    if (f === "category" || f === "tag") return;
    for (i = 0; i < head.length; i++) if (ALIASES[f].indexOf(head[i]) >= 0) { map[f] = i; break; }
  });
  for (i = 0; i < head.length; i++) if (ALIASES.tag.indexOf(head[i]) >= 0) { map.tag = i; break; }
  if (map.tag >= 0)            map.category = catIdx.length ? catIdx[0] : -1;
  else if (catIdx.length >= 2) { map.tag = catIdx[0]; map.category = catIdx[1]; }   // two "category" columns → first = tag
  else if (catIdx.length === 1) map.category = catIdx[0];
  var cnt = {};
  head.forEach(function (h, k) { if (h) { cnt[h] = (cnt[h] || 0) + 1; } });
  map.dupCols = [];
  Object.keys(cnt).forEach(function (h) {
    var twoCats = ALIASES.category.indexOf(h) >= 0 && cnt[h] === 2 && map.tag === catIdx[0];
    if (cnt[h] > 1 && !twoCats) {
      map.dups.push(h);
      var seenFirst = false;
      head.forEach(function (x, k) { if (x === h) { if (seenFirst) map.dupCols.push(k); seenFirst = true; } });
    }
  });
  if (map.cmd < 0) {                         // no recognisable header: treat A,B,C,D as cmd, category, purpose, example
    map.cmd = 0; map.category = 1; map.purpose = 2; map.example = 3; map.start = 0; map.noHeader = true;
  }
  return map;
}

// Add missing helper columns (tag, id, favorite, created_at, updated_at) to the right of the header.
function ensureColumns_(sheet, map) {
  if (map.noHeader || map.empty) return map;
  NEEDED.forEach(function (f) {
    if (map[f] >= 0) return;
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(f).setFontWeight("bold");
    map[f] = col - 1;
  });
  return map;
}

// Detect a header row that is shifted against its data (e.g. UUIDs sitting under "favorite").
function alignIssue_(map, values) {
  if (map.id < 0 || values.length <= map.start) return "";
  var cols = 0, r;
  for (r = map.start; r < values.length; r++) cols = Math.max(cols, values[r].length);
  function frac(c) {
    var n = 0, u = 0;
    for (var k = map.start; k < Math.min(values.length, map.start + 40); k++) {
      var v = String(values[k][c] || "").trim();
      if (v) { n++; if (UUID_RE.test(v)) u++; }
    }
    return n ? u / n : 0;
  }
  var mine = frac(map.id);
  if (mine >= 0.5) return "";
  for (var c = 0; c < cols; c++) {
    if (c !== map.id && frac(c) >= 0.5) {
      return "Header row data se align nahi hai: 'id' header column " + colLetter_(map.id) + " par hai, par UUID column " +
             colLetter_(c) + " me hain. Row 1 ko data ke saath milao (cmds, tag, category, purpose, example, id, favorite, created_at, updated_at).";
    }
  }
  return "";
}

function guard_(sheet, map) {
  if (map.noHeader || map.empty || sheet.getLastRow() < 2) return;
  var issue = alignIssue_(map, sheet.getDataRange().getDisplayValues());
  if (issue) throw new Error("Sheet band hai (safety): " + issue);
}

function truthy_(v) { return /^(true|yes|y|1|✓|✔|⭐|★)$/i.test(String(v || "").trim()); }

function read_(sheet) {
  var map = columns_(sheet), rows = [], warnings = [];
  if (sheet.getLastRow() === 0) return { map: map, rows: rows, warnings: warnings };
  var values = sheet.getDataRange().getDisplayValues();
  var issue = alignIssue_(map, values);
  if (issue) warnings.push(issue);
  if (map.dups.length) {
    var extraHasData = false;
    map.dupCols.forEach(function (c) {
      for (var k = map.start; k < values.length; k++) if (String(values[k][c] || "").trim()) { extraHasData = true; break; }
    });
    if (extraHasData) warnings.push("Header me duplicate naam: " + map.dups.join(", ") + " (pehla column use hota hai, duplicate hata do).");
  }
  for (var i = map.start; i < values.length; i++) {
    var item = { row: i + 1 }, any = false;
    FIELDS.forEach(function (f) {
      var v = map[f] >= 0 ? String(values[i][map[f]] || "") : "";
      if (f === "favorite") { item.favorite = truthy_(v); return; }
      item[f] = v;
      if (TEXT.indexOf(f) >= 0 && v.trim() !== "") any = true;
    });
    if (any) rows.push(item);
  }
  return { map: map, rows: rows, warnings: warnings };
}

function clean_(req) {
  var out = {};
  TEXT.forEach(function (f) {
    var v = String(req[f] == null ? "" : req[f]).replace(/\s+$/, "").replace(/^(\s*\n)+/, "");
    if (f !== "purpose" && f !== "example") v = v.replace(/^\s+/, "");
    if (f === "tag") {
      var seen = {};
      v = v.split(/[,;|]/).map(function (t) { return t.trim(); }).filter(function (t) {
        var k = t.toLowerCase();
        if (!t || seen[k]) return false;
        seen[k] = 1; return true;
      }).join(", ");
    }
    if (v.length > MAX_LEN) throw new Error("'" + f + "' bahut lamba hai (max " + MAX_LEN + " characters).");
    out[f] = v;
  });
  if (!out.cmd.trim()) throw new Error("Command (cmds) khaali nahi ho sakta.");
  return out;
}

// Text is written as plain text so "=cmd", "+x", "1/2" are never turned into formulas/dates.
function writeText_(sheet, map, row, d) {
  TEXT.forEach(function (f) { put_(sheet, map, row, f, d[f]); });
}

function put_(sheet, map, row, field, value, asValue) {
  if (map[field] < 0) return;
  var cell = sheet.getRange(row, map[field] + 1);
  if (asValue) cell.setNumberFormat("General").setValue(value);   // booleans stay TRUE/FALSE
  else cell.setNumberFormat("@").setValue(String(value));
}

function ensureId_(sheet, map, row) {
  if (map.id < 0) return;
  var cur = String(sheet.getRange(row, map.id + 1).getDisplayValue() || "");
  if (!cur.trim()) put_(sheet, map, row, "id", Utilities.getUuid());
}

// Find the row of an entry: by id first, then by the original text (row number is only a hint).
function locate_(sheet, map, req) {
  if (sheet.getLastRow() === 0) return 0;
  var values = sheet.getDataRange().getDisplayValues(), i;
  var id = String(req.id || "").trim();
  if (id && map.id >= 0) {
    for (i = map.start; i < values.length; i++) if (String(values[i][map.id] || "").trim() === id) return i + 1;
  }
  var orig = req.orig || {}, hint = Number(req.row) || 0;
  function same(r) {
    for (var k = 0; k < TEXT.length; k++) {
      var f = TEXT[k];
      var cell = map[f] >= 0 ? String(values[r][map[f]] || "") : "";
      if (cell !== String(orig[f] || "")) return false;
    }
    return true;
  }
  if (hint && hint - 1 >= map.start && hint - 1 < values.length && same(hint - 1)) return hint;
  for (i = map.start; i < values.length; i++) if (same(i)) return i + 1;
  return 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function msg_(err) { return String((err && err.message) || err); }
