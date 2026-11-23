import { describe, expect, it } from "vitest";
import { cabinetPoses, shade, workerShapes, WORKER_POSE_IDS, type WorkerDrawing, type WorkerShape } from "@/engines/content/wall-build/character";

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
        // The sole ends on the ground line; only its ink outline goes below.
        expect(ground).toBeGreaterThanOrEqual(0);
        expect(ground).toBeLessThanOrEqual(Math.ceil((6 * height) / 256) + 1);
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
