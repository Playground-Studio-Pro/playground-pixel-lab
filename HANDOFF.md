# Handoff

Playground Pixel Lab, 2026-11-18. `main` is at `cb084ab`. Alpha 0.1 Phase A is done; Phase B (Electron) is approved and not started. Current state and the Phase B checklist are in [SESSION](SESSION.md).

## What we're building now

**Alpha 0.1:** a desktop app for macOS (Windows after a real test) that completes **Mapping → Test card → Output → external monitor → Resolume Arena** offline, validated in a field test. No features outside that flow until it passes.

## What exists

- **Mapping Studio:** screens, cabinets, canvases and outputs mapped pixel-exact in Physical, Content and Output views. PNG and SVG pixel maps, manifest, report and Resolume preparation package. Undo and redo.
- **Content Studio:** Depth Studio (Emerald Chamber, WebGL2) and Aurora Gradient, both deterministic by frame number.
- **Output Studio:** calibration test card with logo modes, and browser H.264 MP4 export per master, output or screen, never scaled.
- **Engineering Studio:** cabinet library with supplier specs. Processors, power and distribution come later; the studio stays part of the product.
- **Desktop:** an Electron foundation on `feature/desktop-engineering`, not yet launched.

## What works

On `main` at `cb084ab`: typecheck, lint, 302 unit tests and CI pass. MP4 files from headless Chrome were checked with ffprobe and match the Preview dialog pixel for pixel. Nothing has run in Electron yet.

## Important architecture decisions

- **One source of coordinates:** `resolveMapping`. Every view and export reads it.
- **Pure core:** `domain` and `engines` have no React, DOM, clock or randomness.
- **Determinism:** a frame is a function of the config and the frame number.
- **Units:** integer pixels, micrometres, milliwatts and grams. Content FPS, browser FPS and LED refresh rate are never mixed.
- **Physical output:** independent Electron windows, one per output, at native resolution and 1:1 device pixels, designed for several monitors at once. The 4096 px preview cap never limits output. See [DECISIONS](docs/architecture/DECISIONS.md).
- **Git:** lanes merge `main` into their branch. No rebase, no force-push, no deleting branches or worktrees, and no PR merges without CI and the owner's approval.

## Restart the application

```sh
cd ~/Play.Code/playground.pixel/app
git fetch && git status
npm run build && npx next start -p 3000
```

## Start the next agent

**Phase B, Desktop Engineering.** One terminal:

```sh
cd ~/Play.Code/playground.pixel/agents/desktop-engineering && claude "Eres el agente Desktop Engineering de Pixel Lab. Ejecuta la Fase B de Alpha 0.1: lee SESSION.md en origin/main (git fetch origin && git show origin/main:SESSION.md) y sigue su checklist 'Phase B' paso a paso en esta worktree, rama feature/desktop-engineering. Autorizado: git merge origin/main, descargar Electron, instalar dependencias, builds sin firmar y fuentes locales. Prohibido: force push, rebase, borrar ramas, worktrees o archivos, tocar la carpeta ../../desktop, integrar ProRes, implementar salida fullscreen u otras funciones nuevas, y declarar compatibilidad con Windows. Detente y reporta ante cualquier conflicto o decisión de arquitectura. Al terminar: abre un PR con la evidencia en desktop/docs/TEST-RESULTS.md y reporta qué funcionó, qué falló y qué no se probó."
```

Phase C (Output Engineering, full-screen output) starts only after the owner approves it once Phase B passes. Product Design, Content Engineering and LED Engineering stay stopped.
