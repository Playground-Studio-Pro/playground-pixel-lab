import { describe, expect, it } from "vitest";
import { CARRIED_FACE, carriedCabinet } from "@/engines/content/wall-build/cabinet";
import { cabinetPoses, FACE, LIMB_COLORS, shade, workerShapes, WORKER_POSE_IDS, type WorkerDrawing, type WorkerShape } from "@/engines/content/wall-build/character";
import { contrastRatio, OUTLINE_DARK, OUTLINE_LIGHT, outlineFor } from "@/engines/content/wall-build/contrast";

const CABINET = { width: 128, height: 128 };
const HEIGHTS = [64, 97, 128, 192, 256, 288, 512];

const shapes = (d: WorkerDrawing) => [...d.behind, ...d.front];

/** Every number in a shape. */
function numbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value && typeof value === "object") return Object.values(value).flatMap(numbers);
  return [];
}

/** Lowest pixel edge of a shape. Curves are only used on the helmet. */
function lowest(s: WorkerShape): number {
  if (s.kind === "rect") return s.y + s.h;
  if (s.kind === "disc") return s.y + s.r;
  if (s.kind === "curve") return s.from[1];
  return Math.max(...s.points.map((p) => p[1])) + (s.kind === "line" ? s.width / 2 : 0);
}

describe("Wall Build character", () => {
  it("draws the same shapes for the same input, in whole pixels", () => {
    for (const pose of WORKER_POSE_IDS) {
      for (const height of HEIGHTS) {
        for (const facing of [1, -1] as const) {
          const input = { pose, height, facing, cabinet: CABINET };
          const drawing = workerShapes(input);
          expect(drawing).toEqual(workerShapes(input));
          expect(numbers(drawing).every((n) => Number.isInteger(n))).toBe(true);
        }
      }
    }
  });

  it("keeps the feet on the ground in every pose", () => {
    for (const pose of WORKER_POSE_IDS) {
      for (const height of HEIGHTS) {
        const ground = Math.max(...shapes(workerShapes({ pose, height, cabinet: CABINET })).map(lowest));
        // The sole ends on the ground line; only its ink and outline go below.
        expect(ground).toBeGreaterThanOrEqual(0);
        expect(ground).toBeLessThanOrEqual(Math.ceil((10 * height) / 256) + 1);
      }
    }
  });

  it("holds cabinets at their exact size, never scaled with the worker", () => {
    for (const cabinet of [CABINET, { width: 192, height: 192 }, { width: 65, height: 128 }, { width: 128, height: 33 }]) {
      for (const height of HEIGHTS) {
        for (const pose of WORKER_POSE_IDS.filter((p) => p !== "stand")) {
          expect(workerShapes({ pose, height, cabinet }).cabinet).toMatchObject(cabinet);
        }
      }
    }
    expect(workerShapes({ pose: "stand", height: 128, cabinet: CABINET }).cabinet).toBeNull();
  });

  it("places a cabinet with its bottom edge level with the feet", () => {
    for (const height of HEIGHTS) {
      const { place } = cabinetPoses(height, CABINET.height);
      expect(workerShapes({ pose: place, height, cabinet: CABINET }).cabinet!.y).toBe(-CABINET.height);
    }
  });

  it("mirrors the cabinet when facing left", () => {
    const right = workerShapes({ pose: "place", height: 192, cabinet: CABINET }).cabinet!;
    const left = workerShapes({ pose: "place", height: 192, cabinet: CABINET, facing: -1 }).cabinet!;
    expect(left.x).toBe(-right.x - right.width);
    expect(left.y).toBe(right.y);
  });

  it("uses the helmet and vest colours, and falls back when a colour isn't valid", () => {
    const fills = (colors: { helmet: string; vest: string }) => shapes(workerShapes({ pose: "stand", height: 128, colors })).map((s) => s.fill);
    expect(fills({ helmet: "#3EC1E3", vest: "#C8F031" })).toEqual(expect.arrayContaining(["#3EC1E3", "#C8F031"]));
    expect(fills({ helmet: "red", vest: "#12" })).toEqual(expect.arrayContaining(["#FFC53D", "#FF6A1A"]));
  });

  it("chooses a pose that suits the cabinet", () => {
    expect(cabinetPoses(128, 128)).toEqual({ carry: "carry-head", place: "place" });
    expect(cabinetPoses(512, 128)).toEqual({ carry: "carry-front", place: "place-low" });
  });

  it("rejects a height that isn't a whole number of pixels", () => {
    expect(() => workerShapes({ pose: "stand", height: 100.5 })).toThrow();
  });

  it("shades in whole channels", () => {
    expect(shade("#808080", -50)).toBe("#404040");
    expect(shade("#000000", 100)).toBe("#FFFFFF");
  });
});

describe("Wall Build readability", () => {
  const SHEET_BACKGROUNDS = ["#0A0D1C", "#1A2E7A"];

  it("keeps limbs and the carried cabinet at 3:1 or more on both sheet backgrounds", () => {
    for (const background of SHEET_BACKGROUNDS) {
      for (const color of [...LIMB_COLORS, CARRIED_FACE]) expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses those limb colours in every pose", () => {
    for (const pose of WORKER_POSE_IDS) {
      const fills = new Set(shapes(workerShapes({ pose, height: 128, cabinet: CABINET })).map((s) => s.fill));
      for (const color of LIMB_COLORS) expect(fills.has(color)).toBe(true);
    }
  });

  it("outlines the worker and the cabinet at 4:1 or more on any background", () => {
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const background = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          expect(contrastRatio(outlineFor(background), background)).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("draws that outline under the whole worker and inside the cabinet's edge", () => {
    for (const [background, outline] of [["#000000", OUTLINE_LIGHT], ["#FFFFFF", OUTLINE_DARK]] as const) {
      const drawing = workerShapes({ pose: "carry-head", height: 192, cabinet: CABINET, background });
      expect(drawing.behind[0].fill).toBe(outline);
      expect(drawing.front.some((s) => s.fill === outline)).toBe(false);
      for (const size of [CABINET, { width: 1, height: 1 }, { width: 3, height: 40 }]) {
        const rects = carriedCabinet(size, background);
        expect(rects[0]).toEqual({ x: 0, y: 0, w: size.width, h: size.height, fill: outline });
        for (const q of rects) {
          expect(numbers(q).every((n) => Number.isInteger(n))).toBe(true);
          expect(q.x >= 0 && q.y >= 0 && q.x + q.w <= size.width && q.y + q.h <= size.height && q.w > 0 && q.h > 0).toBe(true);
        }
      }
    }
  });

  it("never covers the screen face while carrying overhead, facing either way", () => {
    for (const facing of [1, -1] as const) {
      for (const height of HEIGHTS) {
        for (const cabinet of [CABINET, { width: 64, height: 128 }, { width: 8, height: 128 }, { width: 512, height: 512 }]) {
          const drawing = workerShapes({ pose: "carry-head", height, cabinet, facing });
          const face = drawing.behind.find((s) => s.kind === "rect" && s.fill === FACE) as Extract<WorkerShape, { kind: "rect" }>;
          expect(face).toBeDefined();
          /** Distance from a point to the face, zero inside it. */
          const gap = ([x, y]: readonly [number, number]) => Math.hypot(Math.max(face.x - x, 0, x - face.x - face.w), Math.max(face.y - y, 0, y - face.y - face.h));
          expect(drawing.cabinet!.y + drawing.cabinet!.height).toBeLessThanOrEqual(face.y);
          for (const s of drawing.front) {
            if (s.kind === "disc") expect(gap([s.x, s.y])).toBeGreaterThanOrEqual(s.r);
            else if (s.kind === "line") {
              for (let i = 1; i < s.points.length; i++) {
                const [a, b] = [s.points[i - 1], s.points[i]];
                for (let k = 0; k <= 64; k++) expect(gap([a[0] + ((b[0] - a[0]) * k) / 64, a[1] + ((b[1] - a[1]) * k) / 64])).toBeGreaterThanOrEqual(s.width / 2);
              }
            } else throw new Error(`Unexpected shape in front: ${s.kind}`);
          }
        }
      }
    }
  });
});
