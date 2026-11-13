import type { ResolvedMapping } from "./mapping";

/**
 * What a video export can be made for: the master canvas, one output, or one screen. Pure: every
 * rectangle comes from `resolveMapping` as it is, and nothing is resized. A target the H.264 encoder
 * can't take at its own size is listed with the reason, never scaled to fit.
 */

/** One copy from the master canvas into the target, at 1:1. */
export interface VideoRegion {
  /** Master-space rectangle to read. */
  readonly from: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Target-space position to write it at. Same size as `from`. */
  readonly to: { readonly x: number; readonly y: number };
}

export interface VideoTarget {
  /** "master", the output id, or `screen:<id>`. */
  readonly id: string;
  readonly kind: "master" | "output" | "screen";
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** Null for the master: it is the master image itself. */
  readonly regions: readonly VideoRegion[] | null;
  /** Why H.264 can't export it at this size, or null. */
  readonly problem: string | null;
}

/** The browser H.264 encoder's limits, as `validateVideoSettings` enforces them. */
export const H264_LIMITS = { maxSide: 4096, maxPixels: 4096 * 2160 } as const;

export function h264Problem(width: number, height: number): string | null {
  if (width < 2 || height < 2) return "Too small to encode.";
  if (width > H264_LIMITS.maxSide || height > H264_LIMITS.maxSide) return `Wider or taller than ${H264_LIMITS.maxSide} px, the H.264 limit. Export each output or screen instead.`;
  if (width * height > H264_LIMITS.maxPixels) return `More than ${H264_LIMITS.maxPixels.toLocaleString("en-US")} pixels, the H.264 limit. Export each output or screen instead.`;
  if (width % 2 || height % 2) return "H.264 needs even width and height. This size is odd and is never padded or scaled.";
  return null;
}

export function videoTargets(mapping: ResolvedMapping): VideoTarget[] {
  const target = (t: Omit<VideoTarget, "problem">): VideoTarget => ({ ...t, problem: h264Problem(t.width, t.height) });
  const rect = (r: VideoRegion["from"]) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  return [
    target({ id: "master", kind: "master", label: "Master canvas", width: mapping.master.width, height: mapping.master.height, regions: null }),
    ...mapping.outputs.map((o, i) =>
      target({
        id: o.outputId,
        kind: "output",
        label: `OUT ${i + 1} · ${o.name}`,
        width: o.width,
        height: o.height,
        regions: mapping.screens.filter((s) => s.outputId === o.outputId).map((s) => ({ from: rect(s.masterRect), to: { x: s.outputRect.x, y: s.outputRect.y } })),
      }),
    ),
    ...mapping.screens.map((s) =>
      target({
        id: `screen:${s.screenId}`,
        kind: "screen",
        label: s.name,
        width: s.masterRect.width,
        height: s.masterRect.height,
        regions: [{ from: rect(s.masterRect), to: { x: 0, y: 0 } }],
      }),
    ),
  ];
}
