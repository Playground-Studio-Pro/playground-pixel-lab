# Handoff

Playground Pixel Lab, 2026-11-20. Alpha 0.1 Phase C (physical output): automated work nearly done, physical monitor session next. Current state is in [SESSION](SESSION.md).

## What we're building now

**Alpha 0.1:** a desktop app for macOS that completes **Mapping → Test card → Output → external monitor → Resolume Arena** offline. Phases A and B are done; Phase C adds full-screen output on an external monitor, 1:1 at native resolution. Alpha 0.1 isn't declared done until a session with a real external monitor and Resolume Arena passes.

## What exists

- **Mapping Studio:** screens, cabinets, canvases and outputs mapped pixel-exact. Pixel maps, manifest, report, Resolume preparation package. Undo and redo.
- **Content Studio:** Depth Studio (WebGL2) and Aurora Gradient, deterministic by frame number.
- **Output Studio:** calibration test card; MP4 export per master, output or screen, never scaled.
- **Send to a monitor (Output Studio):** opens the test card full screen on a chosen display through validated IPC; safety box for the operator's own screen; Esc closes. Tested hidden only, never on a real external monitor.
- **Engineering Studio:** cabinet library, plus four researched cabinets in the dropdowns ([LED_HARDWARE_CATALOG](docs/engineering/LED_HARDWARE_CATALOG.md)); processors and power later.
- **Desktop:** Electron on macOS, offline, sandboxed, persistence in the app's IndexedDB, unsigned `.app`, remote debugging refused when packaged.

## Important architecture decisions

- **One source of coordinates:** `resolveMapping`.
- **Pure core:** `domain` and `engines` have no React, DOM, clock or randomness.
- **Determinism:** a frame is a function of the config and the frame number.
- **Physical output:** independent Electron windows created only by the main process through validated IPC; native resolution, 1:1 device pixels; output and MP4 export draw through the same path. Designed for several monitors, one in Alpha. See [PHYSICAL_OUTPUT](docs/architecture/PHYSICAL_OUTPUT.md).
- **Colour:** the output display's macOS profile must be sRGB IEC61966-2.1; the app can't force it in Electron 43.
- **Git:** small PRs with evidence, reviewed by the Lead Architect, CI green. No rebase, no force push, no deleting branches or worktrees.

## Restart the application

```sh
cd ~/Play.Code/playground.pixel/app
git fetch && git status
npm run build && npx next start -p 3000     # web
npm --prefix desktop ci && npm --prefix desktop run build:web && npm --prefix desktop start   # Electron
```

## Restart the Phase C agents

One terminal each. Each reads SESSION.md and PHYSICAL_OUTPUT.md section 9 first.

```sh
cd ~/Play.Code/playground.pixel/agents/desktop-engineering && claude "Eres Desktop Engineering de Pixel Lab, Fase C de Alpha 0.1. Lee SESSION.md y docs/architecture/PHYSICAL_OUTPUT.md (secciones 1–7 y 9). Sigue con tu siguiente tarea D en orden, un PR pequeño por tarea con evidencia. Reglas en SESSION.md."
cd ~/Play.Code/playground.pixel/agents/output-engineering && claude "Eres Output Engineering de Pixel Lab, Fase C de Alpha 0.1. Trabaja en la rama feature/output-physical (no en feature/output-engineering, que tiene ProRes). Lee SESSION.md y docs/architecture/PHYSICAL_OUTPUT.md (secciones 8 y 9). Sigue con tu siguiente tarea O en orden, un PR pequeño por tarea con evidencia. Reglas en SESSION.md."
```

Product Design, Content Engineering and LED Engineering stay stopped.
