import { describe, expect, it } from "vitest";
import { CONTENT_FPS, PATTERNS, type MotionScreen } from "@/domain/motion";
import { mmToUm, px } from "@/domain/units";
import { resolveMapping } from "@/engines/mapping";
import * as clock from "@/engines/motion/clock";
import { emptyStats, previewFps, recordFrame } from "@/engines/motion/metrics";
import { MOTION_COLORS, cycleHue, flowWaveY, gridCell, hueToRgb, renderPattern, scanPosition, type Primitive } from "@/engines/motion/patterns";
import { mapSubRect, overlapMarks, previewRegions } from "@/engines/motion/regions";
import * as ops from "@/engines/project-ops";
import { validateProject } from "@/engines/validation";
import { wheelViewport } from "@/engines/viewport";
import { MAX_SOURCE_SIDE, sourceScale } from "@/preview/live-renderer";
import { buildViewModel } from "@/state/view-model";
import { motionLabProject } from "./helpers";

function screensOf(project: ReturnType<typeof motionLabProject>["project"]): MotionScreen[] {
  return resolveMapping(project).screens.map((s) => ({ id: s.screenId, name: s.name, x: s.masterRect.x, y: s.masterRect.y, width: s.masterRect.width, height: s.masterRect.height }));
}

describe("playback clock", () => {
  it.each(CONTENT_FPS)("gives exact frame boundaries at %i fps", (fps) => {
    expect(clock.frameAt(0, fps)).toBe(0);
    expect(clock.frameAt(1000, fps)).toBe(fps);
    expect(clock.frameAt(clock.frameStartMs(7, fps), fps)).toBe(7);
    expect(clock.frameAt(clock.frameStartMs(7, fps) - 0.01, fps)).toBe(6);
    expect(clock.frameAt(60_000, fps)).toBe(60 * fps);
  });

  it("advances with wall time × speed while playing, and holds while paused", () => {
    let c = clock.play(clock.initialClock, 1000);
    expect(clock.contentTime(c, 1500)).toBe(500);
    c = clock.pause(c, 2000);
    expect(clock.contentTime(c, 9000)).toBe(1000);
    c = clock.play(c, 10_000);
    c = clock.setSpeed(c, 2, 10_500);
    // No jump when speed changes: 1500 ms so far, then twice as fast.
    expect(clock.contentTime(c, 10_500)).toBe(1500);
    expect(clock.contentTime(c, 11_000)).toBe(2500);
    c = clock.restart(c, 12_000);
    expect(clock.contentTime(c, 12_000)).toBe(0);
    expect(c.playing).toBe(true);
  });

  it("formats non-drop timecode", () => {
    expect(clock.timecode(0, 25)).toBe("00:00:00:00");
    expect(clock.timecode(24, 25)).toBe("00:00:00:24");
    expect(clock.timecode(25, 25)).toBe("00:00:01:00");
    expect(clock.timecode(30 * 3725 + 12, 30)).toBe("01:02:05:12");
  });
});

describe("patterns", () => {
  const { project } = motionLabProject();
  const screens = screensOf(project);
  const base = { fps: 30 as const, width: 2688, height: 768, screens };

  it.each(PATTERNS.map((p) => p.id))("%s is deterministic and finite", (id) => {
    const a = renderPattern(id, { ...base, frame: 123 });
    const b = renderPattern(id, { ...base, frame: 123 });
    expect(a).toEqual(b);
    const numbers = JSON.stringify(a.primitives).match(/-?\d+(\.\d+)?(e-?\d+)?|null|NaN|Infinity/g) ?? [];
    expect(numbers).not.toContain("null");
    expect(a.width).toBe(2688);
    expect(a.primitives.length).toBeGreaterThan(0);
  });

  it("draws content in master space, independent of how screens are arranged", () => {
    // Moving a screen changes where it looks, never the content: that's what makes it continuous.
    const moved = screens.map((s) => ({ ...s, x: s.x + 64 }));
    for (const id of ["flow", "grid", "scan-h", "scan-v"] as const) {
      expect(renderPattern(id, { ...base, frame: 40 })).toEqual(renderPattern(id, { ...base, screens: moved, frame: 40 }));
    }
  });

  it("places the horizontal scan at an exact column for each frame", () => {
    // One sweep every 4 s: at 30 fps, frame 30 is a quarter of the way across.
    expect(scanPosition(0, 30, 2688)).toBe(0);
    expect(scanPosition(30, 30, 2688)).toBe(672);
    expect(scanPosition(60, 30, 2688)).toBe(1344);
    expect(scanPosition(120, 30, 2688)).toBe(0);
    // The same moment at another rate is the same column.
    expect(scanPosition(25, 25, 2688)).toBe(scanPosition(30, 30, 2688));
    const frame = renderPattern("scan-h", { ...base, frame: 30 });
    const bar = frame.primitives.find((p): p is Extract<Primitive, { kind: "rect" }> => p.kind === "rect")!;
    expect(bar.x).toBe(672);
    expect(bar.h).toBe(768);
  });

  it("moves the grid by whole pixels and keeps a fixed cell", () => {
    expect(gridCell(2688, 768)).toBe(128);
    const columns = (frame: number) =>
      renderPattern("grid", { ...base, frame }).primitives.filter((p) => p.kind === "lines" && p.axis === "x").flatMap((p) => (p as Extract<Primitive, { kind: "lines" }>).at);
    expect(Math.min(...columns(0))).toBe(0);
    // Half a cell per second: 64 px after 30 frames at 30 fps, always on whole pixels.
    expect(Math.min(...columns(30))).toBe(64);
    expect(columns(30).every((x) => Number.isInteger(x))).toBe(true);
    // Lines keep their spacing: every column is a whole number of cells from the first.
    expect(columns(30).every((x) => (x - 64) % 128 === 0)).toBe(true);
  });

  it("cycles hue in whole degrees and converts it to integer RGB", () => {
    expect(cycleHue(0, 30)).toBe(0);
    expect(cycleHue(30, 30)).toBe(60);
    expect(cycleHue(180, 30)).toBe(0);
    expect(hueToRgb(0)).toEqual([255, 0, 0]);
    expect(hueToRgb(120)).toEqual([0, 255, 0]);
    expect(hueToRgb(240)).toEqual([0, 0, 255]);
    expect(renderPattern("rgb", { ...base, frame: 60 }).background).toBe("rgb(0,255,0)");
  });

  it("labels every screen with the same frame number", () => {
    const frame = renderPattern("counter", { ...base, frame: 1234 });
    const numbers = frame.primitives.filter((p) => p.kind === "text" && p.text === "1234") as Extract<Primitive, { kind: "text" }>[];
    expect(numbers).toHaveLength(3);
    for (const [i, s] of screens.entries()) expect(numbers[i].x).toBe(s.x + s.width / 2);
    expect(frame.primitives.some((p) => p.kind === "text" && p.text.startsWith("00:00:41:04"))).toBe(true);
  });

  it("keeps the Content Flow wave continuous across every screen boundary", () => {
    for (const frame of [0, 17, 450]) {
      const t = frame / 30;
      const path = renderPattern("flow", { ...base, frame }).primitives.findLast((p) => p.kind === "path") as Extract<Primitive, { kind: "path" }>;
      expect(path.color).toBe(MOTION_COLORS.white);
      expect(path.points[0]).toBe(0);
      expect(path.points.at(-2)).toBe(2688);
      for (const edge of screens.flatMap((s) => [s.x, s.x + s.width])) {
        // The same function gives both sides of an edge: no jump where one screen ends and the next begins.
        expect(Math.abs(flowWaveY(edge - 0.5, t, 2688, 768) - flowWaveY(edge + 0.5, t, 2688, 768))).toBeLessThan(5);
      }
    }
  });
});

describe("preview regions and overlaps", () => {
  const { project, ids } = motionLabProject();
  const mapping = resolveMapping(project);
  const issues = validateProject(project, mapping);

  it("builds an acceptance project with no errors, one shared overlap and an independent canvas", () => {
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.filter((i) => i.code === "REGION_SHARED")).toHaveLength(1);
    const side = mapping.screens.find((s) => s.screenId === ids.side)!;
    expect(mapping.canvases.find((c) => c.canvasId === side.canvasId)!.screenIds).toEqual([ids.side]);
    expect(mapping.screens.map((s) => `${s.spec.pixelWidth}x${s.spec.pixelHeight}`)).toEqual(["768x512", "1536x768", "512x768"]);
  });

  it.each(["physical", "content", "output"] as const)("reuses mapping and view coordinates unchanged on the %s view", (view) => {
    const model = buildViewModel(project, mapping, view, mapping.outputs[0].outputId);
    const regions = previewRegions(model.items, mapping);
    expect(regions).toHaveLength(3);
    for (const r of regions) {
      expect(r.source).toBe(mapping.screens.find((s) => s.screenId === r.screenId)!.masterRect);
      expect(r.dest).toBe(model.items.find((i) => i.id === r.screenId)!.rect);
    }
  });

  it("marks the shared area once on the content view", () => {
    const model = buildViewModel(project, mapping, "content", null);
    const marks = overlapMarks(previewRegions(model.items, mapping), issues, mapping, "content");
    expect(marks).toEqual([{ kind: "shared", screenIds: [ids.left, ids.center], label: "Shared 256 × 512 px", rects: [{ x: 512, y: 128, width: 256, height: 512 }] }]);
  });

  it("marks the shared area on both screens where they sit on the stage", () => {
    const model = buildViewModel(project, mapping, "physical", null);
    const shared = overlapMarks(previewRegions(model.items, mapping), issues, mapping, "physical").find((m) => m.kind === "shared")!;
    // Left: 768 px across 3000 mm, so px 512 to 768 is 2000 to 3000 mm from its left edge at 0, 500 mm.
    // Center: 1536 px across 4000 mm at 3500, 0 mm. px 0 to 256, rows 128 to 640.
    expect(shared.rects).toHaveLength(2);
    expect(shared.rects[0]).toEqual({ x: mmToUm(2000), y: mmToUm(500), width: mmToUm(1000), height: mmToUm(2000) });
    expect(shared.rects[1].x).toBeCloseTo(mmToUm(3500));
    expect(shared.rects[1].width).toBeCloseTo((256 / 1536) * mmToUm(4000));
    expect(shared.rects[1].y).toBeCloseTo((128 / 768) * mmToUm(2000));
  });

  it("shows conflicts as conflicts without blocking the preview, and changes no rules", () => {
    const conflicted = ops.setRegionShared(project, ids.left, false);
    const m2 = resolveMapping(conflicted);
    const i2 = validateProject(conflicted, m2);
    expect(i2.some((i) => i.code === "REGION_OVERLAP" && i.severity === "error")).toBe(true);
    const model = buildViewModel(conflicted, m2, "content", null);
    const regions = previewRegions(model.items, m2);
    expect(regions).toHaveLength(3);
    expect(overlapMarks(regions, i2, m2, "content").map((m) => [m.kind, m.label])).toEqual([["conflict", "Content conflict 256 × 512 px"]]);
  });

  it("marks overlapping output slices only on the output view", () => {
    const clash = ops.setSlicePositions(project, [{ id: ids.center, x: px(700), y: px(0) }]);
    const m2 = resolveMapping(clash);
    const i2 = validateProject(clash, m2);
    const output = buildViewModel(clash, m2, "output", m2.outputs[0].outputId);
    const marks = overlapMarks(previewRegions(output.items, m2), i2, m2, "output");
    expect(marks.find((m) => m.label.startsWith("Output conflict"))!.rects).toEqual([{ x: 700, y: 0, width: 68, height: 512 }]);
    const content = buildViewModel(clash, m2, "content", null);
    expect(overlapMarks(previewRegions(content.items, m2), i2, m2, "content").some((m) => m.label.startsWith("Output"))).toBe(false);
  });

  it("maps a sub-rectangle proportionally", () => {
    expect(mapSubRect({ x: 50, y: 0, width: 50, height: 10 }, { x: 0, y: 0, width: 100, height: 10 }, { x: 1000, y: 0, width: 2000, height: 100 })).toEqual({ x: 2000, y: 0, width: 1000, height: 100 });
  });
});

describe("preview metrics", () => {
  it("reports preview FPS only after enough samples", () => {
    let s = recordFrame(emptyStats, null, 0);
    for (let i = 1; i <= 5; i++) s = recordFrame(s, 16.7, i);
    expect(previewFps(s)).toBeNull();
    for (let i = 6; i <= 30; i++) s = recordFrame(s, 1000 / 60, i);
    expect(previewFps(s)).toBeCloseTo(60, 0);
  });

  it("counts late browser frames and skipped content frames, not restarts", () => {
    let s = recordFrame(emptyStats, null, 0);
    for (let i = 1; i <= 20; i++) s = recordFrame(s, 16.7, i);
    s = recordFrame(s, 50, 24);
    expect(s.late).toBe(1);
    expect(s.skipped).toBe(3);
    s = recordFrame(s, 16.7, 0);
    expect(s.skipped).toBe(3);
  });
});

describe("preview resolution and wheel", () => {
  const region = (destWidth: number, sourceWidth: number) => ({ screenId: "a", name: "A", color: "#fff", source: { x: 0, y: 0, width: sourceWidth, height: 100 }, dest: { x: 0, y: 0, width: destWidth, height: 100 }, cellWidth: 1, cellHeight: 1 });

  it("renders only as many master pixels as the most magnified screen needs", () => {
    expect(sourceScale([region(1000, 1000)], 0.25, 2, 1000, 100)).toBe(0.5);
    expect(sourceScale([region(1000, 1000)], 4, 2, 1000, 100)).toBe(1);
    expect(sourceScale([region(16384, 16384)], 1, 2, 16384, 100)).toBe(MAX_SOURCE_SIDE / 16384);
  });

  it("zooms at the pointer with pinch, and pans with plain scroll", () => {
    const vp = { scale: 1, offsetX: 0, offsetY: 0 };
    expect(wheelViewport(vp, { deltaX: 5, deltaY: 10, zoom: false, x: 0, y: 0 }, 0.01, 40)).toEqual({ scale: 1, offsetX: -5, offsetY: -10 });
    const zoomed = wheelViewport(vp, { deltaX: 0, deltaY: -100, zoom: true, x: 200, y: 100 }, 0.01, 40);
    expect(zoomed.scale).toBeCloseTo(Math.E);
    // The world point under the pointer stays put.
    expect((200 - zoomed.offsetX) / zoomed.scale).toBeCloseTo(200);
  });
});
