/* ============================================================
 * worked.js — Educational "worked solution" tools.
 *
 * 1. Method of joints: solves a statically determinate truss
 *    joint-by-joint, recording each equilibrium step so the
 *    solution can be shown as a step-by-step worked example.
 * 2. Zero-force member detection by the classic textbook rules.
 * 3. Method of sections: given a cut line, isolates one side
 *    of the truss and solves the cut-member forces from the
 *    three global equilibrium equations.
 *
 * These are teaching aids built on top of the exact solver
 * (js/solver.js); the forces they produce are cross-checked
 * against the stiffness solution.
 * ============================================================ */
"use strict";

const Worked = {

  /* ---------- incident members per node ---------- */
  _incident(structure) {
    const inc = new Map();
    structure.nodes.forEach(n => inc.set(n.id, []));
    structure.members.forEach(m => { inc.get(m.n1.id).push(m); inc.get(m.n2.id).push(m); });
    return inc;
  },

  /* direction cosines from joint j away along member m */
  _away(j, m) {
    const other = m.n1 === j ? m.n2 : m.n1;
    const dx = other.x - j.x, dy = other.y - j.y;
    const L = Math.hypot(dx, dy) || 1;
    return { cx: dx / L, cy: dy / L };
  },

  /**
   * Method of joints.
   * @returns { steps, force:Map(id->kN), known:Map(id->bool),
   *            allKnown:bool, solvedJoints:Set }
   * Each step: { joint, unknowns:[m1,m2], values:[N1,N2],
   *              fx, fy }  where fx,fy are the known RHS loads
   *              (reaction + applied + solved members) at the joint.
   */
  joints(structure, sol) {
    const nodes = structure.nodes, members = structure.members;
    const inc = this._incident(structure);
    const force = new Map();
    const known = new Map();
    members.forEach(m => known.set(m.id, false));
    const steps = [];
    const solvedJoints = new Set();

    let guard = 0;
    while (guard++ < 2000) {
      let progressed = false;
      for (const n of nodes) {
        if (solvedJoints.has(n.id)) continue;
        const unk = inc.get(n.id).filter(m => !known.get(m.id));
        if (unk.length === 0) { solvedJoints.add(n.id); continue; }
        if (unk.length > 2) continue;

        /* known loads at the joint: reaction + applied + solved members */
        const R = sol.reactions.get(n.id) || { rx: 0, ry: 0 };
        let fx = R.rx + n.px, fy = R.ry + n.py;
        for (const m of inc.get(n.id)) {
          if (known.get(m.id)) {
            const { cx, cy } = this._away(n, m);
            fx += cx * force.get(m.id);
            fy += cy * force.get(m.id);
          }
        }

        /* 2×2 equilibrium system for the two unknowns:
           ΣFx: cx1·N1 + cx2·N2 = −fx
           ΣFy: cy1·N1 + cy2·N2 = −fy                                    */
        const A = [[0, 0], [0, 0]];
        unk.forEach((m, i) => {
          const { cx, cy } = this._away(n, m);
          A[0][i] = cx; A[1][i] = cy;
        });
        const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
        if (Math.abs(det) < 1e-9) continue;      // collinear -> mechanism, skip

        const b0 = -fx, b1 = -fy;
        const N1 = (b0 * A[1][1] - A[0][1] * b1) / det;
        const N2 = (A[0][0] * b1 - b0 * A[1][0]) / det;
        unk.forEach((m, i) => { force.set(m.id, i === 0 ? N1 : N2); known.set(m.id, true); });
        solvedJoints.add(n.id);
        steps.push({ joint: n, unknowns: unk, values: [N1, N2], fx, fy });
        progressed = true;
      }
      if (!progressed) break;
    }
    const allKnown = members.every(m => known.get(m.id));
    return { steps, force, known, allKnown, solvedJoints };
  },

  /**
   * Zero-force member detection by the two classic rules.
   * @returns array of { member, reason }
   */
  zeroForce(structure, sol) {
    const inc = this._incident(structure);
    const res = [];
    const seen = new Set();
    const hasLoad = n => n.px || n.py ||
      (sol.reactions.get(n.id) && (sol.reactions.get(n.id).rx || sol.reactions.get(n.id).ry));

    for (const n of structure.nodes) {
      const ms = inc.get(n.id);
      if (hasLoad(n)) continue;
      if (ms.length === 2) {
        /* Rule 1: two-member joint, no external load -> both zero,
           UNLESS the two members are collinear (they then act as one
           straight member and can carry force). */
        const a = ms[0], b = ms[1];
        const oa = a.n1 === n ? a.n2 : a.n1;
        const ob = b.n1 === n ? b.n2 : b.n1;
        const collinear = Math.abs((oa.x - n.x) * (ob.y - n.y) - (oa.y - n.y) * (ob.x - n.x)) < 1e-6;
        if (!collinear) {
          ms.forEach(m => {
            if (!seen.has(m.id)) { seen.add(m.id); res.push({ member: m, reason: `Joint n${n.id} has only two non-collinear members and no external load — both carry zero force.` }); }
          });
        }
      } else if (ms.length === 3) {
        /* Rule 2: three-member joint, two collinear, no load -> third is zero */
        for (let i = 0; i < 3; i++) {
          for (let j = i + 1; j < 3; j++) {
            const a = ms[i], b = ms[j];
            const oa = a.n1 === n ? a.n2 : a.n1;
            const ob = b.n1 === n ? b.n2 : b.n1;
            const cross = (oa.x - n.x) * (ob.y - n.y) - (oa.y - n.y) * (ob.x - n.x);
            if (Math.abs(cross) < 1e-6) {          // collinear pair
              const third = ms.find(m => m !== a && m !== b);
              if (!seen.has(third.id)) {
                seen.add(third.id);
                res.push({ member: third, reason: `Joint n${n.id} has three members, two collinear and no external load — the non-collinear member carries zero force.` });
              }
            }
          }
        }
      }
    }
    return res;
  },

  /**
   * Method of sections.
   * @param cutPts  two world points defining the cut line
   * @returns { cutMembers:[m], freeBody:[node], forces:Map(id->kN),
   *            solvable:bool, msg }
   */
  sections(structure, sol, cutPts) {
    const [p1, p2] = cutPts;
    const cut = this._cutMembers(structure, p1, p2);
    if (cut.length === 0) return { solvable: false, msg: "The cut line crosses no members." };
    if (cut.length > 3) return { solvable: false, msg: `The cut crosses ${cut.length} members — method of sections needs ≤ 3.` };

    /* choose the free body: the side of the cut with fewer nodes */
    const side = this._sideOf(structure, p1, p2);
    const freeBody = side.countA <= side.countB ? side.A : side.B;
    const inBody = new Set(freeBody.map(n => n.id));

    /* unknown forces: for each cut member, the force acts on the free body
       at the in-body end node, directed along the member toward the far end. */
    const unk = cut.map(m => {
      const inNode = inBody.has(m.n1.id) ? m.n1 : m.n2;
      const outNode = inNode === m.n1 ? m.n2 : m.n1;
      const dx = outNode.x - inNode.x, dy = outNode.y - inNode.y;
      const L = Math.hypot(dx, dy) || 1;
      return { m, inNode, cx: dx / L, cy: dy / L };
    });

    /* known loads on the free body: applied + reactions at free-body nodes */
    let fx = 0, fy = 0;
    for (const n of freeBody) {
      const R = sol.reactions.get(n.id) || { rx: 0, ry: 0 };
      fx += R.rx + n.px; fy += R.ry + n.py;
    }

    /* moment point: centroid of free-body nodes */
    let Px = 0, Py = 0;
    freeBody.forEach(n => { Px += n.x; Py += n.y; });
    Px /= freeBody.length; Py /= freeBody.length;

    /* 3×3 system: ΣFx, ΣFy, ΣM about P  (rows = equations, cols = unknowns) */
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const b = [-fx, -fy, 0];
    unk.forEach((u, i) => {
      A[0][i] = u.cx; A[1][i] = u.cy;
      A[2][i] = (u.inNode.x - Px) * u.cy - (u.inNode.y - Py) * u.cx;   // moment arm
    });
    /* moment of known loads about P */
    for (const n of freeBody) {
      const R = sol.reactions.get(n.id) || { rx: 0, ry: 0 };
      const Fx = R.rx + n.px, Fy = R.ry + n.py;
      b[2] -= (n.x - Px) * Fy - (n.y - Py) * Fx;
    }

    const x = Lin.solveSquare(A, b);
    if (!x) return { solvable: false, msg: "The section equations are singular (e.g. parallel cut members) — try a different cut." };

    const forces = new Map();
    unk.forEach((u, i) => forces.set(u.m.id, x[i]));
    return { solvable: true, cutMembers: cut, freeBody, forces, unk, msg: "" };
  },

  /* members whose segment crosses the infinite cut line */
  _cutMembers(structure, p1, p2) {
    const res = [];
    for (const m of structure.members) {
      if (this._segCrossLine(m.n1, m.n2, p1, p2)) res.push(m);
    }
    return res;
  },

  /* does segment AB cross the infinite line through P,Q? */
  _segCrossLine(a, b, p, q) {
    const d1 = this._sideSign(a, p, q), d2 = this._sideSign(b, p, q);
    if (d1 === 0 || d2 === 0) return true;          // endpoint on the line
    return (d1 > 0) !== (d2 > 0);                    // opposite sides
  },
  _sideSign(pt, p, q) {
    return (q.x - p.x) * (pt.y - p.y) - (q.y - p.y) * (pt.x - p.x);
  },

  /* split nodes into the two sides of the line through p1,p2 */
  _sideOf(structure, p1, p2) {
    const A = [], B = [];
    for (const n of structure.nodes) {
      const s = this._sideSign(n, p1, p2);
      (s >= 0 ? A : B).push(n);
    }
    return { A, B, countA: A.length, countB: B.length };
  }
};
