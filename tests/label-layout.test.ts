import { describe, expect, it } from "vitest";
import { LABEL_HEIGHT, placeLabels, type LabelRequest } from "@/preview/label-layout";

const VIEW = { x: 0, y: 0, width: 2000, height: 2000 };
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("preview label layout", () => {
  it("keeps a label at its corner when nothing is in the way", () => {
    const [top, bottom] = placeLabels(
      [
        { width: 100, area: { x: 10, y: 20, width: 300, height: 200 }, anchor: "top" },
        { width: 80, area: { x: 10, y: 20, width: 300, height: 200 }, anchor: "bottom" },
      ],
      VIEW,
    );
    expect(top).toEqual({ x: 14, y: 24, width: 100, height: LABEL_HEIGHT });
    expect(bottom).toEqual({ x: 14, y: 20 + 200 - 4 - LABEL_HEIGHT, width: 80, height: LABEL_HEIGHT });
  });

  it("never draws two labels over each other, as with the Header sharing the Center Wall's top band", () => {
    // Content view: both screens start at the same corner. Plus a short shared band.
    const requests: LabelRequest[] = [
      { width: 240, area: { x: 100, y: 100, width: 600, height: 300 }, anchor: "top" }, // Center Wall
      { width: 220, area: { x: 100, y: 100, width: 600, height: 75 }, anchor: "top" }, // Header
      { width: 150, area: { x: 100, y: 100, width: 600, height: 75 }, anchor: "bottom" }, // Shared band
    ];
    const boxes = placeLabels(requests, VIEW);
    const placed = boxes.filter((b) => b !== null);
    expect(placed).toHaveLength(3);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false);
    // Each stays inside its own area.
    boxes.forEach((b, i) => {
      const a = requests[i].area;
      expect(b!.x >= a.x && b!.y >= a.y && b!.x + b!.width <= a.x + a.width && b!.y + b!.height <= a.y + a.height).toBe(true);
    });
  });

  it("drops a label with no free slot instead of covering another", () => {
    const area = { x: 0, y: 0, width: 130, height: 26 };
    const boxes = placeLabels(
      [
        { width: 120, area, anchor: "top" },
        { width: 120, area, anchor: "bottom" },
      ],
      VIEW,
    );
    expect(boxes[0]).not.toBeNull();
    expect(boxes[1]).toBeNull();
  });

  it("skips labels too big for their area or off the canvas", () => {
    const boxes = placeLabels(
      [
        { width: 200, area: { x: 0, y: 0, width: 150, height: 100 }, anchor: "top" },
        { width: 50, area: { x: 0, y: 0, width: 150, height: 20 }, anchor: "top" },
        { width: 50, area: { x: 3000, y: 0, width: 150, height: 100 }, anchor: "top" },
      ],
      VIEW,
    );
    expect(boxes).toEqual([null, null, null]);
  });
});
