import type { CalibrationMode, LogoMode } from "@/components/shell/calibration/frame";
import type { JsonValue, OutputRenderErrorCode, OutputSourceId, Size } from "@/domain/physical-output";
import { OUTPUT_SOURCE_IDS } from "@/domain/physical-output";
import { normalizeDepthConfig } from "@/engines/depth/config";
import { createDepthSource, depthMaxSize } from "@/modules/depth-studio/source";
import { useDepth } from "@/modules/depth-studio/depth-store";
import type { FrameSource } from "@/preview/contract";
import { createCalibrationSource, currentCalibrationSettings, prepareCalibrationSource, type CalibrationAssets, type CalibrationSettings } from "./calibration-source";
import { createPixelGridSource, PIXEL_GRID_LIVE_SETTINGS, type PixelGridSettings } from "./pixel-grid-source";

/**
 * Frozen output sources (PHYSICAL_OUTPUT 8.5): one table for the MP4 export and the output window, so both
 * build a source from the same settings by the same function.
 *
 * - `frozenSettings(id)` reads what the operator sees now, as plain JSON. Control side only: it reads the
 *   editor's stores.
 * - `createOutputSource(id, settings, master)` validates those settings, loads what the source needs and checks
 *   limits, then returns a source that never reads a store. Bad input is refused with a code, never fixed.
 */

/** A refusal the output page reports as `OutputRenderReport.errorCode`, and the export panel shows as text. */
export class OutputSourceError extends Error {
  constructor(
    readonly code: OutputRenderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OutputSourceError";
  }
}

/** Typed settings, after validation. */
export type OutputSourceSettings =
  | { readonly id: "calibration-test-card"; readonly settings: CalibrationSettings }
  | { readonly id: "pixel-grid"; readonly settings: PixelGridSettings }
  | { readonly id: "depth-scene"; readonly settings: ReturnType<typeof normalizeDepthConfig> };

const CALIBRATION_MODES: readonly CalibrationMode[] = ["identification", "calibration"];
const LOGO_MODES: readonly LogoMode[] = ["center", "watermark", "off"];
const GRID_SPACES: readonly PixelGridSettings["space"][] = ["master", "display"];

const isObject = (v: JsonValue): v is { readonly [key: string]: JsonValue } => typeof v === "object" && v !== null && !Array.isArray(v);

function invalid(id: string, detail: string): never {
  throw new OutputSourceError("SOURCE_SETTINGS_INVALID", `Settings for ${id} are invalid: ${detail}.`);
}

/** An object with exactly these keys. */
function exactKeys(id: string, value: JsonValue, keys: readonly string[]): { readonly [key: string]: JsonValue } {
  if (!isObject(value)) invalid(id, "expected an object");
  const extra = Object.keys(value).filter((k) => !keys.includes(k));
  if (extra.length) invalid(id, `unknown key ${extra.map((k) => `"${k}"`).join(", ")}`);
  const missing = keys.filter((k) => !(k in value));
  if (missing.length) invalid(id, `missing ${missing.map((k) => `"${k}"`).join(", ")}`);
  return value;
}

function oneOf<T extends string>(id: string, key: string, value: JsonValue, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) invalid(id, `"${key}" must be ${allowed.map((a) => `"${a}"`).join(" or ")}`);
  return value as T;
}

/** Deep equality of plain JSON, ignoring key order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Validates settings for a source id. Throws `SOURCE_UNKNOWN` or `SOURCE_SETTINGS_INVALID`. Pure. */
export function parseOutputSettings(id: string, settings: JsonValue): OutputSourceSettings {
  if (!(OUTPUT_SOURCE_IDS as readonly string[]).includes(id)) throw new OutputSourceError("SOURCE_UNKNOWN", `"${id}" is not a source the output can play.`);
  switch (id as OutputSourceId) {
    case "calibration-test-card": {
      const o = exactKeys(id, settings, ["mode", "logo"]);
      return { id: "calibration-test-card", settings: { mode: oneOf(id, "mode", o.mode, CALIBRATION_MODES), logo: oneOf(id, "logo", o.logo, LOGO_MODES) } };
    }
    case "pixel-grid": {
      const o = exactKeys(id, settings, ["space", "motion"]);
      if (typeof o.motion !== "boolean") invalid(id, '"motion" must be true or false');
      return { id: "pixel-grid", settings: { space: oneOf(id, "space", o.space, GRID_SPACES), motion: o.motion } };
    }
    case "depth-scene": {
      // The control window sends a normalized config, so any difference is a bug: refused, never fixed.
      const config = normalizeDepthConfig(settings);
      if (!jsonEqual(config, settings)) invalid(id, "not a normalized Depth Studio config");
      return { id: "depth-scene", settings: config };
    }
  }
}

/** The settings of a source as the operator sees it now, as plain JSON. Reads the editor's stores. */
export function frozenSettings(id: OutputSourceId): JsonValue {
  switch (id) {
    case "calibration-test-card": {
      const { mode, logo } = currentCalibrationSettings();
      return { mode, logo };
    }
    case "pixel-grid":
      return { space: PIXEL_GRID_LIVE_SETTINGS.space, motion: PIXEL_GRID_LIVE_SETTINGS.motion };
    case "depth-scene":
      return JSON.parse(JSON.stringify(normalizeDepthConfig(useDepth.getState().config))) as JsonValue;
  }
}

/** What `createOutputSource` uses from the browser. Tests inject these. */
export interface OutputSourceEnv {
  readonly prepareCalibration: () => Promise<CalibrationAssets>;
  readonly depthMaxSize: () => number | null;
}

const BROWSER_ENV: OutputSourceEnv = { prepareCalibration: prepareCalibrationSource, depthMaxSize };

/**
 * A source with its settings fixed, ready to draw the master canvas at scale 1. Rejects with an
 * `OutputSourceError`. The pixel grid's `display` space is drawn by the output page itself, not as a
 * master-canvas source, so it is refused here with `SOURCE_SETTINGS_INVALID`.
 */
export async function createOutputSource(id: string, settings: JsonValue, master: Size, env: OutputSourceEnv = BROWSER_ENV): Promise<FrameSource> {
  const parsed = parseOutputSettings(id, settings);
  switch (parsed.id) {
    case "calibration-test-card": {
      const assets = await env.prepareCalibration();
      if (parsed.settings.logo !== "off" && !assets.logo) {
        throw new OutputSourceError("ASSET_MISSING", "The Playground Studio logo didn't load, so the test card can't be exported with it. Reload, or set the logo to Off.");
      }
      return createCalibrationSource(parsed.settings);
    }
    case "pixel-grid":
      if (parsed.settings.space !== "master") invalid(id, "display space is drawn by the output page, not as a master-canvas source");
      return createPixelGridSource(parsed.settings);
    case "depth-scene": {
      const max = env.depthMaxSize();
      if (max === null) throw new OutputSourceError("GPU_UNAVAILABLE", "Depth Studio needs WebGL 2, which this browser doesn't provide.");
      if (Math.max(master.width, master.height) > max) {
        throw new OutputSourceError("MASTER_TOO_LARGE", `The master canvas is larger than this GPU renders without scaling (${max} px a side). It is never scaled down.`);
      }
      return createDepthSource(parsed.settings);
    }
  }
}
