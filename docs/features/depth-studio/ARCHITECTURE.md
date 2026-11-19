# Architecture Proposal — adapt to real repo

## Principles
1. Inspect actual code first; do not assume framework or folder names. Existing React/TypeScript conventions take precedence.
2. Reuse current canvas, mapping, output, template, persistence and fullscreen contracts.
3. Separate **scene data**, **scene simulation**, **renderer**, **editor**, and **export adapter**.
4. Determinism: `render(config, t)` rather than simulation tied to elapsed `requestAnimationFrame` deltas.
5. Rendering resolution independent of CSS preview resolution; devicePixelRatio capped for previews.

## Suggested boundaries (illustrative)
```
src/features/depth-studio/
  model/          # config schema, defaults, validation, migrations
  scenes/         # scene registry and InfiniteParticleRoom preset
  renderer/       # Three.js renderer, camera, lighting, instanced particles
  shaders/        # reusable GLSL materials, light sweep, normals
  editor/         # scene inspector, viewport, controls, timeline
  adapters/       # existing canvas/output/export/persistence interfaces
  tests/          # unit, integration, visual snapshots
```
Do not create this tree blindly if the repo uses another feature structure.

## Pipeline
`Pixel Lab canvas -> DepthSceneConfig -> scene registry -> deterministic scene(t) -> WebGL renderer -> preview viewport / fullscreen output / frame capture -> validated export`.

## Projection
- V1 camera is a calibrated or proportional **perspective** camera, positioned in front of a virtual chamber aligned to the display plane.
- Explicitly distinguish virtual room depth from physical wall size. Use consistent meters or normalized world units.
- Compute horizontal FOV from vertical FOV and aspect ratio or use a physical camera/viewer formulation if dimensions are known.
- Screen is a window into virtual space, not an object textured with a video.
- For a physically calibrated sweet spot, derive off-axis projection from display plane corners and viewer eye point; document conventions and test with reference markers. Do not overpromise exact calibration in V1.

## Scene animation
- Config includes `seed`, `durationSeconds`, `fps`, and periodic functions.
- Each particle has deterministic initial position, size, opacity, speed, phase from seed.
- Motion wraps continuously or uses periodic sin/cos curves with period matching loop duration.
- Lighting sweep phase = `2π * (t % duration) / duration`.
- Avoid particle re-seeding during loop playback.
- For frame i of N, `t = i / fps`, `N = round(duration * fps)`; never encode a duplicate frame at `t=duration`.

## Materials
- Particle billboards or instanced geometry with alpha, depth write disabled when appropriate, sorted/blending artifacts assessed.
- Shimmer via animated shader uniforms and normal perturbation; actual geometric displacement only where supported by tessellation/geometry density.
- Fog via distance-based shader or Three.js fog.
- Use physically plausible contact/ambient shadows only where they visibly improve scene; don't burn GPU for invisible realism.

## Export
- Preview runs in browser at reduced internal resolution.
- For capture, advance fixed timestep and render at exact output resolution to an offscreen target or capture canvas.
- Ensure output color space, alpha policy, pixel ratio and tone mapping are consistent.
- WebGL canvas capture + MediaRecorder is not inherently frame-exact; if used, label as real-time capture and test jitter. Prefer explicit frame-by-frame capture for deterministic exports.
- Check memory constraints before allocating 4K/8K targets.

## Integration contract
The existing app is the owner of: screen definitions, active canvas, output destination, template catalog, save system. Depth Studio owns: scene config, scene registry, rendering. Use thin adapters; avoid direct imports across feature internals where shared contracts exist.

## Dependencies
Prefer installed Three.js. React Three Fiber is optional only if it fits the existing architecture and performance model; do not add it reflexively. Avoid heavy postprocessing or physics packages in the first slice. Obtain approval before adding large runtime dependencies.

## Error states
No WebGL; GPU context loss; insufficient memory; unsupported encoder; export canceled; invalid dimensions; zero physical size; missing active canvas; incompatible output display; oversized particle count. Provide recovery UI and keep other modules functional.

## Security
Sanitize imported scene configs; no arbitrary shader code injection in V1. Validate URLs/asset types if imports are added later. Never run arbitrary code from user presets.
