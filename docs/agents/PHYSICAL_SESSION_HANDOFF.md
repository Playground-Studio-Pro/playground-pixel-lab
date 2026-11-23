# Physical session handoff (for Codex or any agent)

State on 2026-11-23. Goal: finish the Alpha 0.1 physical tests with the owner. Talk to the owner in Spanish. Alpha 0.1 is **not** done until these pass. Delete nothing.

## Rules (from the owner)

- **Ask before every visible run** and wait for a clear yes to that run. Say which display, what appears, how it closes (Esc / Close, and the time limit). One yes covers one run.
- Visible output on the external SAMSUNG only. Never use `--allow-control-display`.
- Never run `electron` without `--smoke-test`, except the real app in O11 and D11, with the owner's yes.
- Don't weaken Electron security. Don't fix app code: report findings. If something unexpected happens, stop and report.
- Never force push, rebase or bypass checks. Never merge, or delete branches, worktrees or files. Don't touch `_backups/` or the sibling `desktop/` folder.
- The GitHub repository is **public** (the owner's choice for now). Commit no photos and no personal data.
- Report measured and seen separately. Say what wasn't tested.

## Where to work

- Worktree `~/Play.Code/playground.pixel/agents/desktop-engineering`, branch `test/d6-harness` at `92f4f91`. It is **local only**, with a clean tree; keep it local. Only one agent uses it at a time: the owner stops replying in the Claude "Desktop Engineering" session.
- Results so far: `desktop/docs/TEST-RESULTS.md` on that branch (physical session section, line 584 on). Add new results there and commit locally.
- Criteria: `docs/architecture/PHYSICAL_OUTPUT.md`, sections 2 (colour), 8.8, 8.11 and 9.
- `/Applications/Pixel Lab.app` is main + Wall Build (322aa28). It is not the build under test; ask the owner to quit it.

Before each visible run: check the display list (`system_profiler SPDisplaysDataType`) and that no Electron is running. Once at the start, run in `desktop/`:

```sh
npm test
npm run test:smoke
```

Expected: 92 tests pass and `DESKTOP_SMOKE_PASS` (the 92 and the smoke are Desktop Engineering's report).

## Status

| Test | Status |
| --- | --- |
| D6 simple full screen, Spaces on | Passed: bounds, no macOS UI, Esc and IPC close within 25 ms. The "margin" was the card's unlabelled first row and columns |
| D6 native full screen, Spaces on | Ran once: no animation or UI. It was focused 1.5 s after live; cause unproven |
| D6 Spaces off, and the final simple/native choice | **Open. Do it last:** it needs a log out. Simple is the provisional choice |
| D6 Close button in the interface | Open; test it in D11 |
| sRGB | With sRGB IEC61966-2.1 set, DisplayInfo reads BT709/SRGB. **Open:** the factory profile reading, and exact values at a processor or capture card (the owner hasn't said if one is available) |
| D7, D10 + O10, O9, O11, D11, Wi-Fi off run | Not run |

## Next steps, in order

1. **Factory profile (no window).** The owner picks "SAMSUNG" as the colour profile. Read the profile directly (NSScreen ICC data) and `DisplayInfo.colorSpace` in a hidden run. Pass: it isn't BT709/SRGB, so the warning shows. The owner then sets sRGB IEC61966-2.1 again; read it to confirm. The hidden command used must not include `--force-color-profile` (it overrides the reading); see the sRGB entry in TEST-RESULTS.
2. **D7** (harness ready, never run). From `desktop/`, after the owner's yes:
   ```sh
   PIXELLAB_ALLOW_VISIBLE_OUTPUT=1 npm run test:smoke:output -- --smoke-d7
   ```
   Read `desktop/src/smoke-mode.cjs` and the D7 code first for its time limit and steps. The owner unplugs the HDMI at the TV and plugs it back. Pass: the state becomes waiting-display, nothing moves to the built-in, and it comes back **held** until Resume (D-2).
3. **D10 + O10** 1:1 photos at scale 1, scale 2 and one scaled mode (the scaled one must visibly fail). Don't claim 1:1 from D6.
4. **O9** cadence: 240 fps phone video, 10 s per content rate; 30 fps for 10 minutes with 0 skipped frames.
5. **O11** Resolume Arena, section 8.11, with a version built from main.
6. **D11** 30-minute rehearsal in the real app, charger connected, including at least 5 minutes held with no display sleep, and the Open and Close buttons. The editor shows on the laptop: say so when asking.
7. One run with Wi-Fi physically off.
8. D6 with Spaces off, then record the decision. A failure in D6, D7 or D10 goes back for a fix and the session repeats from D6.

Steps 3–6 have no dedicated harness command listed here. Use what the repo has; if one is missing, report it instead of inventing a bypass.

## Not part of this

Wall Build (draft PR 57) and everything after Alpha 0.1. Nothing merges without the owner's explicit approval.
