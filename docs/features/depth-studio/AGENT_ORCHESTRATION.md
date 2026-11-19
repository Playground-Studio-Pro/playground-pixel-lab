# Multi-Agent Orchestration

## Lead Architect owns integration
Read actual repo state and docs, verify main branch, active PRs, current tests, and Sprint 2 P0 priorities. Define interfaces and ownership. Coordinate agents with independent branches/worktrees; no agent commits directly to main. Do not assume a specific number of agents or that Claude automatically creates subagents.

## Recommended lanes (parallel after Gate 0)
1. **Renderer & Camera** — perspective chamber, projection, resize, renderer lifecycle.
2. **Particles & Shaders** — deterministic instanced particles, sweep/reflection/normal treatment, loop-safe motion.
3. **UX & Presets** — inspector, preset registry, preview controls, scene config UI; use mocked contract initially.
4. **Export & Output** — investigate existing fullscreen/export capabilities, deterministic frame capture, format verification; implement only against approved contract.
5. **QA & Demo** — test plan, visual snapshots, benchmark harness, sample scene and pilot-ready demo; avoid editing others' implementation files.

## Dependency ordering
- Gate 0 audit and contract approval happen before shared integration.
- Renderer and particles can prototype in parallel after contract draft.
- UX uses typed mock adapter until renderer stable.
- Export can research in parallel but must not rewrite current output path.
- QA defines tests early and validates after integration.
- Lead Architect merges renderer + particles first, then UX, then output, then QA/doc polish.

## Ownership boundaries
Agents edit only owned folders or files approved in handoff. Shared types and integration entrypoints belong to Lead Architect. One branch per lane. If files conflict, stop and ask lead to resolve. Do not cherry-pick blindly or force-push shared branches.

## Agent completion report
Each lane reports: branch, commit hash, files changed, decisions, tests run and outcomes, performance observations, known issues, risks, and exact merge instructions. Include screenshots/video where visual quality is essential.

## Quality gates
- Feature-flag incomplete work.
- No regression in existing modules.
- Build/typecheck/tests green.
- No unapproved heavy dependencies.
- Accurate exported format and frame timing.
- Lead Architect manually reviews final visual result, not just passing tests.

## Cost and speed controls
Start with audit + one narrow prototype. Parallelize only after interface agreement. Avoid agents repeatedly scanning full repo; give each a scoped brief and ask for compact handoffs. Stop low-value work if it threatens Sprint 2 P0 integration.
