import type { Rect } from "@/domain/units";

/** Maps world units (px or µm) to screen pixels: screen = world × scale + offset. */
export interface Viewport {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function worldToScreen(vp: Viewport, x: number, y: number) {
  return { x: x * vp.scale + vp.offsetX, y: y * vp.scale + vp.offsetY };
}

export function screenToWorld(vp: Viewport, x: number, y: number) {
  return { x: (x - vp.offsetX) / vp.scale, y: (y - vp.offsetY) / vp.scale };
}

export function zoomAt(vp: Viewport, factor: number, screenX: number, screenY: number, min: number, max: number): Viewport {
  const scale = Math.min(max, Math.max(min, vp.scale * factor));
  const world = screenToWorld(vp, screenX, screenY);
  return { scale, offsetX: screenX - world.x * scale, offsetY: screenY - world.y * scale };
}

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** Pinch on a trackpad arrives as a wheel event with ctrlKey set. */
  readonly zoom: boolean;
  /** Pointer position on the canvas, in screen pixels. */
  readonly x: number;
  readonly y: number;
}

/** A wheel or trackpad step: pinch or ⌘-scroll zooms at the pointer, plain scroll pans. */
export function wheelViewport(vp: Viewport, input: WheelInput, min: number, max: number): Viewport {
  if (input.zoom) return zoomAt(vp, Math.exp(-input.deltaY * 0.01), input.x, input.y, min, max);
  return { ...vp, offsetX: vp.offsetX - input.deltaX, offsetY: vp.offsetY - input.deltaY };
}

export function fitViewport(bounds: Rect<number> | null, viewWidth: number, viewHeight: number, margin = 48): Viewport {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { scale: 0.25, offsetX: margin, offsetY: margin };
  }
  const scale = Math.min((viewWidth - margin * 2) / bounds.width, (viewHeight - margin * 2) / bounds.height);
  const safe = scale > 0 ? scale : 0.01;
  return {
    scale: safe,
    offsetX: (viewWidth - bounds.width * safe) / 2 - bounds.x * safe,
    offsetY: (viewHeight - bounds.height * safe) / 2 - bounds.y * safe,
  };
}
