# Delivery Roadmap — Dependency-Aware

## Gate 0: Repo audit (required, no implementation)
Read repo docs and inspect actual branches, PRs, tests, package manifests, canvas/output architecture. Confirm Sprint 2 P0 status and identify safe integration seam. Produce short evidence-based audit, branch plan and dependency map. No speculative files changed.

## Gate 1: Technical spike (isolated)
Build standalone prototype of perspective chamber + particle instancing + periodic shader animation, behind a feature flag or in a safe route. Demonstrate obvious depth at 16:9 and ultrawide ratios. Record GPU performance. No cross-module changes.

## Gate 2: Contract and integration
Versioned config schema; scene registry; adapter to active canvas; preset persistence; unit tests. Architect signs off interfaces before agents edit shared code.

## Gate 3: Production vertical slice
Polished Infinite Particle Room, editor controls, timeline, save/load, safe error handling, preview FPS. Integrate with existing fullscreen output when stable.

## Gate 4: Deterministic output
Fixed-timestep capture, correct resolution/frame count, verified format, loop seam tests. If MP4 unsupported, document exact alternative; don't block all value on codec work.

## Gate 5: Demo and pilot
15-second loop + walkthrough, LED wall/fullscreen test, 3 customer demos, collect willingness to pay and format requirements.

## Future (not this sprint)
More presets, multi-plane anamorphic calibration, imported glTF assets, NDI, reusable scene marketplace, billing.

## Definition of Done
One scene is visually persuasive; reproducible and loop-safe; integrated without regressions; exports truthfully; benchmarked; demo-ready; validated by at least one production user.
