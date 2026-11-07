# Playground Pixel Lab

LED mapping and visual production tool for audiovisual companies. Serves Playground Studio first, built to become a commercial SaaS later.

@AGENTS.md

**Start here:** [SESSION.md](SESSION.md) for current state, [ROADMAP](docs/product/ROADMAP.md) for scope, [OVERVIEW](docs/architecture/OVERVIEW.md) for structure.

## Product principles

1. Production-first. Every feature solves a real production problem.
2. Lightweight and fast. Minimal dependencies, no unnecessary abstractions.
3. Technically accurate. A wrong pixel is a bug on a physical wall.
4. Visually exceptional. See [DESIGN_SYSTEM](docs/product/DESIGN_SYSTEM.md).
5. Modular, offline-capable, and SaaS-ready without premature infrastructure.

## Engineering rules

**Accuracy**
- Pixels are integers (`Px`). Physical lengths are integer micrometres (`Um`). Never store float millimetres, and never round to hide an error.
- Resolution comes from cabinet pixels × count, never from pitch.
- Name the coordinate space (`master`, `canvas`, `output`, `stage`) of every position.
- Content FPS, browser preview FPS and physical LED refresh rate are different metrics. Never present browser FPS as hardware refresh rate.

**Architecture**
- `src/domain` and `src/engines` stay pure: no React, storage, clock, randomness or DOM. Ids and time are injected.
- Dependencies point inward, as in [OVERVIEW](docs/architecture/OVERVIEW.md). UI never computes mapping values itself.
- Everything entering from storage or files passes the schema in `src/persistence/schema.ts`.
- Changing the stored project shape means bumping `SCHEMA_VERSION` and adding a migration.
- Do not generate Resolume preset files until the conditions in [RESOLUME](docs/integrations/RESOLUME.md) are met. Do not invent file formats.

**Scope and dependencies**
- Do not expand scope without approval. Stay inside the current [ROADMAP](docs/product/ROADMAP.md) phase.
- A new dependency needs a stated reason and a measured bundle cost, recorded in [DECISIONS](docs/architecture/DECISIONS.md).
- No Three.js or heavy rendering library without a measured requirement.
- No broad refactors for aesthetics. Preserve working behaviour.

**Performance**
- Never claim a performance change without before and after measurements. See [PERFORMANCE](docs/development/PERFORMANCE.md).
- No per-frame React state for animation.

**Verification**
- Before reporting completion: `npm run typecheck && npm run lint && npm test && npm run build`.
- Mapping and export changes need unit tests. UI changes need a check in a real browser. See [TESTING](docs/development/TESTING.md).
- Report results as they are, including what was not tested.

## Git

- `main` is stable and always passes CI. Never force-push or rewrite its history.
- Work on a branch, then open a PR: `feat/`, `fix/`, `chore/`, `docs/`, `perf/`, `refactor/` + short kebab-case description (`feat/undo-redo`).
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, ...).
- Never commit `node_modules`, build output, secrets, local databases or perf output.
- The repository stays private.

## Documentation

Each fact lives in one document; others link to it. Update docs in the same PR as the change.

| Document | Holds |
| --- | --- |
| [SESSION.md](SESSION.md) | Current state only. Replace, don't accumulate |
| [CHANGELOG.md](CHANGELOG.md) | What changed, per release |
| [ROADMAP](docs/product/ROADMAP.md) / [REQUIREMENTS](docs/product/REQUIREMENTS.md) | Where we're going / what the product must do |
| [DESIGN_SYSTEM](docs/product/DESIGN_SYSTEM.md) | Visual direction and tokens |
| [OVERVIEW](docs/architecture/OVERVIEW.md) / [DATA_MODEL](docs/architecture/DATA_MODEL.md) / [DECISIONS](docs/architecture/DECISIONS.md) | Structure / stored data / why |
| [RESOLUME](docs/integrations/RESOLUME.md) | Resolume compatibility |
| [TESTING](docs/development/TESTING.md) / [PERFORMANCE](docs/development/PERFORMANCE.md) | How we verify / budgets and baselines |

Before clearing a long session, use `/handoff`.
