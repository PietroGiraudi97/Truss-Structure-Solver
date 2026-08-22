# Truss Structure Solver

An interactive, browser-based solver for **2D pin-jointed (truss) structures**.
Draw the structure, apply supports and loads, press **Solve**, and inspect
member forces, joint displacements, reactions and the deflected shape.

## Running it

Just open `index.html` in any modern browser (double-click it — no
installation, server or internet connection needed).

## Features

**Design-focused** (for engineers, students and fabricators):
- **Template library** — Pratt, Warren, Howe, K-truss, cantilever bracket and a tapered mast/jib; instant starting points you can then edit.
- **Material presets** — Steel S235/S355, aluminium 6061, timber GL24 (sets E, default A and σ_allow with sensible safety factors).
- **Design check** — per-member **utilisation** U = σ/σ_limit with σ_limit = min(σ_allow, Euler buckling `π²EI/L²`, pin-ended). Table column and member color mode *"Utilisation"* (green → amber → red; red = fails). Max-utilisation status line.
- **Save/Open** (JSON) and **CSV export** of all member results for reports/spreadsheets.
- **Full analysis report** (📄 Report) — a self-contained printable page with embedded
  images of the structure (force-coloured and deflected shape), bar charts of member
  forces/stress/utilisation/displacements and reactions, the dynamic mode-frequency chart
  and time-response plot (when run), and complete result tables. Print or "Save as PDF".
- **Getting-started overlay** on an empty canvas; resizable side panels (drag the splitters).

**Modelling:**
- Draw tools — Node (click to place, snap-to-grid 0.25 m), Member (joint-to-joint),
  Support (click a node to cycle pin → rollers), Load (click node, enter Px/Py kN), Edit.
- Pan/zoom: Shift-drag or middle-drag, wheel zoom, "Fit" button.
- **Solver** based on the **unit-load (virtual-work) method**:
  - Displacements come from the virtual-work integration
    **δ = Σ n·N·L / (E·A)** over all members, where `n` are the member
    forces due to a unit virtual load at the sought displacement
    coordinate and `N` the real member forces.
  - Because the structure can be statically indeterminate, the reference
    `N` forces (and the displacement field) are obtained from the exact
    stiffness equations `K·u = P`; the virtual-work products are then
    evaluated explicitly and independently, and the agreement between the
    two is reported in the results panel as a numerical check
    (machine-precision agreement).
- **Results**:
  - Member force table (tension/compression/zero-force), member
    elongations `δL = N·L/(E·A)`.
  - Joint displacement table (mm).
  - Canvas: members coloured by force (blue = tension, orange = compression),
    reaction arrows (green), and the **deflected structure** drawn over the
    ghosted original with adjustable magnification; deflected members are
    shaded by axial stress **σ = N/A** on a diverging blue-grey-red scale
    with an MPa legend.
  - Verification lines: equilibrium residual `|Ku − P|∞` and the difference
    between stiffness and virtual-work displacements.
- **Self weight (optional)** — tick *"Include self weight"* before solving;
  each member's weight `w = ρ·g·A·L` is lumped as a half-point-load at each
  end joint (the exact discrete axial model). Density is configurable
  (steel 7850, aluminium 2700, timber ~600 kg/m³). Weight is excluded while
  editing, so nothing drifts.
- **Thermal expansion (optional)** — tick *"Include thermal effects"* and set
  a coefficient α (steel ≈ 12 µε/°C) plus a ΔT per member (member edit panel)
  or one ΔT for all. Solved exactly via the fixed-end-force equivalent load
  `F_T = EA·α·ΔT`: restrained members develop **N = −EAαΔT** compression,
  while the virtual-work integration uses the total elongation
  `ΔL = N·L/(EA) + α·ΔT·L` as the real strain field.
- **Dynamic analysis** — after a static solve, run *modal analysis*:
  lumped mass matrix (member mass ρAL halved to end joints + optional joint
  masses in kg), natural frequencies & mode shapes (animated), then a damped
  **time-history** response to step / pulse / harmonic / ramp loadings via
  modal superposition (`M·ü + C·u̇ + K·u = P(t)`, ζ editable). The plot shows
  the monitored-dof displacement vs. time and the dynamic amplification
  factor (DAF); the canvas animates the deflected, stress-coloured shape.
- **Units**: geometry in **m**, loads in **kN**, `E` in **kN/cm²**
  (steel ≈ 21000), `A` in **cm²**, output displacements in **mm**.

## Files

```
index.html      UI shell
css/style.css   styling
js/structure.js data model (nodes, members, sample truss)
js/solver.js    virtual-work + stiffness solver and linear algebra
js/renderer.js  canvas drawing / hit-testing / view transforms
js/dynamics.js  modal analysis + time-history response
js/app.js       UI controller (tools, events, results)
test.html       standalone self-test of the solver (open and read the output)
docs.html       methodology & mathematical formulation (KaTeX-rendered;
                needs internet once, or falls back to showing raw math)
```

## Solving tips

- A stable planar truss needs **m + r ≥ 2j** (members + reactions ≥ 2×joints)
  and at least 3 non-concurrent reaction components. The status bar shows
  the counts and the solver detects mechanisms via a singular stiffness matrix.
- Click the **template dropdown** for a ready-made structure (Pratt, Warren,
  Howe, K-truss, bracket, mast).
- `test.html` verifies the solver against hand-computed textbook results.
- Keyboard: `1–5` switch tools, `S` solve, `F` fit, `Ctrl+Z` undo, `Ctrl+S` save.

## Who is this for?

- **Students & educators** — verify hand calculations (method of joints/sections,
  virtual work), visualise internal forces and deflections, produce reports for
  coursework.
- **Practicing structural engineers** — fast conceptual/preliminary design and
  sizing of roof trusses, footbridges, crane booms, and parametric exploration
  before a detailed FEA package.
- **Fabricators, makers & small workshops** — jib cranes, trailer frames, stage
  and lighting trusses, gates: "is this member OK?" answers with yield +
  buckling utilisation.
- **Architects** — form-finding of exposed steel trusses and communication of
  force flow in design review.

