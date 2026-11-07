# Architecture / Product Decisions

---
DATE: 2026-11-07
DECISION: No native Resolume preset generation yet. The package has a manual workflow, and the adapter has an explicit `nativePresetSupport: unsupported` slot.
WHY: The format isn't publicly documented, and no Resolume install was available to test a generated file. A corrupt preset found at load-in costs far more than typing slices.
IMPACT: Users enter slices by hand from the guide. See RESOLUME.md for what would change this.

---
DATE: 2026-11-07
DECISION: Physical lengths are stored as integer micrometres, and pixels as integers.
WHY: Exact arithmetic with no float drift, and no rounding that can hide an error.
IMPACT: Files store `widthUm: 500000`. The UI and manifest show millimetres, as strings formatted with integer maths.

---
DATE: 2026-11-07
DECISION: A region's size is not stored. It is always the screen's resolution.
WHY: Pixel-accurate 1:1 mapping is the product's core promise, and a stored size could drift out of sync.
IMPACT: Scaled regions aren't possible. Mixed-pitch scaling would need an explicit, separate feature.

---
DATE: 2026-11-07
DECISION: Mapping exports are blocked while validation has errors. The report and project file stay available.
WHY: Bad coordinates must not leave the app, but a report that lists the errors and a backup are still useful.
IMPACT: Warnings and notes never block.

---
DATE: 2026-11-07
DECISION: Storage is IndexedDB, with optimistic revision checks and debounced autosave.
WHY: Atomic transactions, larger capacity than localStorage, and the same conflict model cloud sync will need.
IMPACT: Data is per browser and per address. Project file export is the backup and transfer path.

---
DATE: 2026-11-07
DECISION: Importing a project file always creates a new project.
WHY: Opening a file should never overwrite existing work.
IMPACT: Importing the same file twice makes two projects.

---
DATE: 2026-11-07
DECISION: Library cabinets ship as generic profiles only, with no manufacturer names.
WHY: Inventing real product specs would be dangerous. Users enter values from the supplier's data sheet as custom profiles.
IMPACT: Generic profiles are read-only, and can be duplicated as custom.

---
DATE: 2026-11-07
DECISION: Moved `shadcn` to dev dependencies.
WHY: It's a CLI with a large dependency tree (including `ts-morph`), used at runtime only for a CSS import resolved at build time. Production audit findings went from 6 to 0.
IMPACT: Building needs dev dependencies installed, which `npm ci` and common hosts do by default. `npm audit` without `--omit=dev` still reports findings in tooling.

---
DATE: 2026-11-07
DECISION: Content FPS, browser preview FPS and physical LED refresh rate are separate metrics with separate names.
WHY: They measure different things. Showing browser FPS as refresh rate would mislead a technician about real hardware.
IMPACT: Design in [OVERVIEW](OVERVIEW.md#motion-lab-readiness). Refresh rate only appears as a data sheet value.

---
DATE: 2026-11-07
DECISION: Motion Lab will start on Canvas 2D, with frame number as the only input to content. No Three.js without a measured need.
WHY: Patterns are 2D and need determinism. Canvas 2D already handles the master canvas size limit. Three.js would add weight for capabilities this doesn't use.
IMPACT: See the escalation order in [OVERVIEW](OVERVIEW.md#rendering-technology).

---
DATE: 2026-11-07
DECISION: SESSION.md is tracked in Git at the repository root.
WHY: The state of the project should travel with the code and be visible to every collaborator and session.
IMPACT: It holds current state only, so it's replaced rather than appended to.

---
DATE: 2026-11-07
DECISION: Performance budgets are checked by hand with `npm run perf:bundle -- --check`, and aren't in CI.
WHY: CI stays simple and non-flaky. The bundle check is deterministic and could join CI later; browser timings can't reliably run there.
IMPACT: PRs touching performance must state their measurements.
