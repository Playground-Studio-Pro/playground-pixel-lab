# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-07.

## Status

**Phase 0: Foundation, complete.** Merged to `main` through [pull request #1](https://github.com/Playground-Studio-Pro/playground-pixel-lab/pull/1). Phase 1 hasn't started.

## Location

The repository is at `~/Play.Code/playground.pixel`, outside iCloud Drive. The previous copy at `~/Documents/Play.Code/playground.pixel` is not the working copy, so don't develop there.

## Last completed work

Moved the Play.Code workspace out of iCloud Drive and verified Pixel Lab with a clean install at the new location. Before that, Phase 0: repository audit, baseline commit, private GitHub repository, CI, documentation system, architecture review with Motion Lab plan, performance baseline and design direction. See [CHANGELOG](CHANGELOG.md).

## Active workstream

None. Waiting for approval to begin Phase 1.

## Known issues

- The Resolume guide hasn't been followed in real Resolume. Native presets are unverified and not generated. See [RESOLUME](docs/integrations/RESOLUME.md).
- Performance has only been measured on a fast machine. [Under load](docs/development/PERFORMANCE.md#measurements-under-system-load), costs were up to five times higher. Venue-class hardware is untested.
- No undo. The app can't load offline without being served. See [technical debt](docs/architecture/OVERVIEW.md#technical-debt).
- `npm audit` reports 13 findings in dev tooling. Production dependencies report 0.
- Minor UI issues found in the acceptance run:
  - At 1280 px wide, "Unsaved changes" pushes the toolbar so the master resolution overlaps the fit button.
  - A screen name typed in Add screen is lost after creating a new cabinet from that dialog.

## Pending decisions

1. Branch protection on `main`. Not configured; GitHub may require a paid plan for it on private repositories.
2. Whether to add automated browser tests in Phase 1.
3. Approve Phase 1 to begin.

## Next recommended action

Follow the [first real-world check](docs/integrations/RESOLUME.md#first-real-world-check) in Arena, then start [Phase 1](docs/product/ROADMAP.md#phase-1-mapping-studio) with undo and redo (`feat/undo-redo`).

## Latest test results

At `~/Play.Code/playground.pixel` after a clean `npm ci`, on 2026-11-07:

| Check | Result |
| --- | --- |
| Typecheck, ESLint, production build | Pass |
| Unit tests | 103 of 103 pass |
| GitHub Actions on `main` | Pass |
| [Manual acceptance run](docs/development/TESTING.md#manual-acceptance-run), production build in Chrome | All 9 steps pass, including the custom-cabinet return flow and project duplicate. Exports were checked in the page: PNG 2432 × 768 with exact border pixels, full zip contents, byte-identical project file after reload |

## Git

- **Stable:** `main`. Run `git log -1` for its latest commit, since a file can't contain the hash of its own commit.
- **Remote:** `origin`, [Playground-Studio-Pro/playground-pixel-lab](https://github.com/Playground-Studio-Pro/playground-pixel-lab), private.
