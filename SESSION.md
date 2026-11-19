# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-18, Alpha 0.1 Phase A (protection and integration) done.

## Objective

**Pixel Lab Alpha 0.1:** a desktop app (Electron) that completes one real flow, offline: **Mapping → Test card → Output → external monitor → Resolume Arena.** Nothing outside that flow starts until Alpha 0.1 passes a field test with a laptop, an external monitor, Resolume Arena and a real LED project.

Phases, each approved separately by the owner:

| Phase | Owner | Status |
| --- | --- | --- |
| **A.** Protection and integration | Lead Architect | **Done** 2026-11-18 |
| **B.** Electron build and run on macOS: first validation gate | Desktop Engineering | Approved, not started |
| **C.** Physical output on external monitors | Output Engineering, with Desktop | Waits for Phase B to pass. Desktop and Output agree the contract before implementing |

Sprint 3 ([SPRINT_3](docs/agents/SPRINT_3.md)) is paused. Product Design, Content Engineering and LED Engineering stay stopped.

## Alpha 0.1 requirements

✅ verified · 🟡 partial or unverified · ❌ not built

| # | Requirement | Web | Electron |
| --- | --- | --- | --- |
| 1 | Works offline | ❌ needs a server | 🟡 static `app://` build designed, never built |
| 2 | macOS and Windows | n/a | 🟡 macOS never launched. Windows: don't claim support until tested on a real Windows 11 machine |
| 3 | Screens and resolutions | ✅ | 🟡 |
| 4 | Test cards | ✅ | 🟡 |
| 5 | Full-screen output on an external monitor, no UI | ❌ | ❌ |
| 6 | MP4 export | ✅ headless Chrome, ffprobe-checked (#16) | 🟡 WebCodecs H.264 unverified |
| 7 | Reliable save and recovery | ✅ IndexedDB autosave + project file | 🟡 |
| 8 | Resolume workflow | 🟡 package built, never followed in Arena | 🟡 |

## Where it stands

- **`main` is at `cb084ab`**, the merge of PR #16 (Export MP4 in the Output Studio), merged 2026-11-18 at its reviewed head `faf6d90` with CI passing. The local `app/` checkout was fast-forwarded to it.
- **Backed up on GitHub, not merged:**
  - `feature/desktop-engineering` at `a4d3302`: the Electron foundation. Based on `10f9f74`, so it doesn't contain #16 yet. Its tests ran in a sandbox without network: Electron itself was never downloaded or launched.
  - `feature/output-engineering` at `ff5c24b`: a Node-only ProRes 422 and PNG sequence service, not wired to any UI or IPC. **Out of Alpha 0.1.**
- **Open PRs:** #17, the Depth Studio implementation pack under `docs/features/depth-studio/`; the PR for this handoff.
- **Local only, kept intact on purpose:**
  - `~/Play.Code/playground.pixel/desktop/`: the original Electron copy. Its source is identical to the branch; its docs are older. Keep it until the owner confirms the backup, then archive, never delete without approval.
  - `Playground_Depth_Studio_Implementation_Pack.zip` and `CLAUDE_MASTER_PROMPT.md` at the parent folder, and the untracked pack copies in `app/` (identical to #17).
- **Agents:** none running.

### Worktrees

Everything lives in `~/Play.Code/playground.pixel/`, which isn't itself a Git repository.

| Path | Branch | Port |
| --- | --- | --- |
| `app/`: main worktree | `main` | 3000 |
| `agents/lead-architect` | `docs/alpha-0.1-phase-a` now; lane branch `feature/lead-architect` | 3100 |
| `agents/desktop-engineering` | `feature/desktop-engineering` | 3210 (Electron dev server) |
| `agents/output-engineering` | `feature/output-engineering` (ProRes, frozen) | 3104 |
| `agents/product-design`, `content-engineering`, `led-engineering` | their lane branches, paused | 3101–3103 |

## Phase B checklist (Desktop Engineering)

Work in `agents/desktop-engineering` on `feature/desktop-engineering`. Approved: download Electron and install dependencies, unsigned builds, local fonts.

1. `git fetch origin && git merge origin/main`. Stop and report on any conflict.
2. `npm ci` at the root and `npm --prefix desktop ci`, with the real Electron runtime installed.
3. **Local fonts:** replace `next/font/google` in `src/app/layout.tsx` with `next/font/local` and committed Inter and JetBrains Mono `woff2` files (both SIL Open Font License; keep the licence text beside them). No new npm dependency. The build must pass with no network.
4. `npm run typecheck && npm run lint && npm test && npm run build` at the root; `npm --prefix desktop test`.
5. `npm --prefix desktop run build:web`, then launch Electron on macOS (dev and static). Run the smoke test.
6. In Electron, with the network off: open the examples, create and edit a project, Mapping, Content and Depth Studio, Output test card, Live preview.
7. Persistence: quit and relaunch, the project is still there; export the project file and import it again.
8. MP4: export the test card for one output; check it with ffprobe and play it.
9. `npm --prefix desktop run pack:mac`, unsigned; launch the `.app` from a path with spaces.
10. Record evidence (commands, results, screenshots) in `desktop/docs/TEST-RESULTS.md`, refresh `desktop/README.md` (it still points to the sibling folder), open a PR. Report what failed or wasn't tested.

Out of scope for Phase B: full-screen output, ProRes, FFmpeg, signing, Windows claims, any new feature.

## Important decisions

Recorded in [DECISIONS](docs/architecture/DECISIONS.md), 2026-11-18: Alpha 0.1 scope, unsigned builds, local fonts, ProRes out of Alpha, and output windows as independent Electron windows designed for several monitors.

Earlier decisions still hold: contracts as types, saved module data in `project.modules[id]` at schema 2, lanes merge `main` and never rebase or force-push, and no PR merges without CI and the owner's approval.

## Known issues

- **Electron:** never launched. Every Electron cell above is unverified until Phase B.
- **Output:** no full-screen output exists. The Live preview caps its master image at 4096 px a side (Festival Main Stage is 5120 px wide), so physical output must render each output at native size, not cut it from the preview.
- **MP4 export:** H.264 over 4096 px a side can't be exported whole (Corporate Keynote's 4224 × 1536); per-output and per-screen files instead. The whole file is held in memory until download. Motion Lab patterns aren't export sources yet.
- **Resolume:** the guide has never been followed in Arena. No preset files are generated, by design ([RESOLUME](docs/integrations/RESOLUME.md)).
- **Persistence:** browser and Electron data are separate; move projects with the project file. Undo isn't kept across reloads.
- **Calibration test card:** at 1440 px the Live preview header scrolls sideways; screen-guide labels cover the card's top-left labels.
- **Settings:** Aurora settings aren't saved.
- **Dead code:** `useApp.library`, `saveToLibrary` and `IndexedDbCabinetLibrary` are unused. Cleanup after Alpha.
- **Audit:** `npm audit` reports findings in dev tooling only.

## Resume

1. `cd ~/Play.Code/playground.pixel/app && git fetch && git status && git log --oneline -1`. Expect `main` at `cb084ab` or later.
2. Start the next approved phase with the command in [HANDOFF](HANDOFF.md#start-the-next-agent).
