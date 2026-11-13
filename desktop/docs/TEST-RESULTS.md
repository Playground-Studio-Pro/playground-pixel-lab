# Desktop foundation stabilization — test results

Date: 2026-11-13. macOS Apple Silicon, Node v24.13.1, npm 11.8.0. Worktree: agents/desktop-engineering, branch feature/desktop-engineering, integration baseline 10f9f7490f2792a0d830ef7b8838a87ad651bb3c. This supersedes the tests run against the earlier c81a17b source.

## Dependency installation

Replaced only the recovery-created root node_modules symlink in this worktree with a real local `npm ci` installation. Successful: 583 packages. Root package.json and package-lock.json are unchanged. No package version upgrades or changes to other worktrees.

`npm --prefix desktop ci` installed the desktop npm packages, but its postinstall failed downloading Electron. The directory is populated, not a completed runtime installation. Electron npm package is locked at 43.8.10; electron-builder at 26.18.0. No alternate runtime was installed. Local tooling disk sizes: root node_modules 627 MiB, desktop/node_modules 102 MiB excluding the missing Electron runtime. No packaged bundle-size claim.

## Results

| Check | Actual result |
| --- | --- |
| Root `npm run typecheck` | Pass, including after desktop staging exists |
| Root `npm run lint` | Pass; desktop-only CommonJS exception resolves all 23 errors, generated desktop paths excluded |
| Root `npm test` | 297/297 tests pass in 22 files |
| Desktop `npm test` | 5/5 pass, including installed electron-builder configuration validation |
| Root `npm run build` | FAIL: cannot fetch Inter and JetBrains Mono from Google Fonts |
| Desktop `npm run build:web` | FAIL: same two font-fetch errors, after staging the correct worktree and entering compilation |
| Desktop `npm run dev -- --smoke-test` | FAIL before window creation: Electron runtime installation/download unavailable |
| macOS native launch | NOT VERIFIED |
| Windows package / native acceptance | Not run |
| Shared source/packages/Next configuration | Unchanged, verified against HEAD |

Root typecheck, lint, application tests and desktop tests were rerun after the scoped TypeScript exclusions and desktop staging were present. The root production build and staged static build both passed dependency resolution and reached compilation: the previous external-symlink Turbopack error is resolved. They are not passing builds.

Electron's downloader reports `TypeError: fetch failed`. A direct HEAD request to the configured macOS arm64 release URL failed with the exact underlying cause:

```text
Error: getaddrinfo ENOTFOUND github.com
code: ENOTFOUND
syscall: getaddrinfo
hostname: github.com
```

This prevents installing the required binary and therefore prevents verifying the actual Electron launch. No GUI success, GPU support, WebCodecs H.264 support, native file-dialog behavior or packaged offline support is claimed. No fallback-font build or older cached Electron was substituted during stabilization.

The project’s existing build-time Google Fonts requirement is retained; shared layout/fonts were not changed to mask the network restriction. Build failures name Inter and JetBrains Mono from next/font/google.

## Scope and reproducibility

Run `npm ci` at root, `npm --prefix desktop ci`, then the commands in README.md on a normal macOS desktop with network access to GitHub and Google Fonts. Both lockfiles are unchanged. Only desktop foundation files and scoped root ESLint/TypeScript changes belong in the foundation commit. Generated node_modules, .next, desktop/.staging, web and dist are excluded. No source under src/, Depth Studio, shared exports or existing feature tests changed.

The original desktop sibling is preserved. RECOVERY.md records the earlier byte-for-byte copy and historical environment findings. No current detailed npm security audit was completed; earlier installation findings remain unresolved rather than silently upgraded.
