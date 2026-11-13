# Pixel Lab desktop foundation

Isolated Electron proof of concept for the existing Pixel Lab application. Shared application features and rendering code are unchanged. Root ESLint has a desktop-only CommonJS exception; root ESLint and TypeScript exclude generated desktop assets. Read [audit](docs/AUDIT.md), [test results](docs/TEST-RESULTS.md) and [Lead Architect handoff](docs/HANDOFF.md) before integration.

## Development (macOS Apple Silicon)

Requires Node 24, npm, dependencies installed locally from both committed npm lockfiles, network access for Electron and Google Fonts, and a normal macOS Apple Silicon desktop session permitting local servers and GUI processes. Do not symlink the worktree’s root node_modules to another checkout: Turbopack confines resolution to this worktree.

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

Windows staging uses a directory junction for installed web dependencies. Build on the native platform. The builder configuration declares macOS arm64 DMG/ZIP and Windows x64 NSIS; `--publish never` is explicit. Before packaging on either platform, run `npm ci` at the repository root and in `desktop/`. Windows 11 x64, Node 24, network access for the runtime/tool downloads and fonts, and permission to create the staging junction are required. No signing identity, update server, auto-update, telemetry service or paid dependency is provisioned. Development packages can omit FFmpeg; availability reports false. Release artifacts still need approved binary provenance, product icons, signing/notarization and native acceptance testing.

## Security and optional integration API

The window uses sandboxing, context isolation, no Node integration, no webviews, denied popups, denied permissions and navigation limited to the configured origin. CSP allows Next's inline bootstrap scripts/styles; development additionally needs eval and loopback WebSocket access. Production does not allow eval. This POC does not claim that inline-script CSP eliminates XSS; a nonce/hash policy needs a separate Next integration review.

Preload exposes only `window.pixelLabDesktop` (see [types](src/api.d.ts)):

- `openProject()` opens one user-chosen file, returning `{ name, text }` or `null` on cancellation.
- `saveProject(text, suggestedName)` validates bounded project-envelope text, asks for an explicit destination, and returns `{ name }` or `null`.
- `ffmpegStatus()` reports availability/version for a fixed approved binary location.

Every IPC handler verifies the exact window, main frame and allowed origin. No renderer-supplied absolute paths, executable names or command arguments are accepted. Project text is bounded at 16 MiB. IPC validates the file envelope; callers **must** use shared `parseProjectFile` before importing state and `serializeProject` when saving. This optional API is deliberately not wired into the shared UI. Existing import/export controls remain the supported user flow. Desktop code does not validate mapping, mutate project schema or replace the renderer.

Implementation follows [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security/), [context isolation guidance](https://www.electronjs.org/docs/latest/tutorial/context-isolation/) and [electron-builder configuration](https://www.electron.build/docs/configuration/).

## Verification

```sh
npm test
```

Desktop dependencies are isolated from the web bundle. Electron provides the native shell; electron-builder provides packaging. The lockfile records resolved versions. See [test results](docs/TEST-RESULTS.md) for measured dependency footprint and environment limitations. This foundation lives in the dedicated feature/desktop-engineering worktree. The original sibling directory is retained as a recovery backup and must not be used to validate this branch.

## Current limitations

Production and desktop static builds are blocked here because Inter and JetBrains Mono cannot be fetched from Google Fonts. The Electron 43.8.10 runtime download fails with `getaddrinfo ENOTFOUND github.com`; macOS launch is therefore unverified. Do not substitute a cached older runtime or fallback fonts as evidence that the configured production app works. See [test results](docs/TEST-RESULTS.md).

This branch starts from 10f9f74, which includes Depth Studio/WebGL2, Calibration, Live Preview and the WebCodecs MP4 encoder. The MP4 UI commit faf6d90 is not part of that baseline. FFmpeg remains an availability probe and design only; no native encoding is implemented.
