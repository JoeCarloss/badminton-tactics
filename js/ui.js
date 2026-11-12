/* Input, canvas fitting, frame playback, and the play library UI. */
(function (global) {
  'use strict';
  var BTS = global.BTS, S = BTS.state, COURT = BTS.COURT, M = BTS.M, clamp = BTS.clamp;

  var $ = function (id) { return document.getElementById(id); };
  var canvas, ctx, stage, view, tool = 'move', active = null, dirty = false;
  var anim = null;   // { t0, total }

  // How far a marker may stray outside the lines. Kept a disc-radius inside
  // the run-off so a dragged player clips exactly as much as it used to.
  var OUT = 0.45;
  var LIM = {
    x0: -OUT, x1: COURT.widthDoubles + OUT,
    ourY0: COURT.netY + 0.30, ourY1: COURT.length + OUT,
    theirY0: -OUT, theirY1: COURT.netY - 0.30
  };

  /* ---------- layout ----------
     The court is fitted first and the panel takes whatever band is left over,
     so the court is always at its maximum size for the screen. Which edge the
     panel ends up on falls out of the arithmetic rather than being hard-coded. */

  var PANEL_MIN_W = 188;   // narrowest usable column
  var PANEL_MIN_H = 128;   // shortest usable band
  var PANEL_MAX_FRAC = 0.45;
  var GAP = 6;
  var STAGE_PAD = 10;      // .stage padding, both sides

  var app, framebar, panel;

  function fitCourt(w, h, dpr) {
    return BTS.createView().fitTo(Math.max(40, w - STAGE_PAD), Math.max(40, h - STAGE_PAD), dpr);
  }

  /* How tall the panel's content really is at a given width and arrangement.
     Measured off-flow, because assuming a minimum fits is exactly what broke
     on phones. */
  function panelNeeds(mode, width) {
    var prevLayout = app.dataset.layout;
    var prevStyle = panel.getAttribute('style');
    var wasHidden = panel.hidden;
    panel.hidden = false;
    app.dataset.layout = mode;
    panel.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;' +
      'width:' + Math.max(80, width) + 'px;height:auto;max-height:none;overflow:visible;';
    var h = panel.scrollHeight;
    if (prevStyle === null) panel.removeAttribute('style');
    else panel.setAttribute('style', prevStyle);
    app.dataset.layout = prevLayout || 'bottom';
    panel.hidden = wasHidden;
    return h;
  }

  function layout() {
    var cs = getComputedStyle(app);
    var W = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W < 10 || H < 10) return;

    var fb = framebar.offsetHeight || 40;
    var stageH = H - fb - GAP;          // height left for the court itself
    var collapsed = !!S.prefs.panelHidden;

    var mode, box;
    if (collapsed) {
      mode = 'bottom';
      box = { w: W, h: stageH };
    } else {
      // Panel below: it spans the full width, so its height is what it needs.
      var needBelow = panelNeeds('bottom', W);
      var bandH = clamp(needBelow, PANEL_MIN_H, Math.round(H * PANEL_MAX_FRAC));
      var below = fitCourt(W, stageH - GAP - bandH, 1);

      // Panel beside: widen it until its content fits the full height. Extra
      // width turns into extra columns, which is what shortens it.
      var maxW = Math.max(PANEL_MIN_W, Math.round(W * PANEL_MAX_FRAC));
      var bandW = PANEL_MIN_W, needSide = 0;
      for (var w = PANEL_MIN_W; w <= maxW; w += 56) {
        bandW = w;
        needSide = panelNeeds('side', w);
        if (needSide <= H) break;
      }
      var side = fitCourt(W - GAP - bandW, stageH, 1);

      // Fitting the panel is worth giving up some court, but not a lot: a band
      // the panel must scroll in costs 15%, so a far bigger court still wins.
      var SCROLL_PENALTY = 0.85;
      var scoreSide = side.scale * (needSide <= H ? 1 : SCROLL_PENALTY);
      var scoreBelow = below.scale * (needBelow <= bandH ? 1 : SCROLL_PENALTY);
      var useSide = scoreSide >= scoreBelow;

      mode = useSide ? 'side' : 'bottom';
      box = useSide ? { w: W - GAP - bandW, h: stageH }
                    : { w: W, h: stageH - GAP - bandH };
    }

    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    view.fitTo(Math.max(40, box.w - STAGE_PAD), Math.max(40, box.h - STAGE_PAD), dpr);

    app.dataset.layout = mode;
    panel.hidden = collapsed;
    if (collapsed) {
      app.style.gridTemplateColumns = 'minmax(0, 1fr)';
      app.style.gridTemplateRows = 'minmax(0, 1fr)';
    } else if (mode === 'side') {
      app.style.gridTemplateColumns = (view.cssW + STAGE_PAD) + 'px minmax(0, 1fr)';
      app.style.gridTemplateRows = 'minmax(0, 1fr)';
    } else {
      app.style.gridTemplateColumns = 'minmax(0, 1fr)';
      app.style.gridTemplateRows = (view.cssH + STAGE_PAD + GAP + fb) + 'px minmax(0, 1fr)';
    }

    canvas.style.width = view.cssW + 'px';
    canvas.style.height = view.cssH + 'px';
    canvas.width = Math.round(view.cssW * dpr);
    canvas.height = Math.round(view.cssH * dpr);
    canvasRect = null;
    draw();
  }

  /* ---------- frame interpolation / playback ---------- */

  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function blend(a, b, t) {
    return {
      players: a.players.map(function (p, i) {
        var q = b.players[i] || p;
        return { name: p.name, team: p.team, x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) };
      }),
      shuttle: { x: lerp(a.shuttle.x, b.shuttle.x, t), y: lerp(a.shuttle.y, b.shuttle.y, t) },
      strokes: a.strokes
    };
  }

  function playing() { return anim !== null; }

  function startPlayback() {
    var doc = S.doc;
    if (doc.frames.length < 2) { toast('프레임이 2개 이상이어야 재생됩니다.'); return; }
    anim = { t0: performance.now(), total: (doc.frames.length - 1) * S.prefs.frameMs };
    syncUI();
    requestAnimationFrame(step);
  }

  function stopPlayback(goToEnd) {
    if (!anim) return;
    anim = null;
    if (goToEnd) S.gotoFrame(S.doc.frames.length - 1);
    syncUI();
    draw();
  }

  function step(now) {
    if (!anim) return;
    var doc = S.doc;
    var elapsed = now - anim.t0;
    if (elapsed >= anim.total) { stopPlayback(true); return; }
    var pos = elapsed / S.prefs.frameMs;
    var i = Math.min(Math.floor(pos), doc.frames.length - 2);
    draw(blend(doc.frames[i], doc.frames[i + 1], ease(pos - i)));
    requestAnimationFrame(step);
  }

  /* ---------- drawing ---------- */

  var drawPending = false;

  function requestDraw() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(function () { drawPending = false; draw(); });
  }

  function draw(overrideFrame) {
    var doc = S.doc;
    var frame = overrideFrame || S.frame();
    var opts = {};
    if (!overrideFrame && !playing() && doc.index < doc.frames.length - 1) {
      opts.ghost = doc.frames[doc.index + 1];
    }
    BTS.render(ctx, view, doc, S.prefs, frame, opts);
  }

  function changed() {
    dirty = true;
    S.persist();
    syncUI();
    draw();
  }

  /* ---------- pointer input ---------- */

  var canvasRect = null;   // refreshed by layout(); the page itself never scrolls

  function at(e) {
    var r = canvasRect || (canvasRect = canvas.getBoundingClientRect());
    return view.unproject(e.clientX - r.left, e.clientY - r.top);
  }

  function nearSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    var t = len ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len, 0, 1) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function eraseAt(p) {
    var strokes = S.frame().strokes;
    for (var j = strokes.length - 1; j >= 0; j--) {
      var s = strokes[j], tol = M.eraseRadius + s.size;
      var hit = s.pts.some(function (a, i) {
        return i === 0 ? Math.hypot(p.x - a.x, p.y - a.y) < tol : nearSeg(p, s.pts[i - 1], a) < tol;
      });
      if (hit) { strokes.splice(j, 1); return true; }
    }
    return false;
  }

  function grabAt(p, frame) {
    var drawing = tool !== 'move';
    var pr = drawing ? M.playerRadius : Math.max(M.playerGrab, 26 / view.scale);
    var sr = drawing ? M.shuttleHeight * 0.55 : Math.max(M.shuttleGrab, 24 / view.scale);

    // Players are drawn on top, so they win a tie.
    var pick = -1, best = pr;
    frame.players.forEach(function (v, j) {
      if (!S.visiblePlayer(j)) return;
      var d = Math.hypot(p.x - v.x, p.y - v.y);
      if (d < best) { best = d; pick = j; }
    });
    if (pick >= 0) return { kind: 'player', i: pick };

    if (Math.hypot(p.x - frame.shuttle.x, p.y - frame.shuttle.y) < sr) {
      return { kind: 'shuttle' };
    }
    return null;
  }

  function onDown(e) {
    if (playing()) { stopPlayback(true); return; }
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
    var p = at(e), frame = S.frame();

    // Markers answer a direct touch whatever the tool is, so moving a player or
    // the shuttle never needs a mode change. Only drawing does.
    var grabbed = grabAt(p, frame);
    if (grabbed) {
      S.pushHistory();
      grabbed.id = e.pointerId;
      active = grabbed;
      return;
    }

    if (tool === 'move') {
      return;
    } else if (tool === 'erase') {
      S.pushHistory();
      active = { kind: 'erase', id: e.pointerId, last: p };
      if (eraseAt(p)) changed();
    } else {
      S.pushHistory();
      active = { kind: 'stroke', id: e.pointerId };
      frame.strokes.push({
        type: tool, color: S.prefs.penColor, size: S.prefs.penSize, pts: [p]
      });
      changed();
    }
  }

  function moveShuttle(p) {
    S.frame().shuttle = {
      x: clamp(p.x, LIM.x0, LIM.x1),
      y: clamp(p.y, -OUT, COURT.length + OUT)
    };
  }

  var MIN_STEP = 0.025;   // metres between recorded pen points (~1px on screen)
  var ERASE_STEP = 0.18;  // metres the eraser must travel before biting again

  function addPoint(s, p) {
    var last = s.pts[s.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return;
    s.pts.push(p);
  }

  function onMove(e) {
    if (!active || active.id !== e.pointerId) return;
    e.preventDefault();
    var frame = S.frame();

    if (active.kind === 'stroke') {
      var s = frame.strokes[frame.strokes.length - 1];
      if (!s) return;
      if (s.type === 'arrow') {
        s.pts = [s.pts[0], at(e)];
      } else {
        // Every sample the browser buffered since the last frame, so throttling
        // the redraw does not coarsen the ink.
        var batch = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
        if (batch && batch.length) {
          for (var i = 0; i < batch.length; i++) addPoint(s, at(batch[i]));
        } else {
          addPoint(s, at(e));
        }
      }
    } else {
      var p = at(e);
      if (active.kind === 'shuttle') {
        moveShuttle(p);
      } else if (active.kind === 'player') {
        var j = active.i, theirs = j >= 2;
        frame.players[j].x = clamp(p.x, LIM.x0, LIM.x1);
        frame.players[j].y = theirs
          ? clamp(p.y, LIM.theirY0, LIM.theirY1)
          : clamp(p.y, LIM.ourY0, LIM.ourY1);
      } else if (active.kind === 'erase') {
        // Only bite again once the finger has actually travelled, so a tap
        // takes one stroke rather than everything stacked under it.
        if (Math.hypot(p.x - active.last.x, p.y - active.last.y) >= ERASE_STEP) {
          active.last = p;
          eraseAt(p);
        }
      }
    }
    dirty = true;
    requestDraw();
  }

  function onUp(e) {
    if (!active || active.id !== e.pointerId) return;
    active = null;
    changed();
  }

  /* ---------- UI sync ---------- */

  function syncUI() {
    var doc = S.doc, prefs = S.prefs;

    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    $('doubles').classList.toggle('active', doc.mode === 'doubles');
    $('singles').classList.toggle('active', doc.mode === 'singles');

    $('zoneToggle').textContent = prefs.zoneOn ? '존 켜짐' : '존 꺼짐';
    $('zoneToggle').classList.toggle('active', prefs.zoneOn);
    $('zoneMode').textContent = prefs.autoZone ? '자동 존' : '원형 존';
    $('zoneMode').classList.toggle('active', !prefs.autoZone);

    $('radius').value = Math.round(prefs.zoneScale * 100);
    $('radiusVal').textContent = Math.round(prefs.zoneScale * 100) + '%';
    $('opacity').value = Math.round(prefs.zoneAlpha * 100);
    $('opacityVal').textContent = Math.round(prefs.zoneAlpha * 100) + '%';
    $('size').value = Math.round(prefs.penSize * 100);
    $('sizeVal').textContent = Math.round(prefs.penSize * 100) + 'cm';
    $('speed').value = prefs.frameMs;

    document.querySelectorAll('#swatches .swatch').forEach(function (b) {
      b.classList.toggle('active', b.dataset.color === prefs.penColor);
    });

    $('undo').disabled = !S.canUndo();
    $('redo').disabled = !S.canRedo();
    $('frameDel').disabled = doc.frames.length <= 1;
    $('framePrev').disabled = doc.index === 0;
    $('frameNext').disabled = doc.index >= doc.frames.length - 1;
    $('playBtn').textContent = playing() ? '■ 정지' : '▶ 재생';
    $('playBtn').classList.toggle('active', playing());

    $('togglePanel').textContent = S.prefs.panelHidden ? '도구 보기' : '도구 숨기기';
    $('togglePanel').classList.toggle('active', !!S.prefs.panelHidden);
    $('playLabel').textContent = S.playName || '저장되지 않은 전술';
    $('dirtyDot').hidden = !dirty;

    buildChips();
  }

  function buildChips() {
    var host = $('frameChips'), doc = S.doc;
    host.textContent = '';
    doc.frames.forEach(function (f, i) {
      var b = document.createElement('button');
      b.className = 'chip' + (i === doc.index ? ' active' : '');
      b.textContent = String(i + 1);
      b.setAttribute('role', 'tab');
      b.title = (i + 1) + '번 프레임';
      b.onclick = function () {
        stopPlayback(false);
        S.gotoFrame(i);
        syncUI();
        draw();
      };
      host.appendChild(b);
    });
  }

  /* ---------- toast ---------- */

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /* ---------- file out / in ---------- */

  function deliver(blob, filename, title) {
    var file = null;
    try { file = new File([blob], filename, { type: blob.type }); } catch (e) { /* older WebKit */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: title }).catch(function () {});
      return;
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function safeName(s) {
    return (s || 'tactics').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 48);
  }

  function exportPng() {
    var ev = BTS.createView();
    ev.rotated = view.rotated;
    ev.scale = 150;
    ev.dpr = 1;
    ev.cssW = Math.round((ev.rotated ? COURT.worldH : COURT.worldW) * ev.scale);
    ev.cssH = Math.round((ev.rotated ? COURT.worldW : COURT.worldH) * ev.scale);

    var c = document.createElement('canvas');
    c.width = ev.cssW;
    c.height = ev.cssH;
    var cx = c.getContext('2d');
    BTS.render(cx, ev, S.doc, S.prefs, S.frame());
    var label = (S.playName ? S.playName + ' ' : '') + (S.doc.index + 1) + '번';
    c.toBlob(function (blob) {
      if (!blob) { toast('이미지를 만들 수 없습니다.'); return; }
      deliver(blob, safeName(S.playName || 'badminton-tactics') + '-' + (S.doc.index + 1) + '.png',
        '배드민턴 전술 · ' + label);
    }, 'image/png');
  }

  function exportJson() {
    var bundle = S.exportBundle(null);
    if (!bundle.plays.length) { toast('저장된 전술이 없습니다.'); return; }
    var blob = new Blob([JSON.stringify(bundle, null, 1)], { type: 'application/json' });
    deliver(blob, 'badminton-tactics-' + bundle.plays.length + '.json', '배드민턴 전술 모음');
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); }
      catch (e) { toast('JSON을 읽을 수 없습니다.'); return; }
      var res = S.importBundle(data);
      if (res.error) { toast(res.error); return; }
      toast(res.added + '개 전술을 가져왔습니다.');
      renderLibrary();
    };
    reader.onerror = function () { toast('파일을 열 수 없습니다.'); };
    reader.readAsText(file);
  }

  /* ---------- library ---------- */

  function openLibrary(focusName) {
    $('playNameInput').value = S.playName || '';
    renderLibrary();
    $('library').hidden = false;
    if (focusName) setTimeout(function () { $('playNameInput').focus(); }, 60);
  }
  function closeLibrary() { $('library').hidden = true; }

  function renderLibrary() {
    var host = $('playList');
    host.textContent = '';
    var plays = S.listPlays();
    if (!plays.length) {
      var p = document.createElement('p');
      p.className = 'play-empty';
      p.textContent = '아직 저장된 전술이 없습니다. 이름을 적고 저장해 보세요.';
      host.appendChild(p);
      return;
    }
    plays.forEach(function (play) {
      var row = document.createElement('div');
      row.className = 'play-row' + (play.id === S.playId ? ' current' : '');

      var info = document.createElement('div');
      info.className = 'play-info';
      var b = document.createElement('b');
      b.textContent = play.name;
      var meta = document.createElement('span');
      meta.textContent = (play.mode === 'singles' ? '단식' : '복식') +
        ' · 프레임 ' + play.frames.length + '개 · ' +
        new Date(play.updatedAt || Date.now()).toLocaleDateString('ko-KR');
      info.appendChild(b);
      info.appendChild(meta);
      row.appendChild(info);

      row.appendChild(mkBtn('불러오기', 'primary', function () {
        if (dirty && !confirm('저장하지 않은 변경이 있습니다. 불러올까요?')) return;
        if (S.loadPlay(play.id)) {
          dirty = false;
          closeLibrary();
          toast('“' + play.name + '” 불러왔습니다.');
          syncUI();
          draw();
        }
      }));
      row.appendChild(mkBtn('이름', '', function () {
        var next = prompt('전술 이름', play.name);
        if (next === null) return;
        if (S.renamePlay(play.id, next)) { renderLibrary(); syncUI(); }
      }));
      row.appendChild(mkBtn('삭제', '', function () {
        if (!confirm('“' + play.name + '”을(를) 삭제할까요?')) return;
        S.deletePlay(play.id);
        renderLibrary();
        syncUI();
      }));

      host.appendChild(row);
    });
  }

  function mkBtn(text, cls, fn) {
    var b = document.createElement('button');
    b.textContent = text;
    if (cls) b.className = cls;
    b.onclick = fn;
    return b;
  }

  function doSave(asNew) {
    var name = $('playNameInput').value;
    var rec = asNew ? S.saveAsNewPlay(name) : S.savePlay(name);
    if (!rec) { toast('저장 공간이 부족합니다.'); return; }
    dirty = false;
    toast('“' + rec.name + '” 저장했습니다.');
    renderLibrary();
    syncUI();
  }

  /* ---------- wiring ---------- */

  function bind() {
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.onclick = function () { tool = b.dataset.tool; syncUI(); };
    });

    $('doubles').onclick = function () { S.setMode('doubles'); changed(); };
    $('singles').onclick = function () { S.setMode('singles'); changed(); };

    $('zoneToggle').onclick = function () { S.prefs.zoneOn = !S.prefs.zoneOn; S.persist(); syncUI(); draw(); };
    $('zoneMode').onclick = function () { S.prefs.autoZone = !S.prefs.autoZone; S.persist(); syncUI(); draw(); };
    $('radius').oninput = function (e) { S.prefs.zoneScale = +e.target.value / 100; S.persist(); syncUI(); draw(); };
    $('opacity').oninput = function (e) { S.prefs.zoneAlpha = +e.target.value / 100; S.persist(); syncUI(); draw(); };
    $('size').oninput = function (e) { S.prefs.penSize = +e.target.value / 100; S.persist(); syncUI(); };
    $('speed').oninput = function (e) { S.prefs.frameMs = +e.target.value; S.persist(); };

    document.querySelectorAll('#swatches .swatch').forEach(function (b) {
      b.onclick = function () { S.prefs.penColor = b.dataset.color; S.persist(); syncUI(); };
    });

    $('undo').onclick = function () { if (S.undo()) { dirty = true; S.persist(); syncUI(); draw(); } };
    $('redo').onclick = function () { if (S.redo()) { dirty = true; S.persist(); syncUI(); draw(); } };
    $('clearInk').onclick = function () {
      if (!S.frame().strokes.length) return;
      if (!confirm('이 프레임의 그림을 모두 지울까요?')) return;
      S.pushHistory();
      S.frame().strokes = [];
      changed();
    };
    $('resetPlayers').onclick = function () { S.resetPlayers(); changed(); };
    $('resetShuttle').onclick = function () { S.resetShuttle(); changed(); };
    $('savePng').onclick = exportPng;

    $('framePrev').onclick = function () { stopPlayback(false); S.gotoFrame(S.doc.index - 1); syncUI(); draw(); };
    $('frameNext').onclick = function () { stopPlayback(false); S.gotoFrame(S.doc.index + 1); syncUI(); draw(); };
    $('frameAdd').onclick = function () { stopPlayback(false); S.addFrame(); changed(); };
    $('frameDel').onclick = function () { stopPlayback(false); if (S.removeFrame()) changed(); };
    $('playBtn').onclick = function () { playing() ? stopPlayback(true) : startPlayback(); };

    $('togglePanel').onclick = function () {
      S.prefs.panelHidden = !S.prefs.panelHidden;
      S.persist();
      syncUI();
      layout();
    };
    $('openLibrary').onclick = function () { stopPlayback(false); openLibrary(false); };
    $('quickSave').onclick = function () {
      if (S.playName) { $('playNameInput').value = S.playName; doSave(false); }
      else openLibrary(true);
    };
    $('closeLibrary').onclick = closeLibrary;
    $('library').onclick = function (e) { if (e.target === $('library')) closeLibrary(); };
    $('saveCurrent').onclick = function () { doSave(false); };
    $('saveAsNew').onclick = function () { doSave(true); };
    $('newPlay').onclick = function () {
      if (dirty && !confirm('저장하지 않은 변경이 있습니다. 새 전술을 시작할까요?')) return;
      S.newPlay();
      dirty = false;
      closeLibrary();
      syncUI();
      draw();
    };
    $('exportAll').onclick = exportJson;
    $('importBtn').onclick = function () { $('importFile').click(); };
    $('importFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importJson(f);
      e.target.value = '';
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    // Safari pinch-zooms the whole page otherwise.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
      document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
    });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT') return;
      var mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? $('redo') : $('undo')).click();
      } else if (e.key === ' ') {
        e.preventDefault();
        $('playBtn').click();
      } else if (e.key === 'ArrowLeft') $('framePrev').click();
      else if (e.key === 'ArrowRight') $('frameNext').click();
      else if (e.key === 'Escape') closeLibrary();
    });

    if (global.ResizeObserver) new ResizeObserver(layout).observe(app);
    global.addEventListener('resize', layout);
    global.addEventListener('orientationchange', function () {
      setTimeout(layout, 80);
    });
  }

  function init() {
    canvas = $('court');
    ctx = canvas.getContext('2d');
    stage = $('stage');
    app = document.querySelector('.app');
    framebar = document.querySelector('.framebar');
    panel = document.querySelector('.panel');
    view = BTS.createView();
    S.loadSession();
    bind();
    syncUI();
    layout();
  }

  function boot() {
    try { init(); }
    catch (e) {
      if (global.BTSERR) global.BTSERR('INIT 실패', e && (e.stack || e.message) || e);
      throw e;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  BTS.ui = { toast: toast, draw: draw, layout: layout };
})(window);
