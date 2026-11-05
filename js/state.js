/* Document state, undo history, and persistence (session + play library). */
(function (global) {
  'use strict';
  var BTS = global.BTS, COURT = BTS.COURT;

  var SESSION_KEY = 'bts.session.v2';
  var PLAYS_KEY = 'bts.plays.v2';
  var LEGACY_KEY = 'bts-v1';
  var HISTORY_LIMIT = 60;

  function clone(v) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(v); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(v));
  }

  function defaultPlayers() {
    var cx = COURT.widthDoubles / 2;
    return [
      { name: 'A', team: 0, x: cx - 1.5, y: 9.80 },
      { name: 'B', team: 0, x: cx + 1.5, y: 9.80 },
      { name: 'C', team: 1, x: cx - 1.5, y: 3.60 },
      { name: 'D', team: 1, x: cx + 1.5, y: 3.60 }
    ];
  }

  function defaultFrame() {
    return {
      players: defaultPlayers(),
      shuttle: { x: COURT.widthDoubles / 2, y: COURT.netY },
      strokes: []
    };
  }

  var doc = {
    mode: 'doubles',
    frames: [defaultFrame()],
    index: 0
  };

  var prefs = {
    zoneOn: true,
    autoZone: true,
    zoneScale: 1,
    zoneAlpha: 0.30,
    penColor: '#ffe25c',
    penSize: 0.10,
    frameMs: 900,
    panelHidden: false
  };

  var playId = null;     // id in the library, if this doc came from one
  var playName = '';

  var past = [], future = [];

  function snapshot() { return clone(doc); }
  function restore(s) { doc = s; }

  function pushHistory() {
    past.push(snapshot());
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
  }
  function undo() {
    if (!past.length) return false;
    future.push(snapshot());
    restore(past.pop());
    return true;
  }
  function redo() {
    if (!future.length) return false;
    past.push(snapshot());
    restore(future.pop());
    return true;
  }

  function frame() { return doc.frames[doc.index]; }

  function addFrame() {
    pushHistory();
    var copy = clone(frame());
    doc.frames.splice(doc.index + 1, 0, copy);
    doc.index += 1;
  }
  function removeFrame() {
    if (doc.frames.length <= 1) return false;
    pushHistory();
    doc.frames.splice(doc.index, 1);
    if (doc.index >= doc.frames.length) doc.index = doc.frames.length - 1;
    return true;
  }
  function gotoFrame(i) {
    if (i < 0 || i >= doc.frames.length) return;
    doc.index = i;
  }

  function ourIndices() { return doc.mode === 'singles' ? [0] : [0, 1]; }
  function visiblePlayer(i) { return doc.mode !== 'singles' || (i !== 1 && i !== 3); }

  function resetPlayers() {
    pushHistory();
    var p = defaultPlayers();
    if (doc.mode === 'singles') {
      var cx = COURT.widthDoubles / 2;
      p[0].x = cx; p[2].x = cx;
    }
    frame().players = p;
    frame().shuttle = { x: COURT.widthDoubles / 2, y: COURT.netY };
  }

  /* ---------- persistence ---------- */

  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          doc: doc, prefs: prefs, playId: playId, playName: playName
        }));
      } catch (e) { /* private mode / quota: keep working in memory */ }
    }, 180);
  }

  function validFrame(f) {
    return f && Array.isArray(f.players) && f.players.length === 4 &&
      f.shuttle && typeof f.shuttle.x === 'number';
  }
  function validDoc(d) {
    return d && Array.isArray(d.frames) && d.frames.length && d.frames.every(validFrame);
  }

  function loadSession() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { raw = null; }
    if (raw && validDoc(raw.doc)) {
      doc = raw.doc;
      doc.index = BTS.clamp(doc.index | 0, 0, doc.frames.length - 1);
      doc.mode = raw.doc.mode === 'singles' ? 'singles' : 'doubles';
      if (raw.prefs) for (var k in prefs) if (raw.prefs[k] !== undefined) prefs[k] = raw.prefs[k];
      playId = raw.playId || null;
      playName = raw.playName || '';
      return;
    }
    migrateLegacy();
  }

  /* v1 stored a single arrangement in 760x1050 canvas pixels. */
  function migrateLegacy() {
    var old;
    try { old = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch (e) { return; }
    if (!old || !Array.isArray(old.players) || old.players.length !== 4) return;
    var BX = 167, BY = 55, BW = 426, BH = 940;
    var toM = function (p) {
      return { x: (p.x - BX) / BW * COURT.widthDoubles, y: (p.y - BY) / BH * COURT.length };
    };
    var f = defaultFrame();
    f.players = old.players.map(function (p, i) {
      var m = toM(p);
      return { name: p.name || 'ABCD'[i], team: i < 2 ? 0 : 1, x: m.x, y: m.y };
    });
    if (old.shuttle) f.shuttle = toM(old.shuttle);
    if (Array.isArray(old.strokes)) {
      f.strokes = old.strokes.filter(function (s) { return s && Array.isArray(s.pts); })
        .map(function (s) {
          return {
            type: s.type === 'arrow' ? 'arrow' : 'pen',
            color: s.color || '#ffe25c',
            size: (s.size || 7) / BH * COURT.length,
            pts: s.pts.map(toM)
          };
        });
    }
    doc = { mode: old.courtMode === 'singles' ? 'singles' : 'doubles', frames: [f], index: 0 };
    if (old.zoneOn !== undefined) prefs.zoneOn = old.zoneOn !== false;
    if (old.autoZone !== undefined) prefs.autoZone = old.autoZone !== false;
    if (old.zoneScale) prefs.zoneScale = old.zoneScale;
    if (old.zoneAlpha) prefs.zoneAlpha = old.zoneAlpha;
    playName = '이전 버전에서 가져온 배치';
  }

  /* ---------- play library ---------- */

  function readPlays() {
    try {
      var v = JSON.parse(localStorage.getItem(PLAYS_KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (p) { return p && validDoc(p); }) : [];
    } catch (e) { return []; }
  }
  function writePlays(list) {
    try { localStorage.setItem(PLAYS_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function listPlays() {
    return readPlays().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  }

  // Saves the current document. Updates in place when it came from the library
  // and the name is unchanged; otherwise adds a new entry.
  function savePlay(name) {
    name = (name || '').trim() || '이름 없는 전술';
    var list = readPlays();
    var record = {
      id: playId || newId(),
      name: name,
      mode: doc.mode,
      frames: clone(doc.frames),
      index: 0,
      updatedAt: Date.now()
    };
    var at = list.findIndex(function (p) { return p.id === record.id; });
    if (at >= 0) list[at] = record; else list.push(record);
    if (!writePlays(list)) return null;
    playId = record.id;
    playName = record.name;
    persist();
    return record;
  }

  function saveAsNewPlay(name) {
    playId = null;
    return savePlay(name);
  }

  function loadPlay(id) {
    var p = readPlays().find(function (x) { return x.id === id; });
    if (!p) return false;
    pushHistory();
    doc = { mode: p.mode === 'singles' ? 'singles' : 'doubles', frames: clone(p.frames), index: 0 };
    playId = p.id;
    playName = p.name;
    persist();
    return true;
  }

  function deletePlay(id) {
    var list = readPlays().filter(function (p) { return p.id !== id; });
    writePlays(list);
    if (playId === id) { playId = null; }
    persist();
  }

  function renamePlay(id, name) {
    name = (name || '').trim();
    if (!name) return false;
    var list = readPlays();
    var p = list.find(function (x) { return x.id === id; });
    if (!p) return false;
    p.name = name;
    p.updatedAt = Date.now();
    writePlays(list);
    if (playId === id) playName = name;
    persist();
    return true;
  }

  function newPlay() {
    pushHistory();
    doc = { mode: doc.mode, frames: [defaultFrame()], index: 0 };
    if (doc.mode === 'singles') {
      var cx = COURT.widthDoubles / 2;
      doc.frames[0].players[0].x = cx;
      doc.frames[0].players[2].x = cx;
    }
    playId = null;
    playName = '';
    persist();
  }

  /* ---------- import / export ---------- */

  function exportBundle(ids) {
    var list = readPlays();
    if (ids && ids.length) list = list.filter(function (p) { return ids.indexOf(p.id) >= 0; });
    return { app: 'badminton-tactics-studio', version: 2, exportedAt: Date.now(), plays: list };
  }

  function importBundle(data) {
    var incoming = data && Array.isArray(data.plays) ? data.plays
      : (Array.isArray(data) ? data : null);
    if (!incoming) return { added: 0, error: '전술 파일 형식이 아닙니다.' };
    var list = readPlays();
    var have = {};
    list.forEach(function (p) { have[p.id] = true; });
    var added = 0;
    incoming.forEach(function (p) {
      if (!validDoc(p)) return;
      var rec = {
        id: have[p.id] ? newId() : (p.id || newId()),
        name: (p.name || '가져온 전술') + (have[p.id] ? ' (사본)' : ''),
        mode: p.mode === 'singles' ? 'singles' : 'doubles',
        frames: clone(p.frames),
        index: 0,
        updatedAt: Date.now()
      };
      list.push(rec);
      have[rec.id] = true;
      added++;
    });
    if (!added) return { added: 0, error: '가져올 전술이 없습니다.' };
    if (!writePlays(list)) return { added: 0, error: '저장 공간이 부족합니다.' };
    return { added: added };
  }

  BTS.state = {
    get doc() { return doc; },
    prefs: prefs,
    get playId() { return playId; },
    get playName() { return playName; },
    frame: frame,
    clone: clone,
    pushHistory: pushHistory,
    undo: undo,
    redo: redo,
    canUndo: function () { return past.length > 0; },
    canRedo: function () { return future.length > 0; },
    addFrame: addFrame,
    removeFrame: removeFrame,
    gotoFrame: gotoFrame,
    setMode: function (m) {
      if (doc.mode === m) return;
      pushHistory();
      doc.mode = m;
    },
    ourIndices: ourIndices,
    visiblePlayer: visiblePlayer,
    resetPlayers: resetPlayers,
    defaultFrame: defaultFrame,
    persist: persist,
    loadSession: loadSession,
    listPlays: listPlays,
    savePlay: savePlay,
    saveAsNewPlay: saveAsNewPlay,
    loadPlay: loadPlay,
    deletePlay: deletePlay,
    renamePlay: renamePlay,
    newPlay: newPlay,
    exportBundle: exportBundle,
    importBundle: importBundle
  };
})(window);
