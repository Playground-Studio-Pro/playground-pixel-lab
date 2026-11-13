# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-12, Sprint 3 foundation.

## Objective

**Sprint 3, Production Studio**, approved by the owner on 2026-11-12: Micro Environment Studio, calibration test card, processor intelligence, cabinet engineering and production exports. It supersedes the Sprint 2 list. Tasks, ownership, integration order, acceptance criteria and the four agent prompts are in [SPRINT_3](docs/agents/SPRINT_3.md).

## Where it stands

- **PR #12** (`feature/lead-architect`, draft, not merged) carries Depth Studio milestone 1 and the Sprint 3 foundation: studio switch, module registry and catalog, `project.modules` at schema 2 with migration, frame context, the engineering contract, and the Depth Studio scene as a Live preview source. The owner merges it first; the lanes start from it.
- **Depth Studio** now opens from the Content Studio. Content Engineering owns it from Sprint 3. Its settings still aren't saved: the module can now use `project.modules`.
- **Lanes:** none started. The owner starts each agent with its prompt in SPRINT_3.
- **The pack:** `CLAUDE_MASTER_PROMPT.md`, `START_HERE.md` and `docs/features/depth-studio/` sit untracked in `app/`, read there and not changed. The owner decides when they are committed.
- **Logo:** none in the repository. Candidates are in `~/Play.Code/brandplayground/assets/`; Output Engineering asks the owner which to use.

## Verified current state

- **Folder layout:** everything lives in `~/Play.Code/playground.pixel/`, which isn't itself a Git repository. Never develop in `~/Documents/Play.Code/playground.pixel`, an old copy.

  | Path | Branch | Port |
  | --- | --- | --- |
  | `app/`: main worktree, integration checkout | `main` | 3000 |
  | `agents/lead-architect` | `feature/lead-architect` | 3100 |
  | `agents/product-design` | `feature/product-design` | 3101 |
  | `agents/content-engineering` | `feature/content-engineering` | 3102 |
  | `agents/led-engineering` | `feature/led-engineering` | 3103 |
  | `agents/output-engineering` | `feature/output-engineering` | 3104 |

- **Baseline:** `main` is at `c81a17b`, the merge of PR #11. The four other agent worktrees are at that commit and clean. `feature/lead-architect` carries PR #12 on top of it.
- **Merged PRs:**
  - #1 Phase 0 foundation, #2 Phase 0 complete;
  - #3 undo and redo, #4 Motion Lab V1;
  - #5 agent briefs, #6 example gallery, #7 shared contracts and lanes, #8 folder layout;
  - #9 Aurora Gradient, #10 cabinet library.
- **Open PRs:** #12, draft, the Sprint 3 foundation.
- **Agents:** none running. All five are stopped.

## Completed features

- **Mapping Studio:** screens, cabinets, canvases and outputs mapped pixel-exact in Physical, Content and Output views. Exports: PNG and SVG pixel maps, manifest, technical report and Resolume preparation package. Undo and redo for every edit.
- **Motion Lab V1:** Live preview with seven deterministic patterns, separate content FPS and browser FPS, and overlap marks.
- **Aurora Gradient** (#9): a moving multi-color pattern with palette presets, three editable colors, flow speed and eight directions. It's continuous across screens, and the same frame always gives the same pixels. Settings aren't saved yet.
- **Cabinet library** (#10): profiles kept per browser, outside projects. Create, edit, duplicate, delete, and add to a project.
  - **Specs:** supplier, model and optional data-sheet values: power, weight, LED refresh rate, indoor or outdoor.
  - **Seed:** Yestech MG6S P2.6 Indoor.
  - **Older data:** custom cabinets saved earlier are copied in once.
- **Example gallery:** Festival Main Stage, Corporate Keynote, Motion Lab acceptance and a 500-screen stress test.
- **Parallel setup:** shared contracts, as types only, in [CONTRACTS](docs/architecture/CONTRACTS.md). Lanes, file ownership and dependencies in [docs/agents](docs/agents/README.md).

## Last validation

On `feature/lead-architect`, 2026-11-12, production build on port 3100, Chrome, M1 Max:

| Check | Result |
| --- | --- |
| Typecheck, lint, build | Pass |
| Unit tests | 264 of 264 pass, in 17 files |
| Bundle | Initial JavaScript 172.8 KB gzip, unchanged; within every budget (`npm run perf:bundle -- --check`) |
| Browser | Corporate Keynote: the studio switch opens Content (Depth Studio playing), Engineering and Output (empty states). In Mapping, Live preview plays the Depth Studio scene across the three screens at 60.0 fps, 0 late, 0 skipped. A project saved at schema 1 opened unchanged |
| Not tested | The test card placeholder in the browser; context loss; venue-laptop performance |

## Important decisions

- **Contracts:** types only, no plugin framework. The Lead Architect owns them, and a contract change merges alone first.
- **Branches:** each lane works on its long-lived `feature/<lane>` branch. It merges `main` in and never rebases or force-pushes. PRs merge with CI passing and the user's approval.
- **Library data:** library profiles live in their own IndexedDB database. A project keeps a plain copy, so editing the library never changes a saved project, and the project format is unchanged (`SCHEMA_VERSION` 1).
- **Module state:** Aurora settings are module state, not saved. Saving waits for the `modules[id]` project section (L2).
- **Proposals:** [MODULES](docs/product/MODULES.md) is a proposal. Video encoding, NDI, Phase 4 calculations and anything needing a backend wait for approval.

## Known issues

- **Dead code:** `useApp.library`, `saveToLibrary` and `IndexedDbCabinetLibrary` in `state/store.ts` and `persistence/indexeddb.ts` are no longer used by the UI. The Lead Architect removes them in a cleanup.
- **Aurora:**
  - Settings are lost on reload, until L2.
  - `AuroraControls` is imported statically by the canvas header, so it isn't lazy-loaded.
- **Library copies:** editing a library profile doesn't update projects that already copied it. This is intentional.
- **Motion Lab:**
  - Venue-laptop performance is unmeasured.
  - The preview image is capped at 4096 px a side.
  - There's no full-screen output.
- **Undo:** not kept across reloads.
- **Resolume:** the guide is untested in real Arena.
- **Offline:** the app can't load offline without being served.
- **Audit:** `npm audit` reports 13 findings in dev tooling and 0 in production dependencies.

## Pending tasks

All in [SPRINT_3](docs/agents/SPRINT_3.md): D8–D9, C6, E5–E6, O6–O10, then L6, the end-to-end demo and QA. Lead cleanup still to do: remove `useApp.library`, `saveToLibrary` and `IndexedDbCabinetLibrary`; move Motion Lab patterns onto `FrameSource`.

## Resume

1. **Check the baseline:** `cd ~/Play.Code/playground.pixel/app && git fetch && git status && git log --oneline -1`. Expect `main` at `ba4e5f4`, or the merge of the handoff PR.
2. **Run the app:** `npm run build && npx next start -p 3000`.
3. **Start agents** with the commands in [HANDOFF](HANDOFF.md#restart-each-agent). Each one runs `git merge origin/main` first, as [START](docs/agents/START.md) says.

## Resume prompt

Read:
- CLAUDE.md
- SESSION.md
- HANDOFF.md
- docs/agents/README.md
- docs/agents/lead-architect.md

You are the Lead Architect. Continue from the verified current state. Ask the user which Sprint 2 items to approve before starting them. Don't re-audit completed work unless the repository contradicts SESSION.md.
