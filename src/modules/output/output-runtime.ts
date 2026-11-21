import type { ContentFps } from "@/domain/motion";
import type { DisplayInfo, OutputClock, OutputRenderErrorCode, OutputRenderReport, OutputWindowApi, OutputWindowSession, Size } from "@/domain/physical-output";
import { cadencePattern, contentFrame, medianInterval, needsReanchor, outputLayout, type OutputLayout, type RefreshGrid } from "@/engines/output-layout";
import { CHROMIUM_CANVAS_LIMITS, OutputSessionError, prepareSession, type PrepareEnv, type PreparedSession } from "./output-session";
import { createOutputSource } from "./output-sources";
import { targetSource } from "./target-source";

/**
 * The output window's presenter (PHYSICAL_OUTPUT 8.1, 8.3, 8.4, 8.6): one canvas, sized to the display's device
 * pixels, showing one output at scale 1 from its top-left, black elsewhere. It owns the canvas, the clock sample,
 * the cadence and the reports, and knows nothing of mapping maths or how a source draws (O-1 layers).
 *
 * - A session is prepared to the side and swapped in at the next frame only once fully prepared. A session that
 *   fails keeps the previous one on screen (or black, if none drew yet) and reports the code.
 * - The frame is a pure function of the shared clock: `contentFrame(clock, t, grid)` on the rAF timestamp,
 *   quantized to the measured refresh grid.
 * - It draws only when the session, the content frame or the layout changed. A still card costs nothing.
 * - It reports at most every 500 ms, from its first frame, with or without a session. Nothing is ever drawn on
 *   the wall but content.
 */

/** What the runtime needs from the browser. The page passes the real one; tests pass fakes. */
export interface OutputRuntimeEnv {
  requestFrame(callback: (timestamp: number) => void): void;
  /** `performance.timeOrigin`: rAF timestamps plus this are on the shared clock (section 4). */
  readonly timeOrigin: number;
  devicePixelRatio(): number;
  viewportCss(): Size;
  /** Calls back with the canvas's device-pixel content box whenever Chromium lays it out. Returns a disposer. */
  observeContentBox(canvas: HTMLCanvasElement, callback: (size: Size) => void): () => void;
  /** Calls back when `devicePixelRatio` changes. Returns a disposer. */
  watchDevicePixelRatio(callback: () => void): () => void;
  /** GPU and canvas limits, measured once. */
  limits(): NonNullable<OutputRenderReport["limits"]>;
  readonly prepare?: Partial<PrepareEnv>;
}

const REPORT_EVERY_MS = 500;
const FPS_WINDOW_MS = 2000;
const GRID_SAMPLES = 60;
const MAX_ERROR = 500;
const PAINT_SAMPLES = 4000;

interface Live {
  readonly prepared: PreparedSession;
  display: DisplayInfo;
  clock: OutputClock;
  /** The content rate of the last playing clock: a paused clock still labels counters with it. */
  fps: ContentFps;
}

const DEFAULT_FPS: ContentFps = 30;
const fpsOf = (clock: OutputClock, previous: ContentFps = DEFAULT_FPS): ContentFps => (clock.state === "playing" ? clock.fps : previous);

export class OutputRuntime {
  private api: OutputWindowApi | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private live: Live | null = null;
  private pending: Live | null = null;
  /** The newest session asked for; an older one finishing its preparation late is dropped. */
  private latestRevision = -1;
  private layout: OutputLayout | null = null;
  private layoutDirty = true;
  private drawn: { revision: number; frame: number } | null = null;
  private firstFrameDrawn = false;
  private error: { code: OutputRenderErrorCode; message: string } | null = null;
  private contentBox: Size | null = null;
  private stamps: number[] = [];
  private grid: RefreshGrid | null = null;
  private lastStamp: number | null = null;
  private lateFrames = 0;
  private skippedFrames = 0;
  private repeated = 0;
  private held = 0;
  /** The last frame drawn under the current clock; a new clock (play, pause, seek) starts counting afresh. */
  private cadenceFrame: number | null = null;
  private lastReportAt = -Infinity;
  private limitsCache: NonNullable<OutputRenderReport["limits"]> | null = null;
  private disposers: (() => void)[] = [];
  /** How long each paint took, in ms, the last PAINT_SAMPLES of them (O8 measurements; read through testMode only). */
  private paintMs: number[] = [];
  private paintIntervals: number[] = [];
  private lastPaintAt: number | null = null;

  constructor(private readonly env: OutputRuntimeEnv) {}

  start(api: OutputWindowApi, canvas: HTMLCanvasElement): void {
    this.api = api;
    this.canvas = canvas;
    this.disposers.push(this.env.observeContentBox(canvas, (size) => (this.contentBox = size)));
    this.disposers.push(this.env.watchDevicePixelRatio(() => (this.layoutDirty = true)));
    api.onSession((session) => void this.receive(session));
    api.onClock((clock) => this.setClock(clock));
    api.onDisplay((display) => this.setDisplay(display));
    api.ready();
    this.env.requestFrame((t) => this.tick(t));
  }

  /**
   * Test reference (task O6, hidden smoke runs only): frame `frame` of the session on screen, drawn the way the MP4
   * exporter draws it — a fresh `createOutputSource` → `targetSource` on an off-screen canvas the output's size — and
   * hashed over the area that reaches the display. Read-only: it doesn't touch the live frame, clock, session or
   * reports, and keeps nothing. `null` when no session is drawn.
   */
  async referenceFrame(frame: number): Promise<{ hash: string; width: number; height: number; visible: Size } | null> {
    const live = this.live;
    if (!live || !Number.isSafeInteger(frame) || frame < 0) return null;
    const { prepared } = live;
    const { target, master } = prepared;
    const createSource = this.env.prepare?.createSource ?? createOutputSource;
    const source = await createSource(prepared.sourceId, prepared.sourceSettings, { width: master.width, height: master.height });
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    targetSource(source, target, master).draw(ctx, { ...master, width: target.width, height: target.height, frame, fps: live.fps }, { scale: 1, fontFamily: "sans-serif" });
    const visible = { width: Math.min(target.width, live.display.devicePx.width), height: Math.min(target.height, live.display.devicePx.height) };
    const pixels = ctx.getImageData(0, 0, visible.width, visible.height).data;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", pixels));
    return { hash: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""), width: target.width, height: target.height, visible };
  }

  /** Stops reacting to the window. The loop ends at its next callback. */
  stop(): void {
    for (const d of this.disposers.splice(0)) d();
    this.api = null;
  }

  private async receive(session: OutputWindowSession): Promise<void> {
    if (!this.api) return;
    this.latestRevision = Math.max(this.latestRevision, session.revision);
    try {
      const prepared = await prepareSession(session, { limits: this.limitsCache ?? CHROMIUM_CANVAS_LIMITS, ...this.env.prepare });
      if (session.revision < this.latestRevision) return;
      this.pending = { prepared, display: session.display, clock: session.clock, fps: fpsOf(session.clock, this.live?.fps) };
    } catch (error) {
      if (session.revision < this.latestRevision) return;
      const code = error instanceof OutputSessionError ? error.code : "DRAW_FAILED";
      this.fail(code, error instanceof Error ? error.message : String(error));
    }
  }

  private setClock(clock: OutputClock): void {
    for (const l of [this.pending, this.live]) {
      if (!l) continue;
      l.clock = clock;
      l.fps = fpsOf(clock, l.fps);
    }
    this.cadenceFrame = null;
  }

  private setDisplay(display: DisplayInfo): void {
    if (this.pending) this.pending.display = display;
    if (this.live) this.live.display = display;
    this.layoutDirty = true;
  }

  private fail(code: OutputRenderErrorCode, message: string): void {
    this.error = { code, message: message.slice(0, MAX_ERROR) };
    this.lastReportAt = -Infinity;
  }

  /** Measured refresh period and grid from the last rAF timestamps (8.6). */
  private sample(t: number): void {
    if (this.lastStamp !== null && this.grid && t - this.lastStamp > 1.5 * this.grid.periodMs) this.lateFrames++;
    this.lastStamp = t;
    this.stamps.push(t);
    if (this.stamps.length > GRID_SAMPLES) this.stamps.shift();
    const period = medianInterval(this.stamps);
    if (period === null) return;
    if (!this.grid || Math.abs(this.grid.periodMs - period) > 0.01) this.grid = { periodMs: period, anchorMs: this.grid?.anchorMs ?? t };
    if (needsReanchor(t, this.grid)) this.grid = { periodMs: period, anchorMs: t };
  }

  private relayout(live: Live): void {
    const canvas = this.canvas!;
    const layout = outputLayout({
      devicePx: live.display.devicePx,
      devicePixelRatio: this.env.devicePixelRatio(),
      outputPx: { width: live.prepared.target.width, height: live.prepared.target.height },
      devicePxExact: live.display.devicePxExact,
    });
    // Reallocate only when the backing store changes; a reallocation clears it, so draw again.
    if (canvas.width !== layout.canvasPx.width || canvas.height !== layout.canvasPx.height || !this.ctx) {
      canvas.width = layout.canvasPx.width;
      canvas.height = layout.canvasPx.height;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.drawn = null;
    }
    canvas.style.width = layout.canvasCss.width;
    canvas.style.height = layout.canvasCss.height;
    this.layout = layout;
    this.layoutDirty = false;
  }

  private tick(timestamp: number): void {
    if (!this.api) return;
    this.env.requestFrame((t) => this.tick(t));
    const t = this.env.timeOrigin + timestamp;
    this.sample(t);

    if (this.pending) {
      this.live = this.pending;
      this.pending = null;
      this.layoutDirty = true;
      this.drawn = null;
      this.error = null;
      this.limitsCache ??= this.env.limits();
    }
    const live = this.live;
    if (live) {
      if (this.layoutDirty) this.relayout(live);
      const frame = contentFrame(live.clock, t, this.grid);
      const last = this.drawn;
      if (!last || last.revision !== live.prepared.revision || last.frame !== frame) {
        this.countCadence(live.clock, frame);
        this.paint(live, frame);
      } else if (live.clock.state === "playing") {
        this.held++;
      }
    }
    if (t - this.lastReportAt >= REPORT_EVERY_MS) this.report(t);
  }

  /** Skipped: the frame jumped further than one refresh allows. Repeated: held longer than the pattern says. */
  private countCadence(clock: OutputClock, frame: number): void {
    const held = this.held;
    const previous = this.cadenceFrame;
    this.held = 1;
    this.cadenceFrame = frame;
    if (clock.state !== "playing" || previous === null || !this.grid) return;
    const hz = 1000 / this.grid.periodMs;
    const maxStep = Math.max(1, Math.ceil(clock.fps / hz - 1e-6));
    const step = frame - previous;
    if (step > maxStep) this.skippedFrames += step - maxStep;
    const { pattern } = cadencePattern(clock.fps, Math.round(hz));
    if (pattern.length && held > Math.max(...pattern)) this.repeated++;
  }

  private paint(live: Live, frame: number): void {
    const ctx = this.ctx;
    const layout = this.layout;
    if (!ctx || !layout) return;
    const started = performance.now();
    try {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, layout.canvasPx.width, layout.canvasPx.height);
      ctx.restore();
      live.prepared.draw(ctx, frame, live.fps, layout.canvasPx);
      this.drawn = { revision: live.prepared.revision, frame };
      this.recordPaint(started);
      if (!this.firstFrameDrawn) {
        this.firstFrameDrawn = true;
        this.lastReportAt = -Infinity;
      }
    } catch (error) {
      this.fail("DRAW_FAILED", error instanceof Error ? error.message : String(error));
      this.drawn = { revision: live.prepared.revision, frame };
    }
  }

  private recordPaint(started: number): void {
    const end = performance.now();
    this.paintMs.push(end - started);
    if (this.lastPaintAt !== null) this.paintIntervals.push(end - this.lastPaintAt);
    this.lastPaintAt = end;
    if (this.paintMs.length > PAINT_SAMPLES) this.paintMs.shift();
    if (this.paintIntervals.length > PAINT_SAMPLES) this.paintIntervals.shift();
  }

  /**
   * Paint measurements since the last call (O8, hidden smoke runs through testMode): how long each paint took
   * and the time between paints, in ms. Read-only apart from clearing the samples it returns.
   */
  paintStats(): { paintMs: number[]; intervalsMs: number[] } {
    const out = { paintMs: this.paintMs, intervalsMs: this.paintIntervals };
    this.paintMs = [];
    this.paintIntervals = [];
    this.lastPaintAt = null;
    return out;
  }

  private browserFps(t: number): number {
    const recent = this.stamps.filter((s) => t - s <= FPS_WINDOW_MS);
    if (recent.length < 2) return 0;
    return Math.round(((recent.length - 1) * 1000) / (recent[recent.length - 1] - recent[0]));
  }

  private report(t: number): void {
    const api = this.api;
    if (!api) return;
    const live = this.live;
    // Before any session it still reports what it measures (revision 0, nothing drawn), so main knows the
    // window is alive and how it is laid out.
    this.lastReportAt = t;
    const canvas = this.canvas!;
    const measuredHz = this.grid ? Math.round((1000 / this.grid.periodMs) * 100) / 100 : 0;
    const report: OutputRenderReport = {
      sessionRevision: live?.prepared.revision ?? 0,
      firstFrameDrawn: this.firstFrameDrawn,
      frame: this.drawn?.frame ?? 0,
      devicePixelRatio: this.env.devicePixelRatio(),
      viewportCss: this.env.viewportCss(),
      canvasPx: { width: canvas.width, height: canvas.height },
      outputPx: live ? { width: live.prepared.target.width, height: live.prepared.target.height } : { width: 1, height: 1 },
      browserFps: this.browserFps(t),
      lateFrames: this.lateFrames,
      skippedFrames: this.skippedFrames,
      contentBoxDevicePx: this.contentBox,
      ...(live ? { masterPx: { width: live.prepared.master.width, height: live.prepared.master.height }, sourceId: live.prepared.sourceId } : {}),
      ...(this.error ? { error: this.error.message, errorCode: this.error.code } : {}),
      ...(live && live.clock.state === "playing" && measuredHz > 0
        ? (() => {
            const refreshHz = live.display.refreshHz > 0 ? live.display.refreshHz : measuredHz;
            const { pattern, even } = cadencePattern(live.clock.fps, refreshHz);
            return { cadence: { contentFps: live.clock.fps, refreshHz, measuredHz, pattern, even, repeated: this.repeated } };
          })()
        : {}),
      ...(this.limitsCache ? { limits: this.limitsCache } : {}),
    };
    this.lateFrames = 0;
    this.skippedFrames = 0;
    this.repeated = 0;
    api.report(report);
  }
}

/** The real browser environment for the output page. */
export function browserRuntimeEnv(depthMaxSize: () => number | null): OutputRuntimeEnv {
  return {
    requestFrame: (cb) => void requestAnimationFrame(cb),
    timeOrigin: performance.timeOrigin,
    devicePixelRatio: () => window.devicePixelRatio,
    viewportCss: () => ({ width: window.innerWidth, height: window.innerHeight }),
    observeContentBox(canvas, callback) {
      if (typeof ResizeObserver === "undefined") return () => {};
      const observer = new ResizeObserver((entries) => {
        const box = entries[0]?.devicePixelContentBoxSize?.[0];
        if (box) callback({ width: Math.round(box.inlineSize), height: Math.round(box.blockSize) });
      });
      try {
        observer.observe(canvas, { box: "device-pixel-content-box" });
      } catch {
        observer.observe(canvas);
      }
      return () => observer.disconnect();
    },
    watchDevicePixelRatio(callback) {
      let query: MediaQueryList | null = null;
      const listen = () => {
        query?.removeEventListener("change", onChange);
        query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        query.addEventListener("change", onChange);
      };
      const onChange = () => {
        callback();
        listen();
      };
      listen();
      return () => query?.removeEventListener("change", onChange);
    },
    limits() {
      let maxTextureSize = 1;
      try {
        const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
        if (gl) {
          maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        }
      } catch {
        // No WebGL: the 2D canvas still works; the limit stays 1 and the report says so.
      }
      return { ...CHROMIUM_CANVAS_LIMITS, maxTextureSize, depthMaxSize: depthMaxSize() };
    },
  };
}

/** What the page installs on `window` for hidden smoke runs. */
export type OutputReferenceHook = (frame: number) => Promise<{ hash: string; width: number; height: number; visible: Size } | null>;

/**
 * Installs `__pixelLabOutputReference` on `target` (the page's `window`) only when the output preload says this is a
 * hidden smoke run (`pixelLabOutput.testMode === true`, set by Desktop's main, never in a packaged build). Without the
 * flag nothing is defined. Returns a function that removes it.
 */
export function installOutputReference(target: object, api: object, runtime: Pick<OutputRuntime, "referenceFrame"> & Partial<Pick<OutputRuntime, "paintStats">>): () => void {
  if ((api as { testMode?: unknown }).testMode !== true) return () => {};
  const hook: OutputReferenceHook = (frame) => runtime.referenceFrame(frame);
  Object.defineProperty(target, "__pixelLabOutputReference", { value: hook, configurable: true, enumerable: false, writable: false });
  // O8: paint times since the last call. Same gate as the reference.
  if (runtime.paintStats) Object.defineProperty(target, "__pixelLabOutputStats", { value: () => runtime.paintStats!(), configurable: true, enumerable: false, writable: false });
  return () => {
    delete (target as Record<string, unknown>).__pixelLabOutputReference;
    delete (target as Record<string, unknown>).__pixelLabOutputStats;
  };
}
