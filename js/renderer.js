/* ============================================================
 * renderer.js — canvas drawing: grid, structure, loads,
 * supports, deflected shape, and overlays.
 * ============================================================ */
"use strict";

/* Diverging colour map for axial stress, t ∈ [-1..+1]
   (blue = tension, grey = zero, orange/red = compression). */
function stressColor(t) {
  const lerp = (a, b, f) => Math.round(a + (b - a) * f);
  const T = [77, 171, 247];    // #4dabf7  strong tension
  const C = [255, 107, 74];    // #ff6b4a  strong compression
  const Z = [120, 132, 148];   // neutral grey
  let r, g, b;
  if (t >= 0) { const f = Math.pow(t, 0.65); r = lerp(Z[0], T[0], f); g = lerp(Z[1], T[1], f); b = lerp(Z[2], T[2], f); }
  else        { const f = Math.pow(-t, 0.65); r = lerp(Z[0], C[0], f); g = lerp(Z[1], C[1], f); b = lerp(Z[2], C[2], f); }
  return `rgb(${r},${g},${b})`;
}

/* Utilisation colour (0 → 1+): green → amber → red */
function utilColor(u) {
  const lerp = (a, b, f) => Math.round(a + (b - a) * f);
  const G = [129, 199, 132], A = [255, 183, 77], R = [229, 87, 87];
  let r, g, b;
  if (u <= 0.5) { const f = u / 0.5; r = lerp(G[0], A[0], f); g = lerp(G[1], A[1], f); b = lerp(G[2], A[2], f); }
  else          { const f = Math.min(1, (u - 0.5) / 0.5); r = lerp(A[0], R[0], f); g = lerp(A[1], R[1], f); b = lerp(A[2], R[2], f); }
  return `rgb(${r},${g},${b})`;
}

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.cx = canvas.getContext("2d");
    // view: metres -> pixels
    this.scale = 60;           // px per metre
    this.ox = 0;               // origin offset in px
    this.oy = 0;
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.cv.width  = Math.max(1, Math.round(r.width  * this.dpr));
    this.cv.height = Math.max(1, Math.round(r.height * this.dpr));
    this.cx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = r.width; this.h = r.height;
  }

  /* world (m, y up) -> screen (px, y down) */
  W2S(x, y) { return { x: this.ox + x * this.scale, y: this.oy - y * this.scale }; }
  S2W(px, py) { return { x: (px - this.ox) / this.scale, y: (this.oy - py) / this.scale }; }

  zoom(factor, px, py) {
    const before = this.S2W(px, py);
    this.scale = Math.min(2000, Math.max(5, this.scale * factor));
    const after = this.S2W(px, py);
    this.ox += (after.x - before.x) * this.scale;
    this.oy -= (after.y - before.y) * this.scale;
  }

  pan(dxPx, dyPx) { this.ox += dxPx; this.oy += dyPx; }

  fit(structure) {
    if (structure.nodes.length === 0) { this.scale = 60; this.ox = 80; this.oy = this.h - 120; return; }
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const n of structure.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const pad = 1.5;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const sx = this.w / (maxX - minX), sy = this.h / (maxY - minY);
    this.scale = Math.max(5, Math.min(sx, sy) * 0.9);
    this.ox = (this.w - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.oy = (this.h + (maxY - minY) * this.scale) / 2 + minY * this.scale;
  }

  /* ================================================================ */
  render(structure, ui) {
    const c = this.cx;
    c.clearRect(0, 0, this.w, this.h);

    if (ui.showGrid) this.drawGrid();

    const solved = structure.solved && structure.solution;
    // When solved, "show original shape" off means: draw ONLY the deflected
    // structure (skip the undeformed members/nodes/loads underneath).
    const hideOriginal = solved && !ui.showOriginal;

    // ---- deflected shape ----
    if (solved && !ui.noDeflected) this.drawDeflected(structure, ui);

    if (!hideOriginal) {
      // ---- members ----
      for (const m of structure.members) {
        this.drawMember(m, structure, ui);
      }

      // ---- supports ----
      for (const n of structure.nodes) this.drawSupport(n);

      // ---- nodes ----
      for (const n of structure.nodes) this.drawNode(n, ui, structure);

      // ---- loads ----
      for (const n of structure.nodes) this.drawLoad(n);

      // ---- distributed effects (self weight / thermal) ----
      if (ui.showDistributed) this.drawDistributed(structure, ui);

      // ---- reactions ----
      if (solved) {
        for (const n of structure.nodes) this.drawReaction(n, structure.solution);
      }

      // ---- in-progress member rubber band ----
      if (ui.pendingNode && ui.mouse) {
        const a = this.W2S(ui.pendingNode.x, ui.pendingNode.y);
        c.strokeStyle = "rgba(79,195,247,.7)";
        c.setLineDash([5, 4]);
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(ui.mouse.x, ui.mouse.y); c.stroke();
        c.setLineDash([]);
      }
    }
  }

  /* ---------------- grid ---------------- */
  drawGrid() {
    const c = this.cx;
    const step = this.niceStep();
    const tl = this.S2W(0, 0), br = this.S2W(this.w, this.h);

    c.lineWidth = 1;
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      const sx = this.W2S(x, 0).x;
      c.strokeStyle = Math.abs(x % (step * 5)) < 1e-9 ? "#22303f" : "#182230";
      c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, this.h); c.stroke();
    }
    for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
      const sy = this.W2S(0, y).y;
      c.strokeStyle = Math.abs(y % (step * 5)) < 1e-9 ? "#22303f" : "#182230";
      c.beginPath(); c.moveTo(0, sy); c.lineTo(this.w, sy); c.stroke();
    }
    // axes
    const o = this.W2S(0, 0);
    c.strokeStyle = "#33465c";
    if (o.y >= 0 && o.y <= this.h) { c.beginPath(); c.moveTo(0, o.y); c.lineTo(this.w, o.y); c.stroke(); }
    if (o.x >= 0 && o.x <= this.w) { c.beginPath(); c.moveTo(o.x, 0); c.lineTo(o.x, this.h); c.stroke(); }
  }

  niceStep() {
    const target = 50;                 // px between minor lines
    const raw = target / this.scale;   // metres
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (pow * m >= raw) return pow * m;
    return pow * 10;
  }

  /* ---------------- members ---------------- */
  drawMember(m, structure, ui) {
    const c = this.cx;
    const a = this.W2S(m.n1.x, m.n1.y), b = this.W2S(m.n2.x, m.n2.y);

    let color = "#9fb2c5", width = 3;
    const solvedS = structure.solved && structure.solution;
    if (ui.colorMode === "force" && solvedS) {
      const N = structure.solution.memberForces.get(m.id) || 0;
      if (N > 0.05)      { color = "#4fc3f7"; }
      else if (N < -0.05){ color = "#ffb74d"; }
      else               { color = "#5c6b7d"; }
      width = 3 + Math.min(4, Math.abs(N) / 60);
    } else if (ui.colorMode === "util" && solvedS) {
      const u = Structure.utilization(m, structure.solution.memberForces.get(m.id) || 0, ui.sigmaAllowMPa, ui.buckleCheck);
      color = utilColor(u);
      width = 3 + Math.min(4, u * 2.5);
    }
    if (ui.selectedMember === m) { width += 2; }

    c.strokeStyle = color; c.lineWidth = width; c.lineCap = "round";
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();

    if (ui.selectedMember === m) {
      c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
  }

  /* ---------------- deflected shape ---------------- */
  drawDeflected(structure, ui) {
    const c = this.cx, sol = structure.solution;
    /* The override (dynamic / mode animation) can carry its own scale so that
       mode shapes and the physical time response magnify independently.     */
    const s = (ui.dynOverride && ui.dynOverride.scale != null) ? ui.dynOverride.scale
                                                               : ui.defScale;

    const pos = n => {
      const d = ui.dynOverride ? ui.dynOverride.dispOf(n) : Solver.nodeDisp(sol, n);
      return this.W2S(n.x + d.ux / 1000 * s, n.y + d.uy / 1000 * s);
    };

    /* stress range for colour normalisation: σ = N/A  (kN/cm² = 10 MPa) */
    let maxSigma = 0;
    if (ui.dynOverride) {
      for (const m of structure.members) maxSigma = Math.max(maxSigma, Math.abs(ui.dynOverride.forces.get(m.id) || 0) / m.A);
    } else {
      for (const m of structure.members) {
        const N = sol.memberForces.get(m.id) || 0;
        maxSigma = Math.max(maxSigma, Math.abs(N) / m.A);
      }
    }
    if (maxSigma < 1e-9) maxSigma = 1e-9;

    // deflected members, coloured by axial stress
    for (const m of structure.members) {
      const N = ui.dynOverride ? (ui.dynOverride.forces.get(m.id) || 0)
                               : (sol.memberForces.get(m.id) || 0);
      const sigma = N / m.A;                 // kN/cm²
      const t = Math.max(-1, Math.min(1, sigma / maxSigma));
      const a = pos(m.n1), b = pos(m.n2);
      c.strokeStyle = stressColor(t);
      c.lineWidth = 2.5 + 3 * Math.abs(t);
      c.lineCap = "round";
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    // deflected joints
    for (const n of structure.nodes) {
      const p = pos(n);
      c.fillStyle = "#e6edf5"; c.strokeStyle = "#0f141b"; c.lineWidth = 1.5;
      c.beginPath(); c.arc(p.x, p.y, 4, 0, Math.PI * 2); c.fill(); c.stroke();
    }

    if (ui.showLegend) this.drawStressLegend(maxSigma, ui.defScale);
  }

  /* small diverging legend, bottom-right of canvas */
  drawStressLegend(maxSigma, defScale) {
    const c = this.cx;
    const W = 170, H = 12, x0 = this.w - W - 16, y0 = this.h - 58;
    const steps = 60;
    for (let i = 0; i < steps; i++) {
      const t = -1 + 2 * (i + 0.5) / steps;
      c.fillStyle = stressColor(t);
      c.fillRect(x0 + i * W / steps, y0, W / steps + 1, H);
    }
    c.strokeStyle = "#2a3646"; c.lineWidth = 1;
    c.strokeRect(x0, y0, W, H);
    c.fillStyle = "#8b9aad"; c.font = "10px Consolas,monospace"; c.textAlign = "center";
    const toMPa = v => (v * 10).toFixed(1);          // kN/cm² → MPa
    c.fillText("-" + toMPa(maxSigma), x0 + 14, y0 + H + 12);
    c.fillText("σ [MPa]", x0 + W / 2, y0 + H + 12);
    c.fillText("+" + toMPa(maxSigma), x0 + W - 14, y0 + H + 12);
    c.fillText("compression ←    → tension   (deflected, " + defScale + "×)", x0 + W / 2, y0 - 5);
    c.textAlign = "left";
  }

  /* ---------------- distributed effects (self weight / thermal) ---------------- */
  drawDistributed(structure, ui) {
    const c = this.cx;
    /* self weight: small downward arrows at member midpoints */
    if (ui.selfWeightOn) {
      c.strokeStyle = "#7a5cff"; c.fillStyle = "#7a5cff"; c.lineWidth = 1.6;
      for (const m of structure.members) {
        const a = this.W2S(m.n1.x, m.n1.y), b = this.W2S(m.n2.x, m.n2.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const L = 12;
        c.beginPath(); c.moveTo(mx, my - L); c.lineTo(mx, my); c.stroke();
        c.beginPath();
        c.moveTo(mx, my);
        c.lineTo(mx - 4, my - 5);
        c.lineTo(mx + 4, my - 5);
        c.closePath(); c.fill();
      }
    }
    /* thermal: orange ΔT tag near each heated member */
    if (ui.thermalOn) {
      c.font = "10px Consolas,monospace";
      for (const m of structure.members) {
        if (!m.dT) continue;
        const a = this.W2S(m.n1.x, m.n1.y), b = this.W2S(m.n2.x, m.n2.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        c.fillStyle = "#ffb74d";
        c.fillText("ΔT " + (m.dT > 0 ? "+" : "") + m.dT + "°", mx + 6, my - 6);
      }
    }
  }

  /* ---------------- nodes, supports, loads, reactions ---------------- */
  drawNode(n, ui, structure) {
    const c = this.cx;
    const p = this.W2S(n.x, n.y);
    const sel = ui.selectedNode === n || ui.pendingNode === n;
    c.fillStyle = sel ? "#ffd54f" : "#e6edf5";
    c.strokeStyle = sel ? "#ffd54f" : "#0f141b";
    c.lineWidth = 2;
    c.beginPath(); c.arc(p.x, p.y, sel ? 6 : 5, 0, Math.PI * 2); c.fill(); c.stroke();
    if (ui.showLabels) {
      c.fillStyle = "#6d7f92"; c.font = "11px Consolas,monospace";
      c.fillText("n" + n.id, p.x + 8, p.y - 6);
    }
  }

  drawSupport(n) {
    const c = this.cx;
    if (n.support === "none") return;
    const p = this.W2S(n.x, n.y);
    c.strokeStyle = "#81c784"; c.fillStyle = "rgba(129,199,132,.85)"; c.lineWidth = 2;

    if (n.support === "pin") {
      c.beginPath();
      c.moveTo(p.x, p.y); c.lineTo(p.x - 12, p.y + 18); c.lineTo(p.x + 12, p.y + 18); c.closePath();
      c.fill();
      c.beginPath(); c.moveTo(p.x - 16, p.y + 18); c.lineTo(p.x + 16, p.y + 18); c.stroke();
    } else if (n.support === "rollerx") {   // restrains Y: roller on horizontal ground
      c.beginPath();
      c.moveTo(p.x, p.y); c.lineTo(p.x - 10, p.y + 12); c.lineTo(p.x + 10, p.y + 12); c.closePath();
      c.fill();
      c.beginPath(); c.arc(p.x - 6, p.y + 18, 5, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(p.x + 6, p.y + 18, 5, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(p.x - 16, p.y + 24); c.lineTo(p.x + 16, p.y + 24); c.stroke();
    } else if (n.support === "rollery") {   // restrains X: roller against vertical wall
      c.beginPath();
      c.moveTo(p.x, p.y); c.lineTo(p.x - 12, p.y - 10); c.lineTo(p.x - 12, p.y + 10); c.closePath();
      c.fill();
      c.beginPath(); c.arc(p.x - 18, p.y - 6, 5, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(p.x - 18, p.y + 6, 5, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(p.x - 24, p.y - 16); c.lineTo(p.x - 24, p.y + 16); c.stroke();
    }
  }

  drawLoad(n) {
    const c = this.cx;
    if (!n.px && !n.py) return;
    const p = this.W2S(n.x, n.y);
    const mag = Math.hypot(n.px, n.py);
    const L = Math.min(70, 30 + mag / 2);      // arrow length px
    const ux = n.px / mag, uy = n.py / mag;    // world direction
    // draw arrow ending at node, in world direction (x right, y up)
    const ex = p.x, ey = p.y;
    const sx = ex - ux * L, sy = ey + uy * L;  // note: screen y flipped
    c.strokeStyle = "#ef5350"; c.fillStyle = "#ef5350"; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
    // head
    const a = Math.atan2(ey - sy, ex - sx);
    c.beginPath();
    c.moveTo(ex, ey);
    c.lineTo(ex - 10 * Math.cos(a - 0.45), ey - 10 * Math.sin(a - 0.45));
    c.lineTo(ex - 10 * Math.cos(a + 0.45), ey - 10 * Math.sin(a + 0.45));
    c.closePath(); c.fill();
    c.font = "11px Consolas,monospace";
    c.fillText(mag.toFixed(0) + " kN", sx, sy - 6);
  }

  drawReaction(n, sol) {
    const c = this.cx;
    const r = sol.reactions.get(n.id);
    if (!r) return;
    const p = this.W2S(n.x, n.y);
    const mag = Math.hypot(r.rx, r.ry);
    if (mag < 0.01) return;
    const ux = r.rx / mag, uy = r.ry / mag;
    const L = Math.min(60, 25 + mag / 3);
    const sx = p.x, sy = p.y;
    const ex = sx + ux * L, ey = sy - uy * L;
    c.strokeStyle = "#81c784"; c.fillStyle = "#81c784"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
    const a = Math.atan2(ey - sy, ex - sx);
    c.beginPath();
    c.moveTo(ex, ey);
    c.lineTo(ex - 9 * Math.cos(a - 0.5), ey - 9 * Math.sin(a - 0.5));
    c.lineTo(ex - 9 * Math.cos(a + 0.5), ey - 9 * Math.sin(a + 0.5));
    c.closePath(); c.fill();
    c.font = "10px Consolas,monospace";
    c.fillText("R=" + mag.toFixed(1), ex + 4, ey);
  }

  /* Render the current view onto an offscreen canvas and return a PNG data URL.
     Used by the analysis report. The live view state is restored afterwards. */
  snapshot(width, height, structure, ui) {
    const save = { cv: this.cv, cx: this.cx, w: this.w, h: this.h,
                   scale: this.scale, ox: this.ox, oy: this.oy, dpr: this.dpr };
    const cv = document.createElement("canvas");
    cv.width = width; cv.height = height;
    this.cv = cv; this.cx = cv.getContext("2d");
    this.w = width; this.h = height; this.dpr = 1;
    this.fit(structure);
    this.render(structure, ui);
    const url = cv.toDataURL("image/png");
    this.cv = save.cv; this.cx = save.cx; this.w = save.w; this.h = save.h;
    this.scale = save.scale; this.ox = save.ox; this.oy = save.oy; this.dpr = save.dpr;
    return url;
  }

  /* ---------------- hit testing ---------------- */
  nodeAt(px, py, structure, tol = 10) {
    let best = null, bd = tol;
    for (const n of structure.nodes) {
      const p = this.W2S(n.x, n.y);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  memberAt(px, py, structure, tol = 8) {
    let best = null, bd = tol;
    for (const m of structure.members) {
      const a = this.W2S(m.n1.x, m.n1.y), b = this.W2S(m.n2.x, m.n2.y);
      const d = this._segDist(px, py, a, b);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  _segDist(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }
}
