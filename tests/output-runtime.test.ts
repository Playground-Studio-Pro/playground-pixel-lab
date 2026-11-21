import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DisplayInfo, JsonValue, OutputClock, OutputRenderReport, OutputWindowApi, OutputWindowSession, Size } from "@/domain/physical-output";
import { EMERALD_CHAMBER, normalizeDepthConfig } from "@/engines/depth/config";
import { resolveMapping } from "@/engines/mapping";
import { videoTargets } from "@/engines/video-targets";
import { buildExample } from "@/examples";
import { installOutputReference, OutputRuntime, type OutputRuntimeEnv } from "@/modules/output/output-runtime";
import { OutputSessionError, prepareSession } from "@/modules/output/output-session";
import { createOutputSource } from "@/modules/output/output-sources";
import { serializeProject } from "@/persistence/schema";
import type { FrameSource } from "@/preview/contract";
import { pixelTestProject } from "./fixtures/pixel-test";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Node has no DOM. The composer (`targetSource`) and the grid's pattern tiles create off-screen canvases; give
// them recording stand-ins, so the runtime and the composer run as they do in the window.
const recordingContext = () =>
  new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : k === "createImageData" ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === "createPattern" ? () => ({ setTransform() {} }) : k === "getImageData" ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
if (typeof document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: recordingContext }) };
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = class {};
}

const display = (devicePx: Size, scaleFactor = 1, refreshHz = 60): DisplayInfo => ({
  key: { label: "Test display", devicePx, internal: false, electronId: 7 },
  electronId: 7,
  label: "Test display",
  internal: false,
  primary: false,
  boundsDip: { x: 0, y: 0, width: devicePx.width / scaleFactor, height: devicePx.height / scaleFactor },
  scaleFactor,
  devicePx,
  devicePxExact: true,
  rotation: 0,
  refreshHz,
  hostsControlWindow: false,
  hostsOutput: "out-1",
});

const pixelText = serializeProject(pixelTestProject());
const pixelOutputId = resolveMapping(pixelTestProject()).outputs[0].outputId;
const paused: OutputClock = { state: "paused", frame: 0 };
const depthJson = (): JsonValue => JSON.parse(JSON.stringify(normalizeDepthConfig(EMERALD_CHAMBER)));

function session(over: Partial<OutputWindowSession> = {}): OutputWindowSession {
  return {
    revision: 1,
    projectText: pixelText,
    outputId: pixelOutputId,
    source: { id: "pixel-grid", settings: { space: "master", motion: true } },
    clock: paused,
    display: display({ width: 1920, height: 1080 }),
    ...over,
  };
}

/** A source that records the frames it was asked for, standing in for the real ones (no canvas in node). */
function fakeSource(frames: number[] = []): FrameSource {
  return { id: "fake", name: "Fake", draw: (_ctx, input) => void frames.push(input.frame) };
}

async function code(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(OutputSessionError);
    return (e as OutputSessionError).code;
  }
}

// ── prepareSession ────────────────────────────────────────────────────────────

describe("prepareSession: one mapping path (PHYSICAL_OUTPUT 8.1)", () => {
  it("uses exactly the MP4 export's target for this output: same regions, same size", async () => {
    for (const [name, project] of [["Pixel test", pixelTestProject()], ["Festival", buildExample("festival")]] as const) {
      const mapping = resolveMapping(project);
      for (const out of mapping.outputs) {
        const prepared = await prepareSession(session({ projectText: serializeProject(project), outputId: out.outputId }), { createSource: async () => fakeSource() });
        const expected = videoTargets(mapping).find((t) => t.kind === "output" && t.id === out.outputId)!;
        expect(prepared.target, `${name} ${out.name}`).toEqual(expected);
        expect([prepared.master.width, prepared.master.height]).toEqual([mapping.master.width, mapping.master.height]);
      }
    }
  });

  it("refuses with the report codes of 8.4 and never returns a half-built session", async () => {
    const fake = { createSource: async () => fakeSource() };
    expect(await code(prepareSession(session({ projectText: "{not json" }), fake))).toBe("PROJECT_INVALID");
    expect(await code(prepareSession(session({ projectText: JSON.stringify({ format: "pixellab", version: 999 }) }), fake))).toBe("PROJECT_INVALID");
    expect(await code(prepareSession(session({ outputId: "nope" }), fake))).toBe("UNKNOWN_OUTPUT");
    expect(await code(prepareSession(session({ source: { id: "flow", settings: {} } })))).toBe("SOURCE_UNKNOWN");
    expect(await code(prepareSession(session({ source: { id: "pixel-grid", settings: { space: "master" } } })))).toBe("SOURCE_SETTINGS_INVALID");
    // A test card whose logo didn't load is refused when it shows the logo, not when it doesn't.
    const noLogo = { createSource: (id: string, settings: JsonValue, master: Size) => createOutputSource(id, settings, master, { prepareCalibration: async () => ({ logo: false, font: true }), depthMaxSize: () => null }) };
    expect(await code(prepareSession(session({ source: { id: "calibration-test-card", settings: { mode: "identification", logo: "center" } } }), noLogo))).toBe("ASSET_MISSING");
    expect(await code(prepareSession(session({ source: { id: "calibration-test-card", settings: { mode: "identification", logo: "off" } } }), noLogo))).toBeNull();
    expect(await code(prepareSession(session({ source: { id: "depth-scene", settings: depthJson() } }), noLogo))).toBe("GPU_UNAVAILABLE");
    expect(await code(prepareSession(session({ source: { id: "depth-scene", settings: {} } })))).toBe("SOURCE_SETTINGS_INVALID");
  });

  it("MASTER_TOO_LARGE when the master or the display is over the canvas limit, never scaled", async () => {
    const fake = { createSource: async () => fakeSource() };
    expect(await code(prepareSession(session(), { ...fake, limits: { maxCanvasSide: 1919, maxCanvasArea: 1e9 } }))).toBe("MASTER_TOO_LARGE");
    expect(await code(prepareSession(session(), { ...fake, limits: { maxCanvasSide: 4096, maxCanvasArea: 1920 * 1080 - 1 } }))).toBe("MASTER_TOO_LARGE");
    expect(await code(prepareSession(session({ display: display({ width: 8000, height: 1000 }) }), { ...fake, limits: { maxCanvasSide: 4096, maxCanvasArea: 1e9 } }))).toBe("MASTER_TOO_LARGE");
    expect(await code(prepareSession(session(), { ...fake, limits: { maxCanvasSide: 1920, maxCanvasArea: 1920 * 1080 } }))).toBeNull();
  });

  it("a source failure that isn't a refusal is DRAW_FAILED", async () => {
    expect(await code(prepareSession(session(), { createSource: async () => { throw new Error("boom"); } }))).toBe("DRAW_FAILED");
  });

  it("the pixel grid in display space covers the framebuffer from device pixel (0, 0), not the master", async () => {
    const prepared = await prepareSession(session({ source: { id: "pixel-grid", settings: { space: "display", motion: false } } }));
    const rects: number[][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (...a: number[]) => void (k === "fillRect" && rects.push(a))),
      set: (t, k, v) => ((t[k as string] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    prepared.draw(ctx, 0, 30, { width: 2560, height: 1440 });
    // The edge lines run along the display's own first and last pixels.
    expect(rects).toContainEqual([0, 0, 2560, 1]);
    expect(rects).toContainEqual([0, 1439, 2560, 1]);
    expect(rects).toContainEqual([2559, 0, 1, 1440]);
  });
});

// ── OutputRuntime ─────────────────────────────────────────────────────────────

function harness(opts: { dpr?: number; limit?: number } = {}) {
  const callbacks: { session?: (s: OutputWindowSession) => void; clock?: (c: OutputClock) => void; display?: (d: DisplayInfo) => void } = {};
  const reports: OutputRenderReport[] = [];
  let ready = 0;
  const api: OutputWindowApi = {
    onSession: (cb) => void (callbacks.session = cb),
    onClock: (cb) => void (callbacks.clock = cb),
    onDisplay: (cb) => void (callbacks.display = cb),
    ready: () => void ready++,
    report: (r) => void reports.push(r),
  };
  const queue: ((t: number) => void)[] = [];
  const fills: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : (...a: unknown[]) => void (k === "fillRect" && fills.push(`${t.fillStyle}:${a.join(",")}`))),
    set: (t, k, v) => ((t[k as string] = v), true),
  });
  let contexts = 0;
  const canvas = { width: 1, height: 1, style: {} as Record<string, string>, getContext: () => (contexts++, ctx) } as unknown as HTMLCanvasElement;
  let contentBox: ((s: Size) => void) | null = null;
  let gpu: ((lost: boolean) => void) | null = null;
  const env: OutputRuntimeEnv = {
    requestFrame: (cb) => void queue.push(cb),
    timeOrigin: 0,
    devicePixelRatio: () => opts.dpr ?? 1,
    viewportCss: () => ({ width: 1920 / (opts.dpr ?? 1), height: 1080 / (opts.dpr ?? 1) }),
    observeContentBox: (_c, cb) => ((contentBox = cb), () => {}),
    watchDevicePixelRatio: () => () => {},
    limits: () => ({ maxCanvasSide: 32767, maxCanvasArea: 268435456, maxTextureSize: 16384, depthMaxSize: null }),
    watchGpu: (cb) => ((gpu = cb), () => {}),
  };
  const frames: number[] = [];
  const runtime = new OutputRuntime({ ...env, prepare: { createSource: async () => fakeSource(frames) } });
  runtime.start(api, canvas);
  let now = 0;
  /** Runs `n` rAF callbacks, one per 60 Hz refresh. */
  const run = (n: number, period = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      now += period;
      queue.shift()!(now);
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { api, callbacks, reports, canvas, frames, fills, run, settle, runtime, ready: () => ready, contexts: () => contexts, contentBox: (s: Size) => contentBox!(s), now: () => now, gpu: (lost: boolean) => gpu!(lost) };
}

describe("OutputRuntime (PHYSICAL_OUTPUT 8.1, 8.3, 8.4)", () => {
  it("says ready once listening; until a session arrives it draws nothing and reports only what it measures", () => {
    const h = harness();
    expect(h.ready()).toBe(1);
    h.run(60);
    expect(h.frames).toEqual([]);
    expect(h.reports.length).toBeGreaterThanOrEqual(2);
    expect(h.reports[0]).toMatchObject({ sessionRevision: 0, firstFrameDrawn: false, frame: 0, outputPx: { width: 1, height: 1 } });
    expect(h.reports[0].sourceId).toBeUndefined();
  });

  it("sizes the backing store to the display's device pixels and its CSS size to devicePx / dpr, unrounded", async () => {
    const h = harness({ dpr: 2 });
    h.callbacks.session!(session({ display: display({ width: 3840, height: 2160 }, 2) }));
    await h.settle();
    h.run(1);
    expect([h.canvas.width, h.canvas.height]).toEqual([3840, 2160]);
    expect(h.canvas.style).toMatchObject({ width: "1920px", height: "1080px" });
    // A black fill of the whole backing store, then the output at scale 1.
    expect(h.fills[0]).toBe("#000:0,0,3840,2160");
    expect(h.frames).toEqual([0]);
  });

  it("first report: frame drawn, revision, sizes, source and limits; then at most every 500 ms", async () => {
    const h = harness();
    h.callbacks.session!(session({ revision: 4 }));
    await h.settle();
    h.contentBox({ width: 1920, height: 1080 });
    h.run(1);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({
      sessionRevision: 4,
      firstFrameDrawn: true,
      frame: 0,
      devicePixelRatio: 1,
      canvasPx: { width: 1920, height: 1080 },
      outputPx: { width: 1920, height: 1080 },
      masterPx: { width: 1920, height: 1080 },
      contentBoxDevicePx: { width: 1920, height: 1080 },
      sourceId: "pixel-grid",
      limits: { maxCanvasSide: 32767, maxCanvasArea: 268435456, maxTextureSize: 16384, depthMaxSize: null },
    });
    expect(h.reports[0].errorCode).toBeUndefined();
    h.run(120); // 2 s at 60 Hz
    expect(h.reports.length).toBeGreaterThanOrEqual(4);
    expect(h.reports.length).toBeLessThanOrEqual(5);
    expect(h.reports.at(-1)!.browserFps).toBe(60);
  });

  it("a still card draws once; a playing clock draws each content frame from the shared epoch", async () => {
    const h = harness();
    h.callbacks.session!(session());
    await h.settle();
    h.run(30);
    expect(h.frames).toEqual([0]);
    // 30 fps on 60 Hz: each content frame for two refreshes, no skips.
    h.callbacks.clock!({ state: "playing", fps: 30, startFrame: 100, epochMs: h.now() });
    h.run(121);
    const played = h.frames.slice(1);
    expect(played[0]).toBe(100);
    expect(played.at(-1)).toBe(160);
    for (let i = 1; i < played.length; i++) expect(played[i] - played[i - 1]).toBe(1);
    const last = h.reports.at(-1)!;
    expect(last.cadence).toMatchObject({ contentFps: 30, refreshHz: 60, pattern: [2], even: true });
    expect(h.reports.reduce((n, r) => n + r.skippedFrames, 0)).toBe(0);
  });

  it("counts skipped frames when refreshes are missed", async () => {
    const h = harness();
    h.callbacks.session!(session({ clock: { state: "playing", fps: 60, startFrame: 0, epochMs: 0 } }));
    await h.settle();
    h.run(70);
    h.run(1, (1000 / 60) * 4); // three vsyncs lost
    h.run(40);
    expect(h.reports.reduce((n, r) => n + r.skippedFrames, 0)).toBe(3);
    expect(h.reports.reduce((n, r) => n + r.lateFrames, 0)).toBe(1);
  });

  it("a bad session keeps the previous one on screen and reports its code; a good one swaps at the next frame", async () => {
    const h = harness();
    h.callbacks.session!(session({ revision: 1 }));
    await h.settle();
    h.run(1);
    h.callbacks.session!(session({ revision: 2, outputId: "missing" }));
    await h.settle();
    h.run(31);
    const bad = h.reports.at(-1)!;
    expect(bad).toMatchObject({ sessionRevision: 1, firstFrameDrawn: true, errorCode: "UNKNOWN_OUTPUT" });
    h.callbacks.session!(session({ revision: 3, source: { id: "pixel-grid", settings: { space: "master", motion: false } } }));
    await h.settle();
    h.run(31);
    expect(h.reports.at(-1)).toMatchObject({ sessionRevision: 3 });
    expect(h.reports.at(-1)!.errorCode).toBeUndefined();
  });

  it("a first session that fails leaves the window black and reports the code with nothing drawn", async () => {
    const h = harness();
    h.callbacks.session!(session({ projectText: "nope" }));
    await h.settle();
    h.run(1);
    expect(h.frames).toEqual([]);
    expect(h.reports[0]).toMatchObject({ sessionRevision: 0, firstFrameDrawn: false, errorCode: "PROJECT_INVALID" });
  });

  it("a session that finishes preparing after a newer one is dropped", async () => {
    const h = harness();
    h.callbacks.session!(session({ revision: 5 }));
    h.callbacks.session!(session({ revision: 4 }));
    await h.settle();
    h.run(1);
    expect(h.reports[0].sessionRevision).toBe(5);
  });

  it("a display change re-lays out without rebuilding the session", async () => {
    const h = harness();
    h.callbacks.session!(session());
    await h.settle();
    h.run(1);
    const contexts = h.contexts();
    h.callbacks.display!(display({ width: 2560, height: 1440 }));
    h.run(1);
    expect([h.canvas.width, h.canvas.height]).toEqual([2560, 1440]);
    expect(h.contexts()).toBe(contexts + 1);
    // Redrawn at once on the new backing store: black over all of it, then the output.
    expect(h.fills).toContain("#000:0,0,2560,1440");
  });
});

// ── Test reference for O6 (hidden smoke runs only) ────────────────────────────

describe("output reference hook (O6)", () => {
  const runtime = { referenceFrame: async () => null };
  it("is absent unless the output preload sets testMode === true", () => {
    for (const api of [{}, { testMode: false }, { testMode: "true" }, { testMode: 1 }]) {
      const win: Record<string, unknown> = {};
      installOutputReference(win, api, runtime);
      expect("__pixelLabOutputReference" in win, JSON.stringify(api)).toBe(false);
    }
  });

  it("with testMode it is installed, not enumerable, and removed on cleanup", () => {
    const win: Record<string, unknown> = {};
    const remove = installOutputReference(win, { testMode: true }, runtime);
    expect(typeof win.__pixelLabOutputReference).toBe("function");
    expect(Object.keys(win)).toEqual([]);
    remove();
    expect("__pixelLabOutputReference" in win).toBe(false);
  });

  it("draws the requested frame through a fresh source and target, and leaves the live output alone", async () => {
    const h = harness();
    h.callbacks.session!(session({ revision: 7, display: display({ width: 1600, height: 900 }) }));
    await h.settle();
    h.run(31);
    const drawnBefore = [...h.frames];
    const reportsBefore = h.reports.length;
    const ref = await (h as unknown as { runtime: OutputRuntime }).runtime.referenceFrame(37);
    // The fake source records every frame it draws: the live one (0) and, once, the reference's 37.
    expect(h.frames).toEqual([...drawnBefore, 37]);
    expect(ref).toMatchObject({ width: 1920, height: 1080, visible: { width: 1600, height: 900 } });
    expect(ref!.hash).toMatch(/^[0-9a-f]{64}$/);
    h.run(31);
    // No redraw of the live frame, the same revision, the clock untouched.
    expect(h.frames).toEqual([...drawnBefore, 37]);
    expect(h.reports.at(-1)).toMatchObject({ sessionRevision: 7, frame: 0 });
    expect(h.reports.length).toBeGreaterThan(reportsBefore);
    expect(await (h as unknown as { runtime: OutputRuntime }).runtime.referenceFrame(-1)).toBeNull();
  });
});

// ── Depth Studio on the output (O7) ──────────────────────────────────────────

describe("Depth Studio on the output (O7)", () => {
  const festivalText = serializeProject(buildExample("festival"));
  const festivalOut = resolveMapping(buildExample("festival")).outputs[0].outputId;
  const depth = () => session({ projectText: festivalText, outputId: festivalOut, source: { id: "depth-scene", settings: depthJson() }, display: display({ width: 3072, height: 1920 }) });

  it("Festival (5120 × 1664) over a fake 4096 px GPU limit: MASTER_TOO_LARGE, never scaled, the window stays black", async () => {
    const fakeLimit = { createSource: (id: string, settings: JsonValue, master: Size) => createOutputSource(id, settings, master, { prepareCalibration: async () => ({ logo: true, font: true }), depthMaxSize: () => 4096 }) };
    expect(await code(prepareSession(depth(), fakeLimit))).toBe("MASTER_TOO_LARGE");
    // At 5120 or more it is allowed (the dev Mac reports 16384).
    expect(await code(prepareSession(depth(), { createSource: (id: string, settings: JsonValue, master: Size) => createOutputSource(id, settings, master, { prepareCalibration: async () => ({ logo: true, font: true }), depthMaxSize: () => 5120 }) }))).not.toBe("MASTER_TOO_LARGE");
  });

  it("a lost WebGL context reports GPU_UNAVAILABLE and keeps the last frame; on restore it draws again and clears the error", async () => {
    const h = harness();
    h.callbacks.session!(depth());
    await h.settle();
    h.callbacks.clock!({ state: "playing", fps: 30, startFrame: 0, epochMs: h.now() });
    h.run(31);
    const drawnBeforeLoss = h.frames.length;
    expect(drawnBeforeLoss).toBeGreaterThan(5);
    h.gpu(true);
    h.run(61);
    expect(h.frames.length).toBe(drawnBeforeLoss);
    expect(h.reports.at(-1)).toMatchObject({ errorCode: "GPU_UNAVAILABLE", firstFrameDrawn: true });
    h.gpu(false);
    h.run(31);
    expect(h.frames.length).toBeGreaterThan(drawnBeforeLoss);
    expect(h.reports.at(-1)!.errorCode).toBeUndefined();
  });

  it("a lost context doesn't touch a source without WebGL (test card, pixel grid)", async () => {
    const h = harness();
    h.callbacks.session!(session({ clock: { state: "playing", fps: 30, startFrame: 0, epochMs: 0 } }));
    await h.settle();
    h.run(10);
    const n = h.frames.length;
    h.gpu(true);
    h.run(31);
    expect(h.frames.length).toBeGreaterThan(n);
    expect(h.reports.at(-1)!.errorCode).toBeUndefined();
  });

  it("the GPU test hook is gated like the reference: only with testMode", () => {
    const runtime = { referenceFrame: async () => null };
    const off: Record<string, unknown> = {};
    installOutputReference(off, {}, runtime, () => true);
    expect("__pixelLabOutputGpu" in off).toBe(false);
    const on: Record<string, unknown> = {};
    const calls: boolean[] = [];
    const remove = installOutputReference(on, { testMode: true }, runtime, (lose) => (calls.push(lose), true));
    const hook = on.__pixelLabOutputGpu as { lose(): boolean; restore(): boolean };
    expect(hook.lose()).toBe(true);
    expect(hook.restore()).toBe(true);
    expect(calls).toEqual([true, false]);
    remove();
    expect("__pixelLabOutputGpu" in on).toBe(false);
  });

  it("tests/fixtures/depth-emerald-chamber.json is the normalized default scene (regenerate with UPDATE_FIXTURES=1)", () => {
    const file = "tests/fixtures/depth-emerald-chamber.json";
    const text = JSON.stringify(normalizeDepthConfig(EMERALD_CHAMBER), null, 2) + "\n";
    if (process.env.UPDATE_FIXTURES || !existsSync(file)) writeFileSync(file, text);
    expect(readFileSync(file, "utf8")).toBe(text);
  });
});

// ── The output page loads nothing from the editor (8.1) ──────────────────────

describe("output page imports", () => {
  it("never pulls in the editor store, the module registry or studio panels", () => {
    const root = path.resolve(__dirname, "..");
    const seen = new Set<string>();
    const resolveFile = (spec: string, from: string): string | null => {
      const base = spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
      if (!base) return null;
      for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext) && !base.endsWith("/") && (ext || /\.(ts|tsx)$/.test(base))) return base + ext;
      return null;
    };
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'"]*?from\s+)?["']([^"']+)["']/g)) {
        if (/^import\s+type\b/.test(m[0]) || /^export\s+type\b/.test(m[0])) continue;
        const next = resolveFile(m[1], file);
        if (next) walk(next);
      }
    };
    walk(path.join(root, "src/app/output/page.tsx"));
    const rel = [...seen].map((f) => path.relative(root, f));
    expect(rel).toContain("src/modules/output/output-runtime.ts");
    expect(rel.filter((f) => /src\/state\/store|src\/modules\/registry|studio-panel|src\/components\/workspace/.test(f))).toEqual([]);
  });
});

// ── Project files the Electron integration script imports and opens (desktop/tests/smoke-scripts/o4-output-page.cjs)

describe("example project fixtures for the output integration script", () => {
  for (const [file, id] of [["tests/fixtures/corporate-keynote.pixellab.json", "keynote"], ["tests/fixtures/festival-main-stage.pixellab.json", "festival"]] as const) {
    it(`${file} is the current ${id} example, serialized (regenerate with UPDATE_FIXTURES=1)`, () => {
      const text = serializeProject(buildExample(id));
      if (process.env.UPDATE_FIXTURES || !existsSync(file)) writeFileSync(file, text);
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  }
});
