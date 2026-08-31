<div align="center">

# 🏗️ Truss Structure Solver

**An interactive, browser-based solver for 2D pin-jointed (truss) structures.**

Draw the structure, apply supports and loads, press **Solve**, and inspect member forces, joint displacements, reactions and the deflected shape — with built-in teaching tools for the undergraduate structures syllabus.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)](#)
[![Works offline](https://img.shields.io/badge/works-offline-success)](#)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**▶ [Launch the app](https://pietrogiraudi97.github.io/Truss-Structure-Solver/)** · **📖 [Methodology & math](docs.html)**

</div>

---

## ✨ What it does

A complete, self-contained **structural analysis tool** that runs entirely in your browser — no installation, no server, no internet needed. It combines an exact stiffness solver with the classical hand methods taught in every structures course.

| | |
|---|---|
| **Draw** | Place joints, connect members, fix supports, apply loads — with a template library to start instantly. |
| **Solve** | Exact stiffness `K·u = P` **and** the unit-load (virtual-work) method, cross-checked to machine precision. |
| **Design** | Per-member utilisation with yield **and** Euler buckling checks, material presets, real steel sections. |
| **Learn** | Method of joints (worked step-by-step), method of sections, zero-force detection, influence lines. |
| **Dynamic** | Modal analysis (natural frequencies & mode shapes) and damped time-history response. |
| **Report** | One-click printable report with embedded charts, tables and images. |

---

## 🚀 Quick start

**Option 1 — just use it (no setup):**

1. Open the **[live app](https://pietrogiraudi97.github.io/Truss-Structure-Solver/)** — or
2. Download this repo and double-click `index.html` in any modern browser.

**Option 2 — run locally with a server (recommended for development):**

```bash
# any static file server works, e.g. Python:
python -m http.server 8000
# then open http://localhost:8000
```

> No build step, no npm, no framework, no dependencies. The whole app is a handful of plain JavaScript files loaded in order.

---

## 🧭 Workflow

1. **Draw** — pick a template (top bar) or use the **Node** tool to place joints and **Member** to connect them.
2. **Support** — click a joint to cycle pin / rollers (you need at least 3 reaction components).
3. **Load** — click a joint and enter Px / Py.
4. **Material & section** — set E, A, density and allowable stresses for new members; select a member with the **Edit** tool to change it individually.
5. **Solve** — press **▶ Solve** (or `S`).
6. **Learn** — use the Step 5 tools to see the method of joints, sections, and influence lines.

---

## 🎓 Educational tools

These make the app a genuine teaching aid, not just a calculator:

- **Method of joints (worked)** — solves a determinate truss joint-by-joint, showing each `ΣFx = 0`, `ΣFy = 0` step and the resulting member forces in order.
- **Method of sections** — draw a cut line; the program isolates the free body and solves the cut members from `ΣFx`, `ΣFy`, `ΣM`.
- **Zero-force member detection** — highlights members carrying no force by the classic textbook rules, with an explanation for each.
- **Influence lines** — plot how a moving unit load affects any member force or reaction.

---

## 🧮 The solver

The program uses the **unit-load (virtual-work) method** for displacements:

```
δ = Σ n·N·L / (E·A)
```

where `n` are member forces under a unit virtual load and `N` the real member forces. Because the structure may be statically indeterminate, the reference `N` forces come from the exact stiffness equations `K·u = P`; the virtual-work products are then evaluated independently and the agreement between the two is reported as a numerical check (machine-precision agreement).

**Also included:** self weight, thermal expansion, dynamic modal analysis, and time-history response via modal superposition.

---

## 🗂️ Project structure

```
index.html      UI shell
css/style.css   styling
js/
  structure.js  data model (nodes, members, sample truss)
  solver.js     virtual-work + stiffness solver and linear algebra
  worked.js     method of joints (worked), method of sections, zero-force detection
  influence.js  influence lines for members & reactions
  renderer.js   canvas drawing / hit-testing / view transforms
  dynamics.js   modal analysis + time-history response
  app.js        UI controller (tools, events, results)
test.html       standalone self-test of the solver (open and read the output)
docs.html       methodology & mathematical formulation (KaTeX-rendered)
```

> **Load order matters** — the scripts are loaded in a specific order in `index.html` and `test.html`. Don't reorder them.

---

## 🧪 Testing

There is no build or test runner — the test harness is a standalone page:

1. Open `test.html` in a browser.
2. Read the `<pre>` output — it verifies the solver against hand-computed textbook results (PASS/FAIL lines).

After changing solver or linear-algebra code, always check `test.html`.

---

## 📏 Units

| Quantity | Unit |
|---|---|
| Geometry / lengths | **m** |
| Loads / forces / reactions | **kN** |
| Young's modulus E | **kN/cm²** (steel ≈ 21000) |
| Area A | **cm²** |
| Density ρ | **kg/m³** |
| Displacements / elongations | **mm** |
| Stress σ = N/A | **MPa** |

---

## 🗺️ Roadmap

- [x] Exact stiffness + virtual-work solver
- [x] Design checks (yield + Euler buckling)
- [x] Educational tools (method of joints/sections, zero-force, influence lines)
- [x] Dynamic analysis (modal + time history)
- [x] Printable report & CSV export
- [ ] More templates (Fink, Baltimore, Vierendeel)
- [ ] Load combinations & code-based design (Eurocode / AISC)
- [ ] Second-order (P–Δ) analysis
- [ ] Save/load of analysis settings alongside the model

---

## 🤝 Contributing

Contributions are welcome! Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** for guidelines, and check the **[CHANGELOG.md](CHANGELOG.md)** for recent changes.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 👥 Who is this for?

- **Students & educators** — verify hand calculations, visualise internal forces and deflections, produce coursework reports.
- **Practicing structural engineers** — fast conceptual/preliminary design and sizing of roof trusses, footbridges, crane booms.
- **Fabricators, makers & small workshops** — jib cranes, trailer frames, stage and lighting trusses: "is this member OK?" answers with yield + buckling utilisation.
- **Architects** — form-finding of exposed steel trusses and communication of force flow in design review.
