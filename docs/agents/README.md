# Agent Guide

For every agent working on Pixel Lab. Written 2026-11-07 by the core agent, after Motion Lab V1 was merged.

This page has three parts:
- how the app works today;
- how parallel work is split, so agents don't collide;
- the rules every change must pass.

Each lane has its own brief:

| Lane | Brief | Objective |
| --- | --- | --- |
| Core | [core.md](core.md) | Mapping, examples, templates, module contract, Motion Lab |
| Design | [design.md](design.md) | Visual direction and customization |
| Functional modules | [functional-modules.md](functional-modules.md) | Quick video, NDI, video generation, mockups |

The proposals all three build on are in [MODULES](../product/MODULES.md), which is not approved yet.

## How it works today

**What it is.** A client-side Next.js 16 app with no backend. Projects live in the browser's IndexedDB. Nothing leaves the machine.

**Run it.**
- `npm ci`
- `npm run dev`, or `npm run build && npx next start` for measurements
- Before a PR: `npm run typecheck && npm run lint && npm test && npm run build`
- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before writing framework code (see [AGENTS.md](../../AGENTS.md)).

**Try it with real data.** Import `examples/festival-main-stage.pixellab.json` with "Import project file" in the project menu. Then open Live preview and switch between Physical, Content and Output.

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

**Three kinds of space.** Every position names its space:
- `master`, `canvas` and `output` are in integer pixels (`Px`);
- `stage` is in integer micrometres (`Um`).

Content FPS, browser preview FPS and LED refresh rate are separate measurements. None of them is ever shown as another.

**Three kinds of state.**
- **Project data:** in `state/store.ts`. It's saved, undone and exported.
- **Workspace state:** in `state/ui-store.ts`, such as dialogs and drafts. It's not saved.
- **Module state:** in `state/motion-store.ts` for Motion Lab. It's never saved or undone, and can't change the mapping.

**Where things live.** See the layer table in [OVERVIEW](../architecture/OVERVIEW.md#layers). Short version:
- **Pure code:** `domain` and `engines`.
- **Effects:** `state`.
- **Drawing:** `preview` and `components`.
- **Pure builders:** `exports`.

**Size today.** About 3,900 lines across components, state and exports. The largest files are `workspace-canvas.tsx` (453), `store.ts` (411), `dialogs.tsx` (368) and `inspector.tsx` (353).

**Baselines** are in [PERFORMANCE](../development/PERFORMANCE.md):
- initial JavaScript 172.8 KB gzip;
- 264 KB once a project is open;
- Motion Lab chunk 7.5 KB;
- live preview at 60 fps through 500 screens.

## Parallel work: lanes and file ownership

Agents work at the same time, so each lane owns files. Touching another lane's files needs a note in the PR and a rebase on the latest `main`.

| Lane | Owns | Reads but doesn't edit |
| --- | --- | --- |
| Core | `src/engines/**`, `src/domain/**`, `src/persistence/**`, `src/state/store.ts`, `src/state/view-model.ts`, `src/exports/**`, `examples/`, `tests/helpers.ts`, `SESSION.md`, `CHANGELOG.md`, `ROADMAP.md` | Everything else |
| Design | `src/app/globals.css`, `src/components/ui/**`, `DESIGN_SYSTEM.md`, a new `src/state/preferences.ts` | Engines and exports; exports must not change |
| Functional modules | New folders: `src/modules/<name>/`, `src/engines/<name>/`, `docs/integrations/<name>.md`, prototypes under `prototypes/<name>/` | Mapping, project schema |

**Shared files** need coordination: whoever merges second rebases.
- `src/components/workspace/top-bar.tsx`
- `canvas-header.tsx`
- `canvas-area.tsx`
- `app.tsx`
- `start-screen.tsx`

The module contract in [core.md](core.md#module-contract) is meant to remove most of these collisions. Until it lands, keep edits to shared files small.

**Status reporting.**
- `SESSION.md` is written only by the core lane, to avoid merge conflicts.
- Other lanes keep their status in the "Status" section of their own brief.
- PR descriptions hold the details.

## Rules for every change

From [CLAUDE.md](../../CLAUDE.md), the ones most often missed:
- **Branches:** work on a branch (`feat/`, `fix/`, `docs/`, ...) and open a PR. Merge only when CI passes. Never force-push. Never make the repository public.
- **Pure code:** `domain` and `engines` stay pure: no React, DOM, clock, randomness or network.
- **Mapping:** never compute mapping values outside `engines/mapping.ts`.
- **Project shape:** changing the stored project shape needs a `SCHEMA_VERSION` bump and a migration.
- **Dependencies:** a new dependency needs a stated reason, a measured bundle cost, and a record in [DECISIONS](../architecture/DECISIONS.md).
- **Performance:** never claim a change without before and after measurements. Animation must not update React state every frame.
- **Verification:** UI changes need a check in a real browser. Mapping and export changes need unit tests. Report what wasn't tested.
- **File formats:** don't invent them. Don't generate Resolume presets until [RESOLUME](../integrations/RESOLUME.md) allows it.
- **Scope:** stay inside approved scope. [MODULES](../product/MODULES.md) marks what still needs approval.
