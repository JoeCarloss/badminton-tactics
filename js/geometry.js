/* Court geometry and the model <-> screen mapping.
   The whole app works in metres; pixels only exist inside a view. */
(function (global) {
  'use strict';

  var COURT = {
    length: 13.40,
    widthDoubles: 6.10,
    widthSingles: 5.18,
    shortService: 1.98,        // from the net
    longServiceDoubles: 0.76,  // from the back boundary
    margin: 0.65               // run-off drawn around the court
  };
  COURT.netY = COURT.length / 2;
  COURT.singlesInset = (COURT.widthDoubles - COURT.widthSingles) / 2;
  COURT.worldW = COURT.widthDoubles + COURT.margin * 2;
  COURT.worldH = COURT.length + COURT.margin * 2;

  // Sizes that used to be hard-coded pixels, now in metres.
  var M = {
    lineOuter: 0.05,
    lineInner: 0.04,
    netThickness: 0.13,
    playerRadius: 0.40,
    playerGrab: 0.62,
    shuttleHeight: 0.38,
    shuttleGrab: 0.45,
    eraseRadius: 0.30,
    zoneCell: 0.13,
    zoneReach: 4.30,   // auto-zone fade distance at scale 1
    zoneCircle: 3.10   // radial-zone radius at scale 1
  };

  /* A view maps metres to one particular canvas.
     `rotated` lays the court out lengthwise (for landscape screens). */
  function createView() {
    return {
      scale: 20,      // CSS px per metre
      dpr: 1,
      rotated: false,
      cssW: 0,
      cssH: 0,

      project: function (mx, my) {
        var m = COURT.margin, s = this.scale;
        return this.rotated
          ? { x: (COURT.worldH - m - my) * s, y: (mx + m) * s }
          : { x: (mx + m) * s, y: (my + m) * s };
      },

      unproject: function (sx, sy) {
        var m = COURT.margin, s = this.scale;
        return this.rotated
          ? { x: sy / s - m, y: COURT.worldH - m - sx / s }
          : { x: sx / s - m, y: sy / s - m };
      },

      // Draw in metres.
      applyModel: function (ctx) {
        var m = COURT.margin, k = this.scale * this.dpr;
        if (this.rotated) ctx.setTransform(0, k, -k, 0, (COURT.worldH - m) * k, m * k);
        else ctx.setTransform(k, 0, 0, k, m * k, m * k);
      },

      // Draw in CSS pixels (labels, sprites that must stay upright).
      applyScreen: function (ctx) {
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      },

      // Pick the orientation that fills the given box best.
      fitTo: function (w, h, dpr) {
        var p = Math.min(w / COURT.worldW, h / COURT.worldH);
        var l = Math.min(w / COURT.worldH, h / COURT.worldW);
        this.rotated = l > p;
        this.scale = this.rotated ? l : p;
        this.dpr = dpr || 1;
        this.cssW = Math.floor((this.rotated ? COURT.worldH : COURT.worldW) * this.scale);
        this.cssH = Math.floor((this.rotated ? COURT.worldW : COURT.worldH) * this.scale);
        return this;
      }
    };
  }

  global.BTS = global.BTS || {};
  global.BTS.COURT = COURT;
  global.BTS.M = M;
  global.BTS.createView = createView;
  global.BTS.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
})(window);
