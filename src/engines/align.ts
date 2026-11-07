import type { Id } from "@/domain/model";
import type { Rect } from "@/domain/units";
import { boundingBox } from "./geometry";

export type AlignMode = "left" | "center-x" | "right" | "top" | "center-y" | "bottom" | "distribute-x" | "distribute-y";

export interface PositionedItem {
  readonly id: Id;
  readonly rect: Rect<number>;
}

export interface Position {
  readonly id: Id;
  readonly x: number;
  readonly y: number;
}

/**
 * Aligns items against their shared bounding box. Results stay integer: centring
 * rounds down and distribution keeps any leftover unit in the last gap.
 */
export function alignItems(items: readonly PositionedItem[], mode: AlignMode): Position[] {
  const box = boundingBox(items.map((i) => i.rect));
  if (!box) return [];

  if (mode === "distribute-x" || mode === "distribute-y") {
    const horizontal = mode === "distribute-x";
    const sorted = [...items].sort((a, b) => (horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y) || a.id.localeCompare(b.id));
    const used = sorted.reduce((sum, i) => sum + (horizontal ? i.rect.width : i.rect.height), 0);
    const free = (horizontal ? box.width : box.height) - used;
    const gap = sorted.length > 1 ? Math.floor(free / (sorted.length - 1)) : 0;
    let cursor = horizontal ? box.x : box.y;
    return sorted.map((item, index) => {
      const isLast = index === sorted.length - 1 && sorted.length > 1;
      const size = horizontal ? item.rect.width : item.rect.height;
      const start = isLast ? (horizontal ? box.x + box.width : box.y + box.height) - size : cursor;
      cursor = start + size + gap;
      return horizontal ? { id: item.id, x: start, y: item.rect.y } : { id: item.id, x: item.rect.x, y: start };
    });
  }

  return items.map(({ id, rect }) => {
    switch (mode) {
      case "left": return { id, x: box.x, y: rect.y };
      case "right": return { id, x: box.x + box.width - rect.width, y: rect.y };
      case "center-x": return { id, x: box.x + Math.floor((box.width - rect.width) / 2), y: rect.y };
      case "top": return { id, x: rect.x, y: box.y };
      case "bottom": return { id, x: rect.x, y: box.y + box.height - rect.height };
      case "center-y": return { id, x: rect.x, y: box.y + Math.floor((box.height - rect.height) / 2) };
    }
  });
}
