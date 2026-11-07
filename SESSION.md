# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-07.

## Status

**Phase 0: Foundation, in review.** MVP is on `main`. Foundation work is in [pull request #1](https://github.com/Playground-Studio-Pro/playground-pixel-lab/pull/1), waiting for merge.

## Last completed work

Repository audit, baseline commit, private GitHub repository, CI, documentation system, architecture review with Motion Lab plan, performance baseline and design direction. See [CHANGELOG](CHANGELOG.md).

## Active workstream

Merging Phase 0.

## Known issues

- **The repository is inside iCloud-synced `~/Documents`**, which is creating duplicate files in `.next` and `node_modules` and using CPU. Git data and tracked files are intact (`git fsck` clean). See [environment](docs/development/TESTING.md#environment).
- The Resolume guide hasn't been followed in real Resolume. Native presets are unverified and not generated. See [RESOLUME](docs/integrations/RESOLUME.md).
- Performance has only been measured on a fast machine. [Under load](docs/development/PERFORMANCE.md#measurements-under-system-load), costs were up to five times higher. Venue-class hardware is untested.
- No undo. The app can't load offline without being served. See [technical debt](docs/architecture/OVERVIEW.md#technical-debt).
- `npm audit` reports 13 findings in dev tooling. Production dependencies report 0.

## Pending decisions

1. Merge PR #1.
2. Move the repository out of iCloud-synced `~/Documents`. Recommended.
3. Branch protection on `main`. Not configured; GitHub may require a paid plan for it on private repositories.
4. Whether to add automated browser tests in Phase 1.
5. Approve Phase 1 to begin.

## Next recommended action

After merging: follow the [first real-world check](docs/integrations/RESOLUME.md#first-real-world-check) in Arena, then start [Phase 1](docs/product/ROADMAP.md#phase-1-mapping-studio) with undo and redo (`feat/undo-redo`).

## Latest test results

From a fresh clone with `npm ci`, on 2026-11-07:

| Check | Result |
| --- | --- |
| Typecheck, ESLint, production build | Pass |
| Unit tests | 103 of 103 pass |
| Bundle budgets | Pass: 172.8 KB initial, 260.3 KB app chunk (gzip) |
| Production dependency audit | 0 findings |
| GitHub Actions on Node 24 | Pass on the PR |
| [Manual acceptance run](docs/development/TESTING.md#manual-acceptance-run), Chrome 156 | Pass, excluding the custom-cabinet return flow and project duplicate, last checked before Phase 0 with no code change since |

## Git

- **Stable:** `main` at `c17be93`, the MVP baseline.
- **Active:** `chore/foundation`. Run `git log -1` for its latest commit, since a file can't contain the hash of its own commit.
- **Remote:** `origin`, [Playground-Studio-Pro/playground-pixel-lab](https://github.com/Playground-Studio-Pro/playground-pixel-lab), private.
