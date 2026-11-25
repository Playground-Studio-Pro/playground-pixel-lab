import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OUTPUT_SOURCE_IDS } from "@/domain/physical-output";
import { wallBuildOps } from "@/engines/content/wall-build/frame";
import { frameTick, planWallBuild } from "@/engines/content/wall-build/plan";
import { DEFAULT_WALL_BUILD } from "@/engines/content/wall-build/settings";
import { resolveMapping, type ResolvedMapping } from "@/engines/mapping";
import * as ops from "@/engines/project-ops";
import { useWallBuild } from "@/modules/content/wall-build-store";
import { distinctSlugs, exportScreenBatch, planScreenBatch, type BatchProgress } from "@/modules/output/batch-export";
import { BUILD_TIME, buildCutWarning, durationProblem, exportSeconds } from "@/modules/output/export-duration";
import { createExportSource, EXPORT_SOURCE_IDS, exportSourceId } from "@/modules/output/export-sources";
import { crc32, MAX_ZIP_BYTES, StoredZip, ZipTooLargeError } from "@/modules/output/stored-zip";
import type { exportMp4, VideoExportOptions } from "@/modules/output/video-export";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { CAB, festivalMainStage, testContext, threeScreenProject } from "./helpers";

const when = new Date(2026, 10, 25, 12, 30, 10);

/** Enough of a canvas to copy pixels: 1 number a pixel, no scaling. */
class FakeCanvas {
  private w = 0;
  private h = 0;
  pixels = new Uint32Array(0);
  fillStyle = "";
  imageSmoothingEnabled = true;
  private size() {
    this.pixels = new Uint32Array(this.w * this.h);
  }
  get width() { return this.w; }
  set width(v: number) { this.w = v; this.size(); }
  get height() { return this.h; }
  set height(v: number) { this.h = v; this.size(); }
  getContext() { return this; }
  save() {}
  restore() {}
  setTransform() {}
  fillRect(x: number, y: number, w: number, h: number) {
    if (this.fillStyle !== "#000" || x || y || w !== this.w || h !== this.h) throw new Error("unexpected fill");
    this.pixels.fill(0);
  }
  drawImage(from: FakeCanvas, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
    if (sw !== dw || sh !== dh || this.imageSmoothingEnabled) throw new Error("scaled copy");
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const fx = sx + x, fy = sy + y, tx = dx + x, ty = dy + y;
        if (fx < 0 || fy < 0 || fx >= from.w || fy >= from.h || tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
        this.pixels[ty * this.w + tx] = from.pixels[fy * from.w + fx];
      }
  }
}

beforeEach(() => vi.stubGlobal("document", { createElement: () => new FakeCanvas() }));
afterEach(() => {
  vi.unstubAllGlobals();
  useWallBuild.setState({ settings: DEFAULT_WALL_BUILD });
});

/** Every pixel says which frame and which master pixel it is. */
const pixelAt = (frame: number, x: number, y: number) => (frame + 1) * 0x1000000 + y * 4096 + x;
const marked: FrameSource = {
  id: "marked",
  name: "Marked",
  draw(ctx, input) {
    const c = ctx as unknown as FakeCanvas;
    for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) c.pixels[y * input.width + x] = pixelAt(input.frame, x, y);
  },
};

const masterOf = (mapping: ResolvedMapping, project = {} as never): Omit<FrameInput, "frame" | "fps"> => ({ width: mapping.master.width, height: mapping.master.height, screens: [], context: { project, mapping } });

interface Encoded { width: number; height: number; fps: number; frames: Uint32Array[]; screen: string }

/** Draws each frame as `exportMp4` does and keeps the raw pixels instead of encoding them. */
function recorder(list: Encoded[], at: readonly number[] | null = null) {
  return (async (o: VideoExportOptions) => {
    const file: Encoded = { width: o.width, height: o.height, fps: o.fps, frames: [], screen: o.source.name };
    for (let frame = 0; frame < o.frames; frame++) {
      o.signal?.throwIfAborted();
      if (!at || at.includes(frame)) {
        const canvas = new FakeCanvas();
        canvas.width = o.width;
        canvas.height = o.height;
        o.source.draw(canvas as unknown as CanvasRenderingContext2D, { ...o.input, frame, fps: o.fps as FrameInput["fps"], width: o.width, height: o.height }, { scale: 1, fontFamily: "x" });
        file.frames.push(canvas.pixels);
      }
      o.onProgress?.(frame + 1, o.frames);
    }
    list.push(file);
    return new Blob([`${o.source.name} ${o.width}x${o.height}`], { type: "video/mp4" });
  }) as typeof exportMp4;
}

const options = { projectName: "Test show", sourceLabel: "wall-build", fps: 30, seconds: 23 } as const;

describe("export-only sources", () => {
  it("adds Wall Build to the export and nothing to the output window", () => {
    expect([...OUTPUT_SOURCE_IDS]).toEqual(["calibration-test-card", "pixel-grid", "depth-scene"]);
    expect([...EXPORT_SOURCE_IDS]).toEqual([...OUTPUT_SOURCE_IDS, "wall-build"]);
    expect(exportSourceId("wall-build")).toBe("wall-build");
    expect(exportSourceId("content-flow")).toBeNull();
  });

  it("refuses anything else", async () => {
    await expect(createExportSource("nope", { width: 10, height: 10 })).rejects.toThrow(/can't be exported/);
  });

  /** What a source paints, as a list of calls, so two sources can be compared. */
  function calls(source: FrameSource, mapping: ResolvedMapping, frame: number): string[] {
    vi.stubGlobal("DOMMatrix", class { constructor(readonly m: number[]) {} });
    const log: string[] = [];
    const state: Record<string, unknown> = {};
    const ctx = new Proxy(state, {
      get: (t, key) => (key in t ? t[key as string] : (...args: unknown[]) => void log.push(`${String(key)} ${JSON.stringify(args)}`)),
      set: (t, key, value) => {
        t[key as string] = value;
        log.push(`${String(key)}=${String(value)}`);
        return true;
      },
    });
    source.draw(ctx as unknown as CanvasRenderingContext2D, { ...masterOf(mapping), frame, fps: 30 }, { scale: 1, fontFamily: "x" });
    return log;
  }

  it("freezes Wall Build when the export starts: later edits change nothing", async () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const pending = createExportSource("wall-build", mapping.master);
    // After the call, before the engine is loaded.
    useWallBuild.getState().update({ buildSeconds: 5, background: "#00FF00", grid: false, countdown: true });
    const source = await pending;
    const before = [0, 1, 300, 599].map((f) => calls(source, mapping, f));
    useWallBuild.getState().update({ order: "random", seed: 77, vest: "#0000FF" });
    expect([0, 1, 300, 599].map((f) => calls(source, mapping, f))).toEqual(before);
    expect(before.flat().some((c) => c.includes("#00FF00"))).toBe(false);

    const edited = await createExportSource("wall-build", mapping.master);
    expect(calls(edited, mapping, 0)).not.toEqual(before[0]);
  });

  it("never draws the plain loading background: frame 0 already has every cabinet position", async () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const source = await createExportSource("wall-build", mapping.master);
    const fills = calls(source, mapping, 0).filter((c) => c.startsWith("fillRect"));
    const cabinets = mapping.screens.reduce((n, s) => n + s.columns * s.rows, 0);
    expect(fills.length).toBeGreaterThan(cabinets);
    expect(() => source.draw({} as CanvasRenderingContext2D, { frame: 0, fps: 30, width: 10, height: 10, screens: [] }, { scale: 1, fontFamily: "x" })).toThrow(/mapping/);
  });

  it("isn't created while the engine is loading, and fails with it", async () => {
    vi.resetModules();
    vi.doMock("@/modules/content/wall-build-draw", () => {
      throw new Error("offline");
    });
    try {
      const { createExportSource: create } = await import("@/modules/output/export-sources");
      await expect(create("wall-build", { width: 10, height: 10 })).rejects.toThrow();
    } finally {
      vi.doUnmock("@/modules/content/wall-build-draw");
      vi.resetModules();
    }
  });
});

describe("file list", () => {
  it("has one file per screen, at its own size, in mapping order", () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const batch = planScreenBatch(mapping, options);
    expect(batch.zipName).toBe("test-show-wall-build-screens-30fps-23s.zip");
    expect(batch.frames).toBe(690);
    expect(batch.files.map((f) => f.filename)).toEqual(["test-show-wall-build-left-512x768-30fps-23s.mp4", "test-show-wall-build-center-1536x768-30fps-23s.mp4", "test-show-wall-build-right-384x640-30fps-23s.mp4"]);
    expect(batch.files.map((f) => [f.target.width, f.target.height])).toEqual(mapping.screens.map((s) => [s.spec.pixelWidth, s.spec.pixelHeight]));
    expect(batch.skipped).toEqual([]);
  });

  it("gives equal names and equal slugs different files, and leaves a name that is alone as it is", () => {
    expect(distinctSlugs(["Wall", "wall!", "Wall 2", "Écran", "Ecran", "大", "小", "---"])).toEqual(["wall", "wall-3", "wall-2", "ecran", "ecran-2", "untitled", "untitled-2", "untitled-3"]);
    const long = distinctSlugs([`${"x".repeat(300)}a`, `${"x".repeat(300)}b`]);
    expect(new Set(long).size).toBe(2);
    expect(long.every((s) => s.length < 70)).toBe(true);
  });

  it("names screens H.264 can't take, with the reason, and never resizes them", () => {
    const ctx = testContext();
    let { project } = threeScreenProject(ctx);
    const odd = { ...CAB, id: "cab-odd", pixelsX: 65 as typeof CAB.pixelsX };
    project = ops.addCabinet(project, odd);
    project = ops.addScreen(project, { name: "Odd one", cabinetId: odd.id, columns: 3, rows: 1 }, ctx);
    project = ops.addScreen(project, { name: "Long one", cabinetId: CAB.id, columns: 40, rows: 1 }, ctx);
    const mapping = resolveMapping(project);
    const batch = planScreenBatch(mapping, options);
    expect(batch.files.map((f) => f.target.label)).toEqual(["Left", "Center", "Right"]);
    expect(batch.skipped.map((s) => [s.name, s.size])).toEqual([["Odd one", { width: 195, height: 128 }], ["Long one", { width: 5120, height: 128 }]]);
    expect(batch.skipped[0].reason).toMatch(/even/);
    expect(batch.skipped[1].reason).toMatch(/4096/);
  });

  it("names screens the mapping couldn't resolve", () => {
    const { project, ids } = threeScreenProject();
    const broken = { ...project, output: { ...project.output, slices: project.output.slices.filter((s) => s.screenId !== ids.center) } };
    const batch = planScreenBatch(resolveMapping(broken), options);
    expect(batch.files.map((f) => f.target.label)).toEqual(["Left", "Right"]);
    expect(batch.skipped).toEqual([{ id: `screen:${ids.center}`, name: "Center", size: null, reason: "It has no place in the output layout." }]);
  });

  it("lists Festival Main Stage: five files at their exact sizes, and the Ribbon named as too wide", () => {
    const mapping = resolveMapping(festivalMainStage());
    const batch = planScreenBatch(mapping, { ...options, projectName: "Festival" });
    expect(batch.files.length + batch.skipped.length).toBe(mapping.screens.length);
    expect(batch.skipped).toEqual([{ id: expect.any(String), name: "Ribbon", size: { width: 4608, height: 128 }, reason: "Wider or taller than 4096 px, the H.264 limit. It is never scaled or split." }]);
    for (const f of batch.files) {
      const s = mapping.screens.find((s) => `screen:${s.screenId}` === f.target.id)!;
      expect(f.filename).toContain(`-${s.spec.pixelWidth}x${s.spec.pixelHeight}-30fps-23s.mp4`);
      expect(f.target.regions).toEqual([{ from: { x: s.masterRect.x, y: s.masterRect.y, width: s.spec.pixelWidth, height: s.spec.pixelHeight }, to: { x: 0, y: 0 } }]);
    }
    expect(new Set(batch.files.map((f) => f.filename)).size).toBe(5);
  });
});

/** A fixed master canvas, with Left and Right on the same pixels, and Center wherever asked. */
function sharedProject(center: { x: number; y: number }) {
  const { project, ids } = threeScreenProject();
  const at: Record<string, { x: number; y: number }> = { [ids.left]: { x: 64, y: 10 }, [ids.right]: { x: 64, y: 10 }, [ids.center]: center };
  return {
    ...project,
    content: {
      ...project.content,
      master: { mode: "fixed", width: 2048, height: 800 } as typeof project.content.master,
      regions: project.content.regions.map((r) => ({ ...r, x: at[r.screenId].x as typeof r.x, y: at[r.screenId].y as typeof r.y, allowOverlap: true })),
    },
  };
}

describe("the batch", () => {
  it("cuts every file from the same master frame: frame N of each is the same instant, pixel for pixel", async () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const batch = planScreenBatch(mapping, { ...options, seconds: 1 });
    const files: Encoded[] = [];
    await exportScreenBatch({ batch, source: marked, master: masterOf(mapping), modified: when, encode: recorder(files, [0, 1, 29]) });
    expect(files.map((f) => [f.width, f.height, f.fps])).toEqual(mapping.screens.map((s) => [s.masterRect.width, s.masterRect.height, 30]));
    for (const [i, file] of files.entries()) {
      const { x, y } = mapping.screens[i].masterRect;
      for (const [n, frame] of [0, 1, 29].entries()) {
        const wrong = file.frames[n].findIndex((p, k) => p !== pixelAt(frame, x + (k % file.width), y + Math.floor(k / file.width)) % 0x100000000);
        expect(wrong).toBe(-1);
      }
    }
  });

  it("gives screens that share pixels the same picture, and leaves pixels outside the master black", async () => {
    const mapping = resolveMapping(sharedProject({ x: 1000, y: 100 }));
    const files: Encoded[] = [];
    await exportScreenBatch({ batch: planScreenBatch(mapping, { ...options, seconds: 1 }), source: marked, master: masterOf(mapping), modified: when, encode: recorder(files, [7]) });
    const [left, center, right] = files;
    // Both begin at master (64, 10): Right's 384 × 640 is Left's top left part.
    for (let y = 0; y < 640; y += 1) expect(right.frames[0].slice(y * 384, (y + 1) * 384)).toEqual(left.frames[0].slice(y * 512, y * 512 + 384));
    // Center is 1536 × 768 at (1000, 100): its right 488 columns and bottom 68 rows are off the master.
    expect(center.width).toBe(1536);
    expect(center.frames[0][0]).toBe(pixelAt(7, 1000, 100) % 0x100000000);
    expect(center.frames[0][699 * 1536 + 1047]).toBe(pixelAt(7, 2047, 799) % 0x100000000);
    expect(center.frames[0][1048]).toBe(0);
    expect(center.frames[0][700 * 1536]).toBe(0);
  });

  it("plays Wall Build as the mapping's own frames in every file", async () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const batch = planScreenBatch(mapping, { ...options, seconds: 1 });
    const seen: { frame: number; context: unknown; width: number }[] = [];
    const spy: FrameSource = { id: "spy", name: "spy", draw: (_ctx, input) => void seen.push({ frame: input.frame, context: input.context?.mapping, width: input.width }) };
    await exportScreenBatch({ batch, source: spy, master: masterOf(mapping), modified: when, encode: recorder([], null) });
    expect(seen.length).toBe(90);
    expect(seen.slice(0, 30).map((s) => s.frame)).toEqual(seen.slice(60).map((s) => s.frame));
    expect(seen.every((s) => s.context === mapping && s.width === mapping.master.width)).toBe(true);
  });

  it("reports the screen, its count and the total", async () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const batch = planScreenBatch(mapping, { ...options, seconds: 1 });
    const seen: BatchProgress[] = [];
    await exportScreenBatch({ batch, source: marked, master: masterOf(mapping), modified: when, encode: recorder([], []), onProgress: (p) => seen.push(p) });
    expect(seen[0]).toEqual({ screen: 1, screens: 3, name: "Left", done: 0, frames: 30, totalDone: 0, totalFrames: 90 });
    expect(seen.find((p) => p.screen === 2 && p.done === 5)).toEqual({ screen: 2, screens: 3, name: "Center", done: 5, frames: 30, totalDone: 35, totalFrames: 90 });
    expect(seen.at(-1)).toMatchObject({ screen: 3, done: 30, totalDone: 90 });
    expect(seen.every((p, i) => i === 0 || p.totalDone >= seen[i - 1].totalDone)).toBe(true);
  });

  it("yields a ZIP with exactly the listed files, readable by another reader", async () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const batch = planScreenBatch(mapping, { ...options, seconds: 1 });
    const blob = await exportScreenBatch({ batch, source: marked, master: masterOf(mapping), modified: when, encode: recorder([], []) });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual(batch.files.map((f) => f.filename));
    expect(await zip.files[batch.files[1].filename].async("string")).toBe("Marked, Center 1536x768");
  });

  it("rejects when cancelled at any point, so there is never a partial ZIP", async () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const batch = planScreenBatch(mapping, { ...options, seconds: 1 });
    const run = (stop: (p: BatchProgress) => boolean) => {
      const controller = new AbortController();
      return exportScreenBatch({ batch, source: marked, master: masterOf(mapping), modified: when, signal: controller.signal, encode: recorder([], []), onProgress: (p) => stop(p) && controller.abort() });
    };
    await expect(run((p) => p.totalDone === 0)).rejects.toMatchObject({ name: "AbortError" });
    await expect(run((p) => p.screen === 2 && p.done === 10)).rejects.toMatchObject({ name: "AbortError" });
    // The very last frame: everything encoded, the ZIP not yet built.
    await expect(run((p) => p.totalDone === p.totalFrames)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails as a whole, naming the screen, when one file fails", async () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const batch = planScreenBatch(mapping, { ...options, seconds: 1 });
    const encode = (async (o: VideoExportOptions) => {
      if (o.width === 1536) throw new Error("encoder lost");
      return new Blob(["ok"]);
    }) as typeof exportMp4;
    await expect(exportScreenBatch({ batch, source: marked, master: masterOf(mapping), modified: when, encode })).rejects.toThrow("Center: encoder lost");
    await expect(exportScreenBatch({ batch: { ...batch, files: [] }, source: marked, master: masterOf(mapping), modified: when, encode })).rejects.toThrow(/No screen/);
  });
});

describe("stored ZIP", () => {
  it("computes CRC-32, in one piece or several", () => {
    const text = new TextEncoder().encode("123456789");
    expect(crc32(text)).toBe(0xcbf43926);
    expect(crc32(text.slice(4), crc32(text.slice(0, 4)))).toBe(0xcbf43926);
  });

  it("keeps contents byte for byte, uncompressed, with their date", async () => {
    const zip = new StoredZip(when);
    const data = new Uint8Array(200_000).map((_, i) => (i * 31) & 255);
    await zip.add("a.mp4", new Blob([data]));
    await zip.add("empty.mp4", new Blob([]));
    const bytes = new Uint8Array(await zip.finish().arrayBuffer());
    expect(bytes.slice(30 + 5, 30 + 5 + data.length)).toEqual(data);
    const read = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(await read.files["a.mp4"].async("uint8array")).toEqual(data);
    expect((await read.files["empty.mp4"].async("uint8array")).length).toBe(0);
    expect(read.files["a.mp4"].date.toISOString().slice(0, 19)).toBe("2026-11-25T12:30:10");
  });

  it("refuses a duplicate name, a fifth gigabyte, a short read, and adding after the end", async () => {
    const zip = new StoredZip(when);
    await zip.add("a.mp4", new Blob(["a"]));
    await expect(zip.add("a.mp4", new Blob(["b"]))).rejects.toThrow(/Two files/);
    await expect(zip.add("huge.mp4", { size: MAX_ZIP_BYTES - 100 } as Blob)).rejects.toBeInstanceOf(ZipTooLargeError);
    await expect(zip.add("short.mp4", { size: 10, stream: () => new Blob(["short"]).stream() } as Blob)).rejects.toThrow(/5 of 10/);
    const read = await JSZip.loadAsync(await zip.finish().arrayBuffer(), { checkCRC32: true });
    expect(Object.keys(read.files)).toEqual(["a.mp4"]);
    await expect(zip.add("late.mp4", new Blob(["x"]))).rejects.toThrow(/finished/);
  });
});

describe("duration", () => {
  it("is the build time and the hold for Wall Build, and the chosen seconds otherwise", () => {
    expect(exportSeconds({ key: BUILD_TIME, holdSeconds: 3 }, 20)).toBe(23);
    expect(exportSeconds({ key: "10", holdSeconds: 3 }, 20)).toBe(10);
    expect(durationProblem(600)).toBeNull();
    expect(durationProblem(603)).toMatch(/603 s/);
  });

  it("warns when the file ends before the last cabinet is placed, as the engine itself draws it", () => {
    const mapping = resolveMapping(threeScreenProject().project);
    const plan = planWallBuild(mapping, DEFAULT_WALL_BUILD);
    const complete = JSON.stringify(wallBuildOps(plan, plan.settledTick, DEFAULT_WALL_BUILD));
    const placed = (frame: number) => Math.max(...plan.screens.flatMap((s) => s.cabinets.map((c) => c.placedAt))) <= frameTick(frame, 30);
    const build = DEFAULT_WALL_BUILD.buildSeconds;
    for (const seconds of [5, 10, 15, 20]) {
      expect(buildCutWarning(seconds, build)).toMatch(/build takes 20 s/);
      expect(placed(seconds * 30 - 1)).toBe(false);
    }
    // With the shortest hold, the last frame is the finished wall and nothing else.
    expect(buildCutWarning(build + 2, build)).toBeNull();
    expect(JSON.stringify(wallBuildOps(plan, frameTick((build + 2) * 30 - 1, 30), DEFAULT_WALL_BUILD))).toBe(complete);
  });
});
