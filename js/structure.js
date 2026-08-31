/* ============================================================
 * structure.js  —  Data model for the pin-jointed truss
 * ============================================================ */
"use strict";

let _nextNodeId = 1;
let _nextMemberId = 1;

class Node {
  constructor(x, y) {
    this.id = _nextNodeId++;
    this.x = x;          // metres
    this.y = y;          // metres
    this.support = "none";   // "none" | "pin" | "rollerx" (restains y) | "rollery" (restrains x)
    this.px = 0;         // applied load, kN (x)
    this.py = 0;         // applied load, kN (y)
    this.mass = 0;       // extra lumped mass at this joint, kg (dynamics)
  }
  get restrainedX() { return this.support === "pin" || this.support === "rollery"; }
  get restrainedY() { return this.support === "pin" || this.support === "rollerx"; }
}

class Member {
  constructor(n1, n2, E, A) {
    this.id = _nextMemberId++;
    this.n1 = n1;
    this.n2 = n2;
    this.E = E;       // kN/cm²
    this.A = A;       // cm²
    this.I = 0;       // cm⁴  (0 = use solid-square equivalent A²/12)
    this.dT = 0;      // temperature change, °C (0 = none)
  }
  get length() {   // metres
    const dx = this.n2.x - this.n1.x;
    const dy = this.n2.y - this.n1.y;
    return Math.hypot(dx, dy);
  }
  /* direction cosines (n1 -> n2) */
  cos() {
    const dx = this.n2.x - this.n1.x;
    const dy = this.n2.y - this.n1.y;
    const L = Math.hypot(dx, dy) || 1;
    return { cx: dx / L, cy: dy / L };
  }
}

class Structure {
  constructor() {
    this.nodes = [];
    this.members = [];
    // solution data (filled by Solver)
    this.solved = false;
    this.solution = null;
    this.solveError = null;
  }

  addNode(x, y) {
    const n = new Node(x, y);
    this.nodes.push(n);
    this.invalidate();
    return n;
  }

  addMember(n1, n2, E, A) {
    if (n1 === n2) return null;
    if (this.memberBetween(n1, n2)) return null;
    const m = new Member(n1, n2, E, A);
    this.members.push(m);
    this.invalidate();
    return m;
  }

  memberBetween(n1, n2) {
    return this.members.find(m =>
      (m.n1 === n1 && m.n2 === n2) || (m.n1 === n2 && m.n2 === n1));
  }

  deleteNode(node) {
    this.members = this.members.filter(m => m.n1 !== node && m.n2 !== node);
    this.nodes = this.nodes.filter(n => n !== node);
    this.invalidate();
  }

  deleteMember(member) {
    this.members = this.members.filter(m => m !== member);
    this.invalidate();
  }

  invalidate() { this.solved = false; this.solution = null; this.solveError = null; }

  nodeById(id)   { return this.nodes.find(n => n.id === id); }
  memberById(id) { return this.members.find(m => m.id === id); }

  /* stability / solvability quick check */
  check() {
    const j = this.nodes.length, m = this.members.length;
    const r = this.nodes.reduce((s, n) => s + (n.restrainedX ? 1 : 0) + (n.restrainedY ? 1 : 0), 0);
    if (j < 2)  return { ok: false, msg: "Need at least 2 joints." };
    if (m === 0) return { ok: false, msg: "No members defined." };
    if (r < 3)  return { ok: false, msg: `Not enough support reactions (${r}). Provide at least 3 (e.g. one pin + one roller).` };
    return { ok: true, msg: `j=${j}  m=${m}  r=${r}   (m+r = ${m + r}, 2j = ${2 * j})${m + r < 2 * j ? "  — mechanism likely (m+r < 2j)" : ""}` };
  }

  /* ---------------- samples ---------------- */
  static samplePratt() {
    const s = new Structure();
    const E = 21000, A = 20;   // steel, 20 cm²
    const span = 12, h = 3, panels = 6, dx = span / panels;
    const bottom = [], top = [];
    for (let i = 0; i <= panels; i++) {
      bottom.push(s.addNode(i * dx, 0));
      if (i > 0 && i < panels) top.push(s.addNode(i * dx, h));
    }
    for (let i = 0; i < panels; i++) s.addMember(bottom[i], bottom[i + 1], E, A);
    for (let i = 0; i < top.length - 1; i++) s.addMember(top[i], top[i + 1], E, A);
    for (let i = 0; i < top.length; i++) {
      const b = i + 1;                            // bottom joint index under this top joint
      s.addMember(bottom[b], top[i], E, A);       // vertical
      s.addMember(top[i], bottom[b + 1], E, A);   // diagonal (tension toward centre under gravity)
    }
    s.addMember(top[0], bottom[0], E, A);         // end diagonal at left support
    // supports: left pin, right roller
    bottom[0].support = "pin";
    bottom[panels].support = "rollerx";
    // loads at top joints (e.g. roof load), 25 kN each
    top.forEach(n => { n.py = -25; });
    bottom[Math.floor(panels / 2)].py = -40;      // extra point load midspan
    return s;
  }

  /* ---------------- template generators ---------------- */
  static templates = {
    /* cantilever bracket: wall at x=0 (two pins), load at tip */
    bracket(E, A) {
      const s = new Structure();
      const w1 = s.addNode(0, 2); w1.support = "pin";
      const w2 = s.addNode(0, 0); w2.support = "pin";
      const f3 = s.addNode(4, 2);
      const f4 = s.addNode(4, 0); f4.py = -50;
      s.addMember(w1, f3, E, A);
      s.addMember(w2, f4, E, A);
      s.addMember(w1, f4, E, A);
      s.addMember(f3, f4, E, A);
      return s;
    },

    /* Warren truss: equilateral-ish zig-zag web, no verticals */
    warren(E, A) {
      const s = new Structure();
      const span = 12, panels = 6, dx = span / panels, h = dx * Math.sin(Math.PI / 3);
      const bot = [], top = [];
      for (let i = 0; i <= panels; i++) bot.push(s.addNode(i * dx, 0));
      for (let i = 0; i < panels; i++) top.push(s.addNode((i + 0.5) * dx, h));
      for (let i = 0; i < panels; i++) s.addMember(bot[i], bot[i + 1], E, A);
      for (let i = 0; i < top.length - 1; i++) s.addMember(top[i], top[i + 1], E, A);
      for (let i = 0; i < top.length; i++) {
        s.addMember(bot[i], top[i], E, A);
        s.addMember(top[i], bot[i + 1], E, A);
      }
      bot[0].support = "pin";
      bot[panels].support = "rollerx";
      top.forEach(n => { n.py = -20; });
      return s;
    },

    /* Howe truss: diagonals in compression toward midspan, verticals tension */
    howe(E, A) {
      const s = Structure.samplePratt.call(null);  // same geometry
      // turn diagonals around: rebuild members
      const nodes = s.nodes.slice();
      const bottom = nodes.filter(n => n.y === 0).sort((a, b) => a.x - b.x);
      const top = nodes.filter(n => n.y > 0).sort((a, b) => a.x - b.x);
      const E2 = E, A2 = A;
      const t = new Structure();
      const bm = new Map(), tm = new Map();
      bottom.forEach(n => bm.set(n.x, t.addNode(n.x, n.y)));
      top.forEach(n => tm.set(n.x, t.addNode(n.x, n.y)));
      const bn = [...bm.values()], tn = [...tm.values()];
      for (let i = 0; i < bn.length - 1; i++) t.addMember(bn[i], bn[i + 1], E2, A2);
      for (let i = 0; i < tn.length - 1; i++) t.addMember(tn[i], tn[i + 1], E2, A2);
      for (let i = 0; i < tn.length; i++) {
        const b = i + 1;
        t.addMember(bn[b], tn[i], E2, A2);            // vertical
        t.addMember(tn[i], bn[b - 1], E2, A2);        // diagonal toward support (Howe)
      }
      t.addMember(tn[tn.length - 1], bn[bn.length - 1], E2, A2);
      bn[0].support = "pin";
      bn[bn.length - 1].support = "rollerx";
      tn.forEach(n => { n.py = -25; });
      return t;
    },

    /* K-truss web: alternating K nodes at half-height, stiff for long spans */
    ktruss(E, A) {
      const s = new Structure();
      const span = 16, panels = 8, dx = span / panels, h = 2.5;
      const bot = [], top = [];
      for (let i = 0; i <= panels; i++) {
        bot.push(s.addNode(i * dx, 0));
        if (i > 0 && i < panels) top.push(s.addNode(i * dx, h));
      }
      const mid = [];
      for (let i = 0; i < top.length; i++) mid.push(s.addNode(top[i].x, h / 2));
      for (let i = 0; i < panels; i++) s.addMember(bot[i], bot[i + 1], E, A);
      for (let i = 0; i < top.length - 1; i++) s.addMember(top[i], top[i + 1], E, A);
      for (let i = 0; i < top.length; i++) {
        s.addMember(top[i], mid[i], E, A);
        s.addMember(mid[i], bot[i + 1], E, A);
        s.addMember(mid[i], bot[i], E, A);   // K legs
        if (i > 0) s.addMember(mid[i], top[i - 1], E, A);
      }
      bot[0].support = "pin";
      bot[panels].support = "rollerx";
      top.forEach(n => { n.py = -20; });
      return s;
    },

    /* tapered tower (cantilever, fixed base, crane-mast style) */
    tower(E, A) {
      const s = new Structure();
      const H = 10, levels = 5, baseW = 2.0, topW = 0.8;
      const L = [], R = [];
      for (let i = 0; i <= levels; i++) {
        const y = H * i / levels, w = baseW + (topW - baseW) * i / levels;
        L.push(s.addNode(-w / 2, y));
        R.push(s.addNode(w / 2, y));
      }
      for (let i = 0; i < levels; i++) {
        s.addMember(L[i], L[i + 1], E, A);
        s.addMember(R[i], R[i + 1], E, A);
        s.addMember(L[i], R[i], E, A);
        s.addMember(L[i], R[i + 1], E, A);   // zig-zag bracing
        s.addMember(R[i], L[i + 1], E, A);
      }
      s.addMember(L[levels], R[levels], E, A);
      L[0].support = "pin";
      R[0].support = "pin";
      L[levels].px = 15;                      // lateral wind-ish load at top
      R[levels].px = 15;
      L[levels].py = -30;                     // crane load
      return s;
    }
  };

  static fromTemplate(name) {
    const E = 21000, A = 20;
    const gen = Structure.templates[name];
    return gen ? gen(E, A) : Structure.samplePratt();
  }

  /* ---------------- JSON save / load ---------------- */
  toJSON() {
    return JSON.stringify({
      app: "pin-joint-structure-solver", version: 2,
      nodes: this.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, support: n.support, px: n.px, py: n.py, mass: n.mass || 0 })),
      members: this.members.map(m => ({ id: m.id, n1: m.n1.id, n2: m.n2.id, E: m.E, A: m.A, dT: m.dT || 0, I: m.I || 0 }))
    }, null, 1);
  }

  static fromJSON(json) {
    const d = JSON.parse(json);
    if (!d.nodes || !d.members) throw new Error("Unrecognised file format.");
    Structure.resetIds(1);
    const s = new Structure();
    const byId = new Map();
    for (const nd of d.nodes) {
      const n = s.addNode(nd.x, nd.y);
      n.support = nd.support || "none";
      n.px = nd.px || 0; n.py = nd.py || 0; n.mass = nd.mass || 0;
      byId.set(nd.id, n);
    }
    for (const md of d.members) {
      const m = s.addMember(byId.get(md.n1), byId.get(md.n2), md.E, md.A);
      if (m) { m.dT = md.dT || 0; m.I = md.I || 0; }
    }
    return s;
  }

  static resetIds(v) { _nextNodeId = v; _nextMemberId = v; }

  /* ---------------- design: member utilisation ----------------
     σ = N/A.  Tension limited by σ_allow_max (yield/FS).
     Compression limited by min(σ_allow_min, Euler buckling of the
     pin-ended member):  P_cr = π²·E·I / L².  I from the member's real
     I (cm⁴) if set, else an equivalent solid square I = A²/12.       */
  static utilization(m, N, sigmaAllowMaxMpA, sigmaAllowMinMpA, buckle = true) {
    const A_mm2 = m.A * 100;                       // cm² -> mm²
    const N_N = Math.abs(N) * 1000;                // kN -> N
    const E_MPa = m.E * 10;                        // kN/cm² -> MPa (N/mm²)
    const sigma = N_N / A_mm2;                     // MPa
    if (N >= 0) return Math.abs(sigma) / sigmaAllowMaxMpA;   // tension
    if (!buckle) return Math.abs(sigma) / sigmaAllowMinMpA;  // compression, no buckling
    const L_mm = m.length * 1000;
    const I_mm4 = m.I > 0 ? m.I * 1e4 : A_mm2 * A_mm2 / 12;         // cm⁴ -> mm⁴
    const Pcr_N = Math.PI * Math.PI * E_MPa * I_mm4 / (L_mm * L_mm);
    const sigmaCr = Pcr_N / A_mm2;                 // MPa
    const limit = Math.min(sigmaAllowMinMpA, sigmaCr);
    return Math.abs(sigma) / limit;
  }

  /* Real, rolling- / tube-steel sections: {label, A:cm², I:cm⁴}   */
  static SECTIONS = [
    { label: "Solid eq. (A²/12)", A: 20, I: 0 },
    { label: "CHS 60.3×3.2",  A: 5.73, I: 22.7 },
    { label: "CHS 88.9×3.2",  A: 8.62, I: 79.0 },
    { label: "CHS 114.3×3.6", A: 12.5, I: 190 },
    { label: "CHS 139.7×4.0", A: 17.1, I: 389 },
    { label: "CHS 168.3×4.5", A: 23.2, I: 772 },
    { label: "CHS 219.1×5.0", A: 33.6, I: 1920 },
    { label: "RHS 80×40×3",   A: 6.7,  I: 52 },
    { label: "RHS 120×60×4",  A: 13.6, I: 248 },
    { label: "RHS 160×80×5",  A: 22.4, I: 783 },
    { label: "IPE 120",  A: 13.2, I: 318 },
    { label: "IPE 160",  A: 20.1, I: 869 },
    { label: "IPE 200",  A: 28.5, I: 1943 },
    { label: "IPE 240",  A: 39.1, I: 3892 },
    { label: "HEA 120",  A: 25.3, I: 606 },
    { label: "HEA 200",  A: 53.8, I: 3692 },
    { label: "HEA 240",  A: 76.8, I: 7763 }
  ];
}
