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
