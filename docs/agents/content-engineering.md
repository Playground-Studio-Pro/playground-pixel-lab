# Content Engineering Brief

**Objective:** the Content Studio. Content made to each screen's exact size: templates for designers, quick layouts to pitch ideas, stage mockups, and later generated media. Everything plays in the shared Motion Lab preview.

**Start:**
```sh
cd ~/Play.Code/playground.pixel/agents/content-engineering && claude "Eres el agente Content Engineering. Tu brief es docs/agents/content-engineering.md. Sigue docs/agents/START.md."
```

Worktree `~/Play.Code/playground.pixel/agents/content-engineering`, branch `feature/content-engineering`, dev port 3102.

Read first:
1. [README](README.md), especially file ownership.
2. [CONTRACTS](../architecture/CONTRACTS.md): the rendering and export contracts.
3. [OVERVIEW, Motion Lab](../architecture/OVERVIEW.md#motion-lab).
4. [MODULES section 4](../product/MODULES.md#4-candidate-functional-modules): content templates, mockups, video generation.

## What you build on today

**Every pixel position already exists.** Read it; never recompute it. `resolveMapping(project)` gives, per screen:
- `masterRect`, where its content sits in the master canvas, in pixels;
- `canvasRect`, its position in its canvas;
- `outputRect`, where it sits in its processor output.

`mapping.master` holds the master size. Festival Main Stage has a 5120 × 1664 master and screens from 512 × 256 up to a 4608 × 128 ribbon.

**Pixel-map scenes.** `exports/scene.ts` builds a renderer-neutral scene (rects, lines, text, in exact pixels), and `renderSvg` and `renderPng` draw it. `masterScene`, `outputScene` and `screenScene` already exist. A template is mostly a new scene builder.

**The preview engine.** Motion Lab draws a `FrameSource` once over the whole master canvas, then cuts it into screens. Patterns are pure: `renderPattern(id, input)` returns primitives, and `preview/draw-pattern.ts` draws them. Your layouts follow the same split: a pure description in `src/engines/content/`, and drawing in `src/modules/content/`.

## Tasks

| Id | Task | State | Depends on |
| --- | --- | --- | --- |
| C1 | Content templates per screen, canvas and output | ✅ Ready | — |
| C2 | Content layouts as a `FrameSource`: color, text, image, logo, Motion Lab pattern | ⏸ | L1, user approval |
| C3 | Saved content layouts | ⏸ | L2, C2 |
| C4 | Stage mockup still, in the Physical view | ⏸ | C2 |
| C5 | Video generation adapter, as a design note | ⏸ | User decision on keys versus a backend |
| C6 | [Wall Build](../product/MODULES.md#wall-build) V1 | Built, draft PR. Merges after Alpha 0.1 | Alpha 0.1 physical tests |

### C1 Content templates

A Phase 1 deliverable, already approved.

- **What:** per screen, per canvas and per output, a PNG and SVG at the exact pixel size, showing the name, resolution, cabinet grid, safe areas and seams. A designer drops content onto it.
- **Where:** pure scene builders in `src/exports/templates/`, exposed as `ExportEntry` values (see CONTRACTS). One entry builds every template for the chosen scope.
- **Batch download:** several files are zipped by the caller. `zipPackage` in `exports/resolume/package.ts` already does it. Output Engineering owns that file, so reuse it without editing.
- **Menu:** until L1 lands, add nothing to the Export menu. Test your entries directly. Wiring them in is one line once the registry exists.
- **Tests** in `tests/content-templates.test.ts`:
  - every template's size equals the screen, canvas or output size from the mapping;
  - the cabinet grid lines fall on exact cabinet boundaries;
  - names are unique, and the same input gives the same bytes.
- **No invented formats.** PNG and SVG only. No PSD.

### C2 Content layouts

After approval. Layouts are pure lists of primitives, like patterns: color fields, text, images, logos, or a Motion Lab pattern.
- **Default:** drawn once on the master canvas and sliced through the mapping, so content flows across screens. Fitting content per screen is an option.
- **Media:** images are decoded before playback, never inside `draw`.
- **Project data:** layouts aren't saved until L2. Keep them in a module store until then.

### C5 Video generation

Write `docs/integrations/video-generation.md` first. Cover:
- a provider-neutral adapter: request, poll, result;
- sizes: generate at the master or canvas aspect, then crop, scale and slice. State any upscaling. Extreme ratios such as 36:1 need tiling;
- the decisions for the user: their own key stored locally, or a backend before Phase 5; provider; cost per generation; content rights; media storage limits.

No network code until the user decides.

## Rules for this lane

- **Pure first.** Layout descriptions, template scenes and slicing are pure and tested. Canvas, images and network stay in `src/modules/content/`.
- **Determinism.** The same frame draws the same pixels.
- **Exact sizes.** A template that is one pixel off is a bug on a wall. Test sizes against the mapping.
- **Bundle.** Content Studio loads on first use. Record its chunk size in PERFORMANCE.
- **No new dependencies** without the user's approval.

## Status

**2026-11-23, C6 Wall Build V1: built, on a draft PR.** It merges only after Alpha 0.1 passes its physical tests.
- **Character:** Pitch (working name), approved by the owner in this session after two fixes, contrast and a clear face while carrying overhead. Original art, described as data in `src/engines/content/wall-build/character.ts`.
- **Engine:** `src/engines/content/wall-build/`. `plan.ts` schedules every cabinet from `ResolvedMapping`; `frame.ts` turns a tick into flat operations; time is whole ticks (600 a second), so every content FPS gives the same moment.
- **Module:** `src/modules/content/` has the source, store, controls and painting. The engine and controls load on first use. Settings aren't saved.
- **Registration:** four small edits outside this lane, reviewed by the Lead Architect: `modules/registry.ts`, `modules/catalog.ts`, `components/workspace/canvas-header.tsx`, and `modules/output/studio-panel.tsx` (Output Engineering), which now lists only sources it can export.
- **Low walls** (one or two rows, fixed after the owner's demo): the worker is the largest that stays whole inside the wall in every pose it uses there, measured from its own shapes (`fit.ts`). Festival Main Stage: Ribbon 120 px, DJ Booth 192 px. Where there's no room beside the cabinet, it comes down from above and the worker guides it in. Below 8 px a wall builds without workers. Other walls draw exactly as before.
- **Not exportable:** a test keeps `wall-build` out of `OUTPUT_SOURCE_IDS`.
- **Tests:** `tests/content-wall-build.test.ts` and `tests/content-wall-build-character.test.ts`, 102 tests. Measurements are in [PERFORMANCE](../development/PERFORMANCE.md#wall-build-live-preview-source-c6).
- **Found, not fixed:** the Aurora settings panel is cut off by the Live preview header, which scrolls sideways (`overflow-x-auto`). Wall Build's panel is fixed to the window, so it isn't affected.

**2026-11-08, Sprint 1: Aurora Gradient, merged in PR #9** (approved by the user in this session; not one of C1–C5).
- A new Motion Lab pattern, "Aurora Gradient", in the Live preview pattern selector. Pure engine in `src/engines/content/aurora.ts`: deterministic by frame number, defined once over the master canvas, loops exactly every 20 s ÷ flow speed.
- Settings: palette presets plus three editable colors, flow speed (0.25× to 4×) and eight directions. Module state in `src/modules/content/aurora-store.ts`, not saved (waits for L2). Controls in `src/modules/content/aurora-controls.tsx`, a compact button in the header that opens the settings.
- Tests: `tests/content-aurora.test.ts`, 23 tests for determinism, loop closure, FPS independence, settings, and continuity across every Festival Main Stage seam.
- Small edits in Lead Architect files, listed in the PR: `domain/motion.ts`, `engines/motion/patterns.ts`, `preview/live-renderer.ts`, `components/motion/live-preview.tsx`, `components/workspace/canvas-header.tsx`.
- C1 not started yet.
