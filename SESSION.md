# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-20, Alpha 0.1 Phase C. Automated work is nearly done; the physical monitor session comes next.

## Objective

**Pixel Lab Alpha 0.1:** a desktop app (Electron) that completes one real flow, offline: **Mapping → Test card → Output → external monitor → Resolume Arena.** Alpha 0.1 isn't done until the physical tests with a real external monitor and Resolume Arena pass.

| Phase | Owner | Status |
| --- | --- | --- |
| **A.** Protection and integration | Lead Architect | Done |
| **B.** Electron on macOS | Desktop Engineering | Done (#19) |
| **C.** Physical output | Desktop + Output Engineering | **In progress.** D1–D5, D7, D8 and O1–O6 merged, plus O12 operator controls (#42), Update output (#50) and the sRGB requirement (#48). Left to automate: O7, O8, the Update button and sRGB warning, the sleep blocker in `held`. D6, D10, D11 and O9–O11 need the external monitor |

Product Design, Content Engineering and LED Engineering stay stopped.

## Alpha 0.1 requirements

✅ verified · 🟡 partial · ❌ not built

| # | Requirement | Status |
| --- | --- | --- |
| 1 | Desktop app | ✅ macOS. Windows not claimed until tested on a real Windows 11 machine |
| 2 | Offline | ✅ simulated (DNS blocked). One run with Wi-Fi physically off still to do |
| 3 | Mapping | ✅ in Electron |
| 4 | Test card | ✅ in Electron |
| 5 | Full screen on an external monitor | 🟡 built and tested hidden on a virtual display (open, close, failures, unplug and replug, pixel = MP4 at 1× and 2×). Never shown on a real monitor |
| 6 | MP4 export | ✅ in Electron |
| 7 | Project persistence | ✅ in Electron |
| 8 | Resolume Arena import and playback | ❌ procedure written ([PHYSICAL_OUTPUT](docs/architecture/PHYSICAL_OUTPUT.md) 8.11), never run |

## Phase C

Design, decisions and acceptance criteria: [PHYSICAL_OUTPUT](docs/architecture/PHYSICAL_OUTPUT.md). Shared types: `src/domain/physical-output.ts`. Order: its section 9.

Decisions made since 2026-11-18:
- **Colour (#48):** the output display's macOS profile must be sRGB IEC61966-2.1. The app can't force Chromium's colour profile in Electron 43; only the test harness (`test:smoke`) passes `--force-color-profile=srgb`. Displays report `colorSpace` and `colorDepth`.
- **O6 reference (#46, #47):** in unpackaged `--smoke-test` runs only, `pixelLabOutput.testMode` lets the output page draw the exporter's frame N for comparison. Off in packaged builds and normal runs.
- **Update output (#50):** accepted in opening, live and failed; refused in waiting-display and held (D-2). UNKNOWN_OUTPUT for an output that isn't open.
- **Sleep blocker:** to be held in `held` as well as live (Desktop, in progress).
- **Test safety:** no visible output window without the owner's explicit permission and an Esc / Close recovery. Smoke runs stay hidden; `allowControlDisplay` is never set silently. No `electron` invocation outside hidden `--smoke-test`.

**Physical test session** (owner organises it, after the automated work): D6 full screen → sRGB colour check → D7 disconnect / reconnect → D10 + O10 1:1 photos → O9 cadence → O11 Resolume Arena → D11 30-minute rehearsal. Then one run with Wi-Fi physically off.

## Beyond Alpha 0.1 (owner requests, 2026-11-20)

- **Cabinets and processors:** researched in [LED_HARDWARE_CATALOG](docs/engineering/LED_HARDWARE_CATALOG.md) (#43). Four cabinets are in the dropdowns (#44), marked as not checked against the PDFs. Processors, load, power and weight calculations, and a Nova setup sheet are the Engineering work (E2–E4), after Alpha 0.1.
- **Test cards:** diagonal motion and a nicer-looking card ("Test card v2"), after Alpha 0.1, with pixel tests per pattern.

## Where it stands

- **`main`** at `8d8bd52`, the merge of #50. CI green.
- **Open work:** Output, the Update button and sRGB warning, then O7 and O8. Desktop, the sleep blocker in `held`, then it waits for the physical session.
- **Branches kept:** every merged branch, `feature/desktop-engineering`, `feature/output-physical`, `feature/output-engineering` (ProRes, out of Alpha) and `docs/phase-c-progress`.
- **Local backups, keep until Alpha 0.1 passes:** `~/Play.Code/playground.pixel/_backups/` and the original `~/Play.Code/playground.pixel/desktop/` folder.

## Known issues

- **MP4:** H.264 over 4096 px a side isn't exported whole; per-output files instead. Software encoder in Electron.
- **Packaged app:** unsigned, default icon, about 301 MB; Gatekeeper blocks it on another Mac until signed.
- **Resolume:** never tested in Arena.
- **Colour on the cable:** not measured. capturePage proves what Chromium draws, not what reaches the LED processor.
- **Engineering Studio:** placeholder; stays so in Alpha.
- **Dead code:** `useApp.library`, `saveToLibrary`, `IndexedDbCabinetLibrary`. Cleanup after Alpha.

## Resume

1. `cd ~/Play.Code/playground.pixel/app && git fetch && git status && git log --oneline -1`.
2. Check open PRs from Desktop and Output; review in section 9 order. Every merge needs the owner's explicit approval.
