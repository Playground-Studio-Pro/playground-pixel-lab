# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-07.

## Status

**Phase 1: Mapping Studio, in progress.** Undo and redo are done on `feat/undo-redo`, waiting for review and merge. Phase 0 is complete.

## Location

The repository is at `~/Play.Code/playground.pixel`, outside iCloud Drive. The previous copy at `~/Documents/Play.Code/playground.pixel` is not the working copy, so don't develop there.

## Last completed work

- **Undo and redo** for every project edit: ⌘Z and ⇧⌘Z (Ctrl+Z and Ctrl+Y elsewhere), plus toolbar buttons. Design and limits in [DECISIONS](docs/architecture/DECISIONS.md).
- **Two fixes from the Phase 0 acceptance run:**
  - The top bar no longer overlaps at 1280 px.
  - Add screen keeps what was typed after creating a cabinet from it.

## Active workstream

`feat/undo-redo`: open the pull request, then merge once CI passes.

## Known issues

- **Undo history:**
  - It isn't stored, so a reload or switching projects starts it empty.
  - Cabinets saved to the shared library aren't undone. Adding them to the project is.
  - Each arrow-key step in an inspector field is its own undo step. Arrow nudges on the canvas within a second merge into one.
- The delete confirmation says "Undo with ⌘Z" on every platform.
- The Resolume guide hasn't been followed in real Resolume. Native presets are unverified and not generated. See [RESOLUME](docs/integrations/RESOLUME.md).
- Performance has only been measured on a fast machine. [Under load](docs/development/PERFORMANCE.md#measurements-under-system-load), costs were up to five times higher. Venue-class hardware is untested.
- The app can't load offline without being served. See [technical debt](docs/architecture/OVERVIEW.md#technical-debt).
- `npm audit` reports 13 findings in dev tooling. Production dependencies report 0.

## Pending decisions

1. Branch protection on `main`. Not configured; GitHub may require a paid plan for it on private repositories.
2. Whether to add automated browser tests. Today's acceptance run is manual.
3. Order of the remaining Phase 1 work. Recommended next: the [first real-world check](docs/integrations/RESOLUME.md#first-real-world-check) in Resolume Arena, then venue-laptop performance and offline loading.

## Next recommended action

Merge `feat/undo-redo`. Then run the first real-world check in Resolume Arena, which decides the Resolume Bridge work, before the rest of [Phase 1](docs/product/ROADMAP.md#phase-1-mapping-studio). Motion Lab waits for Phase 1.

## Latest test results

On `feat/undo-redo`, 2026-11-07:

| Check | Result |
| --- | --- |
| Typecheck, ESLint, production build | Pass |
| Unit tests | 121 of 121 pass, including 18 new for undo and redo |
| Bundle budgets | Pass: initial 172.8 KB, app chunk 261.4 KB (gzip), +1.1 KB from undo and redo |
| Undo and redo in Chrome, production build | Pass: delete, drag, held arrow keys, columns, cabinet change, output mapping, pixel sharing, align. ⌘Z while typing in a field undoes only the text |
| Top bar | No overlap or overflow from 1200 to 1500 px, measured with "Unsaved changes" showing |
| Add screen after New cabinet | Name, columns and rows kept, new cabinet selected |

## Git

- **Stable:** `main`. Run `git log -1` for its latest commit, since a file can't contain the hash of its own commit.
- **Active:** `feat/undo-redo`.
- **Remote:** `origin`, [Playground-Studio-Pro/playground-pixel-lab](https://github.com/Playground-Studio-Pro/playground-pixel-lab), private.
