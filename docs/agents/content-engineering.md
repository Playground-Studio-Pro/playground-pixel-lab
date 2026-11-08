# Content Engineering Brief

**Objective:** the Content Studio. Content made to each screen's exact size: templates for designers, quick layouts to pitch ideas, stage mockups, and later generated media. Everything plays in the shared Motion Lab preview.

**Start:**
```sh
cd ~/Play.Code/pixel-lab-agents/content-engineering && claude "Eres el agente Content Engineering. Tu brief es docs/agents/content-engineering.md. Sigue docs/agents/START.md."
```

Worktree `~/Play.Code/pixel-lab-agents/content-engineering`, branch `feature/content-engineering`, dev port 3102.

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

Not started. Update this section in your PRs.
