# Core Lane Brief

**Objective:** keep mapping exact and the core sound, and build the foundations the other lanes need: examples, content templates, the module contract and full-screen output.

Read first:
1. [README](README.md).
2. [SESSION](../../SESSION.md).
3. [OVERVIEW](../architecture/OVERVIEW.md).

## How the core works today

**Engines.**
- `resolveMapping` is the single source of coordinates.
- `validateProject` returns issues with codes.
- `project-ops.ts` holds every edit as a pure function.
- They're covered by 163 unit tests.

**Store.**
- `state/store.ts` holds the project, the derived mapping and validation, autosave with revision checks, and undo and redo (200 steps, in memory).
- Every edit goes through `edit()`.

**Persistence.**
- IndexedDB, behind the `ProjectRepository` contract.
- Files are validated by `persistence/schema.ts`.

**Motion Lab.**
- **Modules:** pure clock, patterns, regions and metrics in `engines/motion/`.
- **Drawing:** Canvas 2D in `preview/`.
- **State:** a separate store, loaded on first use.
- **Labels:** the label layout is cached between frames.

**Examples.**
- The example gallery is in `src/examples/`. It has pure builders, a plain-data catalog shown on the start screen, and builders loaded on first use. `tests/examples.test.ts` checks each entry against its builder.
- Festival Main Stage is also kept as a file in `examples/`, in sync with its builder.
- `motionLabProject()` is the three-screen acceptance project.
- Perf fixtures come from `npm run perf:engines`. They're gitignored.

## Planned work, in order

1. **Example gallery.** The start screen gets "Open an example": Festival Main Stage, Motion Lab acceptance, and more real show shapes.
   - Each example is fetched on first use and imported as a new copy.
   - Each has a builder and a sync test.
2. **Content templates.** Exact-size files per screen, canvas or output, with name, resolution, cabinet grid and seams.
   - Built on `exports/scene.ts`.
   - This is a Phase 1 deliverable.
3. <a id="module-contract"></a>**Module contract.**
   - A static registry and slots for the canvas mode, toolbar, inspector and exports, as sketched in [MODULES section 3](../product/MODULES.md#3-module-contract).
   - Motion Lab is extracted into it first, with no behaviour change, measured before and after.
   - This removes most collisions in shared shell files.
4. **Project data for modules.** A versioned `modules[id]` section, with a schema bump and migration, when the first module needs it.
5. **Full-screen output.** The live preview on a second display, at an output's exact size. This is the next Motion Lab step and the basis for the NDI test.

## Status

- **Item 1, example gallery:** done on `feat/example-gallery`. It has four examples. Adding one means a builder in `src/examples/`, a catalog entry and a `case` in `buildExample`; the test picks it up automatically.
- **Items 2 to 5:** not started. Content templates are next.
