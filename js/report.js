/* ============================================================
 * report.js — self-contained printable analysis report.
 *
 * Builds a standalone HTML document with:
 *   - model summary & material/load data
 *   - embedded PNG images (structure with forces, deflected shape)
 *   - charts drawn on offscreen canvases (member forces, stress,
 *     utilisation, joint displacements, reactions, dynamics)
 *   - full result tables (reactions, members, displacements)
 *   - dynamic analysis section (modes table + response plot)
 * ============================================================ */
"use strict";

const Report = {

  /** Bar chart → PNG data URL. opts: {colors:fn(i), threshold, unit, decimals} */
  _bars(width, height, labels, values, opts = {}) {
    const cv = document.createElement("canvas");
    cv.width = width; cv.height = height;
    const g = cv.getContext("2d");
    const padL = 58, padR = 14, padT = 18, padB = 28;

    /* symmetric scale so negative bars are fully visible */
    let vPos = 1e-9, vNeg = 1e-9;
    for (const v of values) {
      if (v >= 0) vPos = Math.max(vPos, v); else vNeg = Math.max(vNeg, -v);
    }
    if (opts.threshold != null) vPos = Math.max(vPos, Math.abs(opts.threshold));
    const yMax = vPos * 1.12, yMin = -vNeg * 1.12;
    const span = yMax - yMin;
    const X = i => padL + (width - padL - padR) * (i + 0.5) / Math.max(1, values.length);
    const Y = v => height - padB - (height - padT - padB) * (v - yMin) / span;

    g.strokeStyle = "#b6c0cc"; g.fillStyle = "#333"; g.lineWidth = 1;
    g.font = "11px ui-monospace,SFMono-Regular,Consolas,Menlo,monospace";
    g.beginPath(); g.moveTo(padL, padT); g.lineTo(padL, height - padB);
    g.lineTo(width - padR, height - padB); g.stroke();
    g.textAlign = "right"; g.fillText(opts.unit || "", padL - 6, padT + 4);

    /* zero line */
    const y0 = Y(0);
    g.strokeStyle = "#999"; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(padL, y0); g.lineTo(width - padR, y0); g.stroke();
    g.setLineDash([]);

    if (opts.threshold != null) {
      g.strokeStyle = "#d33"; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(padL, Y(opts.threshold)); g.lineTo(width - padR, Y(opts.threshold));
      g.stroke(); g.setLineDash([]);
      g.textAlign = "right"; g.fillStyle = "#d33";
      g.fillText("limit " + opts.threshold, width - padR - 4, Y(opts.threshold) - 4);
    }

    g.font = "11px ui-monospace,SFMono-Regular,Consolas,Menlo,monospace";
    values.forEach((v, i) => {
      const w = Math.min(34, (width - padL - padR) / values.length * 0.62);
      g.fillStyle = opts.colors ? opts.colors(i) : "#4fc3f7";
      const yA = Y(0), yB = Y(v);
      g.fillRect(X(i) - w / 2, Math.min(yA, yB), w, Math.max(1, Math.abs(yB - yA)));
      g.fillStyle = "#333"; g.textAlign = "center";
      g.fillText(labels[i], X(i), height - padB + 15);
      g.fillText(v.toFixed(opts.decimals != null ? opts.decimals : 0), X(i), Math.min(yA, yB) - 4);
    });
    return cv.toDataURL("image/png");
  },

  /** Line chart of one or more time series → PNG dataURL.
   *  series: array of {ys:[...], color, label}                  */
  _lines(width, height, tArr, series) {
    const cv = document.createElement("canvas");
    cv.width = width; cv.height = height;
    const g = cv.getContext("2d");
    const padL = 58, padR = 12, padT = 12, padB = 24;
    const tMin = Math.min(...tArr), tMax = Math.max(...tArr);
    let yMin = 1e9, yMax = -1e9;
    for (const s of series) for (const v of s.y) { yMin = Math.min(yMin, v); yMax = Math.max(yMax, v); }
    if (yMin > -1e-12) yMin = -yMax * 0.1;
    if (yMax < 1e-12) yMax = yMin * 0.1 + 1;
    const span = Math.max(1e-9, yMax - yMin);
    const X = t => padL + (width - padL - padR) * (t - tMin) / Math.max(1e-9, tMax - tMin);
    const Y = v => height - padB - (height - padT - padB) * (v - yMin) / span;

    g.strokeStyle = "#b8c0cc"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, padT); g.lineTo(padL, height - padB);
    g.lineTo(width - padR, height - padB); g.stroke();
    g.fillStyle = "#444"; g.font = "11px ui-monospace,SFMono-Regular,Consolas,Menlo,monospace"; g.textAlign = "right";
    g.fillText(yMax.toFixed(2), padL - 5, Y(yMax) + 3);
    g.fillText(yMin.toFixed(2), padL - 5, Y(yMin) + 3);
    g.fillText("0", padL - 5, Y(0) + 3);
    g.strokeStyle = "#aaa"; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(padL, Y(0)); g.lineTo(width - padR, Y(0)); g.stroke();
    g.setLineDash([]);

    series.forEach(s => {
      g.strokeStyle = s.color; g.lineWidth = 2;
      g.beginPath();
      tArr.forEach((t, i) => { const x = X(t), y = Y(s.y[i]); i === 0 ? g.moveTo(x, y) : g.lineTo(x, y); });
      g.stroke();
    });
    g.fillStyle = "#666"; g.textAlign = "center"; g.font = "11px ui-monospace,SFMono-Regular,Consolas,Menlo,monospace";
    g.fillText(tMin.toFixed(1), padL + 6, height - 6);
    g.fillText(tMax.toFixed(1), width - padR - 6, height - 6);
    g.fillText("t (s)", (width + padL - padR) / 2, height - 6);
    return cv.toDataURL("image/png");
  },

  /** Build the full report HTML string. */
  build(data) {
    const { structure, sol, renderer, ui, modal, dynResp } = data;
    const nodes = structure.nodes, members = structure.members;
    const now = new Date().toLocaleString();
    /* ---------- images (live-rendered snapshots) ---------- */
    /* 1) Undeflected structure — plain geometry, supports & loads, plus the
       distributed effects that were actually included in the analysis.    */
    const uiUndeformed = Object.assign({}, ui, {
      dynOverride: null, colorMode: "none",
      selfWeightOn: sol.selfWeight > 0,
      thermalOn: sol.thermal && sol.thermalFT > 0
    });
    const plainView = { members: structure.members, nodes: structure.nodes, solved: false, solution: null, solveError: null };
    const imgUndeformed = renderer.snapshot(780, 320, plainView, uiUndeformed);
    /* 2) Deflected structure ALONE (no original underneath) */
    const uiDef = Object.assign({}, ui, { dynOverride: null, colorMode: "force", showOriginal: false });
    const imgDef = renderer.snapshot(780, 320, structure, uiDef);
    /* 3) Structure with reaction arrows (no deflected overlay) */
    const uiReac = Object.assign({}, ui, { dynOverride: null, colorMode: "force", noDeflected: true });
    const imgReacStruct = renderer.snapshot(780, 320, structure, uiReac);

    /* ---------- data series ---------- */
    const mLbl = members.map(m => "M" + m.id);
    const nLbl = nodes.map(n => "n" + n.id);
    const fForces = members.map(m => sol.memberForces.get(m.id) || 0);
    const fSigma = members.map(m => (sol.memberForces.get(m.id) || 0) / m.A * 10);
    const fUtil = members.map(m => Structure.utilization(m, sol.memberForces.get(m.id) || 0, ui.sigmaAllowMaxMPa, ui.sigmaAllowMinMPa, ui.buckleCheck));
    const fDisp = nodes.map(n => { const d = Solver.nodeDisp(sol, n); return Math.hypot(d.ux, d.uy); });
    const signedColor = i => fForces[i] < 0 ? "#e8710a" : "#1a73d8";
    const utilColor = i => fUtil[i] > 1 ? "#d33434" : fUtil[i] > 0.8 ? "#e8710a" : "#188038";

    const imgForces = this._bars(760, 250, mLbl, fForces, { colors: signedColor, decimals: 0 });
    const imgSigma  = this._bars(760, 250, mLbl, fSigma, { colors: signedColor, decimals: 0 });
    const imgUtil   = this._bars(760, 250, mLbl, fUtil, { colors: utilColor, threshold: 1, decimals: 2 });
    const imgDisp   = this._bars(760, 250, nLbl, fDisp, { colors: () => "#1a73d8", decimals: 2 });

    /* reactions */
    const supp = nodes.filter(n => { const r = sol.reactions.get(n.id); return r && (r.rx || r.ry); });
    const sLbl = [], sVals = [];
    supp.forEach(n => { const r = sol.reactions.get(n.id);
      if (r.rx) { sLbl.push("n" + n.id + ".x"); sVals.push(r.rx); }
      if (r.ry) { sLbl.push("n" + n.id + ".y"); sVals.push(r.ry); }
    });
    const imgReac = this._bars(760, 230, sLbl, sVals, { colors: i => sVals[i] < 0 ? "#e8710a" : "#1a73d8", decimals: 1 });

    /* ---------- dynamics ---------- */
    let dynHtml = `<h2>6. Dynamic analysis</h2><p class="meta">No modal analysis performed in this session.</p>`;
    if (modal && modal.modes.length) {
      const imgModes = this._bars(600, 220, modal.modes.map((m, i) => String(i + 1)),
        modal.modes.map(m => m.freq), { colors: () => "#6a3db8", decimals: 2 });
      let rows = "";
      modal.modes.forEach((m, i) => { rows += `<tr><td>${i + 1}</td><td>${m.freq.toFixed(2)} Hz</td><td>${(1 / m.freq).toFixed(4)} s</td></tr>`; });
      let dynPlot = "";
      if (dynResp && dynResp.ts) {
        let mi = 0, mv = 0;
        for (let i = 0; i < sol.ndof; i++) if (Math.abs(sol.disp[i]) > mv) { mv = Math.abs(sol.disp[i]); mi = i; }
        const tArr = Array.from(dynResp.ts);
        const yArr = new Array(tArr.length);
        for (let s = 0; s < tArr.length; s++) {
          const u = dynResp.uOfStep(s);
          yArr[s] = u[mi] * 1000;   // mm
        }
        dynPlot = `<img src="${this._lines(760, 240, tArr, [{ y: yArr, color: "#1a73e8" }])}" alt="dynamic response (dof ${mi})">`;
      }
      dynHtml = `<h2>6. Dynamic analysis (modal)</h2>
        <table class="minitab"><tr><th>Mode</th><th>f (Hz)</th><th>T (s)</th></tr>${rows}</table>
        <img src="${imgModes}" alt="natural frequencies">
        ${dynPlot}
        <p class="meta">Natural frequencies from K·φ = ω²M·φ (lumped mass). ${dynResp ? "Time history below uses modal superposition (Duhamel recursion)." : ""}</p>`;
    }

    /* ---------- tables ---------- */
    const reactRows = supp.map(n => { const r = sol.reactions.get(n.id);
      return `<tr><td>n${n.id}</td><td>${r.rx.toFixed(2)}</td><td>${r.ry.toFixed(2)}</td></tr>`; }).join("") ||
      `<tr><td colspan="3">—</td></tr>`;

    const memRows = members.map(m => {
      const N = sol.memberForces.get(m.id) || 0;
      const U = Structure.utilization(m, N, ui.sigmaAllowMaxMPa, ui.sigmaAllowMinMPa, ui.buckleCheck);
      const state = Math.abs(N) < 0.05 ? "zero" : N > 0 ? "T" : "C";
      return `<tr><td>${m.id}</td><td>n${m.n1.id}–n${m.n2.id}</td><td>${m.length.toFixed(2)}</td>
        <td>${m.A}</td><td>${N.toFixed(2)}</td><td>${(N / m.A * 10).toFixed(1)}</td>
        <td class="${U > 1 ? "fail" : "ok"}">${U.toFixed(2)}</td><td>${state}</td></tr>`;
    }).join("");

    const dispRows = nodes.map(n => {
      const d = Solver.nodeDisp(sol, n);
      return `<tr><td>n${n.id}</td><td>${d.ux.toFixed(2)}</td><td>${d.uy.toFixed(2)}</td><td>${Math.hypot(d.ux, d.uy).toFixed(2)}</td></tr>`;
    }).join("");

    const totalPx = nodes.reduce((a, n) => a + n.px, 0);
    const totalPy = nodes.reduce((a, n) => a + n.py, 0);

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Truss Analysis Report</title>
      <style>
        body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;margin:34px 46px;color:#1c2430;font-size:13px;line-height:1.5}
        h1{font-size:24px;border-bottom:3px solid #1a4b8c;padding-bottom:8px}
        h2{font-size:17px;margin:30px 0 8px;color:#1a4b8c;border-bottom:1px solid #c7d3e0;padding-bottom:4px}
        table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}
        th,td{border:1px solid #b6c0cc;padding:5px 9px;text-align:right}
        th{background:#e6eef7} td:first-child,th:first-child{text-align:left}
        .ok{color:#1a7d2e}.fail{color:#c00;font-weight:bold}
        .meta{color:#556;font-size:11.5px;margin:3px 0}
        img{max-width:100%;height:auto;border:1px solid #dfe6ef;border-radius:6px;margin:6px 0}
        .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
        .kv{border-collapse:collapse;margin:4px 0}
        .kv td{border:none;padding:3px 8px;text-align:left}
        .kv td:first-child{color:#556;width:45%}
        @media print{body{margin:10mm} button{display:none}}
        @page{size:A4;margin:12mm}
      </style></head><body>
      <h1>Truss Analysis Report</h1>
      <p class="meta">Generated ${now}</p>
      <button onclick="window.print()">Print / Save as PDF</button>

      <h2>1. Model</h2>
      <table class="kv">
        <tr><td>Joints / members</td><td>${nodes.length} / ${members.length}</td></tr>
        <tr><td>Applied load Σ</td><td>(${totalPx.toFixed(1)}, ${totalPy.toFixed(1)}) kN</td></tr>
        <tr><td>Allowable stress σ_allow</td><td>max ${ui.sigmaAllowMaxMPa} MPa (tension) / min ${ui.sigmaAllowMinMPa} MPa (compression)</td></tr>
        <tr><td>Buckling check</td><td>${ui.buckleCheck ? "Euler (pin-ended)" : "off"}</td></tr>
        ${sol.selfWeight > 0 ? `<tr><td>Self weight</td><td>${sol.selfWeight.toFixed(2)} kN (ρ=${sol.rho} kg/m³)</td></tr>` : ""}
        ${sol.thermal ? `<tr><td>Thermal</td><td>α=${sol.alpha} µε/°C</td></tr>` : ""}
        ${sol.verify != null ? `<tr><td>Equilibrium residual |Ku−P|</td><td>${sol.verify.toExponential(1)} kN</td></tr>` : ""}
        ${sol.virtErr != null ? `<tr><td>Virtual-work residual |δ_vw−δ|</td><td>${sol.virtErr.toExponential(1)} mm</td></tr>` : ""}
      </table>
      <img src="${imgUndeformed}" alt="undeflected structure">

      <h2>2. Deflected structure</h2>
      <p class="meta">Magnified ${ui.defScale}× — only the deformed geometry is shown, members coloured by axial stress.</p>
      <img src="${imgDef}" alt="deflected shape (magnified)">

      <h2>3. Member results</h2>
      <div class="grid2">
        <figure><img src="${imgSigma}" alt="axial stress"><figcaption class="meta">Axial stress σ = N/A (MPa), blue = tension, orange = compression</figcaption></figure>
        <figure><img src="${imgUtil}" alt="utilisation"><figcaption class="meta">Utilisation σ/σ_lim (threshold 1.0 red = fails)</figcaption></figure>
      </div>
      <table>
        <tr><th>M</th><th>Nodes</th><th>L (m)</th><th>A (cm²)</th><th>N (kN)</th><th>σ (MPa)</th><th>Util</th><th>State</th></tr>
        ${memRows}
      </table>

      <h2>4. Joint displacements</h2>
      <img src="${imgDisp}" alt="joint displacement magnitude">
      <table>
        <tr><th>Joint</th><th>ux (mm)</th><th>uy (mm)</th><th>|d|</th></tr>
        ${dispRows}
      </table>

      <h2>5. Reactions</h2>
      <img src="${imgReacStruct}" alt="structure with reaction arrows">
      <img src="${imgReac}" alt="support reactions bar chart">
      <table><tr><th>Joint</th><th>Rx (kN)</th><th>Ry (kN)</th></tr>${reactRows}</table>

      ${this._workedHtml(structure, sol)}
      ${this._influenceHtml(structure, sol)}

      ${dynHtml}

      <p class="meta">First-order linear elastic analysis by the unit-load (virtual-work) method.
      Buckling: Euler, pin-ended member; local buckling &amp; code checks excluded. Dynamic results assume
      lumped masses and small displacements.</p>
      </body></html>`;
  },

  /* ---------- worked solution (method of joints) ---------- */
  _workedHtml(structure, sol) {
    let html = `<h2>6. Worked solution — method of joints</h2>`;
    const res = Worked.joints(structure, sol);
    if (!res.allKnown) {
      html += `<p class="meta">The truss is statically indeterminate or has a mechanism, so the method of joints cannot solve every member by equilibrium alone. Use the exact stiffness solution (Section 3) for the full result.</p>`;
      return html;
    }
    html += `<p class="meta">Each joint is solved in turn from ΣFx = 0 and ΣFy = 0, using the reactions and previously-found member forces.</p>`;
    res.steps.forEach((st, i) => {
      const j = st.joint;
      const parts = st.unknowns.map((m, k) => {
        const v = st.values[k];
        const state = Math.abs(v) < 0.05 ? "zero" : (v > 0 ? "T" : "C");
        return `M${m.id} = ${v.toFixed(2)} kN (${state})`;
      });
      html += `<p><b>Step ${i + 1} — joint n${j.id}</b> (${j.x.toFixed(2)}, ${j.y.toFixed(2)}): ΣFx: ${st.fx.toFixed(2)} + ΣNx = 0, ΣFy: ${st.fy.toFixed(2)} + ΣNy = 0 → ${parts.join(", ")}</p>`;
    });
    return html;
  },

  /* ---------- influence lines ---------- */
  _influenceHtml(structure, sol) {
    const members = structure.members;
    if (members.length === 0) return "";
    /* pick a representative member (first) and a reaction for the report */
    const pick = members[0];
    const dataM = Influence.line(structure, { axis: "y", memberId: pick.id });
    const cv = document.createElement("canvas");
    cv.width = 760; cv.height = 240;
    cv.style.width = "100%";
    Influence.draw(cv, dataM, { title: `Influence line of M${pick.id} (unit vertical load)` });
    const img = cv.toDataURL("image/png");
    return `<h2>7. Influence lines</h2>
      <p class="meta">A unit load moves along the joints; the plot shows the response of the chosen quantity at each load position (exact stiffness solution).</p>
      <img src="${img}" alt="influence line of a member force">
      <p class="meta">Example shown: member M${pick.id}. Use the <b>Learn → Influence lines</b> tool in the app to plot any member force or reaction.</p>`;
  }
};
