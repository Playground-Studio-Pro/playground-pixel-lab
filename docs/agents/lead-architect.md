# Lead Architect Brief

**Objective:** keep mapping exact and `main` green, own the shared contracts and Motion Lab, and integrate the other four lanes.

**Start:**
```sh
cd ~/Play.Code/playground.pixel/agents/lead-architect && claude "Eres el agente Lead Architect. Tu brief es docs/agents/lead-architect.md. Sigue docs/agents/START.md."
```

Worktree `~/Play.Code/playground.pixel/agents/lead-architect`, branch `feature/lead-architect`, dev port 3100. Merges and final checks happen in the integration checkout, `~/Play.Code/playground.pixel/app`, on `main`.

Read first: [README](README.md), [CONTRACTS](../architecture/CONTRACTS.md), [OVERVIEW](../architecture/OVERVIEW.md).

## What you own

**Mapping Studio:** the current editor, its engines and the store. **Motion Lab:** the shared preview engine. **Contracts:** the module, rendering and export types. **Integration:** reviews, merge order, `SESSION.md`, `ROADMAP.md` and `CHANGELOG.md`. The file list is in the [README](README.md#file-ownership).

## How the core works today

- **Engines.** `resolveMapping` is the single source of coordinates. `validateProject` returns issues with codes. `project-ops.ts` holds every edit as a pure function. 171 unit tests.
- **Store.** `state/store.ts` holds the project, the derived mapping and validation, autosave with revision checks, and undo and redo (200 steps, in memory). Every edit goes through `edit()`.
- **Persistence.** IndexedDB behind the `ProjectRepository` contract. Files are validated by `persistence/schema.ts`, at `SCHEMA_VERSION` 1.
- **Motion Lab.** Pure clock, patterns, regions and metrics in `engines/motion/`. Canvas 2D drawing in `preview/`. Its own store, loaded on first use, in a 7.5 KB chunk. It's wired into `canvas-header.tsx` and `canvas-area.tsx` by hand.
- **Examples.** The start-screen gallery in `src/examples/`, with a sync test per builder.

## Tasks

| Id | Task | State | Depends on |
| --- | --- | --- | --- |
| L0 | Shared contracts as types, with a fit test | Done | — |
| L1 | Module registry and studio switch | ✅ Ready | — |
| L2 | `modules[id]` project section, `SCHEMA_VERSION` 2 and migration | ⏸ | The first module that must save data: C3 or E3 |
| L3 | Integration: review and merge lane PRs, keep `main` green, update `SESSION.md` | Ongoing | — |
| L4 | Mapping Studio, Phase 1: screen rotation, offline loading, venue-laptop measurements | ⏸ | User's order of priority |

### L1 Module registry and studio switch

**Goal:** every studio can plug in without editing the shell, and Motion Lab behaves exactly as before.

1. Add `src/modules/registry.ts`: a static array of `PixelLabModule`, empty except Motion Lab.
2. Adapt Motion Lab patterns to `FrameSource`, as `tests/contracts.test.ts` shows. `LiveRenderer` draws any `FrameSource`.
3. Add the studio switch to the shell: Mapping, Content, Engineering, Output. Each non-mapping studio shows its registered panels, or a short empty state. Product Design designs it in D1. Build the minimal version with existing components, and leave the visual work to D4.
4. Let the Export menu read entries from the registry, alongside today's hard-coded ones. Output Engineering moves those entries over in O1.
5. **Measure before and after:** initial bundle, Motion Lab chunk, and 500-screen preview frame times, as in [PERFORMANCE](../development/PERFORMANCE.md#motion-lab). No regression is allowed.

**Done when:** behaviour is unchanged, all checks pass, the browser check covers Mapping and Live preview on Festival Main Stage, and the measurements are recorded.

### L2 Project data for modules

A versioned `modules: Record<id, { version: number; data: unknown }>` section, validated per module by a schema the module provides. It's added when the first module needs to save data, with a migration test from version 1 files, including `examples/festival-main-stage.pixellab.json`.

### L3 Integration

- **Review each PR against:** file ownership, purity, contracts, tests, measurements and scope.
- **Merging:** merge commits, never squash or rebase lane branches. Merge only with CI passing and the user's approval.
- **Contracts first:** a contract change merges alone, before work that uses it.
- **Status:** after each merge, update `SESSION.md` and tell the lanes to `git merge origin/main`.

## Status

- **L0:** done. The contracts are in `src/modules/contract.ts`, `src/preview/contract.ts` and `src/exports/contract.ts`, checked by `tests/contracts.test.ts`.
- **Example gallery** (formerly core item 1): done, in PR #6.
- **Sprint 1 integration:** PRs #9 and #10 merged, `main` at `ba4e5f4`. Cleanup to do: remove the unused `useApp.library`, `saveToLibrary` and `IndexedDbCabinetLibrary`.
- **L1:** not started.
