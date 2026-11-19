# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-18, Alpha 0.1 Phase C, steps 1–3 merged.

## Objective

**Pixel Lab Alpha 0.1:** a desktop app (Electron) that completes one real flow, offline: **Mapping → Test card → Output → external monitor → Resolume Arena.** Alpha 0.1 isn't done until the physical tests with a real external monitor and Resolume Arena pass.

| Phase | Owner | Status |
| --- | --- | --- |
| **A.** Protection and integration | Lead Architect | Done |
| **B.** Electron on macOS | Desktop Engineering | Done: #19. Launches, offline, persistence, MP4, unsigned `.app`, remote debugging refused when packaged |
| **C.** Physical output | Desktop + Output Engineering | **In progress.** Contract (#20) and shared types (#21) merged. Done: D1 (#24), D2 (#25), D3 (#27), O1 (#23), O2 (#26). Next: D4 and O3, then O4 and D5 (section 9). Automated tests first, then one session with a real external monitor |

Product Design, Content Engineering and LED Engineering stay stopped.

## Alpha 0.1 requirements

✅ verified · 🟡 partial · ❌ not built

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Desktop app | ✅ macOS (Electron, #19). Windows not claimed until tested on a real Windows 11 machine |
| 2 | Offline | ✅ simulated (DNS blocked). One run with Wi-Fi physically off still to do |
| 3 | Mapping | ✅ in Electron |
| 4 | Test card | ✅ in Electron |
| 5 | Full screen on an external monitor | ❌ Phase C |
| 6 | MP4 export | ✅ in Electron (OpenH264 software encoder; speed on long or 4K animated exports unmeasured) |
| 7 | Project persistence | ✅ in Electron (relaunch, export and import) |
| 8 | Resolume Arena import and playback | ❌ procedure written ([PHYSICAL_OUTPUT](docs/architecture/PHYSICAL_OUTPUT.md) 8.11), never run |

## Phase C

Design, decisions and acceptance criteria: [PHYSICAL_OUTPUT](docs/architecture/PHYSICAL_OUTPUT.md). Shared types: `src/domain/physical-output.ts`. Implementation order: its section 9.

Owner decisions, 2026-11-18: the 14 draft positions are approved, except:
- **D-2:** a reconnected monitor is detected automatically and the window comes back only on a reliable match, **paused** (`held`), with the operator notified; playback resumes only on explicit confirmation.
- **O-1:** whole master then cut for Alpha, measured on Festival Main Stage (5120 px); source, composer and presenter stay decoupled; region rendering documented, not built.
- **D9:** multi-monitor clock sync is backlog, not an Alpha criterion. One active output.

| Lane | Worktree | Branch for Phase C | Owns |
| --- | --- | --- | --- |
| Desktop | `agents/desktop-engineering` | `feature/desktop-engineering`, a short branch per PR | D1–D8, D10, D11: window registry, displays, IPC validation, output preload, open and close, failures, reconnect |
| Output | `agents/output-engineering` | `feature/output-physical` (new, from `main`). `feature/output-engineering` holds ProRes and stays out of Alpha | O1–O11: output layout and cadence, pixel grid, frozen sources, output page, pixel tests, output = MP4, limits |
| Lead | `agents/lead-architect` | short `docs/` and contract branches | Contracts, dependencies, PR review, main stability, SESSION and HANDOFF. No new features |

**Rules.** Each PR is small and states what it implements, tests passed, what wasn't tested, what needs external hardware and remaining risks. No merge to `main` without the Lead Architect's review and CI. No force push, no rebase, no deleting branches or worktrees. Out of scope: ProRes, several simultaneous outputs, Engineering Studio, new Content Studio features, export changes beyond keeping MP4 and output consistent. A change to `src/domain/physical-output.ts` or another shared contract stops and goes through the Lead Architect first.

**Physical test session** (after the automated tests pass, owner organises it): full screen, physical resolution, Retina scaling, pixel correspondence, reconnect, 30-minute stability, Resolume Arena export and playback.

## Where it stands

- **`main`** at `bcf93bd`, the merge of #27 (D3), CI green. CI now runs the desktop unit tests too (Linux runner).
- **O2 MP4 criterion** restated by the owner: at least 99.9 % of probes within ±8 luma, every outlier exact in the source canvas.
- **Branches kept:** `feature/desktop-engineering`, `feature/output-engineering` (ProRes, not merged, out of Alpha), `docs/phase-c-output-contract`, and every merged branch.
- **Local backups, keep until Alpha 0.1 passes:** `~/Play.Code/playground.pixel/_backups/` (Depth Studio pack copies) and the original `~/Play.Code/playground.pixel/desktop/` folder.

## Known issues

- **MP4:** H.264 over 4096 px a side isn't exported whole; per-output files instead. Software encoder in Electron.
- **Packaged app:** unsigned, default icon, 301 MB; Gatekeeper blocks it on another Mac until signed. `desktop/tests/font-response.cjs` is an unused leftover.
- **Resolume:** never tested in Arena.
- **Engineering Studio:** placeholder; stays so in Alpha.
- **Settings:** Depth Studio and Aurora settings aren't saved in the project.
- **Dead code:** `useApp.library`, `saveToLibrary`, `IndexedDbCabinetLibrary`. Cleanup after Alpha.

## Resume

1. `cd ~/Play.Code/playground.pixel/app && git fetch && git status && git log --oneline -1`.
2. Check open PRs from `feature/desktop-engineering` and `feature/output-physical`; review in section 9 order.
