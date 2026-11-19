# QA, Performance, Visual Validation

## Automated
- Schema validation, defaults, migration/version handling, out-of-range values.
- Seed/time determinism (particle transforms, shader uniforms, camera matrices).
- Periodicity: evaluate scene at `t=0` and `t=duration` within numeric tolerance.
- Exact dimensions and frame count at 24/25/30/50/60 FPS where supported.
- Export MIME/container match; no misleading `.mp4` suffix.
- No editor overlays in fullscreen/export.
- Screen aspect ratios: 16:9, 21:9, 9:16, unusual LED custom resolution.
- Regression suite for Mapping, Cabinet Library, Aurora Gradient, templates, fullscreen output.

## Visual manual tests
- Depth readable without particles.
- Near/mid/far particle layers visibly distinct.
- No alpha sorting artifacts, z-fighting, grid shimmer, excessive bloom or flicker.
- Sweep resembles light traveling across a surface, not a white gradient wipe.
- No stretched geometry when canvas aspect ratio changes.
- No obvious seam between final and first encoded frame.
- LED-safe highlights, reasonable contrast, no microscopic details that disappear at distance.

## Performance measurement
Measure average FPS, p95 frame time, GPU memory proxies if available, renderer draw calls, triangles, and time to first preview. Profile at low/medium/high settings and on at least one representative laptop. Preview target 60 FPS at medium; degrade particle count/render scale before breaking editor. Use proper teardown to avoid leaking contexts or RAF loops.

## Export matrix
For each tested format report browser, resolution, FPS, duration, frames, file size, observed dropped frames, and whether encoding is deterministic. Do not assert that MediaRecorder guarantees exact frame count.

## Operational smoke test
1. Open existing project and select LED canvas.
2. Open Depth Studio preset.
3. Change resolution and viewer offset.
4. Pause, scrub, resume, reset.
5. Save, reload, confirm identical state.
6. Fullscreen second-screen output (if existing feature is available).
7. Export 15 s; inspect metadata and loop seam.
8. Return to Mapping and Motion Lab; confirm unchanged behavior.
