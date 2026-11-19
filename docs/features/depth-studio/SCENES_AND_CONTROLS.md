# Scenes and Controls

## Hero scene: Infinite Particle Room
**Visual direction:** dark emerald/forest-green chamber, faint perspective grid, soft volumetric atmosphere, tiny translucent leaf-like shapes drifting at different depths, a shimmering wave of light sweeping from left to right, delicate reflection/normal detail. Keep enough contrast for LED display in a lit corporate venue. Avoid noisy high-frequency microdetail that aliases on LED pixel pitch.

### Default preset (tunable proposal)
- Name: `Emerald Chamber`
- Duration: 15 s, seamless
- Virtual room depth: 12 m
- Particles: 1,500 instanced sprites or quads
- Movement: gentle lateral + vertical drift, periodic
- Fog: subtle, depth-dependent
- Camera: fixed frontal, editable viewer distance and offsets
- Grid: low-contrast perspective reference, optionally hideable
- Shimmer: broad moving sweep with soft edges; no strobe
- Palette: deep green, muted lime, pale silver highlights
- Export: active LED canvas dimensions, 30 FPS default (configurable)

### V1 controls and validation
| Control | Suggested range | Notes |
|---|---|---|
| Virtual depth | 2–30 m | Change actual geometry |
| Viewer distance | 2–30 m | Projection/camera framing; if physical calibration enabled |
| Viewer horizontal offset | -10 to +10 m | Sweet-spot position |
| Viewer height | 0.5–3 m | Default ~1.6 m |
| Particle density | 0–5,000 | Guardrail based on GPU |
| Particle speed | 0–2x | Periodic loop-safe motion |
| Light intensity | 0–2 | Avoid clipping |
| Light direction | -180° to +180° | Directional sweep or key light |
| Palette | preset + 3 colors | Hex input with validation |
| Loop duration | 5–60 s | Check exact frame count |
| Seed | integer | Reproducibility |

### Advanced drawer (optional)
Fog density, particle shape, particle scale, grid opacity, wall reflectivity, sweep width, motion amplitude, camera FOV. Hide these unless needed for quality.

## Later presets
**Kinetic Tunnel:** repeating geometry, rhythmic depth cues, low flicker. **Liquid Surface:** glossy materials and animated distortion, not necessarily a physical room. **Floating Object Chamber:** branded 3D objects and shadows. **Architectural Box:** clean wall/floor/ceiling calibration. **Corner Anamorphic:** separate geometry calibration project with multi-plane mapping.

## Demo storyboard (15 s)
0–3 s: room establishes depth; 3–8 s: particles drift through layers, soft sweep moves; 8–12 s: subtle parallax accent; 12–15 s: returns smoothly to initial state. Loop must not flash or pop at seam.
