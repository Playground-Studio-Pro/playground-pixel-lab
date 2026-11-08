import type { Rect } from "@/domain/units";

/** Height of a preview label chip, in CSS pixels. */
export const LABEL_HEIGHT = 18;
const INSET = 4;
const GAP = 2;
/** How many rows a label may move away from its corner before it's dropped. */
const MAX_ROWS = 4;

export interface LabelRequest {
  /** Chip width in CSS pixels, already truncated to fit the area. */
  readonly width: number;
  /** Where the label belongs, in canvas CSS pixels. It never leaves this rectangle. */
  readonly area: Rect<number>;
  /** Corner the label starts from. It moves inward, a row at a time, to avoid other labels. */
  readonly anchor: "top" | "bottom";
}

/**
 * Places preview labels so none cover each other: each takes the first free slot near its corner,
 * left then right, a row further in each time. Labels that find no free slot inside their area are
 * dropped (null) rather than drawn on top of another. Requests earlier in the list win.
 * Pure, so the rule can be tested without a canvas.
 */
export function placeLabels(requests: readonly LabelRequest[], bounds: Rect<number>): (Rect<number> | null)[] {
  const placed: Rect<number>[] = [];
  return requests.map((req) => {
    const { area, width } = req;
    if (width + 2 * INSET > area.width || LABEL_HEIGHT + 2 * INSET > area.height) return null;
    if (!intersects(area, bounds)) return null;
    for (let row = 0; row < MAX_ROWS; row++) {
      const shift = row * (LABEL_HEIGHT + GAP);
      const y = req.anchor === "top" ? area.y + INSET + shift : area.y + area.height - INSET - LABEL_HEIGHT - shift;
      if (y < area.y + INSET - 0.001 || y + LABEL_HEIGHT > area.y + area.height - INSET + 0.001) break;
      for (const x of [area.x + INSET, area.x + area.width - INSET - width]) {
        const box = { x, y, width, height: LABEL_HEIGHT };
        if (!placed.some((p) => intersects(p, box))) {
          placed.push(box);
          return box;
        }
      }
    }
    return null;
  });
}

function intersects(a: Rect<number>, b: Rect<number>) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
