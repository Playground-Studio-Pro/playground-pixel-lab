# Handoff

Playground Pixel Lab, paused 2026-11-08 at the end of Sprint 1. `main` is at `ba4e5f4`. Current state and details are in [SESSION](SESSION.md).

## What we built

A browser-only LED mapping and visual production tool, with no backend. Projects stay in the browser's IndexedDB.
- **Mapping Studio:** screens, cabinets, canvases and outputs, mapped pixel-exact in Physical, Content and Output views. Exports for processors and Resolume. Undo and redo.
- **Motion Lab:** the shared Live preview engine. Seven deterministic test patterns play across the mapped screens.
- **Aurora Gradient:** the first visual generator, with palettes, colors, speed and direction.
- **Cabinet library:** real cabinet profiles kept outside projects, with supplier specs. It starts with the Yestech MG6S P2.6 Indoor.
- **Example gallery:** four ready-made shows on the start screen.
- **Parallel development:** five agent lanes in their own worktrees, with shared contracts.

## What works

Verified on `ba4e5f4`:
- 236 of 236 unit tests, typecheck, lint, build and CI pass.
- In a production build in Chrome, Aurora runs at 60 fps across screens, and the cabinet library works.
- The initial JavaScript bundle is unchanged at 172.8 KB.

## What remains

- **Ready tasks:** content templates, the module registry, theme tokens, and exports on the shared contract.
- **Waiting for approval:** full-screen output, power and port calculations, video encoding, NDI, and video generation.
- **Small cleanups:** dead library code in the store, and Aurora settings that aren't saved yet.

The full list is in [SESSION](SESSION.md#pending-tasks).

## Important architecture decisions

- **One source of coordinates:** `resolveMapping`. Every view and export reads it, and nothing else computes pixel positions.
- **Pure core:** `domain` and `engines` have no React, DOM, clock or randomness. Edits go through `project-ops.ts`, which keeps undo and autosave working.
- **Determinism:** generators draw from the frame number only, so the same frame always gives the same pixels.
- **Units:** pixels, micrometres, milliwatts and grams are integers. Content FPS, browser FPS and LED refresh rate are never mixed.
- **Contracts as types:** in [CONTRACTS](docs/architecture/CONTRACTS.md). There's no plugin framework.
- **Separate data:** the cabinet library and preferences live outside the project file. The project format is unchanged.
- **Git workflow:** lanes merge `main` into their own branch. No rebase, no force-push, and every PR waits for the user's approval.

## Next three priorities

1. **Full-screen output to a second display (O2).** Needs approval. It's the step toward real walls and NDI.
2. **Content templates per screen, canvas and output (C1).** Already approved.
3. **Power and weight from the library specs (E2).** Needs approval to start Phase 4.

## Restart the application

```sh
cd ~/Play.Code/playground.pixel/app
git fetch && git status
npm run build && npx next start -p 3000
```

Then open http://localhost:3000. Use `npm run dev -- -p 3000` while developing.

## Restart each agent

One terminal each. Every agent merges `origin/main` first, as [START](docs/agents/START.md) says.

```sh
cd ~/Play.Code/playground.pixel/agents/lead-architect && claude "Eres el agente Lead Architect. Tu brief es docs/agents/lead-architect.md. Sigue docs/agents/START.md."
cd ~/Play.Code/playground.pixel/agents/product-design && claude "Eres el agente Product Design. Tu brief es docs/agents/product-design.md. Sigue docs/agents/START.md."
cd ~/Play.Code/playground.pixel/agents/content-engineering && claude "Eres el agente Content Engineering. Tu brief es docs/agents/content-engineering.md. Sigue docs/agents/START.md."
cd ~/Play.Code/playground.pixel/agents/led-engineering && claude "Eres el agente LED Engineering. Tu brief es docs/agents/led-engineering.md. Sigue docs/agents/START.md."
cd ~/Play.Code/playground.pixel/agents/output-engineering && claude "Eres el agente Output Engineering. Tu brief es docs/agents/output-engineering.md. Sigue docs/agents/START.md."
```

Start only the agents whose tasks the user has approved. A task outside an agent's brief goes in its opening message, as Sprint 1 did.
