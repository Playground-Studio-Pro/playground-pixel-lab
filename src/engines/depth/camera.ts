import type { DepthSceneConfig } from "./config";
import type { DepthTarget } from "./targets";

/**
 * The LED plane as a window into the room.
 *
 * World space, in metres: the LED plane is the rectangle `width × height` centred on the origin at
 * z = 0. +x is right, +y is up, and the room lies behind the plane, at negative z. The viewer stands
 * in front, at positive z.
 *
 * The projection is off-axis: its frustum passes exactly through the four edges of the LED plane, for
 * any eye position. That is what makes the wall a window rather than a picture of a room. The edges of
 * the plane always land on the edges of the image, at every aspect ratio, so nothing is ever stretched.
 *
 * This is frontal, single-plane perspective. Calibrated anamorphic mapping across several planes is a
 * separate, later problem.
 */

export interface DepthWindow {
  readonly widthM: number;
  readonly heightM: number;
  /** `physical` when the size is the real wall's. `proportional` when it's a nominal size at the right aspect ratio. */
  readonly calibration: "physical" | "proportional";
}

/** Height given to a target whose physical size isn't known. */
export const NOMINAL_WINDOW_HEIGHT_M = 3;

export function depthWindow(target: Pick<DepthTarget, "widthPx" | "heightPx" | "physical">): DepthWindow {
  if (target.physical) return { widthM: target.physical.widthM, heightM: target.physical.heightM, calibration: "physical" };
  return { widthM: (NOMINAL_WINDOW_HEIGHT_M * target.widthPx) / target.heightPx, heightM: NOMINAL_WINDOW_HEIGHT_M, calibration: "proportional" };
}

export type Vec3 = readonly [number, number, number];
/** Column-major 4×4, as WebGL takes it. */
export type Mat4 = readonly number[];

export interface DepthCamera {
  readonly eye: Vec3;
  readonly near: number;
  readonly far: number;
  /** Projection × view. */
  readonly viewProjection: Mat4;
}

export function depthCamera(window: DepthWindow, viewer: DepthSceneConfig["viewer"], depthM: number): DepthCamera {
  const d = Math.max(0.1, viewer.distanceM);
  const ex = viewer.offsetXM;
  const ey = viewer.offsetYM;
  // The near plane sits in front of the LED plane, so the room is never clipped.
  const near = d * 0.5;
  const far = d + depthM + 1;
  const k = near / d;
  const left = (-window.widthM / 2 - ex) * k;
  const right = (window.widthM / 2 - ex) * k;
  const bottom = (-window.heightM / 2 - ey) * k;
  const top = (window.heightM / 2 - ey) * k;

  const a = (2 * near) / (right - left);
  const b = (2 * near) / (top - bottom);
  const c = (right + left) / (right - left);
  const e = (top + bottom) / (top - bottom);
  const f = -(far + near) / (far - near);
  const g = (-2 * far * near) / (far - near);
  // The frustum × a translation by −eye. The camera never rotates: it always faces the plane squarely.
  const viewProjection = [
    a, 0, 0, 0,
    0, b, 0, 0,
    c, e, f, -1,
    -a * ex - c * d, -b * ey - e * d, -f * d + g, d,
  ];
  return { eye: [ex, ey, d], near, far, viewProjection };
}

/**
 * Where a world point lands on the image: x and y from 0 to 1, origin top-left, as in every pixel
 * space. Points on the LED plane's edge land exactly on the image's edge.
 */
export function projectPoint(camera: DepthCamera, point: Vec3): { x: number; y: number } {
  const m = camera.viewProjection;
  const [x, y, z] = point;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return { x: (cx / cw + 1) / 2, y: (1 - cy / cw) / 2 };
}

/** The point every line running straight into the room converges on. It sits directly opposite the eye. */
export function vanishingPoint(window: DepthWindow, viewer: DepthSceneConfig["viewer"]): { x: number; y: number } {
  return { x: 0.5 + viewer.offsetXM / window.widthM, y: 0.5 - viewer.offsetYM / window.heightM };
}

/** Rings of light along the room, about two metres apart. Deeper rooms get more of them. */
export function ringLayout(depthM: number): { count: number; spacingM: number } {
  const count = Math.max(2, Math.round(depthM / 2));
  return { count, spacingM: depthM / count };
}
