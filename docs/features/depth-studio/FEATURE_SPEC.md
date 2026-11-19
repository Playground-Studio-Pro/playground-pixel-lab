# Depth Studio — Full Product Requirements Document

## 1. Vision
**Depth Studio: Turn an LED wall into a virtual world.**

Depth Studio is a production-focused generative graphics module in Playground Pixel Lab. Users enter the pixel dimensions and optionally physical size of a LED wall, choose a virtual scene, tune its depth, lighting, particles and camera, preview it in real time, and export deterministic seamless loops or route it to a second-screen fullscreen output. The core emotional result: a flat LED display feels like a box, chamber, tunnel, portal, or architectural space extending behind the wall.

### Differentiation
Unlike a generic 3D editor or motion graphics template library, Depth Studio understands **LED canvas resolution, physical dimensions, aspect ratio, screen grouping, and target viewer position**. It prioritizes repeatable production workflows, visually striking presets, precise outputs, and operational reliability.

### Honest optics
A flat LED wall cannot provide true binocular stereo or correct viewer-dependent motion parallax for all viewers simultaneously. The illusion is optimized for a selected viewing zone. A fixed-camera render can be convincing from the designed sweet spot; moving the virtual camera is a creative effect, not actual audience tracking. A normal map affects shading, not geometry. Displacement changes geometry only when applied to geometry or a relevant rendering stage. Reflections do not alone establish perspective depth.

## 2. Target users and jobs
- **AV producer:** Create an impressive stage backdrop fast, with correct output pixels and reliable playback.
- **Motion designer:** Customize polished scenes without rebuilding a Three.js project.
- **LED technician:** Map content to configured canvases and verify resolution, crop, safe areas, FPS, and playback behavior.
- **Agency creative:** Preview a visually compelling 3D concept before approving expensive production.

### Jobs-to-be-done
1. From an existing LED canvas, generate a compelling dimensional animation in under 10 minutes.
2. See an accurate preview at the selected aspect ratio and virtual camera position.
3. Export a loop with known frame rate, exact frame count, dimensions, and loop closure.
4. Play content fullscreen on a second output without UI overlays, when the existing output subsystem supports it.
5. Save/reopen scene parameters and reproduce the same output.

## 3. V1 Scope (one vertical slice)
**Infinite Particle Room**: a virtual chamber behind the screen, with visible floor/side-wall/ceiling perspective, depth grid, atmospheric fog, moving translucent shapes, and a shimmering directional light/reflection treatment. Include a simple back wall or vanishing depth cue. Scene must look intentional, not like generic floating particles on a wallpaper.

**Core controls:** virtual depth, viewer/camera position, particle density, motion speed, lighting direction/intensity, color palette. Add advanced controls only if implementation is cheap and stable (fog, geometry selection, seed, loop duration).

**V1 interactions:** select canvas; open Depth Studio; choose Infinite Particle Room; adjust controls with immediate preview; toggle perspective guides; reset preset; save configuration; preview loop; use existing output/fullscreen path; export a deterministic sequence or video via an available validated pipeline.

**V1 deliverables:** integrated UI, renderer, serializable scene config, preset, deterministic animation, output path, test coverage, user-facing errors, demo video or screenshots, usage docs.

## 4. Future scenes (NOT required for first slice)
- **Kinetic Tunnel:** converging geometry and rhythmic motion, stage openers.
- **Liquid Surface:** refraction/normal-map and reflective materials, premium abstract backgrounds.
- **Floating Product Chamber:** import branded objects and position them in virtual depth.
- **Architectural Room:** calibrated walls and contact shadows for realistic virtual sets.
- **Anamorphic Corner:** multi-surface calibrated projection; requires explicit screen geometry and viewpoint.

## 5. Viewpoint modes
**Frontal Depth (V1):** one flat LED canvas, camera/viewer position editable, rectangular perspective chamber. Must work with arbitrary pixel aspect ratios. Physical dimensions improve real-world calibration but are optional; default to sensible proportional geometry if missing.

**Calibrated Anamorphic (later):** requires physical display geometry, precise audience eye point, screen planes and orientation. Do not claim anamorphic calibration is solved by merely changing a perspective slider. Distinguish camera calibration from generic 3D look.

## 6. UX
Entry from Content Generator / scene library, not a new standalone application. Layout: scene viewport dominant; compact parameter inspector; canvas/output selector; preset chooser; performance/FPS indicators; loop controls; export. Premium AV aesthetic aligned to existing design system; no unapproved redesign of app shell. Controls must support mouse and keyboard; prevent accidental expensive GPU settings.

## 7. Functional requirements
- DS-01 Read existing canvas dimensions and active output selection via adapters; never duplicate mapping source of truth.
- DS-02 Render at preview dimensions while maintaining exact aspect ratio.
- DS-03 Config is serializable, versioned, validated, and round-trippable.
- DS-04 All procedural motion is time-based and seed-based, independent of variable browser frame timing.
- DS-05 Seamless loop: frame 0 and frame N must meet visually at boundary; avoid duplicate final frame in encoded sequence.
- DS-06 Perspective geometry gives clear spatial depth even with particles disabled.
- DS-07 GPU particles use instancing/points where appropriate; avoid thousands of React objects.
- DS-08 Light sweep/shimmer is tunable and must not introduce uncontrolled flicker.
- DS-09 Output and export must not contain UI, debug guides, or editor handles.
- DS-10 Persist settings using existing app persistence pattern; don't introduce a parallel store without architectural approval.
- DS-11 Handle WebGL unavailable, context lost, high DPR, and unsupported export codecs gracefully.
- DS-12 Show accurate distinction between **preview FPS**, **export FPS**, and **LED hardware refresh rate**.
- DS-13 Provide a no-sound seamless loop; avoid hard cut in motion, particles, and lighting.
- DS-14 Support start/pause/reset/scrub timeline, with identical visual state for the same time and seed.
- DS-15 Maintain accessibility of controls and reasonable reduced-motion editor behavior.

## 8. Non-functional requirements
- Browser preview target: 60 FPS at moderate scene density on a representative modern laptop; measure, don't promise universally.
- Avoid unbounded GPU memory growth, memory leaks, and redundant render loops.
- Deterministic output at 24/25/30/50/60 FPS where the existing pipeline supports it.
- Exact output dimensions; validate browser/encoder maximum canvas sizes.
- All changes typechecked, linted, and tested per repository conventions.
- Feature flags or safe routes for incomplete work; no regressions to Mapping, Cabinet Library, Aurora Gradient, Motion Lab, or fullscreen output.

## 9. Export policy
Preferred hierarchy: (1) reuse existing reliable output/export architecture; (2) deterministic frame capture to PNG sequence or browser-compatible encoding; (3) MP4 only when a verified encoder/pipeline exists. **Do not falsely label WebM as MP4.** If MP4 is not feasible in browser without new dependencies, document the limitation and offer PNG sequence or validated server/FFmpeg option for later decision. NDI is explicitly future scope.

## 10. Acceptance criteria
1. One click opens a coherent Infinite Particle Room preset on a selected canvas.
2. Removing particles still reveals an unmistakable perspective chamber.
3. Physical size/aspect-ratio changes preserve correct framing and never stretch the preview.
4. Same config + seed + timestamp renders equivalent visual state across runs.
5. Loop boundary passes visual/automated comparison with no noticeable jump.
6. Output excludes editor chrome and fills intended screen safely.
7. Export produces correct dimensions/frame count and truthful file format.
8. Browser performance measured with settings documented; graceful fallback for weak GPUs.
9. Existing tests and Sprint 2 P0 features remain intact.
10. A 15-second demo and a 2-minute walkthrough exist for customer validation.

## 11. Business validation
Show the prototype to at least 3 working AV producers/designers. Ask: Would you use this for an actual show? What output format and setup time are non-negotiable? What would you pay per show/month? Track actual willingness to pilot, not compliments. Avoid expanding templates until one paid pilot or clear workflow pull emerges.

## 12. Explicit exclusions
No full Blender replacement; no complex timeline editor; no automatic perfect anamorphic calibration; no head tracking; no multi-view stereo; no real-time NDI in V1; no subscription/payments; no power/weight estimators; no new 3D asset marketplace; no wholesale architecture rewrite.
