# Session

Current state only. Replace it, don't accumulate. Latest update: 2026-11-07.

## Objective

Motion Lab V1 is done. The next step is product direction, not code:
- a design review of customization;
- a review of the module proposals in [MODULES](docs/product/MODULES.md), including demos, NDI, quick video and video generation;
- choosing what to build next.

Three lanes work in parallel: core, design and functional modules. See [docs/agents](docs/agents/README.md).

## Verified current state

- **Repository:** `~/Play.Code/playground.pixel`, outside iCloud Drive. `~/Documents/Play.Code/playground.pixel` is an old copy, so don't develop there.
- **Branches:**
  - `main` is at the PR #4 merge, and CI passes.
  - PR #5 (`docs/agent-briefs`) is open with CI passing. It waits for the user's approval to merge.
  - PR #6 (`feat/example-gallery`) is stacked on PR #5. Merge #5 first.
- **Agent briefs:** one per lane in [docs/agents/](docs/agents/README.md): core, design and functional modules. They cover how the app works today, file ownership for parallel work, and each lane's path to its objective.
- **Shipped:** Phase 0, undo and redo, and Motion Lab V1, merged as PRs #2, #3 and #4. Phase 1 is partly done. Design is in [OVERVIEW](docs/architecture/OVERVIEW.md#motion-lab).
- **Example project:** Festival Main Stage.
  - File: `examples/festival-main-stage.pixellab.json`. Import it with "Import project file" in the project menu.
  - Builder: `festivalMainStage()` in `src/examples/festival.ts`.
  - `tests/examples.test.ts` keeps the two in sync.
- **Example gallery** on the start screen, on `feat/example-gallery`: Festival Main Stage, Corporate Keynote, Motion Lab acceptance and Stress test, 500 screens. Each opens as a new copy. The 500-screen example opens in 177 ms. Code is in `src/examples/`.
- **Browser data on `localhost:3000`:**
  - two copies of `perf-500` and one of Festival Main Stage, all imported during testing;
  - `perf-500` is a perf fixture of 500 identical 256 × 256 screens, not a demo, and can be deleted from the app;
  - other origins and ports have separate storage.
- **Local server:** `npx next start -p 3000` was started from the session and stops with it. Run `npm run build` first.
- **Old branches:** merged branches remain locally and on GitHub. None were deleted.

## Last test results

On `feat/example-gallery`, 2026-11-07:

| Check | Result |
| --- | --- |
| Typecheck, lint, build | Pass |
| Unit tests | 168 of 168 pass |
| Bundle | Initial 172.8 KB, unchanged. Example builders 1.5 KB, on first use. Motion Lab chunk 7.5 KB |
| Gallery in Chrome | Listed on the start screen. Corporate Keynote and the 500-screen test open as new projects with no errors, and Live preview runs at 60 fps on Corporate Keynote |
| Preview performance, 500 screens | 60 fps, 0 late, 0 skipped. Details in [PERFORMANCE](docs/development/PERFORMANCE.md#motion-lab) |

## Important decisions

- Motion Lab was built ahead of the rest of Phase 1 by product decision. See [ROADMAP](docs/product/ROADMAP.md#phase-2-motion-lab).
- [MODULES](docs/product/MODULES.md) is a proposal only. Each item needs approval. Video encoding, NDI and anything that needs a backend are outside the current roadmap phases.
- User preferences and themes must never enter the project file. Exports look the same under every theme.

## Important files

- `docs/product/MODULES.md`: the proposals to review, and a reading list per agent.
- `docs/product/DESIGN_SYSTEM.md` and `src/app/globals.css`: design direction and tokens.
- `docs/product/ROADMAP.md`: phases and exclusions.
- `docs/architecture/OVERVIEW.md`: layers. Motion Lab is the template for a module.
- `src/components/workspace/canvas-header.tsx` and `canvas-area.tsx`: where Motion Lab is wired in by hand today.
- `tests/helpers.ts` and `examples/`: reusable projects.

## Do not

- Don't start features before the user approves them.
- Don't commit straight to `main`, force-push, or make the repository public.
- Don't develop in `~/Documents/Play.Code`, or delete it. Its deletion needs separate confirmation.
- Don't add dependencies without a measured bundle cost and a DECISIONS record.

## Known issues

- **Motion Lab:**
  - Venue-laptop performance is unmeasured.
  - The preview image is capped at 4096 px a side.
  - Pausing on a hidden tab wasn't verified in a browser.
  - Patterns have no parameters.
  - There's no full-screen output.
  - Labels that don't fit are dropped.
- **Undo:** not kept across reloads. Each inspector arrow step is its own undo step.
- **Resolume:** the guide is untested in real Arena. Native presets aren't generated.
- **Editor zoom:** zooming 100 screens runs at about 50 ms p95 here, unexplained. It isn't a regression.
- **Offline:** the app can't load offline without being served.
- **Audit:** `npm audit` reports 13 findings in dev tooling and 0 in production dependencies.

## Pending decisions

1. Which [MODULES](docs/product/MODULES.md) items to approve, and in what order. Recommended: the example gallery and content templates first.
2. Customization direction from the design review: theme levels, layout, workspace presets, whether to offer a light theme.
3. The next Motion Lab step. Recommended: full-screen output to a second display.
4. The Resolume real-world check, which needs Arena.
5. For NDI and video generation: native helper or not, and user keys or a backend.

## Next action

Core lane: once PRs #5 and #6 are merged, start content templates, item 2 in [core.md](docs/agents/core.md), on `feat/content-templates`. The user asked to advance on every front at once. The design and functional-modules lanes start from their briefs, and items that need decisions (video encoding scope, NDI route, keys or a backend) go to the user with prototype findings.

## Resume prompt

Read:
- CLAUDE.md
- SESSION.md
- docs/agents/README.md and the brief for your lane
- docs/product/MODULES.md

Continue from the verified current state. Execute the next action. Don't re-audit completed work unless the repository contradicts SESSION.md.
