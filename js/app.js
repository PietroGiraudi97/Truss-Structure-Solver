/* ============================================================
 * app.js — UI controller: tools, events, results.
 * ============================================================ */
"use strict";

(() => {
  const cv   = document.getElementById("canvas");
  const $    = id => document.getElementById(id);
  const renderer = new Renderer(cv);
  let structure = new Structure();

  const ui = {
    tool: "node",
    showGrid: true, snap: true, showLabels: true,
    showOriginal: true, showLegend: true,
    colorMode: "force",            // "force" | "util" | "none"
    sigmaAllowMPa: 157,            // S235 yield 235 / FS 1.5
    buckleCheck: true,
    defaultI: 0,                   // cm⁴ for new members (0 = solid eq.)
    defScale: 50, autoScale: false,
    selectedNode: null, selectedMember: null,
    pendingNode: null, mouse: null,
    dynOverride: null, dynAnimMode: 0
  };

  /* ---------- steel section library ---------- */
  const fillSections = (sel) => {
    sel.innerHTML = Structure.SECTIONS.map(s =>
      `<option value="${s.I}__${s.A}" data-label="${s.label}">${s.label} (A=${s.A}, I=${s.I})</option>`).join("");
  };
  fillSections($("sel-section"));
  fillSections($("sel-mSection"));
  const applySection = (sel, setI, setA) => {
    const [I, A] = sel.value.split("__").map(Number);
    setI(I || 0);
    if (setA) setA(A || 20);
  };
  $("sel-section").addEventListener("change", () => {
    applySection($("sel-section"), v => ui.defaultI = v, v => $("inp-A").value = v);
  });
  $("sel-mSection").addEventListener("change", () => {
    if (!ui.selectedMember) return;
    applySection($("sel-mSection"), v => { ui.selectedMember.I = v; $("sel-mI").value = v; },
                 v => { ui.selectedMember.A = v; $("sel-mA").value = v; });
    structure.invalidate(); refreshResults(); draw();
  });

  const status = (msg, cls = "") => {
    const el = $("status-text");
    el.textContent = msg;
    el.className = cls;
  };

  /* ======================= TOOLS ======================= */
  const hints = {
    node:    "Click empty space to place a node. Click an existing node to select it.",
    member:  "Click a start node, then an end node, to create a member. ESC cancels.",
    support: "Click a node to cycle: none → pin → roller(Y) → roller(X).",
    load:    "Click a node, then enter the load components.",
    select:  "Click a node or member to edit it in the panel."
  };

  document.querySelectorAll(".tool").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".tool").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      ui.tool = b.dataset.tool;
      ui.pendingNode = null;
      $("tool-hint").textContent = hints[ui.tool];
      draw();
    });
  });

  /* ======================= CANVAS EVENTS ======================= */
  const snap = v => ui.snap ? Math.round(v * 4) / 4 : v;

  function evPos(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  let panning = false, panStart = null;

  cv.addEventListener("mousedown", e => {
    const p = evPos(e);
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {   // pan
      panning = true; panStart = p; cv.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;
    handleClick(p);
  });

  cv.addEventListener("mousemove", e => {
    const p = evPos(e);
    ui.mouse = p;
    if (panning) {
      renderer.pan(p.x - panStart.x, p.y - panStart.y);
      panStart = p;
    }
    const w = renderer.S2W(p.x, p.y);
    $("coord-text").textContent = `x = ${w.x.toFixed(2)} m,  y = ${w.y.toFixed(2)} m`;
    draw();
  });

  window.addEventListener("mouseup", () => { panning = false; cv.style.cursor = "crosshair"; });

  cv.addEventListener("wheel", e => {
    e.preventDefault();
    const p = evPos(e);
    renderer.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    draw();
  }, { passive: false });

  window.addEventListener("keydown", e => {
    if (e.key === "Escape") { ui.pendingNode = null; clearSelection(); draw(); }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
      deleteSelection();
    }
  });

  function handleClick(p) {
    const w = renderer.S2W(p.x, p.y);
    const hitNode = renderer.nodeAt(p.x, p.y, structure);

    switch (ui.tool) {
      case "node": {
        if (hitNode) { selectNode(hitNode); break; }
        pushHistory();
        const n = structure.addNode(snap(w.x), snap(w.y));
        selectNode(n);
        status(`Node n${n.id} added at (${n.x.toFixed(2)}, ${n.y.toFixed(2)}).`, "ok");
        break;
      }
      case "member": {
        if (!hitNode) { status("Members connect nodes — click an existing node first.", "err"); break; }
        if (!ui.pendingNode) {
          ui.pendingNode = hitNode;
          selectNode(hitNode);
          status(`Start node n${hitNode.id} — click the end node.`);
        } else {
          if (hitNode === ui.pendingNode) { ui.pendingNode = null; draw(); break; }
          pushHistory();
          const m = structure.addMember(ui.pendingNode, hitNode,
            parseFloat($("inp-E").value) || 21000, parseFloat($("inp-A").value) || 20);
          if (m) { m.I = ui.defaultI; status(`Member ${m.id} created (L = ${m.length.toFixed(3)} m).`, "ok"); selectMember(m); }
          else status("A member already connects these nodes.", "err");
          ui.pendingNode = null;
        }
        break;
      }
      case "support": {
        if (!hitNode) { status("Click a node to set its support.", "err"); break; }
        pushHistory();
        const order = ["none", "pin", "rollerx", "rollery"];
        hitNode.support = order[(order.indexOf(hitNode.support) + 1) % order.length];
        structure.invalidate();
        selectNode(hitNode);
        status(`n${hitNode.id} support → ${hitNode.support}.`, "ok");
        break;
      }
      case "load": {
        if (!hitNode) { status("Click a node to apply a load.", "err"); break; }
        selectNode(hitNode);
        ui.tool = "select";
        document.querySelectorAll(".tool").forEach(x => x.classList.toggle("active", x.dataset.tool === "select"));
        $("tool-hint").textContent = hints.select;
        $("sel-px").focus(); $("sel-px").select();
        status(`Editing load on n${hitNode.id} — set Px / Py in the panel.`, "ok");
        break;
      }
      case "select": {
        if (hitNode) { selectNode(hitNode); break; }
        const hitM = renderer.memberAt(p.x, p.y, structure);
        if (hitM) { selectMember(hitM); break; }
        clearSelection();
        break;
      }
    }
    draw();
  }

  /* ======================= SELECTION / EDIT PANEL ======================= */
  function selectNode(n) {
    ui.selectedNode = n; ui.selectedMember = null;
    $("member-edit").style.display = "none";
    $("selection-edit").style.display = "block";
    $("selection-info").innerHTML = `<p>Node <b>n${n.id}</b></p>`;
    $("sel-x").value = n.x; $("sel-y").value = n.y;
    $("sel-px").value = n.px; $("sel-py").value = n.py;
    $("sel-mass").value = n.mass || 0;
    $("sel-support").value = n.support;
  }
  function selectMember(m) {
    ui.selectedMember = m; ui.selectedNode = null;
    $("selection-edit").style.display = "none";
    $("member-edit").style.display = "block";
    let Ntxt = "";
    if (structure.solved && structure.solution) {
      const N = structure.solution.memberForces.get(m.id);
      Ntxt = ` — N = ${N.toFixed(2)} kN (${N >= 0 ? "T" : "C"})`;
    }
    $("selection-info").innerHTML =
      `<p>Member <b>${m.id}</b>: n${m.n1.id}–n${m.n2.id}, L = ${m.length.toFixed(3)} m${Ntxt}</p>`;
    $("sel-mE").value = m.E; $("sel-mA").value = m.A; $("sel-mdT").value = m.dT;
    $("sel-mI").value = m.I || 0;
    const sec = Structure.SECTIONS.find(s => Math.abs(s.A - m.A) < 0.5 && Math.abs(s.I - (m.I || 0)) < 1e-9);
    $("sel-mSection").value = sec ? (sec.I + "__" + sec.A) : "";
  }
  function clearSelection() {
    ui.selectedNode = null; ui.selectedMember = null;
    $("selection-edit").style.display = "none";
    $("member-edit").style.display = "none";
    $("selection-info").innerHTML = `<p class="hint">Nothing selected.</p>`;
  }
  function deleteSelection() {
    if (ui.selectedNode || ui.selectedMember) pushHistory();
    if (ui.selectedNode) { structure.deleteNode(ui.selectedNode); status("Node deleted.", "ok"); }
    else if (ui.selectedMember) { structure.deleteMember(ui.selectedMember); status("Member deleted.", "ok"); }
    clearSelection(); refreshResults(); draw();
  }

  $("btn-del-node").addEventListener("click", deleteSelection);
  $("btn-del-member").addEventListener("click", deleteSelection);

  /* live edit bindings */
  const bind = (id, fn) => $(id).addEventListener("input", e => { fn(parseFloat(e.target.value)); structure.invalidate(); refreshResults(); draw(); });
  bind("sel-x", v => { if (ui.selectedNode && !isNaN(v)) ui.selectedNode.x = v; });
  bind("sel-y", v => { if (ui.selectedNode && !isNaN(v)) ui.selectedNode.y = v; });
  bind("sel-px", v => { if (ui.selectedNode && !isNaN(v)) ui.selectedNode.px = v; });
  bind("sel-py", v => { if (ui.selectedNode && !isNaN(v)) ui.selectedNode.py = v; });
  bind("sel-mass", v => { if (ui.selectedNode && !isNaN(v)) ui.selectedNode.mass = Math.max(0, v); });
  $("sel-support").addEventListener("change", e => {
    if (ui.selectedNode) { ui.selectedNode.support = e.target.value; structure.invalidate(); refreshResults(); draw(); }
  });
  bind("sel-mE", v => { if (ui.selectedMember && !isNaN(v)) ui.selectedMember.E = v; });
  bind("sel-mA", v => { if (ui.selectedMember && !isNaN(v)) { ui.selectedMember.A = v; ui.selectedMember.I = 0; $("sel-mI").value = 0; $("sel-mSection").value = ""; } });
  bind("sel-mI", v => { if (ui.selectedMember && !isNaN(v)) { ui.selectedMember.I = Math.max(0, v); $("sel-mSection").value = ""; } });
  bind("sel-mdT", v => { if (ui.selectedMember && !isNaN(v)) ui.selectedMember.dT = v; });

  /* display toggles */
  const toggle = (id, key) => $(id).addEventListener("change", e => { ui[key] = e.target.checked; draw(); });
  toggle("chk-grid", "showGrid"); toggle("chk-snap", "snap");
  toggle("chk-labels", "showLabels"); toggle("chk-orig", "showOriginal");
  toggle("chk-auto", "autoScale");
  toggle("chk-legend", "showLegend");
  toggle("chk-buckle", "buckleCheck");
  $("chk-buckle").addEventListener("change", () => refreshResults());
  $("inp-sallow").addEventListener("input", e => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > 0) { ui.sigmaAllowMPa = v; refreshResults(); draw(); }
  });
  $("sel-colormode").addEventListener("change", e => { ui.colorMode = e.target.value; draw(); });
  $("range-defscale").addEventListener("input", e => {
    ui.defScale = parseFloat(e.target.value);
    $("defscale-val").textContent = ui.defScale + "×";
    ui.autoScale = false; $("chk-auto").checked = false;
    draw();
  });

  /* ======================= SOLVE ======================= */
  function solveNow() {
    const chk = structure.check();
    if (!chk.ok) { status(chk.msg, "err"); }
    try {
      structure.solution = Solver.solve(structure, {
        selfWeight: { include: $("chk-sw").checked, rho: parseFloat($("inp-rho").value) || 7850 },
        thermal:    { include: $("chk-th").checked, alpha: parseFloat($("inp-alpha").value) ?? 12 }
      });
      structure.solved = true;
      structure.solveError = null;
      setAutoScale();
      status(`Solved — ${chk.msg}`, "ok");
    } catch (err) {
      structure.solved = false; structure.solution = null;
      structure.solveError = err.message;
      status(err.message, "err");
    }
    refreshResults(); draw();
  }
  $("btn-solve").addEventListener("click", solveNow);

  /* re-solve automatically when self-weight settings change (if already solved) */
  const swChanged = () => { if (structure.solved) solveNow(); };
  $("chk-sw").addEventListener("change", swChanged);
  $("inp-rho").addEventListener("change", swChanged);
  $("chk-th").addEventListener("change", swChanged);
  $("inp-alpha").addEventListener("change", swChanged);
  $("btn-dTall").addEventListener("click", () => {
    const dT = parseFloat($("inp-dTall").value) || 0;
    for (const m of structure.members) m.dT = dT;
    structure.invalidate();
    status(`ΔT = ${dT} °C applied to all ${structure.members.length} members — re-solving.`, "ok");
    solveNow();
  });

  function setAutoScale() {
    if (!structure.solved || !structure.solution || !ui.autoScale) return;
    let maxD = 0;
    for (const n of structure.nodes) {
      const d = Solver.nodeDisp(structure.solution, n);
      maxD = Math.max(maxD, Math.hypot(d.ux, d.uy));
    }
    let size = 0;
    for (const n of structure.nodes) size = Math.max(size, Math.abs(n.x), Math.abs(n.y));
    if (maxD > 1e-9 && size > 1e-9) {
      ui.defScale = Math.max(1, Math.round(0.06 * size * 1000 / maxD));
      $("range-defscale").value = Math.min(500, ui.defScale);
      $("defscale-val").textContent = ui.defScale + "×";
    }
  }

  function refreshResults() {
    const sumEl = $("results-summary");
    const mb = document.querySelector("#tbl-members tbody");
    const db = document.querySelector("#tbl-disp tbody");
    mb.innerHTML = ""; db.innerHTML = "";

    if (!structure.solved || !structure.solution) {
      sumEl.innerHTML = `<p class="hint">${structure.solveError ? `<span class="err">${structure.solveError}</span>` : "Not solved yet."}</p>`;
      return;
    }
    const sol = structure.solution;

    // summary + equilibrium check
    let maxD = 0, dNode = null;
    for (const n of structure.nodes) {
      const d = Solver.nodeDisp(sol, n), m = Math.hypot(d.ux, d.uy);
      if (m > maxD) { maxD = m; dNode = n; }
    }
    sumEl.innerHTML = `
      <p class="big ok">Solved ✓</p>
      <p>Max displacement: <b>${maxD.toFixed(2)} mm</b> at n${dNode.id}</p>
      <p class="mono">Equilibrium residual |Ku−P|∞: ${sol.verify.toExponential(1)} kN</p>
      <p class="mono">Virtual-work check |δ_vw − δ|: ${sol.virtErr.toExponential(1)} mm ${sol.virtualPossible ? "" : "(n/a)"}</p>
      ${sol.selfWeight > 0 ? `<p class="mono">Self weight included: ${sol.selfWeight.toFixed(2)} kN (ρ = ${sol.rho} kg/m³)</p>` : ""}
      ${sol.thermal ? `<p class="mono">Thermal: α = ${sol.alpha} µε/°C, Σ|F_T| = ${sol.thermalFT.toFixed(1)} kN ${sol.thermalFT === 0 ? "(no ΔT set)" : ""}</p>` : ""}
      <p class="hint">Displacements obtained from virtual work, δ = Σ n·N·L/(EA).<br>Deflected members coloured by axial stress σ = N/A (blue tension → red compression).</p>`;

    // member table
    let maxUtil = 0, utilMember = null;
    for (const m of structure.members) {
      const N = sol.memberForces.get(m.id), dL = sol.memberDelta.get(m.id);
      const U = Structure.utilization(m, N, ui.sigmaAllowMPa, ui.buckleCheck);
      if (U > maxUtil) { maxUtil = U; utilMember = m; }
      const tr = document.createElement("tr");
      const cls = Math.abs(N) < 0.05 ? "Z" : (N > 0 ? "T" : "C");
      tr.innerHTML = `<td>${m.id} <span class="hint">n${m.n1.id}–n${m.n2.id}${m.dT ? " ΔT" + m.dT + "°" : ""}</span></td>
                      <td class="${cls}">${N.toFixed(2)}</td>
                      <td>${(N / m.A * 10).toFixed(1)}</td>
                      <td class="${U > 1 ? "Ufail" : U > 0.8 ? "Uwarn" : "Uok"}">${U.toFixed(2)}</td>`;
      tr.title = `σ = ${(N / m.A * 10).toFixed(1)} MPa   elongation ${dL.toFixed(3)} mm`;
      tr.addEventListener("click", () => { selectMember(m); draw(); });
      mb.appendChild(tr);
    }
    const ds = $("design-status");
    if (structure.members.length) {
      ds.textContent = `max util ${maxUtil.toFixed(2)} (M${utilMember.id}) ${maxUtil > 1 ? "— FAILS" : "— OK"}`;
      ds.style.color = maxUtil > 1 ? "var(--danger)" : "var(--ok)";
    } else ds.textContent = "";
    $("btn-export").disabled = false;
    $("btn-report").disabled = false;

    // displacement table
    for (const n of structure.nodes) {
      const d = Solver.nodeDisp(sol, n);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>n${n.id}</td><td>${d.ux.toFixed(2)}</td><td>${d.uy.toFixed(2)}</td><td>${Math.hypot(d.ux, d.uy).toFixed(2)}</td>`;
      tr.addEventListener("click", () => { selectNode(n); draw(); });
      db.appendChild(tr);
    }
  }

  /* ======================= DYNAMICS ======================= */
  let dynModes = null;      // result of Dynamics.modes(...)
  let dynResp = null;       // result of Dynamics.response(...)
  let anim = null;          // {raf, start, kind:'mode'|'resp', ...}
  const stopAnim = () => { if (anim) cancelAnimationFrame(anim.raf); anim = null; ui.dynOverride = null; };

  function dynSummary(msg, cls = "") {
    $("dyn-summary").innerHTML = `<p class="${cls}">${msg}</p>`;
  }
  dynSummary("Solve statically first.");

  /* ----- modal analysis ----- */
  $("btn-modes").addEventListener("click", () => {
    if (!structure.solved || !structure.solution) { dynSummary("Run the static Solve first — K is needed.", "err2"); return; }
    stopAnim();
    try {
      const sol = structure.solution;
      const rho = parseFloat($("inp-rho").value) || 7850;
      dynModes = Dynamics.modes(structure, sol.K, sol.ndof, rho, sol.dofIndex, 8);
      dynResp = null;
      const tb = document.querySelector("#tbl-modes tbody");
      tb.innerHTML = "";
      dynModes.modes.forEach((mo, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${i + 1}</td><td>${mo.freq.toFixed(2)}</td><td>${(1 / mo.freq).toFixed(3)}</td>
                        <td><input type="checkbox" checked data-mode="${i}" title="include in response"></td>`;
        tr.addEventListener("click", e => {
          if (e.target.tagName === "INPUT") return;
          document.querySelectorAll("#tbl-modes tr").forEach(r => r.style.background = "");
          tr.style.background = "#12354a";
          previewMode(i);
        });
        tb.appendChild(tr);
      });
      let totalMass = 0;
      dynModes.modes.length && dynModes.M.forEach(m => totalMass += m);
      dynSummary(`<b>${dynModes.modes.length} modes</b> found. Total mass ${(totalMass * 1000).toFixed(0)} kg.` +
                 ` Click a row to preview the mode shape.`, "ok2");
      $("btn-anim-mode").disabled = false;
      $("btn-run-dyn").disabled = false;
      if (dynModes.modes.length) previewMode(0);
    } catch (err) {
      dynSummary(err.message, "err2");
    }
  });

  function previewMode(i) {
    if (!dynModes) return;
    ui.dynAnimMode = i;
    /* static preview: scale mode so max |u| = 5% of structure size */
    animateMode(i);
  }

  function animateMode(i) {
    stopAnim();
    const mo = dynModes.modes[i], sol = structure.solution;
    let size = 0;
    structure.nodes.forEach(n => { size = Math.max(size, Math.hypot(n.x, n.y), 1); });
    /* Mode amplitudes are arbitrary (eigenvector scale), so normalise the
       shape itself to a fixed visual amplitude and BYPASS the physical
       deformation-scale slider: renderer uses override.scale = 1.          */
    let mx = 0; mo.shape.forEach(v => mx = Math.max(mx, Math.abs(v)));
    if (mx < 1e-12) return;
    const targetMm = size * 0.07 * 1000;                     // ~7% of structure size, in mm
    const scl = targetMm / mx;
    const dispOf = (n, ph) => {
      const d = sol.dofIndex.get(n.id);
      const ux = (d.ux >= 0 ? mo.shape[d.ux] : 0) * scl * ph;
      const uy = (d.uy >= 0 ? mo.shape[d.uy] : 0) * scl * ph;
      return { ux, uy };
    };
    const forces0 = structure.solution.memberForces;       // cosmetic only in mode preview
    anim = { kind: "mode", modeIdx: i };
    const t0 = performance.now();
    const frame = now => {
      const ph = Math.sin((now - t0) / 1000 * mo.omega * 2);  // slowed ×2 for visibility
      ui.dynOverride = { dispOf: n => dispOf(n, ph), forces: forces0, scale: 1 };
      draw();
      anim.raf = requestAnimationFrame(frame);
    };
    anim.raf = requestAnimationFrame(frame);
    dynSummary(`Mode ${i + 1}: f = ${mo.freq.toFixed(2)} Hz (animating — click canvas to stop; amplitude normalised, not physical)`, "ok2");
  }

  $("btn-anim-mode").addEventListener("click", () => animateMode(ui.dynAnimMode || 0));
  cv.addEventListener("mousedown", () => { if (anim && anim.kind === "mode") { stopAnim(); draw(); } });

  /* ----- time-history load shapes ----- */
  function loadLambda() {
    const typ = $("sel-history").value, f = parseFloat($("inp-freq").value) || 0;
    switch (typ) {
      case "step":     return t => 1;
      case "pulse":    return t => (t <= f ? 1 : 0);
      case "harmonic": return t => Math.sin(2 * Math.PI * f * t);
      case "ramp": {
        const Te = parseFloat($("inp-tend").value) || 2;
        return t => Math.min(1, t / (0.2 * Te));
      }
    }
  }

  $("btn-run-dyn").addEventListener("click", () => {
    if (!dynModes || !structure.solved) return;
    stopAnim();
    const sol = structure.solution;
    try {
      const used = [...document.querySelectorAll("#tbl-modes input[data-mode]")].map(cb => cb.checked);
      const mdl = dynModes.modes.map((m, i) => Object.assign({}, m, { used: used[i] }));
      dynResp = Dynamics.response(mdl, dynModes.M, sol.Pf, {
        lambda: loadLambda(),
        tEnd: parseFloat($("inp-tend").value) || 2,
        dt: 1 / (30 * dynModes.modes[0].freq),
        zeta: (parseFloat($("inp-zeta").value) || 0) / 100
      });
      $("btn-play").disabled = false;
      drawDynPlot();
      playResponse();
    } catch (err) { dynSummary(err.message, "err2"); }
  });

  $("btn-play").addEventListener("click", () => { if (dynResp) playResponse(); });

  function playResponse() {
    stopAnim();
    const sol = structure.solution, R = dynResp;
    const connInfo = structure.members.map(m => {
      const { cx, cy } = m.cos();
      const a = sol.dofIndex.get(m.n1.id), b = sol.dofIndex.get(m.n2.id);
      return { m, cx, cy, dofs: [a.ux, a.uy, b.ux, b.uy], dir: [-cx, -cy, cx, cy],
               EA: m.E * m.A, Lm: m.length * 1000 };
    });
    const framesPerStep = R.nSteps / Math.min(R.nSteps, 600);   // cap ~600 frames
    /* Auto-fit the animation scale so the PEAK dynamic displacement renders
       at ~7% of the structure size (independent of the static slider).     */
    let uPeak = 1e-12;
    for (let sIdx = 0; sIdx <= R.nSteps; sIdx += Math.max(1, Math.round(R.nSteps / 120))) {
      const u = R.uOfStep(sIdx);
      for (const v of u) uPeak = Math.max(uPeak, Math.abs(v));
    }
    let sizeDyn = 1;
    structure.nodes.forEach(n => { sizeDyn = Math.max(sizeDyn, Math.hypot(n.x, n.y)); });
    anim = { kind: "resp", respScale: (sizeDyn * 0.07 * 1000) / uPeak };
    const t0 = performance.now();
    const frame = now => {
      const elapsed = (now - t0) / 1000;
      const step = Math.min(R.nSteps, Math.floor(elapsed * 30 * framesPerStep));
      const u = R.uOfStep(step);
      const dofIndex = sol.dofIndex;
      const forces = new Map();
      for (const c of connInfo) {
        let ext = 0;
        for (let i = 0; i < 4; i++) if (c.dofs[i] >= 0) ext += c.dir[i] * u[c.dofs[i]];
        forces.set(c.m.id, c.EA / c.Lm * ext);
      }
      ui.dynOverride = {
        dispOf: n => {
          const d = dofIndex.get(n.id);
          return { ux: d.ux >= 0 ? u[d.ux] : 0, uy: d.uy >= 0 ? u[d.uy] : 0 };
        },
        forces,
        scale: anim.respScale          // auto-fitted below; physical mm × scale
      };
      draw();
      drawDynPlot(R.ts[step]);
      if (elapsed * 30 * framesPerStep < R.nSteps) anim.raf = requestAnimationFrame(frame);
      else { stopAnim(); draw(); drawDynPlot(); }
    };
    anim.raf = requestAnimationFrame(frame);
  }

  /* ----- plot of monitored dof ----- */
  function drawDynPlot(tCursor) {
    if (!dynResp) return;
    const cvs = $("canvas-dyn");
    const ctx = cvs.getContext("2d");
    const W = cvs.width = cvs.clientWidth, H = cvs.height = cvs.clientHeight;
    ctx.clearRect(0, 0, W, H);
    const sol = structure.solution, R = dynResp;

    /* find dof with biggest static |disp| to monitor */
    let mi = 0, mv = 0;
    for (let i = 0; i < sol.ndof; i++) if (Math.abs(sol.disp[i]) > mv) { mv = Math.abs(sol.disp[i]); mi = i; }
    const hist = new Float64Array(R.nSteps + 1);
    for (let s = 0; s <= R.nSteps; s++) hist[s] = R.modesUsed.reduce((a, m, r) => a + m.shape[mi] * R.q[r][s], 0);
    let ymax = Math.max(1e-9, ...Array.from(hist).map(Math.abs));
    const xs = t => 30 + (W - 40) * (t / R.ts[R.nSteps]);
    const ys = v => H / 2 - (H / 2 - 14) * (v / ymax);

    ctx.strokeStyle = "#33465c"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xs(0), ys(0)); ctx.lineTo(xs(R.ts[R.nSteps]), ys(0)); ctx.stroke();
    ctx.strokeStyle = "#4fc3f7"; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let s = 0; s <= R.nSteps; s++) {
      const x = xs(R.ts[s]), y = ys(hist[s]);
      s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    /* static reference (DAF=1 line at static value) */
    ctx.strokeStyle = "rgba(129,199,132,.7)"; ctx.setLineDash([4, 4]);
    const vStat = sol.disp[mi];
    ctx.beginPath(); ctx.moveTo(xs(0), ys(vStat)); ctx.lineTo(xs(R.ts[R.nSteps]), ys(vStat)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8b9aad"; ctx.font = "10px Consolas,monospace";
    ctx.fillText(`dof #${mi} (mm)   static=${vStat.toFixed(2)}  max=${(Math.max(...Array.from(hist).map(Math.abs))).toFixed(2)}  DAF=${(Math.max(...Array.from(hist).map(Math.abs)) / Math.max(1e-12, Math.abs(vStat))).toFixed(2)}`, 4, 11);
    if (tCursor !== undefined) {
      ctx.strokeStyle = "#ffb74d";
      const x = xs(tCursor);
      ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - 4); ctx.stroke();
    }
    $("dyn-plot-cap").textContent = `Monitor: dof #${mi} (largest static displacement). Blue: dynamic u(t); green dashes: static value. Canvas animation auto-scaled to peak response.`;
  }
  $("btn-clear").addEventListener("click", () => {
    if (!confirm("Delete the entire structure?")) return;
    structure = new Structure();
    dynModes = null; dynResp = null; stopAnim();
    document.querySelector("#tbl-modes tbody").innerHTML = "";
    $("btn-anim-mode").disabled = true; $("btn-run-dyn").disabled = true; $("btn-play").disabled = true;
    $("btn-export").disabled = true;
    $("btn-report").disabled = true;
    dynSummary("Solve statically first.");
    clearSelection(); refreshResults(); draw(); updateEmptyHint();
    status("Cleared.", "ok");
  });
  $("btn-zoomfit").addEventListener("click", () => { renderer.fit(structure); draw(); });
  $("sel-template").addEventListener("change", e => {
    if (!e.target.value) return;
    structure = Structure.fromTemplate(e.target.value);
    e.target.value = "";
    dynModes = null; dynResp = null; stopAnim();
    clearSelection(); refreshResults();
    renderer.fit(structure);
    status("Template loaded — press ▶ Solve.", "ok");
    draw();
    updateEmptyHint();
  });

  /* ---------------- save / open / export ---------------- */
  $("btn-save").addEventListener("click", () => {
    const blob = new Blob([structure.toJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "structure.json";
    a.click();
    URL.revokeObjectURL(a.href);
    status("Structure saved as structure.json", "ok");
  });
  $("btn-open").addEventListener("click", () => $("file-open").click());
  $("file-open").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        structure = Structure.fromJSON(rd.result);
        dynModes = null; dynResp = null; stopAnim();
        clearSelection(); refreshResults(); renderer.fit(structure); draw(); updateEmptyHint();
        status(`Opened ${f.name}`, "ok");
      } catch (err) { status("Open failed: " + err.message, "err"); }
    };
    rd.readAsText(f);
    e.target.value = "";
  });
  $("btn-export").addEventListener("click", () => {
    if (!structure.solved || !structure.solution) return;
    const sol = structure.solution;
    const lines = ["member,n1,n2,L_m,N_kN,sigma_MPa,elong_mm,utilisation,dT_C,E_kNcm2,A_cm2"];
    for (const m of structure.members) {
      const N = sol.memberForces.get(m.id) || 0;
      const U = Structure.utilization(m, N, ui.sigmaAllowMPa, ui.buckleCheck);
      lines.push([m.id, m.n1.id, m.n2.id, m.length.toFixed(4), N.toFixed(4),
        (N / m.A * 10).toFixed(3), sol.memberDelta.get(m.id).toFixed(4),
        U.toFixed(4), m.dT || 0, m.E, m.A].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "member_results.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    status("Member results exported.", "ok");
  });

  /* ---------------- printable report ---------------- */
  $("btn-report").addEventListener("click", () => {
    if (!structure.solved || !structure.solution) return;
    const w = window.open("", "_blank");
    try {
      w.document.write(Report.build({
        structure, sol: structure.solution, renderer, ui,
        modal: dynModes, dynResp
      }));
      w.document.close();
      status("Full analysis report opened — print or save as PDF.", "ok");
    } catch (err) {
      status("Report failed: " + err.message, "err");
      w.close();
    }
  });

  /* ---------------- material presets ---------------- */
  const MATERIALS = {
    steel:    { E: 21000, A: 20,  sallow: 157 },   // S235/1.5
    steel355: { E: 21000, A: 20,  sallow: 237 },   // S355/1.5
    alu:      { E: 6900,  A: 20,  sallow: 140 },   // 6061-T6 /1.65-ish
    timber:   { E: 1150,  A: 100, sallow: 14  }    // GL24 bending-ish, larger section
  };
  $("sel-material").addEventListener("change", e => {
    const m = MATERIALS[e.target.value];
    if (!m) { return; }
    $("inp-E").value = m.E; $("inp-A").value = m.A;
    ui.sigmaAllowMPa = m.sallow; $("inp-sallow").value = m.sallow;
    refreshResults(); draw();
    status(`Material preset applied (E = ${m.E} kN/cm², σ_allow = ${m.sallow} MPa).`, "ok");
  });

  /* ---------------- empty-canvas hint ---------------- */
  function updateEmptyHint() {
    $("empty-hint").classList.toggle("visible", structure.nodes.length === 0);
  }

  /* ======================= UNDO / KEYBOARD ======================= */
  const undoStack = [];
  const pushHistory = () => {
    undoStack.push(structure.toJSON());
    if (undoStack.length > 50) undoStack.shift();
  };
  const doUndo = () => {
    if (!undoStack.length) { status("Nothing to undo.", "err"); return; }
    try {
      structure = Structure.fromJSON(undoStack.pop());
      dynModes = null; dynResp = null; stopAnim();
      clearSelection(); refreshResults(); draw();
      status("Undone.", "ok");
    } catch (err) { status("Undo failed: " + err.message, "err"); }
  };
  /* snapshot before editing any field */
  document.querySelectorAll("#panel input, #panel select, #results input, #results select")
    .forEach(el => el.addEventListener("focus", () => { if (!undoStack.length || undoStack[undoStack.length-1] !== structure.toJSON()) pushHistory(); }));
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); $("btn-save").click(); return; }
    if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const toolKeys = { "1": "node", "2": "member", "3": "support", "4": "load", "5": "select" };
    if (toolKeys[e.key]) {
      ui.tool = toolKeys[e.key];
      document.querySelectorAll(".tool").forEach(x => x.classList.toggle("active", x.dataset.tool === ui.tool));
      $("tool-hint").textContent = hints[ui.tool];
      draw();
    } else if (e.key.toLowerCase() === "s" && !e.ctrlKey) { $("btn-solve").click(); }
    else if (e.key.toLowerCase() === "f") { $("btn-zoomfit").click(); }
  });

  /* ======================= GUIDED STEPS (left column) ======================= */
  const setStepOpen = (n, open) => {
    const s = document.querySelector(`.panel-block.step[data-step="${n}"]`);
    if (s) s.classList.toggle("open", !!open);
  };
  const markStepDone = (n, done) => {
    const s = document.querySelector(`.panel-block.step[data-step="${n}"]`);
    if (s) s.classList.toggle("done", !!done);
  };
  document.querySelectorAll(".panel-block.step .acc-head").forEach(h => {
    h.addEventListener("click", () => {
      const s = h.closest(".panel-block.step");
      s.classList.toggle("open", !s.classList.contains("open"));
    });
  });

  const hasAnyLoad = () => {
    if ($("chk-sw").checked || $("chk-th").checked) return true;
    for (const n of structure.nodes) if (n.px || n.py || n.mass) return true;
    for (const m of structure.members) if (m.dT) return true;
    return false;
  };
  let materialTouched = false;
  function refreshSteps() {
    markStepDone(1, structure.nodes.length > 0 && structure.members.length > 0);
    markStepDone(2, materialTouched);
    markStepDone(3, hasAnyLoad());
    const s4 = document.querySelector('.panel-block.step[data-step="4"] .step-status');
    if (s4) {
      if (structure.solved) { s4.textContent = "solved"; s4.style.display = "inline"; }
      else s4.style.display = "none";
    }
  }

  /* analysis type selector (step 4) */
  const ANA_PANES = { static: "ana-static", modal: "ana-modal", time: "ana-time" };
  $("sel-analysis").addEventListener("change", () => {
    const t = $("sel-analysis").value;
    for (const k in ANA_PANES) $(ANA_PANES[k]).style.display = k === t ? "block" : "none";
    if (t === "time" && !dynModes) dynSummary("Run modal analysis first (Step 4 ▸ Dynamic — modal), then set the time history below.", "err2");
    if (t === "modal" && !structure.solved) dynSummary("Static solve recommended first — Run static analysis or keep static selected for now.", "err2");
  });
  $("btn-solve-left").addEventListener("click", solveNow);

  /* material & section fields mark step 2 done */
  ["inp-E", "inp-A", "sel-material", "sel-section"].forEach(id => {
    $(id).addEventListener("input", () => { materialTouched = true; refreshSteps(); });
    $(id).addEventListener("change", () => { materialTouched = true; refreshSteps(); });
  });
  /* load fields re-evaluate step 3 */
  ["chk-sw", "chk-th", "inp-rho", "inp-alpha"].forEach(id =>
    $(id).addEventListener("input", refreshSteps));

  /* ======================= PANEL RESIZERS ======================= */
  const setupResizer = (rzId, panelSel, side) => {
    const rz = $(rzId), panel = document.querySelector(panelSel);
    let startX = 0, startW = 0;
    rz.addEventListener("mousedown", e => {
      e.preventDefault();
      startX = e.clientX;
      startW = panel.getBoundingClientRect().width;
      rz.classList.add("drag");
      document.body.classList.add("col-resizing");
      const move = ev => {
        const dx = (side === "left" ? 1 : -1) * (ev.clientX - startX);
        const w = Math.min(520, Math.max(170, startW + dx));
        panel.style.flexBasis = w + "px";
        panel.style.width = w + "px";
        renderer.resize();
        draw();
      };
      const up = () => {
        rz.classList.remove("drag");
        document.body.classList.remove("col-resizing");
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  };
  setupResizer("rsz-left", "#panel", "left");
  setupResizer("rsz-right", "#results", "right");

  /* ======================= MAIN LOOP ======================= */
  window.addEventListener("resize", () => { renderer.resize(); draw(); });
  function draw() {
    /* sync distributed-effect flags from the panel checkboxes */
    ui.showDistributed = true;
    ui.selfWeightOn = $("chk-sw").checked;
    ui.thermalOn = $("chk-th").checked;
    renderer.render(structure, ui);
    updateEmptyHint();
    refreshSteps();
  }

  // boot with the sample
  structure = Structure.samplePratt();
  renderer.fit(structure);
  status("Sample Pratt truss — press ▶ Solve (or draw your own: Clear All, then Node tool).", "ok");
  draw();
})();
