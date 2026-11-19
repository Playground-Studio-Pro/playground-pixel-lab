# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-13, in-app MP4 export verified (branch `feat/mp4-export-ui`, local, not pushed).

## Objective

**Immediate milestone: Calibration → Live preview → MP4 export.** Built and verified on `feat/mp4-export-ui`; it waits for the owner's approval to push and merge.

**Sprint 3, Production Studio** ([SPRINT_3](docs/agents/SPRINT_3.md)) continues after it. **Direction approved 2026-11-13** (see [DECISIONS](docs/architecture/DECISIONS.md)): desktop-first and web-compatible, Electron later in an isolated proof of concept, FFmpeg after legal review, native ProRes or PNG masters plus per-output and per-screen exports, never downscaled. No Electron work has started.

## Where it stands

- **Merged to `main` on 2026-11-13**, each with CI and local checks passing:
  - #12 Sprint 3 foundation and Depth Studio, `73237b8`;
  - #14 calibration test card in Live preview, `8641281`. It contained #13, which GitHub marked merged (`54a1765`): #13 alone conflicted with #12 in `PERFORMANCE.md`, and #14 carried that resolution, so the Product Design branch wasn't touched;
  - #15 Output Engineering's browser H.264 exporter, `10f9f74`. Its branch was pushed unchanged (`d3f5b04`) and its PR opened by the Lead Architect.
- **`feat/mp4-export-ui`** (Lead Architect worktree, from `10f9f74`, local only): Export MP4 in the Output Studio.
  - Targets: the master canvas, each output and each screen, sized by `resolveMapping` (`engines/video-targets.ts`). Any too large for H.264 is listed with the reason.
  - Outputs and screens are cut from the master frame at 1:1 (`modules/output/target-source.ts`).
  - Calibration (`createCalibrationSource`) and Depth Studio (`createDepthSource`) sources are frozen when the export starts. An export showing the logo refuses to start if the logo didn't load.
  - Frame rate, duration, progress, Cancel, download. Calls Output's `exportMp4` unchanged.
- **Depth Studio:** works in the Content Studio and Live preview, and now exports through the same pipeline. Settings still aren't saved. Content Engineering hasn't started.
- **Lanes:** Content Engineering and LED Engineering not started. Output Engineering's MP4 work is merged. Product Design has the follow-ups in Known issues.
- **The pack:** `CLAUDE_MASTER_PROMPT.md`, `START_HERE.md` and `docs/features/depth-studio/` sit untracked in `app/`. The owner decides when they are committed.

## Verified current state

- **Folder layout:** everything lives in `~/Play.Code/playground.pixel/`, which isn't itself a Git repository. Never develop in `~/Documents/Play.Code/playground.pixel`, an old copy.

  | Path | Branch | Port |
  | --- | --- | --- |
  | `app/`: main worktree, integration checkout | `main` | 3000 |
  | `agents/lead-architect` | `feat/mp4-export-ui` now; lane branch `feature/lead-architect` | 3100 |
  | `agents/product-design` | `feature/product-design` | 3101 |
  | `agents/content-engineering` | `feature/content-engineering` | 3102 |
  | `agents/led-engineering` | `feature/led-engineering` | 3103 |
  | `agents/output-engineering` | `feature/output-engineering` | 3104 |

- **Baseline:** `main` is at `10f9f74`, the merge of PR #15. The other agent worktrees are clean and haven't merged `main` since: `product-design` at `1c59d6f`, `output-engineering` at `d3f5b04`, the rest at `c81a17b`. The Lead Architect worktree is on `feat/mp4-export-ui`.
- **Merged PRs:**
  - #1 Phase 0 foundation, #2 Phase 0 complete;
  - #3 undo and redo, #4 Motion Lab V1;
  - #5 agent briefs, #6 example gallery, #7 shared contracts and lanes, #8 folder layout;
  - #9 Aurora Gradient, #10 cabinet library;
  - #12 Sprint 3 foundation, #13 calibration frames, #14 calibration in Live preview, #15 H.264 exporter.
- **Open PRs:** none. #12–#15 are merged.
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

On `feat/mp4-export-ui`, 2026-11-13, M1 Max, production build on port 3100:

| Check | Result |
| --- | --- |
| Typecheck, lint, build | Pass |
| Unit tests | 302 of 302 pass, in 23 files |
| Bundle | Initial JavaScript 172.8 KB gzip, unchanged; within every budget |
| Browser | Headless Chrome 157, driven over the DevTools protocol, Corporate Keynote, Output Studio, Main Wall 2688 × 1536 at 30 fps: Identification 5 s, Calibration 10 s, Depth Studio 5 s, then Cancel (no file, button restored). No console errors. The whole run took 45 s |
| ffprobe | All three: H.264 High, yuv420p, 2688 × 1536, 30/1 fps, one stream, no audio. 150, 300 and 150 decoded frames; 5.000, 10.000 and 5.000 s; full FFmpeg decode without errors |
| Animation | Calibration: 300 of 300 frames distinct, counter reads F 000150 at frame 150. Depth: 150 of 150 distinct, frame 0 vs 75 at 22.9 dB PSNR. Identification is a still frame: 54.5 dB between frames 0 and 149, encoder noise only |
| Preview/export | Identification frame 0 vs the Preview dialog's PNG of the master, cropped at Main Wall (768, 0): 53.1 dB PSNR; the same crop one pixel off: 29.7 dB. No scaling, no offset |
| Not tested | Interactive Chrome, Safari, other GPUs, Windows, odd-sized masters in the browser, very long exports (the compressed file stays in memory) |

The red, green, blue, white and black patches in the Calibration frame are intended reference patches, not placeholder bars. Evidence lives in the session scratchpad and is temporary.

## Important decisions

- **Contracts:** types only, no plugin framework. The Lead Architect owns them, and a contract change merges alone first.
- **Branches:** each lane works on its long-lived `feature/<lane>` branch. It merges `main` in and never rebases or force-pushes. PRs merge with CI passing and the user's approval.
- **Library data:** library profiles live in their own IndexedDB database. A project keeps a plain copy, so editing the library never changes a saved project, and the project format is unchanged (`SCHEMA_VERSION` 1).
- **Module state:** Aurora settings are module state, not saved. Saving waits for the `modules[id]` project section (L2).
- **Proposals:** [MODULES](docs/product/MODULES.md) is a proposal. Video encoding, NDI, Phase 4 calculations and anything needing a backend wait for approval.

## Known issues

- **MP4 export:**
  - Masters and outputs wider than 4096 px (Corporate Keynote's 4224 × 1536) can't be exported as H.264 whole. They wait for the desktop ProRes/PNG master.
  - The whole compressed file is held in memory until download.
  - The Live preview's own Motion Lab patterns aren't sources yet, so they can't be exported.
  - `exportMp4` still has an optional logo overlay; the app doesn't use it. Output Engineering may remove it.
- **Calibration test card (for Product Design, D9):**
  - At 1440 px the Live preview header is wider than the canvas area and scrolls sideways.
  - The Live preview screen-guide labels cover the test card's top-left labels in Calibration mode; guides can be switched off.
  - The pure calibration code (`frame.ts`, `tokens.ts`, `from-mapping.ts`) lives in `components/shell/calibration` but is used by a module; move it beside the engines later.
- **Test card export:** a frame exported before the logo loads has no logo. Exporters must `await prepareCalibrationSource()` first (Output Engineering).

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

1. **Owner:** approve pushing `feat/mp4-export-ui` and opening its PR; merge after CI.
2. **Product Design:** the Live preview header layout and guide labels (Known issues); placement of the Output Studio export panel.
3. **Sprint 3** in [SPRINT_3](docs/agents/SPRINT_3.md): D8–D9, C6, E5–E6, O6–O10, then L6. Agents merge `main` first.
4. **Lead cleanup:** remove `useApp.library`, `saveToLibrary` and `IndexedDbCabinetLibrary`; move Motion Lab patterns onto `FrameSource`; move the pure calibration code beside the engines.
5. **Later, approved direction:** the desktop proof of concept under `desktop/`, after this milestone ships.

## Resume

1. **Check the baseline:** `cd ~/Play.Code/playground.pixel/app && git fetch && git status && git log --oneline -1`. Expect `main` at `10f9f74`, or later if the MP4 export PR has merged.
2. **Run the app:** `npm run build && npx next start -p 3000`.
3. **Start agents** with the commands in [HANDOFF](HANDOFF.md#restart-each-agent). Each one runs `git merge origin/main` first, as [START](docs/agents/START.md) says.

## Resume prompt

Read:
- CLAUDE.md
- SESSION.md
- HANDOFF.md
- docs/agents/README.md
- docs/agents/lead-architect.md

You are the Lead Architect. Continue from the verified current state. Sprint 3 is approved ([SPRINT_3](docs/agents/SPRINT_3.md)), and so is the desktop direction (DECISIONS, 2026-11-13). First check whether `feat/mp4-export-ui` is pushed and merged; ask before pushing or merging. Don't re-audit completed work unless the repository contradicts SESSION.md.
