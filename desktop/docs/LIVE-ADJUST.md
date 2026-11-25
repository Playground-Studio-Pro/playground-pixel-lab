# Live adjust: measurements and design (proposal, not approved)

Fast map step 3: a screen moved with the arrow keys reaches an open output without pressing Update output.
Status: measured, designed, no product code. For review by the Lead Architect. It changes owner decision D-4 (PHYSICAL_OUTPUT section 4: "only on Update output"), so the owner decides that part.

**Recommendation:** `output:update` as it stands is enough. It needs no new channel, no contract change, and no change in main. The work is on the control side: a sender that coalesces moves, plus a Live switch. Main gets one optional guard (section 5).

## 1. What one update costs today

Hidden smoke run, nothing shown: `desktop/tests/smoke-scripts/live-update-cost.cjs`, projects from `live-update-fixture.cjs`.
- Projects: 8, 32 and 60 screens on a fixed 1920 × 1080 master and output, the same pixel area each time. Each update moves screen 1 by 1 px.
- Clock: paused, so a paint means the new revision.
- Machine and run: MacBook Pro M1 Max, macOS 26.2, Electron 43, `origin/main` b433074.
- Virtual display: the laptop's geometry, 3024 × 1964 at 2×. 40 sequential updates per case, after 3 warm-up updates.
- Times are on the shared clock (`performance.timeOrigin + performance.now()`), from just before the control page calls `update()`.

| Screens | Source | Invoke resolves (main validated and forwarded) | Page starts parsing | Paint starts | Paint done | Paint takes |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | test card | 0.3 / 0.3 ms | 0.3 / 0.3 | 5.1 / 8.4 | 18.1 / 21.1 | 12.8 / 13.5 |
| 8 | pixel grid | 0.7 / 3.4 | 0.7 / 1.7 | 4.9 / 9.8 | 7.8 / 12.3 | 2.5 / 4.2 |
| 32 | test card | 0.4 / 0.5 | 0.3 / 0.5 | 5.2 / 8.6 | 20.6 / 23.5 | 14.8 / 16.1 |
| 32 | pixel grid | 0.4 / 0.5 | 0.5 / 0.6 | 4.3 / 8.1 | 6.2 / 10.1 | 1.4 / 2.4 |
| 60 | test card | 0.5 / 0.6 | 0.5 / 0.6 | 5.1 / 8.7 | **24.9 / 29.6** | 19.4 / 21.1 |
| 60 | pixel grid | 0.5 / 0.6 | 0.6 / 0.8 | 4.7 / 8.6 | 6.5 / 10.4 | 1.7 / 2.4 |

p50 / p95. What the numbers show:
- **The mapping is not the cost.** Main's `validateSession` takes ≤ 0.1 ms at 60 screens (37 KB of project text). The page parses in ≤ 0.2 ms. In Node, `serializeProject`, `parseProjectFile`, `resolveMapping`, `videoTargets` and `validateProject` each take ≤ 0.16 ms p95 at 60 screens.
- **The time goes to waiting for the next frame and to the paint.** The test card redraws the whole master every paint, then cuts it (O-1), and its paint grows with the screen count: 13 ms at 8 screens, 19 ms at 60.

**30 updates a second for 30 s**, 60 screens, sent without waiting:

| Source | Sent | Refused | Drawn | Send → paint starts | Renderer memory |
| --- | --- | --- | --- | --- | --- |
| test card | 900 | 0 | 900 | p50 1.9 ms, p95 3.0, max 9.9 | 211 → 226 MiB |
| pixel grid | 900 | 0 | 900 | p50 4.4 ms, p95 8.9, max 11.5 | 111 → 131 MiB |

Revision order held: the last revision sent was the last one drawn, and none was dropped. The memory rose 15–19 MiB over 30 s. That run is too short to tell a leak from cache growth.

**Not measurable without a panel:**
- The time to glass: the next vsync, the compositor and the panel's own delay. Add about one to two refreshes, 17–33 ms at 60 Hz.
- Cadence on a real monitor (O9 territory).
- The HP's 60 Hz instead of this window's grid.
- Depth Studio as the source (not measured).
- Whether a move looks smooth to the operator.

A hidden window's frames are Chromium's, not a display's vsync.

## 2. The clock

**An update does not restart the content, today.** "Plays from frame 0" applies to **Open** only: `playingFromStart` builds the first clock.

How Update works:
- It sends `updateClock(last.clock, …)`, which is the same clock: same `epochMs` and `startFrame`. The page computes the frame from that clock on every refresh, so it carries on.
- After a disconnect, held and Resume, main has re-timed the output. The panel then re-anchors at the last reported frame.

Measured: a test card at 30 fps on 60 screens, reports sampled.

| Phase | Updates | Frame went back | Frames behind the clock when sampled | Skipped / repeated | Late frames |
| --- | --- | --- | --- | --- | --- |
| None, 5 s | 0 | no | 0–1 | 1 / 0 | 2 |
| 1 a second, 10 s | 10 | no | 0–1 | 0 / 0 | 10 |
| 30 a second, 10 s | 300 | no | 0–1 | 0 / 0 | **326** |

The late frames are the one real cost found:
- A playing source paints every content frame, and every update adds a paint in between.
- At 60 screens the test card takes about 19 ms to paint.
- So 30 updates a second on 30 fps content asks for about 60 paints of 19 ms each second: more than the frame budget. Frames arrive late, but none is skipped or repeated, and the frame number stays on the clock.

Live must therefore keep its own rate below the content rate (section 3), and the rate must be checked on the HP before it's fixed.

## 3. Design

**Live is off by default and turned on by hand.**
- **Where:** a "Live" switch next to Update output. It shows only while the output is `live`.
- **Turning on:** it sends the current state at once.
- **While on:** every change to the project's mapping is sent to that output, coalesced.
- **Turning off:** on Close, on Esc, when the output fails or closes for any reason, when another project opens, and on quit. It is never remembered or saved, and never on when an output opens.
- **What stays:** explicit Open, Esc and Close, the operator display rule (`allowControlDisplay` by tick, every time), 1:1 only, and main's validation and size limits, all unchanged.

**Sender (control side, one per open output):**
- **Latest wins.** At most one update in flight. While one is in flight or inside the interval, only the newest project is kept; older ones are dropped, never queued.
- **Rate:** at most one update every 50 ms (20 a second) to start with, below 30 fps content. The last change always goes out (trailing edge), so the final position always lands. The number is provisional until it's measured on the HP. macOS key repeat runs at roughly 10–30 a second depending on the Keyboard setting (not measured here). A held arrow key therefore sends at most 20 updates a second, and the last one is exact.
- **Revision order:** the next revision is `max(last sent, status.sessionRevision) + 1`, and is sent only after the previous invoke has resolved. Main refuses a revision that doesn't go up (`BAD_REQUEST`), so order can't be broken from outside.
- **Clock:** `updateClock` as today. A move never changes the clock.
- **What a session carries:** the whole project text, as today. 37 KB at 60 screens costs under 1 ms. A diff format would be a new contract for no measured gain.

**Invalid map.** The wall keeps the last good map, and the operator sees why.
- **Control side, first:** while `validateProject` has errors, the sender sends nothing. The switch stays on and reads "Live paused: <first error>". Sending resumes on the first valid state. Today's Update button doesn't check mapping errors, and Live must.
- **Page side, the backstop that already exists:** a session the page can't prepare (`PROJECT_INVALID`, a screen of this output that can't be placed) leaves the previous one on screen and reports `errorCode`. The status keeps `live` with `error` set, and the panel shows it. The next good update clears it.
- **Overlaps:** `validateProject` already raises an overlap as an error, so a move into a neighbour is held at the last good position.

**States:**

| Output state | Live sender |
| --- | --- |
| `opening` | Sends: main keeps the latest and sends it on ready |
| `live` | Sends |
| `waiting-display`, `held` | Holds: main refuses with `BAD_REQUEST` (D-2). On Resume (back to `live`) it sends the newest state once, if it changed |
| `failed` | Turns off. Retry re-sends main's stored latest |
| closed / reopened | Off. A reopen starts with Live off and the current project in the open session |

**Two outputs.** Alpha runs one (`MAX_OUTPUTS = 1`). When there are more, each open output has its own sender, revision and switch. One edit goes to each output whose switch is on. An error blocks every output: the wall is one show.

**No new channel.** It uses `output:update`, `output:status` and the existing status push. `src/domain/physical-output.ts` stays as it is.

## 4. Files and owners

| File | Owner | Change |
| --- | --- | --- |
| `src/modules/output/output-control.ts` | Output Engineering | Pure `createLiveSender` with rate, latest wins, revision, state rules and error gate. Clock and timer injected |
| `tests/output-live.test.ts` (new) | Output Engineering | Coalescing, trailing edge, revision order, held/waiting/failed/closed, invalid map, clock kept |
| A small live-output store in `src/modules/output/` (new) | Output Engineering | Keeps the senders and the last sent clock and revision. Today they're a `useRef` in `output-controls.tsx`, so they'd be lost when the Output panel isn't on screen, as in the fast map |
| `src/modules/output/output-controls.tsx` | Output Engineering | The Live switch and the "Live paused" line; Update output reads the same store |
| Fast map step 3 (the `feature/fast-map` interface) | Mapping Engineering | Shows the switch's state and the paused reason. Arrow moves are the existing `nudgeSelection` edits (`src/components/workspace/app.tsx`), so nothing new is needed to produce them |
| `src/engines/` | Mapping Engineering | No change: `validateProject` and `resolveMapping` already give what the gate needs |
| `desktop/src/output-controller.cjs` and its test | Desktop Engineering | Optional guard (section 5) |
| `docs/architecture/PHYSICAL_OUTPUT.md` section 4 and the D-4 row | Lead Architect | "Explicit Update by default; Live by hand, off on close". Owner decision |
| This file, `desktop/tests/smoke-scripts/live-update-*.cjs` | Desktop Engineering | Measurements |

Output Engineering is busy with MP4 per screen, so the control-side work waits for them or for the Lead to reassign it.

## 5. Optional guard in main

Main forwards every valid update today. A control-page bug could send updates as fast as IPC allows, and each one costs a `JSON.parse` in main and a preparation in the page.

The guard: per output, forward at most one update every 33 ms, keep only the latest in between (main already keeps the latest session for Retry), and send it at the end of the interval. Revision and validation rules stay the same, and the invoke still resolves at once with the status.

It's about 20 lines and a unit test, and it changes nothing the sender in section 3 would notice. It's not needed for the measured case. Lead's call.

## 6. Open, before it's fixed

- Measure the rate on the HP at 60 Hz with 30 fps content: late frames, and smoothness by eye, at 10, 15, 20 and 30 a second. That needs the owner's yes for a visible window.
- A 10-minute rate run for memory, hidden.
- Depth Studio as the source: a GPU paint, not measured.
