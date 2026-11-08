# LED Engineering Brief

**Objective:** the Engineering Studio. Plan the LED system itself: real cabinet profiles kept outside any project, then processors, ports, power and weight, with every assumption stated.

**Start:**
```sh
cd ~/Play.Code/playground.pixel/agents/led-engineering && claude "Eres el agente LED Engineering. Tu brief es docs/agents/led-engineering.md. Sigue docs/agents/START.md."
```

Worktree `~/Play.Code/playground.pixel/agents/led-engineering`, branch `feature/led-engineering`, dev port 3103.

Read first:
1. [README](README.md), especially file ownership.
2. [CONTRACTS](../architecture/CONTRACTS.md): the module contract.
3. [DATA_MODEL](../architecture/DATA_MODEL.md): cabinets and screens.
4. [ROADMAP, Phases 1 and 4](../product/ROADMAP.md).

## What you build on today

**Cabinets.** `CabinetProfile` in `domain/model.ts`: `widthUm`, `heightUm`, `pixelsX`, `pixelsY`, `nominalPitchUm`, and `source` (`builtin` or `custom`).
- `domain/cabinets.ts` has five generic profiles, such as "Generic 500×500 P2.6".
- A project stores copies of the profiles it uses. Custom profiles live only inside one project today. There's no library across projects.
- **Real example:** a Yestech MG6S P2.6 indoor is 500 × 500 mm and 192 × 192 px. A 5.5 × 3 m wall of it is 11 × 6 cabinets, 2112 × 1152 px. Its data sheet also gives weight, 5.7 kg front-service or 6.7 kg cube, and maximum and typical power.

**Screens.** A screen is a cabinet profile times columns and rows. `engines/physical.ts` computes its physical size from cabinet sizes, and `resolveMapping` gives its pixel size and stage position. Resolution always comes from cabinet pixels × count, never from pitch.

**Units.** Physical lengths are integer micrometres (`Um`) and pixels are integers (`Px`), in `domain/units.ts`. Use integer units for new physical quantities too: grams, milliwatts. Never store floats.

## Tasks

| Id | Task | State | Depends on |
| --- | --- | --- | --- |
| E1 | Cabinet library outside a project | ✅ Ready | — |
| E2 | Pure calculations: power, weight, port capacity | ⏸ | User approval to start Phase 4 |
| E3 | Saved processor and power plan per project | ⏸ | L2, E2 |
| E4 | Engineering Studio panel | ⏸ | L1, E1 |

### E1 Cabinet library

A Phase 1 deliverable, already approved.

- **Storage:** a library of cabinet profiles kept per browser, outside projects, in `src/persistence/cabinet-library.ts`. Use its own IndexedDB store, behind a small repository interface like `ProjectRepository`. Everything read from storage passes a schema.
- **Behaviour:**
  - add, edit and remove library profiles;
  - pick a library profile when adding a cabinet to a project. It's copied into the project, as today, so project files stay self-contained;
  - built-in generic profiles stay as they are.
- **Supplier profiles:** a profile may carry a supplier, model and data-sheet note, such as "Yestech MG6S P2.6 indoor". Extra fields live in the library, not in `CabinetProfile`, until L2 allows project changes. Ask the Lead Architect if a project field is needed.
- **UI:** reuse the existing cabinet dialog in `dialogs.tsx`, owned by Product Design. Keep that edit small and say so in the PR. A full library screen waits for E4.
- **Tests** in `tests/led-cabinet-library.test.ts`, with `fake-indexeddb`, as `tests/persistence.test.ts` does.

### E2 Calculations

After the user approves Phase 4 work. Pure functions in `src/engines/led/`, each with stated assumptions:
- **power:** maximum and typical watts per screen, and current per circuit at a given voltage and phase;
- **weight:** per screen and per hanging line;
- **port capacity:** pixels per processor port at a given bit depth and frame rate.

Each result lists its inputs and assumptions. Safety-relevant values carry a disclaimer and need qualified review, as the ROADMAP requires. Check them against real show paperwork before calling them done.

**LED refresh rate** is a data-sheet value. It's never derived from content FPS or browser FPS, and never shown as either.

## Rules for this lane

- **Data sheets are the source.** Never guess a supplier value. Where a value is missing, store nothing and say so.
- **Integer units**, named in every field: `Um`, `Px`, grams, milliwatts.
- **Pure engines**, with unit tests for every formula, including edge cases such as one cabinet, one row, or an empty screen.
- **Project shape:** no new project fields until L2.
- **No new dependencies** without the user's approval.

## Status

Not started. Update this section in your PRs.
