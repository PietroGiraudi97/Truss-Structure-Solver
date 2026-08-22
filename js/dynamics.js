/* ============================================================
 * dynamics.js — Dynamic analysis of the pin-jointed truss.
 *
 * Equation of motion:  M·ü + C·u̇ + K·u = P(t)
 *
 * 1. Lumped mass matrix M (diagonal): each member's mass ρ·A·L is
 *    split 50/50 to its end joints, plus optional joint masses.
 * 2. Natural frequencies & mode shapes: generalised symmetric
 *    eigenproblem  K φ = ω² M φ.  With diagonal M, this reduces to the
 *    standard symmetric problem  (M⁻¹/² K M⁻¹/²)·ψ = ω²·ψ,
 *    solved by the classical Jacobi rotation method.
 * 3. Time response by modal superposition: each mode is an
 *    independent damped SDOF oscillator, integrated exactly by linear
 *    interpolation of P(t) within each time step (Duhamel recursion).
 *    Damping is modal Rayleigh-type: ζ_r per mode with the same
 *    percentage for all modes (editable).
 *
 * Consistent dynamic units:  kN, mm, seconds;  mass in kt (= Mg).
 *      force = mass·acc  →  1 kN = 1 kt · 1 m/s² = 1 kt · 1000 mm/s²
 * ============================================================ */
"use strict";

const Dynamics = {

  /* ---------- lumped mass vector (per dof), in kt ---------- */
  massVector(structure, dofIndex, ndof, rho) {
    const M = new Float64Array(ndof);
    const add = (node, massKg) => {
      const d = dofIndex.get(node.id);
      const mk = massKg / 1000;                    // kg -> kt
      if (d.ux >= 0) M[d.ux] += mk;
      if (d.uy >= 0) M[d.uy] += mk;
    };
    for (const m of structure.members) {
      const w = rho * m.A * 1e-4 * m.length;       // kg
      add(m.n1, w / 2);
      add(m.n2, w / 2);
    }
    for (const n of structure.nodes) add(n, n.mass || 0);
    return M;
  },

  /**
   * Modal analysis.
   * @param K, Pf   stiffness matrix (ndof×ndof, Array of Float64Array) and load vector
   * @param M       lumped mass vector (kt)
   * @returns { modes:[{omega, freq, shape:Float64Array(mm-scale), meff}], M, cond }
   * cond maps retained dofs; zero-mass dofs are statically condensed out.
   */
  modes(structure, K, ndof, rho, dofIndex, maxModes = 8) {
    const M = this.massVector(structure, dofIndex, ndof, rho);

    /* condense out zero-mass dofs (they are slave dofs: massless springs) */
    const cond = [];
    for (let i = 0; i < ndof; i++) if (M[i] > 1e-12) cond.push(i);
    const nc = cond.length;
    if (nc === 0) throw new Error("No mass in the model — enable member mass (ρ) or add joint masses.");

    const Kf = cond.map(r => Float64Array.from(cond.map(c => K[r][c])));
    const Mf = Float64Array.from(cond.map(i => M[i]));

    /* standard form: A = D K D with D = diag(1/√m) → A ψ = λ ψ, λ = ω² */
    const A = new Array(nc);
    for (let i = 0; i < nc; i++) {
      A[i] = new Float64Array(nc);
      for (let j = 0; j < nc; j++) A[i][j] = Kf[i][j] / Math.sqrt(Mf[i] * Mf[j]);
    }

    const { values, vectors } = this._jacobi(A);

    /* sort ascending by λ */
    const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
    const modes = [];
    for (const oi of order) {
      const lam = values[oi];
      if (lam <= 1e-9) continue;                     // skip ~zero (numerical)
      const omega = Math.sqrt(lam);
      /* physical shape: φ = ψ/√m (in full ndof coordinates), mass-normalised */
      const shape = new Float64Array(ndof);
      let norm = 0;
      for (let i = 0; i < nc; i++) {
        shape[cond[i]] = vectors[i][oi] / Math.sqrt(Mf[i]);
        norm += Mf[i] * shape[cond[i]] * shape[cond[i]];
      }
      if (norm > 0) { const s = 1 / Math.sqrt(norm); for (let i = 0; i < ndof; i++) shape[i] *= s; }
      /* sign convention: largest |component| positive */
      let mx = 0, mi = 0;
      for (let i = 0; i < ndof; i++) if (Math.abs(shape[i]) > Math.abs(mx)) { mx = shape[i]; mi = i; }
      if (mx < 0) for (let i = 0; i < ndof; i++) shape[i] = -shape[i];
      modes.push({ omega, freq: omega / (2 * Math.PI), shape });
      if (modes.length >= Math.min(maxModes, nc)) break;
    }
    return { modes, M, cond };
  },

  /**
   * Damped modal time-history response by exact Duhamel recursion with
   * piecewise-linear load. Returns sampled histories.
   *
   * @param modesModal  result of this.modes(...).modes
   * @param M           mass vector (full ndof)
   * @param Pf          static load vector (kN, full ndof) — multiplied by λ(t)
   * @param opt {lambda(t), tEnd, dt, zeta}   λ(t): dimensionless load factor
   */
  response(modesModal, M, Pf, opt) {
    const { lambda, tEnd, dt, zeta } = opt;
    const ndof = Pf.length;
    const useModes = modesModal.filter(m => m.used !== false);
    if (useModes.length === 0) throw new Error("No modes selected for the response.");

    /* modal data: m*=φᵀMφ(=1 after normalisation), p*(t)=φᵀP·λ(t) */
    const md = useModes.map(mo => {
      let p0 = 0;
      for (let i = 0; i < ndof; i++) p0 += mo.shape[i] * Pf[i];
      return { omega: mo.omega, shape: mo.shape, p0 };
    });

    const nSteps = Math.min(20000, Math.max(2, Math.round(tEnd / dt)));
    const h = tEnd / nSteps;
    const ts = new Float64Array(nSteps + 1);
    const q = md.map(() => new Float64Array(nSteps + 1));

    md.forEach((mdx, r) => {
      const w = mdx.omega, z = zeta;
      if (z >= 1) throw new Error("ζ must be < 1 (underdamped).");
      const wd = w * Math.sqrt(1 - z * z);
      const w2 = w * w;
      /* Duhamel recursion: within a step, p(t) = p0 + r·t is exactly an
         SDOF with static-equivalent ramp. q_p(t) = (p(t) - (2ζ/w)·r)/w². */
      let qi = 0, vi = 0;
      let pPrev = mdx.p0 * lambda(0);
      q[r][0] = 0; ts[0] = 0;
      for (let i = 1; i <= nSteps; i++) {
        const t1 = i * h;
        const p1 = mdx.p0 * lambda(t1);
        const rp = (p1 - pPrev) / h;                    // ramp rate dp/dt
        /* particular solution at step start τ=0 (τ measured from step start) */
        const qp0 = (pPrev - (2 * z / w) * rp) / w2;
        const vp0 = rp / w2;
        const A0 = qi - qp0;                            // homogeneous consts
        const B0 = (vi + z * w * A0 - vp0) / wd;
        const e = Math.exp(-z * w * h);
        const cT = Math.cos(wd * h), sT = Math.sin(wd * h);
        /* end of step: q(h) = e^(-ζωh)[A cos + B sin] + q_p(h) */
        const qp1 = (p1 - (2 * z / w) * rp) / w2;       // p(h) = p1
        qi = e * (A0 * cT + B0 * sT) + qp1;
        vi = e * ((B0 * wd - z * w * A0) * cT - (A0 * wd + z * w * B0) * sT) + vp0;
        pPrev = p1;
        q[r][i] = qi;
        ts[i] = t1;
      }
    });

    /* physical displacement of every dof vs time (sampled) */
    const uOfStep = step => {
      const u = new Float64Array(ndof);
      md.forEach((mdx, r) => {
        const qr = q[r][step];
        for (let i = 0; i < ndof; i++) u[i] += mdx.shape[i] * qr;
      });
      return u;
    };

    return { ts, q, modesUsed: md, uOfStep, nSteps };
  },

  /* ---------- classical Jacobi eigensolver (symmetric n×n, n small) ---------- */
  _jacobi(Ain) {
    const n = Ain.length;
    const A = Ain.map(r => Float64Array.from(r));
    const V = new Array(n);
    for (let i = 0; i < n; i++) { V[i] = new Float64Array(n); V[i][i] = 1; }

    const maxSweep = 100, tol = 1e-12;
    for (let sweep = 0; sweep < maxSweep; sweep++) {
      /* check off-diagonal norm */
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
      if (off < tol) break;
      for (let p = 0; p < n - 1; p++) {
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-14) continue;
          const app = A[p][p], aqq = A[q][q], apq = A[p][q];
          const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
          const c = Math.cos(phi), s = Math.sin(phi);
          /* rotate A */
          for (let i = 0; i < n; i++) {
            const aip = A[i][p], aiq = A[i][q];
            A[i][p] = c * aip - s * aiq;
            A[i][q] = s * aip + c * aiq;
          }
          for (let i = 0; i < n; i++) {
            const api = A[p][i], aqi = A[q][i];
            A[p][i] = c * api - s * aqi;
            A[q][i] = s * api + c * aqi;
          }
          /* accumulate V */
          for (let i = 0; i < n; i++) {
            const vip = V[i][p], viq = V[i][q];
            V[i][p] = c * vip - s * viq;
            V[i][q] = s * vip + c * viq;
          }
        }
      }
    }
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = A[i][i];
    return { values, vectors: V };
  },

  /* ---------- convenience: shape vector -> per-node mm pair ---------- */
  shapeToNodeDisp(sol, node, shape) {
    const d = sol.dofIndex.get(node.id);
    return {
      ux: d.ux >= 0 ? shape[d.ux] : 0,
      uy: d.uy >= 0 ? shape[d.uy] : 0
    };
  }
};
