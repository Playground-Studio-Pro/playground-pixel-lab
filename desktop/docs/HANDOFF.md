# Lead Architect handoff — desktop foundation

Worktree: /Users/miguelgontran/Play.Code/playground.pixel/agents/desktop-engineering
Branch: feature/desktop-engineering
Integration baseline: 10f9f7490f2792a0d830ef7b8838a87ad651bb3c

## Change

Desktop shell, isolated staged Next development/static build, app:// asset serving, sandboxed preload, validated dialog-scoped project IPC, existing Blob export downloads, fixed FFmpeg availability probe and electron-builder macOS arm64/Windows x64 configuration. Existing rendering, Depth Studio, calibration, web application features and export contracts are unchanged. No native encoding or codec added.

Stabilization installs npm dependencies locally from unchanged lockfiles, replacing the recovery-only external symlink. Root ESLint permits CommonJS only under desktop/**/*.cjs. Root ESLint and TypeScript exclude generated desktop staging/assets/distribution output.

## Commands

From the repository root:

```sh
npm ci
npm --prefix desktop ci
npm --prefix desktop run dev
```

Web production build: `npm run build`. Desktop assets: `npm --prefix desktop run build:web`. Static desktop launch: `npm --prefix desktop start` after desktop assets build. Smoke launch: `npm --prefix desktop run dev -- --smoke-test`, or `npm --prefix desktop run test:smoke` after the static build.

Packaging: `npm --prefix desktop run pack:mac` for unpacked arm64, `dist:mac` for DMG/ZIP, `dist:win` for x64 NSIS. Use native Windows 11 x64 with Node 24, both local npm installations, network access for tools/fonts and staging junction permission. Distribution still needs approved signing/artwork and FFmpeg redistribution material if a binary is supplied. No publishing is configured.

## Verification and limits

See TEST-RESULTS.md for the actual latest checks. macOS launch is NOT verified: Electron download fails because github.com DNS resolution returns ENOTFOUND. Normal web and desktop static builds fail fetching Inter and JetBrains Mono; the previous external-node_modules Turbopack resolution error is resolved. Do not describe these builds as passing. No fallback fonts, cached old runtime or renderer substitution was used in this stabilization.

Once network access is available, complete both npm installations, rerun the builds and both smoke paths. Manually check project create/import/export round trips, PNG/SVG/ZIP/MP4 Blob Save As, calibration fonts/logo, Live Preview pause/resume, WebGL2 GPU/context behavior, IndexedDB persistence across restarts and offline packaged startup. Then build and test the native Windows installer.

MP4 UI commit faf6d90 is outside this baseline. Do not merge it here without separate authorization. The shell does not claim the UI is already integrated. No changes were made to other worktrees, main, Depth Studio or other shared features. The original sibling desktop directory remains preserved.
