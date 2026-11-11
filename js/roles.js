/* 역할 연동 전술판 — paired movement with position-based roles.

   Ported from badminton_role_independent_stop_v10.html onto the real court.
   What the prototype does, kept intact:
     - roles come from who is currently in front, not from the player's number
     - a straight forward/back drag moves the pair without any sideways push
     - the pair stops when a disc edge reaches the net or the baseline
     - dragging into the opposite front/rear corner swaps the roles on release
     - 140° cover cones, toggled per player, hidden in side-by-side defence

   What changed in the port: that file drew the court 18% short lengthwise and
   derived the attack gap from the width scale, so a front/back pair really
   stood 2.82 m apart while the readout said 2.30 m. Everything here is metres
   on a true-proportion court, so the stated gaps are the gaps. */
(function (global) {
  'use strict';
  var BTS = global.BTS, COURT = BTS.COURT, clamp = BTS.clamp;
  var $ = function (id) { return document.getElementById(id); };

  var CX = COURT.widthDoubles / 2;                 // 3.05
  var NET = COURT.netY;                            // 6.70
  var SHORT = NET + COURT.shortService;            // 8.68
  var REAR_SERVICE = COURT.length - COURT.longServiceDoubles;  // 12.64

  var L = {
    playerR: 0.465,
    attackGap: 2.30,
    defGap: 3.05,
    defY: 10.51,
    rearY: (SHORT + REAR_SERVICE) / 2,   // 10.66, midway between service lines
    frontY: 9.02,
    rearTrigger: 11.52,
    frontTrigger: 9.74,
    midY: 10.90,
    advanceSpan: 1.56,
    minSplit: 2.67,
    leftX: 2.65, rightX: 3.45,
    coverLeft: 1.54, coverRight: 4.56,
    frontX: [2.75, 3.35],
    cornerL: 2.34, cornerR: 3.76,
    sideEntryY: [9.74, 11.27],
    sideStayY: [9.37, 11.65],
    sideEntryX: [2.24, 3.86],
    sameRow: 1.61,
    splitL: 2.55, splitR: 3.56,
    straightDrift: 0.24,   // sideways drag under this still counts as straight
    sameColumn: 0.51,      // pair this close in x counts as one column
    diagRearMin: 9.54,     // picking up a mid-rear player arms the diagonal
    diagRearMax: 11.47,
    diagCentre: 0.73,      // ... while they are this near the centre line
    diagPartnerY: 9.74,    // ... and the partner is front and wide
    diagDy: 0.49,          // the drag must carry this far back
    diagDx: 0.61,          // ... and this far across
    diagStep: 0.045,       // ... gaining this much along the diagonal
    diagMinY: 10.90,
    zoneReach: 5.05,
    eraseR: 0.34
  };
  // A disc edge may touch the net and the baseline, no further.
  L.minY = NET + L.playerR;
  L.maxY = COURT.length - L.playerR;
  L.xMin = L.playerR + 0.08;
  L.xMax = COURT.widthDoubles - L.playerR - 0.08;

  var FILL = [['#55c0ff', '#ffc65a'], ['#fa91b1', '#bba0ff']];
  var CONE = [['76,202,255', '255,194,65'], ['255,139,182', '186,154,255']];
  var ZONE = [['70,182,255', '255,194,65'], ['247,115,157', '186,154,255']];

  /* ---------- state ---------- */

  function start() { return [{ x: CX, y: L.frontY }, { x: CX, y: L.rearY }]; }
  function makeTeam(names, flip) {
    return {
      names: names, flip: flip,
      p: start(), t: start(),
      formation: 'attack', sideSign: 0, linked: true,
      cone: [true, true], coneOn: true, zoneOn: true,
      coneAlpha: 35, zoneAlpha: 60
    };
  }
  var teams = [makeTeam(['A1', 'A2'], false), makeTeam(['C', 'D'], true)];
  var shuttle = { x: CX, y: NET };
  var ink = [];
  var tool = 'move', inkColor = '#ffdc00', coneR = 3.5;

  function modelY(team, y) { return team.flip ? COURT.length - y : y; }
  function localY(team, y) { return team.flip ? COURT.length - y : y; }
  function say(m) { $('status').textContent = m; }

  /* ---------- pairing rules ---------- */

  function isSide(team) {
    var p = team.p;
    return Math.abs(p[0].y - p[1].y) < L.sameRow &&
      ((p[0].x < L.splitL && p[1].x > L.splitR) ||
       (p[1].x < L.splitL && p[0].x > L.splitR));
  }

  function limitTargets(team) {
    team.t.forEach(function (v) { v.y = clamp(v.y, L.minY, L.maxY); });
  }

  function defenceMove(team, i, next) {
    var p = team.p, t = team.t, j = 1 - i, sideSign = team.sideSign;
    if (team.formation !== 'side' || sideSign === 0) {
      sideSign = (next.x < CX ? 1 : -1) * (i === 0 ? 1 : -1);
    }
    var sign = i === 0 ? sideSign : -sideSign;
    var minX = L.xMin + (sign < 0 ? L.defGap : 0);
    var maxX = L.xMax - (sign > 0 ? L.defGap : 0);
    var x = clamp(next.x, minX, maxX);
    p[i] = { x: x, y: L.defY }; t[i] = { x: x, y: L.defY };
    p[j] = { x: x + sign * L.defGap, y: L.defY }; t[j] = { x: p[j].x, y: L.defY };
    team.formation = 'side';
    team.sideSign = sideSign;
    say(team.names[i] + ' → ' + team.names[j] + ' 좌우 수비 연동 · 중심 간격 ' +
        L.defGap.toFixed(2) + 'm');
  }

  function inBounds(q) {
    return q.x >= L.xMin - 1e-7 && q.x <= L.xMax + 1e-7 &&
           q.y >= L.minY - 1e-7 && q.y <= L.maxY + 1e-7;
  }

  /* The partner always ends up exactly one attack gap away. Sweep outward from
     the wanted direction and take the first angle that stays on court: every
     candidate sits on the same circle, so distance to the wanted point grows
     with the angle you turn away from it, and the first hit is the nearest. */
  function exactAttackTarget(a, desired) {
    var gap = L.attackGap;
    var theta = Math.atan2(desired.y - a.y, desired.x - a.x);
    for (var k = 0; k < 1440; k++) {
      var ang = theta + (k % 2 === 0 ? 1 : -1) * Math.floor((k + 1) / 2) * Math.PI / 720;
      var c = { x: a.x + Math.cos(ang) * gap, y: a.y + Math.sin(ang) * gap };
      if (inBounds(c)) return c;
    }
    return { x: a.x, y: clamp(a.y + gap, L.minY, L.maxY) };
  }

  /* Net corner to the opposite rear corner. A rear player sliding along one of
     these is making a diagonal, and the partner may cut straight to the T. */
  var DIAGONALS = [
    { start: { x: 0, y: NET }, end: { x: COURT.widthDoubles, y: COURT.length } },
    { start: { x: COURT.widthDoubles, y: NET }, end: { x: 0, y: COURT.length } }
  ];
  function diagonalProgress(pos, path) {
    var vx = path.end.x - path.start.x, vy = path.end.y - path.start.y;
    return ((pos.x - path.start.x) * vx + (pos.y - path.start.y) * vy) / (vx * vx + vy * vy);
  }
  function diagonalRearMotion(from, to) {
    var dx = to.x - from.x, dy = to.y - from.y;
    if (dy < L.diagDy || Math.abs(dx) < L.diagDx) return false;
    var path = dx > 0 ? DIAGONALS[0] : DIAGONALS[1];
    return diagonalProgress(to, path) > diagonalProgress(from, path) + L.diagStep;
  }

  function follow(team, i) {
    var p = team.p, t = team.t, a = p[i], j = 1 - i, b, msg;
    var deep = a.y >= L.rearTrigger;

    if (deep) {
      var frontX = clamp(CX + (a.x - CX) * 0.12, L.frontX[0], L.frontX[1]);
      var dx = frontX - a.x;
      var vertical = Math.sqrt(Math.max(0, L.attackGap * L.attackGap - dx * dx));
      b = { x: frontX, y: a.y - vertical };
      msg = team.names[i] + ' 후위 ' +
        (a.x < L.splitL ? '좌측' : a.x > L.splitR ? '우측' : '중앙') +
        ' → ' + team.names[j] + ' T 중심 커버';
    } else if (a.y < SHORT) {
      var depth = clamp((SHORT - a.y) / L.advanceSpan, 0, 1);
      var want = L.rearY + (L.defY - L.rearY) * depth;
      b = { x: CX, y: Math.max(want, a.y + L.minSplit) };
      msg = team.names[i] + ' 네트 전진 → ' + team.names[j] + ' 중앙 후방 커버';
    } else if (a.y < L.frontTrigger) {
      b = { x: CX, y: L.rearY };
      msg = team.names[i] + ' 전위 → ' + team.names[j] + ' 후위 중앙';
    } else if (a.x < L.leftX) {
      b = { x: L.coverRight, y: L.defY };
      msg = team.names[i] + ' 좌측 → ' + team.names[j] + ' 우측 커버';
    } else if (a.x > L.rightX) {
      b = { x: L.coverLeft, y: L.defY };
      msg = team.names[i] + ' 우측 → ' + team.names[j] + ' 좌측 커버';
    } else {
      b = { x: CX, y: a.y > L.midY ? L.frontY : L.rearY };
      msg = team.names[i] + ' 중앙 → ' + team.names[j] + ' 전후 커버';
    }
    t[j] = exactAttackTarget(a, b);   // v19 applies this to the rear case too
    limitTargets(team);
    say(msg + ' · 중심 간격 ' + L.attackGap.toFixed(2) + 'm');
  }

  /* ---------- drawing ---------- */

  var canvas, ctx, stage, app, panel, view, zoneBuf = null;

  function drawZones() {
    var W = COURT.widthDoubles, cell = 0.14;
    teams.forEach(function (team, ti) {
      if (!team.zoneOn || team.zoneAlpha <= 0) return;
      var y0 = ti === 0 ? NET + 0.06 : 0;
      var h = (ti === 0 ? COURT.length : NET - 0.06) - y0;
      var cols = Math.ceil(W / cell), rows = Math.ceil(h / cell);
      if (!zoneBuf || zoneBuf.width !== cols || zoneBuf.height !== rows) {
        zoneBuf = document.createElement('canvas');
        zoneBuf.width = cols; zoneBuf.height = rows;
      }
      var bctx = zoneBuf.getContext('2d');
      var img = bctx.createImageData(cols, rows), d = img.data;
      var a0 = { x: team.p[0].x, y: modelY(team, team.p[0].y) };
      var a1 = { x: team.p[1].x, y: modelY(team, team.p[1].y) };
      var c0 = ZONE[ti][0].split(','), c1 = ZONE[ti][1].split(',');
      for (var r = 0; r < rows; r++) {
        var my = y0 + (r + 0.5) / rows * h;
        for (var c = 0; c < cols; c++) {
          var mx = (c + 0.5) / cols * W;
          var d0 = Math.hypot(mx - a0.x, (my - a0.y) * 0.94);
          var d1 = Math.hypot(mx - a1.x, (my - a1.y) * 0.94);
          var near = Math.min(d0, d1);
          var a = (0.16 + 0.33 * clamp(1 - near / L.zoneReach, 0, 1)) * team.zoneAlpha / 60;
          var rgb = d0 <= d1 ? c0 : c1;
          var o = (r * cols + c) * 4;
          d[o] = +rgb[0]; d[o + 1] = +rgb[1]; d[o + 2] = +rgb[2];
          d[o + 3] = Math.round(255 * Math.min(a, 1));
        }
      }
      bctx.putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.beginPath(); ctx.rect(0, y0, W, h); ctx.clip();
      ctx.drawImage(zoneBuf, 0, y0, W, h);
      ctx.restore();
    });
  }

  function drawCones() {
    var W = COURT.widthDoubles, half = 70 * Math.PI / 180;   // 140° total
    teams.forEach(function (team, ti) {
      if (!team.coneOn || team.coneAlpha <= 0) return;
      if (team.formation === 'side' || isSide(team)) return;
      var facing = team.flip ? Math.PI / 2 : -Math.PI / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, ti === 0 ? NET : 0, W, NET);
      ctx.clip();
      team.p.forEach(function (player, i) {
        if (!team.cone[i]) return;
        var x = player.x, y = modelY(team, player.y), rgb = CONE[ti][i];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, coneR, facing - half, facing + half, false);
        ctx.closePath();
        ctx.fillStyle = 'rgba(' + rgb + ',' + Math.min(1, 0.19 * team.coneAlpha / 35) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(' + rgb + ',' + Math.min(1, 0.75 * team.coneAlpha / 35) + ')';
        ctx.lineWidth = 0.035;
        [facing - half, facing + half].forEach(function (ang) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + coneR * Math.cos(ang), y + coneR * Math.sin(ang));
          ctx.stroke();
        });
      });
      ctx.restore();
    });
  }

  function drawPlayers() {
    ctx.save();
    view.applyModel(ctx);
    teams.forEach(function (team, ti) {
      team.p.forEach(function (v, i) {
        ctx.beginPath();
        ctx.arc(v.x, modelY(team, v.y), L.playerR, 0, Math.PI * 2);
        ctx.fillStyle = FILL[ti][i];
        ctx.fill();
        ctx.lineWidth = 0.06;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      });
    });
    ctx.restore();

    ctx.save();
    view.applyScreen(ctx);
    var px = Math.max(9, Math.round(view.scale * L.playerR * 0.92));
    ctx.font = 'bold ' + px + 'px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#17304a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    teams.forEach(function (team) {
      team.p.forEach(function (v, i) {
        var s = view.project(v.x, modelY(team, v.y));
        ctx.fillText(team.names[i], s.x, s.y + px * 0.05);
      });
    });
    ctx.restore();
  }

  function draw() {
    ctx.save();
    view.applyScreen(ctx);
    ctx.clearRect(0, 0, view.cssW, view.cssH);
    ctx.restore();

    ctx.save();
    view.applyModel(ctx);
    BTS.render.court(ctx, view, 'doubles');
    drawZones();
    drawCones();
    ink.forEach(function (s) { BTS.render.stroke(ctx, s); });
    ctx.restore();

    BTS.render.labels(ctx, view);
    BTS.render.shuttle(ctx, view, shuttle);
    drawPlayers();
  }

  /* ---------- easing ---------- */

  var raf = 0, held = null, waiting = null;
  function tick() {
    var moving = false;
    teams.forEach(function (team) {
      limitTargets(team);
      team.p.forEach(function (v, i) {
        if (held && held.team === team && held.i === i) return;
        // The partner holds still until the finger lifts.
        if (waiting && waiting.team === team && waiting.i === i) return;
        var dx = team.t[i].x - v.x, dy = team.t[i].y - v.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.01) {
          v.x += dx * 0.17; v.y += dy * 0.17; moving = true;
        } else { v.x = team.t[i].x; v.y = team.t[i].y; }
      });
    });
    draw();
    raf = moving ? requestAnimationFrame(tick) : 0;
  }
  function update() { if (raf) cancelAnimationFrame(raf); raf = 0; tick(); }

  /* ---------- input ---------- */

  var active = null, canvasRect = null, pending = false;
  function requestDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; update(); });
  }
  function at(e) {
    var r = canvasRect || (canvasRect = canvas.getBoundingClientRect());
    return view.unproject(e.clientX - r.left, e.clientY - r.top);
  }

  function grabAt(q) {
    var drawing = tool !== 'move';
    var pr = drawing ? L.playerR : Math.max(0.72, 26 / view.scale);
    var sr = drawing ? 0.22 : Math.max(0.50, 24 / view.scale);
    for (var ti = 0; ti < teams.length; ti++) {
      for (var i = 0; i < 2; i++) {
        var v = teams[ti].p[i];
        if (Math.hypot(q.x - v.x, q.y - modelY(teams[ti], v.y)) < pr) {
          return { kind: 'player', team: teams[ti], i: i };
        }
      }
    }
    if (Math.hypot(q.x - shuttle.x, q.y - shuttle.y) < sr) return { kind: 'shuttle' };
    return null;
  }

  function nearSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    var t = len ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len, 0, 1) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function eraseAt(p) {
    for (var k = ink.length - 1; k >= 0; k--) {
      var s = ink[k], tol = L.eraseR + s.size;
      var hit = s.pts.some(function (a, i) {
        return i === 0 ? Math.hypot(p.x - a.x, p.y - a.y) < tol : nearSeg(p, s.pts[i - 1], a) < tol;
      });
      if (hit) { ink.splice(k, 1); return true; }
    }
    return false;
  }

  /* A corner candidate: the partner already sits in one front (or rear) corner,
     so finishing the drag in the opposite corner trades the roles. */
  function cornerSwap(team, i, band) {
    var other = team.p[1 - i];
    var inBand = other.y >= band[0] && other.y <= band[1];
    var atCorner = other.x <= L.cornerL || other.x >= L.cornerR;
    if (!team.linked || !inBand || !atCorner) return null;
    return { team: team, i: i, j: 1 - i, side: other.x < CX ? 'left' : 'right' };
  }

  /* Armed when a mid-rear player near the centre is picked up while the
     partner already holds a wide front position. */
  function armDiagonal(team, i) {
    if (!team.linked) return null;
    var me = team.p[i], other = team.p[1 - i];
    var midRear = me.y >= L.diagRearMin && me.y <= L.diagRearMax &&
      Math.abs(me.x - CX) < L.diagCentre;
    var partnerWide = other.y < L.diagPartnerY &&
      (other.x <= L.splitL || other.x >= L.splitR);
    return (midRear && partnerWide) ? { from: { x: me.x, y: me.y } } : null;
  }

  function movePlayer(q) {
    var team = active.team, i = active.i;
    var next = {
      x: clamp(q.x + active.off.x, L.xMin, L.xMax),
      y: clamp(localY(team, q.y + active.off.y), L.minY, L.maxY)
    };

    // Sliding the centre-rear player out to a rear corner: the partner cuts
    // straight to the T instead of staging through the defensive spot.
    if (active.diag) {
      var rearward = next.y >= active.diag.from.y + L.diagDy && next.y >= L.diagMinY;
      if (active.diagApplied || (diagonalRearMotion(active.diag.from, next) && rearward)) {
        active.diagApplied = true;
        team.formation = 'attack'; team.sideSign = 0;
        team.p[i] = { x: next.x, y: next.y };
        team.t[i] = { x: next.x, y: next.y };
        team.t[1 - i] = exactAttackTarget(next, { x: CX, y: L.frontY });
        say(team.names[i] + ' 후위 대각 이동 → ' + team.names[1 - i] +
            ' T 중앙으로 직선 대각 (수비 경유 없음)');
        return;
      }
    }

    // While walking the rear swap across the court, leave the partner alone.
    if (active.rearSwap && next.y >= L.rearTrigger) {
      team.formation = 'attack'; team.sideSign = 0;
      team.p[i] = { x: next.x, y: next.y };
      team.t[i] = { x: next.x, y: next.y };
      return;
    }

    var partner = team.p[1 - i];
    var straight = team.linked && team.formation !== 'side' &&
      !active.frontSwap && !active.rearSwap &&
      Math.abs(next.x - team.p[i].x) < L.straightDrift &&
      Math.abs(team.p[i].x - partner.x) < L.sameColumn;

    if (straight) {
      // Roles follow the current order, not the player numbers.
      var draggedIsFront = team.p[i].y <= partner.y;
      var gap = L.attackGap;
      var minY = draggedIsFront ? L.minY : L.minY + gap;
      var maxY = draggedIsFront ? L.maxY - gap : L.maxY;
      var y = clamp(next.y, minY, maxY);
      team.p[i] = { x: team.p[i].x, y: y };
      team.t[i] = { x: team.p[i].x, y: y };
      team.t[1 - i] = { x: partner.x, y: draggedIsFront ? y + gap : y - gap };
      say(next.y > maxY || next.y < minY
        ? '네트 또는 엔드라인 도착 · 앞뒤 이동 정지'
        : '직선 연동 · 간격 ' + gap.toFixed(2) + 'm · 좌우 밀림 없음');
      return;
    }

    var entry = next.y >= L.sideEntryY[0] && next.y <= L.sideEntryY[1] &&
      (next.x <= L.sideEntryX[0] || next.x >= L.sideEntryX[1]);
    var stay = team.formation === 'side' &&
      next.y >= L.sideStayY[0] && next.y <= L.sideStayY[1];

    if (!team.linked) {
      team.p[i] = { x: next.x, y: next.y };
      team.t[i] = { x: next.x, y: next.y };
      team.formation = 'attack';
      say(team.names[i] + ' 자유 이동 · 연결 해제');
    } else if (entry || stay) {
      defenceMove(team, i, next);
    } else {
      team.formation = 'attack'; team.sideSign = 0;
      team.p[i] = { x: next.x, y: next.y };
      team.t[i] = { x: next.x, y: next.y };
      if (!active.frontSwap) follow(team, i);
    }
  }

  function onDown(e) {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    var q = at(e), grab = grabAt(q);

    if (grab && grab.kind === 'player') {
      var team = grab.team, i = grab.i;
      active = {
        kind: 'player', id: e.pointerId, team: team, i: i,
        start: q, started: false,
        off: { x: team.p[i].x - q.x, y: modelY(team, team.p[i].y) - q.y },
        // Only a rear player may claim a front corner, per the prototype.
        frontSwap: team.p[i].y >= SHORT ? cornerSwap(team, i, [L.minY, SHORT]) : null,
        rearSwap: cornerSwap(team, i, [L.rearTrigger, L.maxY]),
        diag: armDiagonal(team, i),
        diagApplied: false
      };
      held = { team: team, i: i };
      waiting = { team: team, i: 1 - i };
      return;
    }
    if (grab) { active = { kind: 'shuttle', id: e.pointerId }; return; }

    if (tool === 'move') return;
    if (tool === 'erase') {
      active = { kind: 'erase', id: e.pointerId, last: q };
      if (eraseAt(q)) update();
    } else {
      active = { kind: 'stroke', id: e.pointerId };
      ink.push({ type: 'pen', color: inkColor, size: 0.085, pts: [q] });
      update();
    }
  }

  function onMove(e) {
    if (!active || active.id !== e.pointerId) return;
    e.preventDefault();
    var q = at(e);

    if (active.kind === 'player') {
      // A tap must not nudge anything; wait for a real drag first.
      if (!active.started) {
        if (Math.hypot(q.x - active.start.x, q.y - active.start.y) < 10 / view.scale) return;
        active.started = true;
        var team = active.team;
        team.formation = isSide(team) ? 'side' : 'attack';
        team.sideSign = team.formation === 'side'
          ? (team.p[1].x >= team.p[0].x ? 1 : -1) : 0;
      }
      movePlayer(q);
    } else if (active.kind === 'shuttle') {
      shuttle = { x: clamp(q.x, -0.4, COURT.widthDoubles + 0.4),
                  y: clamp(q.y, -0.4, COURT.length + 0.4) };
    } else if (active.kind === 'erase') {
      if (Math.hypot(q.x - active.last.x, q.y - active.last.y) >= 0.18) {
        active.last = q;
        eraseAt(q);
      }
    } else {
      var s = ink[ink.length - 1];
      if (!s) return;
      var last = s.pts[s.pts.length - 1];
      if (Math.hypot(q.x - last.x, q.y - last.y) >= 0.025) s.pts.push(q);
    }
    requestDraw();
  }

  function settleSwap(swap, band, target, label) {
    var team = swap.team, a = team.p[swap.i];
    var opposite = swap.side === 'left' ? a.x >= L.cornerR : a.x <= L.cornerL;
    if (a.y >= band[0] && a.y <= band[1] && opposite) {
      team.t[swap.j] = exactAttackTarget(a, target);
      team.formation = 'attack'; team.sideSign = 0;
      say((team.flip ? '상대 팀 ' : '우리 팀 ') + team.names[swap.i] + ' ' + label +
          ' → ' + team.names[swap.j] + ' 역할 교대 · 간격 제한 해제');
      return true;
    }
    return false;
  }

  function onUp(e) {
    if (!active || active.id !== e.pointerId) return;
    if (active.kind === 'player' && active.started && !active.diagApplied) {
      var done = false;
      if (active.frontSwap) {
        done = settleSwap(active.frontSwap, [L.minY, SHORT], { x: CX, y: L.frontY }, '전위 진입');
      }
      if (!done && active.rearSwap) {
        done = settleSwap(active.rearSwap, [L.rearTrigger, L.maxY], { x: CX, y: L.rearY }, '후위 반대편 진입');
      }
      if (!done && (active.frontSwap || active.rearSwap) && active.team.linked) {
        follow(active.team, active.i);
      }
    }
    active = null;
    held = null;
    waiting = null;
    update();
  }

  /* ---------- layout ---------- */

  var PANEL_MIN_W = 188, PANEL_MIN_H = 128, GAP = 6, STAGE_PAD = 10;
  function fitCourt(w, h) {
    return BTS.createView().fitTo(Math.max(40, w - STAGE_PAD), Math.max(40, h - STAGE_PAD), 1);
  }
  function panelNeeds(mode, width) {
    var prevLayout = app.dataset.layout, prevStyle = panel.getAttribute('style');
    app.dataset.layout = mode;
    panel.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;' +
      'width:' + Math.max(80, width) + 'px;height:auto;max-height:none;overflow:visible;';
    var h = panel.scrollHeight;
    if (prevStyle === null) panel.removeAttribute('style');
    else panel.setAttribute('style', prevStyle);
    app.dataset.layout = prevLayout || 'bottom';
    return h;
  }
  function layout() {
    var cs = getComputedStyle(app);
    var W = app.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var H = app.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W < 10 || H < 10) return;
    var bar = document.querySelector('.statusbar').offsetHeight || 34;
    var stageH = H - bar - GAP;

    var needBelow = panelNeeds('bottom', W);
    var bandH = clamp(needBelow, PANEL_MIN_H, Math.round(H * 0.45));
    var below = fitCourt(W, stageH - GAP - bandH);

    var maxW = Math.max(PANEL_MIN_W, Math.round(W * 0.45));
    var bandW = PANEL_MIN_W, needSide = 0;
    for (var w = PANEL_MIN_W; w <= maxW; w += 56) {
      bandW = w;
      needSide = panelNeeds('side', w);
      if (needSide <= H) break;
    }
    var side = fitCourt(W - GAP - bandW, stageH);

    var useSide = side.scale * (needSide <= H ? 1 : 0.85) >=
                  below.scale * (needBelow <= bandH ? 1 : 0.85);
    var box = useSide ? { w: W - GAP - bandW, h: stageH }
                      : { w: W, h: stageH - GAP - bandH };

    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    view.fitTo(Math.max(40, box.w - STAGE_PAD), Math.max(40, box.h - STAGE_PAD), dpr);

    app.dataset.layout = useSide ? 'side' : 'bottom';
    if (useSide) {
      app.style.gridTemplateColumns = (view.cssW + STAGE_PAD) + 'px minmax(0, 1fr)';
      app.style.gridTemplateRows = 'minmax(0, 1fr)';
    } else {
      app.style.gridTemplateColumns = 'minmax(0, 1fr)';
      app.style.gridTemplateRows = (view.cssH + STAGE_PAD + GAP + bar) + 'px minmax(0, 1fr)';
    }
    canvas.style.width = view.cssW + 'px';
    canvas.style.height = view.cssH + 'px';
    canvas.width = Math.round(view.cssW * dpr);
    canvas.height = Math.round(view.cssH * dpr);
    canvasRect = null;
    update();
  }

  /* ---------- wiring ---------- */

  function syncUI() {
    ['move', 'pen', 'erase'].forEach(function (t) {
      $('tool-' + t).classList.toggle('active', tool === t);
    });
    document.querySelectorAll('[data-ink]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.ink === inkColor);
    });
    $('coneRVal').textContent = coneR.toFixed(1) + 'm';
    ['AB', 'CD'].forEach(function (id, ti) {
      var team = teams[ti];
      var link = $('link' + id);
      link.classList.toggle('active', team.linked);
      link.textContent = team.names.join('·') + (team.linked ? ' 연결 ✓' : ' 해제');
      [0, 1].forEach(function (i) {
        var b = $('cone' + id + i);
        b.classList.toggle('active', team.cone[i]);
        b.textContent = team.names[i] + ' 140°' + (team.cone[i] ? ' ✓' : ' ✕');
      });
      var mz = $('zone' + id);
      mz.classList.toggle('active', team.zoneOn);
      mz.textContent = '담당 존' + (team.zoneOn ? ' ✓' : ' ✕');
      $('coneA' + id).value = team.coneAlpha;
      $('coneV' + id).textContent = team.coneAlpha + '%';
      $('zoneA' + id).value = team.zoneAlpha;
      $('zoneV' + id).textContent = team.zoneAlpha + '%';
    });
  }

  function reset() {
    teams.forEach(function (team) {
      team.p = start(); team.t = start();
      team.formation = 'attack'; team.sideSign = 0;
    });
    shuttle = { x: CX, y: NET };
    say('우리 팀 A1·A2 / 상대 팀 C·D · 각 팀 독립 자동 연동');
    update();
  }

  function exportPng() {
    var ev = BTS.createView();
    ev.rotated = view.rotated; ev.scale = 150; ev.dpr = 1;
    ev.cssW = Math.round((ev.rotated ? COURT.worldH : COURT.worldW) * ev.scale);
    ev.cssH = Math.round((ev.rotated ? COURT.worldW : COURT.worldH) * ev.scale);
    var c = document.createElement('canvas');
    c.width = ev.cssW; c.height = ev.cssH;
    var realCtx = ctx, realView = view;
    ctx = c.getContext('2d'); view = ev;
    draw();
    ctx = realCtx; view = realView;
    c.toBlob(function (blob) {
      if (!blob) return;
      var file = null;
      try { file = new File([blob], 'badminton-roles.png', { type: 'image/png' }); } catch (err) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '배드민턴 역할 연동 전술판' }).catch(function () {});
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'badminton-roles.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }, 'image/png');
  }

  function bind() {
    ['move', 'pen', 'erase'].forEach(function (t) {
      $('tool-' + t).onclick = function () { tool = t; syncUI(); };
    });
    document.querySelectorAll('[data-ink]').forEach(function (b) {
      b.onclick = function () { inkColor = b.dataset.ink; tool = 'pen'; syncUI(); };
    });
    $('coneR').oninput = function (e) { coneR = +e.target.value / 10; syncUI(); update(); };

    ['AB', 'CD'].forEach(function (id, ti) {
      var team = teams[ti];
      $('link' + id).onclick = function () {
        team.linked = !team.linked;
        if (!team.linked) { team.formation = 'attack'; team.sideSign = 0; }
        say(team.names.join('·') + (team.linked ? ' 자동 연동 켜짐' : ' 각각 자유 이동'));
        syncUI();
      };
      [0, 1].forEach(function (i) {
        $('cone' + id + i).onclick = function () {
          team.cone[i] = !team.cone[i]; syncUI(); update();
        };
      });
      $('zone' + id).onclick = function () { team.zoneOn = !team.zoneOn; syncUI(); update(); };
      $('coneA' + id).oninput = function (e) {
        team.coneAlpha = +e.target.value; team.coneOn = team.coneAlpha > 0; syncUI(); update();
      };
      $('zoneA' + id).oninput = function (e) {
        team.zoneAlpha = +e.target.value; syncUI(); update();
      };
    });

    $('clearInk').onclick = function () { ink.length = 0; update(); };
    $('reset').onclick = reset;
    $('resetShuttle').onclick = function () { shuttle = { x: CX, y: NET }; update(); };
    $('savePng').onclick = exportPng;

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
      document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
    });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });

    if (global.ResizeObserver) new ResizeObserver(layout).observe(app);
    global.addEventListener('resize', layout);
    global.addEventListener('orientationchange', function () { setTimeout(layout, 120); });
    if (global.visualViewport) global.visualViewport.addEventListener('resize', layout);
  }

  function init() {
    canvas = $('court');
    ctx = canvas.getContext('2d');
    stage = $('stage');
    app = document.querySelector('.app');
    panel = document.querySelector('.panel');
    view = BTS.createView();
    bind();
    syncUI();
    layout();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  BTS.roles = {
    teams: teams, L: L, ink: ink,
    shuttle: function () { return shuttle; },
    view: function () { return view; },
    setTool: function (t) { tool = t; syncUI(); },
    isSide: isSide, layout: layout, reset: reset, follow: follow
  };
})(window);
