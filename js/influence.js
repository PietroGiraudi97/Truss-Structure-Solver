/* ============================================================
 * influence.js — Influence lines for truss members & reactions.
 *
 * An influence line shows how a single moving unit load (applied
 * at a joint, in a chosen direction) affects one response quantity
 * (a member force or a reaction). It is built by re-solving the
 * truss with a unit load placed at each joint in turn and reading
 * off the response — the exact stiffness solution, valid for
 * determinate and indeterminate trusses alike.
 *
 * The result is a piecewise-linear function over the joints,
 * which is the standard way influence lines are drawn for trusses
 * (loads can only act at joints).
 * ============================================================ */
"use strict";

const Influence = {

  /**
   * Compute the influence line of a response over the joints.
   * @param structure  the truss (must be solvable)
   * @param opts { axis:"x"|"y", memberId:number|null, reactionNodeId:number|null,
   *              reactionAxis:"x"|"y" }
   * @returns { joints:[{node, x, y, value}], axis, label, maxAbs }
   */
  line(structure, opts) {
    const axis = opts.axis || "y";
    const joints = [];
    let maxAbs = 0;

    /* save and remove all existing loads so only the unit load acts */
    const saved = structure.nodes.map(n => ({ px: n.px, py: n.py }));
    structure.nodes.forEach(n => { n.px = 0; n.py = 0; });

    for (const n of structure.nodes) {
      n.px = axis === "x" ? 1 : 0;
      n.py = axis === "y" ? 1 : 0;
      let value = 0;
      try {
        const sol = Solver.solve(structure, { selfWeight: { include: false }, thermal: { include: false } });
        if (opts.memberId != null) {
          value = sol.memberForces.get(opts.memberId) || 0;
        } else if (opts.reactionNodeId != null) {
          const r = sol.reactions.get(opts.reactionNodeId) || { rx: 0, ry: 0 };
          value = opts.reactionAxis === "x" ? r.rx : r.ry;
        }
      } catch (e) {
        value = 0;
      }
      n.px = 0; n.py = 0;
      joints.push({ node: n, x: n.x, y: n.y, value });
      maxAbs = Math.max(maxAbs, Math.abs(value));
    }

    /* restore the original loads */
    structure.nodes.forEach((n, i) => { n.px = saved[i].px; n.py = saved[i].py; });
    return { joints, axis, maxAbs };
  },

  /**
   * Draw an influence line onto a canvas.
   * @param cv  canvas element
   * @param data  result of Influence.line(...)
   * @param opts { title, unit }
   */
  draw(cv, data, opts = {}) {
    const ctx = cv.getContext("2d");
    const W = cv.width = cv.width || cv.clientWidth || 300;
    const H = cv.height = cv.height || cv.clientHeight || 120;
    ctx.clearRect(0, 0, W, H);
    const padL = 8, padR = 8, padT = 18, padB = 20;

    const xs = data.joints.map(j => j.x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const spanX = Math.max(1e-9, xMax - xMin);
    const X = x => padL + (W - padL - padR) * (x - xMin) / spanX;

    let yMax = Math.max(1e-9, data.maxAbs);
    const Y = v => H - padB - (H - padT - padB) * (v / yMax);

    /* axes */
    ctx.strokeStyle = "#33465c"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB);
    ctx.lineTo(W - padR, H - padB); ctx.stroke();
    /* zero line */
    ctx.strokeStyle = "#556"; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(W - padR, Y(0)); ctx.stroke();
    ctx.setLineDash([]);

    /* the influence line (piecewise linear over joints) */
    ctx.strokeStyle = "#4fc3f7"; ctx.lineWidth = 2;
    ctx.beginPath();
    data.joints.forEach((j, i) => {
      const x = X(j.x), y = Y(j.value);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    /* joint markers + value labels */
    ctx.fillStyle = "#8b9aad"; ctx.font = "9px ui-monospace,SFMono-Regular,Consolas,Menlo,monospace";
    data.joints.forEach(j => {
      const x = X(j.x), y = Y(j.value);
      ctx.fillStyle = "#e6edf5"; ctx.strokeStyle = "#0f141b";
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#8b9aad";
      ctx.fillText(j.value.toFixed(2), x + 3, y - 3);
    });

    ctx.fillStyle = "#8b9aad"; ctx.textAlign = "center";
    ctx.fillText(opts.title || "", W / 2, 10);
    ctx.fillText("x (m)", W / 2, H - 4);
  }
};
