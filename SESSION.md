# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-07.

## Status

**Phase 2: Motion Lab V1, in review** on `feat/motion-lab`. It was started ahead of the rest of Phase 1 as the product priority. Undo and redo are on `main`. Phase 0 is complete.

## Location

The repository is at `~/Play.Code/playground.pixel`, outside iCloud Drive. The previous copy at `~/Documents/Play.Code/playground.pixel` is not the working copy, so don't develop there.

## Last completed work

**Motion Lab V1.** A Live preview mode next to Mapping:
- Six deterministic patterns, drawn across the mapped screens on the Physical, Content and Output views.
- Playback toolbar, measured preview rate, and late and skipped frames.
- Overlap marks that never block the preview.

Design in [OVERVIEW](docs/architecture/OVERVIEW.md#motion-lab), decisions in [DECISIONS](docs/architecture/DECISIONS.md).

## Active workstream

`feat/motion-lab`: open the pull request, merge once CI passes.

## Known issues

- **Motion Lab:**
  - Venue-laptop performance is unmeasured. All numbers come from the reference machine.
  - The off-screen image is capped at 4096 px a side, so masters larger than that are upscaled in the preview when zoomed in close. Exports are unaffected.
  - Pausing while the tab is hidden is implemented but wasn't verified in the browser, because the test tab never became hidden.
  - Patterns have no parameters yet: speed, colors, cell size and text are fixed.
  - There's no full-screen or second-display output for showing the preview on a real wall.
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

Merge `feat/motion-lab`. Then run the [first real-world check](docs/integrations/RESOLUME.md#first-real-world-check) in Arena with the Motion Lab acceptance project, playing Content Flow on the wall to confirm continuity end to end.

## Latest test results

On `feat/motion-lab`, 2026-11-07:

| Check | Result |
| --- | --- |
| Typecheck, ESLint, production build | Pass |
| Unit tests | 156 of 156 pass, 35 new for Motion Lab |
| Bundle | Initial JS 172.8 KB unchanged. Loaded with a project 264.2 KB (+2.8). Motion Lab chunk 7.0 KB, on first use only. All within budget |
| Motion Lab acceptance in Chrome, production build | Pass: continuous content across three screens, clipping exact, shared pixels identical in both slices, all five rates and speeds, play, pause, restart, no mapping change across modes, exports and undo and redo working. See the [manual run](docs/development/TESTING.md#manual-acceptance-run) |
| Preview performance | 60 fps with no late or skipped frames through 500 screens, at 30 and 60 fps, and at 100% zoom |
| Editor before and after | No regression within noise. See [PERFORMANCE](docs/development/PERFORMANCE.md#motion-lab) |

## Git

- **Stable:** `main`. Run `git log -1` for its latest commit, since a file can't contain the hash of its own commit.
- **Active:** `feat/motion-lab`.
- **Remote:** `origin`, [Playground-Studio-Pro/playground-pixel-lab](https://github.com/Playground-Studio-Pro/playground-pixel-lab), private.
