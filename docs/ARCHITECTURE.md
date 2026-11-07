# Architecture

## System Overview

A client-side Next.js application. Dependencies point inward: UI and adapters depend on engines, engines depend on the domain, and the domain depends on nothing.

```
components/workspace   UI: explorer, Konva canvas, inspector, dialogs
        │
state/                 Zustand store, view model, user actions
        │
   ┌────┴─────┬──────────────┐
exports/   persistence/    engines/      pure, deterministic calculation
   └────┬─────┴──────────────┘
domain/                types, units, generic cabinet profiles
```

## Three separate models

| Model | Answers | Unit and space | Stored in |
| --- | --- | --- | --- |
| Physical layout | What is on stage, and where? | Integer µm, `stage` | `project.physical` |
| Content layout | Which pixels does each screen show? | Integer px, `canvas` and `master` | `project.content` |
| Output mapping | Where do those pixels go in the video signal? | Integer px, `output` | `project.output` |

`engines/mapping.ts: resolveMapping(project)` combines them into final coordinates. Everything else (canvas, exports, validation) reads that result, so there is one source of truth.

- **Master canvas:** the Resolume composition. Automatic size extends from (0, 0) to the furthest region edge. It can be fixed instead.
- **Content canvas:** a named area with an origin on the master. Master position = canvas origin + region position. Several screens on one canvas share one continuous image; one screen on its own canvas is independent.
- **Region:** always the screen's exact resolution. It stores only a position, so its size can't go out of sync.
- **Slice:** follows the master position by default, and can be set manually per screen.
- **Intentional overlap:** two regions may show the same pixels only if both are marked. Output slices can never overlap on one output.

## Units

`domain/units.ts`. `Px` and `Um` are branded integers whose constructors throw instead of rounding. `PixelRect<S>` tags a rectangle with its coordinate space, so the compiler rejects mixing them. The origin is always top-left, with +x right and +y down. Resolution always comes from cabinet pixels × count, never from pitch.

## Components

| Path | Role |
| --- | --- |
| `domain/` | Model types, units, generic cabinet profiles |
| `engines/mapping.ts` | Resolves the three models into final coordinates |
| `engines/validation.ts` | Issues with severity, code, exact message and screen ids |
| `engines/physical.ts`, `geometry.ts`, `snap.ts`, `align.ts`, `viewport.ts` | Pure calculation |
| `engines/project-ops.ts` | Every project edit, as a pure function. Ids and time are injected |
| `exports/scene.ts` | Renderer-neutral pixel map. The SVG and PNG renderers draw the same scene |
| `exports/resolume/` | Resolume adapter, guide, CSV and package builder |
| `persistence/` | `ProjectRepository` contract, IndexedDB adapter, runtime schema, file format |
| `state/` | Store, per-view projection, user actions, export actions |

## Data

- `ProjectRepository` is async and revision-checked, so a cloud adapter can replace IndexedDB behind the same contract.
- Saves are atomic. A stale revision (another tab) raises a conflict rather than overwriting.
- All data entering from storage or files passes the zod schema. `schemaVersion` plus `migrate()` handle format changes.
- Cabinets are copied into a project when used, so editing the library never changes a saved show.

## Where future modules attach

Not implemented. Each is a new engine or adapter over the existing models, without changes to them.

| Module | Attaches to |
| --- | --- |
| Processor management, signal routing | `OutputMapping`, as a new `engines/` module |
| Electrical calculations | `CabinetProfile` plus a new pure engine |
| Motion Lab | `ResolvedCanvas` as the template source |
| Cloud collaboration | A new `ProjectRepository` adapter; `meta.revision` is ready for it |
| SaaS, billing | A workspace layer above the repository |

## External Dependencies

Next.js, React, Tailwind, shadcn/ui (Base UI), Konva, Zustand, zod, JSZip. No backend or external services.
