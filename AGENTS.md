# AGENTS.md

Vanilla-JS browser app (no build step, no npm, no framework, no server). Open `index.html` directly in a browser to run.

## Commands / verification
- **No build/lint/test tooling exists.** Do not invent npm scripts or a test runner.
- **Run the self-test:** open `test.html` in a browser and read the `<pre>` output. It verifies the solver against hand-computed textbook results (PASS/FAIL lines). This is the only test harness.
- After changing solver/linear-algebra code, always check `test.html` output.

## Architecture
- Plain global objects/classes shared across files via script-tag order in `index.html` (and `test.html`). **Load order matters** — do not reorder:
  `structure.js → solver.js → dynamics.js → report.js → renderer.js → app.js`
- `app.js` is an IIFE (`"use strict"`); everything else declares globals (`class Structure`, `const Lin`, `const Solver`, `const Dynamics`, `const Report`, `const Renderer`, `function stressColor/utilColor`).
- `test.html` loads only `structure.js`, `solver.js`, `dynamics.js` (no renderer/report/app) — keep those three free of DOM/canvas dependencies.
- `report.js` opens a separate window for the printable report; `docs.html` is standalone (KaTeX needs internet once, else falls back to raw math).

## Units (critical, easy to get wrong)
- Geometry in **m**, loads in **kN**, `E` in **kN/cm²** (steel ≈ 21000), `A` in **cm²**, output displacements in **mm**. Keep these consistent in any new code.

## Conventions
- No comments unless asked; match existing style (const/let, no semicolon-free style).
- Solver uses the **unit-load (virtual-work) method** plus exact stiffness `K·u = P`; the two displacement fields are compared as a numerical check. Preserve this dual-path verification.
