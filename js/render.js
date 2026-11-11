/* All drawing. Everything is metres; the view supplies the transform,
   so the same code renders the screen canvas and the high-res PNG export. */
(function (global) {
  'use strict';
  var BTS = global.BTS, COURT = BTS.COURT, M = BTS.M, clamp = BTS.clamp;

  var INK = { court: '#12684f', out: '#16765d', line: '#f7ffff', net: '#d9faff' };

  function seg(ctx, x1, y1, x2, y2, w, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawCourt(ctx, view, mode) {
    var W = COURT.widthDoubles, L = COURT.length, net = COURT.netY;
    var m = COURT.margin, ins = COURT.singlesInset, ss = COURT.shortService,
        ls = COURT.longServiceDoubles, c = INK.line;

    ctx.fillStyle = INK.out;
    ctx.fillRect(-m, -m, COURT.worldW, COURT.worldH);
    ctx.fillStyle = INK.court;
    ctx.fillRect(0, 0, W, L);

    // Highlight the width actually in play.
    ctx.fillStyle = 'rgba(255,255,255,.075)';
    if (mode === 'singles') ctx.fillRect(ins, 0, W - 2 * ins, L);
    else ctx.fillRect(0, 0, W, L);

    ctx.lineCap = 'butt';
    // Boundaries.
    seg(ctx, 0, 0, W, 0, M.lineOuter, c);
    seg(ctx, 0, L, W, L, M.lineOuter, c);
    seg(ctx, 0, 0, 0, L, M.lineOuter, c);
    seg(ctx, W, 0, W, L, M.lineOuter, c);
    // Singles sidelines.
    seg(ctx, ins, 0, ins, L, M.lineInner, c);
    seg(ctx, W - ins, 0, W - ins, L, M.lineInner, c);
    // Short service lines.
    seg(ctx, 0, net - ss, W, net - ss, M.lineInner, c);
    seg(ctx, 0, net + ss, W, net + ss, M.lineInner, c);
    // Doubles long service lines.
    seg(ctx, 0, ls, W, ls, M.lineInner, c);
    seg(ctx, 0, L - ls, W, L - ls, M.lineInner, c);
    // Centre lines (stop at the short service lines).
    seg(ctx, W / 2, 0, W / 2, net - ss, M.lineInner, c);
    seg(ctx, W / 2, net + ss, W / 2, L, M.lineInner, c);

    // Net, with posts just outside the doubles sidelines.
    ctx.fillStyle = INK.net;
    ctx.fillRect(-0.12, net - M.netThickness / 2, W + 0.24, M.netThickness);
  }

  function drawSideLabels(ctx, view) {
    var px = Math.max(10, Math.round(view.scale * 0.42));
    var pts = [
      { text: '상대 코트', m: { x: COURT.widthDoubles / 2, y: -COURT.margin / 2 } },
      { text: '우리 팀', m: { x: COURT.widthDoubles / 2, y: COURT.length + COURT.margin / 2 } }
    ];
    ctx.save();
    view.applyScreen(ctx);
    ctx.font = '600 ' + px + 'px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(8,52,45,.75)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    pts.forEach(function (p) {
      var s = view.project(p.m.x, p.m.y);
      ctx.save();
      ctx.translate(s.x, s.y);
      // Rotated courts have no room for horizontal text beside the baseline.
      if (view.rotated) ctx.rotate(-Math.PI / 2);
      ctx.fillText(p.text, 0, 0, COURT.widthDoubles * view.scale);
      ctx.restore();
    });
    ctx.restore();
  }

  /* Responsibility zones, drawn only on our half. */
  var zoneBuf = null;

  function drawZones(ctx, view, doc, prefs, frame) {
    if (!prefs.zoneOn) return;
    var ours = BTS.state.ourIndices().map(function (i) { return frame.players[i]; });
    if (!ours.length) return;

    var W = COURT.widthDoubles, L = COURT.length, net = COURT.netY, gap = 0.08;
    var tint = [[92, 197, 255], [255, 195, 75]];

    if (!prefs.autoZone) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, net + gap, W, L - net - gap);
      ctx.clip();
      ours.forEach(function (p, i) {
        var r = M.zoneCircle * prefs.zoneScale;
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        var c = tint[i].join(',');
        g.addColorStop(0, 'rgba(' + c + ',' + prefs.zoneAlpha + ')');
        g.addColorStop(1, 'rgba(' + c + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      return;
    }

    var top = net + gap, h = L - top;
    var cols = Math.max(2, Math.ceil(W / M.zoneCell));
    var rows = Math.max(2, Math.ceil(h / M.zoneCell));
    if (!zoneBuf || zoneBuf.width !== cols || zoneBuf.height !== rows) {
      zoneBuf = document.createElement('canvas');
      zoneBuf.width = cols;
      zoneBuf.height = rows;
    }
    var bctx = zoneBuf.getContext('2d');
    var img = bctx.createImageData(cols, rows);
    var data = img.data;
    var reach = M.zoneReach * prefs.zoneScale;

    for (var r = 0; r < rows; r++) {
      var my = top + (r + 0.5) / rows * h;
      for (var c = 0; c < cols; c++) {
        var mx = (c + 0.5) / cols * W;
        var best = 0, bestD = Infinity;
        for (var k = 0; k < ours.length; k++) {
          var dx = mx - ours[k].x, dy = my - ours[k].y;
          var d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = k; }
        }
        var fade = clamp(1 - Math.sqrt(bestD) / reach, 0, 1);
        var o = (r * cols + c) * 4;
        data[o] = tint[best][0];
        data[o + 1] = tint[best][1];
        data[o + 2] = tint[best][2];
        data[o + 3] = Math.round(255 * prefs.zoneAlpha * fade);
      }
    }
    bctx.putImageData(img, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.beginPath();
    ctx.rect(0, top, W, h);
    ctx.clip();
    ctx.drawImage(zoneBuf, 0, top, W, h);
    ctx.restore();
  }

  function drawStroke(ctx, s) {
    var pts = s.pts;
    if (!pts || !pts.length) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.001, pts[0].y + 0.001);
    ctx.stroke();

    if (s.type === 'arrow' && pts.length > 1) {
      var a = pts[pts.length - 2], b = pts[pts.length - 1];
      var ang = Math.atan2(b.y - a.y, b.x - a.x), len = 0.30 + s.size * 1.2;
      seg(ctx, b.x, b.y, b.x - len * Math.cos(ang - 0.5), b.y - len * Math.sin(ang - 0.5), s.size, s.color);
      seg(ctx, b.x, b.y, b.x - len * Math.cos(ang + 0.5), b.y - len * Math.sin(ang + 0.5), s.size, s.color);
    }
  }

  /* Drawn in screen space so it stays upright when the court is rotated. */
  function drawShuttle(ctx, view, shuttle) {
    var p = view.project(shuttle.x, shuttle.y);
    var k = view.scale * (M.shuttleHeight / 0.38);
    ctx.save();
    view.applyScreen(ctx);
    ctx.translate(p.x, p.y);
    ctx.rotate(-Math.PI / 5);
    ctx.scale(k, k);
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 0.1 * k;
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#243548';
    ctx.lineWidth = 0.028;
    ctx.beginPath();
    ctx.moveTo(0, 0.114);
    ctx.lineTo(-0.186, -0.243);
    ctx.quadraticCurveTo(0, -0.386, 0.186, -0.243);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    for (var i = -2; i <= 2; i++) {
      seg(ctx, 0, 0.100, i * 0.071, -0.257, 0.014, '#8da4b5');
    }
    ctx.beginPath();
    ctx.ellipse(0, 0.157, 0.114, 0.071, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#e5d6a4';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayers(ctx, view, doc, frame) {
    var fill = ['#39a8ee', '#f26783'];
    // Discs in model space (a circle is a circle either way).
    ctx.save();
    view.applyModel(ctx);
    frame.players.forEach(function (p, i) {
      if (!BTS.state.visiblePlayer(i)) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, M.playerRadius, 0, Math.PI * 2);
      ctx.fillStyle = fill[i < 2 ? 0 : 1];
      ctx.shadowColor = 'rgba(0,0,0,.4)';
      ctx.shadowBlur = 0.12;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 0.055;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    });
    ctx.restore();

    // Labels upright in screen space.
    ctx.save();
    view.applyScreen(ctx);
    var px = Math.max(9, Math.round(view.scale * M.playerRadius * 1.15));
    ctx.font = 'bold ' + px + 'px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    frame.players.forEach(function (p, i) {
      if (!BTS.state.visiblePlayer(i)) return;
      var s = view.project(p.x, p.y);
      ctx.fillText(p.name || 'ABCD'[i], s.x, s.y + px * 0.04);
    });
    ctx.restore();
  }

  /* Faint trace of where the players move next, while editing. */
  function drawGhost(ctx, view, frame, nextFrame) {
    if (!nextFrame) return;
    ctx.save();
    view.applyModel(ctx);
    ctx.setLineDash([0.18, 0.14]);
    ctx.lineWidth = 0.05;
    frame.players.forEach(function (p, i) {
      if (!BTS.state.visiblePlayer(i)) return;
      var n = nextFrame.players[i];
      if (!n || (Math.abs(n.x - p.x) < 0.05 && Math.abs(n.y - p.y) < 0.05)) return;
      ctx.strokeStyle = i < 2 ? 'rgba(57,168,238,.75)' : 'rgba(242,103,131,.6)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(n.x, n.y, M.playerRadius * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  function render(ctx, view, doc, prefs, frame, opts) {
    opts = opts || {};
    ctx.save();
    view.applyScreen(ctx);
    ctx.clearRect(0, 0, view.cssW, view.cssH);
    ctx.restore();

    ctx.save();
    view.applyModel(ctx);
    drawCourt(ctx, view, doc.mode);
    drawZones(ctx, view, doc, prefs, frame);
    frame.strokes.forEach(function (s) { drawStroke(ctx, s); });
    ctx.restore();

    drawSideLabels(ctx, view);
    if (opts.ghost) drawGhost(ctx, view, frame, opts.ghost);
    drawShuttle(ctx, view, frame.shuttle);
    drawPlayers(ctx, view, doc, frame);
  }

  BTS.render = render;
  // Shared with the role-based board in js/roles.js.
  BTS.render.court = drawCourt;
  BTS.render.labels = drawSideLabels;
  BTS.render.stroke = drawStroke;
  BTS.render.shuttle = drawShuttle;
})(window);
