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
IMPACT: Design in [OVERVIEW](OVERVIEW.md#motion-lab). Refresh rate only appears as a data sheet value.

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

---
DATE: 2026-11-07
DECISION: Undo and redo keep immutable project snapshots (`state/history.ts`), recorded by the store's single `edit()` entry point. History lives in memory only, up to 200 steps, and resets when another project opens.
WHY: Every edit is already a pure function returning a new `Project` that shares unchanged parts, so snapshots are cheap and exact, and cover every current and future edit without per-operation inverse code. No dependency was needed.
IMPACT: An undo restores content but keeps the current save revision, so autosave never conflicts. Cabinets saved to the shared library aren't project edits and aren't undone. Stored history across reloads would need a schema change and isn't planned.

---
DATE: 2026-11-07
DECISION: Motion Lab V1 starts before Phase 1 is finished.
WHY: Product priority set by the owner. Phase 1's remaining work (venue performance, offline, rotation, library) doesn't block a preview built on the existing mapping.
IMPACT: The Phase 2 dependency on Phase 1 is waived for V1 only. Venue-laptop measurement remains open for both.

---
DATE: 2026-11-07
DECISION: The Motion Lab preview never blocks on validation. It reads overlap issues from `validateProject` and marks them, and export gating stays as it is.
WHY: A technician needs to see a broken mapping to fix it. A second set of overlap rules would drift from the one that decides exports.
IMPACT: Shared, conflicting and stage overlaps are marked in different colors. See [OVERVIEW](OVERVIEW.md#preview-and-export-validation).

---
DATE: 2026-11-07
DECISION: The preview draws each content frame once onto an off-screen master image and copies each screen's `masterRect` into the rectangle its view already uses. It loads on first use, in its own 7 KB gzip chunk.
WHY: One image per frame keeps shared regions identical and content continuous by construction, with no second mapping engine. Lazy loading keeps the editor's load unchanged.
IMPACT: The off-screen image is capped at 4096 px a side, so a very large master is upscaled in the preview when zoomed in. Exports are unaffected.

---
DATE: 2026-11-12
DECISION: Depth Studio starts before the Sprint 2 items (full-screen output, content templates, module registry). It is built as an isolated, lazy-loaded module: pure maths in `src/engines/depth/`, the renderer and interface in `src/modules/depth-studio/`. Its only shell change is a third canvas mode, `depth`, next to Mapping and Live preview.
WHY: Product priority set by the owner, with an implementation pack the owner supplied. The pack is not in the repository yet: it sits untracked in the `app/` worktree, under `docs/features/depth-studio/`. None of the Sprint 2 items had started, so there was nothing to collide with, and the module touches no mapping, persistence or export code.
IMPACT: Sprint 2 keeps its order and its files. Depth Studio reads canvas and screen sizes from `resolveMapping` and stores none. Its settings are module state and aren't saved until the `modules[id]` project section exists (L2). Full-screen output of a depth scene waits for O2, and frame export for the export milestone.

---
DATE: 2026-11-12
DECISION: The first Depth Studio scene renders with WebGL2 directly, without Three.js. The renderer sits behind three calls: `setScene`, `resize` and `renderFrame`.
WHY: The pack names Three.js, but the scene is a box, a few ribs and one instanced draw, all shaded analytically, which needs no scene graph. Adding the dependency was also not approved in this session: the install was blocked. Measured cost of the module as built: 11.9 KB gzip for the viewport, renderer and engine, and 3.9 KB for the controls, both loaded on first use, with initial JavaScript unchanged at 172.8 KB. Three.js itself was not measured, because it was never installed.
IMPACT: No new dependency. If a later scene needs imported 3D assets (the pack's Floating Product Chamber), Three.js can replace the renderer behind the same three calls, with a measured bundle cost recorded here first. The config, camera, particle and loop maths don't depend on the renderer.

---
DATE: 2026-11-12
DECISION: A depth scene is projected off-axis, through the four edges of the LED plane, from one eye position. Every animated term completes a whole number of turns per loop, and a frame is a function of the config and the frame number alone.
WHY: The off-axis frustum is what makes the wall a window: the plane's edges land exactly on the image's edges at any aspect ratio and any viewer offset, so nothing is stretched. Whole turns close the loop exactly at any speed, and frame-number input makes the preview, a scrub and a future export draw the same pixels.
IMPACT: This is frontal, single-plane perspective, correct for one viewing position. It is not anamorphic calibration across several planes, and the interface says so. Physical wall size is used when the target is a single screen; a canvas or the master uses a nominal 3 m height at the right aspect ratio.
