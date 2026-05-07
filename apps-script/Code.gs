/**
 * ─────────────────────────────────────────────────────────────────
 *  Google Docs Revision Analyser — Apps Script Compute + Storage
 * ─────────────────────────────────────────────────────────────────
 *
 *  Chunked execution model (bypasses the 6-minute trigger limit):
 *    1. doPost creates a job and a 1-minute trigger, returns jobId immediately.
 *    2. runPendingAnalyses fires, exports revisions in chunks.
 *       If it approaches the 5-minute safety wall it saves a cursor and
 *       schedules the next continuation trigger (30s later).
 *    3. Each chunk appends completed entries to ResultCache sheet.
 *    4. Final chunk assembles user summary and marks the job done.
 *
 *  Sheets used:
 *    RevisionAnalyses — permanent final results
 *    Jobs             — job status + progress
 *    ResultCache      — per-revision diff entries (cleared after job done)
 *
 *  Script Properties (per job):
 *    sa_{jobId}            — service account JSON
 *    cursor_{jobId}        — last saved resume position
 *    revs_n_{jobId}        — number of revision-list chunks
 *    revs_{n}_{jobId}      — revision list chunks (8 KB each)
 *  lastGoodText is never stored — re-exported fresh each chunk.
 * ─────────────────────────────────────────────────────────────────
 */

// ── Constants ─────────────────────────────────────────────────────

var SHEET_NAME    = "RevisionAnalyses";
var JOBS_SHEET    = "Jobs";
var RESULT_SHEET  = "ResultCache";
var ENTRIES_SHEET = "RevisionEntries"; // permanent per-revision diff storage (replaces revisionsJson cell)
var REV_CHUNK_SIZE = 8000; // chars per Script Property chunk for revision list

var TZ_OFFSET_HOURS = 8;
var TZ_LABEL        = "SGT";
var DELAY_MS        = 500;
var MAX_RETRIES     = 5;
var MAX_RUNTIME_MS  = 5 * 60 * 1000; // stop exporting at 5 min, leave buffer for cleanup

// ── Timezone ──────────────────────────────────────────────────────

function toSGT(date) {
  if (!date) return "";
  var d = new Date(new Date(date).getTime() + TZ_OFFSET_HOURS * 3600000);
  var p = function(n) { return String(n).padStart(2, "0"); };
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth()+1) + "-" + p(d.getUTCDate())
    + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds())
    + " " + TZ_LABEL;
}

function nowSGT() { return toSGT(new Date()); }

// ── Spreadsheet bootstrap ─────────────────────────────────────────

function getOrCreateSpreadsheet() {
  var files = DriveApp.getFilesByName(SHEET_NAME);
  if (files.hasNext()) return SpreadsheetApp.open(files.next());
  var ss = SpreadsheetApp.create(SHEET_NAME);
  initSheets(ss);
  return ss;
}

// Run this function directly from the Apps Script editor to create/update sheets.
function setup() {
  initSheets(getOrCreateSpreadsheet());
}

function initSheets(ss) {
  var hdr = function(sheet, cols) {
    sheet.appendRow(cols);
    sheet.getRange(1, 1, 1, cols.length).setFontWeight("bold").setBackground("#1a1a18").setFontColor("#fff");
    sheet.setFrozenRows(1);
  };

  var main = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (main.getLastRow() === 0) hdr(main, [
    "fileId","analysedAt","timezone","totalRevisions","exportErrors",
    "contributors","totalWordsAdded","totalWordsRemoved","userSummaryJson","revisionsJson"
  ]);

  var jobs = ss.getSheetByName(JOBS_SHEET) || ss.insertSheet(JOBS_SHEET);
  if (jobs.getLastRow() === 0) hdr(jobs, [
    "jobId","fileId","status","progress","current","total","createdAt","updatedAt","resultJson"
  ]);

  var res = ss.getSheetByName(RESULT_SHEET) || ss.insertSheet(RESULT_SHEET);
  if (res.getLastRow() === 0) hdr(res, ["jobId","revisionIndex","entryJson"]);

  var ent = ss.getSheetByName(ENTRIES_SHEET) || ss.insertSheet(ENTRIES_SHEET);
  if (ent.getLastRow() === 0) hdr(ent, ["fileId","revisionIndex","entryJson"]);

  var def = ss.getSheetByName("Sheet1");
  if (def && ss.getSheets().length > 4) try { ss.deleteSheet(def); } catch(e) {}
}

// ── Generic sheet helpers ─────────────────────────────────────────

function findRow(sheet, colIndex, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][colIndex] === value) return i + 1;
  }
  return -1;
}

// ── Job management ────────────────────────────────────────────────

function createJob(jobId, fileId) {
  var ss   = getOrCreateSpreadsheet();
  var jobs = ss.getSheetByName(JOBS_SHEET);
  jobs.appendRow([jobId, fileId, "pending", "Queued — starting shortly...", 0, 0, nowSGT(), nowSGT(), ""]);
  SpreadsheetApp.flush();
}

function updateJob(ss, jobId, status, progress, current, total, resultJson) {
  var jobs = ss.getSheetByName(JOBS_SHEET);
  var row  = findRow(jobs, 0, jobId);
  if (row < 0) return;
  jobs.getRange(row, 3).setValue(status);
  jobs.getRange(row, 4).setValue(progress || "");
  if (current !== null) jobs.getRange(row, 5).setValue(current);
  if (total   !== null) jobs.getRange(row, 6).setValue(total);
  jobs.getRange(row, 8).setValue(nowSGT());
  if (resultJson !== null && resultJson !== undefined) jobs.getRange(row, 9).setValue(resultJson);
  SpreadsheetApp.flush();
}

function getJob(jobId) {
  var ss   = getOrCreateSpreadsheet();
  var jobs = ss.getSheetByName(JOBS_SHEET);
  if (!jobs) return null;
  var data = jobs.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === jobId) {
      return { jobId: data[i][0], fileId: data[i][1], status: data[i][2],
               progress: data[i][3], current: data[i][4], total: data[i][5],
               resultJson: data[i][8] };
    }
  }
  return null;
}

// ── Revision list — Script Properties (chunked to stay under 9 KB/key) ──

function saveRevisions_(props, jobId, revisions) {
  var json   = JSON.stringify(revisions);
  var n      = Math.ceil(json.length / REV_CHUNK_SIZE) || 1;
  props.setProperty("revs_n_" + jobId, String(n));
  for (var i = 0; i < n; i++) {
    props.setProperty("revs_" + i + "_" + jobId,
      json.slice(i * REV_CHUNK_SIZE, (i + 1) * REV_CHUNK_SIZE));
  }
}

function loadRevisions_(props, jobId) {
  var n = parseInt(props.getProperty("revs_n_" + jobId) || "0", 10);
  if (!n) return null;
  var json = "";
  for (var i = 0; i < n; i++) {
    json += props.getProperty("revs_" + i + "_" + jobId) || "";
  }
  try { return JSON.parse(json); } catch(e) { return null; }
}

function deleteRevisions_(props, jobId) {
  var n = parseInt(props.getProperty("revs_n_" + jobId) || "0", 10);
  props.deleteProperty("revs_n_" + jobId);
  for (var i = 0; i < n; i++) props.deleteProperty("revs_" + i + "_" + jobId);
}

// ── ResultCache helpers ───────────────────────────────────────────

// Serialize one revision entry, dropping diff text if the result would exceed
// Sheets' 50 K character cell limit. Stats are always preserved.
var ENTRY_CELL_LIMIT = 45000;
function serializeEntry_(entry) {
  var json = JSON.stringify(entry);
  if (json.length <= ENTRY_CELL_LIMIT) return json;
  var slim = {
    revisionIndex:   entry.revisionIndex,
    revisionId:      entry.revisionId,
    modifiedTime:    entry.modifiedTime,
    modifiedTimeSGT: entry.modifiedTimeSGT,
    modifiedBy:      entry.modifiedBy,
    isFirstRevision: entry.isFirstRevision,
    hasChanges:      entry.hasChanges,
    diffTruncated:   true,
  };
  if (entry.diff)  slim.diff  = { added: [], removed: [], stats: entry.diff.stats };
  if (entry.error) slim.error = entry.error;
  return JSON.stringify(slim);
}

function appendEntry(ss, jobId, revisionIndex, entry) {
  var sheet = ss.getSheetByName(RESULT_SHEET);
  if (!sheet) { initSheets(ss); sheet = ss.getSheetByName(RESULT_SHEET); }
  sheet.appendRow([jobId, revisionIndex, serializeEntry_(entry)]);
}

function loadEntries(ss, jobId) {
  var sheet = ss.getSheetByName(RESULT_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data    = sheet.getDataRange().getValues();
  var entries = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === jobId) {
      try { entries.push(JSON.parse(data[i][2])); } catch(e) {}
    }
  }
  entries.sort(function(a, b) { return a.revisionIndex - b.revisionIndex; });

  // Deduplicate by revisionIndex — protects against double-writes if a
  // trigger was killed after appendEntry but before the cursor was saved.
  var seen = {};
  entries = entries.filter(function(e) {
    if (seen[e.revisionIndex]) return false;
    seen[e.revisionIndex] = true;
    return true;
  });

  return entries;
}

function countResultEntries_(ss, jobId) {
  var sheet = ss.getSheetByName(RESULT_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  var data  = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === jobId) count++;
  }
  return count;
}

function deleteJobCache(ss, jobId) {
  var sheet = ss.getSheetByName(RESULT_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === jobId) sheet.deleteRow(i + 1);
    }
    SpreadsheetApp.flush();
  }
}

// ── RevisionEntries — permanent per-fileId diff storage ──────────
// Avoids the 50 K Sheets cell limit that would apply to revisionsJson.

function saveRevisionEntries_(ss, fileId, allEntries) {
  var sheet = ss.getSheetByName(ENTRIES_SHEET);
  if (!sheet) { initSheets(ss); sheet = ss.getSheetByName(ENTRIES_SHEET); }

  // Build full rewrite: keep rows for other fileIds, replace rows for this one
  var existing = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues().slice(1) : [];
  var kept     = existing.filter(function(r) { return r[0] !== fileId; });
  var newRows  = allEntries.map(function(e) {
    return [fileId, e.revisionIndex, serializeEntry_(e)];
  });
  var all = kept.concat(newRows);

  sheet.clearContents();
  sheet.appendRow(["fileId","revisionIndex","entryJson"]);
  sheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#1a1a18").setFontColor("#fff");
  if (all.length > 0) sheet.getRange(2, 1, all.length, 3).setValues(all);
  SpreadsheetApp.flush();
}

function loadRevisionEntries_(ss, fileId) {
  var sheet = ss.getSheetByName(ENTRIES_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data    = sheet.getDataRange().getValues();
  var entries = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === fileId) {
      try { entries.push(JSON.parse(data[i][2])); } catch(e) {}
    }
  }
  entries.sort(function(a, b) { return a.revisionIndex - b.revisionIndex; });
  return entries;
}

// ── Diff engine ───────────────────────────────────────────────────

function diffWords(prev, curr) {
  var prevWords = prev.split(/\s+/).filter(function(w){ return w.length > 0; });
  var currWords = curr.split(/\s+/).filter(function(w){ return w.length > 0; });

  var m = prevWords.length, n = currWords.length;
  var dp = [];
  for (var i = 0; i <= m; i++) dp[i] = new Array(n + 1).fill(0);
  for (var i = 1; i <= m; i++) {
    for (var j = 1; j <= n; j++) {
      dp[i][j] = prevWords[i-1] === currWords[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }

  var added = [], removed = [];
  var i = m, j = n;
  var addedBuf = [], removedBuf = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && prevWords[i-1] === currWords[j-1]) {
      if (addedBuf.length)   { added.unshift(addedBuf.reverse().join(" "));   addedBuf = []; }
      if (removedBuf.length) { removed.unshift(removedBuf.reverse().join(" ")); removedBuf = []; }
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      addedBuf.push(currWords[j-1]); j--;
    } else {
      removedBuf.push(prevWords[i-1]); i--;
    }
  }
  if (addedBuf.length)   added.unshift(addedBuf.reverse().join(" "));
  if (removedBuf.length) removed.unshift(removedBuf.reverse().join(" "));

  added   = added.filter(function(s){ return s.trim().length >= 2; });
  removed = removed.filter(function(s){ return s.trim().length >= 2; });

  var addedWords   = added.join(" ").split(/\s+/).filter(Boolean).length;
  var removedWords = removed.join(" ").split(/\s+/).filter(Boolean).length;

  return {
    added: added, removed: removed,
    stats: { wordsAdded: addedWords, wordsRemoved: removedWords,
             charsAdded: added.join("").length, charsRemoved: removed.join("").length,
             netWords: addedWords - removedWords }
  };
}

// ── Revision export ───────────────────────────────────────────────

function exportRevisionText(fileId, revisionId, accessToken) {
  var url = "https://docs.google.com/feeds/download/documents/export/Export"
    + "?id=" + fileId + "&revision=" + revisionId + "&exportFormat=txt";

  for (var attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      var resp = UrlFetchApp.fetch(url, {
        headers: { Authorization: "Bearer " + accessToken },
        muteHttpExceptions: true,
      });
      var code = resp.getResponseCode();
      if (code === 200) return resp.getContentText().replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim();
      if (code === 429 || code === 500 || code === 503) {
        if (attempt < MAX_RETRIES) { Utilities.sleep(Math.pow(2, attempt) * 1500); continue; }
        return { error: "HTTP " + code + " after " + MAX_RETRIES + " retries" };
      }
      return { error: "HTTP " + code };
    } catch(e) {
      if (attempt < MAX_RETRIES) Utilities.sleep(Math.pow(2, attempt) * 1500);
      else return { error: e.message };
    }
  }
  return { error: "Max retries exceeded" };
}

// ── Save final result to Analyses sheet ──────────────────────────

function saveResults(ss, fileId, analysedAt, userSummary, revisionEntries, exportErrorCount) {
  var main              = ss.getSheetByName(SHEET_NAME);
  var totalWordsAdded   = userSummary.reduce(function(s,u){ return s + u.totalWordsAdded; }, 0);
  var totalWordsRemoved = userSummary.reduce(function(s,u){ return s + u.totalWordsRemoved; }, 0);
  // revisionsJson (col 10) is intentionally left empty — full diff data lives in
  // the RevisionEntries sheet to avoid the 50 K Sheets cell-character limit.
  var rowData = [
    fileId, analysedAt, "Asia/Singapore (UTC+8)",
    revisionEntries.length, exportErrorCount, userSummary.length,
    totalWordsAdded, totalWordsRemoved,
    JSON.stringify(userSummary), "",
  ];
  var existingRow = findRow(main, 0, fileId);
  if (existingRow > 0) main.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  else main.appendRow(rowData);
  SpreadsheetApp.flush();

  // Store full revision entries (with diff text) in dedicated sheet
  saveRevisionEntries_(ss, fileId, revisionEntries);
}

// ── Service account auth ──────────────────────────────────────────

function getAccessToken(sa) {
  try {
    var now     = Math.floor(Date.now() / 1000);
    var header  = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    var payload = Utilities.base64EncodeWebSafe(JSON.stringify({
      iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now,
    }));
    var signInput = header + "." + payload;
    var signature = Utilities.base64EncodeWebSafe(
      Utilities.computeRsaSha256Signature(signInput, sa.private_key)
    );
    var tokenResp = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
      method: "post",
      payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signInput + "." + signature },
      muteHttpExceptions: true,
    });
    var tokenJson = JSON.parse(tokenResp.getContentText());
    if (tokenJson.access_token) return tokenJson.access_token;
    return { error: tokenJson.error_description || "Unknown auth error" };
  } catch(e) {
    return { error: e.message };
  }
}

// ── Chunked analysis engine ───────────────────────────────────────

// Main trigger handler — called on first fire and every continuation.
function runPendingAnalyses() {
  // Prevent two trigger instances from processing simultaneously.
  // If a concurrent invocation is already running, exit immediately.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;

  try {
    var ss    = getOrCreateSpreadsheet();
    var jobs  = ss.getSheetByName(JOBS_SHEET);
    var props = PropertiesService.getScriptProperties();

    if (!jobs || jobs.getLastRow() <= 1) { cleanupTriggers_(); return; }

    var data = jobs.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var status = data[i][2];
      if (status !== "pending" && status !== "exporting") continue;

      var jobId  = data[i][0];
      var fileId = data[i][1];
      var saJson = props.getProperty("sa_" + jobId);

      if (!saJson) {
        updateJob(ss, jobId, "error", "Service account missing — please re-submit.", 0, 0, null);
        continue;
      }

      // Each job gets its own fresh 5-minute budget so earlier jobs
      // don't eat into the time available for jobs queued behind them.
      var jobStartTime      = Date.now();
      var needsContinuation = processChunk_(ss, jobId, fileId, saJson, props, jobStartTime);

      if (needsContinuation) {
        cleanupTriggers_();
        ScriptApp.newTrigger("runPendingAnalyses").timeBased().after(30 * 1000).create();
        return;
      }

      // Job finished (done or errored) — clean up all Script Properties and cache
      props.deleteProperty("sa_" + jobId);
      props.deleteProperty("cursor_" + jobId);
      props.deleteProperty("since_" + jobId);
      deleteRevisions_(props, jobId);
      deleteJobCache(ss, jobId);
    }

    cleanupTriggers_();
  } finally {
    lock.releaseLock();
  }
}

function cleanupTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "runPendingAnalyses") ScriptApp.deleteTrigger(t);
  });
}

// Processes one chunk of a job. Returns true if more work remains.
function processChunk_(ss, jobId, fileId, saJson, props, startTime) {
  var sa    = JSON.parse(saJson);
  var token = getAccessToken(sa);
  if (token.error) {
    updateJob(ss, jobId, "error", "Auth failed: " + token.error, 0, 0, null);
    return false;
  }

  // Cursor: take the higher of the saved value and ResultCache row count.
  // ResultCache rows survive hard kills; Script Properties may be stale.
  var savedCursor = parseInt(props.getProperty("cursor_" + jobId) || "0", 10);
  var resultCount = countResultEntries_(ss, jobId);
  var cursor      = Math.max(savedCursor, resultCount);
  var revisions   = loadRevisions_(props, jobId);

  // ── First chunk (or recovery after lost properties): fetch revision list ─
  if (!revisions) {
    updateJob(ss, jobId, "exporting", "Fetching revision list...", 0, 0, null);

    var revUrl  = "https://www.googleapis.com/drive/v3/files/" + fileId
      + "/revisions?fields=revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress))&pageSize=1000";
    var revResp = UrlFetchApp.fetch(revUrl, {
      headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true,
    });

    if (revResp.getResponseCode() !== 200) {
      updateJob(ss, jobId, "error",
        "Could not fetch revisions (HTTP " + revResp.getResponseCode() + "). "
        + "Ensure the Doc is shared with the service account.", 0, 0, null);
      return false;
    }

    revisions = JSON.parse(revResp.getContentText()).revisions || [];
    if (!revisions.length) {
      updateJob(ss, jobId, "error", "No revisions found for this file.", 0, 0, null);
      return false;
    }

    // Slice to only new revisions when re-analysing
    var sinceJson = props.getProperty("since_" + jobId);
    if (sinceJson) {
      var sinceData = JSON.parse(sinceJson);
      var sinceIdx  = -1;
      for (var s = 0; s < revisions.length; s++) {
        if (revisions[s].id === sinceData.id) { sinceIdx = s; break; }
      }
      if (sinceIdx >= 0) {
        revisions = revisions.slice(sinceIdx + 1);
      } else {
        // Anchor not found — fall back to full re-analysis
        props.deleteProperty("since_" + jobId);
        sinceJson = null;
      }
    }

    saveRevisions_(props, jobId, revisions);
    updateJob(ss, jobId, "exporting",
      "Found " + revisions.length + " new revisions. Exporting...", cursor, revisions.length, null);
  }

  var total    = revisions.length;
  var sinceJson = props.getProperty("since_" + jobId);

  // lastGoodText is never stored (document text can exceed the 50 K Sheets cell
  // limit and the 9 KB Script Property limit). Re-export the previous revision
  // at the start of each chunk instead — costs one extra API call per chunk.
  var lastGoodText = "";
  if (cursor > 0) {
    for (var k = cursor - 1; k >= 0; k--) {
      var recovered = exportRevisionText(fileId, revisions[k].id, token);
      if (typeof recovered === "string") { lastGoodText = recovered; break; }
    }
  } else if (sinceJson) {
    // Re-analysis first chunk: seed lastGoodText from the anchor revision
    // so the first new revision diffs correctly against the previous content.
    var sd0  = JSON.parse(sinceJson);
    var seed = exportRevisionText(fileId, sd0.id, token);
    if (typeof seed === "string") lastGoodText = seed;
  }

  // ── Export loop ───────────────────────────────────────────────
  for (var i = cursor; i < total; i++) {

    // Time check — save state and request continuation if budget exceeded
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      props.setProperty("cursor_" + jobId, String(i));
      updateJob(ss, jobId, "exporting",
        "Exported " + i + "/" + total + " revisions — continuing shortly...",
        i, total, null);
      return true; // continuation needed
    }

    var rev      = revisions[i];
    var userName = (rev.lastModifyingUser && rev.lastModifyingUser.displayName) || "Unknown";

    updateJob(ss, jobId, "exporting",
      "Exporting " + (i+1) + "/" + total + " — " + userName, i + 1, total, null);

    var result   = exportRevisionText(fileId, rev.id, token);
    var prevText = i === 0 ? "" : lastGoodText;

    var entry = {
      revisionIndex:   i + 1,
      revisionId:      rev.id,
      modifiedTime:    rev.modifiedTime,
      modifiedTimeSGT: toSGT(rev.modifiedTime),
      modifiedBy: {
        name:  (rev.lastModifyingUser && rev.lastModifyingUser.displayName)  || "Unknown",
        email: (rev.lastModifyingUser && rev.lastModifyingUser.emailAddress) || null,
      },
      isFirstRevision: i === 0,
    };

    if (typeof result === "string") {
      var diff    = diffWords(prevText, result);
      entry.diff  = diff;
      entry.hasChanges = diff.added.length > 0 || diff.removed.length > 0;
      lastGoodText = result;
    } else {
      entry.error      = "HTTP: " + result.error;
      entry.hasChanges = false;
    }

    // Persist entry immediately — survives trigger restarts
    appendEntry(ss, jobId, i + 1, entry);

    if (i < total - 1) Utilities.sleep(DELAY_MS);
  }

  // ── All revisions exported — assemble final result ────────────
  updateJob(ss, jobId, "running", "Building summary...", total, total, null);

  var allEntries  = loadEntries(ss, jobId); // new entries from this job only
  var sinceJson4  = props.getProperty("since_" + jobId);
  if (sinceJson4) {
    var sd4       = JSON.parse(sinceJson4);
    var baseIndex = sd4.index || 0;

    // Patch loop-local revisionIndex (1-based within the slice) → global index
    allEntries.forEach(function(e, i) {
      e.revisionIndex  = baseIndex + i + 1;
      e.isFirstRevision = false;
    });

    // Load existing revisions from RevisionEntries sheet (col 10 is now empty)
    var existingRevs = loadRevisionEntries_(ss, fileId);
    allEntries = existingRevs.concat(allEntries);
    allEntries.sort(function(a, b) { return a.revisionIndex - b.revisionIndex; });
  }
  var userMap      = {};
  var exportErrors = 0;

  allEntries.forEach(function(entry) {
    if (entry.error) { exportErrors++; return; }
    if (!entry.diff)  return;
    var key = entry.modifiedBy.email || entry.modifiedBy.name;
    if (!userMap[key]) {
      userMap[key] = {
        name: entry.modifiedBy.name, email: entry.modifiedBy.email,
        revisionsCount: 0, totalWordsAdded: 0, totalWordsRemoved: 0,
        totalCharsAdded: 0, totalCharsRemoved: 0,
        firstEditSGT: null, lastEditSGT: null,
      };
    }
    var u = userMap[key];
    u.revisionsCount++;
    u.totalWordsAdded   += entry.diff.stats.wordsAdded;
    u.totalWordsRemoved += entry.diff.stats.wordsRemoved;
    u.totalCharsAdded   += entry.diff.stats.charsAdded;
    u.totalCharsRemoved += entry.diff.stats.charsRemoved;
    if (!u.firstEditSGT) u.firstEditSGT = entry.modifiedTimeSGT;
    u.lastEditSGT = entry.modifiedTimeSGT;
  });

  var userSummary = Object.keys(userMap).map(function(k) { return userMap[k]; });
  var analysedAt  = nowSGT();

  saveResults(ss, fileId, analysedAt, userSummary, allEntries, exportErrors);

  // Revision detail is loaded via doGet?action=single — omit it from
  // the Jobs resultJson to stay well under the 50 K cell-character limit.
  updateJob(ss, jobId, "done", "Analysis complete", total, total, JSON.stringify({
    fileId:         fileId,
    generatedAt:    analysedAt,
    timezone:       "Asia/Singapore (UTC+8)",
    totalRevisions: allEntries.length,
    exportErrors:   exportErrors,
    userSummary:    userSummary,
  }));

  return false; // done
}

// ── HTTP handlers ─────────────────────────────────────────────────

function cors(output) {
  return output.setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;

    if (action === "status") {
      var job = getJob(e.parameter.jobId);
      if (!job) return cors(ContentService.createTextOutput(JSON.stringify({ error: "Job not found" })));
      var resp = { jobId: job.jobId, status: job.status, progress: job.progress,
                   current: job.current, total: job.total };
      if (job.status === "done" && job.resultJson) resp.result = JSON.parse(job.resultJson);
      return cors(ContentService.createTextOutput(JSON.stringify(resp)));
    }

    if (action === "history") {
      var ss = getOrCreateSpreadsheet();

      var sheet    = ss.getSheetByName(SHEET_NAME);
      var analyses = [];
      if (sheet && sheet.getLastRow() > 1) {
        analyses = sheet.getDataRange().getValues().slice(1).map(function(row) {
          return {
            fileId: row[0], analysedAt: row[1], timezone: row[2],
            totalRevisions: row[3], exportErrors: row[4], contributors: row[5],
            totalWordsAdded: row[6], totalWordsRemoved: row[7],
            userSummaryJson: JSON.parse(row[8] || "[]"),
          };
        });
      }

      var jobsSheet   = ss.getSheetByName(JOBS_SHEET);
      var pendingJobs = [];
      if (jobsSheet && jobsSheet.getLastRow() > 1) {
        var jobsData = jobsSheet.getDataRange().getValues();
        for (var i = 1; i < jobsData.length; i++) {
          var s = jobsData[i][2];
          if (s === "pending" || s === "exporting" || s === "running" || s === "error") {
            pendingJobs.push({
              jobId: jobsData[i][0], fileId: jobsData[i][1], status: s,
              progress: jobsData[i][3], current: jobsData[i][4],
              total: jobsData[i][5], createdAt: jobsData[i][6],
              updatedAt: jobsData[i][7],
            });
          }
        }
      }

      return cors(ContentService.createTextOutput(JSON.stringify({ analyses: analyses, pendingJobs: pendingJobs })));
    }

    if (action === "single") {
      var fileId = e.parameter.fileId;
      var ss     = getOrCreateSpreadsheet();
      var sheet  = ss.getSheetByName(SHEET_NAME);
      var data   = sheet.getDataRange().getValues();
      var row    = data.slice(1).filter(function(r){ return r[0] === fileId; })[0];
      if (!row) return cors(ContentService.createTextOutput(JSON.stringify({ error: "Not found" })));

      // Load from RevisionEntries sheet (current approach, no cell-size limit).
      // Fall back to the legacy revisionsJson column for analyses saved before this fix.
      var revisions = loadRevisionEntries_(ss, fileId);
      if (!revisions.length && row[9]) {
        try { revisions = JSON.parse(row[9]); } catch(ex) {}
      }

      return cors(ContentService.createTextOutput(JSON.stringify({
        analysis: {
          fileId: row[0], analysedAt: row[1], timezone: row[2],
          totalRevisions: row[3], exportErrors: row[4],
          userSummary: JSON.parse(row[8] || "[]"),
          revisions:   revisions,
        }
      })));
    }

    return cors(ContentService.createTextOutput(JSON.stringify({ error: "Unknown action" })));
  } catch(e) {
    return cors(ContentService.createTextOutput(JSON.stringify({ error: e.message })));
  }
}

function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === "start") {
      var fileId             = body.fileId;
      var serviceAccountJson = body.serviceAccountJson;

      if (!fileId || !serviceAccountJson) {
        return cors(ContentService.createTextOutput(
          JSON.stringify({ error: "fileId and serviceAccountJson required" })
        ));
      }

      var jobId = "job_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      createJob(jobId, fileId);

      // Stash SA and optional incremental-analysis anchor for the trigger to pick up
      var props_ = PropertiesService.getScriptProperties();
      props_.setProperty("sa_" + jobId, serviceAccountJson);
      var sinceRevisionId_    = body.sinceRevisionId    || null;
      var sinceRevisionIndex_ = body.sinceRevisionIndex != null ? Number(body.sinceRevisionIndex) : null;
      if (sinceRevisionId_) {
        props_.setProperty("since_" + jobId,
          JSON.stringify({ id: sinceRevisionId_, index: sinceRevisionIndex_ }));
      }

      // Always create a trigger for this job. Concurrent triggers are safe
      // because runPendingAnalyses uses LockService — only one runs at a time,
      // the rest exit immediately. This guarantees every job gets a trigger
      // even if one was submitted while a trigger was already executing.
      ScriptApp.newTrigger("runPendingAnalyses").timeBased().after(60 * 1000).create();

      return cors(ContentService.createTextOutput(JSON.stringify({ jobId: jobId })));
    }

    return cors(ContentService.createTextOutput(JSON.stringify({ error: "Unknown action" })));
  } catch(e) {
    return cors(ContentService.createTextOutput(JSON.stringify({ error: e.message })));
  }
}

function doOptions() {
  return cors(ContentService.createTextOutput(""));
}
