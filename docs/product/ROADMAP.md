# Roadmap

Each phase needs explicit approval to start. Requirements for what exists today are in [REQUIREMENTS](REQUIREMENTS.md).

## Phase 0: Foundation

**Status: complete.** Merged on 2026-11-07. All acceptance criteria were met, including a full manual acceptance run.

**Objective:** turn the working prototype into a professionally maintained product foundation.

**Deliverables**
- Baseline commit, private repository and CI.
- Documentation system, audit, architecture review and Motion Lab readiness plan.
- Performance baseline, budgets and tooling. Documented design direction.

**Dependencies:** the functional MVP.

**Acceptance criteria**
- CI passes on a clean checkout: typecheck, lint, tests, build.
- All documentation links resolve.
- Baseline measurements are recorded with a repeatable method.
- No functionality lost: unit tests pass and the manual acceptance run passes.

**Exclusions:** new product features, UI redesign, broad refactoring.

## Phase 1: Mapping Studio

**Status: in progress.** Started 2026-11-07. Done: undo and redo, and the top bar fix from the design system list.

**Objective:** make mapping dependable and fast enough for daily use on real shows.

**Deliverables**
- Undo and redo. ✅
- Performance measured on venue-class hardware, with fixes for what that shows.
- Code splitting of the start screen from the workspace.
- Screen rotation (90°, 180°, 270°) in physical and output mapping.
- Cabinet library management outside a project.
- Content template exports per canvas.
- Design system corrections from [DESIGN_SYSTEM](DESIGN_SYSTEM.md#known-inconsistencies).
- Offline loading of the app itself.

**Dependencies:** Phase 0. Field feedback from the first real show.

**Acceptance criteria**
- Every edit to a project can be undone and redone, including deleting screens.
- All [budgets](../development/PERFORMANCE.md#budgets) pass, and budgets for a venue laptop are set and met.
- Playground Studio maps a real show without a spreadsheet.
- The app opens with no network after one visit.

**Exclusions:** animation, native Resolume presets, multi-user features, curved or free-form screens.

## Phase 2: Motion Lab

**Status: V1 delivered.** Started 2026-11-07, ahead of the rest of Phase 1, as the product priority. All deliverables and acceptance criteria below are met on the reference machine; see [OVERVIEW](../architecture/OVERVIEW.md#motion-lab). Venue-laptop performance is still unmeasured.

**Objective:** generate test and calibration content that plays across the mapped screens.

**Deliverables**
- Moving grids, horizontal and vertical scans, frame counters and color cycling. ✅
- Content flowing across multiple screens, and intentionally overlapping regions. ✅
- Live preview with configurable target content FPS and measured browser FPS. ✅

Design: [Motion Lab](../architecture/OVERVIEW.md#motion-lab).

**Dependencies:** Phase 1, waived for V1 by product decision. A measured preview budget on venue hardware.

**Acceptance criteria**
- A given frame number always renders identical pixels, independent of playback speed.
- Patterns line up across screen boundaries, verified by pixel sampling.
- The UI labels content FPS and browser FPS separately, and never presents either as LED refresh rate.
- No regression in editor budgets.

**Exclusions:** video file encoding, timeline editing, 3D, audio-reactive content, user-written shaders, Three.js without a measured need.

## Phase 3: Resolume Bridge

**Objective:** remove manual slice entry, if it can be done reliably.

**Deliverables**
- Tested guide corrections from real use.
- Analysis of presets saved from Arena, and a native preset writer **only if** it passes the [conditions](../integrations/RESOLUME.md#before-enabling-native-presets).
- Export of Motion Lab content in formats Resolume plays, if tested.

**Dependencies:** access to Resolume Arena on Mac and Windows. Phase 2 for content export.

**Acceptance criteria**
- Generated presets load in the listed Arena versions, and every slice matches the pixel map.
- Tested versions are shown in the app. Others are marked unverified.

**Exclusions:** driving Resolume over a network, other media servers, undocumented behaviour without version testing.

## Phase 4: Production Engineering

**Objective:** extend from mapping to planning the LED system itself.

**Deliverables**
- Processor management and port capacity.
- Signal routing between processors and cabinets.
- Electrical calculations for power and circuits.
- Physical LED refresh rate as a data sheet value, kept separate from content and browser FPS.

**Dependencies:** Phase 1. Validated formulas and real supplier data.

**Acceptance criteria**
- Calculations are pure, unit-tested and checked against real show paperwork.
- Results state their assumptions. Safety-relevant values carry a clear disclaimer and need qualified review.

**Exclusions:** certified electrical design, structural calculations, direct processor control.

## Phase 5: SaaS Platform

**Objective:** make the tool commercially available to other production companies.

**Deliverables**
- Authentication and workspaces.
- Cloud sync through a new [`ProjectRepository`](../architecture/DATA_MODEL.md#persistence) adapter, keeping offline work.
- Collaboration, billing, and security and privacy review.

**Dependencies:** a validated product from earlier phases. A commercial decision to proceed.

**Acceptance criteria**
- Tenant isolation is tested.
- Offline edits sync without silent data loss.
- Existing local projects migrate without loss.

**Exclusions:** anything built before there's demand. No enterprise features ahead of a paying customer.
