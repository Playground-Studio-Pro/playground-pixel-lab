# Data Model

Authoritative types: [`src/domain/model.ts`](../../src/domain/model.ts) and [`units.ts`](../../src/domain/units.ts). Runtime validation: [`src/persistence/schema.ts`](../../src/persistence/schema.ts).

## Units and coordinate spaces

All coordinates have their origin top-left, with +x right and +y down.

| Space | Unit | Meaning |
| --- | --- | --- |
| `stage` | Integer µm | Physical stage plan. May be negative |
| `master` | Integer px | Master canvas, which is the Resolume composition |
| `canvas` | Integer px | Local to one content canvas |
| `output` | Integer px | Local to one video output |

`Px` and `Um` are branded integers. Their constructors throw rather than round. `PixelRect<S>` tags a rectangle with its space.

## Project

```
Project
├── schemaVersion, id
├── meta       name, client, venue, notes, createdAt, updatedAt, revision
├── cabinets[] id, name, widthUm, heightUm, pixelsX, pixelsY, nominalPitchUm, source
├── physical   PHYSICAL LAYOUT
│   ├── screens[] id, name, cabinetId, columns, rows, groupId, color, stageX, stageY
│   └── groups[]  id, name
├── content    CONTENT LAYOUT
│   ├── master    { mode: auto } or { mode: fixed, width, height }
│   ├── canvases[] id, name, originX, originY
│   └── regions[]  screenId, canvasId, x, y, allowOverlap
├── output     OUTPUT MAPPING
│   ├── outputs[] id, name, sizing (as master)
│   └── slices[]  screenId, outputId, followsContent, x, y
└── modules    { [moduleId]: { version, data } }   saved module data, from schema 2
```

**Module data.** Each module owns the format of its `data` and its own `version`. The project schema checks only the envelope; the module parses the rest, through `src/modules/module-data.ts`. Schema 1 projects upgrade on read with an empty `modules`.

## Derived values

Computed by `resolveMapping`, never stored.

| Value | Calculation |
| --- | --- |
| Screen pixels | Cabinet pixels × columns or rows |
| Screen physical size | Cabinet µm × columns or rows |
| Region size | Always the screen's pixels, so 1:1 |
| Master position | Canvas origin + region position |
| Output position | Master position if `followsContent`, otherwise the slice's x and y |
| Automatic master or output size | From (0, 0) to the furthest edge |
| Canvas bounds | Tight bounding box of its regions |

## Invariants

Checked by [`engines/project-ops.ts`](../../src/engines/project-ops.ts) on edits, and by `engines/validation.ts` on the whole project.

- Every screen has one region and one slice. Deleting a screen removes both, and any group left empty.
- A project keeps at least one canvas and one output.
- Regions may overlap only if both have `allowOverlap`. Slices on one output may never overlap.
- A cabinet in use, or a canvas or output with screens, can't be removed.
- Nominal pitch is reference only, and never determines resolution.
- A project holds its own copy of each cabinet, so editing the library can't change a saved show.

## Persistence

IndexedDB database `playground-pixel-lab`, version 1, with object stores `projects` and `cabinets`. `ProjectRepository` is the storage boundary:

| Behaviour | Detail |
| --- | --- |
| Atomic save with revision check | `save(project, expectedRevision)` raises a conflict rather than overwriting another tab's work |
| Autosave | 400 ms after the last edit, one save at a time. ⌘S saves at once |
| Unreadable records | Skipped in the list, never deleted |

Motion Lab settings and playback state are never stored, in the project or elsewhere.

## File format

Project files (`.pixellab.json`):

```json
{ "format": "playground-pixel-lab/project", "project": { } }
```

Importing always creates a new project. A file from a newer schema is refused with a clear message.

The mapping manifest (`format: "playground-pixel-lab/mapping-manifest"`, version 1) is built by [`exports/manifest.ts`](../../src/exports/manifest.ts). It's for downstream tools, with lengths in millimetres, and can't be reopened as a project.

## Changing the schema

1. Bump `SCHEMA_VERSION` in `domain/model.ts`.
2. Add an upgrade step to `migrate()` in `persistence/schema.ts`.
3. Add a test that loads a stored document from the previous version.
