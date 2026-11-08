# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-07.

## Status

**Phase 2: Motion Lab V1 is complete**, merged to `main` through PR #4. It was built ahead of the rest of Phase 1 as the product priority. Undo and redo are on `main`, and Phase 0 is complete. No new feature is in progress.

## Location

The repository is at `~/Play.Code/playground.pixel`, outside iCloud Drive. The previous copy at `~/Documents/Play.Code/playground.pixel` is not the working copy, so don't develop there.

## Last completed work

**Motion Lab V1.** A Live preview mode next to Mapping:
- Six deterministic patterns, drawn across the mapped screens on the Physical, Content and Output views.
- Playback toolbar, measured preview rate, and late and skipped frames.
- Overlap marks that never block the preview.
- Labels that never draw over each other. They move aside, or are dropped when there's no room. Checked in Chrome on Festival Main Stage at 8% to 38% zoom on every view.

**Festival Main Stage example.** A realistic six-screen show kept for reuse:
- File: `examples/festival-main-stage.pixellab.json`. Import it with "Import project file" in the project menu.
- Builder: `festivalMainStage()` in `tests/helpers.ts`.
- `tests/festival.test.ts` keeps the file and the builder in sync. See [TESTING](docs/development/TESTING.md#unit-tests).

Design in [OVERVIEW](docs/architecture/OVERVIEW.md#motion-lab), decisions in [DECISIONS](docs/architecture/DECISIONS.md).

## Active workstream

None. Waiting for the next product decision below.

## Known issues

- **Motion Lab:**
  - Venue-laptop performance is unmeasured. All numbers come from the reference machine.
  - The off-screen image is capped at 4096 px a side, so masters larger than that are upscaled in the preview when zoomed in close. Exports are unaffected.
  - Pausing while the tab is hidden is implemented but wasn't verified in the browser, because the test tab never became hidden.
  - Patterns have no parameters yet: speed, colors, cell size and text are fixed.
  - There's no full-screen or second-display output for showing the preview on a real wall.
  - Where labels don't fit, they're dropped. On Festival Main Stage, the Physical view at fit zoom shows the shared band's label on the Header only, not on the Center Wall's strip. A screen's labels sit at its top edge, so they scroll out of view with it when zoomed in close.
- **Undo history:** not stored across reloads. Library cabinet saves aren't undone. Each arrow step in an inspector field is its own undo step.
- The delete confirmation says "Undo with ⌘Z" on every platform.
- The Resolume guide hasn't been followed in real Resolume. Native presets are unverified and not generated. See [RESOLUME](docs/integrations/RESOLUME.md).
- In this test environment, zooming 100 screens in the editor runs at about 50 ms p95, against 18 ms in the original baseline. That's the same before and after Motion Lab, so it isn't a regression, but it's unexplained. See [PERFORMANCE](docs/development/PERFORMANCE.md#motion-lab).
- The app can't load offline without being served. See [technical debt](docs/architecture/OVERVIEW.md#technical-debt).
- `npm audit` reports 13 findings in dev tooling. Production dependencies report 0.

## Pending decisions

1. **Next Motion Lab step.** Recommended: full-screen output of the preview to a second display, so a pattern can be played on a real wall through the processor.
2. **Resolume:** the first real-world check in Arena, and saved Arena presets for analysis. Both need access to Arena.
3. Order of the remaining Phase 1 work: venue performance, offline loading, rotation, cabinet library, content templates.
4. Branch protection on `main`, and whether to add automated browser tests.

## Next recommended action

Run the [first real-world check](docs/integrations/RESOLUME.md#first-real-world-check) in Arena with Festival Main Stage or the Motion Lab acceptance project, playing Content Flow on the wall to confirm continuity end to end. Then choose the next Motion Lab step.

## Latest test results

On `feat/motion-lab` before merge, 2026-11-07:

| Check | Result |
| --- | --- |
| Typecheck, ESLint, production build | Pass |
| Unit tests | 163 of 163 pass: 35 for Motion Lab, 4 for label layout, 3 for the example |
| Bundle | Initial JS 172.8 KB, unchanged. Loaded with a project 264.2 KB. Motion Lab chunk 7.5 KB, on first use only. All within budget |
| Motion Lab acceptance in Chrome, production build | Pass. See the [manual run](docs/development/TESTING.md#manual-acceptance-run) |
| Labels in Chrome, Festival Main Stage | No overlapping labels on Physical, Content and Output, at 8%, 13%, 20%, fit and 38% zoom |
| Preview performance | 60 fps through 500 screens, with no late or skipped frames. The label layout is cached, and was measured A/B against the previous build. See [PERFORMANCE](docs/development/PERFORMANCE.md#motion-lab) |

## Git

- **Stable:** `main`. Run `git log -1` for its latest commit, since a file can't contain the hash of its own commit.
- **Remote:** `origin`, [Playground-Studio-Pro/playground-pixel-lab](https://github.com/Playground-Studio-Pro/playground-pixel-lab), private.
