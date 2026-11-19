# Desktop worktree recovery — 2026-11-13

Historical recovery snapshot. For current stabilization, commands, verification and commit readiness, see HANDOFF.md, AUDIT.md and TEST-RESULTS.md.

This report supersedes the copied audit/handoff statements about being outside Git, schema version 1 and absent WebGL2. The original desktop source files were preserved byte-for-byte; historical documents were not rewritten.

## Recovery evidence

Repository: /Users/miguelgontran/Play.Code/playground.pixel/app.
Original: /Users/miguelgontran/Play.Code/playground.pixel/desktop (retained unchanged).
Recovered worktree: /Users/miguelgontran/Play.Code/playground.pixel/agents/desktop-engineering.
Branch: feature/desktop-engineering.
Baseline: 10f9f7490f2792a0d830ef7b8838a87ad651bb3c, the unchanged recorded origin/main, PR #15 browser H.264 pipeline. No fetch or merge performed.

The target path and branch did not exist before recovery. Created the new worktree at the verified commit, previewed rsync with --dry-run and --ignore-existing, then copied with --ignore-existing. Excluded node_modules, .staging, web, dist, build, out, .next, coverage, logs, tsbuildinfo and .DS_Store. Checksum dry-run reported no differences; independent SHA-256 comparison verified all 22 files, totaling 169,549 bytes. This report is one additional new file.

Copied files: .gitignore, README.md, package.json, package-lock.json, electron-builder.yml; docs/{AUDIT,FFMPEG,HANDOFF,TEST-RESULTS}.md; scripts/{stage,dev,build-web}.mjs; src/{api.d.ts,main.cjs,native.cjs,preload.cjs,security.cjs,smoke.cjs}; tests/{font-response.cjs,security.test.cjs}; resources/ffmpeg/{darwin-arm64,win32-x64}/README.md.

Git status after recovery: ?? desktop/. Index empty; no tracked-file changes. No commits, pushes, merges, rebases or edits to main/other agent worktrees. Other worktrees may change concurrently through their owners; this task only reads them.

## Compatibility audit at this baseline

- Depth Studio is committed at src/modules/depth-studio/{renderer,shaders,source}.ts and src/engines/depth/. renderer.ts creates a WebGL2 context. source.ts renders to an offscreen WebGL canvas and copies into the FrameSource Canvas 2D interface. Desktop hosts the existing application, does not disable GPU acceleration, and introduces no renderer implementation. Actual GPU/context-loss behavior still needs native acceptance testing.
- Calibration is in src/components/shell/calibration/ and src/modules/output/calibration-source.ts. It uses local logo assets and document.fonts, and participates in FrameSource/Live Preview. The shell CSP allows same-origin fonts/images and Blob downloads. Both Inter and JetBrains Mono now require build-time Google Fonts access. The old test fixture mocks only Inter and is not a complete offline fixture for this baseline.
- Live Preview reads FrameSource.draw, optional subscriptions and FrameInput.context, then uses resolveMapping regions. The shell does not alter these contracts, state or timing. Paused redraw and label/asset readiness need runtime verification.
- MP4 encoding is committed in src/modules/output/{video-export,mp4}.ts. It uses WebCodecs VideoEncoder, device-specific H.264 capability checks, deterministic frames, cancellation and an MP4 Blob. Browser encoding already exists; native FFmpeg is a separate future backend, not a prerequisite or replacement for it. app:// is registered secure, but WebCodecs and codec support must still be checked in the actual Electron runtime.
- The MP4 UI is NOT committed at 10f9f74. The Lead Architect has active local changes for src/modules/output/studio-panel.tsx, target-source.ts, src/engines/video-targets.ts, module wiring and frozen calibration/depth source factories. Inspected those files read-only; did not copy or integrate them. Their proposed export uses the same Blob download mechanism accepted by the shell. UI behavior cannot be validated from this recovered baseline. Wait for Lead Architect integration; do not take their dirty files.
- ExportInput now optionally carries engineering summaries; FrameInput carries context; FrameSource optionally subscribes. Desktop does not implement or mutate them. Project SCHEMA_VERSION is 2 with saved module data. IPC envelope validation is version-agnostic and still requires shared parseProjectFile/serializeProject before state changes. No new schema, engine or contract introduced.

## Checks and remaining issues

No dependencies installed. The root package-lock matches the existing app lock byte-for-byte. Created an ignored node_modules symlink only in the NEW worktree to reuse app/node_modules for checks. Desktop tests used NODE_PATH pointing to the ORIGINAL desktop/node_modules, without copying or modifying those dependencies. Generated type/build files stay in the new worktree and are ignored.

- Desktop tests: 5/5 pass, including electron-builder configuration schema validation.
- All eight desktop executable JS files: node --check passes.
- Application typecheck: passes.
- Application tests: 297/297 pass in 22 files.
- Root npm run lint: FAILS with 23 @typescript-eslint/no-require-imports errors in the newly nested desktop CommonJS source/tests. Repository-wide lint now traverses desktop/. A scoped desktop lint policy or explicit root exclusion needs an integration fix before commit readiness. No lint suppression or shared configuration change was made.
- Root npm run build: FAILS because Turbopack confines resolution to the new worktree and cannot follow reused Next dependencies outside that root. This is a limitation of the no-install validation setup, not proof of an application compilation defect. An approved local npm ci or reviewed desktop-owned staging root adjustment is required for a meaningful build. No dependency install or root Next config modification was attempted.
- No GUI launch, GPU test, native file-dialog exercise, H.264 encode or installer build performed during recovery. Historical restrictions and prior diagnostic failures remain recorded in TEST-RESULTS.md.

The source discovery in desktop/scripts/stage.mjs correctly selects this worktree as its parent application when placed here. It requires source node_modules. Its Turbopack root encompasses this worktree, not the external reused dependency location; local dependencies are needed for the intended workflow. desktop/dev itself still needs Electron installed locally before its ESM import can resolve; NODE_PATH was only used for CommonJS tests.

The original README contains the historical sibling launch path, and historical handoff/audit facts refer to c81a17b. Update these in a subsequent authorized compatibility/documentation pass rather than treating them as current instructions. Do not launch the original sibling package when validating this branch.

Recovery is complete; integration/build readiness is not. Work remains untracked and unstaged pending instructions. Do not commit until the lint boundary, local dependencies, current documentation and Lead Architect MP4 UI integration are addressed or explicitly scoped for review.

## Final concurrent-state check

After the audit, the Lead Architect independently committed the inspected UI as faf6d90 (`feat: export MP4 from the Output Studio`); their worktree is now clean. Recorded origin/main and this desktop branch both remain at 10f9f7490f2792a0d830ef7b8838a87ad651bb3c. The references above to uncommitted UI describe its state when inspected. It is now committed on feat/mp4-export-ui but is still absent from our authorized integration baseline. No merge, cherry-pick or update was performed here. The approved baseline did not change.
