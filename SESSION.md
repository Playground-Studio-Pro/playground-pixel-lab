# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-08.

## Objective

Parallel development with five agents, each in its own worktree. The product is organized as four studios (Mapping, Content, Engineering, Output) sharing Motion Lab as the preview engine. Setup is in [docs/agents](docs/agents/README.md), and the shared contracts are in [CONTRACTS](docs/architecture/CONTRACTS.md).

## Verified current state

- **Integration checkout:** `~/Play.Code/playground.pixel`, on `main`. Merges and final checks happen here. `~/Documents/Play.Code/playground.pixel` is an old copy, so don't develop there.
- **Pull requests:** these merge in order, each with the user's approval:
  - #5, agent briefs and the module proposal;
  - #6, example gallery;
  - #7, contracts and agent lanes.
- **Agent worktrees:** in `~/Play.Code/pixel-lab-agents/`, all created from the same `main` commit, the merge of #7. Each has its own `feature/<lane>` branch:

  | Worktree | Branch | Port |
  | --- | --- | --- |
  | `lead-architect` | `feature/lead-architect` | 3100 |
  | `product-design` | `feature/product-design` | 3101 |
  | `content-engineering` | `feature/content-engineering` | 3102 |
  | `led-engineering` | `feature/led-engineering` | 3103 |
  | `output-engineering` | `feature/output-engineering` | 3104 |

- **Shared contracts:** module, rendering and export contracts, types only, in `src/modules/contract.ts`, `src/preview/contract.ts` and `src/exports/contract.ts`. `tests/contracts.test.ts` shows today's code fits them.
- **Shipped:** Phase 0, undo and redo, Motion Lab V1, the example gallery. Phase 1 is partly done.
- **Examples:** Festival Main Stage, Corporate Keynote, Motion Lab acceptance and a 500-screen stress test, on the start screen. Festival Main Stage is also kept as `examples/festival-main-stage.pixellab.json`.
- **Browser data:** each origin and port has its own projects. On `localhost:3000`:
  - "Pantalla 5.5 × 3 m MG6S P2.6": 11 × 6 Yestech MG6S P2.6, 2112 × 1152 px;
  - two copies of `perf-500`, a perf fixture that can be deleted.

## Last test results

On `docs/agent-lanes`, 2026-11-08:

| Check | Result |
| --- | --- |
| Typecheck, lint, build | Pass |
| Unit tests | 171 of 171 pass, including 3 contract tests |
| App behaviour | Unchanged: the contracts are types only |

## Important decisions

- **Studios and lanes:** four studios, five agent lanes, with file ownership and task dependencies in [docs/agents](docs/agents/README.md).
- **Contracts:** types only, no plugin framework. The Lead Architect owns them, and a contract change merges alone first.
- **Branches:** lane branches are long-lived `feature/<lane>`. They merge `main` in, and never rebase or force-push. The Lead Architect merges PRs, with CI passing and the user's approval.
- **Status:** only the Lead Architect writes this file. Lanes report in their brief's Status section.
- **Proposals:** [MODULES](docs/product/MODULES.md) is a proposal. Video encoding, NDI, Phase 4 calculations and anything needing a backend wait for approval.
- **Preferences:** user preferences and themes never enter the project file. Exports look the same under every theme.

## Important files

- `docs/agents/README.md`: lanes, ownership, dependencies, start commands.
- `docs/agents/START.md`: the opening checklist every agent follows.
- `docs/architecture/CONTRACTS.md`: studios and contracts.
- `docs/product/ROADMAP.md`: phases, and which studio carries each.

## Do not

- Don't start a ⏸ task before its dependency lands or the user approves it.
- Don't commit straight to `main`, force-push, rebase pushed branches, or make the repository public.
- Don't develop in `~/Documents/Play.Code` or delete it.
- Don't add dependencies without the user's approval, a measured bundle cost and a DECISIONS record.
- Don't overwrite or remove an existing worktree.

## Known issues

- **Motion Lab:**
  - Venue-laptop performance is unmeasured.
  - The preview image is capped at 4096 px a side.
  - There's no full-screen output.
  - Labels that don't fit are dropped.
- **Undo:** not kept across reloads.
- **Resolume:** the guide is untested in real Arena.
- **Offline:** the app can't load offline without being served.
- **Audit:** `npm audit` reports 13 findings in dev tooling and 0 in production dependencies.

## Pending decisions

Each unblocks ⏸ tasks in the briefs:
1. **Full-screen output to a second display (O2).** Recommended next, because it unblocks the NDI test (O3).
2. **Content layouts in the preview (C2), and stage mockups (C4).**
3. **Phase 4 start, for power, weight and port calculations (E2).**
4. **Lifting the video-encoding exclusion and adding an MP4 muxer (O4).**
5. **NDI route (O5)** and **video generation keys versus a backend (C5).**
6. **Customization direction:** light theme or not, and workspace presets.
7. **Resolume real-world check,** which needs Arena.

## Next action

Start the six ✅ tasks in parallel, one terminal per agent, with the commands in each brief:
- L1, the module registry and studio switch;
- D1–D3, the studio navigation spec, theme tokens and preferences store;
- C1, content templates;
- E1, the cabinet library;
- O1, exports on the shared contract.

The Lead Architect reviews and merges L1 first.

## Resume prompt

Read:
- CLAUDE.md
- SESSION.md
- docs/agents/README.md
- docs/architecture/CONTRACTS.md
- docs/agents/lead-architect.md

You are the Lead Architect. Continue from the verified current state, and execute the next action. Don't re-audit completed work unless the repository contradicts SESSION.md.
