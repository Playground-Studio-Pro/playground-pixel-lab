import { describe, expect, it } from "vitest";
import { cadencePattern, contentFrame, MAX_CADENCE_ENTRIES, median, outputLayout } from "@/engines/output-layout";

const size = (width: number, height: number) => ({ width, height });

describe("outputLayout (PHYSICAL_OUTPUT 8.3)", () => {
  it("1×: the canvas is the framebuffer, CSS equals device px, exact match", () => {
    const l = outputLayout({ devicePx: size(1920, 1080), devicePixelRatio: 1, outputPx: size(1920, 1080), devicePxExact: true });
    expect(l).toEqual({
      canvasPx: size(1920, 1080),
      canvasCss: { width: "1920px", height: "1080px" },
      visiblePx: size(1920, 1080),
      croppedPx: { right: 0, bottom: 0 },
      blackPx: { right: 0, bottom: 0 },
      sizeMatch: "exact",
      tolerancePx: 0,
    });
  });

  it("2×: backing store in device px, CSS halved, an output of the full framebuffer is exact", () => {
    const l = outputLayout({ devicePx: size(3840, 2160), devicePixelRatio: 2, outputPx: size(3840, 2160), devicePxExact: true });
    expect(l.canvasPx).toEqual(size(3840, 2160));
    expect(l.canvasCss).toEqual({ width: "1920px", height: "1080px" });
    expect(l.sizeMatch).toBe("exact");
  });

  it("2× with a 1920 × 1080 output: drawn 1:1 in a quarter, the rest black, never scaled up", () => {
    const l = outputLayout({ devicePx: size(3840, 2160), devicePixelRatio: 2, outputPx: size(1920, 1080), devicePxExact: true });
    expect(l.canvasPx).toEqual(size(3840, 2160));
    expect(l.visiblePx).toEqual(size(1920, 1080));
    expect(l.blackPx).toEqual({ right: 1920, bottom: 1080 });
    expect(l.croppedPx).toEqual({ right: 0, bottom: 0 });
    expect(l.sizeMatch).toBe("smaller-than-display");
  });

  it("an output larger than the display is cropped at right and bottom, never scaled down", () => {
    const l = outputLayout({ devicePx: size(1920, 1080), devicePixelRatio: 1, outputPx: size(3072, 1920), devicePxExact: true });
    expect(l.visiblePx).toEqual(size(1920, 1080));
    expect(l.croppedPx).toEqual({ right: 1152, bottom: 840 });
    expect(l.blackPx).toEqual({ right: 0, bottom: 0 });
    expect(l.sizeMatch).toBe("larger-than-display");
  });

  it("smaller on one axis only still counts as smaller; equal on one axis and larger on the other as larger", () => {
    expect(outputLayout({ devicePx: size(1920, 1080), devicePixelRatio: 1, outputPx: size(1920, 540), devicePxExact: true }).sizeMatch).toBe("smaller-than-display");
    expect(outputLayout({ devicePx: size(1920, 1080), devicePixelRatio: 1, outputPx: size(1920, 1200), devicePxExact: true }).sizeMatch).toBe("larger-than-display");
  });

  it("wider but shorter is mixed, with the per-axis numbers", () => {
    const l = outputLayout({ devicePx: size(1920, 1080), devicePixelRatio: 1, outputPx: size(3840, 540), devicePxExact: true });
    expect(l.sizeMatch).toBe("mixed");
    expect(l.croppedPx).toEqual({ right: 1920, bottom: 0 });
    expect(l.blackPx).toEqual({ right: 0, bottom: 540 });
    expect(l.visiblePx).toEqual(size(1920, 540));
  });

  it("Windows 125 % on 1366 × 768: CSS size is unrounded, and the 1:1 check allows ±1 px", () => {
    const l = outputLayout({ devicePx: size(1366, 768), devicePixelRatio: 1.25, outputPx: size(1366, 768), devicePxExact: false });
    expect(l.canvasPx).toEqual(size(1366, 768));
    expect(l.canvasCss).toEqual({ width: "1092.8px", height: "614.4px" });
    expect(l.tolerancePx).toBe(1);
  });

  it("refuses sizes that aren't whole pixels and ratios that aren't positive", () => {
    const ok = { devicePx: size(1920, 1080), devicePixelRatio: 1, outputPx: size(1920, 1080), devicePxExact: true };
    expect(() => outputLayout({ ...ok, devicePx: size(1920.5, 1080) })).toThrow(RangeError);
    expect(() => outputLayout({ ...ok, outputPx: size(0, 1080) })).toThrow(RangeError);
    expect(() => outputLayout({ ...ok, devicePixelRatio: 0 })).toThrow(RangeError);
    expect(() => outputLayout({ ...ok, devicePixelRatio: Number.NaN })).toThrow(RangeError);
  });
});

/** Two cadences are the same when one pattern is a rotation of the other: the order depends on phase. */
function sameCycle(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) return false;
  return a.some((_, r) => a.every((_, i) => a[(i + r) % a.length] === b[i]));
}

describe("cadencePattern (PHYSICAL_OUTPUT 8.6 table)", () => {
  const table: [fps: number, hz: number, pattern: number[], even: boolean][] = [
    [24, 60, [3, 2], false],
    [25, 60, [3, 2, 3, 2, 2], false],
    [30, 60, [2], true],
    [50, 60, [1, 1, 1, 1, 2], false],
    [60, 60, [1], true],
    [24, 50, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3], false],
    [25, 50, [2], true],
    [30, 50, [2, 2, 1], false],
    [50, 50, [1], true],
    // "1 frame in 6 never shown"
    [60, 50, [1, 1, 1, 1, 1, 0], false],
  ];

  it.each(table)("%i fps on %i Hz", (fps, hz, pattern, even) => {
    const result = cadencePattern(fps, hz);
    expect(sameCycle(result.pattern, pattern), `got ${result.pattern.join(",")}`).toBe(true);
    expect(result.even).toBe(even);
    // Over one cycle every refresh shows exactly one frame.
    expect(result.pattern.reduce((a, b) => a + b, 0)).toBe((hz * result.pattern.length) / fps);
  });

  it("59.94 Hz: one second of content, and never even, because it drifts against whole-number content", () => {
    const { pattern, even } = cadencePattern(30, 59.94);
    expect(pattern).toHaveLength(30);
    expect(pattern.every((n) => n === 2)).toBe(true);
    expect(even).toBe(false);
    expect(cadencePattern(24, 59.94).even).toBe(false);
  });

  // Rates Electron reported for 60 Hz monitors and a 120 Hz panel: nominal rates with float noise.
  it.each(table.filter(([, hz]) => hz === 60))("%i fps on a 60 Hz display reported as 60.000003814697266", (fps, _hz, pattern, even) => {
    const result = cadencePattern(fps, 60.000003814697266);
    expect(sameCycle(result.pattern, pattern), `got ${result.pattern.join(",")}`).toBe(true);
    expect(result.even).toBe(even);
    expect(result).toEqual(cadencePattern(fps, 60));
  });

  it.each([24, 25, 30, 50, 60])("%i fps on a 120 Hz display reported as 120.0006103515625", (fps) => {
    expect(cadencePattern(fps, 120.0006103515625)).toEqual(cadencePattern(fps, 120));
    expect(cadencePattern(fps, 120.0006103515625).even).toBe(120 % fps === 0);
  });

  it.each([59.94, 23.976, 119.88, 60000 / 1001, 24000 / 1001, 120000 / 1001])("%d Hz stays fractional: one second of content, never even", (hz) => {
    for (const fps of [24, 25, 30, 50, 60]) {
      const { pattern, even } = cadencePattern(fps, hz);
      expect(even).toBe(false);
      expect(pattern).toHaveLength(fps);
    }
  });

  it("the tolerance ends at 0.001 Hz on both sides: just outside it a rate stays fractional", () => {
    for (const hz of [60.0009, 59.9991]) expect(cadencePattern(30, hz)).toEqual({ pattern: [2], even: true });
    for (const hz of [60.0011, 59.9989]) {
      expect(cadencePattern(30, hz).even).toBe(false);
      expect(cadencePattern(30, hz).pattern).toHaveLength(30);
    }
    // A rate near zero isn't read as 0 Hz.
    expect(cadencePattern(30, 0.0005).even).toBe(false);
  });

  it("never exceeds the shared report's entry limit", () => {
    expect(cadencePattern(60, 59.94).pattern.length).toBeLessThanOrEqual(MAX_CADENCE_ENTRIES);
    expect(cadencePattern(59, 60).pattern.length).toBe(59);
  });

  it("refuses rates that aren't usable", () => {
    expect(() => cadencePattern(0, 60)).toThrow(RangeError);
    expect(() => cadencePattern(29.97, 60)).toThrow(RangeError);
    expect(() => cadencePattern(30, 0)).toThrow(RangeError);
  });
});

describe("contentFrame and the refresh grid (section 4, 8.6)", () => {
  const P = 1000 / 60;

  it("paused holds its frame", () => {
    expect(contentFrame({ state: "paused", frame: 42 }, 123_456, null)).toBe(42);
  });

  it("is startFrame + floor(elapsed × fps / 1000), and holds startFrame before the epoch", () => {
    const clock = { state: "playing" as const, fps: 30 as const, startFrame: 10, epochMs: 1_000 };
    expect(contentFrame(clock, 500, null)).toBe(10);
    expect(contentFrame(clock, 1_000, null)).toBe(10);
    expect(contentFrame(clock, 1_000 + 1000 / 30, null)).toBe(11);
    expect(contentFrame(clock, 2_000, null)).toBe(40);
  });

  it("quantizing removes sub-millisecond jitter: 60 fps on 60 Hz shows every frame once", () => {
    // Epoch exactly on a refresh, the worst case for floor without quantizing.
    const epochMs = 10_000;
    const clock = { state: "playing" as const, fps: 60 as const, startFrame: 0, epochMs };
    const grid = { periodMs: P, anchorMs: epochMs };
    const jitter = [0.3, -0.4, 0.2, -0.1, 0.45, -0.45];
    const frames = Array.from({ length: 600 }, (_, k) => contentFrame(clock, epochMs + k * P + jitter[k % jitter.length], grid));
    expect(frames).toEqual(Array.from({ length: 600 }, (_, k) => k));
    // Without the grid the same timestamps double and skip.
    const raw = Array.from({ length: 600 }, (_, k) => contentFrame(clock, epochMs + k * P + jitter[k % jitter.length], null));
    expect(raw).not.toEqual(frames);
  });

  it("quantized playback reproduces the cadence table: 25 fps on 60 Hz", () => {
    const anchorMs = 5_000.25;
    const clock = { state: "playing" as const, fps: 25 as const, startFrame: 0, epochMs: anchorMs };
    const grid = { periodMs: P, anchorMs };
    const counts = new Map<number, number>();
    for (let k = 0; k < 120; k++) {
      const f = contentFrame(clock, anchorMs + k * P + (k % 2 ? 0.3 : -0.3), grid);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const pattern = [...counts.values()].slice(0, 5);
    expect(sameCycle(pattern, cadencePattern(25, 60).pattern)).toBe(true);
  });

  it("snaps to the nearest refresh; without a usable grid uses the timestamp itself", () => {
    const clock = { state: "playing" as const, fps: 50 as const, startFrame: 0, epochMs: 0 };
    const grid = { periodMs: 10, anchorMs: 100 };
    expect(contentFrame(clock, 124, grid)).toBe(6); // 120 ms
    expect(contentFrame(clock, 136, grid)).toBe(7); // 140 ms
    expect(contentFrame(clock, 136, null)).toBe(6);
    expect(contentFrame(clock, 136, { periodMs: 0, anchorMs: 100 })).toBe(6);
  });

  it("a boundary exactly on a refresh stays on one side on the real clock's scale, for hours", () => {
    const epochMs = 1_763_000_000_123.4;
    const clock = { state: "playing" as const, fps: 60 as const, startFrame: 0, epochMs };
    const grid = { periodMs: P, anchorMs: epochMs };
    for (let k = 0; k < 4 * 3600 * 60; k += 7) if (contentFrame(clock, epochMs + k * P, grid) !== k) throw new Error(`refresh ${k} shows ${contentFrame(clock, epochMs + k * P, grid)}`);
  });

  it("median ignores one late interval", () => {
    expect(median([16, 16, 52, 16, 16])).toBe(16);
    expect(median([10, 20])).toBe(15);
  });
});
