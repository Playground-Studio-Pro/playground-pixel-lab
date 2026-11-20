/**
 * Physical output contract: the shared types between Desktop Engineering (displays, output windows, IPC)
 * and Output Engineering (the output page and its report). Types and closed lists only; no behaviour.
 *
 * Source of truth: docs/architecture/PHYSICAL_OUTPUT.md, approved 2026-11-18. Section numbers below refer to it.
 * Desktop's main process is CommonJS and validates these shapes by hand; tests keep its lists equal to the ones here.
 * Changing this file is a contract change: it merges alone first, through the Lead Architect.
 */

import type { ContentFps } from "./motion";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Size {
  readonly x: number;
  readonly y: number;
}

/** VideoOutput.id: 1–64 characters of [A-Za-z0-9_-]. */
export type OutputId = string;

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

// ── Displays (section 1) ────────────────────────────────────────────────────

/** How main finds "the same display" again. Matching rules: section 1 and, for reconnects, D-2 in section 2. */
export interface DisplayKey {
  readonly label: string;
  readonly devicePx: Size;
  readonly internal: boolean;
  readonly electronId: number;
}

export interface DisplayInfo {
  readonly key: DisplayKey;
  /** Display.id, valid for this app run only. */
  readonly electronId: number;
  /** May be "". */
  readonly label: string;
  readonly internal: boolean;
  readonly primary: boolean;
  /** Display.bounds, in DIP. */
  readonly boundsDip: Rect;
  /** 1 or 2 on macOS; 1.25, 1.5, 1.75 possible on Windows. */
  readonly scaleFactor: number;
  /** Framebuffer size in device px: what the cable carries. */
  readonly devicePx: Size;
  /** False when devicePx came from rounding a fractional product (Windows). */
  readonly devicePxExact: boolean;
  readonly rotation: 0 | 90 | 180 | 270;
  /** 0 when unknown. */
  readonly refreshHz: number;
  readonly hostsControlWindow: boolean;
  readonly hostsOutput: OutputId | null;
  /**
   * Electron Display.colorSpace: Chromium's description of the display's colour profile, at most 512 characters,
   * e.g. "{primaries:BT709, transfer:SRGB, matrix:RGB, range:FULL}" for sRGB. It reports a --force-color-profile
   * override instead of the display's profile when one is set (the test:smoke harness sets one). Absent when unknown.
   */
  readonly colorSpace?: string;
  /** Electron Display.colorDepth: bits per pixel, e.g. 30. Absent when unknown. */
  readonly colorDepth?: number;
}

// ── Output state and clock (sections 2 and 4) ───────────────────────────────

export const OUTPUT_STATES = ["closed", "opening", "live", "waiting-display", "held", "failed"] as const;
/** `held`: on its display, full screen, paused after a reconnect, until the operator resumes (D-2). */
export type OutputState = (typeof OUTPUT_STATES)[number];

/**
 * frame = startFrame + floor((t − epochMs) × fps / 1000), with t on the performance.timeOrigin + performance.now()
 * clock. Output windows take t from the rAF timestamp, quantized to the refresh grid (8.6).
 */
export type OutputClock =
  | { readonly state: "playing"; readonly fps: ContentFps; readonly startFrame: number; readonly epochMs: number }
  | { readonly state: "paused"; readonly frame: number };

// ── Sessions (sections 3 and 8.5) ───────────────────────────────────────────

export const OUTPUT_SOURCE_IDS = ["calibration-test-card", "pixel-grid", "depth-scene"] as const;
export type OutputSourceId = (typeof OUTPUT_SOURCE_IDS)[number];

export interface OutputSession {
  /** Increments on every output:update. */
  readonly revision: number;
  /** serializeProject(project), at most 16 MiB. */
  readonly projectText: string;
  readonly outputId: OutputId;
  /** Validated by the output page (createOutputSource), not by main. Settings at most 1 MiB. */
  readonly source: { readonly id: string; readonly settings: JsonValue };
  readonly clock: OutputClock;
}

/** What main forwards to the output window: the session plus the display it placed the window on. */
export interface OutputWindowSession extends OutputSession {
  readonly display: DisplayInfo;
}

export interface OutputOpenRequest {
  readonly outputId: OutputId;
  readonly display: DisplayKey;
  /** Single-laptop rehearsal only (D-5). */
  readonly allowControlDisplay?: boolean;
  readonly session: OutputSession;
}

// ── Errors (sections 3 and 8.4) ─────────────────────────────────────────────

export const OUTPUT_ERROR_CODES = [
  "BAD_REQUEST",
  "UNTRUSTED_SENDER",
  "UNKNOWN_OUTPUT",
  "DISPLAY_NOT_FOUND",
  "DISPLAY_BUSY",
  "CONTROL_DISPLAY",
  "ALREADY_OPEN",
  "TOO_MANY_OUTPUTS",
  "PROJECT_INVALID",
  "LOAD_FAILED",
  "OPEN_TIMEOUT",
  "RENDERER_GONE",
  "RENDERER_UNRESPONSIVE",
  "DISPLAY_AMBIGUOUS",
  "NOT_RESUMABLE",
  "NOT_ONE_TO_ONE",
] as const;
/** Raised by main. */
export type OutputErrorCode = (typeof OUTPUT_ERROR_CODES)[number];

export const OUTPUT_RENDER_ERROR_CODES = [
  "PROJECT_INVALID",
  "UNKNOWN_OUTPUT",
  "SOURCE_UNKNOWN",
  "SOURCE_SETTINGS_INVALID",
  "ASSET_MISSING",
  "GPU_UNAVAILABLE",
  "MASTER_TOO_LARGE",
  "DRAW_FAILED",
] as const;
/** Raised by the output page, carried in OutputRenderReport.errorCode. */
export type OutputRenderErrorCode = (typeof OUTPUT_RENDER_ERROR_CODES)[number];

// ── Report from the output window (sections 3, 8.4 and 8.6) ─────────────────

export interface OutputCadence {
  readonly contentFps: ContentFps;
  /** DisplayInfo.refreshHz, or the measured rate when that is 0. */
  readonly refreshHz: number;
  readonly measuredHz: number;
  /** Refreshes per content frame over one cycle; at most 240 entries. */
  readonly pattern: readonly number[];
  readonly even: boolean;
  /** Since the last report. */
  readonly repeated: number;
}

export interface OutputRenderReport {
  /** Revision of the session being drawn, not the last one received. */
  readonly sessionRevision: number;
  readonly firstFrameDrawn: boolean;
  readonly frame: number;
  readonly devicePixelRatio: number;
  readonly viewportCss: Size;
  readonly canvasPx: Size;
  readonly outputPx: Size;
  /** rAF callbacks per second. A browser metric, never LED refresh. */
  readonly browserFps: number;
  readonly lateFrames: number;
  readonly skippedFrames: number;
  /** At most 500 characters. */
  readonly error?: string;
  /** ResizeObserver device-pixel-content-box; null until observed. */
  readonly contentBoxDevicePx?: Size | null;
  readonly masterPx?: Size;
  /** At most 200 characters. */
  readonly sourceId?: string;
  readonly errorCode?: OutputRenderErrorCode;
  readonly cadence?: OutputCadence;
  readonly limits?: {
    readonly maxCanvasSide: number;
    readonly maxCanvasArea: number;
    readonly maxTextureSize: number;
    readonly depthMaxSize: number | null;
  };
}

export const SIZE_MATCHES = ["exact", "smaller-than-display", "larger-than-display", "mixed", "unknown"] as const;
export type SizeMatch = (typeof SIZE_MATCHES)[number];

export interface AxisPx {
  readonly right: number;
  readonly bottom: number;
}

export interface OutputStatus {
  readonly outputId: OutputId;
  readonly state: OutputState;
  readonly display: DisplayInfo | null;
  readonly sessionRevision: number | null;
  readonly sizeMatch: SizeMatch;
  /** Output px past the display edge, never shown. */
  readonly croppedPx: AxisPx | null;
  /** Display px past the output edge, painted black. */
  readonly blackPx: AxisPx | null;
  /** True in `held` after a reconnect, until output:resume (D-2). */
  readonly reconnected: boolean;
  readonly render: OutputRenderReport | null;
  readonly error: { readonly code: OutputErrorCode | OutputRenderErrorCode; readonly message: string } | null;
}

// ── Preload APIs (section 3) ────────────────────────────────────────────────

/** window.pixelLabDesktop.output in the control window. */
export interface OutputControlApi {
  listDisplays(): Promise<DisplayInfo[]>;
  open(request: OutputOpenRequest): Promise<OutputStatus>;
  update(outputId: OutputId, session: OutputSession): Promise<OutputStatus>;
  setClock(outputId: OutputId | "*", clock: OutputClock): Promise<void>;
  close(outputId: OutputId | "*"): Promise<void>;
  retry(outputId: OutputId): Promise<OutputStatus>;
  /** Only from `held` (D-2). */
  resume(outputId: OutputId): Promise<OutputStatus>;
  status(): Promise<OutputStatus[]>;
  /** Returns an unsubscribe function. */
  onStatus(callback: (status: OutputStatus) => void): () => void;
  /** Returns an unsubscribe function. */
  onDisplays(callback: (displays: DisplayInfo[]) => void): () => void;
}

/** window.pixelLabOutput in an output window. Nothing else is exposed there. */
export interface OutputWindowApi {
  onSession(callback: (session: OutputWindowSession) => void): void;
  onClock(callback: (clock: OutputClock) => void): void;
  /** Metrics change or reconnect; the page re-lays out without rebuilding the source. */
  onDisplay(callback: (display: DisplayInfo) => void): void;
  ready(): void;
  /** At most 2 per second. */
  report(report: OutputRenderReport): void;
}

/** IPC channel names, fixed strings. */
export const OUTPUT_CHANNELS = {
  listDisplays: "output:list-displays",
  open: "output:open",
  update: "output:update",
  clock: "output:clock",
  close: "output:close",
  retry: "output:retry",
  resume: "output:resume",
  statusAll: "output:status-all",
  status: "output:status",
  displaysChanged: "output:displays-changed",
  session: "output:session",
  display: "output:display",
  ready: "output:ready",
  report: "output:report",
} as const;

/** One output in Alpha 0.1. Raising it needs no API change. */
export const MAX_OUTPUTS = 1;
