# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-12, Depth Studio milestone 1.

## Objective

Development resumed on 2026-11-12 with **Depth Studio**, at the owner's request and ahead of Sprint 2. Milestone 1, the Emerald Chamber, is built on `feature/lead-architect` and not merged. Sprint 2, below, has not started and keeps its order. A short overview for anyone picking this up is in [HANDOFF](HANDOFF.md).

## Depth Studio

A third canvas mode, next to Mapping and Live preview. Decisions are in [DECISIONS](docs/architecture/DECISIONS.md), numbers in [PERFORMANCE](docs/development/PERFORMANCE.md#depth-studio).

- **Where:** pure maths in `src/engines/depth/` (config, window camera, seeded particles, targets). Renderer, shaders, store, viewport and controls in `src/modules/depth-studio/`. Shell changes: `CanvasMode` gains `depth`, plus the tab and two lazy imports.
- **Works:** the Emerald Chamber scene, framed for the master canvas or any screen at its exact aspect ratio; depth, viewer, particle, light, fog, palette, loop and seed controls; play, pause, scrub; perspective guides; a deterministic 15-second loop by frame number.
- **Checked in a browser** (dev server, port 3100, Corporate Keynote): depth reads with particles off; ultrawide master, 16:9 Main Wall and portrait side screen all frame without stretching; guides match the room; 60 fps preview on an M1 Max.
- **Not built yet:** saving (waits for L2), full-screen output (waits for O2), frame export, a `FrameSource` adapter so the scene plays across mapped screens in Live preview, and automatic comparison of rendered pixels and of the loop seam.
- **The pack:** `CLAUDE_MASTER_PROMPT.md`, `START_HERE.md` and `docs/features/depth-studio/` sit untracked in `app/`. They were read from there and not copied or changed. The owner decides when they are committed.
- **Three.js:** not installed. The install was blocked in the session, and the scene didn't need it.

## Verified current state

- **Folder layout:** everything lives in `~/Play.Code/playground.pixel/`, which isn't itself a Git repository. Never develop in `~/Documents/Play.Code/playground.pixel`, an old copy.

  | Path | Branch | Port |
  | --- | --- | --- |
  | `app/`: main worktree, integration checkout | `main` | 3000 |
  | `agents/lead-architect` | `feature/lead-architect` | 3100 |
  | `agents/product-design` | `feature/product-design` | 3101 |
  | `agents/content-engineering` | `feature/content-engineering` | 3102 |
  | `agents/led-engineering` | `feature/led-engineering` | 3103 |
  | `agents/output-engineering` | `feature/output-engineering` | 3104 |

- **Baseline:** `main` is at `c81a17b`, the merge of PR #11. The four other agent worktrees are at that commit and clean. `feature/lead-architect` carries Depth Studio milestone 1 on top of it.
- **Merged PRs:**
  - #1 Phase 0 foundation, #2 Phase 0 complete;
  - #3 undo and redo, #4 Motion Lab V1;
  - #5 agent briefs, #6 example gallery, #7 shared contracts and lanes, #8 folder layout;
  - #9 Aurora Gradient, #10 cabinet library.
- **Open PRs:** none on `main`. PR #11, the handoff, is merged.
- **Agents:** none running. All five are stopped.

## Completed features

- **Mapping Studio:** screens, cabinets, canvases and outputs mapped pixel-exact in Physical, Content and Output views. Exports: PNG and SVG pixel maps, manifest, technical report and Resolume preparation package. Undo and redo for every edit.
- **Motion Lab V1:** Live preview with seven deterministic patterns, separate content FPS and browser FPS, and overlap marks.
- **Aurora Gradient** (#9): a moving multi-color pattern with palette presets, three editable colors, flow speed and eight directions. It's continuous across screens, and the same frame always gives the same pixels. Settings aren't saved yet.
- **Cabinet library** (#10): profiles kept per browser, outside projects. Create, edit, duplicate, delete, and add to a project.
  - **Specs:** supplier, model and optional data-sheet values: power, weight, LED refresh rate, indoor or outdoor.
  - **Seed:** Yestech MG6S P2.6 Indoor.
  - **Older data:** custom cabinets saved earlier are copied in once.
- **Example gallery:** Festival Main Stage, Corporate Keynote, Motion Lab acceptance and a 500-screen stress test.
- **Parallel setup:** shared contracts, as types only, in [CONTRACTS](docs/architecture/CONTRACTS.md). Lanes, file ownership and dependencies in [docs/agents](docs/agents/README.md).

## Last validation

On `feature/lead-architect`, 2026-11-12. The browser and bundle rows below the tests are from `main` on 2026-11-08, except where they say Depth Studio:

| Check | Result |
| --- | --- |
| Typecheck, lint, build | Pass |
| Unit tests | 254 of 254 pass, in 16 files (18 new, for the depth engine) |
| Depth Studio bundle | Initial JavaScript unchanged at 172.8 KB. Viewport chunk 11.9 KB, controls chunk 3.9 KB, both on first open |
| GitHub CI on `main` | Pass |
| Browser, production build on port 3000 | Aurora Gradient in Live preview at 60 fps, 0 late, 0 skipped, continuous across Corporate Keynote's three screens. The cabinet library opens with the MG6S seed, the generic profiles and the specs form |
| Bundle | Initial JavaScript 172.8 KB, unchanged by Sprint 1. Aurora added 1.6 KB to app chunks; see [PERFORMANCE](docs/development/PERFORMANCE.md#content-engineering) |

## Important decisions

- **Contracts:** types only, no plugin framework. The Lead Architect owns them, and a contract change merges alone first.
- **Branches:** each lane works on its long-lived `feature/<lane>` branch. It merges `main` in and never rebases or force-pushes. PRs merge with CI passing and the user's approval.
- **Library data:** library profiles live in their own IndexedDB database. A project keeps a plain copy, so editing the library never changes a saved project, and the project format is unchanged (`SCHEMA_VERSION` 1).
- **Module state:** Aurora settings are module state, not saved. Saving waits for the `modules[id]` project section (L2).
- **Proposals:** [MODULES](docs/product/MODULES.md) is a proposal. Video encoding, NDI, Phase 4 calculations and anything needing a backend wait for approval.

## Known issues

- **Dead code:** `useApp.library`, `saveToLibrary` and `IndexedDbCabinetLibrary` in `state/store.ts` and `persistence/indexeddb.ts` are no longer used by the UI. The Lead Architect removes them in a cleanup.
- **Aurora:**
  - Settings are lost on reload, until L2.
  - `AuroraControls` is imported statically by the canvas header, so it isn't lazy-loaded.
- **Library copies:** editing a library profile doesn't update projects that already copied it. This is intentional.
- **Motion Lab:**
  - Venue-laptop performance is unmeasured.
  - The preview image is capped at 4096 px a side.
  - There's no full-screen output.
- **Undo:** not kept across reloads.
- **Resolume:** the guide is untested in real Arena.
- **Offline:** the app can't load offline without being served.
- **Audit:** `npm audit` reports 13 findings in dev tooling and 0 in production dependencies.

## Pending tasks

Task ids are defined in the agent briefs.
- **Ready:**
  - L1, module registry and studio switch;
  - D1–D3, studio navigation spec, theme tokens, preferences store;
  - C1, content templates per screen, canvas and output;
  - O1, exports on the shared contract.
- **Waiting on a dependency:** L2, D4–D7, C3, E3, E4, O3.
- **Waiting on the user's approval:** O2 full-screen output, C2 content layouts, C4 mockups, E2 power and port calculations, O4 video encoding, O5 NDI, C5 video generation.

## Recommended next sprint

**Sprint 2:** visible features that build on Sprint 1, with the fewest collisions.
1. **Output Engineering, O2:** full-screen output to a second display, at one output's exact size. This needs approval, which is recommended because it unblocks the NDI test.
2. **Content Engineering, C1:** content templates per screen, canvas and output. This is a Phase 1 deliverable, already approved.
3. **LED Engineering, E2:** power and weight per screen from the library specs. This needs approval to start Phase 4.

In parallel, the Lead Architect does L1 and removes the dead library code.

## Resume

1. **Check the baseline:** `cd ~/Play.Code/playground.pixel/app && git fetch && git status && git log --oneline -1`. Expect `main` at `ba4e5f4`, or the merge of the handoff PR.
2. **Run the app:** `npm run build && npx next start -p 3000`.
3. **Start agents** with the commands in [HANDOFF](HANDOFF.md#restart-each-agent). Each one runs `git merge origin/main` first, as [START](docs/agents/START.md) says.

## Resume prompt

Read:
- CLAUDE.md
- SESSION.md
- HANDOFF.md
- docs/agents/README.md
- docs/agents/lead-architect.md

You are the Lead Architect. Continue from the verified current state. Ask the user which Sprint 2 items to approve before starting them. Don't re-audit completed work unless the repository contradicts SESSION.md.
