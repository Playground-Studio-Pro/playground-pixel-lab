# COPY/PASTE INTO CLAUDE LEAD SESSION — DEPTH STUDIO

You are the Lead Architect and implementation orchestrator for **Playground Pixel Lab** (`playground.pixel`). Build **Depth Studio**, a premium Three.js/WebGL LED content feature that makes a flat LED wall appear to be a deep virtual chamber. You have access to the attached implementation pack at `docs/features/depth-studio/`.

## First: ground yourself in reality
1. Inspect current repo path, `git status`, current branch, main HEAD, open PRs/worktrees if available, package scripts, feature structure, and current tests. Do not assume paths, framework details, or commits from this prompt.
2. Read the actual `CLAUDE.md`, `SESSION.md`, `HANDOFF.md`, `ROADMAP.md`, `docs/agents/README.md` where present. Read every document in `docs/features/depth-studio/` including agent briefs and contracts.
3. Check the previously approved Sprint 2 P0 tasks: **fullscreen second-screen output**, **templates per screen/canvas/output**, and **Lead Architect cleanup/integration**. Preserve these priorities. If incomplete or conflicting, propose an isolated feature branch/spike and avoid destabilizing P0.
4. Give me a concise repo-state audit, risks, current P0 status, proposed branch/worktree plan, and the first runnable milestone. Do not claim work exists until you verify it.

## Mission
Create the first production-grade **Infinite Particle Room / Emerald Chamber** scene: clear perspective box with walls/floor/ceiling/grid extending behind the LED plane; layered translucent drifting leaf-like particles; atmospheric depth fog; controlled shimmering light sweep; elegant green palette; convincing dimensional illusion. Render smoothly in browser, configurable by LED canvas, deterministic and seamless in a 15-second loop. It must look visually excellent, not like a generic particle demo.

## Work method — use available agents aggressively but safely
After Gate 0 audit and shared interface approval, orchestrate independent agents/worktrees for:
- Renderer & Camera (`agents/RENDERER_CAMERA.md`)
- Particles & Shaders (`agents/PARTICLES_SHADERS.md`)
- UX & Presets (`agents/UX_PRESETS.md`)
- Export & Output (`agents/EXPORT_OUTPUT.md`)
- QA & Demo (`agents/QA_DEMO.md`)

If subagents or parallel worktrees are unavailable, execute the same workstreams sequentially. Never imply agents are running if they are not. Assign strict ownership and prevent conflicting edits. Use dedicated feature branches, PRs, small commits and evidence-based handoffs. No agent commits to main. The Lead Architect integrates and runs all checks. Avoid wasting tokens on repeated full-repo scans.

## Technical requirements
- Reuse actual app contracts for canvas, mapping, templates, fullscreen output and persistence. Do not duplicate source of truth.
- Use Three.js/WebGL and existing TypeScript/React conventions; React Three Fiber only if architecturally justified.
- Separate serializable scene config, deterministic simulation, WebGL renderer, editor and output adapter.
- Camera/perspective must preserve correct aspect ratio and support physical wall/viewer parameters when available. Be explicit that true anamorphic multi-plane calibration is future scope.
- Seeded GPU particles with time-based periodic animation; loop-safe shader uniforms; no dependence on fluctuating RAF delta for export.
- Editor: scene preview, six essential controls, canvas selector, preset/reset, play/pause/scrub, save/load, FPS indicator, fullscreen path.
- Output: exact configured dimensions, fixed frame count/timing where feasible, honest codec/container support. Never label WebM as MP4. Prefer a validated PNG sequence if MP4 is unavailable. NDI later.
- Handle WebGL context loss, weak GPUs, huge canvases and unsupported encoding gracefully.
- Maintain existing tests and avoid unrelated refactors, power/weight estimator, billing, marketplace or five incomplete scene templates.

## Execution stages
**Stage A — Audit and contract:** inspect code; define interfaces, owner boundaries and acceptance tests; update implementation plan and session handoff files without overwriting unrelated content.
**Stage B — Visual spike:** make a runnable chamber that reads as deep even with particles hidden. Demonstrate 16:9 and ultrawide.
**Stage C — Parallel implementation:** integrate GPU particles, shader sweep, inspector and preset, output/export research, QA harness.
**Stage D — Integration:** connect existing canvas and second-screen output; fixed-timestep loop and export; typecheck/test/build; measure preview performance.
**Stage E — Deliver:** runnable demo, screenshots/video if supported, 15-second loop if export supported, clear instructions, PRs, known limitations, next steps.

## Acceptance gates
1. One click opens a convincing room with obvious depth even without particles.
2. Correct framing across canvas aspect ratios.
3. Same seed + config + time produces same state.
4. No visible loop jump; exported frames have correct dimensions/count.
5. Fullscreen/output has no editor overlays.
6. No regressions in existing Pixel Lab modules or Sprint 2 P0 work.
7. Measured preview FPS and documented browser/GPU limitations.
8. Visual result is ready to demo to a paying AV customer.

## Communication
Start with the short audit and your proposed agent assignments. Then execute the first safe milestone without waiting for confirmation **unless** you encounter destructive changes, unclear ownership of shared contracts, or an unresolved Sprint 2 P0 conflict. After each milestone, report: what is working, evidence (screenshots/tests), branch/commit/PR, what is blocked, and the next most valuable step. Do not stop at planning; deliver a running prototype. Do not fabricate test results or completed agents.

## Product constraint
Our goal is not to build Blender in a browser. Our goal is to sell a repeatable LED depth effect to real AV producers. Prefer one exceptional, reliable, exportable preset over a large incomplete graphics engine.
