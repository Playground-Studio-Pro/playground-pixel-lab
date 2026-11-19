# Proposed TypeScript Contract (illustrative — adapt to repo)

```ts
export type DepthSceneId = 'infinite-particle-room';
export interface Vec3 { x: number; y: number; z: number }
export interface DepthSceneConfigV1 {
  version: 1;
  id: string;
  sceneId: DepthSceneId;
  canvasId: string;
  seed: number;
  durationSeconds: number;
  exportFps: 24 | 25 | 30 | 50 | 60;
  room: { depthMeters: number; showGrid: boolean; gridOpacity: number };
  viewer: { positionMeters: Vec3; calibrationMode: 'proportional' | 'physical' };
  particles: { count: number; speed: number; size: number; opacity: number; shape: 'leaf' | 'disc' | 'quad' };
  lighting: { intensity: number; directionDegrees: number; sweepWidth: number };
  atmosphere: { fogDensity: number };
  palette: { background: string; particle: string; accent: string };
}
export interface DepthSceneRenderer {
  setConfig(config: DepthSceneConfigV1): void;
  renderAt(seconds: number): void;
  resize(widthPx: number, heightPx: number): void;
  dispose(): void;
}
export interface DepthOutputTarget {
  widthPx: number;
  heightPx: number;
  target: 'preview' | 'fullscreen' | 'export';
}
```

## Contract caveats
- `canvasId` references existing app-owned canvas. Do not store duplicate canvas dimensions as authoritative scene data.
- Actual persistence/renderer adapters must match existing code.
- Prefer a runtime validator (existing project standard) and explicit migration path.
- The config shape is a proposal, not a mandate; lead architect must review.
