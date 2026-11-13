import { drawCalibration } from "@/components/shell/calibration/draw";
import { buildCalibrationFrame, type CalibrationFrame, type CalibrationMode, type CalibrationScreen, type LogoMode } from "@/components/shell/calibration/frame";
import { calibrationTargets, screenLabel } from "@/components/shell/calibration/from-mapping";
import { CAL_COLORS, CAL_LOGO_ASSET, screenAccent } from "@/components/shell/calibration/tokens";
import type { FrameInput, FrameSource } from "@/preview/contract";
import { useCalibrationSource } from "./calibration-store";

/**
 * The calibration test card as a `FrameSource`: Product Design's identification and calibration frames
 * (`components/shell/calibration`), played across the mapped screens by the shared preview engine.
 *
 * The frame is built for the master canvas from the resolved mapping in `input.context`, the same
 * `calibrationTargets` the Preview dialog uses, so each screen is labelled with its identifier, name,
 * resolution, canvas position, output and cabinet grid. No coordinate is computed here. Without a
 * context it falls back to the screens' rectangles and order only.
 *
 * At scale 1 every rectangle lands on whole master pixels, as in the dialog's PNG export. The logo and
 * the monospace face load once, before they are used: call `prepareCalibrationSource` before exporting
 * frames, since a frame drawn before they arrive has no logo.
 */

const FALLBACK_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

let logo: HTMLImageElement | null = null;
let fontFamily = FALLBACK_FONT;
let preparing: Promise<CalibrationAssets> | null = null;

/** What `prepareCalibrationSource` managed to load. An export needing the logo refuses without it. */
export interface CalibrationAssets {
  readonly logo: boolean;
  readonly font: boolean;
}
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Loads the logo and the calibration face once. Resolves with what loaded; it never rejects. */
export function prepareCalibrationSource(): Promise<CalibrationAssets> {
  if (preparing) return preparing;
  if (typeof document === "undefined") return (preparing = Promise.resolve({ logo: false, font: false }));
  const image = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      logo = img;
      resolve();
    };
    img.onerror = () => resolve();
    img.src = CAL_LOGO_ASSET.src;
  });
  const declared = getComputedStyle(document.documentElement).getPropertyValue("--font-cal-mono").trim();
  const font = declared
    ? Promise.all([500, 600, 700].map((w) => document.fonts.load(`${w} 24px ${declared}`, "SCR-01 ×·…")))
        .then(() => {
          fontFamily = `${declared}, ${FALLBACK_FONT}`;
        })
        .catch(() => undefined)
    : Promise.resolve();
  preparing = Promise.all([image, font]).then(() => {
    notify();
    return { logo: logo !== null, font: fontFamily !== FALLBACK_FONT };
  });
  return preparing;
}

/** The master canvas's screens, labelled. From the mapping when the input carries it. */
function masterScreens(input: FrameInput): readonly CalibrationScreen[] {
  const mapping = input.context?.mapping;
  if (mapping && mapping.master.width === input.width && mapping.master.height === input.height) {
    return calibrationTargets(mapping)[0].screens;
  }
  return input.screens.map((s, i) => ({
    label: screenLabel(i, input.screens.length),
    name: s.name,
    rect: { x: s.x, y: s.y, width: s.width, height: s.height },
    canvasX: s.x,
    canvasY: s.y,
    accent: screenAccent(undefined, i),
  }));
}

/** The settings a test card is drawn with. */
export interface CalibrationSettings {
  readonly mode: CalibrationMode;
  readonly logo: LogoMode;
}

/** The Live preview's current settings. */
export function currentCalibrationSettings(): CalibrationSettings {
  const { mode, logoByMode } = useCalibrationSource.getState();
  return { mode, logo: logoByMode[mode] };
}

/** Last frame built, reused while the inputs it depends on are the same. Only counters change per frame. */
let cache: { key: readonly unknown[]; frame: CalibrationFrame } | null = null;

export function calibrationFrameFor(input: FrameInput, settings: CalibrationSettings = currentCalibrationSettings()): CalibrationFrame {
  const key = [input.context?.mapping ?? input.screens, input.width, input.height, input.fps, settings.mode, settings.logo];
  if (cache && cache.key.length === key.length && cache.key.every((v, i) => v === key[i])) return cache.frame;
  const frame = buildCalibrationFrame({
    width: input.width,
    height: input.height,
    screens: masterScreens(input),
    mode: settings.mode,
    logo: { mode: settings.logo, aspect: CAL_LOGO_ASSET.width / CAL_LOGO_ASSET.height },
    fps: input.fps,
  });
  cache = { key, frame };
  return frame;
}

function drawTestCard(ctx: CanvasRenderingContext2D, input: FrameInput, scale: number, settings: CalibrationSettings) {
  const frame = calibrationFrameFor(input, settings);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Master pixels no screen covers stay black, as on the wall.
  ctx.fillStyle = CAL_COLORS.black;
  ctx.fillRect(0, 0, Math.ceil(input.width * scale), Math.ceil(input.height * scale));
  const options = { scale, fontFamily, logo, frame: input.frame, fps: input.fps };
  drawCalibration(ctx, frame, options, "static");
  drawCalibration(ctx, frame, options, "counters");
  ctx.restore();
}

/**
 * A test card with its settings fixed, for exports: changing the Live preview controls during an export
 * can't change the frames. Call `prepareCalibrationSource` first and check the logo loaded if it's shown.
 */
export function createCalibrationSource(settings: CalibrationSettings): FrameSource {
  const frozen = Object.freeze({ ...settings });
  return {
    id: "calibration-test-card",
    name: "Calibration test card",
    draw: (ctx, input, { scale }) => drawTestCard(ctx, input, scale, frozen),
  };
}

export const calibrationSource: FrameSource = {
  id: "calibration-test-card",
  name: "Calibration test card",
  draw(ctx, input, { scale }) {
    void prepareCalibrationSource();
    drawTestCard(ctx, input, scale, currentCalibrationSettings());
  },
  subscribe(onChange) {
    listeners.add(onChange);
    const unsubscribe = useCalibrationSource.subscribe(onChange);
    return () => {
      listeners.delete(onChange);
      unsubscribe();
    };
  },
};
