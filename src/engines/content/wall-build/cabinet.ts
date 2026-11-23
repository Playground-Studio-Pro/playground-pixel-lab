import { outlineFor } from "./contrast";

/**
 * A cabinet while it's carried or being placed, as flat rectangles in whole pixels from its top-left
 * corner. Nothing is drawn outside its mapped size: the edge is inside it, in the outline colour that
 * stands out from the background.
 */
export interface CabinetRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly fill: string;
}

export const CARRIED_FACE = "#8F9CC8";
const SEAM = "#5C6896";
const CORNER = "#C9D3F2";

export function carriedCabinet(size: { readonly width: number; readonly height: number }, background?: string): readonly CabinetRect[] {
  const { width: w, height: h } = size;
  const edge = Math.max(1, Math.min(2, Math.floor(Math.min(w, h) / 16)));
  const rects: CabinetRect[] = [{ x: 0, y: 0, w, h, fill: outlineFor(background) }];
  if (w > 2 * edge && h > 2 * edge) rects.push({ x: edge, y: edge, w: w - 2 * edge, h: h - 2 * edge, fill: CARRIED_FACE });
  if (Math.min(w, h) < 32) return rects;
  // Module seams and corner locks.
  rects.push({ x: Math.floor(w / 2), y: edge, w: 1, h: h - 2 * edge, fill: SEAM }, { x: edge, y: Math.floor(h / 2), w: w - 2 * edge, h: 1, fill: SEAM });
  for (const x of [6, w - 14]) for (const y of [6, h - 14]) rects.push({ x, y, w: 8, h: 8, fill: CORNER });
  return rects;
}
