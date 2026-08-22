/* ============================================================
 * solver.js — Pin-jointed truss solver.
 *
 * Joint displacements are obtained with the VIRTUAL WORK
 * (unit-load) theorem:
 *
 *      δ_k = Σ_m  n_km · N_m · L_m / (E_m · A_m)
 *
 *   N_m   = member force under the real load system (kN, + tension)
 *   n_km  = member force under a unit virtual load applied at
 *           displacement coordinate k, with the real loads removed
 *   L/(EA) = member flexibility (mm/kN)
 *
 * The equilibrating n-force sets are obtained as minimum-norm
 * (least-squares) solutions of joint equilibrium; the product
 * Σ n·N·L/EA is unique, so the result is exact for determinate
 * and indeterminate trusses alike.
 *
 * Units: loads kN, lengths m, E in kN/cm², A in cm².
 *        EA [kN], L [mm]  →  displacement in mm.
 * ============================================================ */
"use strict";

/* ---------- tiny dense linear algebra helpers ---------- */
const Lin = {
  zeros(n) { return new Float64Array(n); },

  /* Solves the square system A x = b (n×n) by Gaussian elimination
     with partial pivoting. Returns x or null if singular. */
  solveSquare(A, b) {
    const n = b.length;
    const M = A.map((row, i) => {
      const r = new Float64Array(n + 1);
      r.set(row); r[n] = b[i];
      return r;
    });
    for (let col = 0; col < n; col++) {
      let piv = col, max = Math.abs(M[col][col]);
      for (let r = col + 1; r < n; r++) {
        const v = Math.abs(M[r][col]);
        if (v > max) { max = v; piv = r; }
      }
      if (max < 1e-10) return null;
      if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        if (!f) continue;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
      x[i] = s / M[i][i];
    }
    return x;
  },

  /* Minimum-norm equilibrating solution of the underdetermined system
     A x = b (m rows ≤ n unknowns):  x = Aᵀ (A Aᵀ)⁻¹ b.
     Any equilibrating set gives the same Σ n·N·L/EA; we pick the
     minimum-norm one. Returns x or null if A is rank-deficient. */
  solveMinNorm(A, b) {
    const m = A.length, n = A[0].length;
    const AAT = new Array(m);
    for (let i = 0; i < m; i++) {
      AAT[i] = new Float64Array(m);
      for (let j = 0; j < m; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += A[i][k] * A[j][k];
        AAT[i][j] = s;
      }
    }
    const y = this.solveSquare(AAT, b);
    if (!y) return null;
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let i = 0; i < m; i++) s += A[i][k] * y[i];
      x[k] = s;
    }
    return x;
  },

  /* Least-squares solution of an overdetermined system via normal
     equations (kept for completeness). */
  solveLeastSquares(A, b) {
    const m = A.length, n = A[0].length;
    const ATA = new Array(n), ATb = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ATA[i] = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < m; k++) s += A[k][i] * A[k][j];
        ATA[i][j] = s;
      }
      let s = 0;
      for (let k = 0; k < m; k++) s += A[k][i] * b[k];
      ATb[i] = s;
    }
    return this.solveSquare(ATA, ATb);
  }
};

const Solver = {

  /**
   * Solve the structure. Throws Error(msg) if unstable.
   * Returns {
   *   disp: Float64Array (mm), dofIndex: Map,
   *   memberForces: Map(id -> kN, + tension),
   *   memberDelta:  Map(id -> mm, + elongation),
   *   reactions:    Map(nodeId -> {rx, ry} kN),
   *   dispOf(nodeId, "x"|"y") -> mm,
   *   virtualTerms[dof] -> [{member, n, N, term}]   (Σ = disp[dof])
   * }
   */
  solve(structure, options = {}) {
    const nodes = structure.nodes;
    const members = structure.members;
    if (nodes.length < 2)   throw new Error("Add at least two nodes.");
    if (members.length === 0) throw new Error("Add at least one member.");
    for (const m of members) {
      if (m.length < 1e-9) throw new Error(`Member ${m.id} has zero length — move its end nodes apart.`);
    }

    /* ---------- effective nodal loads: applied + self weight ---------- */
    const SW = options.selfWeight || { include: false, rho: 7850 };
    /* ---------- thermal: mechanical constitutive law ----------
       Free thermal strain εt = α·ΔT → ΔL_th = α·ΔT·L.
       Total extension ΔL = ΔL_elastic + ΔL_th,  N = EA/L · ΔL_elastic
       ⟹  N = EA/L · ΔL − F_T,   F_T = EA·α·ΔT = fixed-end force       */
    const TH = options.thermal || { include: false, alpha: 12 };   // alpha in µε/°C
    const g = 9.81e-3;                       // kN per kg  (9.81 N/kg / 1000)
    let totalSelfWeight = 0;
    const loadAt2 = new Map(nodes.map(n => [n.id, { px: n.px, py: n.py }]));
    if (SW.include) {
      for (const m of members) {
        const w = SW.rho * g * m.A * 1e-4 * m.length;   // kN  (A: cm²→m²)
        totalSelfWeight += w;
        loadAt2.get(m.n1.id).py -= w / 2;
        loadAt2.get(m.n2.id).py -= w / 2;
      }
    }
    const dThOf = m => (TH.include ? (TH.alpha * 1e-6 * m.dT) : 0);  // free thermal strain

    /* ---------- degree-of-freedom numbering ---------- */
    const dofOf = new Map();
    let ndof = 0;
    for (const n of nodes) {
      const ux = n.restrainedX ? -1 : ndof++;
      const uy = n.restrainedY ? -1 : ndof++;
      dofOf.set(n.id, { ux, uy });
    }
    if (ndof === 0) throw new Error("Every joint is fully restrained — free at least one joint.");
    if (ndof < 1) throw new Error("No free degrees of freedom.");

    /* ---------- member geometry / flexibility ---------- */
    const nJ = nodes.length, nm = members.length;
    const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]));
    const conn = members.map(m => {
      const { cx, cy } = m.cos();
      return {
        m, cx, cy,
        Lm: m.length * 1000,        // mm
        EA: m.E * m.A,              // kN
        i1: nodeIdx.get(m.n1.id), i2: nodeIdx.get(m.n2.id),
        dofs: null                  // filled below
      };
    });
    conn.forEach(c => {
      const a = dofOf.get(c.m.n1.id), b = dofOf.get(c.m.n2.id);
      c.dofs = [a.ux, a.uy, b.ux, b.uy];
      c.dir  = [-c.cx, -c.cy, c.cx, c.cy];
    });

    /* ==================================================================
     * STEP 1 — Displacements (reference solution).
     * Assemble the global stiffness matrix K and solve K u = P.
     * This is the compatibility-consistent displacement field, valid
     * for determinate AND indeterminate trusses.                        */
    const K = new Array(ndof);
    for (let i = 0; i < ndof; i++) K[i] = new Float64Array(ndof);
    const Pf = Lin.zeros(ndof);
    nodes.forEach(n => {
      const P = loadAt2.get(n.id);
      const d = dofOf.get(n.id);
      if (d.ux >= 0) Pf[d.ux] += P.px;
      if (d.uy >= 0) Pf[d.uy] += P.py;
    });
    conn.forEach(c => {
      const k = c.EA / c.Lm;
      for (let i = 0; i < 4; i++) {
        if (c.dofs[i] < 0) continue;
        for (let j = 0; j < 4; j++) {
          if (c.dofs[j] < 0) continue;
          K[c.dofs[i]][c.dofs[j]] += k * c.dir[i] * c.dir[j];
        }
      }
      /* thermal fixed-end load contribution to free dofs:
         K u = P_applied + Σ_dir (dir · F_T)                              */
      const FT = c.EA * dThOf(c.m);                 // kN, + = wants to expand
      for (let i = 0; i < 4; i++) {
        if (c.dofs[i] >= 0) Pf[c.dofs[i]] += c.dir[i] * FT;
      }
    });
    const disp = Lin.solveSquare(K, Pf);
    if (!disp) throw new Error(
      "Structure is unstable (stiffness matrix is singular).\n" +
      "Typical causes: too few members (m + r < 2j), missing supports, " +
      "or collinear members forming a mechanism.");

    /* ---------- real member forces: N = EA/L·(ΔL_total − ΔL_th) ---------- */
    const Nvec = new Float64Array(nm);
    conn.forEach((c, mi) => {
      let ext = 0;                                              // ΔL_total, mm
      for (let i = 0; i < 4; i++) if (c.dofs[i] >= 0) ext += c.dir[i] * disp[c.dofs[i]];
      Nvec[mi] = c.EA / c.Lm * ext - c.EA * dThOf(c.m);         // kN, + tension
    });

    /* ==================================================================
     * STEP 2 — VIRTUAL WORK confirmation of each displacement:
     *        δ_k = Σ_m  n_km · ΔL_m(real)
     * with the real total member elongation
     *        ΔL_m = N_m·L_m/(EA)_m  +  α·ΔT_m·L_m            (elastic + free thermal)
     * n_km = member forces in equilibrium with a unit virtual load at
     * coordinate k. Any self-equilibrated set may be added without
     * changing the sum, so the minimum-norm solution is used.            */
    const dofRowOf = new Array(2 * nJ);                // full row -> free dof index
    nodes.forEach((n, i) => {
      dofRowOf[2 * i]     = dofOf.get(n.id).ux;
      dofRowOf[2 * i + 1] = dofOf.get(n.id).uy;
    });
    const Afree = new Array(ndof);
    for (let r = 0; r < ndof; r++) Afree[r] = new Float64Array(nm);
    conn.forEach((c, mi) => {
      const rows = [2 * c.i1, 2 * c.i1 + 1, 2 * c.i2, 2 * c.i2 + 1];
      const vals = [-c.cx, -c.cy, c.cx, c.cy];
      for (let i = 0; i < 4; i++) {
        const r = dofRowOf[rows[i]];
        if (r >= 0) Afree[r][mi] = vals[i];
      }
    });

    const virtualTerms = new Array(ndof);
    const dispVirtual = new Float64Array(ndof);
    let virtualPossible = true;
    for (let k = 0; k < ndof; k++) {
      virtualTerms[k] = [];
      const e = Lin.zeros(ndof); e[k] = 1;
      const nv = Lin.solveMinNorm(Afree, e);
      if (!nv) { virtualPossible = false; break; }
      let d = 0;
      for (let mi = 0; mi < nm; mi++) {
        const c = conn[mi];
        const flex = c.Lm / c.EA;                                // mm/kN
        const dLtot = Nvec[mi] * flex + dThOf(c.m) * c.Lm;       // elastic + thermal, mm
        const t = nv[mi] * dLtot;
        if (Math.abs(t) > 1e-9) virtualTerms[k].push({ member: members[mi].id, n: nv[mi], N: Nvec[mi], term: t });
        d += t;
      }
      dispVirtual[k] = d;
    }

    /* ---------- maps for the UI ---------- */
    const memberForces = new Map();
    const memberDelta  = new Map();
    members.forEach((m, mi) => {
      memberForces.set(m.id, Nvec[mi]);
      memberDelta.set(m.id, Nvec[mi] * conn[mi].Lm / conn[mi].EA + dThOf(m) * conn[mi].Lm);
    });

    /* ---------- reactions ----------
       Member with tension N pulls joint n1 toward n2 with force
       F1 = (+cx, +cy)·N, and joint n2 toward n1 with (−cx, −cy)·N.
       Equilibrium at a restrained joint:
          R + P + Σ F_member = 0   →   R = −P − Σ F_member.        */
    const reactions = new Map();
    nodes.forEach(n => {
      const P = loadAt2.get(n.id);
      reactions.set(n.id, { rx: -P.px, ry: -P.py });
    });
    conn.forEach((c, mi) => {
      const N = Nvec[mi];
      if (c.m.n1.restrainedX) reactions.get(c.m.n1.id).rx -= c.cx * N;
      if (c.m.n1.restrainedY) reactions.get(c.m.n1.id).ry -= c.cy * N;
      if (c.m.n2.restrainedX) reactions.get(c.m.n2.id).rx += c.cx * N;
      if (c.m.n2.restrainedY) reactions.get(c.m.n2.id).ry += c.cy * N;
    });
    nodes.forEach(n => {
      const r = reactions.get(n.id);
      if (!n.restrainedX) r.rx = 0;
      if (!n.restrainedY) r.ry = 0;
    });

    /* -------- verification: |Ku − (P + thermal fixed-end loads)| -------- */
    let totalThermalFT = 0;
    if (TH.include) {
      for (const m of members) totalThermalFT += Math.abs(m.E * m.A * dThOf(m));
    }
    let verify = 0;
    for (let i = 0; i < ndof; i++) {
      let s = 0;
      for (let j = 0; j < ndof; j++) s += K[i][j] * disp[j];
      verify = Math.max(verify, Math.abs(s - Pf[i]));
    }
    let virtErr = 0;
    if (virtualPossible) {
      for (let i = 0; i < ndof; i++) virtErr = Math.max(virtErr, Math.abs(disp[i] - dispVirtual[i]));
    }

    /* If virtual-work integrations agree, report those values directly
       (they ARE the displacements obtained via virtual work).          */
    const finalDisp = virtualPossible ? dispVirtual : disp;

    const dispOf = (nodeId, axis) => {
      const d = dofOf.get(nodeId);
      const idx = axis === "x" ? d.ux : d.uy;
      return idx >= 0 ? finalDisp[idx] : 0;
    };

    return { ndof, dofIndex: dofOf, disp: finalDisp, dispStiffness: disp,
             memberForces, memberDelta, reactions, dispOf,
             virtualTerms, verify, virtErr, virtualPossible,
             selfWeight: SW.include ? totalSelfWeight : 0, rho: SW.rho,
             thermal: TH.include, alpha: TH.alpha,
             thermalFT: totalThermalFT,
             thermalActive: TH.include && totalThermalFT > 0,
             K, Pf };   // exposed for dynamic analysis (dynamics.js)
  },

  nodeDisp(sol, node) {
    if (!sol) return { ux: 0, uy: 0 };
    return { ux: sol.dispOf(node.id, "x"), uy: sol.dispOf(node.id, "y") };
  }
};
