# Desktop test results: Alpha 0.1 Phase B

Date: 2026-11-18. Branch `feature/desktop-engineering`, with `origin/main` at `0c7c644` merged in. Supersedes the 2026-11-13 results, which ran without network and never launched Electron.

Machine: MacBook Pro, Apple M1 Max, macOS 26.2 (25C56), Node 24.13.1, npm 11.8.0. Electron 43.8.10, electron-builder 26.18.0.

✅ verified · 🟡 partial · ❌ failed · ⬜ not tested

## Summary

| Area | Result |
| --- | --- |
| Electron launches on macOS (dev and static) | ✅ |
| Works offline (static `app://` build, DNS blocked) | ✅ simulated; ⬜ with Wi-Fi physically off |
| Mapping, Live preview, Content (Depth Studio), Output test card | ✅ |
| Engineering studio | 🟡 opens; it's a placeholder ("its tools are being built") |
| Autosave and recovery after quit and relaunch | ✅ |
| Project file export and import through native dialogs | ✅ |
| MP4 export of an output test card inside Electron | ✅ ffprobe-checked, plays in QuickTime |
| Unsigned `.app` (`pack:mac`) launched from a path with spaces | ✅ |
| Signed / notarized build, DMG, Gatekeeper on another Mac | ⬜ out of Phase B |
| Windows | ⬜ not run. No Windows support is claimed |

## 1. Merge and install

```sh
git fetch origin && git merge origin/main     # clean, no conflicts → 4098e6b
npm ci                                        # root
npm --prefix desktop ci                       # Electron runtime downloaded
npx --prefix desktop electron --version       # v43.8.10
```

The first `npm --prefix desktop ci` failed in Electron's postinstall with `TypeError: fetch failed`. A direct `fetch` of the same release URL succeeded seconds later and a second `npm --prefix desktop ci` installed the runtime. Treated as a transient network error; nothing was changed to work around it.

## 2. Local fonts

`src/app/layout.tsx` now uses `next/font/local` with `src/app/fonts/Inter-latin-wght.woff2` and `JetBrainsMono-latin-wght.woff2`: the same Google Fonts latin variable subsets `next/font/google` used to download, with their SIL OFL 1.1 texts beside them ([fonts README](../../src/app/fonts/README.md)). No npm dependency added. 88 KB of fonts committed.

In Electron, `document.fonts` reports Inter loaded, and the calibration face loads on the Output test card from `app://pixellab/_next/static/media/JetBrainsMono_latin_wght….woff2`.

## 3. Checks

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | 302/302 tests in 23 files |
| `npm run build`, with outbound network denied | Pass |
| `npm --prefix desktop test` | 6/6 (5 before the debugging guard) |
| `npm --prefix desktop run build:web`, with outbound network denied | Pass after the staging fix below. Static output 2.4 MB |

"Outbound network denied" means run under `sandbox-exec` with a profile that denies every remote IP except localhost; `curl https://github.com` fails inside it.

**Staging fix.** `build:web` first failed type-checking: `tests/output-calibration.test.ts` imports `prototypes/output-video/calibration-source`, and `desktop/scripts/stage.mjs` didn't copy `prototypes/`. Added `prototypes` to the staged folders. No other desktop code changed.

## 4. Smoke tests

| Command | Result |
| --- | --- |
| `npm --prefix desktop run test:smoke` (static) | `DESKTOP_SMOKE_PASS`: title, sandbox, context isolation, no Node globals, bridge, IndexedDB |
| `npm --prefix desktop run dev -- --smoke-test` | `DESKTOP_SMOKE_PASS`; Next dev server on 127.0.0.1:3210 started and stopped with Electron |

`ffmpegStatus()` reports `available: false` ("Approved FFmpeg binary is not installed"), as expected: no FFmpeg is bundled.

Electron can't run inside `sandbox-exec` (Chromium's own sandbox fails to initialise: `GPU process isn't usable`), so the smoke tests and the session below ran without it.

## 5. Interactive session, offline

Launched the static build with DNS disabled for every host:

```sh
cd desktop
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . \
  --remote-debugging-port=9333 '--host-resolver-rules=MAP * ~NOTFOUND'
```

The UI was driven through the Chrome DevTools Protocol (clicks, typing, screenshots) and the native macOS dialogs with the mouse. Evidence of offline operation:

- Every request recorded while opening a project and switching studios was to `app://pixellab/` (scripts, the JetBrains Mono font, the Playground Studio logo). None went to the network.
- `fetch("https://example.com")` from the page fails. The CSP (`connect-src 'self'`) would block it anyway.
- **Not done:** a run with Wi-Fi physically off. `navigator.onLine` stays `true` under the resolver rule, so any code gated on it wasn't exercised. Worth one manual check before the field test.

| Step | Result | Evidence |
| --- | --- | --- |
| Start screen with the four examples | ✅ | [01](evidence/phase-b/01-start.jpg) |
| Open Festival Main Stage: 6 screens, 5120 × 1664, 8,585,216 LED pixels, no check problems | ✅ | [02](evidence/phase-b/02-festival.jpg) |
| Edit: rename to "Electron Offline Test"; IMAG Left rows 10 → 9, resolution 768 × 1280 → 768 × 1152, 54 cabinets | ✅ autosaved ("Saved") | |
| Mapping → Live preview: animates, Target 30 fps, browser preview ~120 fps (that's the display's refresh, not LED refresh) | ✅ | [04](evidence/phase-b/04-live-preview.jpg) |
| Content studio (Depth Studio, Emerald Chamber): WebGL2 available, scene renders and plays | ✅ | [05](evidence/phase-b/05-content.jpg) |
| Engineering studio | 🟡 placeholder only | |
| Output → Calibration test card for OUT 1 · Processor A, 3072 × 1920 | ✅ | [07](evidence/phase-b/07-output.jpg) |
| Corporate Keynote example opens | ✅ | |

## 6. Persistence

| Step | Result | Evidence |
| --- | --- | --- |
| Quit (Electron menu → Quit), relaunch: the edited project reopens with its name and IMAG Left at 768 × 1152 | ✅ | |
| Export → Project file (.json): native Save As, writes `electron-offline-test.pixellab.json` (5.3 KB, `schemaVersion: 2`, IMAG Left `rows: 9`) | ✅ | |
| Project menu → Import project file: native Open dialog, file imported as a new project; the original stays | ✅ | [13](evidence/phase-b/13-import-dialog.jpg), [10](evidence/phase-b/10-after-import-list.jpg) |
| The packaged app (section 8) opens the same data: it shares the `Pixel Lab Desktop` user-data folder with the unpackaged build | ✅ | [11](evidence/phase-b/11-packaged-output.jpg) |

Data lives in `~/Library/Application Support/Pixel Lab Desktop/IndexedDB` (database `playground-pixel-lab`). Smoke tests use `Pixel Lab Desktop Smoke`.

## 7. MP4 inside Electron

Output → Export MP4, Calibration test card, Identification, OUT 1 · Processor A, 30 fps, 10 s. Native Save As, then the app reports "Saved … 3072 × 1920, 300 frames at 30 fps, 0.8 MB".

```text
$ ffprobe electron-offline-test-calibration-out-1-processor-a-3072x1920-30fps-10s.mp4
codec_name=h264  profile=High  codec_tag_string=avc1  pix_fmt=yuv420p
width=3072  height=1920  r_frame_rate=30/1  avg_frame_rate=30/1
format_name=mov,mp4,…  duration=10.000000  size=805895
counted frames: 300
ffmpeg -i … -f null -   → decodes with no errors
```

Played in QuickTime Player ([12](evidence/phase-b/12-quicktime.jpg)); a frame at 5 s matches the preview ([08](evidence/phase-b/08-mp4-frame5s.jpg)).

Electron's log shows the encode went through **OpenH264**, Chromium's software encoder, not VideoToolbox. Fine for a still test card at this size; speed on long or 4K animated exports wasn't measured. The stream-level `nb_frames` is `N/A` (the muxer doesn't write it); counting decoded frames gives 300.

Only one output and one test card pattern were exported. Outputs over 4096 px a side are refused by design.

## 8. Unsigned `.app`

```sh
npm --prefix desktop run pack:mac   # build:web + electron-builder --mac --arm64 --dir
```

- Output `desktop/dist/mac-arm64/Pixel Lab.app`, **301 MB**. electron-builder downloaded its own copy of the Electron zip for packaging (it doesn't reuse `node_modules/electron`): packaging needs network the first time.
- Signing skipped (no Developer ID). Since the fuses below, electron-builder re-signs the bundle ad-hoc after flipping them: `codesign --verify --deep --strict` passes and `codesign -dv` shows `Identifier=studio.playground.pixellab`, `flags=0x2(adhoc)`, no team. Before the fuses it carried only Electron's linker signature, which `spctl` rejected as inconsistent. Ad-hoc is still not Gatekeeper-approved on another Mac.
- Default Electron icon (no product icon set).
- Copied with `ditto` to `…/Pixel Lab Test/Ruta con espacios/Pixel Lab.app` and opened with `open -n`. It launches, loads `app://pixellab/`, reopens the last project and renders the Output test card ([11](evidence/phase-b/11-packaged-output.jpg)).
- It ran because a locally built app isn't quarantined. A copy downloaded or AirDropped to another Mac will be blocked by Gatekeeper until it's signed and notarized (or the user overrides it).

### Debugging locked in distributed builds

Asked by the owner before merging. Two layers, both only when `app.isPackaged`:

1. **Startup guard** in `src/main.cjs`, before anything else runs: `debugAccessViolations()` (`src/security.cjs`, pure, unit-tested) checks `app.commandLine.hasSwitch()` and `process.argv` for `--remote-debugging-port`, `--remote-debugging-pipe`, `--remote-debugging-address`, `--inspect`, `--inspect-brk`, `--inspect-port`, `--inspect-publish-uid`, `--debug`, `--debug-brk`, and the environment for a non-empty `ELECTRON_RUN_AS_NODE` or `NODE_OPTIONS`. If any is present it removes the switches, prints why and exits with code 1. Remote debugging has no fuse, so this guard is what blocks it.
2. **Electron fuses** in `electron-builder.yml` (`electronFuses`, built into electron-builder 26.18 through its own `@electron/fuses` 1.8.0; no new dependency). Read back from the built binary:

| Fuse | State |
| --- | --- |
| RunAsNode | disabled |
| EnableNodeOptionsEnvironmentVariable | disabled |
| EnableNodeCliInspectArguments | disabled |
| EnableEmbeddedAsarIntegrityValidation | enabled |
| OnlyLoadAppFromAsar | enabled |
| EnableCookieEncryption, LoadBrowserProcessSpecificV8Snapshot | disabled (defaults, untouched) |
| GrantFileProtocolExtraPrivileges | enabled (default, untouched: the `app://` handler reads files with `net.fetch(file://…)`) |

Nothing reopens debugging in the `.app`: no variable or config file is read for it. `PIXEL_LAB_DEV_URL` and `--smoke-test` are already ignored when packaged (`!app.isPackaged &&` in `main.cjs`).

Packaged `.app` from `…/Pixel Lab Test 2/Ruta con espacios/`, each case started from the terminal, waited 4 s, then `curl http://127.0.0.1:9333/json/version`:

| Launch | Result |
| --- | --- |
| `--remote-debugging-port=9333` | exit 1, "Pixel Lab refuses to start: debugging is disabled in distributed builds (--remote-debugging-port)"; curl fails |
| `--remote-debugging-pipe` | exit 1, same message |
| `--inspect=9229`, `--inspect-brk`, `--inspect-port=9229` | exit 1, same message |
| `ELECTRON_RUN_AS_NODE=1` | exit 1, same message |
| `NODE_OPTIONS=--inspect` (also `=9229`, `--inspect-brk=9229`) | **starts normally**, no listening TCP port at all, port 9229 refuses. The fuse neutralises the variable, and it never reaches the guard, which suggests Electron removes it before the main script runs. Debugging stays off, but this case doesn't exit with an error |
| No flags, `PIXEL_LAB_DEV_URL=http://127.0.0.1:3210/` set, nothing listening on 3210 | Opens normally from `app://` and reopens the last project ([14](evidence/phase-b/14-packaged-no-debug-flags.jpg)); curl fails |

Development keeps explicit debugging:

| Launch | Result |
| --- | --- |
| Unpackaged `Electron . --remote-debugging-port=9333` | `/json/version` answers (Chrome/150.0.7871.250) |
| `npm run dev -- --remote-debugging-port=9335` | `/json/list` shows the page at `http://127.0.0.1:3210/` |
| `npm run test:smoke` | `DESKTOP_SMOKE_PASS` |

Not covered: other Chromium switches that weaken security without being debuggers (for example `--disable-web-security`, `--js-flags`). They weren't in scope.

## Not tested

- Wi-Fi physically off (see section 5).
- The full Resolume Arena workflow, and loading the MP4 in Arena.
- MP4 of animated sources, other test-card patterns, or long durations; encode speed.
- DMG / ZIP targets (`dist:mac`), signing, notarization, Gatekeeper on a second Mac.
- Windows (`dist:win`), on purpose.
- Multiple monitors and full-screen output (Phase C).
- The optional `window.pixelLabDesktop.openProject/saveProject` bridge: still not wired into the UI. Import and export use the app's existing file input and Blob download, which go through Electron's native dialogs.

## Leftovers noticed

- `desktop/tests/font-response.cjs` is a Google Fonts mock that nothing references, obsolete now that fonts are local. Left in place: deleting files was out of scope.

# Phase C tasks

Contract: [PHYSICAL_OUTPUT](../../docs/architecture/PHYSICAL_OUTPUT.md). One section per task, newest last.

## D1. Window registry (2026-11-18)

`desktop/src/windows.cjs` (pure, no Electron import) replaces the single `window` variable in `main.cjs` with a control window plus a map of output windows, limited by `MAX_OUTPUTS = 1`. Every IPC handler now checks the sender against a **role**: exact `WebContents` of the window registered for that role, main frame only, and a URL allowed for that role. The output route (`app://pixellab/output.html`, `<dev origin>/output`) is allowed only for output windows, and the control window may show anything on the origin except it. No output window is created yet (D5); nothing is relaxed.

Also tightened: the control window now blocks `will-redirect` outside its allowed URLs, as it already did for `will-navigate`, and the Blob download check uses the registry's role.

| Check | Result |
| --- | --- |
| `npm --prefix desktop test` | 16/16 (the 6 existing tests unchanged, 10 new in `tests/windows.test.cjs`) |
| `npm run typecheck`, `npm run lint`, `npm test` | pass, 302/302 |
| `npm --prefix desktop run build:web`, `test:smoke` | pass, `DESKTOP_SMOKE_PASS` (the smoke test calls `ffmpegStatus()` through the checked IPC) |
| `npm --prefix desktop run dev -- --smoke-test` | pass; dev server stopped with Electron |
| Manual, static build: `location.href = "app://pixellab/output.html"` and `"https://example.com/"` from the control window | Both blocked; the page stays at `app://pixellab/` |
| Manual: Export → Project file | Native Save As appears (Blob download still allowed for the control window); cancelled |

New tests cover, for both `app://` and the dev origin: control channels reject an output window's sender and the reverse; an unregistered or invalid output id is rejected; child frames, foreign `WebContents`, a control window at the output route and foreign URLs are rejected; a destroyed window authorises nothing; `ALREADY_OPEN`, `TOO_MANY_OUTPUTS` and the output id pattern.

Not tested: output-window sender checks against a real output window (none exists until D4/D5); `will-redirect` with a real redirect (the static app never redirects).

## D2. Displays (2026-11-18)

`desktop/src/displays.cjs` (pure): `toDisplayInfo` builds the contract's `DisplayInfo` from Electron's `Display`; `devicePxOf` gives the framebuffer size (macOS: bounds × scale; Windows: `screen.dipToScreenRect`, `devicePxExact: false` when the DIP product is fractional); `matchDisplay` implements section 1's two levels; `reliableMatch` implements owner decision D-2: reliable only with exactly one candidate at level 1 or 2 and no other connected display sharing that label and `devicePx`. `main.cjs` adds `output:list-displays` (control role only) and pushes `output:displays-changed` to the control window after `display-added`, `display-removed` and `display-metrics-changed`, debounced 250 ms. The control preload exposes `pixelLabDesktop.output.listDisplays()` and `onDisplays()`.

| Check | Result |
| --- | --- |
| `npm --prefix desktop test` | 24/24 (8 new in `tests/displays.test.cjs`) |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | pass, 302/302 |
| `test:smoke` (static) and `dev -- --smoke-test` | pass; the smoke test now calls `listDisplays()` and checks integer `devicePx`, one primary display and valid rotation |

Static smoke output on the dev Mac (MacBook Pro M1 Max, built-in display only):

```json
{"label":"Built-in Retina Display","internal":true,"primary":true,"scaleFactor":2,
 "devicePx":{"width":3600,"height":2338},"devicePxExact":true,"refreshHz":120.0006103515625,"hostsControlWindow":true}
```

3600 × 2338 is the **framebuffer** of the "More Space" scaled mode (1800 × 1169 DIP at 2×); the panel itself is 3456 × 2234. This is the macOS scaled-mode case in section 1: Electron reports the framebuffer exactly and can't see the panel. `refreshHz` comes back fractional (120.0006); consumers should round for display and compare with a tolerance.

Unit fixtures: macOS 2× built-in and 1× external; Windows 125 % on 1920 × 1080 (exact) and 1366 × 768 (`devicePxExact: false`), 150 %; rotation 90; level 1 / level 2 / no match (other size, other label, internal vs external); D-2: same monitor on the same or a new id (reliable), **identical twins** both connected with old or new ids (ambiguous), a shared empty label (ambiguous), a lookalike differing only in `internal` (ambiguous); debounce of a burst.

Not tested: real `display-added` / `removed` / `metrics-changed` events (needs plugging a monitor, task D7 **[monitor físico]**); Windows `dipToScreenRect` (stand-in function in tests; **Windows only, not claimed**). Known limit: with only the other identical twin connected, label + size can't tell it apart from the original (level 2, reliable); documented in the contract's risks.

## D3. IPC validation (2026-11-18)

`desktop/src/output-ipc.cjs` (pure): hand-written validators for `OutputOpenRequest`, `OutputSession`, `OutputClock`, `DisplayKey`, `OutputRenderReport` (including every optional field of 8.4, with its bounds) and `OutputId | '*'`; the section 5 item 4 1:1 comparison (`oneToOne` → `exact` / `pending` / `warning` / `error` with `NOT_ONE_TO_ONE`); `sizeMatchOf` with `croppedPx` / `blackPx`. Errors are `OutputIpcError` with a contract code. Main checks a project only by envelope and output id (`PROJECT_INVALID`, `UNKNOWN_OUTPUT`); deep validation stays in the control window and the output page. Settings must be plain JSON (no Dates, Maps, typed arrays, non-finite numbers), nested at most 64 deep, at most 1 MiB. Not wired to channels yet: `output:open` and the rest arrive with D5.

Also in this PR:

- `--force-device-scale-factor` joins the packaged refusal list (section 5 item 5).
- `desktop/src/api.d.ts` imports `OutputControlApi` from `src/domain/physical-output.ts` instead of copying `DisplayInfo`.
- `tests/desktop-contract-parity.test.ts` (root, vitest) keeps the CJS copies of states, error codes, render error codes, size matches, content rates, channel names, `MAX_OUTPUTS` and the `OutputId` pattern equal to the contract.
- CI (`.github/workflows/ci.yml`) now runs `npm --prefix desktop ci --ignore-scripts` and `npm --prefix desktop test`.

| Check | Result |
| --- | --- |
| `npm --prefix desktop test` | 34/34 (10 new in `tests/output-ipc.test.cjs`; the debugging-switch test now includes the scale switch) |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | pass; 309/309 tests in 25 files (4 new parity tests) |
| Desktop tests in a clean copy after `npm --prefix desktop ci --ignore-scripts` (no Electron binary) | 34/34, as CI will run them |
| `test:smoke` (static) | pass |
| `pack:mac`, packaged app with `--force-device-scale-factor=1` | exit 1, "refuses to start: debugging and display-scale switches are disabled in distributed builds (--force-device-scale-factor)" |
| Unpackaged Electron with `--force-device-scale-factor=1` on the 2× built-in display | starts, `devicePixelRatio` = 1 (what O5's 1× run needs) |

Not tested: the CI run on Linux itself until the PR's checks report (the electron-builder configuration test is plain JavaScript and should run there); validators against real messages from an output window (D4/D5, O4).

## D4. Output preload and allowlisted route (2026-11-19)

- `desktop/src/output-window.cjs`: `outputWindowOptions` (frameless, black, hidden until placed; sandbox, isolation, no Node, no webviews, no background throttling, zoom 1, DevTools only unpackaged) and `createOutputWindow`, which denies popups, blocks `will-navigate` / `will-redirect` outside the output URL, blocks webviews, locks zoom after load and loads the one allowlisted URL (`app://pixellab/output.html`, `<dev origin>/output`).
- `desktop/src/output-preload.cjs`: exposes only `window.pixelLabOutput` (`version`, `onSession`, `onClock`, `onDisplay`, `ready`, `report`), frozen. No `pixelLabDesktop` in output windows.
- `main.cjs`: `openOutputWindow(outputId, bounds)` registers the window under its id (D1 registry, `MAX_OUTPUTS` 1) and drops it on close. `output:ready` and `output:report` are accepted only from a registered output window's main frame at its URL; reports pass `validateReport` and are limited to one per 450 ms (contract: at most 2 per second). Nothing calls `openOutputWindow` outside the smoke test yet: placement, full screen, Esc, the state machine and the control-window channels are D5.
- `assetPath` already maps `app://pixellab/output.html` to `web/output.html`; now tested.
- **Stub page.** The real page is Output's `src/app/output/page.tsx` (O4), exported as `output.html`, as the contract fixes it (8.1, 8.12 #12). Until it exists, `build:web` copies `desktop/resources/output-stub.html` (black, no external resources, `cursor: none`; calls `ready()` and sends one report) to `web/output.html`, and prints that it did. When O4's page is in the export, the stub isn't used.

| Check | Result |
| --- | --- |
| `npm --prefix desktop test` | 40/40 (6 new in `tests/output-window.test.cjs`: window options, allowlisted URL and navigation guards for `app://` and dev, `output.html` in `assetPath`, preload surface with a mocked `electron`, stub content) |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | pass, 349/349, lint 0 problems |
| `build:web` | pass; prints "Output page not in the export yet (O4): using … output-stub.html" |
| `test:smoke` (static) | pass. Opens an output window: URL `app://pixellab/output.html`; API keys exactly the six above; no `pixelLabDesktop`, `process` or `require`; `window.open` returns null; sandbox and isolation on; navigation to the editor and to `https://example.com/` blocked; the window is refused on control channels and accepted on its own; `ready` and a validated report reach main; closing it empties the registry |
| `dev -- --smoke-test` | pass; the output part is skipped with a message, since the dev server has no `/output` until O4 |
| `electron-builder --dir` | `app.asar` contains `output-preload.cjs`, `output-window.cjs`, `output-ipc.cjs`; `Resources/web/output.html` present |

Not tested: the output window in dev mode (needs O4's page); a forged message from a non-output window on `output:ready` / `output:report` in a running app (covered by the registry's unit tests, not by the smoke test); anything about displays or full screen (D5, D6).

## D5. Open and close on the built-in display (2026-11-19)

- `desktop/src/output-controller.cjs` (pure, no Electron) is the output state machine for D5's part of section 2.
  - **Open.** `open` validates the request (D3), then refuses with `ALREADY_OPEN`, `TOO_MANY_OUTPUTS` (`MAX_OUTPUTS` 1), `DISPLAY_NOT_FOUND` (the key must match one connected display at level 1), `DISPLAY_BUSY` or `CONTROL_DISPLAY` (the control window's display needs `allowControlDisplay: true`, D-5). Otherwise it creates the hidden window and starts the 10 s open timeout.
  - **Ready.** On `output:ready`, main sends `output:session` (the session plus the display) and clears the timeout.
  - **Live.** The first report with `firstFrameDrawn: true` for that session's revision moves the output to `live`. Main places the window on the display, shows it inactive, puts it in full screen and takes the sleep blocker.
  - **Failed.** `opening → failed` on any of: `did-fail-load` (`LOAD_FAILED`), no `ready` within 10 s (`OPEN_TIMEOUT`), or a page error before any frame (`LOAD_FAILED`, with the page's code kept in `render.errorCode`). A failed window is shown black, not closed (D-1).
  - **Errors while live.** A page error sets `error`, and the next good report clears it. The 1:1 check of section 5 runs until it's no longer pending and raises `NOT_ONE_TO_ONE`.
  - **Close.** `close(id | '*')`, Esc and quitting the app destroy the window, and the output goes to `closed`.
- **Sleep.** One `powerSaveBlocker` (`prevent-display-sleep`) covers all outputs and is held only while at least one is `live`.
- **`main.cjs`.**
  - Control channels: `output:open`, `output:close` and `output:status-all`, accepted from the control window only, as before, plus the `output:status` push.
  - A rejected invoke carries the error code first in its message (`"DISPLAY_BUSY: …"`), because Electron passes only the message to the renderer.
  - Esc is handled in main, in the output window's `before-input-event`, so it works with the page hung. ⌘/Ctrl with `+`, `=`, `-` or `0` is swallowed. No global shortcut.
  - Placement, in order: `setBounds(display.boundsDip)`, `setAlwaysOnTop(true, 'screen-saver')`, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })`, `showInactive()`, then `setSimpleFullScreen(true)` on macOS. Other platforms call `setFullScreen(true)`, which isn't claimed to work. Native vs simple full screen is still D6's decision.
  - `DisplayInfo.hostsOutput` is now filled.
- **Control preload.** `output.open`, `output.close`, `output.status` and `output.onStatus` are added next to `listDisplays` and `onDisplays`; `api.d.ts` picks the same names from `OutputControlApi`. `update`, `setClock`, `retry` and `resume` aren't exposed yet.
- **Stub page.** After it receives the session, it now reports a first frame (black, `firstFrameDrawn: true`, the session's revision), then one report a second. So `opening → live` runs on the stub until O4's page arrives.

| Check | Result |
| --- | --- |
| `npm --prefix desktop test` | 50/50, with 10 new in `tests/output-controller.test.cjs` |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | pass, 368/368, lint 0 problems |
| `test:smoke` (static, dev Mac built-in display, 1800 × 1169 DIP at 2×) | pass, through the control window's real IPC; steps below |
| `dev -- --smoke-test` | pass; the output part is skipped with a message (no `/output` on the dev server until O4) |

The 10 new unit tests cover:
- the open → live sequence;
- Close and Esc, and closing while opening;
- every open refusal, and `DISPLAY_BUSY` with the limit raised to 2;
- a window that fails to open;
- `OPEN_TIMEOUT`, `LOAD_FAILED` and a page error before any frame;
- errors while live and `NOT_ONE_TO_ONE`;
- the report rate limit and invalid payloads;
- the key handler.

What the static smoke test did:
1. **Refusals.** Open without `allowControlDisplay` → `CONTROL_DISPLAY`. A malformed request → `BAD_REQUEST`.
2. **Open.** With the toggle, `opening` → `live` in **112 ms** (criterion: 2 s).
   - The window is visible, **not focused** and always on top; `isSimpleFullScreen()` is true and `getBounds()` equals the display bounds.
   - `powerSaveBlocker.isStarted` is true while live and false while opening.
   - `status()` shows `live` at revision 1, and a second open → `ALREADY_OPEN`.
   - D4's isolation checks pass on the live page.
3. **Close from the control window** → `closed`; the registry is empty and the blocker is stopped.
4. **Esc with the page hung.** Reopened, then hung the page with `for (;;) {}` and confirmed it no longer answers. Esc sent with `sendInputEvent` → `closed` in **2 ms**; the blocker is stopped.
5. **Status pushes** seen by the control window: opening, live, closed, opening, live, closed.

Not tested:
- A real Esc key press from the keyboard. The smoke test injects Esc with `sendInputEvent`, which goes through the same `before-input-event` handler.
- Opening and closing from the app's UI: the editor has no output UI yet (Output's lane).
- The output window in dev mode, which needs O4's page.
- An external display, Spaces, and native vs simple full screen: D6, needs the monitor.
- Disconnect and reconnect (D7). In this build, nothing hides the window yet if a display is removed while an output is live.
- Renderer crash, hang detection and retry (D8).
- Display sleep over a long run (D11).

## D8. Failure handling (2026-11-19)

- **`output-controller.cjs`** gains the D8 transitions of section 2:
  - **Renderer gone.** `render-process-gone` → `failed` with `RENDERER_GONE` and Electron's reason. Applies from `opening` or `live`. The window stays on its display, black (D-1); only retry or close leave this state.
  - **Hang.** No answer from the renderer for 5 s while `live` → `failed` with `RENDERER_UNRESPONSIVE`. The frozen frame stays on screen, and Esc and Close still work, because both run in main. When the page answers again, the output returns to `live` and `error` clears.
  - **Retry.** `output:retry` works only from `failed`. It reloads the fixed URL once and restarts the open timeout, and main re-sends the latest session on `ready`. Retry on an output that isn't failed returns its status unchanged; `'*'` → `BAD_REQUEST`.
  - **First-frame timeout** (raised in the D5 review). A page that sends `ready` but draws no first frame within another 10 s → `failed` with `OPEN_TIMEOUT` ("reported ready but drew no first frame"). It reuses an existing code, so the contract doesn't change.
  - **Sleep blocker.** Released while `failed`, as section 2 says (held only while `live`).
- **How a hang is detected.** Section 2 names Electron's `unresponsive` event, but it doesn't fire for an output window.
  - Measured on Electron 43: a page hung for 25 s never raised `unresponsive`, with or without synthetic mouse input. Only `responsive` fired once the hang ended. Chromium's hang monitor needs pending real input, which an output window never gets.
  - So main probes the renderer itself: once a second it runs `executeJavaScript('0')`, which needs the page's main thread. A probe unanswered after 2 s is abandoned, and the 5 s rule counts from the last answer or valid report.
  - Nothing is exposed to the page, and the page doesn't need to report at any minimum rate, so section 8.4 is unchanged.
- **`main.cjs`**: the control channel `output:retry`, `render-process-gone` → controller, `reloadWindow` (`loadURL` of the fixed URL) and the probe. Control preload and `api.d.ts`: `output.retry`.

| Check | Result |
| --- | --- |
| `npm --prefix desktop test` | 58/58, with 8 new D8 tests in `tests/output-controller.test.cjs` |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | pass, 409/409, lint 0 problems |
| `test:smoke` (static, built-in display) | pass; D5's steps, then the D8 steps below |
| `dev -- --smoke-test` | pass; output part skipped (no `/output` on the dev server until O4) |

The 8 new unit tests cover:
- renderer gone while live and while opening;
- retry, and retry outside `failed`;
- the first-frame timeout;
- a hang, and recovery once the page answers;
- a rejected probe being retried, and Close while unresponsive;
- the watchdog leaving an opening output alone.

What the static smoke test did, after D5's steps:
1. **Crash.** `forcefullyCrashRenderer()` (main-side, no hook in the page) → `failed` / `RENDERER_GONE` in **26 ms** (criterion: 1 s). The window stays visible, and the blocker is released.
2. **Retry.** Retry of an output that isn't open → `closed`, nothing reloaded. Retry from the control window → `opening` → `live` in **106 ms**, at the same URL, and the blocker is held again.
3. **Hang and recovery.** The page busy-loops for 8 s → `RENDERER_UNRESPONSIVE` after **5.8 s** (criterion: 5 s; the probe runs once a second). The window stays visible and the blocker is released. The output is back to `live` about 1 ms after the loop ends, with the error cleared.
4. **Esc while failed.** A 15 s hang → `RENDERER_UNRESPONSIVE`, then Esc → `closed`.
5. **Close after a crash.** Reopened, crashed, then Close from the control window → `closed`.
6. **Status pushes** seen by the control window: opening, live, failed:RENDERER_GONE, opening, live, failed:RENDERER_UNRESPONSIVE, live, failed:RENDERER_UNRESPONSIVE, closed, opening, live, failed:RENDERER_GONE, closed.

Not tested:
- A real GPU process crash, as opposed to a renderer crash.
- A page that hangs while `opening`; the open and first-frame timeouts cover that case.
- Esc after a crash. Close was used instead, since `sendInputEvent` needs a live renderer.
- Retry or failures with O4's real page, and anything on an external display (D6, D7).
