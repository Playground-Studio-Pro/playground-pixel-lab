# Architecture Overview

A client-side Next.js application with no backend. Stored data is described in [DATA_MODEL](DATA_MODEL.md), and the reasons behind choices in [DECISIONS](DECISIONS.md).

## Layers

Dependencies point downward only.

```
src/app, components/workspace   UI: explorer, Konva canvas, inspector, dialogs
                │
             state/             Zustand store, view model, user actions
                │
   ┌────────────┼────────────┐
exports/   persistence/    engines/      pure, deterministic calculation
   └────────────┼────────────┘
             domain/            types, units, generic cabinet profiles
```

One exception: `exports/resolume/package.ts` imports `serializeProject` from `persistence/schema.ts`, to include the project file in the package.

| Path | Role |
| --- | --- |
| `domain/` | Model types, units, generic cabinets |
| `engines/mapping.ts` | Resolves the three layouts into final coordinates: the single source of truth for every view and export |
| `engines/validation.ts` | Issues with severity, code, exact message and screen ids |
| `engines/project-ops.ts` | Every project edit, as a pure function |
| `engines/physical.ts`, `geometry.ts`, `snap.ts`, `align.ts`, `viewport.ts` | Supporting pure calculation |
| `exports/scene.ts` | Renderer-neutral pixel map. SVG and PNG draw the same scene |
| `exports/resolume/` | Resolume adapter, guide, CSV, package builder |
| `persistence/` | Repository contract, IndexedDB adapter, schema, file format |
| `state/store.ts` | App state, derived mapping and validation, autosave |
| `state/view-model.ts` | Projects the mapping into one workspace view |
| `components/workspace/` | App shell, canvas, panels, dialogs |
| `components/ui/` | Generated shadcn/ui components (Base UI) |

## Assessment

Reviewed 2026-11-07.

| Concern | Separation | Evidence and gaps |
| --- | --- | --- |
| Domain models | ✅ Strong | `domain/` imports nothing else in the app |
| Geometry | ✅ Strong | Pure `engines/geometry.ts`, `snap.ts`, `align.ts`, `viewport.ts`; no framework imports |
| Mapping | ✅ Strong | Pure `resolveMapping`, with 103 unit tests across the suite |
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
| Editor re-renders every screen node on each zoom, pan and drag frame: no `memo`, no culling ([measured](../development/PERFORMANCE.md#baseline)) | Medium at large shows | Phase 1 |
| No undo | High for production use | Phase 1, first |
| Everything loads in one 260 KB gzip chunk, including Konva on the start screen | Low | Phase 1 |
| PNG rendering runs on the main thread, with stalls up to about 750 ms | Low | When measured as a problem |
| No automated browser tests: the acceptance run is manual | Medium | Phase 1 |
| Migration path untested beyond version 1 | Low until the first schema change | At first schema change |
| Library cabinets can't be edited or removed outside a project | Low | Phase 1 |

### Minor cleanups

Harmless, so left in place. Fix when touching the file.

- Color shading is implemented twice: `shade` in `exports/scene.ts`, `darker` in `workspace-canvas.tsx`.
- `project-ops.ts` calls `resolveMapping` inside eight operations, and re-exports `computeScreenSpec` without using the export.
- Unused: `components/ui/badge.tsx`, `components/ui/separator.tsx`, and the scaffold's SVG files in `public/`.
- `next-themes` is only used by `ui/sonner.tsx`, whose theme is always overridden to dark.

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

## Motion Lab readiness

Design only. Nothing is implemented, and [Phase 2](../product/ROADMAP.md#phase-2-motion-lab) needs approval to start.

### Three separate metrics

These must stay separate types, labels and fields. None can be derived from another.

| Metric | Meaning | Source | Name in code |
| --- | --- | --- | --- |
| Content FPS | Frames per second the content is designed to play at | User setting, part of the pattern | `contentFps` |
| Browser preview FPS | How fast this browser is drawing the preview right now | Measured with `requestAnimationFrame` | `previewFpsMeasured` |
| LED refresh rate | How often the physical panel refreshes | Supplier data sheet, from [Phase 4](../product/ROADMAP.md#phase-4-production-engineering) | `ledRefreshHz` |

Browser FPS describes this computer, and tells you nothing about the wall. The UI must never present it as hardware refresh rate.

### Proposed structure

```
domain/motion.ts         Pattern definitions: type, parameters, contentFps
engines/motion/          frameAt(timeMs, contentFps), and a pure pattern description for frame N
exports/  or preview/    Draws that description to a 2D canvas
components/motion/       Controls and preview. Reads the measured FPS through a ref
```

| Principle | Reason |
| --- | --- |
| Frame number is the only input to content. `frame = floor(timeMs × contentFps / 1000)` | Deterministic: the same frame always gives the same pixels, whether the browser runs slow or fast |
| Patterns draw in master canvas coordinates | Content flows across screens by construction, using each screen's existing `masterRect` |
| Each screen reads a region of one shared image | Intentional overlap needs nothing new: regions with `allowOverlap` read the same pixels |
| Reuses `resolveMapping`, unchanged | No second source of coordinates |
| Output space reuses `outputRect` | The same frame can preview as content or as output |
| Preview draws to its own plain `<canvas>`, outside Konva and React state | One draw per frame without React work. Konva stays the editor |
| Measured FPS writes to a ref and updates text a few times a second | Measuring must not change what it measures |

### Pattern coverage

| Requirement | Approach |
| --- | --- |
| Moving grids, scans | Pure function of frame and canvas bounds |
| Frame counters | Text per screen at its region, from the frame number |
| Color cycling | Hue from frame number, in integer steps |
| Multi-screen flow | Master coordinates, as above |
| Overlapping regions | Shared image, as above |
| Target FPS | `contentFps` holds a frame until its time arrives, regardless of the display rate |

### Rendering technology

Start with Canvas 2D, which is already proven here: it draws a 134-megapixel map in under 3 s ([measured](../development/PERFORMANCE.md#baseline)). Measure first. If a preview can't hold its budget, try in order: scaling the preview canvas down, `OffscreenCanvas` in a worker, then raw WebGL for the slowest patterns. Three.js solves 3D scenes, which this doesn't need, so it stays out unless a measured requirement justifies it.

### Changes needed first

No restructuring is required. Before Phase 2, separate the gesture and drawing code in `workspace-canvas.tsx`, as that also serves Phase 1's rendering work.
