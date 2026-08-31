# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-08-31

### Added
- **Educational "Learn" tools (Step 5)**:
  - Method of joints (worked step-by-step)
  - Method of sections (draw a cut line, solve the free body)
  - Zero-force member detection with explanations
  - Influence lines for any member force or reaction
- **Help modal** (top-bar `?`) with workflow, shortcuts and units.
- **Joint results CSV export** (displacements + reactions) alongside the member CSV.
- Separate **min (compression) and max (tension) allowable stresses**.
- **Density** moved into the material section; material presets now set it.

### Changed
- Edit tool and selection box moved into the drawing area as floating panels.
- Accordion steps are now exclusive (only one open at a time) with scrollable bodies.
- Cross-platform font stacks and responsive layout for small screens.
- Richer printable report (worked solution + influence-line figure).

### Fixed
- Selection box now closes when clicking empty space or switching tools.
- Popup-blocker handling for the report window.

## [1.0.0] - 2026-08-31

### Added
- Interactive 2D pin-jointed truss solver (stiffness + virtual-work).
- Template library (Pratt, Warren, Howe, K-truss, bracket, mast).
- Material presets and design checks (yield + Euler buckling).
- Self weight and thermal expansion.
- Dynamic analysis (modal + time history).
- Printable report and CSV export.
- Standalone self-test harness (`test.html`).
- Methodology documentation (`docs.html`).
