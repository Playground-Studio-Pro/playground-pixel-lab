# Depth Studio — Implementation Pack

**Project:** Playground Pixel Lab (`playground.pixel`)  
**Status:** Proposed feature, NOT implemented  
**Owner:** Product / Lead Architect  
**Priority:** After Sprint 2 P0 integration unless isolated parallel work is demonstrably safe.

## Purpose
Depth Studio turns physical LED canvases into visually convincing virtual spaces using Three.js/WebGL. It combines perspective-correct geometry, GPU particles, cinematic lighting, parallax, and deterministic animation with production-ready LED output.

## Contents
- `FEATURE_SPEC.md` — product brief, workflows, constraints, acceptance criteria.
- `ARCHITECTURE.md` — recommended architecture, render/export, interfaces.
- `SCENES_AND_CONTROLS.md` — presets and UX parameter definitions.
- `ROADMAP.md` — vertical slices, gates, milestones.
- `QA_AND_PERFORMANCE.md` — testing, benchmarks, visual validation.
- `AGENT_ORCHESTRATION.md` — parallel workstreams, dependencies, merge protocol.
- `contracts/depth-studio.types.ts.md` — proposed contract examples, not authoritative code.
- `agents/*.md` — role-specific agent tasks.
- `CLAUDE_MASTER_PROMPT.md` — single copy/paste kickoff prompt.

## Non-negotiable repo policy
Before coding, inspect actual repository state and read existing `CLAUDE.md`, `SESSION.md`, `HANDOFF.md`, `ROADMAP.md`, and `docs/agents/README.md` if present. **Do not replace these files** with pack files. GitHub/main is source of truth. Verify Sprint 2 P0 status (second-screen fullscreen output, per-screen/canvas/output templates, architect cleanup). Preserve working functionality and tests. No invented claims about current code.

## Installation
Copy `docs/features/depth-studio/` into the repo, then open `CLAUDE_MASTER_PROMPT.md` and paste its contents into the lead Claude session. Keep the prompt in repo or at root as desired. Do not copy these files into an agent worktree before its base branch is synchronized.

## Product decision
Ship a compelling **Infinite Particle Room** vertical slice first. Build extensible perspective and scene contracts, not five half-finished presets. No billing, multi-tenant infrastructure, or advanced engineering estimators in this feature sprint.
