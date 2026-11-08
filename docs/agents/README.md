# Agent Guide

For every agent working on Pixel Lab. Maintained by the Lead Architect; last updated 2026-11-08.

Five agents work at the same time, each in its own Git worktree and branch. This page covers:
- how the app works today;
- who owns which files, and what depends on what;
- how to start an agent;
- the rules every change must pass.

The shared contracts are in [CONTRACTS](../architecture/CONTRACTS.md). Read them before writing code.

## Lanes

| Agent | Studio | Brief | Worktree | Branch | Dev port |
| --- | --- | --- | --- | --- | --- |
| Lead Architect | Mapping Studio, Motion Lab, contracts, integration | [lead-architect.md](lead-architect.md) | `~/Play.Code/pixel-lab-agents/lead-architect` | `feature/lead-architect` | 3100 |
| Product Design | Shell, studio navigation, customization | [product-design.md](product-design.md) | `~/Play.Code/pixel-lab-agents/product-design` | `feature/product-design` | 3101 |
| Content Engineering | Content Studio | [content-engineering.md](content-engineering.md) | `~/Play.Code/pixel-lab-agents/content-engineering` | `feature/content-engineering` | 3102 |
| LED Engineering | Engineering Studio | [led-engineering.md](led-engineering.md) | `~/Play.Code/pixel-lab-agents/led-engineering` | `feature/led-engineering` | 3103 |
| Output Engineering | Output Studio | [output-engineering.md](output-engineering.md) | `~/Play.Code/pixel-lab-agents/output-engineering` | `feature/output-engineering` | 3104 |

`~/Play.Code/playground.pixel` is the integration checkout. It stays on `main`, and merges and final checks happen there. Don't develop in it, and never in `~/Documents/Play.Code`.

**Browser data is per port.** Each dev port has its own IndexedDB, so projects made on 3102 don't show on 3104. Use the example gallery, or export and import a project file, to share test data.

## How it works today

**What it is.** A client-side Next.js 16 app with no backend. Projects live in the browser's IndexedDB. Nothing leaves the machine.

**Run it.**
- `npm run dev -- -p <your port>`, or `npm run build && npx next start -p <your port>` for measurements.
- Before a PR: `npm run typecheck && npm run lint && npm test && npm run build`.
- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before writing framework code (see [AGENTS.md](../../AGENTS.md)).

**Test data.** The start screen's Examples section opens Festival Main Stage, Corporate Keynote, the Motion Lab acceptance project and a 500-screen stress test as new copies.

**How data flows.** Every view and export reads the same resolved mapping:

```
Project (stored, validated by persistence/schema.ts)
  │  edited only through engines/project-ops.ts (pure), via state/store.ts edit(): autosave + undo
  ▼
resolveMapping(project)  ── engines/mapping.ts: the single source of every coordinate
  │
  ├─ validateProject      ── engines/validation.ts: issues with codes and screen ids
  ├─ buildViewModel       ── state/view-model.ts: one view's world rectangles
  │     ├─ Mapping canvas    components/workspace/workspace-canvas.tsx (Konva)
  │     └─ Live preview      components/motion/live-preview.tsx + preview/ (Canvas 2D)
  └─ exports/             ── scene.ts → PNG, SVG; manifest, report, Resolume package
```

**Spaces.** `master`, `canvas` and `output` are integer pixels (`Px`). `stage` is integer micrometres (`Um`).

**State.**
- **Project data:** `state/store.ts`. Saved, undone and exported.
- **Workspace state:** `state/ui-store.ts`. Not saved.
- **Module state:** for example `state/motion-store.ts`. Never saved or undone, and it can't change the mapping.

**Layers** are in the [OVERVIEW](../architecture/OVERVIEW.md#layers): pure `domain` and `engines`, effects in `state`, drawing in `preview` and `components`, pure builders in `exports`.

**Baselines** are in [PERFORMANCE](../development/PERFORMANCE.md): initial JavaScript 172.8 KB gzip, Motion Lab chunk 7.5 KB, live preview at 60 fps through 500 screens.

## File ownership

You may edit the files your lane owns. Editing another lane's file needs a note in your PR naming the file and why, and the owner's review.

| Lane | Owns |
| --- | --- |
| Lead Architect | `src/domain/**` except `cabinets.ts`<br>`src/engines/*.ts`, `src/engines/motion/**`<br>`src/persistence/**` except `cabinet-library.ts`<br>`src/state/` except `preferences.ts` and `export-actions.ts`<br>`src/preview/**`, `src/components/motion/**`<br>`src/modules/contract.ts`, `src/modules/registry.ts`, `src/exports/contract.ts`<br>`src/examples/**`, `examples/`, `tests/helpers.ts`<br>`src/components/workspace/app.tsx`, `canvas-area.tsx`, `canvas-header.tsx`, `workspace-canvas.tsx`, `use-canvas-viewport.ts`, `app-loader.tsx`<br>`SESSION.md`, `CHANGELOG.md`, `CLAUDE.md`, `docs/product/ROADMAP.md`, `docs/architecture/**`, `docs/agents/README.md`, `START.md` |
| Product Design | `src/app/**`<br>`src/components/ui/**`, new `src/components/shell/**`<br>`src/components/workspace/top-bar.tsx`, `explorer.tsx`, `inspector.tsx`, `fields.tsx`, `dialogs.tsx`, `start-screen.tsx`<br>new `src/state/preferences.ts`<br>`docs/product/DESIGN_SYSTEM.md` |
| Content Engineering | new `src/engines/content/**`, `src/modules/content/**`, `src/exports/templates/**`<br>`docs/integrations/video-generation.md`, `prototypes/content-*/` |
| LED Engineering | `src/domain/cabinets.ts`<br>new `src/engines/led/**`, `src/modules/engineering/**`, `src/persistence/cabinet-library.ts`<br>`docs/integrations/led-*.md` |
| Output Engineering | `src/exports/**` except `contract.ts` and `templates/`<br>`src/state/export-actions.ts`<br>new `src/engines/output/**`, `src/modules/output/**`<br>`docs/integrations/RESOLUME.md`, `ndi.md`, `video-encoding.md`, `prototypes/output-*/` |

**Everyone** owns the Status section of their own brief and their own `tests/<lane>-*.test.ts` files, for example `tests/led-power.test.ts`.

**Append-only shared files.** Add your own section; don't edit others':
- `docs/development/PERFORMANCE.md` and `TESTING.md`;
- `docs/architecture/DECISIONS.md`, through the Lead Architect's review;
- `docs/product/MODULES.md`, to update the status of your module.

**Coordinated files.** Small edits only, and say so in the PR:
- `package.json` and `package-lock.json`. No new dependency without the user's approval, a measured bundle cost and a DECISIONS record.
- `src/components/workspace/top-bar.tsx`. Product Design owns it, but Output Engineering's Export menu lives there until L1 moves it onto the registry.
- `src/domain/model.ts` and `src/persistence/schema.ts`. Ask the Lead Architect; only L2 changes the stored shape.

## Dependencies between tasks

Task ids are defined in each brief. ✅ means ready to start now. ⏸ means it waits, with the reason in brackets.

```
L0 Shared contracts (types) ─────────────── done, on main before any worktree
 │
 ├─ L1 Module registry + studio switch + Motion Lab as a FrameSource ✅
 │    ├─ D4 Studio navigation, built ⏸ [L1, D1]
 │    ├─ C2 Content layouts in the preview ⏸ [L1, approval]
 │    ├─ E4 Engineering Studio panel ⏸ [L1, E1]
 │    └─ O2 Full-screen output ⏸ [approval]; its Output Studio panel ⏸ [L1]
 │
 ├─ L2 modules[id] project section, schema v2 ⏸ [first module that saves data]
 │    ├─ C3 Saved content layouts ⏸ [L2, C2]
 │    └─ E3 Saved processor and power plan ⏸ [L2, E2]
 │
 ├─ D1 Studio navigation spec ✅    D2 Theme and density tokens ✅    D3 Preferences store ✅
 ├─ C1 Content templates per screen, canvas and output ✅
 ├─ E1 Cabinet library outside a project ✅      E2 Power, weight and port calculations ⏸ [approval]
 └─ O1 Existing exports onto ExportEntry, byte-identical ✅
          └─ O3 No-code NDI test ⏸ [O2]    O4 Video encode prototype ⏸ [approval]    O5 NDI companion ⏸ [O3, decision]
```

**Run now, in parallel:** L1, D1–D3, C1, E1 and O1. They touch separate files.

**Merge order.** L1 first when it's ready, because it changes the shell. Each lane then runs `git merge origin/main` before its next PR. Any order works for the rest.

**Approval.** Items marked "approval" or "decision" are outside the approved roadmap. They wait until the user approves them; [SESSION](../../SESSION.md#pending-decisions) lists them.

## Starting an agent

One terminal per agent. The exact command for each lane is at the top of its brief, in this form:

```sh
cd ~/Play.Code/pixel-lab-agents/<lane> && claude "Eres el agente <Agent name>. Tu brief es docs/agents/<lane>.md. Sigue docs/agents/START.md."
```

[START.md](START.md) is the shared opening checklist.

**Every task:**
1. `git fetch origin && git merge origin/main` before starting. Never rebase a pushed branch, and never force-push.
2. Work on your lane branch, inside your owned files.
3. Verify: `npm run typecheck && npm run lint && npm test && npm run build`, plus a real-browser check on your port for UI work.
4. Update the Status section of your brief.
5. Push and open a PR to `main`. Don't merge it yourself: the Lead Architect reviews it and merges after the user approves.

**Status.** Only the Lead Architect writes `SESSION.md`. Other lanes keep status in their brief and in PR descriptions.

## Rules for every change

From [CLAUDE.md](../../CLAUDE.md), the ones most often missed:
- **Branches:** work on your lane branch and open a PR. Merge only when CI passes. Never force-push. Never make the repository public.
- **Pure code:** `domain` and `engines` stay pure: no React, DOM, clock, randomness or network.
- **Mapping:** never compute mapping values outside `engines/mapping.ts`.
- **Project shape:** changing the stored project shape needs a `SCHEMA_VERSION` bump and a migration, done by the Lead Architect (L2).
- **Dependencies:** none new without the user's approval, a measured bundle cost, and a record in [DECISIONS](../architecture/DECISIONS.md).
- **Performance:** never claim a change without before and after measurements. Animation must not update React state every frame.
- **Verification:** UI changes need a check in a real browser. Mapping and export changes need unit tests. Report what wasn't tested.
- **File formats:** don't invent them. Don't generate Resolume presets until [RESOLUME](../integrations/RESOLUME.md) allows it.
- **Scope:** don't start a ⏸ task early. Existing behaviour must keep working.
