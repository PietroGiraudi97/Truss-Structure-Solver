# Contributing to Truss Structure Solver

Thanks for your interest in improving this project! Here's how to help.

## Ways to contribute

- **Report bugs** — open an issue with a clear description, steps to reproduce, and (if possible) the structure JSON that triggers it.
- **Request features** — open an issue describing the feature and why it's useful.
- **Fix bugs / add features** — fork, branch, code, test, and open a pull request.
- **Improve docs** — the methodology page (`docs.html`) and this README are always open to improvement.

## Getting started

1. **Fork** the repository and clone your fork.
2. Create a branch: `git checkout -b feature/your-feature`.
3. Make your changes.
4. **Test** — open `test.html` in a browser and confirm all lines read `PASS`. If you changed solver or linear-algebra code, this is mandatory.
5. Commit with a clear message and open a pull request.

## Project conventions

This is a **vanilla-JS browser app** — no build step, no npm, no framework, no server.

- Open `index.html` directly in a browser to run.
- **Load order matters.** Scripts are loaded in a fixed order in `index.html` and `test.html`:
  `structure.js → solver.js → dynamics.js → worked.js → influence.js → report.js → renderer.js → app.js`
  Do not reorder them.
- `app.js` is an IIFE (`"use strict"`); everything else declares globals (`class Structure`, `const Lin`, `const Solver`, `const Dynamics`, `const Report`, `const Renderer`, `const Worked`, `const Influence`, `function stressColor/utilColor`).
- `test.html` loads only the solver files (no renderer/report/app) — keep those three free of DOM/canvas dependencies.
- **No comments unless asked**; match the existing style (const/let, no semicolon-free style).
- The solver uses the **unit-load (virtual-work) method** plus exact stiffness `K·u = P`; the two displacement fields are compared as a numerical check. Preserve this dual-path verification.

## Units (critical, easy to get wrong)

- Geometry in **m**, loads in **kN**, `E` in **kN/cm²** (steel ≈ 21000), `A` in **cm²**, output displacements in **mm**. Keep these consistent in any new code.

## Pull request checklist

- [ ] Code follows the existing style and conventions.
- [ ] `test.html` passes (all `PASS`).
- [ ] New features are documented in the README (and `docs.html` if they change the math).
- [ ] No secrets or local paths committed.

## Code of conduct

Please be respectful and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
