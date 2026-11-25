# Codex handoff: finish the Alpha 0.1 tests and deliver the app

State on 2026-11-24, 23:55 (Mac time). Talk to the owner in Spanish, in short messages. Report facts only: measured, seen by the owner, or not tested.

## Deliver

1. The short visible run on the HP (below), with results written down.
2. A test app with the three pending fixes, in `~/Play.Code/playground.pixel/builds/`, and its path.
3. A list: passed, failed, not run, and what the owner must approve. **Alpha 0.1 isn't done** until every pending test is run or the owner accepts it as a limit. Never declare Windows support.

## Rules from the owner

- **Ask before every visible run**, saying which display, what appears, how long, and how to leave (Esc, Close, ⌘Q). One permission may cover a listed batch. Stop the batch if anything unexpected happens.
- Output on an **external** display only, with Pixel Lab on the laptop's own screen. Never use `--allow-control-display`.
- No `electron` run without `--smoke-test`, except packaged builds the owner opens themself.
- **Don't merge.** Merges need the owner's approval for each PR, CI green, no new commits since review: `gh pr merge N --merge --match-head-commit <sha>`. Tell the owner the PR is ready and leave it.
- Don't push, rebase, force push, bypass checks, or delete branches, worktrees, files or backups. Don't touch `_backups/`, the sibling `desktop/` folder or the owner's untracked files.
- Don't change app code or weaken Electron security. If a fix is wrong, write what you saw and stop.
- The GitHub repository is **public** (the owner's choice for now): commit no photos and no personal data.
- One agent per folder and one Electron at a time. The owner must not write in the Claude sessions (Desktop, Output, Content, Lead) while you work.

## Pull requests (all CI green; none merged)

| PR | Head | What | Before merging |
| --- | --- | --- | --- |
| 63 | `7d280cd` | Resolume package gives slice **centres** | Reviewed, ready. Owner's approval |
| 62 | `004faef` | Menu bar and Dock come back after closing an output | Hidden smoke passed. **Run 1** below |
| 64 | `40b6441` | 60 fps playback without the skip + repeat every ~2 s | Hidden O5, O6 and cadence passed. **Run 2** below |
| 58 | this file | Docs | Owner's approval |
| 57 | `322aa28` | Wall Build, draft | Waits for Alpha 0.1 |

`main` is `8ba1e7d`. Merge order when the owner approves: 63, 62, 64. **62 and 63 both add a line at the same place in `CHANGELOG.md`:** merging one makes the other conflict. Don't resolve it yourself: its lane merges main in, and the owner approves the new head. After 64, the uneven-cadence warnings (PHYSICAL_OUTPUT 8.6) are still to be built by Output Engineering: not part of this handoff.

## Prepare (no windows)

1. Check: `system_profiler SPDisplaysDataType` shows the built-in as **Main** and the HP 27er 1920 × 1080; no Arena, Pixel Lab or Electron running.
2. The test app is **already built** by the Lead: `~/Play.Code/playground.pixel/builds/test-62-63-64/Pixel Lab.app` (main `8ba1e7d` + the code of PRs 62, 63 and 64, not `main`). Typecheck, lint, 540 tests, 98 desktop tests and the hidden smoke passed on that combination. The packaged app itself hasn't been opened. To rebuild it, apply each `git diff origin/main...<branch> -- . ':!CHANGELOG.md'` to a `git archive` of main.
3. The harness for Run 2 is the worktree `~/Play.Code/playground.pixel/agents/desktop-engineering`, branch `test/d6-harness` at `fcbc9fc` (**local only, never push**). For the fixed code, merge `fix/playback-grid` into it locally and rebuild `build:web`.

## Run 1: the menu bar (real app, owner's hands)

Read the presentation options from outside, with Pixel Lab in front (5 = hidden, 0 = normal):

```sh
osascript -l JavaScript -e 'ObjC.import("AppKit"); ObjC.unwrap($.NSWorkspace.sharedWorkspace.frontmostApplication.localizedName)+" "+$.NSApplication.sharedApplication.currentSystemPresentationOptions'
```

Quit every other Pixel Lab first: all builds share one profile. Use the Pixel test project, imported from `tests/fixtures/pixel-test.pixellab.json`.

- **A, the bug:** `builds/main-8ba1e7d`. Open on the HP, Close. Expected 5. Quit it.
- **B, the fix:** the test build. Open then Close; open again then Esc. **Pass:** 0 after each, and the owner sees the menu bar and Dock. This also covers the interface's Open and Close.
- If Pixel Lab opens on the HP instead of the laptop, stop.

## Run 2: 60 fps on the HP (from `agents/desktop-engineering/desktop`)

```sh
PIXELLAB_ALLOW_VISIBLE_OUTPUT=1 npm run test:smoke:output -- --smoke-phys=o9-60
PIXELLAB_ALLOW_VISIBLE_OUTPUT=1 npm run test:smoke:output -- --smoke-phys=o9-rates
```

`o9-60` opens 10 times, about 12 s each, 160 s at most. Run it first on the current harness (baseline), then with `fix/playback-grid` merged. Notes:
- The old counter **can't see skips** at 60 on 60, so compare `repeated`. In a simulation the bug showed in 5 of 20 start phases, so a clean baseline proves nothing either way.
- **Pass with the fix:** 0 skipped and 0 repeated in all 10 opens, and 0 in `o9-rates`. Hidden runs gave 0–2 repeats per 20 s on a virtual display. Report any number other than 0 as it is; don't explain it away.

## Then, if the owner has time

| Test | How |
| --- | --- |
| D11, 30-minute rehearsal | Real app on the HP at 30 fps, charger connected, at least 5 minutes held, skipped counts read (this covers the skipped 10-minute O9) |
| Wi-Fi off | One full flow with Wi-Fi physically off |
| New Resolume package | From the test build, type its centres into Arena; no arithmetic by hand |
| O10 leftovers | Sharper top-left photo, macOS scaled mode, touching seam |
| Samsung at 2× and D6 Spaces off | Last: Spaces off needs a log out |

Pending and not possible today: exact colour values at a processor or capture card; 240 fps video; Windows; a licensed Arena.

## Already passed (don't repeat)

- D6 simple full screen on the Samsung; D7 on the HP (75 ms strip on the laptop at unplug, **accepted by the owner**); sRGB detection; O10 at 1× in part.
- Resolume Arena 7.28.1 (trial, macOS), parts A and B, in Arena's output window: offset 0. Not the cable. MP4 length fixed (PR 61) and confirmed in Arena.

Write results in `desktop/docs/TEST-RESULTS.md` on `test/d6-harness` and commit there, locally. Finish with the list in "Deliver".
