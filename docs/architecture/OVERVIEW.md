# Architecture Overview

A client-side Next.js application with no backend. Stored data is described in [DATA_MODEL](DATA_MODEL.md), and the reasons behind choices in [DECISIONS](DECISIONS.md).

## Layers

Dependencies point downward only.

```
src/app, components/   UI: explorer, Konva canvas, Motion Lab preview, inspector, dialogs
                │
       state/   preview/   Zustand stores, view model, user actions / Canvas 2D drawing for Motion Lab
                │
   ┌────────────┼────────────┐
exports/   persistence/    engines/      pure, deterministic calculation
   └────────────┼────────────┘
             domain/            types, units, generic cabinet profiles, Motion Lab settings
```

One exception: `exports/resolume/package.ts` imports `serializeProject` from `persistence/schema.ts`, to include the project file in the package.

| Path | Role |
| --- | --- |
| `domain/` | Model types, units, generic cabinets |
| `engines/mapping.ts` | Resolves the three layouts into final coordinates: the single source of truth for every view and export |
| `engines/validation.ts` | Issues with severity, code, exact message and screen ids |
| `engines/project-ops.ts` | Every project edit, as a pure function |
| `engines/physical.ts`, `geometry.ts`, `snap.ts`, `align.ts`, `viewport.ts` | Supporting pure calculation |
| `engines/motion/` | Motion Lab: playback clock, patterns, preview regions and overlaps, preview metrics. Pure |
| `examples/` | Example gallery: pure builders and a plain-data catalog. Builders load on first use |
| `modules/contract.ts`, `preview/contract.ts`, `exports/contract.ts` | Shared contracts for modules, rendering and exports. Types only. See [CONTRACTS](CONTRACTS.md) |
| `preview/` | Draws Motion Lab patterns and composites them into screens on a 2D canvas |
| `exports/scene.ts` | Renderer-neutral pixel map. SVG and PNG draw the same scene |
| `exports/resolume/` | Resolume adapter, guide, CSV, package builder |
| `persistence/` | Repository contract, IndexedDB adapter, schema, file format |
| `state/store.ts` | App state, derived mapping and validation, autosave, undo and redo |
| `state/history.ts` | Undo history as immutable project snapshots. Pure |
| `state/view-model.ts` | Projects the mapping into one workspace view |
| `state/motion-store.ts` | Motion Lab playback state. Never saved, undone or exported |
| `components/workspace/` | App shell, canvas header and Mapping canvas, panels, dialogs |
| `components/motion/` | Live preview, loaded on first use |
| `components/ui/` | Generated shadcn/ui components (Base UI) |

## Assessment

Reviewed 2026-11-07.

| Concern | Separation | Evidence and gaps |
| --- | --- | --- |
| Domain models | ✅ Strong | `domain/` imports nothing else in the app |
| Geometry | ✅ Strong | Pure `engines/geometry.ts`, `snap.ts`, `align.ts`, `viewport.ts`; no framework imports |
| Mapping | ✅ Strong | Pure `resolveMapping`, covered by the unit test suite |
| Rendering | ⚠️ Partial | Export rendering is cleanly split (scene, then SVG or PNG). Editor rendering isn't: `workspace-canvas.tsx` (488 lines) mixes drawing, gestures and viewport handling |
| Animation | ➖ None yet | No time concept exists. See below |
| Persistence | ✅ Strong | Repository contract with an IndexedDB adapter |
| Export adapters | ✅ Good | Pure builders, with the rasterizer injected. One import from `persistence` |
| UI state | ⚠️ Partial | Store holds both project state and workspace state. `view-model.ts` is well placed. Top bar reads store actions during render |

**Verdict:** the core (domain, engines, exports, persistence) is sound and needs no restructuring. The debt is in the UI layer and is small enough to fix when a feature needs it.

### Technical debt

| Item | Risk | Suggested time |
| --- | --- | --- |
| Offline: no service worker, so the page must be served even though all data is local | Medium: conflicts with the offline principle at a venue without internet | Phase 1 |
| Editor re-renders every screen node on each zoom, pan and drag frame: no `memo`, no culling. Smooth through 100 screens on the reference machine ([measured](../development/PERFORMANCE.md#rendering)), untested on venue hardware | Low to medium | When measured as a problem |
| Everything loads in one 260 KB gzip chunk, including Konva on the start screen | Low | Phase 1 |
| PNG rendering runs on the main thread, with stalls up to about 320 ms at the size limit | Low | When measured as a problem |
| No automated browser tests: the acceptance run is manual | Medium | Phase 1 |
| Migration path untested beyond version 1 | Low until the first schema change | At first schema change |
| Library cabinets can't be edited or removed outside a project | Low | Phase 1 |

### Minor cleanups

Harmless, so left in place. Fix when touching the file.

- Color shading is implemented twice: `shade` in `exports/scene.ts`, `darker` in `workspace-canvas.tsx`.
- `project-ops.ts` calls `resolveMapping` inside eight operations, and re-exports `computeScreenSpec` without using the export.
- Unused: `components/ui/badge.tsx`, `components/ui/separator.tsx`, and the scaffold's SVG files in `public/`.
- `next-themes` is only used by `ui/sonner.tsx`, whose theme is always overridden to dark.
- With keyboard focus on a toolbar menu trigger, Up and Down go to the menu instead of nudging the selection. Clicking the canvas clears it.

## Dependencies

Purpose and review. Sizes are in [PERFORMANCE](../development/PERFORMANCE.md#largest-dependencies).

| Package | Purpose | Review |
| --- | --- | --- |
| `next`, `react`, `react-dom` | Framework | Required |
| `konva`, `react-konva` | Editor canvas | Required. Largest app dependency |
| `@base-ui/react`, `class-variance-authority`, `cn`, `lucide-react`, `tw-animate-css` | shadcn/ui foundation | Required by the UI kit |
| `zustand` | State | Required, and small |
| `zod` | Validates stored data and files | Required. 106 KB raw, so a candidate to review if the bundle budget tightens |
| `jszip` | Resolume package | Required, and already lazy-loaded |
| `sonner` | Notifications | Required |
| `next-themes` | Pulled in by generated `sonner.tsx` | **Removable.** The app is always dark |
| `shadcn` (dev) | UI CLI, and its Tailwind CSS import | Moved to dev: it brought all production audit findings |
| `vitest`, `fake-indexeddb` (dev) | Tests | Required |
| `eslint*`, `typescript`, `tailwindcss`, `@tailwindcss/turbopack`, `@types/*` (dev) | Tooling | Required |

## Motion Lab

V1, built in [Phase 2](../product/ROADMAP.md#phase-2-motion-lab). The canvas has two modes: **Mapping**, the editor, and **Live preview**, animated test content clipped to each screen. Both use the same view (Physical, Content or Output) and the same zoom and pan.

### Three separate metrics

These stay separate types, labels and fields. None is derived from another.

| Metric | Meaning | Source | In code |
| --- | --- | --- | --- |
| Content FPS | Frames per second the content is designed to play at: 24, 25, 30, 50 or 60 | User setting | `ContentFps`, `fps` |
| Browser preview FPS | How fast this browser is drawing the preview right now | Measured from `requestAnimationFrame` intervals | `previewFps()` |
| LED refresh rate | How often the physical panel refreshes | Supplier data sheet, from [Phase 4](../product/ROADMAP.md#phase-4-production-engineering) | Not measured or shown |

Browser FPS describes this computer, and tells you nothing about the wall. The UI never presents it as hardware refresh rate.

### Structure

```
domain/motion.ts            Patterns, content rates, speeds
engines/motion/clock.ts     Play, pause, restart, speed; frameAt(contentMs, fps); timecode
engines/motion/patterns.ts  Pure description of each pattern at frame N, in master pixels
engines/motion/regions.ts   Source (masterRect) and destination (view rect) per screen; overlap marks
engines/motion/metrics.ts   Preview FPS, late browser frames, skipped content frames
preview/                    Draws a description to an off-screen master image, then into each screen
state/motion-store.ts       Playback state, apart from the project store
components/motion/          Live preview: canvas, animation loop, readouts
```

| Principle | How it's met |
| --- | --- |
| Frame number is the only input to content | `frame = floor(contentMs × fps / 1000)`. Speed changes content time, never the pattern |
| One source of coordinates | Sources are `masterRect` from `resolveMapping`. Destinations are the rectangles `buildViewModel` already gives each view |
| Content continues across screens | Patterns are drawn once over the whole master canvas, then cut into screens |
| Shared regions read identical pixels | Every screen samples the same master image for that frame |
| No React work per frame | The loop reads stores directly and writes readouts to the DOM. React only updates on play, pause and setting changes |
| Draw only when needed | A frame is drawn when the content frame changes or the scene does. Nothing runs while paused, hidden or in Mapping |
| Preview resolution follows need | The off-screen image has just enough pixels for the most magnified screen, up to full resolution and 4096 px a side |

### Preview and export validation

The preview shows every resolved screen, whatever validation says. Overlaps are marked, not blocked:

| Mark | Meaning | Comes from |
| --- | --- | --- |
| Violet, dashed | Content both screens mark as shared. Valid, and exportable | `REGION_SHARED` |
| Red | Content or output slices overlapping without permission. Blocks mapping exports | `REGION_OVERLAP`, `SLICE_OVERLAP` |
| Amber | Screens overlapping on the stage plan | `PHYSICAL_OVERLAP` |

Which overlaps are allowed is decided only by `validateProject`. Motion Lab reads its issues and finds where each one appears on screen, so it can't change a rule. Export gating is unchanged: exports still refuse projects with errors.

### Rendering technology

Canvas 2D, as planned: 60 fps through 500 screens and at 100% zoom on the reference machine ([measured](../development/PERFORMANCE.md#motion-lab)). Three.js and WebGL stay out without a measured need. If a slower machine can't hold its budget, try in order: a smaller off-screen image, `OffscreenCanvas` in a worker, then raw WebGL for the heaviest pattern.

### Canvas refactor

Resizing, first fit and wheel zoom and pan moved from `workspace-canvas.tsx` into `useCanvasViewport`, shared by both modes, with the wheel calculation as the pure `wheelViewport`. The Konva gesture and drawing code wasn't split: the preview draws to its own canvas and needs none of it.
