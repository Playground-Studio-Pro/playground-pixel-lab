# Pixel Lab desktop

Electron shell for the existing Pixel Lab application, built and run on macOS Apple Silicon in Alpha 0.1 Phase B (2026-11-18): it launches, works offline from the static `app://` build, and packages as an unsigned `.app`. See [test results](docs/TEST-RESULTS.md). Shared application features and rendering code are unchanged. Root ESLint has a desktop-only CommonJS exception; root ESLint and TypeScript exclude generated desktop assets. Read [audit](docs/AUDIT.md), [test results](docs/TEST-RESULTS.md) and [Lead Architect handoff](docs/HANDOFF.md) before integration.

## Development (macOS Apple Silicon)

Requires Node 24, npm, dependencies installed locally from both committed npm lockfiles, and a normal macOS Apple Silicon desktop session permitting local servers and GUI processes. Network is needed only to install: `npm --prefix desktop ci` downloads the Electron runtime, and the first `pack:mac` downloads electron-builder's own Electron copy. Builds need no network: fonts are committed under `src/app/fonts/`. If Electron's postinstall fails with `fetch failed`, rerun `npm --prefix desktop ci`. Do not symlink the worktree’s root node_modules to another checkout: Turbopack confines resolution to this worktree.

```sh
cd /Users/miguelgontran/Play.Code/playground.pixel/agents/desktop-engineering
npm ci
npm --prefix desktop ci
npm --prefix desktop run dev
```

Commands in the remaining sections run from the `desktop/` directory. The launcher stages the app into `.staging/app`, starts its Next dev server on `127.0.0.1:3210`, waits for readiness and opens Electron. It stops the child server when Electron exits. Set `PIXEL_LAB_WEB_ROOT` to another approved source checkout if the layout changes; `PIXEL_LAB_DESKTOP_PORT` overrides the port. Do not run staging, development and build commands concurrently. This is a source snapshot; restart `npm run dev` to pick up shared source edits. Desktop main/preload edits also require restart.

Existing project import controls use the OS file chooser. Existing exports use Electron's Save As flow. Desktop data lives in its own Electron user-data directory; web browser IndexedDB is separate. Export `.pixellab.json` from the browser and import it in Electron to transfer projects. Do not copy browser database folders.

## Packaged/offline mode

```sh
npm run build:web
npm start
npm run test:smoke
npm run pack:mac
npm run dist:mac
```

`build:web` stages the existing source and its configuration, then applies desktop-only `output: export`, disables Cache Components/partial prefetching and enables unoptimized images in the staging configuration. It copies only the resulting static assets to `web/`. The original `app/next.config.ts` and `.next` are untouched. Assets load at the stable secure `app://pixellab/` origin, keeping IndexedDB stable across restarts and requiring no production HTTP server or Node in the renderer. Runtime source/rendering remains the existing application.

A development launch smoke check is `npm run dev -- --smoke-test`. A static smoke check is `npm run test:smoke` after building. Both verify the real start screen, isolated bridge, lack of Node globals and IndexedDB. They exit automatically. They do not exercise interactive import/export or mapping controls. The smoke profile is separate from normal desktop data.

On Windows 11 x64, with Node and the app dependencies installed:

```powershell
npm ci
npm run dev
npm run dist:win
```

Windows staging uses a directory junction for installed web dependencies. Build on the native platform. The builder configuration declares macOS arm64 DMG/ZIP and Windows x64 NSIS; `--publish never` is explicit. Before packaging on either platform, run `npm ci` at the repository root and in `desktop/`. Windows 11 x64, Node 24, network access for the runtime/tool downloads, and permission to create the staging junction are required. No signing identity, update server, auto-update, telemetry service or paid dependency is provisioned. Development packages can omit FFmpeg; availability reports false. Release artifacts still need approved binary provenance, product icons, signing/notarization and native acceptance testing.

## Security and optional integration API

Packaged builds refuse to start with any remote-debugging or Node inspector switch, `--force-device-scale-factor` (it would break 1:1 output), `ELECTRON_RUN_AS_NODE` or `NODE_OPTIONS`, and their Electron fuses disable RunAsNode, `NODE_OPTIONS`, inspector arguments and loading the app from outside the integrity-checked `app.asar`. Unpackaged development keeps `--remote-debugging-port`. See [test results](docs/TEST-RESULTS.md#debugging-locked-in-distributed-builds).

The window uses sandboxing, context isolation, no Node integration, no webviews, denied popups, denied permissions and navigation limited to the configured origin. CSP allows Next's inline bootstrap scripts/styles; development additionally needs eval and loopback WebSocket access. Production does not allow eval. This POC does not claim that inline-script CSP eliminates XSS; a nonce/hash policy needs a separate Next integration review.

Preload exposes only `window.pixelLabDesktop` (see [types](src/api.d.ts)):

- `openProject()` opens one user-chosen file, returning `{ name, text }` or `null` on cancellation.
- `saveProject(text, suggestedName)` validates bounded project-envelope text, asks for an explicit destination, and returns `{ name }` or `null`.
- `ffmpegStatus()` reports availability/version for a fixed approved binary location.

Every IPC handler verifies the exact window, main frame and allowed origin. No renderer-supplied absolute paths, executable names or command arguments are accepted. Project text is bounded at 16 MiB. IPC validates the file envelope; callers **must** use shared `parseProjectFile` before importing state and `serializeProject` when saving. This optional API is deliberately not wired into the shared UI. Existing import/export controls remain the supported user flow. Desktop code does not validate mapping, mutate project schema or replace the renderer.

Implementation follows [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security/), [context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation/) and [electron-builder configuration](https://www.electron.build/docs/configuration/).

## Verification

```sh
npm test            # desktop unit tests
npm run test:smoke  # after build:web
```

Desktop dependencies are isolated from the web bundle. Electron provides the native shell; electron-builder provides packaging. The lockfile records resolved versions. This lives in the `feature/desktop-engineering` worktree (`agents/desktop-engineering`); work and validate here only. The older sibling copy at `~/Play.Code/playground.pixel/desktop` is a recovery backup and is not used for anything.

## Current limitations

- **macOS only.** Windows packaging is configured but has never run; no Windows support is claimed.
- **Unsigned.** `pack:mac` produces a 301 MB `.app` with only an ad-hoc signature and the default Electron icon. It runs on the Mac that built it; on another Mac, Gatekeeper blocks it until it's signed and notarized.
- **MP4** goes through WebCodecs, which here used Chromium's software OpenH264 encoder. Verified for one 3072 × 1920 test card; speed on long animated exports isn't measured. FFmpeg is only an availability probe; nothing native encodes.
- **No full-screen output** on an external monitor yet (Alpha 0.1 Phase C).
- Browser and desktop data are separate; move projects with the project file.

See [test results](docs/TEST-RESULTS.md) for what was and wasn't tested.
