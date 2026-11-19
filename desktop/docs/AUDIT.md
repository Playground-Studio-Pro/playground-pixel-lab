# Desktop compatibility audit — stabilized foundation

Baseline: 10f9f7490f2792a0d830ef7b8838a87ad651bb3c, feature/desktop-engineering. Recovery history is in RECOVERY.md. This replaces the original c81a17b audit, which inspected an older app checkout.

## Application and rendering

Next 16.4.5 / React 19.3 with npm lockfiles. A fresh worktree needs a real local `npm ci`, not a node_modules symlink to another checkout. The web app remains `npm run dev` or `npm run build && npm start` at repository root. No shared feature, Next configuration, rendering or package-version change is introduced.

Depth Studio is present at src/modules/depth-studio/{renderer,shaders,source}.ts and src/engines/depth/. Its raw WebGL2 renderer draws offscreen, then its FrameSource copies the image to the shared Canvas 2D compositor. Desktop hosts this application unchanged and leaves GPU acceleration enabled. GPU limits, context recovery and actual preview behavior still require native testing.

Calibration uses src/components/shell/calibration/ and src/modules/output/calibration-source.ts, local logo assets and document.fonts. Inter and JetBrains Mono are downloaded at build time by next/font/google. The production shell permits same-origin assets, fonts and Blob downloads. No fallback font or renderer is substituted.

Live Preview uses FrameSource.draw, optional subscribe callbacks and FrameInput.context, then slices master pixels using resolveMapping. The existing engine remains the sole renderer and timing source.

## Persistence and exports

Project schema version is 2; module data is saved through the existing schema/migrations. Browser and desktop data live separately. The optional desktop file API checks a bounded project envelope, while shared parseProjectFile remains mandatory before changing application state. No schema is duplicated in Electron.

ExportInput includes optional engineering summaries. Existing PNG/SVG/manifest/report/project/Resolume downloads remain Blob downloads. The desktop shell supplies native Save As without replacing builders or bypassing validation.

The committed WebCodecs H.264 encoder is src/modules/output/{video-export,mp4}.ts. It validates settings and codec support, renders deterministic frames, supports cancellation, and produces an MP4 Blob. FFmpeg is not required by that pipeline. Native FFmpeg remains a fixed version probe and future design, with no encoding implementation or new codec.

MP4 Export UI was inspected read-only in Lead Architect work and then independently committed as faf6d90. That commit is not in the authorized 10f9f74 baseline and has not been merged or copied. Its proposed Blob download fits the existing shell path, but UI integration awaits Lead Architect.

## Desktop boundary and scoped configuration

All runtime code, packaging, staging and documentation live under desktop/. Desktop-only CommonJS is necessary for Electron main/preload; ESLint disables no-require-imports only for desktop/**/*.cjs. Root lint and TypeScript exclude desktop/.staging, web and dist, preventing generated copies/assets from entering application checks. No lint rule is disabled globally.

Development uses a staged Next server bound to loopback. Production uses a staged static export at stable secure app://pixellab/, with no Node access in the renderer. IPC checks window, main frame and origin. No generic filesystem or command API is exposed.

Electron and electron-builder are desktop-only dependencies: runtime shell and platform packaging respectively. Versions remain locked at 43.8.10 and 26.18.0; package ranges and lockfiles were not changed during stabilization. Existing web package/lock are unchanged, so desktop adds zero web dependency bytes. No packaged runtime size or performance claim is made.

## Remaining acceptance

Actual macOS GUI/GPU and H.264 support, project round trips, calibration asset readiness, paused preview redraw, native dialogs, Windows DPI/paths and installers require native testing. FFmpeg binaries, provenance/notices, signing identities, notarization and release artwork remain unsupplied. Production builds need access to Google Fonts; runtime installation needs GitHub DNS/network access. Exact results are in TEST-RESULTS.md.
